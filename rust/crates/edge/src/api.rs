//! /web、/pub、/_health、/api/* 的网关。
//!
//! ## 迁移形态：**透传优先，原生按动作逐个替换**
//!
//! 现网有 45 个动作（36 管理 + 9 公开），每个动作背后是真实的 SQL、幂等指纹、
//! 并发校验与审计。一次性全部用 Rust 重写，等于在**没有回归网**的前提下改掉整条
//! 下单链 —— 那不是重写，那是拿线上做实验。
//!
//! 所以这里的默认行为是**字节级透传**上游 Functions（同一个 `/web` `/pub` 契约、
//! 同一份 D1、同一套错误码）。它带来两样东西：
//!   1. 迁移当天就是「接口契约 100% 不变」——因为响应的字节来自现网实现本身；
//!   2. 每替换一个动作，都能用「重写前/后同输入对账」把它钉住（见 docs/05 §对账）。
//!
//! 原生实现的只有两类：
//!   * `/_health`：无状态、可本地验证、且它是探活判据本身（值得自己算）；
//!   * `/pub` 里三个**带 cacheKey 的公开读**：边缘微缓存（60s，键含动作与载荷），
//!     命中时不再回源。注意缓存的是**上游响应的原始字节**，不是重新拼的 JSON ——
//!     于是「缓存命中」与「回源」在任何字段、任何顺序上都不可能不同。

use crate::api_admin;
use crate::api_native;
use crate::config::Config;
use crate::cors::cors_headers;
use crate::d1::D1Client;
use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 现网 `PUBLIC_ACTIONS`（functions/lib/backend.js）——`/pub` 的白名单。
pub const PUBLIC_ACTIONS: [&str; 9] = [
    "createOrder",
    "getReviews",
    "createSubmission",
    "addPublicReview",
    "getPublicProducts",
    "getPublicCategories",
    "aiChat",
    "getOrderStatus",
    "getCatalogOrders",
];

/// 现网带 `cacheKey` 的公开读动作（docs/api-contract.json）——只有这三个值得边缘缓存。
/// 写动作**永不缓存**：缓存写响应等于把「下单成功」当成可重放的结果。
pub const PUBLIC_READ_CACHEABLE: [&str; 3] =
    ["getPublicProducts", "getPublicCategories", "getCatalogOrders"];

/// /web 侧可微缓存的动作（现网用 KV 包着的那一个：getDashboardStats，TTL 60s）。
/// 其余管理读**不进缓存**（现网也没缓存它们）。
const ADMIN_READ_CACHEABLE: [&str; 1] = ["getDashboardStats"];

/// 端点。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endpoint {
    Web,
    Pub,
}

impl Endpoint {
    pub fn path(self) -> &'static str {
        match self {
            Endpoint::Web => "/web",
            Endpoint::Pub => "/pub",
        }
    }
}

/// 上游响应缓存条目（**原始字节**，这就是「命中不可能与回源不同」的原因）。
pub struct CacheEntry {
    pub body: Bytes,
    pub status: u16,
    pub content_type: Option<HeaderValue>,
    pub stored: Instant,
}

/// 应用状态。
pub struct App {
    pub cfg: Config,
    pub assets: crate::assets::AssetStore,
    pub policy: crate::policy::Policy,
    pub shell: crate::shell::Shell,
    pub d1: Option<D1Client>,
    pub http: reqwest::Client,
    pub cache: tokio::sync::Mutex<HashMap<String, CacheEntry>>,
    pub started: Instant,
    pub cache_hits: std::sync::atomic::AtomicU64,
    pub cache_misses: std::sync::atomic::AtomicU64,
}

