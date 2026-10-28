use serde_json::json;
use supermarket_core::ai_rules::{rule_assistant_reply, sanitize};

#[test]
fn n_rule_assistant_reply_matches_the_source_verbatim() {
    // 5 条 FAQ 各命中一次（关键词来自现网 RULE_FAQ 的 match 数组）
    assert_eq!(rule_assistant_reply("你们营业时间"), "本店营业时间 08:00 - 22:00，周末照常营业。");
    assert_eq!(
        rule_assistant_reply("满六元才起送吗"),
        "本店有起送门槛：商品总价 ¥6.00 起送，不满则不配送。再加一两件小零食就凑够了～"
    );
    assert_eq!(
        rule_assistant_reply("配送要多久"),
        "下单后我们会尽快安排配送，一般在当轮配送时段内送达宿舍楼下，请保持手机畅通接收取餐通知。另请注意：商品总价需满 ¥6.00 才配送。"
    );
    assert!(rule_assistant_reply("怎么付").starts_with("支持微信支付与支付宝"));
    assert!(rule_assistant_reply("少件了怎么办").starts_with("收到商品如有少件/错件"));
    // 都没命中 ⇒ 默认话术（含营业时间常量）
    assert_eq!(
        rule_assistant_reply("随便问问"),
        "可以咨询商品、营业时间（08:00 - 22:00）、配送与支付等问题。"
    );
    // 优先级：起送排在配送之前（「不满六元配送吗」这类问句要先命中起送）
    assert!(rule_assistant_reply("不满六元配送吗").contains("起送门槛"));
}

#[test]
fn n_sanitize_follows_the_source() {
    assert_eq!(sanitize(None, 200), "");
    assert_eq!(sanitize(Some(&json!(123)), 200), "");
    assert_eq!(sanitize(Some(&json!("  营业时间  ")), 200), "营业时间");
    let long = "字".repeat(300);
    assert_eq!(sanitize(Some(&json!(long)), 200).chars().count(), 200);
}
