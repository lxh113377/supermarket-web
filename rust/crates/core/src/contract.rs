//! 响应封套的判定规则（HTTP 状态、Content-Type、trace 追加顺序）。
//!
//! 现网 `apiResponse` 的判据只有一条：`result.code === 0` 即成功（HTTP 200），
//! 否则按 `errorCode` 查表给状态码。这条规则在 Rust 侧必须写成**同一个函数**，
//! 因为它是「客户端拿到的 status」的唯一来源，网关里任何一处手写 `if` 都会漂移。

use crate::errors::{http_status_of, retry_after_seconds};
use serde_json::Value;

/// `Content-Type` 与现网一致：不带 charset（CF Pages 的 `Response` 就是这么发的，
/// 带了 charset 会改变字节长度，也会让已有契约测试的对账文本变样）。
pub const JSON_CONTENT_TYPE: &str = "application/json";

/// 成功载荷的唯一判据。
pub fn is_success(result: &Value) -> bool {
    result.get("code").and_then(|c| c.as_i64()) == Some(0)
}

/// 由载荷决定 HTTP 状态：成功 200，失败按 `errorCode` 查表（未登记 → 500）。
pub fn status_of(result: &Value) -> u16 {
    if is_success(result) {
        return 200;
    }
    let code = result.get("errorCode").and_then(|c| c.as_str());
    http_status_of(code)
}

/// 429 才追加 `Retry-After` —— 与现网 `apiResponse` 的条件分支一致
/// （其它状态上带这个头会让客户端误判「稍后重试就有救」）。
pub fn retry_after_header(result: &Value, status: u16) -> Option<String> {
    if status != 429 {
        return None;
    }
    // 注意：现网是 `if (!ok && status === 429) headers['Retry-After'] = retryAfterSeconds(...)`，
    // 而 `retryAfterSeconds` 对 undefined/NaN 会回落成 "1" —— 所以这里**总是**有值，
    // 不是「有就带上、没有就算了」（缺这个头会让前端自己猜等多久）。
    Some(retry_after_seconds(result.get("retryAfterMs").and_then(|v| v.as_f64())).to_string())
}

/// 追加 trace 字段，位置与现网一致（**在对象最后**）。
///
/// 为什么强调顺序：现网是 `{ ...result, trace: safe }`，字段在末尾；
/// 契约测试若按文本对账，字段顺序就是可观察量。Rust 侧用 `preserve_order`
/// 的 serde_json，插入顺序即输出顺序 —— 于是这里必须「先克隆原对象、再插 trace」，
/// 绝不能先插 trace 再合并原对象。
pub fn with_trace(result: Value, trace: Option<&str>) -> Value {
    let Some(trace) = trace.filter(|t| !t.is_empty()) else {
        return result;
    };
    match result {
        Value::Object(mut map) => {
            map.insert("trace".to_string(), Value::String(trace.to_string()));
            Value::Object(map)
        }
        // 现网 withTrace 对非对象原样返回（`typeof result !== 'object'` 分支），
        // 这里保持同一行为：不该为了「都能塞 trace」把一个标量包装成对象。
        other => other,
    }
}
