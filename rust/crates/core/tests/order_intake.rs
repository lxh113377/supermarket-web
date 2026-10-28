//! 下单纯计算层的用例。**参考值全部先用 node 按现网同一段逻辑现算**再写进来（不手算），
//! 其中 fnv1a 顺便对上了三个标准向量（空串 / "a" / "foobar"）——那三个值是 FNV-1a 的公开测试向量。

use serde_json::json;
use supermarket_core::order_intake::{
    allowed_order_specs, best_promotion, below_min_delivery, fingerprint_lines, fnv1a,
    idempotency_key, is_safe_image_url, js_to_fixed2, line_total, order_fingerprint,
    quantity_over_limit, resolve_order_spec, round2, slice_utf16, statement_payload_chars,
    valid_quantity, MAX_STATEMENT_PAYLOAD_CHARS,
};

#[test]
fn j_fnv1a_matches_js_and_public_vectors() {
    // node -e "…现网同一段 fnv1a…" 的结果
    assert_eq!(fnv1a(""), "811c9dc5");
    assert_eq!(fnv1a("a"), "e40c292c");
    assert_eq!(fnv1a("foobar"), "bf9cf968");
    // 中文要按 UTF-16 码元走（与 JS charCodeAt 同）
    assert_eq!(fnv1a("可乐").len(), 8);
}

#[test]
fn j_to_fixed2_matches_js_including_negative_zero() {
    assert_eq!(js_to_fixed2(7.98), "7.98");
    assert_eq!(js_to_fixed2(7.0), "7.00");
    assert_eq!(js_to_fixed2(0.0), "0.00");
    // JS：(-0).toFixed(2) 是 "0.00"（负零不带负号）
    assert_eq!(js_to_fixed2(-0.0), "0.00");
    assert_eq!(js_to_fixed2(f64::NAN), "NaN");
    assert_eq!(js_to_fixed2(f64::INFINITY), "Infinity");
}

#[test]
fn j_fingerprint_matches_the_worked_example() {
    let items = vec![
        json!({ "productId": "p1", "quantity": 2, "spec": "" }),
        json!({ "productId": "p2", "quantity": 1, "spec": "500ml · 黄瓜味" }),
    ];
    assert_eq!(fingerprint_lines(&items), "p1x2@,p2x1@500ml · 黄瓜味");
    let fp = order_fingerprint(
        "36-1116",
        "wx1",
        "",
        7.98,
        &items,
        Some(&json!("012345678901")),
    );
    // node 现算的指纹串（NUL 用 \u0000 表示）
    assert_eq!(
        fp,
        "36-1116\u{0}wx1\u{0}\u{0}7.98\u{0}p1x2@,p2x1@500ml · 黄瓜味\u{0}#12"
    );
    // 指纹里带着截图的长度；截图不是字符串时该段为空
    let no_shot = order_fingerprint("36-1116", "wx1", "", 7.98, &items, None);
    assert!(no_shot.ends_with("\u{0}"));
    assert_eq!(fnv1a(&fp), "4d6dba70");
}

#[test]
fn j_fingerprint_order_of_lines_does_not_matter() {
    let a = vec![
        json!({ "productId": "p1", "quantity": 2, "spec": "" }),
        json!({ "productId": "p2", "quantity": 1, "spec": "" }),
    ];
    let b = vec![a[1].clone(), a[0].clone()];
    assert_eq!(fingerprint_lines(&a), fingerprint_lines(&b));
}

#[test]
fn j_idempotency_key_matches_the_worked_example() {
    // node：房间号 trim + requestId + '#' + fnv1a('abc')
    assert_eq!(
        idempotency_key(" 36-1116 ", Some(&json!("req-1")), "abc").unwrap(),
        "36-1116@req-1#1a47e90b"
    );
    // 非字符串 / 过滤后为空 ⇒ None（走指纹去重路径）
    assert!(idempotency_key("36-1116", Some(&json!(42)), "abc").is_none());
    assert!(idempotency_key("36-1116", Some(&json!("///")), "abc").is_none());
    assert!(idempotency_key("36-1116", None, "abc").is_none());
    // 白名单字符保留 : . - 与下划线；超长截断到 64
    let long = "a".repeat(80);
    let key = idempotency_key("36-1116", Some(&json!(long)), "abc").unwrap();
    assert_eq!(key.split('@').nth(1).unwrap().split('#').next().unwrap().len(), 64);
    assert!(idempotency_key("36-1116", Some(&json!("a:b.c-d_e")), "x").unwrap().contains("a:b.c-d_e"));
}

