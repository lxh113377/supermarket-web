//! 看板六聚合的用例。
//!
//! **这些期望值不是我自己算的**：它们来自一次独立侦察（另一路逐行读 stats.js 并用手算例子复算过），
//! 两边独立得到同一组数 —— 这才是「交叉验证」，而不是「我写实现、我写期望、我通过」。
//! 时间参考值用 node 的 Date.parse 现算（nowMs=1773115200000 即 2026-03-10T04:00:00Z）。

use serde_json::json;
use supermarket_core::stats::{
    build_delta, build_pie_segments, build_range_data, build_review_trend, build_top_revenue,
    compute_gross_margin, dashboard_data, local_day_label, stats_range_days,
};

const NOW: i64 = 1_773_115_200_000; // 2026-03-10T04:00:00Z（UTC+8 3/10 12:00）

fn o(created: &str, status: &str, total: f64) -> serde_json::Value {
    json!({ "createdAt": created, "status": status, "totalAmount": total })
}

#[test]
fn h_label_is_one_day_earlier_than_the_bucket() {
    // 上游行为：今天那个桶的标签是**前一天**（注释声称与分桶同口径，实际没有）
    let today = supermarket_core::stats::local_day(NOW);
    assert_eq!(today, 20522);
    assert_eq!(local_day_label(today), "3/9");
    // 真·UTC+8 日历日应是 3/10；这里把「早一天」写成断言 —— 修不修是独立工单的事
    assert_eq!(local_day_label(today - 1), "3/8");
    assert_eq!(local_day_label(today + 1), "3/10");
}

#[test]
fn h_range_data_matches_the_independent_example() {
    let orders = vec![
        o("2026-03-10T02:00:00Z", "paid", 50.0),      // diff 0 → 末位
        o("2026-03-08T17:00:00Z", "cancelled", 30.0), // UTC+8 3/9 01:00 ⇒ diff 1，取消不计营收
        o("2026-03-07T15:59:59Z", "paid", 9.0),       // UTC+8 3/7 23:59 ⇒ diff 3 ≥ days 跳过
        json!({ "createdAt": "bad", "status": "paid", "totalAmount": 5 }), // 解析不出 ⇒ 跳过
    ];
    let out = build_range_data(&orders, 3, NOW);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "{\"labels\":[\"3/7\",\"3/8\",\"3/9\"],\"orderCounts\":[0,1,1],\"revenues\":[0,0,50]}"
    );
}

#[test]
fn h_delta_matches_the_independent_example() {
    // cur 窗口 [3/8 00:00+08, 3/11 00:00+08)：O1 + O2；prev 窗口 [3/5, 3/8)：O4 + O5
    let orders = vec![
        o("2026-03-10T02:00:00Z", "paid", 50.0),
        o("2026-03-08T17:00:00Z", "cancelled", 30.0),
        o("2026-03-07T15:59:59Z", "paid", 20.0),
        o("2026-03-06T04:00:00Z", "paid", 40.0),
    ];
    let out = build_delta(&orders, 3, NOW);
    // 订单数 2 vs 2 ⇒ 0；营收 50 vs 60 ⇒ round(-16.6667) = -17（Math.round 向 +∞，不是 -17.0001 那类截断）
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "{\"ordersDelta\":0,\"revenueDelta\":-17}"
    );
}

#[test]
fn h_delta_returns_null_when_base_is_zero() {
    let orders = vec![o("2026-03-10T02:00:00Z", "paid", 50.0)];
    let out = build_delta(&orders, 3, NOW);
    assert_eq!(out["ordersDelta"], serde_json::Value::Null);
    assert_eq!(out["revenueDelta"], serde_json::Value::Null);
}

#[test]
fn h_review_trend_matches_the_independent_example() {
    let reviews = vec![
        json!({ "createdAt": "2026-03-10T02:00:00Z" }), // 末位 idx13
        json!({ "createdAt": "2026-03-09T00:00:00Z" }), // idx12
        json!({ "createdAt": "2026-03-01T00:00:00Z" }), // diff 9 ⇒ idx4
        json!({ "createdAt": null }),                   // falsy ⇒ 跳过
        json!({ "createdAt": "2026-02-22T00:00:00Z" }), // diff 16 ≥ 14 ⇒ 跳过
    ];
    let out = build_review_trend(&reviews, 14, NOW);
    assert_eq!(out["counts"][4], json!(1));
    assert_eq!(out["counts"][12], json!(1));
    assert_eq!(out["counts"][13], json!(1));
    assert_eq!(out["labels"][0], json!("2/24"));
    assert_eq!(out["labels"][13], json!("3/9"));
    // counts 在 labels 之前（键序）
    assert_eq!(
        serde_json::to_string(&out).unwrap().starts_with("{\"counts\":["),
        true
    );
}

