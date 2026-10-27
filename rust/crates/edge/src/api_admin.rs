//! /web 管理端动作的原生实现（鉴权与审计 + 已登记的动作），顺序与现网一致。
//!
//! ## 与 /pub 原生面的分工
//!
//! api_native.rs 管公开读（免鉴权）；本件管管理端：**先鉴权、再只读档判定、最后才派发**。
//! 顺序是现网的顺序（backend.js:77-93），判据也按这个顺序断言 —— 例如「未知动作 + 无密钥」
//! 必须回 401 而不是 400，因为现网是先鉴权。
//!
//! ## 审计：只写两类事件，且**绝不因为审计失败而改响应**
//!
//! 现网 logSecurityEvent（security.js:110）：
//!   · 鉴权失败（且动作非公开）⇒ result = "auth_failed"，keyFingerprint = sha256(key) 前 8 hex；
//!   · action === "login" 或 ∈ ADMIN_WRITE_ACTIONS ⇒ 成功后写 "ok"/"fail"。
//! **只读拒绝（readonly_denied）不写审计**（现网在写审计之前就早退了）。本件照此实现。
//! 审计本身失败只吞掉（现网也是 logError 后继续）—— 审计不能变成拒绝服务的原因。
//!
//! ## 开关
//!
//! NATIVE_ADMIN_ACTIONS 未设 ⇒ 全关（一切都走上游透传，行为与今天逐字节相同）；
//! 设 all 或逗号分隔的动作名 ⇒ 该动作的**鉴权与派发**走原生。
//! 已实现的动作才真服务；未实现的即便鉴权通过也返回 None ⇒ 落回透传（鉴权已生效，不重复判）。

use std::sync::Arc;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::api::App;

// ── SQL（逐字抄自现网；判据 sql_matches_js_source 会去 JS 源码里验）────────────────

/// products.js:88 —— 管理端商品全量（SELECT *，按 order 升序，上限 1000；payload 完全忽略）。
pub const SQL_GET_PRODUCTS: &str = r#"SELECT * FROM products ORDER BY "order" ASC LIMIT 1000"#;

/// reviews.js:50 —— 全部评价（只读视图；**不含 images**，只回 6 列）。
pub const SQL_ALL_REVIEWS: &str = r#"SELECT _id, "user", rating, text, productOrder, createdAt FROM reviews ORDER BY createdAt DESC LIMIT 1000"#;

/// submissions.js:77 —— 提交列表（**images 本体不下发**，只给 json_array_length 算出的 imageCount）。
pub const SQL_SUBMISSIONS: &str = r#"SELECT _id, serviceId, serviceName, categoryId, categoryName, formData, status, createdAt, updatedAt, CASE WHEN json_valid(images) THEN json_array_length(images) ELSE 0 END AS imageCount FROM submissions ORDER BY createdAt DESC LIMIT 500"#;

/// submissions.js:93 —— 单条提交的原图（列表已剥离，按需再拉）。
pub const SQL_SUBMISSION_IMAGES: &str = r#"SELECT images FROM submissions WHERE _id = ? LIMIT 1"#;

/// events.js:31 —— 事件时间线（按 at 升序、同刻按 id 升序；limit 钳 [1,100]）。
pub const SQL_EVENT_TIMELINE: &str = r#"SELECT type, at, orderId, status, totalAmount, discountAmount, createdAt FROM event_log WHERE orderId = ? ORDER BY at ASC, id ASC LIMIT ?"#;

/// 审计表的写入语句（security.js:113 逐字）。
pub const SQL_AUDIT_INSERT: &str =
    r#"INSERT INTO security_events (ts, ip, action, result, keyFingerprint, detail) VALUES (?, ?, ?, ?, ?, ?)"#;

/// 事件时间线的 limit 常量（events.js:16-17）。
pub const EVENT_LIMIT_DEFAULT: i64 = 50;
pub const EVENT_LIMIT_MAX: i64 = 100;

/// 在册的管理端原生动作（第 6 轮首发 getProducts；第 7 轮批量加 4 个单表只读）。
pub const ADMIN_NATIVE_ACTIONS: [&str; 5] = [
    "getProducts",
    "getAllReviews",
    "getSubmissions",
    "getSubmissionImages",
    "getEventLog",
];

/// 开关：未设 ⇒ 全关；all 或逗号分隔的动作名（大小写无关）。
pub fn admin_native_enabled(action: &str) -> bool {
    match std::env::var("NATIVE_ADMIN_ACTIONS") {
        Ok(v) => {
            let v = v.trim();
            v.eq_ignore_ascii_case("all")
                || v.split(',').any(|s| s.trim().eq_ignore_ascii_case(action))
        }
        Err(_) => false,
    }
}

/// sha256 指纹的前 8 个十六进制字符（security.js:98-105 逐字：失败时返回空串）。
pub fn key_fingerprint(key: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.unwrap_or("").as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    hex.chars().take(8).collect()
}

/// 写一条审计（永不抛：失败只丢事件，不改响应 —— 与现网 logError 后继续一致）。
async fn audit(app: &Arc<App>, action: &str, result: &str, key: Option<&str>, ip: &str) {
    let Some(d1) = app.d1.as_ref() else { return };
    let params = vec![
        // 复用边缘既有的 ISO-8601（api.rs:516，与 JS new Date().toISOString() 同形状），不重复造
        json!(crate::api::iso_now()),
        json!(truncate(ip, 64)),
        json!(truncate(action, 64)),
        json!(truncate(result, 16)),
        json!(truncate(&key_fingerprint(key), 16)),
        // detail 现网默认空串；native 这里也留空（现网失败路径同样不填 detail）
        json!(""),
    ];
    let _ = d1.query(SQL_AUDIT_INSERT, &params).await;
}

