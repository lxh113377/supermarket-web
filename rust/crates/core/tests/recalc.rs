use serde_json::json;
use supermarket_core::recalc::{promotion_applies, recalc_expect, recalc_needs_fix, recalc_subtotal, stored_promotion_id};

#[test]
fn m_subtotal_and_expect_match_the_recon_examples() {
    let items = vec![json!({ "price": 10, "quantity": 2 })];
    assert_eq!(recalc_subtotal(&items), 20.0);
    assert_eq!(recalc_expect(&items, "", None), (0.0, 20.0, String::new()));
    let items_b = vec![json!({ "price": 30, "quantity": 2 })];
    let rule = json!({ "threshold": 50, "discount": 5, "enabled": 1 });
    assert_eq!(recalc_expect(&items_b, "promo_5", Some(&rule)), (5.0, 55.0, "promo_5".to_string()));
    let off = json!({ "threshold": 50, "discount": 5, "enabled": 0 });
    assert_eq!(recalc_expect(&items_b, "promo_5", Some(&off)), (0.0, 60.0, String::new()));
    assert!(!promotion_applies(Some(&rule), 49.99));
    assert!(!promotion_applies(Some(&json!({ "threshold": 10, "discount": 0, "enabled": 1 })), 100.0));
    assert!(!promotion_applies(Some(&json!({ "threshold": 0, "discount": 5, "enabled": 1 })), 100.0));
    assert!(!promotion_applies(None, 100.0));
    // **严格等于数字 1**：字符串 "1" 与布尔 true 都不算启用（现网 rule?.enabled === 1）
    assert!(!promotion_applies(Some(&json!({ "threshold": 10, "discount": 1, "enabled": "1" })), 10.0));
    assert!(!promotion_applies(Some(&json!({ "threshold": 10, "discount": 1, "enabled": true })), 10.0));
    assert!(!promotion_applies(Some(&json!({ "threshold": 10, "discount": 1, "enabled": 2 })), 10.0));
    assert!(promotion_applies(Some(&json!({ "threshold": 10, "discount": 1, "enabled": 1 })), 10.0));
}

#[test]
fn m_needs_fix_thresholds() {
    assert!(recalc_needs_fix(Some(25.0), 0.0, 20.0, 0.0));
    assert!(!recalc_needs_fix(Some(20.0), 0.0, 20.0, 0.0));
    // 恰好 ±0.01 的边界不钉：20.01 的二进制表示会让差落在 0.01 的哪一侧取决于最后一位，
    // JS 与 Rust 在这里**同源**（都是同一批 IEEE double 与同一个 > 比较），所以钉它只会钉住浮点表示，
    // 不是钉语义。真正要钉的是「明显漂移要修、明显一致不修」：
    assert!(recalc_needs_fix(Some(20.02), 0.0, 20.0, 0.0));
    assert!(recalc_needs_fix(Some(19.98), 0.0, 20.0, 0.0));
    assert!(!recalc_needs_fix(Some(20.0), 0.0, 20.0, 0.0));
    assert!(recalc_needs_fix(None, 0.0, 20.0, 0.0));
    assert!(recalc_needs_fix(Some(55.0), 0.0, 55.0, 5.0));
    assert!(!recalc_needs_fix(Some(55.0), 5.0, 55.0, 5.0));
}

#[test]
fn m_stored_promotion_id_normalises_to_string_only() {
    assert_eq!(stored_promotion_id(Some(&json!("p1"))), "p1");
    assert_eq!(stored_promotion_id(Some(&json!(5))), "");
    assert_eq!(stored_promotion_id(Some(&json!(null))), "");
    assert_eq!(stored_promotion_id(None), "");
}
