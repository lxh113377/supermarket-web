//! 库存域写动作的纯计算部分：现网 functions/lib/actions/stock.js 与 functions/lib/stock.js 的同义实现。
//!
//! 这个动作的坑不在 SQL（三条都在边缘层），而在**中间态**：products.stock 这一列是 SQLite 动态类型，
//! 库里真出现过 null / 字符串 / 小数，而现网的判定对每一种都给出了不同结果：
//!
//! | stock 读出来的形态 | Number 后 | 结局 |
//! |---|---|---|
//! | 无行 | —— | product_not_found |
//! | 负数（-1 不限售，-5 也算） | 负数 | stock_untracked |
//! | null / 空串 | 0 | **静默当 0 记账**（最隐蔽的一条） |
//! | "12" | 12 | 正常按整数走 |
//! | 12.5 | 12.5 | UPDATE 仍写库，但**不落流水**、recorded=false、delta=0 |
//! | "abc" | NaN | 两道小于 0 的检查都过 ⇒ UPDATE 写 NaN，不落流水，响应 before/after 序列化成 null |
//!
//! 最后两行不是 bug 复刻，是**既有行为**：deltaForStockChange 要求两端都是整数才记账（账要对得上），
//! 而 SELECT 侧的校验并不拦小数。照抄并写进用例，是为了让「哪天有人想改」时看得见现状。

use serde_json::{json, Map, Value};

/// 现网 stock.js:32 的 deltaForStockChange：返回 None 表示「不记账」。
pub fn delta_for_stock_change(before: f64, after: f64) -> Option<i64> {
    let is_int = |x: f64| x.is_finite() && x.fract() == 0.0;
    if !is_int(after) || !is_int(before) {
        return None;
    }
    if before < 0.0 && after < 0.0 {
        return None;
    }
    if before < 0.0 {
        return if after > 0.0 { Some(after as i64) } else { None };
    }
    if after < 0.0 {
        return if before > 0.0 { Some(-(before as i64)) } else { None };
    }
    if after == before {
        return None;
    }
    Some((after - before) as i64)
}

/// 现网 stock.js:25 的 productId 归一：String(payload.productId || 空串)。
///
/// 顺序很关键：**先做假值判定**（0 / 空串 / null / false / NaN 都是假值 ⇒ 落空串，走 missing_product_id），
/// 再做 String()。空数组与空对象是**真值**：String([]) 是空串、String({}) 是 "[object Object]"。
pub fn adjust_product_id(payload: Option<&Value>) -> String {
    let raw = payload.and_then(|p| p.get("productId"));
    let truthy = match raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
        _ => false,
    };
    if !truthy {
        return String::new();
    }
    match raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => js_number_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Bool(b) ) => {
            if *b {
                "true".to_string()
            } else {
                String::new()
            }
        }
        Some(Value::Array(list)) => list
            .iter()
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => js_number_string(n.as_f64().unwrap_or(0.0)),
                Value::Null => String::new(),
                _ => "[object Object]".to_string(),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_string(),
        _ => String::new(),
    }
}

/// JS 数字转字符串（委托 jsnum：消息模板与 JSON 输出必须用同一套格式化规则）。
pub fn js_number_string(x: f64) -> String {
    crate::jsnum::js_number_string(x)
}

/// 现网 stock.js:26-29 的 delta 归一：Math.trunc(Number(delta)) 后再判有限与非零。
///
/// 返回 Err(消息) 表示 invalid_delta（两种消息：非零整数 / 过大）。
pub fn adjust_delta(payload: Option<&Value>) -> Result<i64, &'static str> {
    let n = match payload.and_then(|p| p.get("delta")) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Array(list)) => match list.first() {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
            Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
            _ => f64::NAN,
        },
        _ => f64::NAN,
    };
    if !n.is_finite() {
        return Err("delta 必须是非零整数");
    }
    let delta = n.trunc();
    if delta == 0.0 {
        return Err("delta 必须是非零整数");
    }
    if delta.abs() > 100_000.0 {
        // 逐字照抄现网消息（含竖线与 ≤）：判据会比对整条消息，差一个字符也算不一致
        return Err(
            "单次调整数量过大（|delta| ≤ 100000）",
        );
    }
    Ok(delta as i64)
}

/// 现网 stock.js:37 的 note 归一：String(payload.note || 空串).slice(0, 200)（按字符截断）。
pub fn adjust_note(payload: Option<&Value>) -> String {
    let raw = match payload.and_then(|p| p.get("note")) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => js_number_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Bool(b)) => {
            if *b {
                "true".to_string()
            } else {
                String::new()
            }
        }
        _ => String::new(),
    };
    raw.chars().take(200).collect()
}

/// 成功响应里的 data（键序照抄 stock.js:43）：productId, before, after, delta, recorded。
///
/// ledger 为 None ⇔ 「不记账」：此时 delta 回 0、recorded 为 false（而 UPDATE 已经生效）。
pub fn adjust_data(product_id: &str, before: f64, after: f64, ledger: Option<i64>) -> Value {
    let mut out = Map::new();
    out.insert("productId".into(), json!(product_id));
    out.insert("before".into(), crate::jsnum::js_number(before));
    out.insert("after".into(), crate::jsnum::js_number(after));
    out.insert("delta".into(), json!(ledger.unwrap_or(0)));
    out.insert("recorded".into(), Value::Bool(ledger.is_some()));
    Value::Object(out)
}

/// 现网 stock_insufficient 的消息模板：调整后库存为负（现 前值，本次 delta 值）。
pub fn insufficient_message(before: f64, delta: i64) -> String {
    format!(
        "调整后库存为负（现 {}，本次 {}）",
        js_number_string(before),
        delta
    )
}