/// 构造失败 = 启动失败（宁可起不来，也不要「起来了但资产是旧的」这种静默故障）。
pub fn build_app(cfg: Config) -> Result<Arc<App>, String> {
    let headers_file = cfg.dist.join("_headers");
    let policy = std::fs::read_to_string(&headers_file)
        .map(|text| crate::policy::Policy::parse(&text))
        .unwrap_or_default();
    let assets = crate::assets::AssetStore::load(&cfg.dist, &policy)
        .map_err(|e| format!("扫描 {} 失败：{}", cfg.dist.display(), e))?;
    let shell = crate::shell::build(&cfg, &assets)?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败：{}", e))?;
    let d1 = cfg.d1.as_ref().map(D1Client::new);
    Ok(Arc::new(App {
        cfg,
        assets,
        policy,
        shell,
        d1,
        http,
        cache: tokio::sync::Mutex::new(HashMap::new()),
        started: Instant::now(),
        cache_hits: std::sync::atomic::AtomicU64::new(0),
        cache_misses: std::sync::atomic::AtomicU64::new(0),
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 通用小工具
// ─────────────────────────────────────────────────────────────────────────────

/// 与现网 `traceIdOf` + `sanitizeTrace` 同口径：取 `cf-ray` / `x-request-id`，
/// 只保留 `[\w:.-]`，截断 64 —— 不原样回显请求头里的任意内容。
pub fn trace_of(headers: &HeaderMap) -> Option<String> {
    let raw = headers
        .get("cf-ray")
        .or_else(|| headers.get("x-request-id"))
        .and_then(|v| v.to_str().ok())?;
    let filtered: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '.' | '-' | '_'))
        .take(64)
        .collect();
    if filtered.is_empty() {
        None
    } else {
        Some(filtered)
    }
}

/// 把 CORS 头与业务头写进响应。
pub fn json_response(status: StatusCode, body: Bytes, headers: Vec<(String, String)>) -> Response {
    let mut builder = Response::builder().status(status).header("content-type", "application/json");
    for (k, v) in headers {
        // 头部值非法（含换行等）时跳过而不是 500：一个坏头不该让整个请求失败。
        if let Ok(value) = HeaderValue::from_str(&v) {
            builder = builder.header(k, value);
        }
    }
    builder.body(axum::body::Body::from(body)).unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(axum::body::Body::from("{}"))
            .expect("最小响应构建不可能失败")
    })
}

/// 失败响应：走 core 的封套（code:-1 红线 + 查表状态），并带 CORS。
pub fn fail_response(
    error_code: &str,
    message: &str,
    origin: &str,
    extra_allowed: &[String],
) -> Response {
    let payload = supermarket_core::errors::fail(error_code, message, Default::default());
    let status = StatusCode::from_u16(supermarket_core::errors::http_status_of(Some(error_code)))
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut headers: Vec<(String, String)> = vec![];
    if error_code == "rate_limited" {
        headers.push((
            "retry-after".to_string(),
            supermarket_core::errors::retry_after_seconds(None).to_string(),
        ));
    }
    headers.extend(cors_headers(origin, extra_allowed));
    json_response(status, Bytes::from(payload.to_string()), headers)
}

/// 请求体上限：与现网 `payload_too_large` 的语义对齐（评价晒图 base64 ≤3×800 KB，
/// 留出三倍余量）。超限不是「截断」，而是明确拒绝 —— 截断会让 JSON 解析出一个坏形状。
pub const MAX_BODY: usize = 12 * 1024 * 1024;

/// 微缓存键：动作 + **原样载荷字节**。
///
/// 为什么用原始字节而不是重新序列化的 JSON：`{"a":1,"b":2}` 与 `{"b":2,"a":1}`
/// 语义相同但字节不同，用字节当键只会「少命中一次」，绝不会「错误命中」——
/// 后者才是缓存类事故的形态（串号）。宁可少命中。
pub fn cache_key(endpoint: Endpoint, action: Option<&str>, body: &[u8]) -> String {
    let mut key = String::with_capacity(body.len() + 32);
    key.push_str(endpoint.path());
    key.push(':');
    key.push_str(action.unwrap_or("-"));
    key.push(':');
    // 载荷可能很大（订单含商品快照），这里只把前 512 字节纳入键：
    // 公开读动作的区分度全在前 512 字节（action 与分页/筛选参数），
    // 且键不进日志、只做内存哈希。
    for b in body.iter().take(512) {
        key.push(*b as char);
    }
    key
}

