//! AI 两件的纯计算层（现网 functions/lib/dify.js 的规则兜底）。
//!
//! **为什么这一层的价值特别高**：现网没配 Dify（/_health 报 ai.configured=false 且 source=rule），
//! 所以**规则路径就是线上路径** —— 它可以用现网做逐字节对账（本会话里少见的「AI 也能对账」）。
//! 而 Dify 一旦配上，走的是外部 HTTP；那时规则层仍要在**熔断/超时**后兜底，所以它永远不是死代码。

use serde_json::{json, Value};

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

/// 现网 dify.js:201 的 ruleAdvice（管理端规则版经营建议，基于近 30 天订单与评价的真实统计）。
///
/// 两处逐字照抄的细节：
/// · 热销键是 name + (spec 为真值才加括号) ⇒ 与看板 topRevenue 同族；
/// · 步骤编号**写死在字符串里**（top3 为空时第 3 行仍叫 "2."）—— 这不是笔误，是现网行为。
pub fn rule_advice(orders30: &[Value], reviews: &[Value]) -> String {
    let mut revenue30 = 0f64;
    for o in orders30 {
        revenue30 += crate::jsnum::js_number_of(o.get("totalAmount"));
    }
    let order30 = orders30.len();
    // 热销累计（键序即首次出现序；排序**稳定**，同量保持首次出现序）
    let mut item_qty: Vec<(String, f64)> = Vec::new();
    for o in orders30 {
        let items = crate::api_shapes::jparse(o.get("items"), json!([]));
        if let Value::Array(list) = items {
            for it in list {
                let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let spec = it.get("spec").and_then(|v| v.as_str()).unwrap_or("");
                let key = if spec.is_empty() {
                    name.to_string()
                } else {
                    format!("{name}({spec})")
                };
                let q = crate::jsnum::js_number_of(it.get("quantity"));
                match item_qty.iter_mut().find(|(k, _)| k == &key) {
                    Some((_, v)) => *v += q,
                    None => item_qty.push((key, q)),
                }
            }
        }
    }
    item_qty.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top3: Vec<String> = item_qty.iter().take(3).map(|(k, _)| k.clone()).collect();
    let low = reviews
        .iter()
        .filter(|r| crate::jsnum::js_number_of(r.get("rating")) <= 2.0)
        .count();
    if order30 == 0 {
        return "暂无近 30 天订单数据，待顾客下单后生成经营建议。".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!(
        "📊 近 30 天：营收 ¥{}，共 {order30} 单。",
        crate::js_round(revenue30) as i64
    ));
    if !top3.is_empty() {
        lines.push(format!(
            "1. 优先备货热销：{}，按平日 1.2 倍预备。",
            top3.join("、")
        ));
    }
    lines.push("2. 易损鲜蔬/乳品按需采购，避免隔夜损耗。".to_string());
    if low > 0 {
        lines.push(format!(
            "3. 近 30 天有 {low} 条低分评价，建议复盘对应商品与服务话术。"
        ));
    }
    lines.push("配置 Dify 后可生成更精细的备货/定价建议。".to_string());
    lines.join("\n")
}

/// 现网 dify.js:32 的 sanitize(text, maxLen)：非字符串 ⇒ 空串；trim；超长按 UTF-16 码元截断。
pub fn sanitize(text: Option<&Value>, max_len: usize) -> String {
    let Some(Value::String(s)) = text else {
        return String::new();
    };
    let t = s.trim();
    crate::order_intake::slice_utf16(t, max_len)
}
