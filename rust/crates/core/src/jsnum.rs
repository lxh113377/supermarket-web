//! JS 数字 → JSON 的**统一格式化**（原生化里最容易各处写歪的一件小事）。
//!
//! 两条规则来自 JSON.stringify 的真实行为，抄错过一次就会在端到端判据里逐字节暴露：
//!
//! 1. **整数值不带小数点**：`JSON.stringify(50)` 是 `50`，不是 `50.0` ——
//!    serde_json 默认会给 `50.0`，所以整数必须显式走整数分支；
//! 2. **非有限值写成 `null`**：`JSON.stringify(NaN)` / `(Infinity)` 都是 `null`，
//!    而不是报错、也不是字符串 "NaN"。
//!
//! 这个模块单独存在是因为它被三个地方用（库存写、看板聚合、行映射），
//! 而它太小又不值得放进任何一个业务模块里当"别人的私货"。

use serde_json::{json, Value};

/// JS 数字 → JSON 值。
pub fn js_number(x: f64) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x.fract() == 0.0 && x.abs() < 9.0e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

/// JS 数字 → 字符串（与 `String(number)` 同形）：整数不带小数点，NaN/Infinity 有字面量。
///
/// 与 `js_number` 分开是因为用途不同：这个是给**消息模板**用的（例如「现 5，本次 -10」）。
pub fn js_number_string(x: f64) -> String {
    if !x.is_finite() {
        return if x.is_nan() {
            "NaN".to_string()
        } else if x > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if x.fract() == 0.0 && x.abs() < 9.0e15 {
        return format!("{}", x as i64);
    }
    let mut s = format!("{x}");
    if s.ends_with(".0") {
        s.truncate(s.len() - 2);
    }
    s
}
/// JS 的 `Number(x) || 0`：取不出数就是 0（null / 空串 / 坏字符串都落 0）。
///
/// 这是原生化里出现频率最高的一行语义 —— 它决定了「库里是 null」到底算 0 还是算错；
/// 放在这里统一实现，免得每个动作各写一份（写歪了只在端到端判据上暴露）。
pub fn js_number_of(v: Option<&Value>) -> f64 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    if n.is_finite() {
        n
    } else {
        0.0
    }
}