/// 按字节截断（现网 String.slice 按 UTF-16 码元；这几个字段都是 ASCII，按字节等价）。
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// 客户端 IP（与现网 getClientIp 的口径一致：优先 CF 注入头，其次 X-Forwarded-For 首段）。
pub fn client_ip(headers: &axum::http::HeaderMap) -> String {
    for name in ["cf-connecting-ip", "x-real-ip"] {
        if let Some(v) = headers.get(name).and_then(|v| v.to_str().ok()) {
            let v = v.trim();
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }
    if let Some(v) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = v.split(',').next() {
            let first = first.trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    String::new()
}

/// 管理端原生调用。返回 None ⇒ 调用方落回透传。
pub async fn call_admin(
    app: &Arc<App>,
    action: &str,
    admin_key: Option<&str>,
    payload: Option<&Value>,
    ip: &str,
) -> Option<Value> {
    // ① 鉴权（现网顺序：先鉴权，后动作校验）
    if let Some(fail) = supermarket_core::auth::check_auth(
        action,
        admin_key,
        app.cfg.admin_key.as_deref(),
        app.cfg.admin_readonly_key.as_deref(),
    ) {
        // 鉴权失败要留痕（现网 backend.js:84-86：非公开动作才写）
        if !supermarket_core::auth::is_public_action(action) {
            audit(app, action, "auth_failed", admin_key, ip).await;
        }
        return Some(fail);
    }
    // ② 只读档：白名单默认拒（现网 backend.js:91）
    let role = supermarket_core::auth::resolve_role(
        admin_key,
        app.cfg.admin_key.as_deref(),
        app.cfg.admin_readonly_key.as_deref(),
    );
    if let Some(fail) = supermarket_core::auth::check_readonly(action, role) {
        return Some(fail);
    }
    // ③ 派发（只服务已实现的动作；未实现 ⇒ None ⇒ 透传，且不重复鉴权）
    let d1 = app.d1.as_ref()?;
    match action {
        "getProducts" => {
            let rows = d1.query_rows(SQL_GET_PRODUCTS, &[]).await.ok()?;
            let data: Vec<Value> = rows
                .iter()
                .map(supermarket_core::api_shapes::row_to_product)
                .collect();
            Some(json!({ "code": 0, "data": data }))
        }
        "getAllReviews" => {
            // 现网直接回原始行（不映射、不裁剪），照搬。
            let rows = d1.query_rows(SQL_ALL_REVIEWS, &[]).await.ok()?;
            Some(json!({ "code": 0, "data": rows }))
        }
        "getSubmissions" => {
            let rows = d1.query_rows(SQL_SUBMISSIONS, &[]).await.ok()?;
            let data: Vec<Value> = rows
                .iter()
                .map(supermarket_core::api_shapes::submission_row_to_json)
                .collect();
            Some(json!({ "code": 0, "data": data }))
        }
        "getSubmissionImages" => {
            // 现网 submissions.js:92：payload 与其 submissionId 都是**真值判定**（空串/0 都算缺）。
            let id = match payload.and_then(|p| p.get("submissionId")) {
                Some(Value::String(s)) if !s.is_empty() => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::Bool(b)) => b.to_string(),
                // 对象/数组：JS 是 String(obj) 的怪形态，不在原生路径里猜 —— 回落透传
                Some(_) => return None,
                None => {
                    return Some(supermarket_core::errors::fail(
                        "missing_submission_id",
                        "缺少 submissionId",
                        Default::default(),
                    ))
                }
            };
            let rows = d1
                .query_rows(SQL_SUBMISSION_IMAGES, &[json!(id)])
                .await
                .ok()?;
            match rows.first() {
                None => Some(supermarket_core::errors::fail(
                    "submission_not_found",
                    "提交不存在",
                    Default::default(),
                )),
                Some(row) => Some(json!({
                    "code": 0,
                    "data": { "images": supermarket_core::api_shapes::jparse(row.get("images"), json!([])) },
                })),
            }
        }
        "getEventLog" => {
            // 现网 events.js:21：orderId 先经 sanitizeTrace(String(...))，洗成空 ⇒ missing_order_id。
            // 本实现只做「白名单 + 截断」那一段；**一旦输入像 IP 就回落透传**
            //（现网那一段背后是 IP 正则脱敏，Rust 侧没有 regex 依赖、也不打算猜正则语义）。
            let raw_id = match payload.and_then(|p| p.get("orderId")) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                _ => String::new(),
            };
            if supermarket_core::sanitize::looks_like_ip(&raw_id) {
                return None;
            }
            let order_id = supermarket_core::sanitize::sanitize_trace_whitelist(&raw_id);
            if order_id.is_empty() {
                return Some(supermarket_core::errors::fail(
                    "missing_order_id",
                    "缺少 orderId",
                    Default::default(),
                ));
            }
            // limit：Math.trunc(Number(payload.limit ?? 50))；非有限数 ⇒ 默认；再钳 [1,100]
            let n = match payload.and_then(|p| p.get("limit")) {
                None | Some(Value::Null) => Some(EVENT_LIMIT_DEFAULT as f64),
                Some(Value::Number(x)) => x.as_f64(),
                Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
                Some(_) => None,
            };
            let limit = match n.filter(|x| x.is_finite()) {
                Some(x) => (x.trunc() as i64).clamp(1, EVENT_LIMIT_MAX),
                None => EVENT_LIMIT_DEFAULT,
            };
            let rows = d1
                .query_rows(SQL_EVENT_TIMELINE, &[json!(order_id), json!(limit)])
                .await
                .ok()?;
            Some(json!({ "code": 0, "data": { "orderId": order_id, "events": rows } }))
        }
        _ => None,
    }
}
