//! 提交域写动作的纯计算层（现网 functions/lib/actions/submissions.js:99/107）。
//!
//! 两个动作都很小，但有一处**必须逐字照抄**：updateSubmissionStatus **没有状态白名单** ——
//! 它只做 `status || 完成态` 的假值兜底，任何字符串都会写进去（与订单状态机的严格迁移表形成对照）。
//! 抄成白名单不是"更安全"，而是**行为不同**（会拒掉现网本来接受的调用）。

use serde_json::{json, Value};

/// 现网 shared.js:22 的提交字段白名单（6 键）。
pub const SUBMISSION_FIELDS: [&str; 6] = [
    "serviceId",
    "serviceName",
    "categoryId",
    "categoryName",
    "formData",
    "images",
];
/// 现网 shared.js:45 —— 单次提交最多 9 个文件（与前端同值）。
pub const MAX_SUBMISSION_FILES: usize = 9;
/// 现网 submissions.js:11 —— 打印服务**内联降级**的单件上限（R2 未就绪时文件本体进 D1）。
pub const MAX_INLINE_PRINT_CHARS: usize = 700_000;
/// 现网 submissions.js:12 —— 打印服务内联合计上限。
pub const MAX_INLINE_PRINT_TOTAL_CHARS: usize = 2_000_000;

/// 现网 security.js:159 的 isSafePrintFileRef：比普通图册多接受三类文档 data URL。
pub fn is_safe_print_file_ref(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    if crate::order_intake::is_safe_image_url(s) {
        return true;
    }
    // data:application/pdf|msword|vnd.openxmlformats-officedocument.[a-z.]+ ;base64,<字母表>
    for prefix in [
        "data:application/pdf;base64,",
        "data:application/msword;base64,",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            return is_base64_body(rest);
        }
    }
    if let Some(rest) = s.strip_prefix("data:application/vnd.openxmlformats-officedocument.") {
        // 介质子类型只允许 [a-z.]，直到 ";base64," 为止
        if let Some(pos) = rest.find(";base64,") {
            let subtype = &rest[..pos];
            if !subtype.is_empty() && subtype.chars().all(|c| c.is_ascii_lowercase() || c == '.') {
                return is_base64_body(&rest[pos + ";base64,".len()..]);
            }
        }
    }
    false
}

/// base64 字母表非空（现网正则的 `[A-Za-z0-9+/=]+`）。
fn is_base64_body(body: &str) -> bool {
    !body.is_empty()
        && body
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}

/// 现网 validateSubmissionFiles：非数组 ⇒ 空表；任一项非法 ⇒ None（整组拒绝，不静默丢弃）。
pub fn validate_submission_files(v: Option<&Value>) -> Option<Vec<Value>> {
    let list = match v {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    for it in &list {
        match it {
            Value::String(s) if is_safe_print_file_ref(s) => {}
            _ => return None,
        }
    }
    Some(list)
}

/// 现网 validateImages 在提交域的用法：非数组 ⇒ 空表；任一项非法 ⇒ None。
pub fn validate_submission_images(v: Option<&Value>) -> Option<Vec<Value>> {
    crate::review_writes::validate_review_images(v)
}

/// 现网 submissions.js:53 的 formData 归一：只认 object（数组也算），逐项 key 50 字 / val 200 字 + 文本守卫。
/// 返回 None 表示文本守卫拒绝（调用方回 invalid_text）。
pub fn normalize_form_data(payload: Option<&Value>) -> Option<Value> {
    let mut out = serde_json::Map::new();
    let raw = payload.and_then(|p| p.get("formData"));
    let obj = match raw {
        Some(Value::Object(o)) => Some(o.clone()),
        Some(Value::Array(_)) => {
            // JS 的 typeof [] === "object" ⇒ 数组也走这项；entries 给出 0..n 的字符串键
            None
        }
        _ => None,
    };
    if let Some(o) = obj {
        for (k, v) in o.iter() {
            let key = crate::order_intake::slice_utf16(k, 50);
            let val = form_value_string(v);
            let val = crate::order_intake::slice_utf16(&val, 200);
            if !crate::review_writes::check_public_text(&val, 200) {
                return None;
            }
            out.insert(key, json!(val));
        }
    }
    Some(Value::Object(out))
}

/// formData 值的字符串化：String(v || 空串) —— 假值（0/false/null/空串）落空串。
fn form_value_string(v: &Value) -> String {
    let truthy = match v {
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Value::Bool(b) => *b,
        Value::Array(_) | Value::Object(_) => true,
        _ => false,
    };
    if !truthy {
        return String::new();
    }
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        Value::Bool(b) => if *b { "true".to_string() } else { String::new() },
        Value::Array(list) => list
            .iter()
            .map(|x| match x {
                Value::String(s) => s.clone(),
                Value::Number(n) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
                Value::Null => String::new(),
                _ => "[object Object]".to_string(),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
        _ => String::new(),
    }
}

/// 现网 doc 里的四个字符串字段：serviceId/serviceName 用 String(x)（已被真值守卫过），
/// categoryId/categoryName 用 String(x || 空串)；四者都 slice(0,50)。
pub fn submission_service_string(v: Option<&Value>, with_default: bool) -> String {
    let s = if with_default {
        match v {
            Some(Value::String(x)) => x.clone(),
            Some(Value::Number(n)) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
            Some(Value::Bool(b)) => if *b { "true".to_string() } else { String::new() },
            _ => String::new(),
        }
    } else {
        match v {
            Some(Value::String(x)) => x.clone(),
            Some(Value::Number(n)) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
            Some(Value::Bool(b)) => if *b { "true".to_string() } else { String::new() },
            Some(Value::Array(list)) => list
                .iter()
                .map(|x| match x {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
                    Value::Null => String::new(),
                    _ => "[object Object]".to_string(),
                })
                .collect::<Vec<_>>()
                .join(","),
            Some(Value::Object(_)) => "[object Object]".to_string(),
            _ => String::new(),
        }
    };
    crate::order_intake::slice_utf16(&s, 50)
}
/// 现网 `status || done`：假值（空串/null/false/0）落默认完成态。
pub fn normalize_submission_status(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Number(n)) => {
            let x = n.as_f64().unwrap_or(0.0);
            if x == 0.0 { "done".to_string() } else { crate::jsnum::js_number_string(x) }
        }
        Some(Value::Bool(b)) => {
            if *b { "true".to_string() } else { "done".to_string() }
        }
        _ => "done".to_string(),
    }
}
