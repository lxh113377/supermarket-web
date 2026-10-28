//! 库存域写动作的用例。期望值来自**独立侦察**（另一路逐行读 stock.js/actions/stock.js 并手算），
//! 与我的读数逐字一致；这里把它们钉成断言，顺带覆盖「中间态」那些隐蔽分支。

use serde_json::json;
use supermarket_core::stock_ops::{
    adjust_data, adjust_delta, adjust_note, adjust_product_id, delta_for_stock_change,
    insufficient_message,
};

#[test]
fn i_hand_worked_example_matches_the_recon() {
    // 输入 {productId:'p_milk', delta:4, note:'到货'}，SELECT 命中 {_id:'p_milk', stock:5}
    let before = 5.0;
    let delta: i64 = adjust_delta(Some(&json!({ "delta": 4 }))).unwrap();
    let after = before + delta as f64;
    let ledger = delta_for_stock_change(before, after);
    assert_eq!(delta, 4);
    assert_eq!(after, 9.0);
    assert_eq!(ledger, Some(4));
    assert_eq!(
        serde_json::to_string(&adjust_data("p_milk", before, after, ledger)).unwrap(),
        "{\"productId\":\"p_milk\",\"before\":5,\"after\":9,\"delta\":4,\"recorded\":true}"
    );
}

#[test]
fn i_delta_for_stock_change_branches() {
    // 两端口都整数才有账；负数端有专门分支（现网 stock.js:32-38）
    assert_eq!(delta_for_stock_change(-1.0, 5.0), Some(5));
    assert_eq!(delta_for_stock_change(5.0, -1.0), Some(-5));
    assert_eq!(delta_for_stock_change(-1.0, -1.0), None);
    assert_eq!(delta_for_stock_change(-1.0, 0.0), None);
    assert_eq!(delta_for_stock_change(5.0, 5.0), None);
    // 小数 ⇒ 不记账（UPDATE 照样写库，但账面不动）
    assert_eq!(delta_for_stock_change(12.5, 16.5), None);
    // NaN ⇒ 不记账
    assert_eq!(delta_for_stock_change(f64::NAN, 3.0), None);
    assert_eq!(delta_for_stock_change(3.0, f64::NAN), None);
}

#[test]
fn i_fractional_stock_writes_without_a_ledger_entry() {
    // stock=12.5、delta=4 ⇒ after=16.5、recorded=false、delta=0（现网就是这个结局）
    let ledger = delta_for_stock_change(12.5, 16.5);
    assert_eq!(ledger, None);
    assert_eq!(
        serde_json::to_string(&adjust_data("p", 12.5, 16.5, ledger)).unwrap(),
        "{\"productId\":\"p\",\"before\":12.5,\"after\":16.5,\"delta\":0,\"recorded\":false}"
    );
}

#[test]
fn i_nan_stock_serialises_to_null_like_js() {
    // stock='abc' ⇒ NaN：两道 <0 检查都过，响应里 before/after 序列化成 null
    let ledger = delta_for_stock_change(f64::NAN, f64::NAN);
    assert_eq!(ledger, None);
    assert_eq!(
        serde_json::to_string(&adjust_data("p", f64::NAN, f64::NAN, ledger)).unwrap(),
        "{\"productId\":\"p\",\"before\":null,\"after\":null,\"delta\":0,\"recorded\":false}"
    );
}

#[test]
fn i_product_id_normalises_like_js() {
    assert_eq!(adjust_product_id(None), "");
    assert_eq!(adjust_product_id(Some(&json!({}))), "");
    // 0 / 空串 / null / false 都落空串 ⇒ missing_product_id
    assert_eq!(adjust_product_id(Some(&json!({ "productId": 0 }))), "");
    assert_eq!(adjust_product_id(Some(&json!({ "productId": "" }))), "");
    assert_eq!(adjust_product_id(Some(&json!({ "productId": null }))), "");
    assert_eq!(adjust_product_id(Some(&json!({ "productId": false }))), "");
    // 其余走 String()
    assert_eq!(adjust_product_id(Some(&json!({ "productId": 5 }))), "5");
    assert_eq!(adjust_product_id(Some(&json!({ "productId": true }))), "true");
    assert_eq!(adjust_product_id(Some(&json!({ "productId": {} }))), "[object Object]");
    assert_eq!(adjust_product_id(Some(&json!({ "productId": ["a", "b"] }))), "a,b");
}

#[test]
fn i_delta_validates_in_the_live_order() {
    // 非零整数：NaN / 0 / 'abc' / 缺失 都拒
    assert_eq!(adjust_delta(None), Err("delta 必须是非零整数"));
    assert_eq!(adjust_delta(Some(&json!({ "delta": 0 }))), Err("delta 必须是非零整数"));
    assert_eq!(adjust_delta(Some(&json!({ "delta": "abc" }))), Err("delta 必须是非零整数"));
    assert_eq!(adjust_delta(Some(&json!({ "delta": null }))), Err("delta 必须是非零整数"));
    // 先 trunc 再判：1.9 → 1、"5" → 5、true → 1
    assert_eq!(adjust_delta(Some(&json!({ "delta": 1.9 }))), Ok(1));
    assert_eq!(adjust_delta(Some(&json!({ "delta": "-2.9" }))), Ok(-2));
    assert_eq!(adjust_delta(Some(&json!({ "delta": "5" }))), Ok(5));
    assert_eq!(adjust_delta(Some(&json!({ "delta": true }))), Ok(1));
    // 上限 100000 收、100001 拒（截断后再比）
    assert_eq!(adjust_delta(Some(&json!({ "delta": 100000 }))), Ok(100000));
    assert_eq!(
        adjust_delta(Some(&json!({ "delta": 100001 }))),
        Err("单次调整数量过大（|delta| ≤ 100000）")
    );
}

#[test]
fn i_note_is_truncated_to_200_chars() {
    assert_eq!(adjust_note(None), "");
    assert_eq!(adjust_note(Some(&json!({ "note": "到货" }))), "到货");
    let long = "x".repeat(260);
    assert_eq!(adjust_note(Some(&json!({ "note": long }))).chars().count(), 200);
}

#[test]
fn i_insufficient_message_matches_the_template() {
    assert_eq!(
        insufficient_message(5.0, -10),
        "调整后库存为负（现 5，本次 -10）"
    );
    assert_eq!(
        insufficient_message(0.0, -1),
        "调整后库存为负（现 0，本次 -1）"
    );
}
