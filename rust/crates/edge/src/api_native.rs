//! /pub 三个公开读动作的**原生实现**（P3 迁移的第一步，默认关闭）。
//!
//! ## 为什么默认关
//!
//! 现网的算法面（SQL、字段裁剪、JSON 文本列解析、错误语义）是**已被线上验证过**的。
//! 换实现的风险不是「跑不起来」，而是「悄悄少一个字段 / 多一个 null」。所以：
//!   · 开关 `NATIVE_PUBLIC_ACTIONS` 默认**不设** ⇒ 全部动作仍走上游透传，行为与今天逐字节相同；
//!   · 打开后若 D1 未配或查询失败，**回落透传**（客户端拿到的仍是正确数据，而不是换一种错误形状）；
//!   · 原生结果写进与公开读同一套 60s 微缓存（对应上游的 KV `cache:public:*`，语义等价）。
//!
//! ## 与现网逐字对齐的三处（都有判据钉）
//!
//! 1. **SQL 字面量**：每条都注明来源行号；`sql_matches_js_source` 用例会读
//!    `functions/lib/actions/products.js` 并断言这些字面量逐字出现 —— JS 改了 SQL 而这里没跟，当场判红；
//! 2. **字段映射**：复用 `supermarket_core::api_shapes`（已有 5 条用例钉住字段顺序与脏值语义）；
//! 3. **错误语义**：失败一律用 `supermarket_core::errors` 的 42 条登记码（不自造 code）。

use std::sync::Arc;

use serde_json::json;
use serde_json::Value;

use crate::api::App;

/// 在册的原生动作（全部公开读；写动作一律留透传，见 docs/08 的未做清单）。
pub const NATIVE_ACTIONS: [&str; 5] = [
    "getPublicProducts",
    "getPublicCategories",
    "getCatalogOrders",
    "getReviews",
    "getOrderStatus",
];

// ── SQL（来源：functions/lib/actions/products.js，行号见注释；改一处必须同步改两边）──
/// products.js:45 —— 在售商品（`WHERE enabled = 1`，按 order 升序，上限 1000）。
pub const SQL_PUBLIC_PRODUCTS: &str = r#"SELECT _id, name, spec, price, image, "order", subcategories, enabled, description, stock, specOptions FROM products WHERE enabled = 1 ORDER BY "order" ASC LIMIT 1000"#;
/// products.js:83 —— 分类（按 order 升序，上限 200）。
pub const SQL_PUBLIC_CATEGORIES: &str = r#"SELECT _id, name, type, "order", subcategories FROM categories ORDER BY "order" ASC LIMIT 200"#;
/// products.js:67 —— 目录序号面（**不加 enabled 过滤**：它回答的是「目录里一共出现过多少个号」）。
pub const SQL_CATALOG_ORDERS: &str = r#"SELECT "order", image FROM products ORDER BY "order" ASC LIMIT 1000"#;
/// reviews.js:12 —— 某商品的评价（按 createdAt 倒序，上限 500）。**注意 "user" 是保留字，必须带引号**。
pub const SQL_GET_REVIEWS: &str = r#"SELECT _id, "user", rating, text, productOrder, createdAt, images FROM reviews WHERE productOrder = ? ORDER BY createdAt DESC LIMIT 500"#;
/// orders.js:441 —— 按订单号查状态（只回两列；查不到 ⇒ order_not_found）。
pub const SQL_ORDER_STATUS: &str = r#"SELECT status, updatedAt FROM orders WHERE _id = ?"#;

/// 开关：`NATIVE_PUBLIC_ACTIONS=all` 或逗号分隔的动作名；未设 ⇒ 全关（默认透传）。
pub fn native_enabled(action: &str) -> bool {
    match std::env::var("NATIVE_PUBLIC_ACTIONS") {
        Ok(v) => {
            // 大小写无关：动作名是 camelCase（getPublicProducts），而人写开关时可能写成
            // getpublicproducts。**不能**先把值整体 lowercase 再与动作名比 —— 那会恒不相等
            // （第一版就是这么把开关写成"永远关"的，用例当场抓住）。
            let v = v.trim();
            v.eq_ignore_ascii_case("all")
                || v.split(',').any(|s| s.trim().eq_ignore_ascii_case(action))
        }
        Err(_) => false,
    }
}

