//! 契约与纯计算的对账测试（Rust 侧的判据）。
//!
//! 分组与 docs/05 «性能指标与验证» 的第 3 张表一一对应：
//!   E 组 = 错误登记表（与 functions/lib/errors.js 对账）
//!   C 组 = 购物袋（与 src/cart.ts 对账）
//!   F 组 = 格式化（与 src/utils/format.ts 对账）
//!   V 组 = CSV（与 src/utils/csv.ts 对账）
//!   D 组 = 目录筛选（与 src/pages/CustomerPage.tsx 对账）
//!
//! 这些用例的价值不在「覆盖率高」，而在于它们是**跨语言同值**的钉子：
//! JS 侧那份改动若不同步，Node 侧的 scripts/rust/parity-js.mjs 会算出不同的值，
//! 两侧一起跑才算过。

use supermarket_core::{cart, catalog, csv, errors, format, js_round};
use supermarket_core::contract::{self, status_of, with_trace};

// ── E 组：错误登记表 ────────────────────────────────────────────────
#[test]
fn e_registry_cardinality_matches_js() {
    // 现网 ERRORS 表逐条点数 = 42。数量对不上说明有人加了码没同步，或 Rust 侧漏抄。
    assert_eq!(errors::ERRORS.len(), 42, "错误码数量必须与 functions/lib/errors.js 一致");
}

#[test]
fn e_spot_checks_are_the_machine_readable_judgements() {
    let below = errors::meta_of("below_min_delivery");
    assert_eq!(below.status, 409);
    assert!(!below.retryable, "起送门槛属 state：原样重发必然同样失败");
    assert_eq!(below.kind.as_str(), "state");

    let quota = errors::meta_of("rate_limited");
    assert_eq!(quota.status, 429);
    assert!(quota.retryable);

    let print = errors::meta_of("print_storage_unavailable");
    assert_eq!(print.kind.as_str(), "platform");
    assert!(!print.retryable, "R2 绑定缺失是部署态问题：该换路径而不是重试");

    // 未登记码兜底 = internal_error（500/platform/retryable），不猜 4xx。
    let unknown = errors::meta_of("no_such_code");
    assert_eq!(unknown.status, 500);
    assert_eq!(unknown.kind.as_str(), "platform");
}

#[test]
fn e_fail_envelope_keeps_code_minus_one() {
    let payload = errors::fail("stock_insufficient", "库存不足", Default::default());
    // code:-1 是兼容性红线（旧 SW 缓存的前端 bundle 用 code !== 0 判失败）。
    assert_eq!(payload["code"], -1);
    assert_eq!(payload["errorCode"], "stock_insufficient");
    assert_eq!(payload["kind"], "state");
    assert_eq!(payload["retryable"], false);
    assert_eq!(payload["message"], "库存不足");
}

#[test]
fn e_status_and_retry_after_follow_apiresponse() {
    assert_eq!(status_of(&errors::ok(serde_json::json!([]))), 200);
    let failed = errors::fail("invalid_json", "无效的 JSON 请求体", Default::default());
    assert_eq!(status_of(&failed), 400);
    // 429 一律带 Retry-After；缺 retryAfterMs 时回落 "1"。
    let limited = errors::fail("rate_limited", "慢点", Default::default());
    assert_eq!(contract::retry_after_header(&limited, 429).as_deref(), Some("1"));
    let limited_ms = serde_json::json!({ "code": -1, "errorCode": "rate_limited", "retryAfterMs": 4500 });
    assert_eq!(contract::retry_after_header(&limited_ms, 429).as_deref(), Some("5"));
    assert_eq!(contract::retry_after_header(&limited_ms, 400), None);
}

#[test]
fn e_with_trace_appends_last() {
    let base = serde_json::json!({ "code": 0, "total": 3 });
    let with = with_trace(base, Some("abc123"));
    assert_eq!(with, serde_json::json!({ "code": 0, "total": 3, "trace": "abc123" }));
    // 空 trace 与 None 一样：原样返回（现网 sanitizeTrace 返回空串时也不追加）。
    let empty = with_trace(serde_json::json!({ "code": 0 }), Some(""));
    assert_eq!(empty, serde_json::json!({ "code": 0 }));
}

// ── C 组：购物袋 ───────────────────────────────────────────────────
fn product(id: &str, price: f64, spec: Option<&str>) -> cart::CartProduct {
    cart::CartProduct {
        id: id.to_string(),
        name: format!("商品{}", id),
        spec: spec.map(|s| s.to_string()),
        price,
        subcategories: Some(vec!["snack".to_string()]),
    }
}

