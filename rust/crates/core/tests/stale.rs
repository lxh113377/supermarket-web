//! 超时单盘点的用例：ISO 解析（含闰年）、窗口钳制、ageMinutes、以及纯组装（早退/占用聚合/保序）。
//!
//! epoch 参考值不是手算的：每个都先用 \`Date.parse\` 现算出来再写进来（见本轮提交信息）。

use serde_json::json;
use supermarket_core::stale::{
    age_minutes, parse_iso_ms, stale_minutes, stale_report, STALE_MINUTES_DEFAULT,
    STALE_MINUTES_MAX,
};

#[test]
fn f_parse_iso_matches_date_parse() {
    // 参考值 = node -e "console.log(Date.parse('<ts>'))"
    assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
    assert_eq!(parse_iso_ms("2026-10-27T00:00:00.000Z"), Some(1793059200000));
    assert_eq!(parse_iso_ms("2024-02-29T12:34:56.789Z"), Some(1709210096789));
    assert_eq!(parse_iso_ms("2026-01-01T00:00:00.000Z"), Some(1767225600000));
    assert_eq!(parse_iso_ms("2000-01-01T00:00:00.000Z"), Some(946684800000));
    // 坏输入 ⇒ None（调用方落 0；现网会落 NaN → JSON null，见 stale.rs 文件头的已知差异）
    // 秒级（无毫秒）也要认 —— 与 JS 的 Date.parse 同：这是被独立例子逼出来的一处修正
    assert_eq!(parse_iso_ms("2026-10-27T00:00:00Z"), Some(1793059200000));
    for bad in [
        "",
        "not-a-date",
        "2026-10-27 00:00:00",
        // 无 Z 后缀：JS 按运行环境本地时区解释 ⇒ 跨机器结果不同；本实现判为不可解析
        "2026-10-27T00:00:00",
        "2026-13-01T00:00:00.000Z",
        "2026-10-32T00:00:00.000Z",
    ] {
        assert!(parse_iso_ms(bad).is_none(), "{bad} 不该解析成功");
    }
}

#[test]
fn f_age_minutes_matches_js_rounding() {
    let now = 1793059200000 + 90 * 60_000; // 2026-10-27T00:00Z 之后 90 分钟
    assert_eq!(age_minutes(now, "2026-10-27T00:00:00.000Z"), 90);
    // 未来时间 ⇒ 0（Math.max(0, ...)）
    assert_eq!(age_minutes(1793059200000, "2026-11-01T00:00:00.000Z"), 0);
    // 29.5 分钟 ⇒ Math.round → 30
    assert_eq!(age_minutes(1793059200000 + 1_770_000, "2026-10-27T00:00:00.000Z"), 30);
    // 坏时间串 ⇒ 0
    assert_eq!(age_minutes(now, "oops"), 0);
}

#[test]
fn f_stale_minutes_clamps_like_js() {
    for (given, want) in [
        (json!(0), STALE_MINUTES_DEFAULT),
        (json!("abc"), STALE_MINUTES_DEFAULT),
        (json!(null), STALE_MINUTES_DEFAULT),
        (json!(-5), 1),
        (json!(1), 1),
        (json!(60), 60),
        (json!(10081), STALE_MINUTES_MAX),
        (json!("120"), 120),
        (json!(60.9), 60),
    ] {
        assert_eq!(
            stale_minutes(Some(&json!({ "minutes": given }))),
            want,
            "minutes={given}"
        );
    }
    assert_eq!(stale_minutes(None), STALE_MINUTES_DEFAULT);
}

#[test]
fn f_stale_report_early_returns_on_empty_rows() {
    let out = stale_report(&[], &[], 1_793_059_200_000, 60);
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "{\"thresholdMinutes\":60,\"count\":0,\"orders\":[],\"stockReserved\":[]}"
    );
}

#[test]
fn f_stale_report_aggregates_reserved_and_keeps_order() {
    // 两单：第一单含 p1（库存 10，有限）×2、p2（库存 -1，不限售）×5；第二单含 p1 ×3 与缺失商品
    let rows = vec![
        json!({
            "_id": "o_1", "roomNumber": "36-1116", "totalAmount": 7,
            "createdAt": "2026-10-27T00:00:00.000Z", "paymentScreenshot": "data:image/png;base64,AAA",
            "items": "[{\"productId\":\"p1\",\"quantity\":2},{\"productId\":\"p2\",\"quantity\":5}]"
        }),
        json!({
            "_id": "o_2", "roomNumber": "36-0714", "totalAmount": 3,
            "createdAt": "2026-10-27T00:30:00.000Z", "paymentScreenshot": "",
            "items": "[{\"productId\":\"p1\",\"quantity\":3},{\"productId\":\"pX\",\"quantity\":1}]"
        }),
    ];
    let prods = vec![
        json!({ "_id": "p1", "name": "冰红茶", "stock": 10 }),
        json!({ "_id": "p2", "name": "不限售水", "stock": -1 }),
    ];
    let now = 1_793_059_200_000 + 90 * 60_000; // o_1 距 now 90 分钟、o_2 距 now 60 分钟
    let out = stale_report(&rows, &prods, now, 60);
    // count 与 orders 的元素形状（键序：id, roomNumber, totalAmount, ageMinutes, hasPaymentProof）
    assert_eq!(out["thresholdMinutes"], json!(60));
    assert_eq!(out["count"], json!(2));
    assert_eq!(
        serde_json::to_string(&out["orders"]).unwrap(),
        "[{\"id\":\"o_1\",\"roomNumber\":\"36-1116\",\"totalAmount\":7,\"ageMinutes\":90,\"hasPaymentProof\":true},{\"id\":\"o_2\",\"roomNumber\":\"36-0714\",\"totalAmount\":3,\"ageMinutes\":60,\"hasPaymentProof\":false}]"
    );
    // stockReserved：只算有限库存（p1 合计 2+3=5），不限售 p2 不计；缺失商品 pX 跳过
    assert_eq!(
        serde_json::to_string(&out["stockReserved"]).unwrap(),
        "[{\"productId\":\"p1\",\"name\":\"冰红茶\",\"reserved\":5}]"
    );
}

#[test]
fn f_iso_from_ms_round_trips_with_parse() {
    for ms in [0i64, 1_793_059_200_000, 1_709_210_096_789, 1_767_225_600_000] {
        let s = supermarket_core::stale::iso_from_ms(ms);
        assert_eq!(parse_iso_ms(&s), Some(ms), "{ms} → {s} 应能原样解析回来");
    }
    assert_eq!(supermarket_core::stale::iso_from_ms(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(supermarket_core::stale::iso_from_ms(1_709_210_096_789), "2024-02-29T12:34:56.789Z");
}

#[test]
fn f_stale_product_ids_dedupe_in_first_seen_order() {
    let rows = vec![
        json!({ "items": "[{\"productId\":\"p2\"},{\"productId\":\"p1\"}]" }),
        json!({ "items": "[{\"productId\":\"p1\"},{\"productId\":\"p3\"}]" }),
        json!({ "items": "[]" }),
    ];
    assert_eq!(
        supermarket_core::stale::stale_product_ids(&rows),
        vec!["p2".to_string(), "p1".to_string(), "p3".to_string()]
    );
    assert!(supermarket_core::stale::stale_product_ids(&[json!({ "items": "{oops" })]).is_empty());
}
