//! `/pub createOrder` 的 SQL 层：现网 functions/lib/actions/orders.js:166-320 的同义实现。
//!
//! ## 与现网的一处**结构性差异**（必须知道）
//!
//! 现网用 D1 的 **batch**：一次往返执行 N 条语句。本边缘走 D1 的 REST 接口，一次只能一条语句，
//! 所以这里的批量是**顺序多次往返**。逐条语句、逐条参数、逐条 `meta.changes` 的判定都与现网一致，
//! 但**原子性不同**：现网 batch 里某条抛错时整批不生效，而顺序执行下前面已经生效的语句需要靠
//! releaseStock 这类补偿来收口（现网本来也有这套补偿，所以语义差异被补偿路径覆盖了大半）。
//!
//! ## 现网点名的一处**不回补**分支（照实复刻）
//!
//! orders.js:259-320 没有 try 包裹：扣减 batch 成功、而紧接着的流水 batch 抛错时，
//! **库存已减而流水缺失**，异常冒泡成 internal_error，且该分支**不回补**（回补只挂在插单的 catch 里）。
//! 本实现照抄这一行为（并在 docs 里点名），不擅自"修好"——那会改变线上语义。

use serde_json::{json, Value};

use crate::d1::D1Client;

/// orders.js:179 —— 按 id 批量取商品（占位符个数动态），列序照抄。
pub const SQL_ORDER_PRODUCTS: &str = r#"SELECT _id, name, spec, specOptions, price, enabled, subcategories, stock FROM products WHERE _id IN (__PH__)"#;
/// orders.js:241 —— 幂等键命中查询。
pub const SQL_ORDER_BY_KEY: &str = r#"SELECT _id, totalAmount FROM orders WHERE idempotencyKey = ?"#;
/// orders.js:68 —— 90 秒窗口内的同房间进行中单（逐行重算指纹）。
pub const SQL_ORDER_BY_FINGERPRINT: &str = r#"SELECT _id, totalAmount, items, wechat, remark, paymentScreenshot FROM orders WHERE roomNumber = ? AND createdAt >= ? AND status IN ('pending','paid') ORDER BY createdAt DESC LIMIT 10"#;
/// orders.js:155 —— 旧单的优惠明细（缺行 ⇒ 零优惠）。
pub const SQL_ORDER_DISCOUNT: &str = r#"SELECT discountAmount, promotionId FROM order_discounts WHERE orderId = ?"#;
/// orders.js:112 —— 启用中的促销档位。
pub const SQL_ORDER_PROMOTIONS: &str = r#"SELECT _id, threshold, discount FROM promotions WHERE enabled = 1"#;
/// orders.js:306 —— **护栏式**扣减：库存不足那一行不会被改动（靠 meta.changes 发现）。
pub const SQL_ORDER_DEDUCT: &str = r#"UPDATE products SET stock = stock - ?, updatedAt = ? WHERE _id = ? AND stock >= 0 AND stock >= ?"#;
/// orders.js:315 —— 售出流水（delta 为负）。
pub const SQL_ORDER_MOVEMENT_SALE: &str = r#"INSERT INTO stock_movements (productId, delta, kind, refType, refId, actor, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#;
/// stock.js:80（releaseStock 用）—— 回补流水（kind=void）。
pub const SQL_ORDER_MOVEMENT_VOID: &str = r#"INSERT INTO stock_movements (productId, delta, kind, refType, refId, actor, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#;
/// orders.js:325 —— 回补前先取这些商品的当前库存（只回补有限库存项）。
pub const SQL_RELEASE_STOCK: &str = r#"SELECT _id, stock FROM products WHERE _id IN (__PHV__)"#;
/// orders.js:335 —— CASE 式回补（不限售项 stock<0 原样不动）。
pub const SQL_RELEASE_UPDATE: &str = r#"UPDATE products SET stock = CASE WHEN stock >= 0 THEN stock + ? ELSE stock END, updatedAt = ? WHERE _id = ?"#;
/// orders.js:274 —— 优惠明细落行（仅 discount > 0 时）。
pub const SQL_ORDER_DISCOUNT_INSERT: &str = r#"INSERT INTO order_discounts (orderId, discountAmount, promotionId, createdAt) VALUES (?, ?, ?, ?)"#;
/// security.js:48 —— D1 限流：读当前桶。
pub const SQL_RATE_READ: &str = r#"SELECT count, resetAt FROM rate_limits WHERE bucket = ?"#;
/// security.js:52 —— D1 限流：起桶（UPSERT）。
pub const SQL_RATE_INIT: &str = r#"INSERT INTO rate_limits (bucket, count, resetAt) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, resetAt = excluded.resetAt"#;
/// security.js:59 —— D1 限流：计数 +1。
pub const SQL_RATE_BUMP: &str = r#"UPDATE rate_limits SET count = count + 1 WHERE bucket = ?"#;