#[test]
fn c_add_merges_only_same_flavor() {
    let c0 = cart::Cart::default();
    let c1 = cart::add_to_cart(&c0, &product("p_1", 3.5, None), 1.0);
    let c2 = cart::add_to_cart(&c1, &product("p_1", 3.5, Some("黄瓜味")), 1.0);
    // 同商品不同口味必须是两行（第三十六轮修掉的丢口味缺陷）。
    assert_eq!(c2.items.len(), 2);
    let c3 = cart::add_to_cart(&c2, &product("p_1", 3.5, Some("黄瓜味")), 2.0);
    assert_eq!(c3.items.len(), 2);
    assert_eq!(c3.items[1].quantity, 3);
    // 跨口味聚合的角标数 = 1 + 3
    assert_eq!(cart::item_quantity(&c3, "p_1"), 4);
}

#[test]
fn c_quantity_is_capped_not_rejected() {
    let c0 = cart::Cart::default();
    let mut c = cart::add_to_cart(&c0, &product("p_1", 1.0, None), 99.0);
    c = cart::add_to_cart(&c, &product("p_1", 1.0, None), 5.0);
    assert_eq!(c.items[0].quantity, 99, "上界是封顶（99），不是把这一次点击丢掉");
    // qty 归一化：1.9 → 1；Infinity/NaN/0 → 1
    let floor_case = cart::add_to_cart(&c0, &product("p_2", 1.0, None), 1.9);
    assert_eq!(floor_case.items[0].quantity, 1);
    let inf_case = cart::add_to_cart(&c0, &product("p_2", 1.0, None), f64::INFINITY);
    assert_eq!(inf_case.items[0].quantity, 1);
    let nan_case = cart::add_to_cart(&c0, &product("p_2", 1.0, None), f64::NAN);
    assert_eq!(nan_case.items[0].quantity, 1);
}

#[test]
fn c_remove_semantics_keep_legacy_whole_product_behaviour() {
    let mut c = cart::Cart::default();
    c = cart::add_to_cart(&c, &product("p_1", 1.0, None), 2.0);
    c = cart::add_to_cart(&c, &product("p_1", 1.0, Some("黄瓜味")), 2.0);
    // 不传 spec：该商品所有行各减一件
    let dec = cart::remove_from_cart(&c, "p_1", None);
    assert_eq!(dec.items.len(), 2);
    assert!(dec.items.iter().all(|i| i.quantity == 1));
    // 传 spec：只动那一行
    let one = cart::remove_from_cart(&c, "p_1", Some("黄瓜味"));
    assert_eq!(one.items[0].quantity, 2);
    assert_eq!(one.items[1].quantity, 1);
    // 减到 0 的行会被过滤掉（先把那一行调到 1 件再减）
    let mut single = cart::Cart { items: vec![c.items[0].clone()] };
    single.items[0].quantity = 1;
    let emptied = cart::remove_from_cart(&single, "p_1", None);
    assert!(emptied.items.is_empty());
    // 删除：传 spec 只删那行
    let deleted = cart::delete_from_cart(&c, "p_1", Some("黄瓜味"));
    assert_eq!(deleted.items.len(), 1);
}

#[test]
fn c_totals_use_the_same_left_to_right_sum() {
    let mut c = cart::Cart::default();
    c = cart::add_to_cart(&c, &product("p_1", 3.5, None), 3.0);   // 10.5
    c = cart::add_to_cart(&c, &product("p_2", 0.09, None), 1.0);  // 0.09
    c = cart::add_to_cart(&c, &product("p_3", 0.1, None), 1.0);   // 0.1
    // JS: (0 + 10.5) + 0.09 = 10.59；+0.1 = 10.690000000000001（两侧必须同为该值）
    assert_eq!(cart::total_amount(&c), 10.5 + 0.09 + 0.1);
    assert_eq!(cart::total_count(&c), 5);
}

#[test]
fn c_parse_cart_degrades_instead_of_throwing() {
    assert_eq!(cart::parse_cart(None).items.len(), 0);
    assert_eq!(cart::parse_cart(Some("not json")).items.len(), 0);
    assert_eq!(cart::parse_cart(Some("{\"items\":{}}")).items.len(), 0);
    // 缺字段的历史行仍可解析（只有 items 不是数组才整袋判废）
    let lenient = cart::parse_cart(Some("{\"items\":[{\"productId\":\"p_1\",\"quantity\":2}]}"));
    assert_eq!(lenient.items.len(), 1);
    assert_eq!(lenient.items[0].quantity, 2);
}