/// 网关主入口。
pub async fn handle_gateway(
    app: &Arc<App>,
    endpoint: Endpoint,
    headers: &HeaderMap,
    body: Bytes,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok()).unwrap_or("");
    let allowed = app.cfg.allowed_origins.clone();
    let cors = cors_headers(origin, &allowed);

    // ① 请求体必须是合法 JSON：与现网 `web.js`/`pub.js` 的 invalid_json 分支同判据、同文案。
    let parsed: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return fail_response("invalid_json", "无效的 JSON 请求体", origin, &allowed),
    };
    let action = parsed.get("action").and_then(|a| a.as_str()).map(|s| s.to_string());

    // ② /pub 白名单：与现网 handlePublic 的第一道判据一致（不在白名单 → action_not_public / 403）。
    if endpoint == Endpoint::Pub {
        match action.as_deref() {
            Some(a) if PUBLIC_ACTIONS.contains(&a) => {}
            _ => {
                return fail_response("action_not_public", "该动作不对外开放", origin, &allowed)
            }
        }
    }

    // ③ 微缓存（只缓存「原始字节 / 原生结果」）。两处可缓存面：
    //    · /pub 的三个公开读（对应上游 KV cache:public:*）；
    //    · /web 的 getDashboardStats（对应上游 KV cache:dashboard:stats:<rangeDays>，TTL 60s）。
    // 注意 admin 侧的键要带 payload（rangeDays 不同 ⇒ 结果不同）：cache_key 已经把请求体算进去了 ✓。
    let admin_cacheable = endpoint == Endpoint::Web
        && action
            .as_deref()
            .map(|a| ADMIN_READ_CACHEABLE.contains(&a))
            .unwrap_or(false);
    let cacheable = (endpoint == Endpoint::Pub
        && action
            .as_deref()
            .map(|a| PUBLIC_READ_CACHEABLE.contains(&a))
            .unwrap_or(false))
        || admin_cacheable
        && app.cfg.api_cache_ttl_ms > 0;
    let key = cacheable.then(|| cache_key(endpoint, action.as_deref(), &body));
    if let Some(key) = &key {
        let guard = app.cache.lock().await;
        if let Some(entry) = guard.get(key) {
            if entry.stored.elapsed() < Duration::from_millis(app.cfg.api_cache_ttl_ms) {
                app.cache_hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let mut out_headers: Vec<(String, String)> = cors.clone();
                out_headers.push(("x-edge-cache".to_string(), "hit".to_string()));
                return json_response(
                    StatusCode::from_u16(entry.status).unwrap_or(StatusCode::OK),
                    entry.body.clone(),
                    out_headers,
                );
            }
        }
    }
    let _ = &key;

    // ④b 原生实现（默认关，见 api_native.rs 的文件头）。
    //
    // 位置刻意放在「透传上游」之前、微缓存之后：
    //   · 在缓存之后 —— 原生命中同样吃 60s 微缓存（对应上游 KV 的 cache:public:*）；
    //   · 在透传之前 —— 这样即使没配 FUNCTIONS_ORIGIN，原生动作也能独立服务；
    //   · 取不到（D1 未配/查询失败）就**掉到透传**，客户端拿到的仍是正确数据。
    // ④c 管理端原生实现（默认关，见 api_admin.rs 的文件头）。
    //     顺序与现网一致：**先鉴权、再只读档、最后派发**；审计只写「鉴权失败」与「登录/写动作」。
    //     开关独立于 /pub（NATIVE_ADMIN_ACTIONS）：管理端的爆炸半径更大，不该被公开读的开关带上。
    if endpoint == Endpoint::Web {
        if let Some(a) = action.as_deref() {
            if api_admin::admin_native_enabled(a) {
                let admin_key = parsed.get("adminKey").and_then(|k| k.as_str());
                let payload = parsed.get("payload");
                let ip = api_admin::client_ip(headers);
                if let Some(value) = api_admin::call_admin(app, a, admin_key, payload, &ip).await {
                    let bytes = Bytes::from(value.to_string());
                    let status = StatusCode::from_u16(supermarket_core::contract::status_of(&value))
                        .unwrap_or(StatusCode::OK);
                    let mut out_headers: Vec<(String, String)> = cors.clone();
                    out_headers.push(("x-edge".to_string(), "native".to_string()));
                    return json_response(status, bytes, out_headers);
                }
            }
        }
    }

    if endpoint == Endpoint::Pub {
        if let Some(a) = action.as_deref() {
            // ②c /pub 的写动作（createOrder）：**先限流、再下单**，且永不进缓存
            //     （缓存写响应等于把「下单成功」当成可重放的结果 —— 这是本仓的显式红线）。
            // **默认关**：这是公开写动作用户可见的关键路径，判据（mock 只打本地的写用例）没就位前不许默认生效。
            // 打开方式与 admin 侧同风格：环境变量 NATIVE_PUB_WRITE 里列动作名（逗号分隔）。
            // addPublicReview：现网就是 addReview 的直接复用（backend.js:153），差别只在入口 ——
            // 公开面免鉴权、有写限流（rate:write:<ip>）、**不落管理端审计**（审计只挂 handleAdmin）。
            if a == "addPublicReview" && crate::api_pub_order::pub_write_native_enabled(a) {
                if let Some(d1) = app.d1.as_ref() {
                    let bucket = format!("rate:write:{}", crate::api_admin::client_ip(headers));
                    let limited = crate::api_pub_order::check_rate_db(
                        d1,
                        &bucket,
                        crate::api_pub_order::RATE_PUBLIC_WRITE_WINDOW_MS,
                        crate::api_pub_order::RATE_PUBLIC_WRITE_MAX,
                    )
                    .await;
                    let value = match limited {
                        Some(env) => env,
                        None => crate::api_admin::add_review(d1, parsed.get("payload")).await.unwrap_or_else(|| {
                            supermarket_core::errors::fail(
                                "internal_error",
                                "服务暂时不可用，请稍后重试",
                                Default::default(),
                            )
                        }),
                    };
                    let bytes = Bytes::from(value.to_string());
                    let status = StatusCode::from_u16(supermarket_core::contract::status_of(&value))
                        .unwrap_or(StatusCode::OK);
                    let mut out_headers: Vec<(String, String)> = cors.clone();
                    out_headers.push(("x-edge".to_string(), "native".to_string()));
                    return json_response(status, bytes, out_headers);
                }
            }
            if a == "createOrder" && crate::api_pub_order::pub_write_native_enabled(a) {
                if let Some(d1) = app.d1.as_ref() {
                    let bucket = format!("rate:write:{}", crate::api_admin::client_ip(headers));
                    let limited = crate::api_pub_order::check_rate_db(
                        d1,
                        &bucket,
                        crate::api_pub_order::RATE_PUBLIC_WRITE_WINDOW_MS,
                        crate::api_pub_order::RATE_PUBLIC_WRITE_MAX,
                    )
                    .await;
                    let value = match limited {
                        Some(env) => env,
                        None => crate::api_pub_order::create_order(d1, parsed.get("payload")).await,
                    };
                    let bytes = Bytes::from(value.to_string());
                    let status = StatusCode::from_u16(supermarket_core::contract::status_of(&value))
                        .unwrap_or(StatusCode::OK);
                    let mut out_headers: Vec<(String, String)> = cors.clone();
                    out_headers.push(("x-edge".to_string(), "native".to_string()));
                    return json_response(status, bytes, out_headers);
                }
            }
            if api_native::native_enabled(a) {
                // 现网从这里取载荷（handlePublic/handleWeb 也是 parsed.payload）；
                // 缺 payload 时给 None —— 由动作自己按现网语义判 missing_*（不在这里猜）
                let payload = parsed.get("payload");
                if let Some(value) = api_native::call(app, a, payload).await {
                    let bytes = Bytes::from(value.to_string());
                    // 状态由封套决定（成功 200、失败按 errorCode 查 42 条表），而不是恒 200
                    let status = StatusCode::from_u16(supermarket_core::contract::status_of(&value))
                        .unwrap_or(StatusCode::OK);
                    if let Some(key) = &key {
                        if supermarket_core::contract::is_success(&value) {
                            let mut guard = app.cache.lock().await;
                            guard.insert(
                                key.clone(),
                                CacheEntry {
                                    body: bytes.clone(),
                                    status: status.as_u16(),
                                    content_type: None,
                                    stored: Instant::now(),
                                },
                            );
                        }
                    }
                    let mut out_headers: Vec<(String, String)> = cors.clone();
                    out_headers.push(("x-edge".to_string(), "native".to_string()));
                    return json_response(status, bytes, out_headers);
                }
            }
        }
    }

    // ④ 透传上游（未配置上游时明确报错，不假装成功）。
    let Some(origin_base) = app.cfg.functions_origin.clone() else {
        return fail_response(
            "internal_error",
            "上游 Functions 未配置：请设置 FUNCTIONS_ORIGIN（本地无上游时 API 不可用是既定行为，不是静默降级）",
            origin,
            &allowed,
        );
    };
    let url = format!("{}{}", origin_base.trim_end_matches('/'), endpoint.path());
    let mut request = app.http.post(&url).body(body.clone());
    if let Some(ct) = headers.get("content-type") {
        request = request.header("content-type", ct);
    }
    if let Some(o) = headers.get("origin") {
        request = request.header("origin", o);
    }
    if let Some(trace) = trace_of(headers) {
        request = request.header("x-request-id", trace);
    }

    match request.send().await {
        Ok(upstream) => {
            let status = upstream.status();
            let upstream_headers = upstream.headers().clone();
            let content_type = upstream_headers
                .get("content-type")
                .cloned()
                .unwrap_or_else(|| HeaderValue::from_static("application/json"));
            match upstream.bytes().await {
                Ok(bytes) => {
                    let mut out_headers: Vec<(String, String)> = cors.clone();
                    for (name, value) in upstream_headers.iter() {
                        let n = name.as_str();
                        // CORS 三件套以我们的解析为准（同值，但避免上游与本地两份判据打架）；
                        // 其余头（含 Retry-After）原样带回。
                        if n.starts_with("access-control-") || n == "vary" {
                            continue;
                        }
                        if let Ok(v) = value.to_str() {
                            out_headers.push((n.to_string(), v.to_string()));
                        }
                    }
                    if cacheable {
                        if let Some(key) = key {
                            app.cache_misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                            let mut guard = app.cache.lock().await;
                            guard.insert(
                                key,
                                CacheEntry {
                                    body: bytes.clone(),
                                    status: status.as_u16(),
                                    content_type: Some(content_type.clone()),
                                    stored: Instant::now(),
                                },
                            );
                        }
                    }
                    out_headers.push(("x-edge".to_string(), "passthrough".to_string()));
                    json_response(status, bytes, out_headers)
                }
                Err(e) => fail_response(
                    "internal_error",
                    &format!("上游响应读取失败：{}", e),
                    origin,
                    &allowed,
                ),
            }
        }
        Err(e) => fail_response(
            "internal_error",
            &format!("上游不可达：{}", e),
            origin,
            &allowed,
        ),
    }
}