/// 原生调用：`None` = 这条动作这次走不了原生（未配 D1 / 查询失败 / D1 形状不对）。
///
/// **返回 None 而不是编一个失败响应**：调用方据此回落上游透传 —— 降级路径必须是「数据仍然对」。
/// `payload` 是请求体里的 `payload` 字段（现网 handlePublic/handleWeb 也是这么取的）。
pub async fn call(app: &Arc<App>, action: &str, payload: Option<&Value>) -> Option<Value> {
    let d1 = app.d1.as_ref()?;
    match action {
        "getPublicProducts" => {
            let rows = d1.query_rows(SQL_PUBLIC_PRODUCTS, &[]).await.ok()?;
            let data: Vec<Value> = rows.iter().map(supermarket_core::api_shapes::row_to_product).collect();
            Some(json!({ "code": 0, "data": data }))
        }
        "getPublicCategories" => {
            let rows = d1.query_rows(SQL_PUBLIC_CATEGORIES, &[]).await.ok()?;
            let data: Vec<Value> = rows.iter().map(supermarket_core::api_shapes::row_to_category).collect();
            Some(json!({ "code": 0, "data": data }))
        }
        "getCatalogOrders" => {
            let rows = d1.query_rows(SQL_CATALOG_ORDERS, &[]).await.ok()?;
            let data = supermarket_core::api_shapes::catalog_orders(&rows);
            Some(json!({ "code": 0, "data": data }))
        }
        "getReviews" => {
            // 现网 reviews.js:9-10：`productOrder == null` ⇒ missing_product_order。
            // 「没给」与「给了但取不出数」是两件事：前者回错误封套；后者**回落透传**
            //（JS 会把 NaN 当参数发给 D1，那条路径我们不复刻 —— 宁可由上游照旧处理，
            //  也不猜一个可能不对的答案）。
            match payload.and_then(|p| p.get("productOrder")) {
                None | Some(Value::Null) => Some(supermarket_core::errors::fail(
                    "missing_product_order",
                    "缺少 productOrder",
                    Default::default(),
                )),
                Some(v) => {
                    let n = match v {
                        Value::Number(x) => x.as_f64(),
                        Value::String(s) => s.trim().parse::<f64>().ok(),
                        _ => None,
                    }?;
                    if !n.is_finite() {
                        return None;
                    }
                    // Number(productOrder)：整数就按整数发（与 JS 的 [6] 同形），带小数才发小数
                    let param = if n.fract() == 0.0 {
                        json!(n as i64)
                    } else {
                        json!(n)
                    };
                    let rows = d1.query_rows(SQL_GET_REVIEWS, &[param]).await.ok()?;
                    let data: Vec<Value> = rows
                        .iter()
                        .map(supermarket_core::api_shapes::review_row_to_json)
                        .collect();
                    Some(json!({ "code": 0, "data": data }))
                }
            }
        }
        "getOrderStatus" => {
            // 现网 orders.js:439：`!orderId || typeof orderId !== 'string'` ⇒ missing_order_id
            let id = match payload.and_then(|p| p.get("orderId")) {
                Some(Value::String(s)) if !s.is_empty() => s.clone(),
                _ => {
                    return Some(supermarket_core::errors::fail(
                        "missing_order_id",
                        "缺少订单号",
                        Default::default(),
                    ))
                }
            };
            let rows = d1.query_rows(SQL_ORDER_STATUS, &[json!(id)]).await.ok()?;
            match rows.first() {
                // 现网 orders.js:442：查不到 ⇒ order_not_found（404 档，kind=state）
                None => Some(supermarket_core::errors::fail(
                    "order_not_found",
                    "订单不存在",
                    Default::default(),
                )),
                Some(row) => Some(json!({
                    "code": 0,
                    "data": supermarket_core::api_shapes::order_status_data(&id, row),
                })),
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// JS 源码里必须**逐字**出现同一句 SQL（归一化空白后比对）。
    ///
    /// 为什么读 JS 源码而不是再抄一份到测试里：抄一份就是第三份真相。
    /// 这里断言的是「Rust 常量 == JS 文件里的字面量」，JS 一改就先红。
    #[test]
    fn sql_matches_js_source() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // rust/crates/edge → 三级上一级 = 仓根（supermarket-web）
        let repo = root.join("..").join("..").join("..");
        // 归一化：折叠空白，**并剥掉 JS 的字符串拼接胶水** —— 现网有些 SQL 是用 + 拼出来的
        //（events.js:31：模板串 + 单引号串）。不剥的话「Rust 侧整串」在 JS 文件里永远找不到，
        // 判据会红得没道理。只剥胶水，不碰 SQL 记号本身（引号、逗号、关键字一律保留）。
        let bt = '\u{60}';
        let sq = '\'';
        let dq = '"';
        let glue = |s: &str| {
            s.replace(&format!("{sq} + {bt}"), " ")
                .replace(&format!("{bt} + {sq}"), " ")
                .replace(&format!("{sq} + {sq}"), " ")
                .replace(&format!("{sq} + {dq}"), " ")
                .replace(&format!("{dq} + {sq}"), " ")
        };
        let norm = |s: &str| {
            // 先**折叠**成单空格再剥胶水：第一版按字符逐个换成空格，于是换行+缩进变成
            // 一串空格，胶水模式（单空格）匹配不上 —— 判据红得对，是我的归一化写错了。
            let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
            glue(&flat).split_whitespace().collect::<Vec<_>>().join(" ")
        };
        // 每条 SQL 坐在哪个 JS 文件里。2026-10-27 扩到 5 条 SQL 时才发现：
        // 三条在 products.js，而 getReviews 在 reviews.js、getOrderStatus 在 orders.js ——
        // 只读一个文件的写法会让后两条「验了个空」（判据绿着，其实没比过）。
        // 扩到 7 条：管理端第一条（SELECT *）与审计 INSERT 也进判据 ——
        // 语句抄错时判据要在**落地前**红，而不是等线上审计表少几行才发现。
        // 动态占位符：Rust 侧用 __PH__ 标记，现网模板串里是 $ + {ids.map(() => '?').join(',')}。
        // 判据把它展开成现网原文再比 —— 比「跳过这两条」强得多：列序或条件改了一样红。
        let ids_tpl = format!(
            "{}{}ids.map(() => {q}?{q}).join({q},{q}){}",
            char::from(36u8),
            char::from(123u8),
            char::from(125u8),
            q = char::from(39u8)
        );
        // 两种标记：内联表达式与局部变量（现网两处写法不同，判据各认各的）
        let ph_tpl = format!("{}{}ph{}", char::from(36u8), char::from(123u8), char::from(125u8));
        let expand = |s: &str| s.replace("__PH__", &ids_tpl).replace("__PHV__", &ph_tpl);

        let sources: [(&str, &str, &str); 54] = [
            (SQL_PUBLIC_PRODUCTS, "SQL_PUBLIC_PRODUCTS", "functions/lib/actions/products.js"),
            (SQL_PUBLIC_CATEGORIES, "SQL_PUBLIC_CATEGORIES", "functions/lib/actions/products.js"),
            (SQL_CATALOG_ORDERS, "SQL_CATALOG_ORDERS", "functions/lib/actions/products.js"),
            (crate::api_admin::SQL_PRODUCT_STOCK_READ, "SQL_PRODUCT_STOCK_READ", "functions/lib/actions/products.js"),
            (crate::api_admin::SQL_BATCH_STOCK_IN, "SQL_BATCH_STOCK_IN", "functions/lib/actions/products.js"),
            (crate::api_admin::SQL_BATCH_EXIST_IN, "SQL_BATCH_EXIST_IN", "functions/lib/actions/products.js"),
            (crate::api_admin::SQL_BATCH_DELETE_IN, "SQL_BATCH_DELETE_IN", "functions/lib/actions/products.js"),
            // 第 24 轮：订单状态机三条
            (crate::api_admin::SQL_ORDER_STATE_READ, "SQL_ORDER_STATE_READ", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_ORDER_STATUS_UPDATE, "SQL_ORDER_STATUS_UPDATE", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_ORDER_DELETE, "SQL_ORDER_DELETE", "functions/lib/actions/orders.js"),
            // 第 25 轮：订单重算四条（两条含 ${cases}/${dvals} 模板标记，现网源码里就是这个字面量）
            (crate::api_admin::SQL_RECALC_SCAN, "SQL_RECALC_SCAN", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_RECALC_RULE, "SQL_RECALC_RULE", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_RECALC_UPDATE, "SQL_RECALC_UPDATE", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_RECALC_UPSERT, "SQL_RECALC_UPSERT", "functions/lib/actions/orders.js"),
            // 第 26 轮：评价域种子计数
            (crate::api_admin::SQL_REVIEW_COUNT, "SQL_REVIEW_COUNT", "functions/lib/actions/reviews.js"),
            // 第 27 轮：提交域两条
            (crate::api_admin::SQL_SUBMISSION_STATUS, "SQL_SUBMISSION_STATUS", "functions/lib/actions/submissions.js"),
            (crate::api_admin::SQL_SUBMISSION_DELETE, "SQL_SUBMISSION_DELETE", "functions/lib/actions/submissions.js"),
            (SQL_GET_REVIEWS, "SQL_GET_REVIEWS", "functions/lib/actions/reviews.js"),
            (SQL_ORDER_STATUS, "SQL_ORDER_STATUS", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_GET_PRODUCTS, "SQL_GET_PRODUCTS", "functions/lib/actions/products.js"),
            (crate::api_admin::SQL_AUDIT_INSERT, "SQL_AUDIT_INSERT", "functions/lib/security.js"),
            // 第 7 轮批量的 4 个管理只读
            (crate::api_admin::SQL_ALL_REVIEWS, "SQL_ALL_REVIEWS", "functions/lib/actions/reviews.js"),
            (crate::api_admin::SQL_SUBMISSIONS, "SQL_SUBMISSIONS", "functions/lib/actions/submissions.js"),
            (crate::api_admin::SQL_SUBMISSION_IMAGES, "SQL_SUBMISSION_IMAGES", "functions/lib/actions/submissions.js"),
            (crate::api_admin::SQL_EVENT_TIMELINE, "SQL_EVENT_TIMELINE", "functions/lib/actions/events.js"),
            // 第 8~9 轮的流水双查询：两条都要逐字验（参数一致性由 core 单测保证，这里保证语句本身没抄错）
            (crate::api_admin::SQL_MOVEMENTS_MAIN, "SQL_MOVEMENTS_MAIN", "functions/lib/stock.js"),
            (crate::api_admin::SQL_MOVEMENTS_COUNT, "SQL_MOVEMENTS_COUNT", "functions/lib/stock.js"),
            // 第 10 轮：订单分页（三处派生标记）与单订单详情
            (crate::api_admin::SQL_ORDERS_PAGE, "SQL_ORDERS_PAGE", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_ORDER_BY_ID, "SQL_ORDER_BY_ID", "functions/lib/actions/orders.js"),
            // 第 11 轮：超时单盘点的两条查询（含动态 IN 占位符）
            (crate::api_admin::SQL_STALE_ORDERS, "SQL_STALE_ORDERS", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_STALE_PRODUCTS, "SQL_STALE_PRODUCTS", "functions/lib/actions/orders.js"),
            // 第 12 轮：促销档位两条查询
            (crate::api_admin::SQL_PROMOTIONS, "SQL_PROMOTIONS", "functions/lib/actions/orders.js"),
            (crate::api_admin::SQL_PROMOTION_HITS, "SQL_PROMOTION_HITS", "functions/lib/actions/orders.js"),
            // 第 13 轮：看板三表
            (crate::api_admin::SQL_STATS_ORDERS, "SQL_STATS_ORDERS", "functions/lib/actions/stats.js"),
            (crate::api_admin::SQL_STATS_REVIEWS, "SQL_STATS_REVIEWS", "functions/lib/actions/stats.js"),
            (crate::api_admin::SQL_STATS_PRODUCTS, "SQL_STATS_PRODUCTS", "functions/lib/actions/stats.js"),
            // 第 14~15 轮：写动作第一条（单语句）
            (crate::api_admin::SQL_DELETE_REVIEW, "SQL_DELETE_REVIEW", "functions/lib/actions/reviews.js"),
            // 第 16~17 轮：库存域写动作（读行 / 改快照 / 记流水）
            (crate::api_admin::SQL_STOCK_ROW, "SQL_STOCK_ROW", "functions/lib/stock.js"),
            (crate::api_admin::SQL_STOCK_UPDATE, "SQL_STOCK_UPDATE", "functions/lib/stock.js"),
            (crate::api_admin::SQL_MOVEMENT_INSERT, "SQL_MOVEMENT_INSERT", "functions/lib/stock.js"),
            // 第 20~21 轮：/pub 下单链路（13 条；orders.js / stock.js / security.js）
            (crate::api_pub_order::SQL_ORDER_PRODUCTS, "SQL_ORDER_PRODUCTS", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_BY_KEY, "SQL_ORDER_BY_KEY", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_BY_FINGERPRINT, "SQL_ORDER_BY_FINGERPRINT", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_DISCOUNT, "SQL_ORDER_DISCOUNT", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_PROMOTIONS, "SQL_ORDER_PROMOTIONS", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_DEDUCT, "SQL_ORDER_DEDUCT", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_MOVEMENT_SALE, "SQL_ORDER_MOVEMENT_SALE", "functions/lib/stock.js"),
            (crate::api_pub_order::SQL_ORDER_MOVEMENT_VOID, "SQL_ORDER_MOVEMENT_VOID", "functions/lib/stock.js"),
            (crate::api_pub_order::SQL_RELEASE_STOCK, "SQL_RELEASE_STOCK", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_RELEASE_UPDATE, "SQL_RELEASE_UPDATE", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_ORDER_DISCOUNT_INSERT, "SQL_ORDER_DISCOUNT_INSERT", "functions/lib/actions/orders.js"),
            (crate::api_pub_order::SQL_RATE_READ, "SQL_RATE_READ", "functions/lib/security.js"),
            (crate::api_pub_order::SQL_RATE_INIT, "SQL_RATE_INIT", "functions/lib/security.js"),
            (crate::api_pub_order::SQL_RATE_BUMP, "SQL_RATE_BUMP", "functions/lib/security.js"),
        ];
        for (sql, name, rel) in sources {
            let js_path = repo.join(rel);
            let js = fs::read_to_string(&js_path)
                .unwrap_or_else(|e| panic!("读不到 {:?}：{}", js_path, e));
            assert!(
                norm(&js).contains(&norm(&expand(sql))),
                "{} 与 {} 里的字面量不一致（现网实现改了 SQL，Rust 侧未同步）",
                name,
                rel
            );
        }
    }

    #[test]
    fn native_switch_defaults_off() {
        // 不设环境变量时全关（默认透传 ⇒ 行为与今天逐字节相同）
        std::env::remove_var("NATIVE_PUBLIC_ACTIONS");
        assert!(!native_enabled("getPublicProducts"));
        std::env::set_var("NATIVE_PUBLIC_ACTIONS", "all");
        assert!(native_enabled("getCatalogOrders"));
        std::env::set_var("NATIVE_PUBLIC_ACTIONS", "getPublicProducts");
        assert!(native_enabled("getPublicProducts"));
        assert!(!native_enabled("getPublicCategories"));
        std::env::remove_var("NATIVE_PUBLIC_ACTIONS");
    }
}
