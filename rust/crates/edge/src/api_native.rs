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
pub const NATIVE_ACTIONS: [&str; 3] = [
    "getPublicProducts",
    "getPublicCategories",
    "getCatalogOrders",
];

// ── SQL（来源：functions/lib/actions/products.js，行号见注释；改一处必须同步改两边）──
/// products.js:45 —— 在售商品（`WHERE enabled = 1`，按 order 升序，上限 1000）。
pub const SQL_PUBLIC_PRODUCTS: &str = r#"SELECT _id, name, spec, price, image, "order", subcategories, enabled, description, stock, specOptions FROM products WHERE enabled = 1 ORDER BY "order" ASC LIMIT 1000"#;
/// products.js:83 —— 分类（按 order 升序，上限 200）。
pub const SQL_PUBLIC_CATEGORIES: &str = r#"SELECT _id, name, type, "order", subcategories FROM categories ORDER BY "order" ASC LIMIT 200"#;
/// products.js:67 —— 目录序号面（**不加 enabled 过滤**：它回答的是「目录里一共出现过多少个号」）。
pub const SQL_CATALOG_ORDERS: &str = r#"SELECT "order", image FROM products ORDER BY "order" ASC LIMIT 1000"#;

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
pub async fn call(app: &Arc<App>, action: &str) -> Option<Value> {
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
        let js_path = root
            .join("..")
            .join("..")
            .join("..")
            .join("functions")
            .join("lib")
            .join("actions")
            .join("products.js");
        let js = fs::read_to_string(&js_path)
            .unwrap_or_else(|e| panic!("读不到 {:?}：{}", js_path, e));
        let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
        let flat = norm(&js);
        for (name, sql) in [
            ("SQL_PUBLIC_PRODUCTS", SQL_PUBLIC_PRODUCTS),
            ("SQL_PUBLIC_CATEGORIES", SQL_PUBLIC_CATEGORIES),
            ("SQL_CATALOG_ORDERS", SQL_CATALOG_ORDERS),
        ] {
            assert!(
                flat.contains(&norm(sql)),
                "{} 与 JS 源码不一致（现网实现改了 SQL，Rust 侧未同步）\n  Rust: {}",
                name,
                norm(sql)
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
