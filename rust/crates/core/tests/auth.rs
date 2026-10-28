//! 鉴权层的用例：语义 + **四张动作表与现网 JS 的同步性**。
//!
//! 最后一条（action_sets_match_js_source）是这套判据里最值钱的一条：
//! 它去读现网源码、把 new Set([...]) 块解出来与 Rust 常量逐条比 ——
//! 抄一份常量而不判同步，等于给未来埋一个「现网加了只读动作、边缘还拒着它」的静默缺口。

use serde_json::json;
use std::fs;
use std::path::PathBuf;
use supermarket_core::auth::{
    check_auth, check_readonly, constant_time_equal, is_catalog_write_action,
    is_dashboard_write_action, is_public_action, resolve_role, Role, ADMIN_READ_ACTIONS,
    ADMIN_WRITE_ACTIONS, CATALOG_WRITE_ACTIONS, DASHBOARD_WRITE_ACTIONS, PUBLIC_ACTIONS,
};

#[test]
fn b_constant_time_equal_matches_js() {
    // 长度不等 ⇒ false（与 JS 的 TextEncoder 长度比较同义）
    assert!(!constant_time_equal("abc", "ab"));
    assert!(!constant_time_equal("supermarket-admin-2026", "supermarket-admin-2027"));
    assert!(constant_time_equal("supermarket-admin-2026", "supermarket-admin-2026"));
    // 空串 vs 空串：JS 里是 true（两者都 0 字节，diff 保持 0）
    assert!(constant_time_equal("", ""));
    // 非 ASCII 按 UTF-8 字节比
    assert!(constant_time_equal("密钥", "密钥"));
    assert!(!constant_time_equal("密钥", "密钥a"));
}

#[test]
fn b_resolve_role_prefers_admin_then_readonly() {
    let (a, r) = (Some("admin-key"), Some("read-key"));
    assert_eq!(resolve_role(Some("admin-key"), a, r), Some(Role::Admin));
    assert_eq!(resolve_role(Some("read-key"), a, r), Some(Role::Readonly));
    assert_eq!(resolve_role(Some("nope"), a, r), None);
    assert_eq!(resolve_role(None, a, r), None);
    // 只读键未配置 ⇒ 与单密钥完全等价（现网注释就是这么写的）
    assert_eq!(resolve_role(Some("read-key"), a, None), None);
    // 未配置任何键 ⇒ 一律 None（不是「空串放行」）
    assert_eq!(resolve_role(Some(""), None, None), None);
}

#[test]
fn b_check_auth_exempts_public_and_pins_the_failure_envelope() {
    // 公开动作：没密钥也放行（/web 回退路径靠的就是这个）
    assert!(check_auth("getPublicProducts", None, Some("k"), None).is_none());
    assert!(is_public_action("getCatalogOrders"));
    // 非公开 + 无密钥 ⇒ 逐字对齐现网 fail('auth_failed', '认证失败') 的键序与值
    let out = check_auth("getProducts", None, Some("k"), None).expect("必须失败");
    assert_eq!(
        serde_json::to_string(&out).unwrap(),
        "{\"code\":-1,\"errorCode\":\"auth_failed\",\"kind\":\"auth\",\"retryable\":false,\"message\":\"认证失败\"}"
    );
    assert!(check_auth("getProducts", Some("k"), Some("k"), None).is_none());
}

#[test]
fn b_check_readonly_is_whitelist_deny_by_default() {
    // 只读 + 白名单内 ⇒ 放行
    assert!(check_readonly("getProducts", Some(Role::Readonly)).is_none());
    // 只读 + 未登记（写动作）⇒ 403 readonly_denied
    let out = check_readonly("createProduct", Some(Role::Readonly)).expect("必须拒绝");
    assert_eq!(out["errorCode"], json!("readonly_denied"));
    assert_eq!(out["kind"], json!("auth"));
    assert_eq!(out["retryable"], json!(false));
    assert_eq!(out["message"], json!("只读账号不能执行该操作"));
    // 只读 + 未登记的新动作 ⇒ 同样拒：默认拒绝，而不是「不在写表里就放行」
    assert!(check_readonly("brand_new_action_2026", Some(Role::Readonly)).is_some());
    // 全权限档：写动作也放行
    assert!(check_readonly("createProduct", Some(Role::Admin)).is_none());
}

