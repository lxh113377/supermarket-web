//! CORS —— 与现网 `functions/lib/security.js` 的 `resolveCorsHeaders` 逐字对齐。
//!
//! 两处「看起来可以简化、其实不能」的地方：
//!   1. **不回显任意 Origin**：只有白名单（两个部署域名 + 本地开发 + env 追加）才回写
//!      `Access-Control-Allow-Origin`。把它写成 `*` 是能力提升的反面：顾客端带的
//!      凭据语义会变，且等于对任意站点开放读接口。
//!   2. **`Vary: Origin` 必须常发**（即便这次没命中也发）：CDN 若把「命中的那个响应」
//!      缓存下来给别的 Origin 用，就会变成跨源串号。

/// 与现网 `DEFAULT_ALLOWED_ORIGINS` 同值。
pub const DEFAULT_ALLOWED_ORIGINS: [&str; 2] = [
    "https://supermarket-web.pages.dev",
    "https://lxh113377.github.io",
];

/// 本地开发源：`^https?://(localhost|127\.0\.0\.1)(:\d+)?$`（不用正则，手写等价判定）。
pub fn is_local_dev(origin: &str) -> bool {
    let rest = match origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://")) {
        Some(r) => r,
        None => return false,
    };
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if !matches!(host, "localhost" | "127.0.0.1") {
        return false;
    }
    match port {
        None => true,
        Some(p) => !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()),
    }
}

/// 是否放行该 Origin。
pub fn origin_allowed(origin: &str, extra: &[String]) -> bool {
    if origin.is_empty() {
        return false;
    }
    if is_local_dev(origin) {
        return true;
    }
    DEFAULT_ALLOWED_ORIGINS.iter().any(|o| *o == origin) || extra.iter().any(|o| o == origin)
}

/// 生成 CORS 头（顺序与现网一致，便于文本对账）。
pub fn cors_headers(origin: &str, extra: &[String]) -> Vec<(String, String)> {
    let mut out = vec![
        ("Access-Control-Allow-Methods".to_string(), "POST, OPTIONS".to_string()),
        ("Access-Control-Allow-Headers".to_string(), "Content-Type".to_string()),
        ("Vary".to_string(), "Origin".to_string()),
    ];
    if origin_allowed(origin, extra) {
        out.insert(0, ("Access-Control-Allow-Origin".to_string(), origin.to_string()));
    }
    out
}