#[test]
fn j_spec_resolution_follows_the_whitelist() {
    let p = json!({
        "spec": "500ml",
        "specOptions": "[{\"label\":\"黄瓜味\"},{\"label\":\"烤虾味\"},{\"label\":\"停用味\",\"enabled\":false}]"
    });
    assert_eq!(
        allowed_order_specs(&p),
        vec![
            "500ml".to_string(),
            "500ml · 黄瓜味".to_string(),
            "500ml · 烤虾味".to_string()
        ]
    );
    // 合法口味 / 目录 spec / 非法串回落 / 空串回落 / 未启用口味回落
    assert_eq!(resolve_order_spec(&p, Some(&json!("500ml · 黄瓜味"))), "500ml · 黄瓜味");
    assert_eq!(resolve_order_spec(&p, Some(&json!("500ml"))), "500ml");
    assert_eq!(resolve_order_spec(&p, Some(&json!("伪造味"))), "500ml");
    assert_eq!(resolve_order_spec(&p, Some(&json!(""))), "500ml");
    assert_eq!(resolve_order_spec(&p, Some(&json!("500ml · 停用味"))), "500ml");
    assert_eq!(resolve_order_spec(&p, None), "500ml");
    // 目录 spec 为空时，口味本身就是取值
    let q = json!({ "spec": "", "specOptions": "[{\"label\":\"微辣\"}]" });
    assert_eq!(resolve_order_spec(&q, Some(&json!("微辣"))), "微辣");
}

#[test]
fn j_best_promotion_picks_max_discount_and_clamps() {
    let rows = vec![
        json!({ "_id": "a", "threshold": 20, "discount": 3 }),
        json!({ "_id": "b", "threshold": 10, "discount": 2 }),
        json!({ "_id": "c", "threshold": 0, "discount": 9 }),   // 门槛 0 ⇒ 跳过
        json!({ "_id": "d", "threshold": 5, "discount": 0 }),   // 优惠 0 ⇒ 跳过
        json!({ "_id": "e", "threshold": "15", "discount": "4" }),
    ];
    // 小计 12：只有 b(门槛10/减2) 与 e(门槛15，不满足) ⇒ b
    assert_eq!(best_promotion(&rows, 12.0), ("b".to_string(), 2.0));
    // 小计 30：a(3) vs b(2) vs e(4) ⇒ e 最大
    assert_eq!(best_promotion(&rows, 30.0), ("e".to_string(), 4.0));
    // 小计 16：e 命中但 min(4, 16) = 4
    assert_eq!(best_promotion(&rows, 16.0), ("e".to_string(), 4.0));
    // 小计 3：都被门槛挡掉 ⇒ 零优惠
    assert_eq!(best_promotion(&rows, 3.0), (String::new(), 0.0));
    // 同额优惠先到者胜（严格大于才替换）
    let tie = vec![
        json!({ "_id": "x", "threshold": 1, "discount": 5 }),
        json!({ "_id": "y", "threshold": 1, "discount": 5 }),
    ];
    assert_eq!(best_promotion(&tie, 10.0), ("x".to_string(), 5.0));
    // min(dc, subtotal)：小计不足优惠额时按小计封顶。
    // 注意这里**不是** "x"：现网比的是**已经被 clamp 的** best.discountAmount，
    // 于是第二档的原始 dc(5) 仍大于 2 ⇒ 覆盖 ⇒ 返回 y（同额档位在封顶场景下后到者胜）。
    // 这条不直观，但照抄才是等价的 —— 我第一版期望就写错了，判据把它抓了出来。
    assert_eq!(best_promotion(&tie, 2.0), ("y".to_string(), 2.0));
}