#[test]
fn c_min_delivery_gate_is_two_decimal_normalised() {
    assert!(supermarket_core::meets_min_delivery(6.0));
    assert!(supermarket_core::meets_min_delivery(0.1 + 0.2 + 5.7), "浮点尾巴不得把刚好 6 元判成不足");
    assert!(!supermarket_core::meets_min_delivery(5.99));
    assert_eq!(supermarket_core::min_delivery_gap(5.9), 0.1);
    assert_eq!(supermarket_core::min_delivery_gap(10.0), 0.0);
}

// ── F 组：格式化 ───────────────────────────────────────────────────
#[test]
fn f_format_matches_js_vectors() {
    assert_eq!(format::format_price(3.5), "3.50");
    assert_eq!(format::format_price(0.0), "0.00");
    assert_eq!(format::format_price(f64::NAN), "0.00");
    assert_eq!(format::format_price(f64::INFINITY), "0.00");
    // ECMAScript toFixed 的平局规则：0.125 → "0.13"（不是银行家舍入的 0.12）
    assert_eq!(format::format_price(0.125), "0.13");
    assert_eq!(format::format_price(1.005), "1.00", "二进制表示 1.00499999… 的两个实现都该给 1.00");
    assert_eq!(format::format_yuan(3.5), "¥3.50");
    assert_eq!(format::format_count(1234.0), "1,234");
    assert_eq!(format::format_count(-1234.0), "-1,234");
    assert_eq!(format::format_count(f64::NAN), "0");
    assert_eq!(format::format_percent(Some(0.123), 1), "12.3%");
    assert_eq!(format::format_percent(None, 1), "—");
    assert_eq!(format::format_percent(Some(f64::NAN), 1), "—");
    // Math.round 平局取 +∞（Rust 的 round() 会给 -3）
    assert_eq!(js_round(-2.5), -2.0);
    assert_eq!(js_round(2.5), 3.0);
}

// ── V 组：CSV ────────────────────────────────────────────────────
#[test]
fn v_csv_escape_and_number_text_follow_js() {
    assert_eq!(csv::csv_escape("普通"), "普通");
    assert_eq!(csv::csv_escape("a,b"), "\"a,b\"");
    assert_eq!(csv::csv_escape("a\"b"), "\"a\"\"b\"");
    assert_eq!(csv::csv_escape("a\nb"), "\"a\nb\"");
    // JS 的 String(123) 是 "123"（不是 "123.0"）—— serde_json 会写成 123.0，所以要走这个函数
    assert_eq!(csv::js_number_to_string(123.0), "123");
    assert_eq!(csv::js_number_to_string(3.5), "3.5");
    assert_eq!(csv::js_number_to_string(-0.0), "0");
}

#[test]
fn v_csv_text_has_bom_and_crlf() {
    let text = csv::build_csv_text(
        &["订单号".to_string(), "金额".to_string()],
        &[vec!["SM-1".to_string(), csv::js_number_to_string(3.5)]],
    );
    assert!(text.starts_with('\u{FEFF}'), "Excel 中文列靠 BOM 才不乱码");
    assert_eq!(text, "\u{FEFF}订单号,金额\r\nSM-1,3.5");
}

// ── D 组：目录筛选 ────────────────────────────────────────────────
fn catalog_fixture() -> Vec<catalog::Product> {
    let p = |id: &str, name: &str, price: f64, subs: Vec<&str>, spec: Option<&str>, opts: Vec<(&str, bool)>| catalog::Product {
        id: id.to_string(),
        name: name.to_string(),
        spec: spec.map(|s| s.to_string()),
        price,
        subcategories: Some(subs.into_iter().map(|s| s.to_string()).collect()),
        enabled: Some(true),
        order: Some(1.0),
        spec_options: Some(
            opts.into_iter()
                .map(|(label, enabled)| catalog::SpecOption { label: label.to_string(), enabled: Some(enabled) })
                .collect(),
        ),
    };
    vec![
        p("p_1", "软糖", 0.49, vec!["snack", "candy"], Some("袋装"), vec![("黄瓜味", true), ("烤虾味", false)]),
        p("p_2", "话梅糖", 0.09, vec!["snack", "candy"], None, vec![]),
        p("p_3", "笔记本", 6.0, vec!["study"], None, vec![]),
    ]
}

