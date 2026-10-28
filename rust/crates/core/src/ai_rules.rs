//! AI 两件的纯计算层（现网 functions/lib/dify.js 的规则兜底）。
//!
//! **为什么这一层的价值特别高**：现网没配 Dify（/_health 报 ai.configured=false 且 source=rule），
//! 所以**规则路径就是线上路径** —— 它可以用现网做逐字节对账（本会话里少见的「AI 也能对账」）。
//! 而 Dify 一旦配上，走的是外部 HTTP；那时规则层仍要在**熔断/超时**后兜底，所以它永远不是死代码。

use serde_json::Value;

/// 现网 dify.js:170 的营业时间常量。
pub const RULE_HOURS: &str = "08:00 - 22:00";
/// 现网 dify.js:171 的 FAQ（match 关键词数组与答案**逐字**照抄；顺序即匹配优先级）。
pub const RULE_FAQ: [(&[&str], &str); 5] = [
    (
        &["营业", "开门", "时间", "关门"],
        "本店营业时间 08:00 - 22:00，周末照常营业。",
    ),
    (
        &["起送", "起订", "不满", "最低", "门槛", "六元", "6元"],
        "本店有起送门槛：商品总价 ¥6.00 起送，不满则不配送。再加一两件小零食就凑够了～",
    ),
    (
        &["配送", "送到", "多久", "送货"],
        "下单后我们会尽快安排配送，一般在当轮配送时段内送达宿舍楼下，请保持手机畅通接收取餐通知。另请注意：商品总价需满 ¥6.00 才配送。",
    ),
    (
        &["支付", "付款", "微信", "支付宝", "怎么付"],
        "支持微信支付与支付宝，下单页选择支付方式，按提示扫码或确认支付即可；付款后订单自动进入配送队列。",
    ),
    (
        &["退", "换", "错", "少", "漏"],
        "收到商品如有少件/错件/质量问题，可在订单页提交售后或联系客服，我们会尽快处理退换。",
    ),
];

/// 现网 dify.js:183 的 ruleAssistantReply。**注意调用方不传 products** ⇒ products 为空 ⇒ 只回答案本体，
/// 不带「当前热销」那一行（suggest 的 filter(Boolean) 会把空串滤掉）。
pub fn rule_assistant_reply(question: &str) -> String {
    for (kws, answer) in RULE_FAQ {
        if kws.iter().any(|kw| question.contains(kw)) {
            return answer.to_string();
        }
    }
    format!("可以咨询商品、营业时间（{RULE_HOURS}）、配送与支付等问题。")
}

/// 现网 dify.js:32 的 sanitize(text, maxLen)：非字符串 ⇒ 空串；trim；超长按 UTF-16 码元截断。
pub fn sanitize(text: Option<&Value>, max_len: usize) -> String {
    let Some(Value::String(s)) = text else {
        return String::new();
    };
    let t = s.trim();
    crate::order_intake::slice_utf16(t, max_len)
}