#[test]
fn h_gross_margin_matches_the_independent_example() {
    let products = vec![
        json!({ "_id": "p1", "name": "可乐", "spec": "500ml", "costPrice": 2 }),
        json!({ "_id": "p2", "name": "面包", "spec": "", "costPrice": null }),
    ];
    let orders = vec![
        json!({ "status": "paid", "items": "[{\"productId\":\"p1\",\"name\":\"可乐\",\"spec\":\"500ml\",\"price\":5,\"quantity\":3,\"subcategories\":[\"soda\"]},{\"productId\":\"p2\",\"name\":\"面包\",\"spec\":\"\",\"price\":10,\"quantity\":1,\"subcategories\":[\"daily_goods\"]}]" }),
        json!({ "status": "cancelled", "items": "[{\"productId\":\"p1\",\"quantity\":9}]" }),
    ];
    let out = compute_gross_margin(&orders, &products);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "{\"drink\":{\"revenue\":15,\"cost\":6,\"marginPct\":60},\"food\":null,\"daily\":null,\"withCostItems\":3,\"totalItems\":4}"
    );
}

#[test]
fn h_pie_segments_matches_the_independent_example() {
    let orders = vec![
        json!({ "status": "paid", "items": "[{\"subcategories\":[\"soda\"],\"quantity\":2},{\"subcategories\":[\"daily_goods\"],\"quantity\":1}]" }),
        json!({ "status": "paid", "items": "[{\"subcategories\":[\"snack\"],\"quantity\":4},{\"quantity\":3}]" }),
        json!({ "status": "cancelled", "items": "[{\"subcategories\":[\"soda\"],\"quantity\":99}]" }),
    ];
    let out = build_pie_segments(&orders);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "[{\"name\":\"饮品\",\"value\":5},{\"name\":\"食品\",\"value\":4},{\"name\":\"日用\",\"value\":1}]"
    );
    // 全零 ⇒ 空数组（三段都被 value > 0 过滤）
    assert_eq!(
        serde_json::to_string(&build_pie_segments(&[json!({ "status": "paid", "items": "[]" })])).unwrap(),
        "[]"
    );
}

#[test]
fn h_top_revenue_matches_the_independent_example() {
    let orders = vec![
        json!({ "status": "paid", "items": "[{\"name\":\"可乐\",\"spec\":\"500ml\",\"price\":5,\"quantity\":3},{\"name\":\"面包\",\"spec\":null,\"price\":10,\"quantity\":1}]" }),
        json!({ "status": "paid", "items": "[{\"name\":\"可乐\",\"spec\":\"500ml\",\"price\":5,\"quantity\":2}]" }),
        json!({ "status": "cancelled", "items": "[{\"name\":\"可乐\",\"spec\":\"500ml\",\"price\":5,\"quantity\":99}]" }),
    ];
    let out = build_top_revenue(&orders);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "[{\"name\":\"可乐(500ml)\",\"revenue\":25,\"qty\":5},{\"name\":\"面包\",\"revenue\":10,\"qty\":1}]"
    );
}

#[test]
fn h_range_days_clamps_and_rejects_fractions() {
    assert_eq!(stats_range_days(None), Some(7));
    assert_eq!(stats_range_days(Some(&json!({ "rangeDays": 0 }))), Some(7));
    assert_eq!(stats_range_days(Some(&json!({ "rangeDays": -5 }))), Some(1)); // 负值走 Math.max ⇒ 1（不是 || 7：-5 是真值）
    assert_eq!(stats_range_days(Some(&json!({ "rangeDays": 1 }))), Some(1));
    assert_eq!(stats_range_days(Some(&json!({ "rangeDays": "30" }))), Some(30));
    assert_eq!(stats_range_days(Some(&json!({ "rangeDays": 999 }))), Some(365));
    // 非整数：现网会在 new Array(7.5) 抛 RangeError ⇒ 500；本实现交回落透传
    assert_eq!(stats_range_days(Some(&json!({ "rangeDays": 7.5 }))), None);
}

#[test]
fn h_dashboard_data_assembles_in_the_live_key_order() {
    let out = dashboard_data(&[], &[], &[], 7, NOW);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "{\"rangeDays\":7,\"rangeData\":{\"labels\":[\"3/3\",\"3/4\",\"3/5\",\"3/6\",\"3/7\",\"3/8\",\"3/9\"],\"orderCounts\":[0,0,0,0,0,0,0],\"revenues\":[0,0,0,0,0,0,0]},\"delta\":{\"ordersDelta\":null,\"revenueDelta\":null},\"reviewTrend\":{\"counts\":[0,0,0,0,0,0,0,0,0,0,0,0,0,0],\"labels\":[\"2/24\",\"2/25\",\"2/26\",\"2/27\",\"2/28\",\"3/1\",\"3/2\",\"3/3\",\"3/4\",\"3/5\",\"3/6\",\"3/7\",\"3/8\",\"3/9\"]},\"margin\":{\"drink\":null,\"food\":null,\"daily\":null,\"withCostItems\":0,\"totalItems\":0},\"pieSegments\":[],\"topRevenue\":[],\"revenueSum\":0,\"orderSum\":0,\"totalOrders\":0}"
    );
}
