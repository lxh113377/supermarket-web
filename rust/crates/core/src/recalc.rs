//! 订单重算（纯计算）：现网 functions/lib/actions/orders.js:450 的 recalculateOrders 逐行口径。
//!
//! 这个动作**会改总额**（把漂移单的 totalAmount 修回「按当前促销规则应为的值」），所以它是最需要
//! 「期望值可手算」的一个：抄错不是报错，而是**把对的钱改成错的**。
//!
//! 逐行口径（现网 orders.js:462-490）：
//! · subtotal = round2(Σ Number(price) * Number(quantity))（坏值按 0，与现网 Number(..)||0 同）；
//! · 只有「存单上的 promotionId 是非空字符串」才去查规则表（N+1）；规则表缺行/规则关/门槛不足/优惠<=0
//!   ⇒ 优惠归零且 **promotionId 落空串**（不是保留旧的）；
//! · 命中规则 ⇒ discount = min(dc, subtotal)、total = subtotal - discount、promotionId 保留；
//! · 触发修正的条件：totalAmount 为 null，或 |存值 - 期望| > 0.01，或 |存优惠 - 期望优惠| > 0.01。

use serde_json::Value;

use crate::js_round;

/// 逐行小计：round2(Σ price*quantity)。
pub fn recalc_subtotal(items: &[Value]) -> f64 {
    let mut total = 0f64;
    for it in items {
        let price = crate::jsnum::js_number_of(it.get("price"));
        let qty = crate::jsnum::js_number_of(it.get("quantity"));
        total += price * qty;
    }
    js_round(total * 100.0) / 100.0
}

/// 存单上的 promotionId 归一：非字符串 ⇒ 空串（现网 typeof 判定）。
pub fn stored_promotion_id(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

/// 规则行是否命中：enabled 严格等于 1，且 threshold > 0、discount > 0、subtotal >= threshold。
///
/// **enabled 是严格等于数字 1**（现网 orders.js:476 的 `rule?.enabled === 1`）：
/// 字符串 "1" 与布尔 true **都不算启用** —— 我第一版按 Number 语义实现、并把这个错断言进了用例，
/// 读现网源码时逐字对照才发现（这正是「读源」而不是「读二手规格」的价值）。
pub fn promotion_applies(rule: Option<&Value>, subtotal: f64) -> bool {
    let Some(r) = rule else {
        return false;
    };
    let enabled = matches!(r.get("enabled"), Some(Value::Number(n)) if n.as_f64() == Some(1.0));
    let th = crate::jsnum::js_number_of(r.get("threshold"));
    let dc = crate::jsnum::js_number_of(r.get("discount"));
    enabled && th > 0.0 && dc > 0.0 && subtotal >= th
}

/// 逐行期望：(discount, total, promotionId)。
///
/// rule 只在「存单 promotionId 非空」时才有意义；调用方负责按 pid 查。规则不命中 ⇒ 优惠归零且 pid 落空串。
pub fn recalc_expect(items: &[Value], stored_pid: &str, rule: Option<&Value>) -> (f64, f64, String) {
    let subtotal = recalc_subtotal(items);
    if stored_pid.is_empty() || !promotion_applies(rule, subtotal) {
        return (0.0, subtotal, String::new());
    }
    let dc = crate::jsnum::js_number_of(rule.and_then(|r| r.get("discount")));
    let discount = if dc > subtotal { subtotal } else { dc };
    // 现网 expectTotal = Math.round((subtotal - expectDiscount) * 100) / 100（多一次 round2）
    let total = js_round((subtotal - discount) * 100.0) / 100.0;
    (discount, total, stored_pid.to_string())
}

/// 现网 :486 的漂移判定：totalAmount 为 null，或总额偏差 > 0.01，或优惠偏差 > 0.01。
pub fn recalc_needs_fix(
    stored_total: Option<f64>,
    stored_discount: f64,
    expect_total: f64,
    expect_discount: f64,
) -> bool {
    let Some(st) = stored_total else {
        return true;
    };
    if (st - expect_total).abs() > 0.01 {
        return true;
    }
    (stored_discount - expect_discount).abs() > 0.01
}
