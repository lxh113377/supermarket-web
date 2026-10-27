//! 库存流水分页的**查询构造**（纯函数）：现网 `functions/lib/stock.js:101` 的 `queryMovements` 同义实现。
//!
//! ## 为什么把「拼 WHERE + 参数」抽成类型，而不是在边缘里手写两遍
//!
//! 现网这个动作要跑**两条查询**：
//!   主查询（带 LEFT JOIN + ORDER BY + LIMIT/OFFSET）与 COUNT 查询，**共用同一个 clause 与同一批 WHERE 参数**。
//! 手工写两遍最容易犯的错不是「写不出来」，而是「两条的参数不一致」——
//! 那会让 `total` 与 `items` 说的是两套筛选条件（列表 3 条、总数 17 条），而功能测试通常抓不到。
//!
//! 所以这里返回一个 `MovementQuery`：clause / params / limit / offset 一次性构造，
//! 两条 SQL 都从**同一个值**取 —— 「参数不一致」在类型上就不可能发生。
//!
//! ## 与 JS 的逐条对齐（别顺手优化）
//!
//! · `if (payload.productId)` 是**真值判定**：空串/0/NaN 都算「没给」；有值则 `String(...)` 绑定；
//! · `if (payload.kind)`：有值先做白名单校验，**非法 ⇒ fail(invalid_kind)**，消息里带清洗后的 kind 与在册清单；
//! · `limit`：`Math.min(100, Math.max(1, Number(payload.limit) || 30))` —— 注意 `|| 30` 在 clamp **之内**，
//!   所以 `limit: 0` / `NaN` / 非数字串都落 30 再钳；负数落 1；
//! · `offset`：`Math.max(0, Math.trunc(Number(payload.offset) || 0))`；
//! · 两个条件同时给 ⇒ `WHERE a = ? AND b = ?`（顺序固定：productId 在前、kind 在后）。

use serde_json::{json, Value};

/// 在册的流水类型（stock.js:17）。
pub const MOVEMENT_KINDS: [&str; 4] = ["init", "sale", "void", "adjust"];
/// 分页上限/默认（stock.js:22-23）。
pub const MOVEMENT_PAGE_MAX: i64 = 100;
pub const MOVEMENT_PAGE_DEFAULT: i64 = 30;

/// 现网 `sanitizeTrace` 在错误消息里只用于回显；这里也做同样的白名单清洗（不掺 IP 正则那段 ——
/// 消息体不落库、不回显给无关方，且调用方在 `looks_like_ip` 命中时本就会回落透传）。
fn echo(value: &Value) -> String {
    let raw = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    crate::sanitize::sanitize_trace_whitelist(&raw)
}

/// 两条查询共用的构造结果。
#[derive(Debug, Clone, PartialEq)]
pub struct MovementQuery {
    /// 形如 `WHERE m.productId = ? AND m.kind = ?`，无条件时为空串。
    pub clause: String,
    /// WHERE 部分的参数（不含 limit/offset）。
    pub params: Vec<Value>,
    pub limit: i64,
    pub offset: i64,
}

/// 现网 `queryMovements` 的前半段：构造 clause/params/limit/offset。
///
/// 返回 Err 时就是**应当直接返回给客户端的失败封套**（invalid_kind），与现网 `fail(...)` 同形。
pub fn movement_query(payload: Option<&Value>) -> Result<MovementQuery, Value> {
    let mut where_parts: Vec<&str> = Vec::new();
    let mut params: Vec<Value> = Vec::new();

    // payload.productId：真值判定（现网 if (payload.productId)）
    if let Some(v) = payload.and_then(|p| p.get("productId")) {
        if is_truthy(v) {
            where_parts.push("m.productId = ?");
            params.push(json!(match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => String::new(),
            }));
        }
    }

    // payload.kind：真值判定 + 白名单（非法即失败）
    if let Some(v) = payload.and_then(|p| p.get("kind")) {
        if is_truthy(v) {
            let kind = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => String::new(),
            };
            if !MOVEMENT_KINDS.contains(&kind.as_str()) {
                let message = format!(
                    "kind 非法：{}（在册：{}）",
                    echo(v),
                    MOVEMENT_KINDS.join("/")
                );
                return Err(crate::errors::fail("invalid_kind", &message, Default::default()));
            }
            where_parts.push("m.kind = ?");
            params.push(json!(kind));
        }
    }

    // limit：Math.min(100, Math.max(1, Number(payload.limit) || 30))
    let raw_limit = match payload.and_then(|p| p.get("limit")) {
        None | Some(Value::Null) => 0.0,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(_) => 0.0,
    };
    let base = if raw_limit.is_finite() && raw_limit != 0.0 {
        raw_limit.trunc() as i64
    } else {
        MOVEMENT_PAGE_DEFAULT
    };
    let limit = base.clamp(1, MOVEMENT_PAGE_MAX);

    // offset：Math.max(0, Math.trunc(Number(payload.offset) || 0))
    let raw_offset = match payload.and_then(|p| p.get("offset")) {
        None | Some(Value::Null) => 0.0,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        Some(_) => 0.0,
    };
    let offset = if raw_offset.is_finite() {
        (raw_offset.trunc() as i64).max(0)
    } else {
        0
    };

    Ok(MovementQuery {
        clause: if where_parts.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_parts.join(" AND "))
        },
        params,
        limit,
        offset,
    })
}

/// JS 真值判定（用于 `if (payload.x)` 这类判断）：null/undefined/false/0/""/NaN 都为假。
fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        // 对象/数组在 JS 里是真值 —— 这里保持同义（虽然本动作不会走到）
        Value::Array(_) | Value::Object(_) => true,
    }
}
