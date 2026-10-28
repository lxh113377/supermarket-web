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
use crate::d1::D1Client;

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

// ── 写动作（第 14 轮起）
/// stock.js:126 —— 读当前库存行（写前必须先读，判 stock_untracked / stock_insufficient）。
pub const SQL_STOCK_ROW: &str = r#"SELECT _id, name, stock FROM products WHERE _id = ?"#;
/// stock.js:137 —— 改快照（**用 meta.changes 判商品是否存在**：0 变更 ⇒ product_not_found）。
pub const SQL_STOCK_UPDATE: &str = r#"UPDATE products SET stock = ?, updatedAt = ? WHERE _id = ?"#;
/// stock.js:80 —— 记一行库存流水（kind=adjust / refType=manual / actor=admin）。
pub const SQL_MOVEMENT_INSERT: &str = r#"INSERT INTO stock_movements (productId, delta, kind, refType, refId, actor, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#;
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
/// 现网 security.js:77 的 RATE_LOGIN：60 秒 5 次（登录桶另立，与写桶/公开桶互不影响）。
pub const LOGIN_RATE_WINDOW_MS: i64 = 60_000;
pub const LOGIN_RATE_MAX: f64 = 5.0;

pub const ADMIN_NATIVE_ACTIONS: [&str; 28] = [
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
    "adjustStock",
    "createProduct",
    "updateProduct",
    "deleteProduct",
    "batchUpdateProducts",
    "batchDeleteProducts",
    "updateOrderStatus",
    "deleteOrder",
    "recalculateOrders",
    "addReview",
    "seedReviews",
    "updateSubmissionStatus",
    "deleteSubmission",
    "createSubmission",
    "login",
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
/// 库存手工调整（现网 actions/stock.js:24-44 的同义实现）。
///
/// **为什么抽成独立函数**：这个动作有四个失败出口，而写动作的失败也必须落审计
/// （现网 backend.js:204：写动作无论成败都审计）。第一版把它写在 match 分支里、用 return 提前退出，
/// 于是失败路径全部绕过了「失效 → 审计」后处理 —— 判据当场报「语句条数 1，期望 2」。
/// 抽出来之后，函数内部的 return 只结束自己，外层后处理照常执行。
async fn adjust_stock(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    let pid = supermarket_core::stock_ops::adjust_product_id(payload);
    if pid.is_empty() {
        return Some(supermarket_core::errors::fail(
            "missing_product_id",
            "缺少 productId",
            Default::default(),
        ));
    }
    let delta = match supermarket_core::stock_ops::adjust_delta(payload) {
        Ok(d) => d,
        Err(msg) => {
            return Some(supermarket_core::errors::fail(
                "invalid_delta",
                msg,
                Default::default(),
            ))
        }
    };
    // 读当前行：读失败 ⇒ 显式错误（写动作不回落透传，避免上游重放）
    let row = match d1.query_rows(SQL_STOCK_ROW, &[json!(pid)]).await {
        Ok(rows) => rows.into_iter().next(),
        Err(_) => {
            return Some(supermarket_core::errors::fail(
                "internal_error",
                "服务暂时不可用，请稍后重试",
                Default::default(),
            ))
        }
    };
    let Some(row) = row else {
        return Some(supermarket_core::errors::fail(
            "product_not_found",
            "商品不存在",
            Default::default(),
        ));
    };
    let before = supermarket_core::jsnum::js_number_of(row.get("stock"));
    if before < 0.0 {
        return Some(supermarket_core::errors::fail(
            "stock_untracked",
            "该商品按不限售管理（stock=-1），没有账面可记；请先在商品编辑里填入实际库存",
            Default::default(),
        ));
    }
    let after = before + delta as f64;
    if after < 0.0 {
        let msg = supermarket_core::stock_ops::insufficient_message(before, delta);
        return Some(supermarket_core::errors::fail(
            "stock_insufficient",
            &msg,
            Default::default(),
        ));
    }
    // UPDATE：必须看 meta.changes（0 变更 ⇒ 商品不存在），所以用 query 而不是 query_rows
    let ts1 = crate::api::iso_now();
    let upd = match d1
        .query(
            SQL_STOCK_UPDATE,
            &[
                supermarket_core::jsnum::js_number(after),
                json!(ts1),
                json!(pid),
            ],
        )
        .await
    {
        Ok(v) => v,
        Err(_) => {
            return Some(supermarket_core::errors::fail(
                "internal_error",
                "服务暂时不可用，请稍后重试",
                Default::default(),
            ))
        }
    };
    let changes = upd
        .get(0)
        .and_then(|r| r.get("meta"))
        .and_then(|m| m.get("changes"))
        .and_then(|c| c.as_i64())
        .unwrap_or(0);
    if changes == 0 {
        return Some(supermarket_core::errors::fail(
            "product_not_found",
            "商品不存在",
            Default::default(),
        ));
    }
    // 流水：只有 deltaForStockChange 非 null 才记（小数/NaN 场景不记账，但 UPDATE 已生效）
    let ledger = supermarket_core::stock_ops::delta_for_stock_change(before, after);
    if let Some(led) = ledger {
        let note = supermarket_core::stock_ops::adjust_note(payload);
        let ts2 = crate::api::iso_now();
        let ins = d1
            .query(
                SQL_MOVEMENT_INSERT,
                &[
                    json!(pid),
                    json!(led),
                    json!("adjust"),
                    json!("manual"),
                    json!(""),
                    json!("admin"),
                    json!(note),
                    json!(ts2),
                ],
            )
            .await;
        if ins.is_err() {
            return Some(supermarket_core::errors::fail(
                "internal_error",
                "服务暂时不可用，请稍后重试",
                Default::default(),
            ));
        }
    }
    Some(json!({
        "code": 0,
        "data": supermarket_core::stock_ops::adjust_data(&pid, before, after, ledger),
    }))
}
/// 现网 products.js:274 —— 删除商品（单语句；删不存在的 id 也走成功路径）。
pub const SQL_DELETE_PRODUCT: &str = r#"DELETE FROM products WHERE _id = ?"#;
/// 现网 products.js:163 —— 改库存前的预读（绝对值入口要留痕，必须先读后改）。
pub const SQL_PRODUCT_STOCK_READ: &str = r#"SELECT stock FROM products WHERE _id = ?"#;
/// 现网 products.js:227 —— 批量更新前一次性把「改前库存」拿全（1 条 IN，避免逐件 SELECT）。
pub const SQL_BATCH_STOCK_IN: &str = r#"SELECT _id, stock FROM products WHERE _id IN (__PHV__)"#;
/// 现网 products.js:263 —— 批量删除前查存在集合（deleted 以它为口径，不看驱动的 meta.changes）。
pub const SQL_BATCH_EXIST_IN: &str = r#"SELECT _id FROM products WHERE _id IN (__PHV__)"#;
/// 现网 products.js:265 —— 批量删除本体。
pub const SQL_BATCH_DELETE_IN: &str = r#"DELETE FROM products WHERE _id IN (__PHV__)"#;
/// 商品域共有：`stock` 有现值且为有限非负时，才需要记一条流水（现网 normalizeMovement 拒 delta=0）。
const PRODUCT_MOVEMENT_SQL: &str = SQL_MOVEMENT_INSERT;

/// 现网 products.js:92 的 createProduct（返回完整响应封套）。
///
/// 两步写：products 插行，紧接一条期初流水（kind=init）。stock=0 时**不发**流水 ——
/// 现网 normalizeMovement 把 delta=0 当非法（记 0 行只会污染对账），所以那条会静默消失。
async fn create_product(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    use supermarket_core::product_writes as pw;
    let fail = |code: &str, msg: &str| supermarket_core::errors::fail(code, msg, Default::default());
    let mut data: Vec<(String, Value)> = pw::pick_product_fields(payload);
    // enabled 是**无条件写入**的键（现网 data.enabled = data.enabled !== false）
    // enabled 是**无条件写入**的键，但位置讲究：入参带了它 ⇒ 保持白名单里的原位；
    // 入参没带 ⇒ 追加到末尾（正是 JS 里 data.enabled = ... 对已存在/不存在的键分别的行为）。
    // 第一版一律挪到末尾，判据当场抓到「data 键序不符」。
    let enabled_val = payload.and_then(|p| p.get("enabled"));
    let flag = pw::enabled_flag(enabled_val);
    match data.iter().position(|(k, _)| k == "enabled") {
        Some(pos) => data[pos].1 = Value::Bool(flag),
        None => data.push(("enabled".to_string(), Value::Bool(flag))),
    }
    // stock / specOptions 只在入参带了该键时才归一（现网 if (key in data)）
    if let Some(pos) = data.iter().position(|(k, _)| k == "stock") {
        let v = data[pos].1.clone();
        data[pos] = ("stock".to_string(), pw::sanitize_stock(Some(&v)));
    }
    if let Some(pos) = data.iter().position(|(k, _)| k == "specOptions") {
        let v = data[pos].1.clone();
        data[pos] = ("specOptions".to_string(), pw::sanitize_spec_options(Some(&v)));
    }
    // 图片白名单（主图 + 图册）；图册先判条数、再判每项
    if let Some(v) = payload.and_then(|p| p.get("image")) {
        let truthy = match v {
            Value::String(s) => !s.is_empty(),
            Value::Bool(b) => *b,
            Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
            Value::Array(a) => !a.is_empty(),
            Value::Object(_) => true,
            _ => false,
        };
        if truthy {
            let ok = v.as_str().map(supermarket_core::order_intake::is_safe_image_url).unwrap_or(false);
            if !ok {
                return Some(fail("invalid_image", "商品主图格式无效"));
            }
        }
    }
    if let Some(v) = payload.and_then(|p| p.get("images")) {
        if let Value::Array(list) = v {
            if list.len() > pw::MAX_PRODUCT_IMAGES {
                return Some(fail("too_many_images", "商品图册最多 9 张"));
            }
            match pw::validate_images(v) {
                None => return Some(fail("invalid_image", "商品图片格式无效")),
                Some(clean) => {
                    if let Some(pos) = data.iter().position(|(k, _)| k == "images") {
                        data[pos] = ("images".to_string(), Value::Array(clean));
                    }
                }
            }
        }
    }
    // 组装 doc：_id + 数据键（白名单序）+ 两个时间戳
    // 现网 db.js:32 的 genId 同一套形状（前缀不同）；订单号生成器在 pub 模块里，这里按前缀改写
    let id = crate::api_pub_order::gen_order_id().replacen("o_", "p_", 1);
    let c1 = crate::api::iso_now();
    let c2 = crate::api::iso_now();
    let mut cols: Vec<String> = vec!["_id".to_string()];
    let mut params: Vec<Value> = vec![json!(id)];
    for (k, v) in &data {
        cols.push(k.clone());
        params.push(pw::bind_value(v));
    }
    cols.push("createdAt".to_string());
    params.push(json!(c1));
    cols.push("updatedAt".to_string());
    params.push(json!(c2));
    let sql = pw::insert_sql("products", &cols);
    if d1.query(&sql, &params).await.is_err() {
        return Some(fail("internal_error", "服务暂时不可用，请稍后重试"));
    }
    // 期初流水：仅当 stock 是「有限非负且不为 0」时发（delta=0 会被现网判非法）
    let stock_val = data
        .iter()
        .find(|(k, _)| k == "stock")
        .map(|(_, v)| supermarket_core::jsnum::js_number_of(Some(v)));
    if let Some(s) = stock_val {
        if s >= 0.0 && s != 0.0 {
            let m = crate::api::iso_now();
            let _ = d1
                .query(
                    PRODUCT_MOVEMENT_SQL,
                    &[
                        json!(id),
                        json!(s as i64),
                        json!("init"),
                        json!("ledger"),
                        json!(""),
                        json!("admin"),
                        json!("新品建档期初"),
                        json!(m),
                    ],
                )
                .await;
        }
    }
    // 响应 data = doc（键序照抄；**不经** rowToProduct）
    let mut doc = serde_json::Map::new();
    for (i, c) in cols.iter().enumerate() {
        doc.insert(c.clone(), params[i].clone());
    }
    doc.insert("_id".to_string(), json!(id));
    Some(json!({ "code": 0, "data": Value::Object(doc) }))
}
/// 现网 products.js:155 的 applyProductUpdate（updateProduct 的核心）。
async fn update_product(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    // 单条入口：改前库存由自己 SELECT
    update_product_with(d1, payload, None).await
}

/// 现网 applyProductUpdate 的实现主体；`stock_before` 由**批量入口**预读后传入
/// （现网也是这么省的：批量先一条 IN 拿全，再逐件应用，避免 n 倍 SELECT）。
async fn update_product_with(
    d1: &D1Client,
    payload: Option<&Value>,
    stock_before: Option<f64>,
) -> Option<Value> {
    use supermarket_core::product_writes as pw;
    let fail = |code: &str, msg: &str| supermarket_core::errors::fail(code, msg, Default::default());
    let pid_val = payload.and_then(|p| p.get("productId"));
    let truthy = match pid_val {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    if !truthy {
        return Some(fail("missing_product_id", "缺少 productId"));
    }
    let pid = match pid_val {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        _ => String::new(),
    };
    let mut data: Vec<(String, Value)> = pw::pick_product_fields(payload);
    if let Some(pos) = data.iter().position(|(k, _)| k == "stock") {
        let v = data[pos].1.clone();
        data[pos] = ("stock".to_string(), pw::sanitize_stock(Some(&v)));
    }
    if let Some(pos) = data.iter().position(|(k, _)| k == "specOptions") {
        let v = data[pos].1.clone();
        data[pos] = ("specOptions".to_string(), pw::sanitize_spec_options(Some(&v)));
    }
    // enabled 只在**入参显式带了**该键时才写（防部分更新把缺货商品静默重上架）
    if let Some(v) = payload.and_then(|p| p.get("enabled")) {
        let flag = pw::enabled_flag(Some(v));
        data.retain(|(k, _)| k != "enabled");
        data.push(("enabled".to_string(), Value::Bool(flag)));
    }
    // 改库存的绝对值入口必须先读后改（改完再读 delta 恒为 0，账就记空了）
    let stock_present = data.iter().any(|(k, _)| k == "stock");
    let mut before: Option<f64> = stock_before;
    if stock_present && before.is_none() {
        // 只有单条入口才会走到这里（批量入口已预读并传值）
        let rows = d1.query_rows(SQL_PRODUCT_STOCK_READ, &[json!(pid)]).await.ok()?;
        before = rows
            .first()
            .map(|r| supermarket_core::jsnum::js_number_of(r.get("stock")));
    }
    if let Some(v) = payload.and_then(|p| p.get("image")) {
        let truthy_img = match v {
            Value::String(s) => !s.is_empty(),
            Value::Bool(b) => *b,
            Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
            Value::Array(a) => !a.is_empty(),
            Value::Object(_) => true,
            _ => false,
        };
        if truthy_img {
            let ok = v.as_str().map(supermarket_core::order_intake::is_safe_image_url).unwrap_or(false);
            if !ok {
                return Some(fail("invalid_image", "商品主图格式无效"));
            }
        }
    }
    if let Some(Value::Array(list)) = payload.and_then(|p| p.get("images")) {
        if list.len() > pw::MAX_PRODUCT_IMAGES {
            return Some(fail("too_many_images", "商品图册最多 9 张"));
        }
        let v = Value::Array(list.clone());
        match pw::validate_images(&v) {
            None => return Some(fail("invalid_image", "商品图片格式无效")),
            Some(clean) => {
                if let Some(pos) = data.iter().position(|(k, _)| k == "images") {
                    data[pos] = ("images".to_string(), Value::Array(clean));
                }
            }
        }
    }
    // updatedAt 无条件追加（现网先赋值再判空，所以「无更新字段」那条实际不可达）
    let ts = crate::api::iso_now();
    data.push(("updatedAt".to_string(), json!(ts)));
    let cols: Vec<String> = data.iter().map(|(k, _)| k.clone()).collect();
    let sql = format!("UPDATE products SET {} WHERE _id = ?", pw::update_set_sql(&cols));
    let mut params: Vec<Value> = data.iter().map(|(_, v)| pw::bind_value(v)).collect();
    params.push(json!(pid));
    let res = match d1.query(&sql, &params).await {
        Ok(v) => v,
        Err(_) => return Some(fail("internal_error", "服务暂时不可用，请稍后重试")),
    };
    if crate::api_pub_order::changes_of(&res) == 0 {
        return Some(fail("product_not_found", "商品不存在"));
    }
    if stock_present {
        let new_stock = data
            .iter()
            .find(|(k, _)| k == "stock")
            .map(|(_, v)| supermarket_core::jsnum::js_number_of(Some(v)))
            .unwrap_or(f64::NAN);
        let b = before.unwrap_or(f64::NAN);
        if let Some(delta) = supermarket_core::stock_ops::delta_for_stock_change(b, new_stock) {
            let m = crate::api::iso_now();
            let _ = d1
                .query(
                    PRODUCT_MOVEMENT_SQL,
                    &[
                        json!(pid),
                        json!(delta),
                        json!("adjust"),
                        json!("manual"),
                        json!(""),
                        json!("admin"),
                        json!("后台商品编辑改数"),
                        json!(m),
                    ],
                )
                .await;
        }
    }
    Some(json!({ "code": 0 }))
}

/// 现网 products.js:271 的 deleteProduct（单语句；删不存在的 id 也回 code 0）。
async fn delete_product(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    let pid_val = payload.and_then(|p| p.get("productId"));
    let truthy = match pid_val {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    if !truthy {
        return Some(supermarket_core::errors::fail(
            "missing_product_id",
            "缺少 productId",
            Default::default(),
        ));
    }
    let pid = match pid_val {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        _ => String::new(),
    };
    let _ = d1.query(SQL_DELETE_PRODUCT, &[json!(pid)]).await.ok()?;
    Some(json!({ "code": 0 }))
}
/// 现网 products.js:218 的 batchUpdateProducts（恒回 code 0；逐件失败进 failed 清单）。
async fn batch_update_products(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    use supermarket_core::product_writes as pw;
    let items = match payload.and_then(|p| p.get("items")) {
        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
        _ => return Some(supermarket_core::errors::fail("missing_items", "缺少 items", Default::default())),
    };
    if items.len() > pw::BATCH_UPDATE_MAX {
        let msg = format!("单次批量最多 {} 个商品，请分批提交", pw::BATCH_UPDATE_MAX);
        return Some(supermarket_core::errors::fail("batch_too_large", &msg, Default::default()));
    }
    // 复核点出的一处分支：现网在预读处就会做 `"stock" in it.updates`，
    // updates 若是字符串/数字 ⇒ 抛 TypeError ⇒ handleAdmin 兜成 internal_error 且**零写入**（整批拒）。
    // 本实现照抄这个「先整批验形状、再动手」的顺序（否则我会默默只写 updatedAt，语义不同）。
    for it in &items {
        if let Some(u) = it.get("updates") {
            if !u.is_object() {
                return Some(supermarket_core::errors::fail(
                    "internal_error",
                    "服务暂时不可用，请稍后重试",
                    Default::default(),
                ));
            }
        }
    }
    // 预读：只对「updates 里带 stock」的项取改前值（1 条 IN）
    let stock_ids: Vec<Value> = items
        .iter()
        .filter(|it| {
            it.get("productId").and_then(|v| v.as_str()).is_some()
                && it.get("updates").map(|u| u.get("stock").is_some()).unwrap_or(false)
        })
        .filter_map(|it| it.get("productId").cloned())
        .collect();
    let mut before_map: Vec<(String, f64)> = Vec::new();
    if !stock_ids.is_empty() {
        let ph = vec!["?"; stock_ids.len()].join(",");
        let sql = SQL_BATCH_STOCK_IN.replace("__PHV__", &ph);
        let rows = match d1.query_rows(&sql, &stock_ids).await {
            Ok(r) => r,
            Err(_) => return Some(supermarket_core::errors::fail("internal_error", "服务暂时不可用，请稍后重试", Default::default())),
        };
        for r in rows {
            let id = r.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            before_map.push((id, supermarket_core::jsnum::js_number_of(r.get("stock"))));
        }
    }
    let mut failed: Vec<Value> = Vec::new();
    let mut updated: i64 = 0;
    for it in &items {
        let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
        if pid.is_empty() {
            failed.push(json!({ "id": "?", "message": "缺少 productId" }));
            continue;
        }
        let before = before_map
            .iter()
            .find(|(k, _)| k == pid)
            .map(|(_, v)| *v);
        let updates = it.get("updates").cloned().unwrap_or(json!({}));
        let mut merged = match updates {
            Value::Object(m) => m,
            _ => serde_json::Map::new(),
        };
        merged.insert("productId".to_string(), json!(pid));
        let payload_one = Value::Object(merged);
        match update_product_with(d1, Some(&payload_one), before).await {
            Some(v) if supermarket_core::contract::is_success(&v) => updated += 1,
            Some(v) => {
                let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("");
                // 回显走 sanitizeTrace（这一支恰恰是「没命中主键」的那批，入参不受服务端约束）
                failed.push(json!({ "id": supermarket_core::sanitize::sanitize_trace_whitelist(pid), "message": msg }));
            }
            None => {
                failed.push(json!({ "id": supermarket_core::sanitize::sanitize_trace_whitelist(pid), "message": "服务暂时不可用，请稍后重试" }));
            }
        }
    }
    Some(json!({ "code": 0, "data": { "updated": updated, "failed": failed, "total": items.len() } }))
}

/// 现网 products.js:250 的 batchDeleteProducts（恒回 code 0；deleted 以**存在集合**为准）。
async fn batch_delete_products(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    use supermarket_core::product_writes as pw;
    let ids_raw = match payload.and_then(|p| p.get("productIds")) {
        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
        _ => {
            return Some(supermarket_core::errors::fail("missing_product_ids", "缺少 productIds", Default::default()))
        }
    };
    if ids_raw.len() > pw::BATCH_DELETE_MAX {
        let msg = format!("单次批量最多 {} 个商品", pw::BATCH_DELETE_MAX);
        return Some(supermarket_core::errors::fail("batch_too_large", &msg, Default::default()));
    }
    let ids = pw::dedupe_product_ids(&ids_raw);
    if ids.is_empty() {
        return Some(supermarket_core::errors::fail("missing_product_ids", "缺少 productIds", Default::default()));
    }
    let ph = vec!["?"; ids.len()].join(",");
    let params: Vec<Value> = ids.iter().map(|s| json!(s)).collect();
    let exist_sql = SQL_BATCH_EXIST_IN.replace("__PHV__", &ph);
    let exist_rows = match d1.query_rows(&exist_sql, &params).await {
        Ok(r) => r,
        Err(_) => return Some(supermarket_core::errors::fail("internal_error", "服务暂时不可用，请稍后重试", Default::default())),
    };
    let exist: Vec<String> = exist_rows
        .iter()
        .filter_map(|r| r.get("_id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    let del_sql = SQL_BATCH_DELETE_IN.replace("__PHV__", &ph);
    if d1.query(&del_sql, &params).await.is_err() {
        return Some(supermarket_core::errors::fail("internal_error", "服务暂时不可用，请稍后重试", Default::default()));
    }
    // deleted 用存在集合的大小（现网明确不看 meta.changes：各环境口径不一，甚至可能为 null）
    let deleted = exist.len() as i64;
    let failed: Vec<Value> = ids_raw
        .iter()
        .filter(|v| match v {
            Value::String(s) => !exist.contains(s),
            _ => true,
        })
        .map(|v| {
            let raw_id = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
                _ => String::new(),
            };
            json!({ "id": supermarket_core::sanitize::sanitize_trace_whitelist(&raw_id), "message": "商品不存在" })
        })
        .collect();
    Some(json!({ "code": 0, "data": { "deleted": deleted, "failed": failed, "total": ids_raw.len() } }))
}
/// 现网 orders.js:420 —— 读订单当前状态与条目（乐观锁要比对读到的状态）。
pub const SQL_ORDER_STATE_READ: &str = r#"SELECT status, items FROM orders WHERE _id = ?"#;
/// 现网 orders.js:428 —— **乐观锁**：把读到的状态写进 WHERE，0 变更即有人抢先改过。
pub const SQL_ORDER_STATUS_UPDATE: &str = r#"UPDATE orders SET status = ?, updatedAt = ? WHERE _id = ? AND status = ?"#;
/// 现网 orders.js:451 —— 删除订单（先读后删；是否回补看状态）。
pub const SQL_ORDER_DELETE: &str = r#"DELETE FROM orders WHERE _id = ?"#;

/// 现网 orders.js reserveStock：护栏式扣减 + 流水；任一 0 变更 ⇒ 回补前面已扣的并报库存不足。
async fn reserve_stock(d1: &D1Client, items: &[Value], order_id: &str, actor: &str) -> Option<Value> {
    if items.is_empty() {
        return None;
    }
    let ts = crate::api::iso_now();
    let mut deducted: Vec<Value> = Vec::new();
    let mut bad: Option<(usize, Value)> = None;
    for (i, it) in items.iter().enumerate() {
        let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
        let qty = supermarket_core::jsnum::js_number_of(it.get("quantity"));
        let res = d1
            .query(
                crate::api_pub_order::SQL_ORDER_DEDUCT,
                &[
                    supermarket_core::jsnum::js_number(qty),
                    json!(ts),
                    json!(pid),
                    supermarket_core::jsnum::js_number(qty),
                ],
            )
            .await;
        let changes = match res {
            Ok(v) => crate::api_pub_order::changes_of(&v),
            Err(_) => 0,
        };
        if changes == 0 {
            bad = Some((i, it.clone()));
            break;
        }
        deducted.push(it.clone());
    }
    if let Some((idx, it)) = bad {
        if idx > 0 {
            crate::api_pub_order::release_stock(d1, &deducted, order_id, actor).await;
        }
        let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let msg = format!("库存不足: {name}");
        return Some(supermarket_core::errors::fail("stock_insufficient", &msg, Default::default()));
    }
    let ts2 = crate::api::iso_now();
    for it in items {
        let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
        let qty = supermarket_core::jsnum::js_number_of(it.get("quantity")).trunc() as i64;
        let _ = d1
            .query(
                crate::api_pub_order::SQL_ORDER_MOVEMENT_SALE,
                &[
                    json!(pid),
                    json!(-qty),
                    json!("sale"),
                    json!("order"),
                    json!(order_id),
                    json!(actor),
                    json!(""),
                    json!(ts2),
                ],
            )
            .await;
    }
    None
}

/// 现网 orders.js:410 的 updateOrderStatus（含乐观锁与两条库存路径）。
async fn update_order_status(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    use supermarket_core::order_state as st;
    let fail = |code: &str, msg: &str| supermarket_core::errors::fail(code, msg, Default::default());
    let order_raw = payload.and_then(|p| p.get("orderId"));
    let status_raw = payload.and_then(|p| p.get("status"));
    let order_truthy = match order_raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    let Some(status) = status_raw.and_then(|v| v.as_str()) else {
        return Some(fail("invalid_params", "参数无效"));
    };
    if !order_truthy || !st::status_known(status) {
        return Some(fail("invalid_params", "参数无效"));
    }
    let order_id = match order_raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        _ => String::new(),
    };
    let rows = match d1.query_rows(SQL_ORDER_STATE_READ, &[json!(order_id)]).await {
        Ok(r) => r,
        Err(_) => return Some(fail("internal_error", "服务暂时不可用，请稍后重试")),
    };
    let Some(cur) = rows.into_iter().next() else {
        return Some(fail("order_not_found", "订单不存在"));
    };
    let cur_status = cur.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if !st::transition_allowed(&cur_status, status) {
        let msg = st::invalid_transition_message(&cur_status, status);
        return Some(fail("invalid_transition", &msg));
    }
    let items = match supermarket_core::api_shapes::jparse(cur.get("items"), json!([])) {
        Value::Array(a) => a,
        _ => Vec::new(),
    };
    // 取消 = 释放本单占用的有限库存
    if status == "cancelled" && !items.is_empty() {
        crate::api_pub_order::release_stock(d1, &items, &order_id, "admin").await;
    }
    // 误取消恢复（cancelled→pending）= 重新占用；库存被占走则拒绝恢复，状态不动
    let restoring = cur_status == "cancelled" && status == "pending" && !items.is_empty();
    if restoring {
        if let Some(env) = reserve_stock(d1, &items, &order_id, "admin").await {
            return Some(env);
        }
    }
    // 乐观锁：读到的状态进 WHERE；0 变更 ⇒ 有人抢先改过
    let ts = crate::api::iso_now();
    let res = match d1
        .query(
            SQL_ORDER_STATUS_UPDATE,
            &[json!(status), json!(ts), json!(order_id), json!(cur_status)],
        )
        .await
    {
        Ok(v) => v,
        Err(_) => return Some(fail("internal_error", "服务暂时不可用，请稍后重试")),
    };
    if crate::api_pub_order::changes_of(&res) == 0 {
        // 抢占失败：本请求刚为「误取消恢复」扣下的库存必须回补，否则凭空少一份可售库存
        if restoring {
            crate::api_pub_order::release_stock(d1, &items, &order_id, "system").await;
        }
        return Some(fail("concurrent_update", "订单已被他人更新，请刷新后重试"));
    }
    Some(json!({ "code": 0 }))
}

/// 现网 orders.js:447 的 deleteOrder（先读后删；进行中单要回补库存）。
async fn delete_order(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    let order_raw = payload.and_then(|p| p.get("orderId"));
    let truthy = match order_raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    if !truthy {
        return Some(supermarket_core::errors::fail("missing_order_id", "缺少 orderId", Default::default()));
    }
    let order_id = match order_raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        _ => String::new(),
    };
    let cur = d1
        .query_rows(SQL_ORDER_STATE_READ, &[json!(order_id)])
        .await
        .ok()
        .and_then(|r| r.into_iter().next());
    let _ = d1.query(SQL_ORDER_DELETE, &[json!(order_id)]).await.ok()?;
    if let Some(row) = cur {
        let status = row.get("status").and_then(|v| v.as_str()).unwrap_or("");
        if supermarket_core::order_state::delete_needs_release(status) {
            let items = match supermarket_core::api_shapes::jparse(row.get("items"), json!([])) {
                Value::Array(a) => a,
                _ => Vec::new(),
            };
            if !items.is_empty() {
                crate::api_pub_order::release_stock(d1, &items, &order_id, "admin").await;
            }
        }
    }
    Some(json!({ "code": 0 }))
}
/// 现网 orders.js:457 —— 重算的扫描页（LEFT JOIN 带出优惠明细；缺表由外层兜成 internal_error）。
pub const SQL_RECALC_SCAN: &str = r#"SELECT o._id, o.items, o.totalAmount,
              COALESCE(d.discountAmount, 0) AS discountAmount, COALESCE(d.promotionId, '') AS promotionId
       FROM orders o LEFT JOIN order_discounts d ON d.orderId = o._id
       ORDER BY o._id ASC LIMIT ? OFFSET ?"#;
/// 现网 orders.js:473 —— 按存单锁定过的 promotionId 查规则（N+1，逐行一条）。
pub const SQL_RECALC_RULE: &str = r#"SELECT threshold, discount, enabled FROM promotions WHERE _id = ?"#;
/// 现网 orders.js:503 —— 修正批（CASE 式一条改多行）。
pub const SQL_RECALC_UPDATE: &str = r#"UPDATE orders SET totalAmount = CASE _id ${cases} ELSE totalAmount END, updatedAt = ? WHERE _id IN (${inPh})"#;
/// 现网 orders.js:512 —— 同批 UPSERT 优惠明细（无优惠的单也写 0 行占位）。
pub const SQL_RECALC_UPSERT: &str = r#"INSERT INTO order_discounts (orderId, discountAmount, promotionId, createdAt) VALUES ${dvals}
         ON CONFLICT(orderId) DO UPDATE SET discountAmount = excluded.discountAmount, promotionId = excluded.promotionId"#;
/// 现网 orders.js:450 的 recalculateOrders（无入参校验；**会改总额**、不动库存）。
///
/// 分页扫描（200 一页）→ 逐行算「按当前规则应为的总额」→ 漂移单按 50 一组修正（CASE 式 UPDATE + 明细 UPSERT）。
/// 口径（现网 :462-490）写进 core::recalc：只有存单 promotionId 是**非空字符串**才查规则；
/// 规则关/门槛不足/缺行 ⇒ 优惠归零**且 pid 落空串**；漂移判定 = null 或 |差| > 0.01。
async fn recalculate_orders(d1: &D1Client) -> Option<Value> {
    use supermarket_core::recalc;
    const BATCH: i64 = 200;
    const CHUNK: usize = 50;
    let mut processed: i64 = 0;
    let mut fixed: i64 = 0;
    loop {
        let rows = match d1
            .query_rows(SQL_RECALC_SCAN, &[json!(BATCH), json!(processed)])
            .await
        {
            Ok(r) => r,
            Err(_) => {
                return Some(supermarket_core::errors::fail(
                    "internal_error",
                    "服务暂时不可用，请稍后重试",
                    Default::default(),
                ))
            }
        };
        if rows.is_empty() {
            break;
        }
        let mut pending: Vec<(String, f64, f64, String)> = Vec::new();
        for row in &rows {
            let items = match supermarket_core::api_shapes::jparse(row.get("items"), json!([])) {
                Value::Array(a) => a,
                _ => Vec::new(),
            };
            let pid = recalc::stored_promotion_id(row.get("promotionId"));
            let rule = if pid.is_empty() {
                None
            } else {
                d1.query_rows(SQL_RECALC_RULE, &[json!(pid)])
                    .await
                    .ok()
                    .and_then(|r| r.into_iter().next())
            };
            let (expect_discount, expect_total, expect_pid) = recalc::recalc_expect(&items, &pid, rule.as_ref());
            let stored_total = row.get("totalAmount").and_then(|v| v.as_f64());
            let stored_discount = supermarket_core::jsnum::js_number_of(row.get("discountAmount"));
            if recalc::recalc_needs_fix(stored_total, stored_discount, expect_total, expect_discount) {
                let id = row.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                pending.push((id, expect_total, expect_discount, expect_pid));
            }
        }
        for chunk in pending.chunks(CHUNK) {
            let now = crate::api::iso_now();
            // ③ CASE 式一条改多行
            let cases = vec!["WHEN ? THEN ?"; chunk.len()].join(" ");
            let in_ph = vec!["?"; chunk.len()].join(",");
            let sql = SQL_RECALC_UPDATE
                .replace("${cases}", &cases)
                .replace("${inPh}", &in_ph);
            let mut params: Vec<Value> = Vec::new();
            for (id, total, _, _) in chunk {
                params.push(json!(id));
                params.push(supermarket_core::jsnum::js_number(*total));
            }
            params.push(json!(now));
            for (id, _, _, _) in chunk {
                params.push(json!(id));
            }
            if d1.query(&sql, &params).await.is_err() {
                return Some(supermarket_core::errors::fail(
                    "internal_error",
                    "服务暂时不可用，请稍后重试",
                    Default::default(),
                ));
            }
            // ④ 同批 UPSERT 明细（多行 VALUES 单语句）
            let dvals = vec!["(?, ?, ?, ?)"; chunk.len()].join(", ");
            let usql = SQL_RECALC_UPSERT.replace("${dvals}", &dvals);
            let mut uparams: Vec<Value> = Vec::new();
            for (id, _, discount, pid) in chunk {
                uparams.push(json!(id));
                uparams.push(supermarket_core::jsnum::js_number(*discount));
                uparams.push(json!(pid));
                uparams.push(json!(now));
            }
            if d1.query(&usql, &uparams).await.is_err() {
                return Some(supermarket_core::errors::fail(
                    "internal_error",
                    "服务暂时不可用，请稍后重试",
                    Default::default(),
                ));
            }
            fixed += chunk.len() as i64;
        }
        processed += rows.len() as i64;
        if (rows.len() as i64) < BATCH {
            break;
        }
    }
    Some(json!({ "code": 0, "data": { "total": processed, "fixed": fixed } }))
}
/// 现网 reviews.js seedReviews —— 先数表：非空就跳过（幂等种子）。
pub const SQL_REVIEW_COUNT: &str = r#"SELECT COUNT(*) AS c FROM reviews"#;
/// 现网 reviews.js 的 addReview（addPublicReview 在现网就是**直接复用**它，只是入口不同）。
///
/// 返回完整响应封套。公开面复用时由调用方先做写限流；**管理端审计只挂 handleAdmin**，公开面不落审计。
pub async fn add_review(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    use supermarket_core::review_writes as rw;
    let fail = |code: &str, msg: &str| supermarket_core::errors::fail(code, msg, Default::default());
    let clean = rw::pick_review_fields(payload);
    // productOrder == null 才拒（0 是合法值，会被 Number() 成 0）
    let po_null = match payload.and_then(|p| p.get("productOrder")) {
        None | Some(Value::Null) => true,
        _ => false,
    };
    if po_null {
        return Some(fail("missing_product_order", "缺少 productOrder"));
    }
    let images_raw = payload.and_then(|p| p.get("images"));
    if let Some(Value::Array(a)) = images_raw {
        if a.len() > rw::MAX_REVIEW_IMAGES {
            return Some(fail("too_many_images", "最多上传 3 张图片"));
        }
    }
    let Some(clean_images) = rw::validate_review_images(images_raw) else {
        return Some(fail("invalid_image", "图片格式无效"));
    };
    let budget = supermarket_core::order_intake::MAX_STATEMENT_PAYLOAD_CHARS;
    for img in &clean_images {
        let len = img.as_str().map(|s| s.encode_utf16().count()).unwrap_or(0);
        if len > budget {
            let msg = rw::image_too_large_message(len, budget);
            return Some(fail("image_too_large", &msg));
        }
    }
    // 一条评价 = 一行 INSERT ⇒ 最多 3 张图**共享同一份**单语句预算
    let image_chars = rw::review_image_chars(&clean_images);
    if image_chars > budget {
        let msg = rw::payload_too_large_message(image_chars, budget);
        return Some(fail("payload_too_large", &msg));
    }
    let text = rw::normalize_review_text(payload);
    if !rw::check_public_text(&text, rw::REVIEW_TEXT_MAX) {
        return Some(fail("invalid_text", "评价内容无效"));
    }
    let _ = &clean; // pick 的产物用于确认白名单命中，实际取值走下面的归一函数
    let id = crate::api_pub_order::gen_order_id().replacen("o_", "r_", 1);
    let created = crate::api::iso_now();
    let po = supermarket_core::jsnum::js_number_of(payload.and_then(|p| p.get("productOrder")));
    let user = rw::normalize_review_author(payload);
    let rating = rw::normalize_review_rating(payload);
    // doc 列序照抄现网：_id, productOrder, user, rating, text, images, createdAt
    let cols: Vec<String> = vec![
        "_id".into(),
        "productOrder".into(),
        "user".into(),
        "rating".into(),
        "text".into(),
        "images".into(),
        "createdAt".into(),
    ];
    let params: Vec<Value> = vec![
        json!(id),
        supermarket_core::jsnum::js_number(po),
        json!(user),
        json!(rating),
        json!(text),
        json!(Value::Array(clean_images.clone()).to_string()),
        json!(created),
    ];
    let sql = supermarket_core::product_writes::insert_sql("reviews", &cols);
    if d1.query(&sql, &params).await.is_err() {
        return Some(fail("internal_error", "服务暂时不可用，请稍后重试"));
    }
    // 现网响应：{_id, id, ...doc}（_id 与 id 同值，且 doc 的键再铺一遍）
    Some(json!({
        "code": 0,
        "data": {
            "_id": id,
            "id": id,
            "productOrder": supermarket_core::jsnum::js_number(po),
            "user": user,
            "rating": rating,
            "text": text,
            "images": clean_images,
            "createdAt": created,
        }
    }))
}

/// 现网 reviews.js 的 seedReviews：**只在库为空时**灌 20 条种子；非空 ⇒ {added:0,skipped:true}。
///
/// 现网把 20 条合成一次 batch 往返；本边缘走 D1 REST 一次一条 ⇒ 顺序 20 条（原子性差异见 docs §2n.2 同族说明）。
async fn seed_reviews(d1: &D1Client) -> Option<Value> {
    use supermarket_core::review_writes as rw;
    let rows = match d1.query_rows(SQL_REVIEW_COUNT, &[]).await {
        Ok(r) => r,
        Err(_) => {
            return Some(supermarket_core::errors::fail(
                "internal_error",
                "服务暂时不可用，请稍后重试",
                Default::default(),
            ))
        }
    };
    let existing = rows
        .first()
        .map(|r| supermarket_core::jsnum::js_number_of(r.get("c")))
        .unwrap_or(0.0);
    if existing > 0.0 {
        return Some(json!({ "code": 0, "data": { "added": 0, "skipped": true } }))
    }
    let cols: Vec<String> = vec![
        "_id".into(),
        "productOrder".into(),
        "user".into(),
        "rating".into(),
        "text".into(),
        "images".into(),
        "createdAt".into(),
    ];
    let sql = supermarket_core::product_writes::insert_sql("reviews", &cols);
    let mut added = 0i64;
    for (po, user, rating, text) in rw::SEED_REVIEWS {
        let id = crate::api_pub_order::gen_order_id().replacen("o_", "r_", 1);
        let created = crate::api::iso_now();
        let params: Vec<Value> = vec![
            json!(id),
            json!(po),
            json!(user),
            json!(rating),
            json!(text),
            json!("[]"),
            json!(created),
        ];
        if d1.query(&sql, &params).await.is_err() {
            return Some(supermarket_core::errors::fail(
                "internal_error",
                "服务暂时不可用，请稍后重试",
                Default::default(),
            ));
        }
        added += 1;
    }
    Some(json!({ "code": 0, "data": { "added": added } }))
}
/// 现网 submissions.js:101 —— 改状态（**无状态白名单**；status 假值落 done）。
pub const SQL_SUBMISSION_STATUS: &str = r#"UPDATE submissions SET status = ?, updatedAt = ? WHERE _id = ?"#;
/// 现网 submissions.js:109 —— 删提交（单语句，不级联删子表）。
pub const SQL_SUBMISSION_DELETE: &str = r#"DELETE FROM submissions WHERE _id = ?"#;
/// 现网 submissions.js:99 的 updateSubmissionStatus（无白名单 + meta.changes 判存在）。
async fn update_submission_status(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    let sid_raw = payload.and_then(|p| p.get("submissionId"));
    let truthy = match sid_raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    if !truthy {
        return Some(supermarket_core::errors::fail(
            "missing_submission_id",
            "缺少 submissionId",
            Default::default(),
        ));
    }
    let sid = match sid_raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        _ => String::new(),
    };
    let status = supermarket_core::submission_writes::normalize_submission_status(payload.and_then(|p| p.get("status")));
    let ts = crate::api::iso_now();
    let res = match d1
        .query(SQL_SUBMISSION_STATUS, &[json!(status), json!(ts), json!(sid)])
        .await
    {
        Ok(v) => v,
        Err(_) => {
            return Some(supermarket_core::errors::fail(
                "internal_error",
                "服务暂时不可用，请稍后重试",
                Default::default(),
            ))
        }
    };
    if crate::api_pub_order::changes_of(&res) == 0 {
        return Some(supermarket_core::errors::fail(
            "submission_not_found",
            "提交不存在",
            Default::default(),
        ));
    }
    Some(json!({ "code": 0 }))
}

/// 现网 submissions.js:107 的 deleteSubmission（单语句；不看 meta.changes、不级联删）。
async fn delete_submission(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    let sid_raw = payload.and_then(|p| p.get("submissionId"));
    let truthy = match sid_raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        _ => false,
    };
    if !truthy {
        return Some(supermarket_core::errors::fail(
            "missing_submission_id",
            "缺少 submissionId",
            Default::default(),
        ));
    }
    let sid = match sid_raw {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        _ => String::new(),
    };
    let _ = d1.query(SQL_SUBMISSION_DELETE, &[json!(sid)]).await.ok()?;
    Some(json!({ "code": 0 }))
}
/// 现网 submissions.js:14 的 createSubmission（/pub 与 /web 共用；公开面由调用方先做写限流）。
pub async fn create_submission(d1: &D1Client, payload: Option<&Value>) -> Option<Value> {
    use supermarket_core::submission_writes as sw;
    let fail = |code: &str, msg: &str| supermarket_core::errors::fail(code, msg, Default::default());
    let get = |k: &str| payload.and_then(|p| p.get(k));
    // ① serviceId / serviceName 真值判定
    let truthy = |v: Option<&Value>| match v {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
        _ => false,
    };
    if !truthy(get("serviceId")) || !truthy(get("serviceName")) {
        return Some(fail("missing_service_info", "缺少服务信息"));
    }
    // ② 条数上限（非数组跳过）
    let images_raw = get("images");
    if let Some(Value::Array(a)) = images_raw {
        if a.len() > sw::MAX_SUBMISSION_FILES {
            return Some(fail("too_many_images", "最多上传 9 个文件"));
        }
    }
    // ③ scheme：打印走文件白名单，其余走图册白名单；两者非数组都回空表、任一项非法整组拒
    let service_id = match get("serviceId") {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    };
    let is_print = service_id == "print";
    let clean_images = if is_print {
        sw::validate_submission_files(images_raw)
    } else {
        sw::validate_submission_images(images_raw)
    };
    let Some(clean_images) = clean_images else {
        return Some(fail("invalid_image", "文件格式无效"));
    };
    // ④ 体积：两把尺互不共享（普通 90000；打印单件 700000 / 合计 2000000）
    let chars: usize = clean_images
        .iter()
        .map(|v| v.as_str().map(|s| s.encode_utf16().count()).unwrap_or(0))
        .sum();
    let budget = supermarket_core::order_intake::MAX_STATEMENT_PAYLOAD_CHARS;
    if is_print {
        for img in &clean_images {
            let len = img.as_str().map(|s| s.encode_utf16().count()).unwrap_or(0);
            if len > sw::MAX_INLINE_PRINT_CHARS {
                let msg = format!("单个文件过大（{len} 字符 > 预算 {}）", sw::MAX_INLINE_PRINT_CHARS);
                return Some(fail("image_too_large", &msg));
            }
        }
        if chars > sw::MAX_INLINE_PRINT_TOTAL_CHARS {
            let msg = format!(
                "文件合计 {chars} 字符 > 预算 {}：请减少张数或压小文件",
                sw::MAX_INLINE_PRINT_TOTAL_CHARS
            );
            return Some(fail("payload_too_large", &msg));
        }
    } else {
        for img in &clean_images {
            let len = img.as_str().map(|s| s.encode_utf16().count()).unwrap_or(0);
            if len > budget {
                let msg = format!("单张图片过大（{len} 字符 > 预算 {budget}）");
                return Some(fail("image_too_large", &msg));
            }
        }
        if chars > budget {
            let msg = format!("图片合计 {chars} 字符 > 单语句预算 {budget}：请减少张数或压小图片");
            return Some(fail("payload_too_large", &msg));
        }
    }
    // ⑤ formData 归一 + 文本守卫
    let Some(safe_form) = sw::normalize_form_data(payload) else {
        return Some(fail("invalid_text", "表单内容无效"));
    };
    // ⑥ doc：列序照抄现网字面量
    let id = crate::api_pub_order::gen_order_id().replacen("o_", "s_", 1);
    let created = crate::api::iso_now();
    let cols: Vec<String> = vec![
        "_id".into(),
        "serviceId".into(),
        "serviceName".into(),
        "categoryId".into(),
        "categoryName".into(),
        "formData".into(),
        "images".into(),
        "status".into(),
        "createdAt".into(),
    ];
    let params: Vec<Value> = vec![
        json!(id),
        json!(sw::submission_service_string(get("serviceId"), false)),
        json!(sw::submission_service_string(get("serviceName"), false)),
        json!(sw::submission_service_string(get("categoryId"), true)),
        json!(sw::submission_service_string(get("categoryName"), true)),
        json!(safe_form.to_string()),
        json!(Value::Array(clean_images.clone()).to_string()),
        json!("pending"),
        json!(created),
    ];
    let sql = supermarket_core::product_writes::insert_sql("submissions", &cols);
    if d1.query(&sql, &params).await.is_err() {
        return Some(fail("internal_error", "服务暂时不可用，请稍后重试"));
    }
    // 现网响应：data 只回 {id}
    Some(json!({ "code": 0, "data": { "id": id } }))
}
pub async fn call_admin(
    app: &Arc<App>,
    action: &str,
    admin_key: Option<&str>,
    payload: Option<&Value>,
    ip: &str,
) -> Option<Value> {
    // ① 鉴权（现网顺序：先鉴权，后动作校验）
    // 登录限流必须在**鉴权之前**（无论密钥对错都计数，才能真正防暴力破解）—— 现网 backend.js:78 的顺序。
    // 桶 rate:login:<ip>，5 次/60 秒（RATE_LOGIN）。
    if action == "login" {
        if let Some(d1_rate) = app.d1.as_ref() {
            let bucket = format!("rate:login:{}", ip);
            if let Some(env) = crate::api_pub_order::check_rate_db(
                d1_rate,
                &bucket,
                LOGIN_RATE_WINDOW_MS,
                LOGIN_RATE_MAX,
            )
            .await
            {
                return Some(env);
            }
        }
    }
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
        "login" => {
            // 现网 backend.js:103：result = { code: 0, role }（角色由 resolveRole 决定）。
            // password 对的密钥到这里已经是通过 checkAuth 的（login 不在 PUBLIC_ACTIONS 里）。
            let role_str = match role {
                Some(supermarket_core::auth::Role::Admin) => "admin",
                Some(supermarket_core::auth::Role::Readonly) => "readonly",
                None => return None,
            };
            Some(json!({ "code": 0, "role": role_str }))
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
        "adjustStock" => adjust_stock(d1, payload).await,
        "createProduct" => create_product(d1, payload).await,
        "updateProduct" => update_product(d1, payload).await,
        "deleteProduct" => delete_product(d1, payload).await,
        "batchUpdateProducts" => batch_update_products(d1, payload).await,
        "batchDeleteProducts" => batch_delete_products(d1, payload).await,
        "updateOrderStatus" => update_order_status(d1, payload).await,
        "deleteOrder" => delete_order(d1, payload).await,
        "recalculateOrders" => recalculate_orders(d1).await,
        "addReview" => add_review(d1, payload).await,
        "seedReviews" => seed_reviews(d1).await,
        "updateSubmissionStatus" => update_submission_status(d1, payload).await,
        "deleteSubmission" => delete_submission(d1, payload).await,
        "createSubmission" => create_submission(d1, payload).await,
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
        if ok && supermarket_core::auth::is_catalog_write_action(action) {
            // 目录面失效（现网 invalidatePublicCatalog 删 3 个公开 KV 键）：
            // 边缘侧的微缓存键里带动作名 ⇒ 按三个公开动作名清理，顾客端立即看到新数据。
            let mut guard = app.cache.lock().await;
            guard.retain(|k, _| {
                !k.contains(":getPublicProducts:")
                    && !k.contains(":getPublicCategories:")
                    && !k.contains(":getCatalogOrders:")
            });
        }
        // 现网 backend.js:204：审计面 = login + 全部 ADMIN_WRITE_ACTIONS（写动作无论成败都落 ok/fail）
        if action == "login" || supermarket_core::auth::is_admin_write_action(action) {
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
