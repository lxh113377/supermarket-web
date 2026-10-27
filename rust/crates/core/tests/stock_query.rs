//! 库存流水查询构造的用例：把「两条查询共用同一 clause/params」变成可断言的事实。

use serde_json::json;
use supermarket_core::stock_query::{movement_query, MOVEMENT_PAGE_DEFAULT, MOVEMENT_PAGE_MAX};

#[test]
fn d_empty_payload_means_no_where_and_default_paging() {
    let q = movement_query(Some(&json!({}))).expect("空载荷不该失败");
    assert_eq!(q.clause, "");
    assert!(q.params.is_empty());
    assert_eq!(q.limit, MOVEMENT_PAGE_DEFAULT);
    assert_eq!(q.offset, 0);
    // 载荷整个缺失（None）与空对象同义
    let q2 = movement_query(None).expect("无载荷不该失败");
    assert_eq!(q2, q);
}

#[test]
fn d_both_filters_share_one_clause_and_param_order() {
    let q = movement_query(Some(&json!({ "productId": "p001", "kind": "sale" }))).expect("合法");
    // 顺序固定：productId 在前、kind 在后（与现网 where.push 的顺序一致）
    assert_eq!(q.clause, "WHERE m.productId = ? AND m.kind = ?");
    assert_eq!(q.params, vec![json!("p001"), json!("sale")]);
    // 只有 productId
    let q2 = movement_query(Some(&json!({ "productId": 42 }))).expect("合法");
    assert_eq!(q2.clause, "WHERE m.productId = ?");
    assert_eq!(q2.params, vec![json!("42")], "Number 也要按 String(...) 绑定");
    // 只有 kind
    let q3 = movement_query(Some(&json!({ "kind": "adjust" }))).expect("合法");
    assert_eq!(q3.clause, "WHERE m.kind = ?");
    assert_eq!(q3.params, vec![json!("adjust")]);
}

#[test]
fn d_falsy_filters_are_ignored_like_js() {
    // 真值判定：空串/0/null/false 都算「没给」
    for payload in [
        json!({ "productId": "", "kind": "" }),
        json!({ "productId": 0, "kind": 0 }),
        json!({ "productId": null, "kind": null }),
        json!({ "productId": false, "kind": false }),
    ] {
        let q = movement_query(Some(&payload)).expect("这些都不该失败");
        assert_eq!(q.clause, "", "载荷 {payload} 应当被当作没给");
        assert!(q.params.is_empty());
    }
}

#[test]
fn d_invalid_kind_returns_the_live_envelope() {
    let err = movement_query(Some(&json!({ "kind": "steal" }))).expect_err("必须拒绝");
    assert_eq!(err["errorCode"], json!("invalid_kind"));
    assert_eq!(err["kind"], json!("input"));
    assert_eq!(err["retryable"], json!(false));
    // 消息里带清洗后的 kind 与在册清单（与现网 stock.js:108 同文案）
    assert_eq!(err["message"], json!("kind 非法：steal（在册：init/sale/void/adjust）"));
    // 清洗：白名单外的字符被删（现网 echo 走 sanitizeTrace）
    let err2 = movement_query(Some(&json!({ "kind": "a b*" }))).expect_err("必须拒绝");
    assert_eq!(err2["message"], json!("kind 非法：ab（在册：init/sale/void/adjust）"));
}

#[test]
fn d_limit_and_offset_follow_js_coercion() {
    // limit: Number(x) || 30，再钳 [1,100]
    let cases = [
        (json!(0), MOVEMENT_PAGE_DEFAULT),
        (json!("abc"), MOVEMENT_PAGE_DEFAULT),
        (json!(null), MOVEMENT_PAGE_DEFAULT),
        (json!(-5), 1),
        (json!(1), 1),
        (json!(30), 30),
        (json!(100), 100),
        (json!(101), MOVEMENT_PAGE_MAX),
        (json!("50"), 50),
        (json!(30.9), 30),
    ];
    for (given, want) in cases {
        let q = movement_query(Some(&json!({ "limit": given }))).expect("合法");
        assert_eq!(q.limit, want, "limit={given} 应当落 {want}");
    }
    // offset: max(0, trunc(Number(x) || 0))
    let cases = [(json!(-3), 0), (json!(0), 0), (json!(7.8), 7), (json!("9"), 9), (json!("x"), 0)];
    for (given, want) in cases {
        let q = movement_query(Some(&json!({ "offset": given }))).expect("合法");
        assert_eq!(q.offset, want, "offset={given} 应当落 {want}");
    }
}
