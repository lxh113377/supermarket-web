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

/// orders.js:533 —— 订单分页（三处派生标记与现网模板串**逐字一致**，判据据此比对；运行时 replace 注入）。
pub const SQL_ORDERS_PAGE: &str = r#"SELECT o._id, o.roomNumber, o.items, o.totalAmount, o.status, o.createdAt, o.wechat, o.remark, o.updatedAt, COALESCE(d.discountAmount, 0) AS discountAmount, COALESCE(d.promotionId, '') AS promotionId FROM orders o LEFT JOIN order_discounts d ON d.orderId = o._id ${whereClause} ORDER BY ${orderByCol} ${since ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?"#;
/// orders.js:546 —— 单订单详情（`o.*` + LEFT JOIN 的两列）。
pub const SQL_ORDER_BY_ID: &str = r#"SELECT o.*, COALESCE(d.discountAmount, 0) AS discountAmount, COALESCE(d.promotionId, '') AS promotionId FROM orders o LEFT JOIN order_discounts d ON d.orderId = o._id WHERE o._id = ?"#;

// ── 写动作（第 14 轮起）────────────────────────────────────────────
/// reviews.js:57 —— 删除一条评价（单语句；没有库存/订单那种多语句的中间态风险）。
pub const SQL_DELETE_REVIEW: &str = r#"DELETE FROM reviews WHERE _id = ?"#;

/// stats.js:207 —— 看板用的订单快照（上限 5000，按 createdAt 倒序；聚合全在 JS/Rust 侧做）。
pub const SQL_STATS_ORDERS: &str = r#"SELECT _id, roomNumber, items, totalAmount, status, createdAt FROM orders ORDER BY createdAt DESC LIMIT 5000"#;
/// stats.js:212 —— 近 14 天评价（窗口边界仍由聚合函数按 UTC+8 重算）。
pub const SQL_STATS_REVIEWS: &str = r#"SELECT createdAt FROM reviews WHERE createdAt >= ?"#;
/// stats.js:216 —— 商品成本面（上限 1000）。
pub const SQL_STATS_PRODUCTS: &str = r#"SELECT _id, name, spec, costPrice FROM products LIMIT 1000"#;

/// orders.js:134 —— 促销档位定义（按 threshold 升序；无分页、无 WHERE）。
pub const SQL_PROMOTIONS: &str = r#"SELECT _id, name, threshold, discount, enabled, updatedAt FROM promotions ORDER BY threshold ASC"#;
/// orders.js:138 —— 每档命中统计（无 WHERE、无占位符；缺表时现网把整段 catch 掉 ⇒ 全零命中）。
pub const SQL_PROMOTION_HITS: &str = r#"SELECT promotionId, COUNT(*) AS orders, COALESCE(SUM(discountAmount), 0) AS totalDiscount FROM order_discounts GROUP BY promotionId"#;

/// orders.js:369 —— 超时 pending 单（按 createdAt 升序，上限 200）。
pub const SQL_STALE_ORDERS: &str = r#"SELECT _id, roomNumber, totalAmount, items, paymentScreenshot, createdAt FROM orders WHERE status = 'pending' AND createdAt < ? ORDER BY createdAt ASC LIMIT 200"#;
/// orders.js:378 —— 相关商品库存（IN 的占位符个数由 pending 单的商品集合决定，标记与现网逐字一致）。
pub const SQL_STALE_PRODUCTS: &str = r#"SELECT _id, name, stock FROM products WHERE _id IN (${productIds.map(() => '?').join(',')})"#;

/// 三个派生标记（现网模板串里的原样文本；集中放这里，避免多处手写走样）。
const MARK_WHERE: &str = "${whereClause}";
const MARK_ORDER_COL: &str = "${orderByCol}";
const MARK_DIR: &str = "${since ? 'ASC' : 'DESC'}";
const MARK_STALE_IN: &str = "${productIds.map(() => '?').join(',')}";

/// 审计表的写入语句（security.js:113 逐字）。
pub const SQL_AUDIT_INSERT: &str =
    r#"INSERT INTO security_events (ts, ip, action, result, keyFingerprint, detail) VALUES (?, ?, ?, ?, ?, ?)"#;