/// 现网 security.js:78 的公开写限流档：60 秒 20 次（共享桶 rate:write:&lt;ip&gt;）。
pub const RATE_PUBLIC_WRITE_WINDOW_MS: i64 = 60_000;
pub const RATE_PUBLIC_WRITE_MAX: f64 = 20.0;

/// 现网 checkRateDB 的同义实现（本边缘没有 KV，走现网自己的 D1 回退路径）。
///
/// 返回 Some(fail 封套) 表示被限流；None 表示放行。
pub async fn check_rate_db(
    d1: &D1Client,
    key: &str,
    window_ms: i64,
    max: f64,
) -> Option<Value> {
    let now = crate::api::now_ms();
    let row = d1.query_rows(SQL_RATE_READ, &[json!(key)]).await.ok()?;
    let first = row.first().cloned();
    let stale = match &first {
        None => true,
        Some(r) => supermarket_core::jsnum::js_number_of(r.get("resetAt")) < now as f64,
    };
    if stale {
        let _ = d1.query(SQL_RATE_INIT, &[json!(key), json!(now + window_ms)]).await;
        return None;
    }
    let r = first.unwrap();
    let count = supermarket_core::jsnum::js_number_of(r.get("count"));
    let reset_at = supermarket_core::jsnum::js_number_of(r.get("resetAt"));
    if count >= max {
        // 现网 fail('rate_limited', ..., { retryAfterMs })，HTTP 429 且带 Retry-After
        let retry = (reset_at - now as f64).max(0.0);
        let mut env = supermarket_core::errors::fail(
            "rate_limited",
            "操作过于频繁，请稍后再试",
            Default::default(),
        );
        if let Some(obj) = env.as_object_mut() {
            obj.insert("retryAfterMs".to_string(), supermarket_core::jsnum::js_number(retry));
        }
        return Some(env);
    }
    let _ = d1.query(SQL_RATE_BUMP, &[json!(key)]).await;
    None
}

/// 生成订单号（现网 genId：o_ + Date.now().toString(36) + random 片段）。
/// 非确定性：用例与判据**不许**断言它的值，只能断言前缀与长度。
pub fn gen_order_id() -> String {
    let now = crate::api::now_ms() as u64;
    // 36 进制时间戳 + 6 位随机尾（用纳秒做熵，避免引 rand 依赖）
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let mut n = now;
    let mut ts = String::new();
    if n == 0 {
        ts.push('0');
    }
    while n > 0 {
        let d = (n % 36) as u8;
        ts.push(char::from(if d < 10 { 48 + d } else { 87 + d }));
        n /= 36;
    }
    ts = ts.chars().rev().collect();
    let tail = format!("{:06}", (nanos ^ (now << 7)) % 1_000_000);
    format!("o_{ts}{tail}")
}

/// 取值范围辅助：现网 sanitizeTrace(String(x ?? ''))（回显商品号，防把请求方字符串直接渲染给顾客）。
fn trace_id(v: Option<&Value>) -> String {
    let raw = match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Bool(b)) => if *b { "true".to_string() } else { String::new() },
        _ => String::new(),
    };
    supermarket_core::sanitize::sanitize_trace_whitelist(&raw)
}

fn js_string_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => supermarket_core::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
        Some(Value::Bool(b) ) => if *b { "true".to_string() } else { String::new() },
        _ => String::new(),
    }
}