#[test]
fn d_filter_and_sort_match_customerpage() {
    let all = catalog_fixture();
    let snack_subs = vec!["snack".to_string(), "candy".to_string()];
    // 「全部」+ 顶级分类：按子分类集合命中
    let snack = catalog::filter_products(&all, &snack_subs, None, None, catalog::SortKey::Default);
    assert_eq!(snack.len(), 2);
    // 选了子分类
    let candy = catalog::filter_products(&all, &snack_subs, Some("candy"), None, catalog::SortKey::Default);
    assert_eq!(candy.len(), 2);
    // 注意：subId 的「必须属于当前顶级分类」是 useShopFilters 做的归一化
    // （不属于当前分类的 subId 会被折成「全部」）。筛选层只做一件事：subcategories.includes(subId)。
    // 把归一化混进筛选层，会让「同一个 subId 在两个分类下都合法」这种输入产生未定义行为。
    let study = catalog::filter_products(&all, &snack_subs, Some("study"), None, catalog::SortKey::Default);
    assert_eq!(study.len(), 1, "筛选层只认 subcategories.includes(subId)");
    // 归一化后的语义：不属于当前顶级分类 ⇒ 折成「全部」，此时按 topSubIds 判定 ⇒ 看不到 study
    let fallback = catalog::filter_products(&all, &snack_subs, None, None, catalog::SortKey::Default);
    assert!(!fallback.iter().any(|p| p.id == "p_3"));
    // 关键字：名字命中
    let by_name = catalog::filter_products(&all, &snack_subs, None, Some("话梅"), catalog::SortKey::Default);
    assert_eq!(by_name.len(), 1);
    assert_eq!(by_name[0].id, "p_2");
    // 关键字：口味命中（后台关掉的口味不参与匹配 —— 烤虾味搜不到）
    let by_flavor = catalog::filter_products(&all, &snack_subs, None, Some("黄瓜"), catalog::SortKey::Default);
    assert_eq!(by_flavor.len(), 1);
    let by_disabled_flavor = catalog::filter_products(&all, &snack_subs, None, Some("烤虾"), catalog::SortKey::Default);
    assert_eq!(by_disabled_flavor.len(), 0);
    // 排序：价格升/降；Default 保持上游顺序
    let asc = catalog::filter_products(&all, &snack_subs, None, None, catalog::SortKey::PriceAsc);
    assert_eq!(asc.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["p_2", "p_1"]);
    let desc = catalog::filter_products(&all, &snack_subs, None, None, catalog::SortKey::PriceDesc);
    assert_eq!(desc.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["p_1", "p_2"]);
    // 非法排序键归零
    assert_eq!(catalog::SortKey::parse("nonsense"), catalog::SortKey::Default);
}

#[test]
fn d_prepared_index_agrees_with_direct_filter() {
    // 预计算索引是「同一判定的另一种实现」，两者必须给出逐位相同的下标序列。
    let all = catalog_fixture();
    let prepared = catalog::prepare(&all);
    let top = vec!["snack".to_string(), "candy".to_string(), "drink".to_string()];
    for (sub, q, sort) in [
        (None, None, catalog::SortKey::Default),
        (Some("candy"), None, catalog::SortKey::Default),
        (None, Some("糖"), catalog::SortKey::Default),
        (None, Some("黄瓜"), catalog::SortKey::Default),
        (None, Some("烤虾"), catalog::SortKey::Default),
        (None, None, catalog::SortKey::PriceAsc),
        (None, None, catalog::SortKey::PriceDesc),
        (None, Some("话梅"), catalog::SortKey::PriceDesc),
        (Some("study"), None, catalog::SortKey::PriceAsc),
    ] {
        let direct = catalog::filter_indices(&all, &top, sub, q, sort);
        let fast = catalog::query_prepared(&prepared, &top, sub, q, sort);
        assert_eq!(direct, fast, "sub={:?} q={:?} sort={:?}", sub, q, sort);
    }
}

#[test]
fn d_suggestions_take_five_and_ignore_empty_query() {
    let all = catalog_fixture();
    assert!(catalog::suggestions(&all, "", 5).is_empty());
    let hit = catalog::suggestions(&all, "糖", 5);
    assert_eq!(hit.len(), 2);
    assert_eq!(catalog::suggestions(&all, "糖", 1).len(), 1);
    assert_eq!(catalog::spec_search_text(&all[0]), "袋装 黄瓜味");
}
