//! /web 管理端动作的原生实现（第一批：getProducts）+ 鉴权与审计。
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

/// products.js:88 —— 管理端商品全量（SELECT *，按 order 升序，上限 1000；payload 完全忽略）。
// 用原始字符串（r#"..."#）：SQL 里有双引号标识符，转义写法既难读、也让夹具读常量时更容易失配
pub const SQL_GET_PRODUCTS: &str = r#"SELECT * FROM products ORDER BY "order" ASC LIMIT 1000"#;

/// 在册的管理端原生动作（第一批只有一个；后续按 docs/09 §4 的顺序逐个加）。
pub const ADMIN_NATIVE_ACTIONS: [&str; 1] = ["getProducts"];

/// 审计表的写入语句（security.js:113 逐字）。
pub const SQL_AUDIT_INSERT: &str =
    r#"INSERT INTO security_events (ts, ip, action, result, keyFingerprint, detail) VALUES (?, ?, ?, ?, ?, ?)"#;

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

/// 按字节截断（JS 的 String.slice 按 UTF-16 码元，短字段都是 ASCII，这里按字节等价）。
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
///
/// 本地直连时两个头都没有 ⇒ 空串（审计表 ip 列允许空；现网 getClientIp 同样返回空串）。
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
    _payload: Option<&Value>,
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
    // ③ 派发（只服务已实现的动作；未实现 ⇒ None ⇒ 透传，且**不**重复鉴权）
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
        _ => None,
    }
}