/// 现网 actions/orders.js:166 的 createOrder（返回完整响应封套）。
pub async fn create_order(d1: &D1Client, payload: Option<&Value>) -> Value {
    let fail = |code: &str, msg: &str| supermarket_core::errors::fail(code, msg, Default::default());
    let get = |k: &str| payload.and_then(|p| p.get(k));

    // ① 入参守卫（roomNumber 假值 / items 非数组 / 空数组）
    let room_raw = get("roomNumber");
    let room_truthy = match room_raw {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0 && !x.is_nan()).unwrap_or(true),
        Some(Value::Bool(b)) => *b,
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
        _ => false,
    };
    let items_arr = match get("items") {
        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
        _ => {
            return fail("invalid_order_payload", "订单数据不完整");
        }
    };
    if !room_truthy {
        return fail("invalid_order_payload", "订单数据不完整");
    }

    // ② 截图守卫（先体积、后 scheme；空串跳过校验）
    let shot = match get("paymentScreenshot") {
        Some(Value::String(s)) if !s.is_empty() => {
            let len = s.encode_utf16().count();
            if len > supermarket_core::order_intake::MAX_STATEMENT_PAYLOAD_CHARS {
                let msg = format!(
                    "付款截图过大（{len} 字符 > 单语句预算 {}），请先裁剪或降低清晰度",
                    supermarket_core::order_intake::MAX_STATEMENT_PAYLOAD_CHARS
                );
                return fail("image_too_large", &msg);
            }
            if !supermarket_core::order_intake::is_safe_image_url(s) {
                return fail("invalid_image", "付款截图格式无效，请重新上传");
            }
            s.clone()
        }
        _ => String::new(),
    };

    // ③ 取商品（IN 占位符个数 = items 行数，顺序即请求序）
    let ids: Vec<Value> = items_arr
        .iter()
        .map(|it| it.get("productId").cloned().unwrap_or(Value::Null))
        .collect();
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = SQL_ORDER_PRODUCTS.replace("__PH__", &placeholders);
    let rows = match d1.query_rows(&sql, &ids).await {
        Ok(r) => r,
        Err(_) => return fail("internal_error", "服务暂时不可用，请稍后重试"),
    };

    // ④ 逐行校验 + 计价（消息照抄现网）
    let mut total = 0f64;
    let mut verified: Vec<Value> = Vec::new();
    for it in &items_arr {
        let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
        let Some(p) = rows
            .iter()
            .find(|p| p.get("_id").and_then(|v| v.as_str()) == Some(pid))
        else {
            let msg = format!("商品不存在: {}", trace_id(it.get("productId")));
            return fail("product_not_found", &msg);
        };
        let enabled_off = match p.get("enabled") {
            Some(Value::Number(n)) => n.as_f64() == Some(0.0),
            Some(Value::Bool(b)) => !*b,
            _ => false,
        };
        if enabled_off {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let msg = format!("商品已下架: {name}");
            return fail("product_disabled", &msg);
        }
        let qty_raw = it.get("quantity").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
        let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if !supermarket_core::order_intake::valid_quantity(qty_raw) {
            let msg = format!("商品数量无效: {name}");
            return fail("invalid_quantity", &msg);
        }
        let qty = qty_raw as i64;
        if supermarket_core::order_intake::quantity_over_limit(qty) {
            let msg = format!(
                "单品数量不能超过 {} 件: {name}",
                supermarket_core::MAX_QTY_PER_LINE
            );
            return fail("quantity_exceeds_limit", &msg);
        }
        let price = supermarket_core::jsnum::js_number_of(p.get("price"));
        total += supermarket_core::order_intake::line_total(price, qty);
        verified.push(json!({
            "productId": p.get("_id").cloned().unwrap_or(Value::Null),
            "name": p.get("name").cloned().unwrap_or(Value::Null),
            "spec": supermarket_core::order_intake::resolve_order_spec(p, it.get("spec")),
            "price": supermarket_core::jsnum::js_number(price),
            "quantity": qty,
            "subcategories": supermarket_core::api_shapes::jparse(p.get("subcategories"), json!([])),
        }));
    }

    // ⑤ 归一 + 体积守卫
    let room = js_string_of(room_raw).trim().to_string();
    let wechat = supermarket_core::order_intake::slice_utf16(&js_string_of(get("wechat")), 50);
    let remark = supermarket_core::order_intake::slice_utf16(&js_string_of(get("remark")), 200);
    let payload_chars = supermarket_core::order_intake::statement_payload_chars(
        &room, &wechat, &remark, &verified, &shot,
    );
    if payload_chars > supermarket_core::order_intake::MAX_STATEMENT_PAYLOAD_CHARS {
        return fail("payload_too_large", "订单数据过大，请减少商品或重新上传截图");
    }

    // ⑥ 计价收口 + 起送门槛（折前）
    let total_rounded = supermarket_core::order_intake::round2(total);
    if supermarket_core::order_intake::below_min_delivery(total_rounded) {
        let msg = format!(
            "未达起送门槛（{} 元）",
            supermarket_core::order_intake::js_to_fixed2(
                supermarket_core::order_intake::min_delivery_amount()
            )
        );
        return fail("below_min_delivery", &msg);
    }

    // ⑦ 最优促销档（缺表 ⇒ 零优惠）
    let promo_rows = d1.query_rows(SQL_ORDER_PROMOTIONS, &[]).await.unwrap_or_default();
    let (promotion_id, promo_discount) =
        supermarket_core::order_intake::best_promotion(&promo_rows, total_rounded);
    let discount_rounded = supermarket_core::order_intake::round2(promo_discount);
    let payable_rounded = supermarket_core::order_intake::round2(total_rounded - discount_rounded);

    // ⑧ 指纹 + 幂等键（指纹用**折后实付**）
    let fingerprint = supermarket_core::order_intake::order_fingerprint(
        &room,
        &wechat,
        &remark,
        payable_rounded,
        &verified,
        Some(&Value::String(shot.clone())),
    );
    let key = supermarket_core::order_intake::idempotency_key(
        &room,
        get("requestId"),
        &fingerprint,
    );

    // ⑨ 去重（在扣库存之前）：键路径无时间/状态约束；指纹路径有 90 秒窗口
    let dedup_hit: Option<Value> = if let Some(k) = &key {
        d1.query_rows(SQL_ORDER_BY_KEY, &[json!(k)])
            .await
            .ok()
            .and_then(|r| r.into_iter().next())
    } else {
        let since = supermarket_core::stale::iso_from_ms(crate::api::now_ms() - 90_000);
        let rows = d1
            .query_rows(SQL_ORDER_BY_FINGERPRINT, &[json!(room), json!(since)])
            .await
            .ok()
            .unwrap_or_default();
        rows.into_iter().find(|r| {
            let fp = supermarket_core::order_intake::order_fingerprint(
                &room,
                &js_string_of(r.get("wechat")),
                &js_string_of(r.get("remark")),
                supermarket_core::jsnum::js_number_of(r.get("totalAmount")),
                &match supermarket_core::api_shapes::jparse(r.get("items"), json!([])) {
                    Value::Array(a) => a,
                    _ => Vec::new(),
                },
                r.get("paymentScreenshot"),
            );
            fp == fingerprint
        })
    };
    if let Some(hit) = dedup_hit {
        let old_id = hit.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let (d_amt, d_promo) = read_discount(d1, &old_id).await;
        return json!({
            "code": 0,
            "data": {
                "id": old_id,
                "totalAmount": hit.get("totalAmount").cloned().unwrap_or(json!(0)),
                "discountAmount": d_amt,
                "promotionId": d_promo,
                "deduplicated": true,
            }
        });
    }

    // ⑪ 扣减集合：只扣有限库存项（stock >= 0；不限售项 stock=-1 排除）
    let stock_items: Vec<Value> = verified
        .iter()
        .filter(|it| {
            let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
            rows.iter().any(|p| {
                p.get("_id").and_then(|v| v.as_str()) == Some(pid)
                    && supermarket_core::jsnum::js_number_of(p.get("stock")) >= 0.0
            })
        })
        .cloned()
        .collect();

    let order_id = gen_order_id();

    // ⑫ 护栏式扣减：逐条看 meta.changes，任一 0 变更 ⇒ 先回补已扣项再整体拒绝
    if !stock_items.is_empty() {
        let ts = crate::api::iso_now();
        let mut deducted: Vec<Value> = Vec::new();
        let mut bad: Option<(usize, Value)> = None;
        for (i, it) in stock_items.iter().enumerate() {
            let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
            let qty = supermarket_core::jsnum::js_number_of(it.get("quantity"));
            let res = d1
                .query(
                    SQL_ORDER_DEDUCT,
                    &[
                        supermarket_core::jsnum::js_number(qty),
                        json!(ts),
                        json!(pid),
                        supermarket_core::jsnum::js_number(qty),
                    ],
                )
                .await;
            let changes = match res {
                Ok(v) => changes_of(&v),
                Err(_) => 0,
            };
            if changes == 0 {
                bad = Some((i, it.clone()));
                break;
            }
            deducted.push(it.clone());
        }
        if let Some((idx, it)) = bad {
            // 现网：bad > 0 时先回补前面已扣的那几项（actor=admin）
            if idx > 0 {
                release_stock(d1, &deducted, &order_id, "admin").await;
            }
            let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let msg = format!("库存不足: {name}");
            return fail("stock_insufficient", &msg);
        }
        // ⑬ 售出流水。⚠ 现网此处**没有 try 包裹**：流水抛错时库存已减、流水缺失，且不进入任何回补分支。
        //    照抄这一行为（docs §2n 点名），不擅自修好 —— 那会改变线上语义。
        let ts2 = crate::api::iso_now();
        for it in &stock_items {
            let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
            let qty = supermarket_core::jsnum::js_number_of(it.get("quantity")).trunc() as i64;
            let _ = d1
                .query(
                    SQL_ORDER_MOVEMENT_SALE,
                    &[
                        json!(pid),
                        json!(-qty),
                        json!("sale"),
                        json!("order"),
                        json!(order_id),
                        json!("pub"),
                        json!(""),
                        json!(ts2),
                    ],
                )
                .await;
        }
    }

    // ⑭ 插单（列序 = 现网 doc 键序；有幂等键时追加在末尾）
    let ts3 = crate::api::iso_now();
    let items_json = Value::Array(verified.clone()).to_string();
    let (sql, params) = order_insert_sql(
        &order_id,
        &room,
        &items_json,
        &wechat,
        &remark,
        &shot,
        payable_rounded,
        &ts3,
        key.as_deref(),
    );
    if d1.query(&sql, &params).await.is_err() {
        // 落库失败必须回补本请求已占用的库存，否则失败一次就凭空少一份可售库存
        if !stock_items.is_empty() {
            release_stock(d1, &stock_items, &order_id, "system").await;
        }
        // 并发撞幂等键唯一索引：按 key 重查并返回去重版（现网 orders.js:282-288）
        if let Some(k) = &key {
            if let Ok(rows) = d1.query_rows(SQL_ORDER_BY_KEY, &[json!(k)]).await {
                if let Some(hit) = rows.into_iter().next() {
                    let old_id = hit.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let (d_amt, d_promo) = read_discount(d1, &old_id).await;
                    return json!({
                        "code": 0,
                        "data": {
                            "id": old_id,
                            "totalAmount": hit.get("totalAmount").cloned().unwrap_or(json!(0)),
                            "discountAmount": d_amt,
                            "promotionId": d_promo,
                            "deduplicated": true,
                        }
                    });
                }
            }
        }
        return fail("order_create_failed", "下单失败，请稍后重试");
    }

    // ⑮ 优惠明细（仅 discount > 0；缺表抛错 ⇒ 走同一套回补 + order_create_failed）
    if discount_rounded > 0.0 {
        let res = d1
            .query(
                SQL_ORDER_DISCOUNT_INSERT,
                &[
                    json!(order_id),
                    supermarket_core::jsnum::js_number(discount_rounded),
                    json!(promotion_id),
                    json!(ts3),
                ],
            )
            .await;
        if res.is_err() {
            if !stock_items.is_empty() {
                release_stock(d1, &stock_items, &order_id, "system").await;
            }
            return fail("order_create_failed", "下单失败，请稍后重试");
        }
    }

    // ⑯ 成功（键序照抄 orders.js:293）
    json!({
        "code": 0,
        "data": {
            "id": order_id,
            "totalAmount": supermarket_core::jsnum::js_number(payable_rounded),
            "discountAmount": supermarket_core::jsnum::js_number(discount_rounded),
            "promotionId": promotion_id,
        }
    })
}

