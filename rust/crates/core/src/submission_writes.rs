//! 提交域写动作的纯计算层（现网 functions/lib/actions/submissions.js:99/107）。
//!
//! 两个动作都很小，但有一处**必须逐字照抄**：updateSubmissionStatus **没有状态白名单** ——
//! 它只做 `status || 完成态` 的假值兜底，任何字符串都会写进去（与订单状态机的严格迁移表形成对照）。
//! 抄成白名单不是"更安全"，而是**行为不同**（会拒掉现网本来接受的调用）。

use serde_json::Value;

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