/// 把 JS 里的**内联数组字面量**（不是 new Set）解成字符串数组。
///
/// 为什么需要单独一个：现网的目录失效面是内联数组 + includes(action) 这种形状，
/// 与 new Set([...]) 不同 —— 拿 js_set 去解会 panic，而「解不出来」比「解错了」更容易被发现。
fn js_inline_array(src: &str, literal: &str) -> Vec<String> {
    let at = src.find(literal).unwrap_or_else(|| panic!("JS 里找不到内联数组 {literal}"));
    let _ = at;
    literal
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|s| s.trim().trim_matches(|c: char| c == '\u{27}' || c == '[' || c == ']' || c == ' ').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
/// 把 JS 里 new Set([...]) 块解成字符串数组（只认单引号字符串，顺带过滤注释）。
fn js_set(src: &str, decl: &str) -> Vec<String> {
    let at = src.find(decl).unwrap_or_else(|| panic!("JS 里找不到 {decl}"));
    let open = src[at..].find("new Set([").expect("不是 new Set([ 形式") + at + "new Set([".len();
    let close = src[open..].find("])").expect("缺少收尾 ])") + open;
    let body = &src[open..close];
    body.split(',')
        .map(|s| s.trim().trim_matches(|c| c == '\'' || c == '"' || c == '\n' || c == ' ' || c == ',')
            .to_string())
        .filter(|s| !s.is_empty() && !s.starts_with("//")
            && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .collect()
}

#[test]
fn b_action_sets_match_js_source() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo = root.join("..").join("..").join("..");
    let security = fs::read_to_string(repo.join("functions").join("lib").join("security.js"))
        .expect("读不到 security.js");
    let backend = fs::read_to_string(repo.join("functions").join("lib").join("backend.js"))
        .expect("读不到 backend.js");

    let mut problems = Vec::new();
    let checks: [(&str, Vec<String>, Vec<&str>); 5] = [
        ("PUBLIC_ACTIONS", js_set(&security, "export const PUBLIC_ACTIONS = new Set(["), PUBLIC_ACTIONS.to_vec()),
        ("ADMIN_READ_ACTIONS", js_set(&backend, "const ADMIN_READ_ACTIONS = new Set(["), ADMIN_READ_ACTIONS.to_vec()),
        ("ADMIN_WRITE_ACTIONS", js_set(&backend, "const ADMIN_WRITE_ACTIONS = new Set(["), ADMIN_WRITE_ACTIONS.to_vec()),
        // 第 14 轮补的第 4 张表：看板失效面（现网 backend.js:65）
        ("DASHBOARD_WRITE_ACTIONS", js_set(&backend, "const DASHBOARD_WRITE_ACTIONS = new Set(["), DASHBOARD_WRITE_ACTIONS.to_vec()),
        // 第 16 轮补的第 5 张表：目录失效面（现网 backend.js:192 是**内联数组**，不是 new Set）
        ("CATALOG_WRITE_ACTIONS", js_inline_array(&backend, "['createProduct', 'updateProduct', 'deleteProduct', 'batchUpdateProducts', 'batchDeleteProducts', 'adjustStock']"), CATALOG_WRITE_ACTIONS.to_vec()),
    ];
    assert!(is_catalog_write_action("adjustStock"));
    assert!(!is_catalog_write_action("deleteReview")); // deleteReview 在看板面、不在目录面
    // 顺手验两个判定函数与表一致（表对了、判定写错也是事故）
    assert!(is_dashboard_write_action("deleteReview"));
    assert!(!is_dashboard_write_action("getProducts"));
    for (name, js, rust) in checks {
        let mut js_sorted = js.clone();
        js_sorted.sort();
        let mut rust_sorted: Vec<String> = rust.iter().map(|s| s.to_string()).collect();
        rust_sorted.sort();
        if js_sorted != rust_sorted {
            problems.push(format!("{name}: JS {js_sorted:?} ⇄ Rust {rust_sorted:?}"));
        }
    }
    assert!(problems.is_empty(), "动作表与现网 JS 不一致（现网增删动作时 Rust 常量必须同步）：\n{}", problems.join("\n"));
}