/// 从 D1 的 result 数组里取第一条的 meta.changes（拿不到就按 0 —— 与现网 !r.meta?.changes 同义）。
pub fn changes_of(result: &Value) -> i64 {
    result
        .get(0)
        .and_then(|r| r.get("meta"))
        .and_then(|m| m.get("changes"))
        .and_then(|c| c.as_i64())
        .unwrap_or(0)
}

/// 现网 orders.js:155 的 getDiscount（无行 / 缺表 ⇒ 零优惠）。
async fn read_discount(d1: &D1Client, order_id: &str) -> (Value, Value) {
    match d1.query_rows(SQL_ORDER_DISCOUNT, &[json!(order_id)]).await {
        Ok(rows) => match rows.first() {
            Some(r) => (
                supermarket_core::jsnum::js_number(supermarket_core::jsnum::js_number_of(r.get("discountAmount"))),
                r.get("promotionId").cloned().unwrap_or(json!("")),
            ),
            None => (json!(0), json!("")),
        },
        Err(_) => (json!(0), json!("")),
    }
}

/// 现网 orders.js:325 的 releaseStock：先查哪些是有限库存项，再 CASE 式回补 + 记 void 流水。
async fn release_stock(d1: &D1Client, items: &[Value], order_id: &str, actor: &str) {
    let ids: Vec<Value> = items
        .iter()
        .filter_map(|it| it.get("productId").cloned())
        .collect();
    if ids.is_empty() {
        return;
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    // 现网这条用的是局部变量 ${ph}（不是内联表达式）⇒ 标记也不一样，判据按标记分别展开
    let sql = SQL_RELEASE_STOCK.replace("__PHV__", &placeholders);
    let Ok(rows) = d1.query_rows(&sql, &ids).await else {
        return;
    };
    let list: Vec<&Value> = items
        .iter()
        .filter(|it| {
            let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
            rows.iter().any(|r| {
                r.get("_id").and_then(|v| v.as_str()) == Some(pid)
                    && supermarket_core::jsnum::js_number_of(r.get("stock")) >= 0.0
            })
        })
        .collect();
    if list.is_empty() {
        return;
    }
    let ts = crate::api::iso_now();
    for it in &list {
        let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
        let qty = supermarket_core::jsnum::js_number_of(it.get("quantity"));
        let _ = d1
            .query(
                SQL_RELEASE_UPDATE,
                &[supermarket_core::jsnum::js_number(qty), json!(ts), json!(pid)],
            )
            .await;
    }
    let ts2 = crate::api::iso_now();
    for it in &list {
        let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
        let qty = supermarket_core::jsnum::js_number_of(it.get("quantity")).trunc() as i64;
        let _ = d1
            .query(
                SQL_ORDER_MOVEMENT_VOID,
                &[
                    json!(pid),
                    json!(qty),
                    json!("void"),
                    json!("order"),
                    json!(order_id),
                    json!(actor),
                    json!(""),
                    json!(ts2),
                ],
            )
            .await;
    }
}

/// 现网 db.js:55 的 insertSql：列名逐个加双引号、逗号+空格连接；有幂等键时追加在末尾。
fn order_insert_sql(
    order_id: &str,
    room: &str,
    items_json: &str,
    wechat: &str,
    remark: &str,
    shot: &str,
    total_amount: f64,
    ts: &str,
    key: Option<&str>,
) -> (String, Vec<Value>) {
    let mut cols = vec![
        "_id".to_string(),
        "roomNumber".to_string(),
        "items".to_string(),
        "wechat".to_string(),
        "remark".to_string(),
        "paymentScreenshot".to_string(),
        "totalAmount".to_string(),
        "status".to_string(),
        "createdAt".to_string(),
        "updatedAt".to_string(),
    ];
    let mut params = vec![
        json!(order_id),
        json!(room),
        json!(items_json),
        json!(wechat),
        json!(remark),
        json!(shot),
        supermarket_core::jsnum::js_number(total_amount),
        json!("pending"),
        json!(ts),
        json!(ts),
    ];
    if let Some(k) = key {
        cols.push("idempotencyKey".to_string());
        params.push(json!(k));
    }
    let quoted: Vec<String> = cols.iter().map(|c| format!("\"{c}\"")).collect();
    let placeholders = vec!["?"; cols.len()].join(", ");
    let sql = format!(
        "INSERT INTO orders ({}) VALUES ({})",
        quoted.join(", "),
        placeholders
    );
    (sql, params)
}

/// `/pub` 写动作的开关（默认全关）：环境变量 `NATIVE_PUB_WRITE` 里列动作名，逗号分隔。
///
/// 为什么默认关：`createOrder` 是顾客可见的关键路径，且**写动作不能拿现网做对账**（会真下单）。
/// 在 mock 侧的语句序列判据就位之前，让它默认生效等于把未验证的写路径推到线上。
pub fn pub_write_native_enabled(action: &str) -> bool {
    std::env::var("NATIVE_PUB_WRITE")
        .ok()
        .map(|v| v.split(',').any(|x| x.trim() == action))
        .unwrap_or(false)
}