/// `/_health`：原生实现（与现网 `functions/_health.js` 同字段、同判据）。
///
/// `db` 三态与现网一致：`ok` / `error` / `unknown`（未配置 D1 时**不假装** ok）。
pub async fn handle_health(app: &Arc<App>) -> Response {
    let db = match &app.d1 {
        Some(client) => {
            if client.ping().await {
                "ok"
            } else {
                "error"
            }
        }
        None => "unknown",
    };
    let ts = iso_now();
    let deploy = app
        .cfg
        .deploy_sha
        .as_ref()
        .map(|sha| sha.chars().take(7).collect::<String>());
    let payload = serde_json::json!({
        "status": "ok",
        "db": db,
        "ts": ts,
        "ai": {
            "configured": app.cfg.ai_configured,
            "source": if app.cfg.ai_configured { "dify" } else { "rule" },
        },
        "deploy": deploy,
        // 边缘自有的可观测字段（纯追加，不改变既有契约）：
        "edge": {
            "uptimeSeconds": app.started.elapsed().as_secs(),
            "assets": app.assets.count(),
            "cacheHits": app.cache_hits.load(std::sync::atomic::Ordering::Relaxed),
            "cacheMisses": app.cache_misses.load(std::sync::atomic::Ordering::Relaxed),
            "inlineCss": app.shell.inline_css_bytes,
            "routePreload": app.shell.preloaded_route,
        },
    });
    json_response(
        StatusCode::OK,
        Bytes::from(payload.to_string()),
        vec![("x-edge".to_string(), "native".to_string())],
    )
}