#[test]
fn j_image_url_whitelist_is_three_segments() {
    assert!(is_safe_image_url("data:image/png;base64,AAA+/="));
    assert!(is_safe_image_url("data:image/jpeg;base64,AAA"));
    assert!(is_safe_image_url("r2:orders/2026/a.png"));
    assert!(is_safe_image_url("https://example.com/x.png"));
    // 反例
    assert!(!is_safe_image_url(""));
    assert!(!is_safe_image_url("data:image/bmp;base64,AAA"));   // 类型不在白名单
    assert!(!is_safe_image_url("data:image/png;base64,AAA;DROP")); // 字符集外
    assert!(!is_safe_image_url("r2:../etc/passwd"));             // 不许 ..
    assert!(!is_safe_image_url("http://example.com/x.png"));     // 非 https
    assert!(!is_safe_image_url("javascript:alert(1)"));
}

#[test]
fn j_payload_chars_matches_js_json_stringify_length() {
    let items = vec![json!({
        "productId": "p1", "name": "可乐", "spec": "", "price": 3.5, "quantity": 2, "subcategories": []
    })];
    // node：JSON.stringify({room,wechat,remark,items,shot}).length = 150
    assert_eq!(statement_payload_chars("36-1116", "wx1", "", &items, ""), 150);
    assert_eq!(MAX_STATEMENT_PAYLOAD_CHARS, 90_000);
}

#[test]
fn j_pricing_and_quantity_guards() {
    assert_eq!(line_total(3.5, 2), 7.0);
    assert_eq!(round2(7.9849999), 7.98);
    assert_eq!(round2(2.675), 2.68); // Math.round(267.5)/100 = 2.68（JS 向 +∞）
    assert!(valid_quantity(2.0));
    assert!(!valid_quantity(0.0));
    assert!(!valid_quantity(-1.0));
    assert!(!valid_quantity(1.5));
    assert!(!valid_quantity(f64::NAN));
    assert!(!quantity_over_limit(99));
    assert!(quantity_over_limit(100));
    // 起送门槛 6 元（折前）
    assert!(below_min_delivery(5.99));
    assert!(!below_min_delivery(6.0));
}

#[test]
fn j_to_fixed2_rounds_half_up_like_js() {
    // 复核子代理点名、我用 cargo 真跑 + node 对照确认过的分歧：
    // Rust 的 format!("{:.2}") 对恰好半值走「半偶」⇒ 0.125 给 "0.12"，而 JS 的 toFixed 是「半值向上」⇒ "0.13"。
    assert_eq!(js_to_fixed2(0.125), "0.13");
    assert_eq!(js_to_fixed2(2.675), "2.67");
    assert_eq!(js_to_fixed2(1.005), "1.00");
}

#[test]
fn j_payload_chars_counts_integral_prices_like_js() {
    // node：JSON.stringify({room:'201',wechat:'wx',remark:'',items:[{...price:3,quantity:2...}],shot:''}).length = 143
    // 若把 price 当 f64 直接序列化会打成 "3.0" ⇒ 长度 145（差 2）—— 体积守卫会算偏。
    let items = vec![json!({
        "productId": "p1", "name": "可乐", "spec": "", "price": 3.0, "quantity": 2, "subcategories": []
    })];
    assert_eq!(statement_payload_chars("201", "wx", "", &items, ""), 143);
}

#[test]
fn j_image_url_rejects_empty_host_and_accepts_upper_scheme() {
    // JS 的 new URL("https:///x") hostname 为空 ⇒ 拒；scheme 大小写不敏感 ⇒ HTTPS 收
    assert!(!is_safe_image_url("https:///x"));
    assert!(is_safe_image_url("HTTPS://example.com/x.png"));
}

#[test]
fn j_slice_utf16_never_splits_a_surrogate_pair() {
    // JS 的 slice 会把 emoji 劈成孤立代理项（'a🏠b'.slice(0,2) 是 "a" + 高代理）；
    // Rust 的 String 不允许孤立代理项 ⇒ 本实现选择**不劈**（宁可少一个字符，也不产生坏串）。
    // 这是本文件里唯一一处「与现网行为刻意不同」的地方，写在这里免得后人以为是漏抄。
    assert_eq!(slice_utf16("a🏠b", 2), "a");
    assert_eq!(slice_utf16("a🏠b", 3), "a🏠");
    assert_eq!(slice_utf16("36-1116", 40), "36-1116");
}