/// stock.js:112 —— 流水主查询（LEFT JOIN products 取 productName）。
///
/// 这里**保留现网模板串里的 ${clause} 标记**（不是提前拼好再抄一份）：
/// 判据 sql_matches_js_source 要拿它去 JS 源码里逐字对；而运行时用 replace 注入 clause。
pub const SQL_MOVEMENTS_MAIN: &str = r#"SELECT m.id, m.productId, m.delta, m.kind, m.refType, m.refId, m.actor, m.note, m.voided, m.voidedAt, m.createdAt, p.name AS productName FROM stock_movements m LEFT JOIN products p ON p._id = m.productId ${clause} ORDER BY m.createdAt DESC, m.id DESC LIMIT ? OFFSET ?"#;
/// stock.js:118 —— 计数查询：与主查询**同一 clause、同一 params**（由 core::stock_query 保证）。
pub const SQL_MOVEMENTS_COUNT: &str = r#"SELECT COUNT(*) AS c FROM stock_movements m ${clause}"#;

/// 事件时间线的 limit 常量（events.js:16-17）。
pub const EVENT_LIMIT_DEFAULT: i64 = 50;
pub const EVENT_LIMIT_MAX: i64 = 100;

/// 在册的管理端原生动作（第 6 轮 getProducts；第 7 轮 4 个单表只读；第 8~9 轮 getStockMovements）。
pub const ADMIN_NATIVE_ACTIONS: [&str; 13] = [
    "getProducts",
    "getAllReviews",
    "getSubmissions",
    "getSubmissionImages",
    "getEventLog",
    "getStockMovements",
    "getOrders",
    "getOrder",
    "verifyKey",
    "stalePendingReport",
    "getPromotions",
    "getDashboardStats",
    "deleteReview",
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
    // 把结果接住再统一做写动作后处理（现网 backend.js:196-206 的顺序：**先失效、后审计**）。
    // 另一条纪律：**多语句写动作不许走「失败即回落透传」** —— 第一条语句已生效时回落会让上游重放；
    // 目前只有单语句写（deleteReview），所以 `.ok()?` 回落是安全的；下一批 createOrder 必须改成显式错误。
    let result = match action {
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
        "getStockMovements" => {
            // 现网 stock.js:101 的 queryMovements：**两条查询**（主查询 + COUNT）共用同一 clause/params。
            // clause/params/limit/offset 由 core::stock_query 一次构造 ⇒ 「两条参数不一致」在类型上不可能。
            let q = match supermarket_core::stock_query::movement_query(payload) {
                Ok(q) => q,
                // invalid_kind：core 直接给出现网同形的失败封套
                Err(fail) => return Some(fail),
            };
            // 注意：这里不能用 format!(...) —— 它会把 {clause} 当占位符解析（第一版就栽在这）。
            // 直接用一个普通字符串字面量做替换目标即可。
            let marker = "${clause}";
            let main_sql = SQL_MOVEMENTS_MAIN.replace(marker, &q.clause);
            let count_sql = SQL_MOVEMENTS_COUNT.replace(marker, &q.clause);
            // 主查询的绑定 = WHERE 参数 + limit + offset（顺序与现网 [..., limit, offset] 一致）
            let mut main_params = q.params.clone();
            main_params.push(json!(q.limit));
            main_params.push(json!(q.offset));
            let items = d1.query_rows(&main_sql, &main_params).await.ok()?;
            let count_rows = d1.query_rows(&count_sql, &q.params).await.ok()?;
            let total = count_rows
                .first()
                .and_then(|r| r.get("c"))
                .map(number_from_value)
                .unwrap_or(0.0);
            // 现网 Number(total?.c || 0)：取不出数就落 0
            let total_v = if total.is_finite() { json!(total as i64) } else { json!(0) };
            Some(json!({
                "code": 0,
                "data": { "items": items, "total": total_v, "limit": q.limit, "offset": q.offset },
            }))
        }
        "getOrders" => {
            // 现网 orders.js:524：分页归一 + **四处派生同源**（WHERE / ORDER BY 列 / 方向 / 参数前缀），
            // 四处都由 core::orders_query 一次构造 —— 手写四遍最易犯的错是「WHERE 用 since 但排序没用」，
            // 那会让增量游标永远推不动（列表却看起来有数据）。
            let q = supermarket_core::orders_query::orders_query(payload);
            let sql = SQL_ORDERS_PAGE
                .replace(MARK_WHERE, q.where_clause)
                .replace(MARK_ORDER_COL, q.order_by_col)
                .replace(MARK_DIR, q.dir);
            let mut params = q.params_prefix.clone();
            params.push(json!(q.fetch));
            params.push(json!(q.offset));
            let rows = d1.query_rows(&sql, &params).await.ok()?;
            let (visible, has_more) = supermarket_core::orders_query::visible_rows(rows, q.page_size);
            let data: Vec<Value> = visible
                .iter()
                .map(supermarket_core::orders_query::order_row_to_json)
                .collect();
            Some(json!({
                "code": 0,
                "data": data,
                "hasMore": has_more,
                "page": q.page,
                "pageSize": q.page_size,
            }))
        }
        "getOrder" => {
            // 现网 backend.js:129 是内联包装：result = { code:0, data: await getOrderById(DB, payload.orderId) }。
            // getOrderById 查不到 ⇒ 返回 null ⇒ 响应 **{code:0, data:null}**（不是 404；那两码只用于别的动作）。
            let order_id = match payload.and_then(|p| p.get("orderId")) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::Bool(b)) => b.to_string(),
                // undefined/null/对象：现网会把该值直接绑进 SQL，行为仓内无测试 ⇒ 不猜，回落透传
                _ => return None,
            };
            let rows = d1.query_rows(SQL_ORDER_BY_ID, &[json!(order_id)]).await.ok()?;
            match rows.first() {
                None => Some(json!({ "code": 0, "data": Value::Null })),
                Some(row) => Some(json!({
                    "code": 0,
                    "data": supermarket_core::orders_query::order_detail_row_to_json(row),
                })),
            }
        }
        "verifyKey" => {
            // 现网 backend.js:109：result = { code: 0, role }（角色由鉴权阶段解析出来）。
            // 走到这里说明鉴权已通过 ⇒ role 必为 Some；None 只可能是逻辑错，落回透传。
            let role_str = match role {
                Some(supermarket_core::auth::Role::Admin) => "admin",
                Some(supermarket_core::auth::Role::Readonly) => "readonly",
                None => return None,
            };
            Some(json!({ "code": 0, "role": role_str }))
        }
        "stalePendingReport" => {
            // 现网 orders.js:363：minutes 钳 [1, 7天] → cutoff = now - minutes*60000（ISO）
            //   → 查 pending 单（createdAt 升序，上限 200）→ 空则**早退**（连商品查询都不做）
            //   → 否则按商品集合查库存（IN 占位符个数动态）→ 组装 orders + stockReserved。
            let minutes = supermarket_core::stale::stale_minutes(payload);
            // 同一个 now 贯穿 cutoff 与 ageMinutes（现网也是同一个 Date.now() 语义）
            let now_ms = crate::api::now_ms();
            let cutoff = supermarket_core::stale::iso_from_ms(now_ms - minutes * 60_000);
            let rows = d1.query_rows(SQL_STALE_ORDERS, &[json!(cutoff)]).await.ok()?;
            if rows.is_empty() {
                return Some(json!({
                    "code": 0,
                    "data": supermarket_core::stale::stale_report(&[], &[], now_ms, minutes),
                }));
            }
            let ids = supermarket_core::stale::stale_product_ids(&rows);
            if ids.is_empty() {
                // 现网会拼出 IN () 这种非法 SQL（只有「有单但 items 全空」才可达）。
                // 这里**不猜它会不会报错**：直接回落透传，让上游照旧处理。
                return None;
            }
            let placeholders = vec!["?"; ids.len()].join(",");
            let sql = SQL_STALE_PRODUCTS.replace(MARK_STALE_IN, &placeholders);
            let params: Vec<Value> = ids.iter().map(|id| json!(id)).collect();
            let prods = d1.query_rows(&sql, &params).await.ok()?;
            Some(json!({
                "code": 0,
                "data": supermarket_core::stale::stale_report(&rows, &prods, now_ms, minutes),
            }))
        }
        "getPromotions" => {
            // 现网 orders.js:131 是**防御式**的：外层 try 把任何异常（含缺 promotions 表）吞成
            // "{code:0,data:[]}"（**成功**信封，不是失败码）；hits 查询单独 try，失败 ⇒ 全零命中。
            // 所以这里是「镜像现网语义」而不是我惯用的「失败就回落透传」—— 现网的契约就是这个形状。
            let tiers = match d1.query_rows(SQL_PROMOTIONS, &[]).await {
                Ok(rows) => rows,
                Err(_) => return Some(json!({ "code": 0, "data": [] })),
            };
            let hits = d1.query_rows(SQL_PROMOTION_HITS, &[]).await.unwrap_or_default();
            Some(json!({
                "code": 0,
                "data": supermarket_core::api_shapes::promotion_tiers_to_json(&tiers, &hits),
            }))
        }
        "getDashboardStats" => {
            // 现网 backend.js:174-184：KV 缓存（键 cache:dashboard:stats:<rangeDays>，TTL 60s）包着这个动作；
            // 边缘侧的对应物是同一套微缓存（在 api.rs 把本动作加进 cacheable 面，TTL 取 cfg.api_cache_ttl_ms）。
            // 非整数的 rangeDays：现网会在 new Array(7.5) 抛 RangeError ⇒ 500；不猜，回落透传。
            let Some(range_days) = supermarket_core::stats::stats_range_days(payload) else {
                return None;
            };
            let now_ms = crate::api::now_ms();
            let order_rows = d1.query_rows(SQL_STATS_ORDERS, &[]).await.ok()?;
            // 现网这里又取了一次 Date.now()（与入口的 nowMs 不同刻）：14 天前那一刻由它决定，照抄。
            let review_since =
                supermarket_core::stale::iso_from_ms(crate::api::now_ms() - 14 * 86_400_000);
            let review_rows = d1
                .query_rows(SQL_STATS_REVIEWS, &[json!(review_since)])
                .await
                .ok()?;
            let prod_rows = d1.query_rows(SQL_STATS_PRODUCTS, &[]).await.ok()?;
            let products: Vec<Value> = prod_rows
                .iter()
                .map(|p| {
                    let cost = match p.get("costPrice") {
                        None | Some(Value::Null) => Value::Null,
                        Some(v) => {
                            let n = match v {
                                Value::Number(n) => n.as_f64().unwrap_or(0.0),
                                Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
                                Value::Bool(b) => if *b { 1.0 } else { 0.0 },
                                _ => 0.0,
                            };
                            if n.is_finite() { json!(n) } else { Value::Null }
                        }
                    };
                    json!({
                        "_id": p.get("_id").cloned().unwrap_or(Value::Null),
                        "name": p.get("name").cloned().unwrap_or(Value::Null),
                        "spec": p.get("spec").and_then(|v| v.as_str()).unwrap_or(""),
                        "costPrice": cost,
                    })
                })
                .collect();
            Some(json!({
                "code": 0,
                "data": supermarket_core::stats::dashboard_data(
                    &order_rows,
                    &review_rows,
                    &products,
                    range_days,
                    now_ms,
                ),
            }))
        }
        "deleteReview" => {
            // 现网 reviews.js:55：const { reviewId } = payload; if (!reviewId) return fail(...)（真值判定）
            let raw = payload.and_then(|p| p.get("reviewId"));
            let truthy = match raw {
                Some(Value::String(s)) => !s.is_empty(),
                Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
                Some(Value::Bool(b)) => *b,
                _ => false,
            };
            if !truthy {
                // **不能提前 return**：现网是把 fail 封套交给统一的写后处理（因此失败也会审计）。
                // 第一版写成 early return，判据当场抓到「缺 reviewId 时语句条数 0、期望 1」。
                Some(supermarket_core::errors::fail(
                    "missing_review_id",
                    "缺少 reviewId",
                    Default::default(),
                ))
            } else {
                let id = match raw {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Number(n)) => n.to_string(),
                    Some(Value::Bool(b)) => b.to_string(),
                    _ => return None,
                };
                // 现网 deleteReview 不看影响行数（删不存在的 id 也回 code 0）
                let _affected = d1.query(SQL_DELETE_REVIEW, &[json!(id)]).await.ok()?;
                Some(json!({ "code": 0 }))
            }
        }
        _ => None,
    };

    // ④ 写动作后处理（现网 backend.js:196-206 同义顺序）
    if let Some(value) = &result {
        let ok = supermarket_core::contract::is_success(value);
        if ok && supermarket_core::auth::is_dashboard_write_action(action) {
            // 看板/aiAdvice 同层失效：现网 invalidateDashboard 删 KV 的 9 个区间键；
            // 边缘侧的微缓存键里带动作名 ⇒ 按动作名清理即可（语义等价：写后不再命中旧快照）。
            let mut guard = app.cache.lock().await;
            guard.retain(|k, _| !k.contains(":getDashboardStats:"));
        }
        if supermarket_core::auth::is_admin_write_action(action) {
            // 现网：写动作**无论成败**都审计（result = ok / fail）
            audit(app, action, if ok { "ok" } else { "fail" }, admin_key, ip).await;
        }
    }
    result
}

/// 把 D1 回的值当数字读（COUNT(*) 可能是数字，也可能是数字字符串 —— 现网走 Number(x)）。
fn number_from_value(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    }
}