/// `/api/*` 打印反代：与现网 `functions/api/[[path]].js` 同语义。
///
/// 两个必须去掉的头（现网注释里的实测结论）：`origin`、`sec-fetch-site` ——
/// 打印应用的 Express 侧对它们各有一道同源守卫，带过去必被 403。
pub async fn handle_print(
    app: &Arc<App>,
    path_and_query: &str,
    method: &axum::http::Method,
    headers: &HeaderMap,
    body: Bytes,
) -> Response {
    let Some(base) = app.cfg.print_origin.clone() else {
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            Bytes::from(
                serde_json::json!({
                    "success": false,
                    "error": {
                        "code": "PRINT_APP_UNAVAILABLE",
                        "message": "打印应用未配置：请设置 CAMPUS_PRINT_ORIGIN 指向该应用",
                        "fields": {},
                    }
                })
                .to_string(),
            ),
            vec![("cache-control".to_string(), "no-store".to_string())],
        );
    };
    let url = format!("{}{}", base.trim_end_matches('/'), path_and_query);
    // 方法原样透传（打印应用的 /api 有 GET 与 POST 两条腿：前者读配置，后者传文件）。
    let upstream_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let mut request = app.http.request(upstream_method, &url);
    for (name, value) in headers.iter() {
        let n = name.as_str().to_ascii_lowercase();
        if matches!(n.as_str(), "origin" | "sec-fetch-site" | "host" | "content-length" | "connection") {
            continue;
        }
        if let Ok(v) = value.to_str() {
            request = request.header(n, v);
        }
    }
    if !body.is_empty() {
        request = request.body(body);
    }
    match request.send().await {
        Ok(upstream) => {
            let status = upstream.status();
            let upstream_headers = upstream.headers().clone();
            match upstream.bytes().await {
                Ok(bytes) => {
                    let mut out: Vec<(String, String)> = Vec::new();
                    for (name, value) in upstream_headers.iter() {
                        let n = name.as_str();
                        // 传输层编码/长度由我们重算（与现网 print 反代的处理一致）
                        if matches!(n, "content-encoding" | "content-length" | "transfer-encoding") {
                            continue;
                        }
                        if let Ok(v) = value.to_str() {
                            out.push((n.to_string(), v.to_string()));
                        }
                    }
                    out.push(("x-edge".to_string(), "print-proxy".to_string()));
                    json_response(status, bytes, out)
                }
                Err(e) => json_response(
                    StatusCode::BAD_GATEWAY,
                    Bytes::from(
                        serde_json::json!({
                            "success": false,
                            "error": { "code": "PRINT_APP_UNAVAILABLE", "message": format!("打印应用响应读取失败：{}", e), "fields": {} }
                        })
                        .to_string(),
                    ),
                    vec![("cache-control".to_string(), "no-store".to_string())],
                ),
            }
        }
        Err(e) => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            Bytes::from(
                serde_json::json!({
                    "success": false,
                    "error": { "code": "PRINT_APP_UNAVAILABLE", "message": format!("打印应用不可达：{}", e), "fields": {} }
                })
                .to_string(),
            ),
            vec![("cache-control".to_string(), "no-store".to_string())],
        ),
    }
}

/// 非 POST 请求的响应体：与现网 `handlePublic` 的 `invalid_action` 同形
/// （现网只导出 onRequestPost，其它方法由 Pages 兜底；这里显式成文，便于对账）。
pub fn method_not_allowed_body() -> String {
    let payload = supermarket_core::errors::fail("invalid_action", "只支持 POST", Default::default());
    payload.to_string()
}

/// 当前时间的毫秒值（与 JS `Date.now()` 同义）。
///
/// 为什么单独一个函数：stalePendingReport 的 cutoff 与 ageMinutes 都要「同一个 now」——
/// 一个动作里调两次 SystemTime::now() 会拿到两个略不同的时刻，cutoff 与 age 就会互相错位。
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// ISO-8601 UTC（毫秒精度），与 JS `new Date().toISOString()` 的输出形状一致。
pub fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hh, mm, ss, millis
    )
}

/// Howard Hinnant 的 civil_from_days（与 `chrono` 同一算法，省掉一个日期库依赖）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
