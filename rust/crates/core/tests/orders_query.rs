//! 订单分页构造的用例：把「四处派生同源」与 JS 的强制转换规则钉住。

use serde_json::json;
use supermarket_core::orders_query::{
    order_detail_row_to_json, order_row_to_json, orders_query, visible_rows, ORDER_PAGE_MAX,
    ORDER_PAGE_SIZE_DEFAULT,
};

#[test]
fn e_page_and_page_size_follow_js_coercion() {
    // page：Math.max(1, Number(x) || 1)
    for (given, want) in [
        (json!(0), 1i64),
        (json!("abc"), 1),
        (json!(null), 1),
        (json!(-3), 1),
        (json!(2), 2),
        (json!("7"), 7),
        (json!(3.9), 3),
    ] {
        assert_eq!(orders_query(Some(&json!({ "page": given }))).page, want, "page={given}");
    }
    // pageSize：Math.min(100, Math.max(1, Number(x) || 50))
    for (given, want) in [
        (json!(0), ORDER_PAGE_SIZE_DEFAULT),
        (json!("abc"), ORDER_PAGE_SIZE_DEFAULT),
        (json!(null), ORDER_PAGE_SIZE_DEFAULT),
        (json!(-1), 1),
        (json!(1), 1),
        (json!(101), ORDER_PAGE_MAX),
        (json!("20"), 20),
    ] {
        assert_eq!(
            orders_query(Some(&json!({ "pageSize": given }))).page_size,
            want,
            "pageSize={given}"
        );
    }
    // 无载荷 ⇒ 默认值
    let q = orders_query(None);
    assert_eq!(q.page, 1);
    assert_eq!(q.page_size, ORDER_PAGE_SIZE_DEFAULT);
    assert_eq!(q.fetch, ORDER_PAGE_SIZE_DEFAULT + 1);
    assert_eq!(q.offset, 0);
}

#[test]
fn e_since_requires_a_non_empty_string() {
    for bad in [json!(""), json!(123), json!(true), json!(null), json!(["2026-01-01"])] {
        let q = orders_query(Some(&json!({ "since": bad })));
        assert!(q.since.is_none(), "since={bad} 不该被采纳");
        assert_eq!(q.where_clause, "");
        assert_eq!(q.order_by_col, "o.createdAt");
        assert_eq!(q.dir, "DESC");
        assert_eq!(q.params_prefix.len(), 0);
    }
    let q = orders_query(Some(&json!({ "since": "2026-10-27T00:00:00.000Z" })));
    assert_eq!(q.since.as_deref(), Some("2026-10-27T00:00:00.000Z"));
    assert_eq!(q.where_clause, "WHERE o.updatedAt > ?");
    assert_eq!(q.order_by_col, "o.updatedAt");
    assert_eq!(q.dir, "ASC");
    assert_eq!(q.params_prefix, vec![json!("2026-10-27T00:00:00.000Z")]);
}

#[test]
fn e_param_order_matches_js() {
    // since 模式：[since, pageSize+1, (page-1)*pageSize]
    let q = orders_query(Some(&json!({ "since": "S", "pageSize": 10, "page": 3 })));
    let mut all = q.params_prefix.clone();
    all.push(json!(q.fetch));
    all.push(json!(q.offset));
    assert_eq!(all, vec![json!("S"), json!(11), json!(20)]);
    // 分页模式：[pageSize+1, (page-1)*pageSize]
    let q2 = orders_query(Some(&json!({ "pageSize": 10, "page": 3 })));
    let mut all2 = q2.params_prefix.clone();
    all2.push(json!(q2.fetch));
    all2.push(json!(q2.offset));
    assert_eq!(all2, vec![json!(11), json!(20)]);
}

#[test]
fn e_visible_rows_matches_js_slice_semantics() {
    let five: Vec<serde_json::Value> = (0..5).map(|i| json!({ "i": i })).collect();
    // 取 3（LIMIT 是 pageSize+1=4 却拿到 5 条，不可能，但纯函数要按公式走）：5 > 3 ⇒ slice 到 3
    let (data, has_more) = visible_rows(five.clone(), 3);
    assert!(has_more);
    assert_eq!(data.len(), 3);
    // 取 5：5 > 5 为假 ⇒ 原样返回、hasMore=false
    let (data2, has_more2) = visible_rows(five.clone(), 5);
    assert!(!has_more2);
    assert_eq!(data2.len(), 5);
    // 取 50：同理
    let (data3, has_more3) = visible_rows(five, 50);
    assert!(!has_more3);
    assert_eq!(data3.len(), 5);
}

#[test]
fn e_row_mappings_cover_items_and_payment_screenshot() {
    // getOrders 的行映射：只覆盖 items（JSON 文本列）
    let row = json!({ "_id": "o_1", "items": "[{\"name\":\"冰红茶\",\"quantity\":2}]", "totalAmount": 7 });
    assert_eq!(
        serde_json::to_string(&order_row_to_json(&row)).unwrap(),
        "{\"_id\":\"o_1\",\"items\":[{\"name\":\"冰红茶\",\"quantity\":2}],\"totalAmount\":7}"
    );
    // 脏 items ⇒ 空数组（jparse 的 fallback）
    let dirty = json!({ "_id": "o_2", "items": "{oops" });
    assert_eq!(serde_json::to_string(&order_row_to_json(&dirty)).unwrap(), "{\"_id\":\"o_2\",\"items\":[]}");
    // getOrder 的详情映射：额外把 paymentScreenshot 的 falsy 归一成空串
    let detail = json!({ "_id": "o_3", "items": "[]", "paymentScreenshot": null });
    let out = order_detail_row_to_json(&detail);
    assert_eq!(out["paymentScreenshot"], json!(""));
    assert_eq!(out["items"], json!([]));
    // 有值就原样
    let detail2 = json!({ "_id": "o_4", "paymentScreenshot": "https://x/y.png", "items": "[]" });
    assert_eq!(order_detail_row_to_json(&detail2)["paymentScreenshot"], json!("https://x/y.png"));
}
