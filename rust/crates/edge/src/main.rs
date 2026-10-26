//! supermarket-edge —— 江科一站通的 Rust 边缘服务。
//!
//! 一次请求的完整路径（也是 docs/03 那张「优化点落在哪一格」的对照表）：
//!
//!   / 或 /index.html ──► SSR 外壳（内联样式 + 首屏路由 preload + 预压缩 + ETag/304）
//!                        └─ Link 头 → Cloudflare 转 103 Early Hints
//!   /assets/* /images/* ──► 资产索引（内容 ETag、immutable 长缓存、br/gz 预压缩变体）
//!   /web | /pub ────────► 网关（透传上游，公开读走 60s 边缘微缓存）
//!   /_health ───────────► 原生（db 探活 + 缓存命中数 + 外壳信息）
//!   /api/* ─────────────► 打印反代（去 origin / sec-fetch-site）
//!   其它 ───────────────► 目录 index.html 或 SPA 回退 / 404
//!
//! 三层「省时间」的手段各自对应可量化的指标（TTFB / 首屏字节 / FCP·LCP）：
//!   1. 流式写出 —— TTFB（第一字节不等整份 HTML 生成完）；
//!   2. 内联样式 + preload —— 首屏关键请求数与 FCP·LCP；
//!   3. 预压缩 + 长缓存 + ETag —— 传输字节与重复访问（304 零字节命中）。

mod api;
mod assets;
mod config;
mod cors;
mod d1;
mod policy;
mod shell;
mod stream;

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode};
use axum::response::Response;
use axum::routing::{any, get};
use axum::Router;
use config::{Command, Config};
use std::sync::Arc;


#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match config::parse_args(&args) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("错误：{}", e);
            eprintln!("{}", config::USAGE);
            std::process::exit(2);
        }
    };

    match command {
        Command::Help => println!("{}", config::USAGE),
        Command::PrintShell(cfg) => match api::build_app(cfg) {
            Ok(app) => {
                let report = app.shell.report();
                print!("{}", app.shell.html);
                eprintln!(
                    "[shell] html={} bytes / br={} / gz={} / 内联样式={} bytes / 首屏路由 preload={:?} / 复刻={}",
                    report.html_bytes,
                    report.brotli_bytes,
                    report.gzip_bytes,
                    report.inline_css_bytes,
                    app.shell.preloaded_route,
                    app.shell.replica
                );
            }
            Err(e) => {
                eprintln!("构建外壳失败：{}", e);
                std::process::exit(1);
            }
        },
        Command::Precompress { dir, quality, min_bytes } => match precompress_dir(&dir, quality, min_bytes) {
            Ok((br_count, gz_count, saved)) => println!(
                "预压缩完成：{} → {} 个 .br、{} 个 .gz；文本资产原始 {} 字节，压缩后 {} 字节（省 {:.1}%）",
                dir.display(),
                br_count,
                gz_count,
                saved.0,
                saved.1,
                if saved.0 == 0 { 0.0 } else { (1.0 - saved.1 as f64 / saved.0 as f64) * 100.0 }
            ),
            Err(e) => {
                eprintln!("预压缩失败：{}", e);
                std::process::exit(1);
            }
        },
        Command::Serve(cfg) => serve(cfg).await,
    }
}

async fn serve(cfg: Config) {
    let dist = cfg.dist.clone();
    let host = cfg.host.clone();
    let port = cfg.port;
    let functions_origin = cfg.functions_origin.clone();
    let print_origin = cfg.print_origin.clone();
    let api_cache_ttl_ms = cfg.api_cache_ttl_ms;
    let app = match api::build_app(cfg) {
        Ok(app) => app,
        Err(e) => {
            eprintln!("启动失败：{}", e);
            std::process::exit(1);
        }
    };

    let report = app.shell.report();
    // 启动横幅：这些数字就是 docs/05「首屏 HTML 体积」一节的读数来源，
    // 让「跑起来看一眼」与「写进文档」用的是同一次测量。
    println!("supermarket-edge 已加载");
    println!("  dist              {}", dist.display());
    println!("  资产              {} 个（_headers 规则 {} 条）", app.assets.count(), app.policy.rules.len());
    println!(
        "  首屏外壳          html {} B / brotli {} B / gzip {} B（内联样式 {} B，省掉 1 次渲染阻塞请求）",
        report.html_bytes, report.brotli_bytes, report.gzip_bytes, report.inline_css_bytes
    );
    println!("  首屏路由 preload  {:?}", app.shell.preloaded_route);
    println!("  静态复刻          {}", if app.shell.replica { "开" } else { "关" });
    println!("  /web /pub 上游    {:?}", functions_origin);
    println!("  /api 打印上游     {:?}", print_origin);
    println!("  公开读微缓存      {} ms", api_cache_ttl_ms);
    println!("  监听              http://{}:{}", host, port);

    let listener = match tokio::net::TcpListener::bind((host.as_str(), port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("监听 {}:{} 失败：{}", host, port, e);
            std::process::exit(1);
        }
    };

    let router = Router::new()
        .route("/", get(root_shell))
        .route("/index.html", get(root_shell))
        .route("/_health", get(health))
        .route("/web", any(web_any))
        .route("/pub", any(pub_any))
        .route("/api/{*rest}", any(print_proxy))
        .fallback(fallback)
        .with_state(app);

    if let Err(e) = axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            println!("收到中断信号，优雅退出");
        })
        .await
    {
        eprintln!("服务退出：{}", e);
        std::process::exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 处理器
// ─────────────────────────────────────────────────────────────────────────────

/// 首屏外壳：ETag/304 + br/gz + Link 头 + 流式分块。
async fn root_shell(State(app): State<Arc<api::App>>, req: Request<Body>) -> Response {
    let headers = req.headers().clone();
    let shell = &app.shell;
    let mut out: Vec<(String, String)> = security_headers(&app);
    out.extend(app.policy.headers_for("/index.html"));
    out.push(("etag".to_string(), shell.etag.clone()));
    out.push(("vary".to_string(), "accept-encoding".to_string()));
    out.push((
        "x-edge-shell".to_string(),
        if shell.replica { "replica".to_string() } else { "inline-css".to_string() },
    ));
    if !shell.link_header.is_empty() {
        // Cloudflare 在 CDN 侧把 200 上的 Link 头转成 103 Early Hints（见 docs/03 §接入）。
        out.push(("link".to_string(), shell.link_header.clone()));
    }

    if is_not_modified(&headers, &shell.etag) {
        return empty_response(StatusCode::NOT_MODIFIED, out);
    }

    let encoding = pick_encoding(&headers, !shell.brotli.is_empty(), !shell.gzip.is_empty());
    let (body_bytes, content_encoding) = match encoding {
        Encoding::Brotli => (shell.brotli.clone(), Some("br")),
        Encoding::Gzip => (shell.gzip.clone(), Some("gzip")),
        Encoding::Identity => (Bytes::from(shell.html.clone()), None),
    };
    out.push(("content-type".to_string(), "text/html; charset=utf-8".to_string()));
    out.push(("content-length".to_string(), body_bytes.len().to_string()));
    if let Some(enc) = content_encoding {
        out.push(("content-encoding".to_string(), enc.to_string()));
    }

    // 分块：head（含内联样式与 preload）先冲出去，body 尾随。
    // 切点选在 </head> 之后：浏览器拿到第一帧就能开始解析 head（发现字体/脚本/样式），
    // 不必等整个文档 —— 这是「流式」在这条链路上唯一真实的收益。
    let cut = shell.html.find("</head>").map(|i| i + 7).unwrap_or(shell.html.len());
    let chunks: Vec<Bytes> = if content_encoding.is_none() {
        vec![
            Bytes::from(shell.html[..cut].to_string()),
            Bytes::from(shell.html[cut..].to_string()),
        ]
    } else {
        // 压缩体不能按明文的切点切（压缩流是有状态的），整块发出 —— 这时省的是字节与 RTT，
        // 不是「第一帧更早」；两者不可兼得时，优先选字节。
        vec![body_bytes]
    };

    let mut builder = Response::builder().status(StatusCode::OK);
    for (k, v) in out {
        if let Ok(value) = HeaderValue::from_str(&v) {
            builder = builder.header(k, value);
        }
    }
    builder
        .body(Body::new(stream::ChunkedBody::new(chunks)))
        .unwrap_or_else(|_| internal_error_response())
}

async fn health(State(app): State<Arc<api::App>>) -> Response {
    api::handle_health(&app).await
}

async fn web_any(State(app): State<Arc<api::App>>, req: Request<Body>) -> Response {
    gateway(&app, api::Endpoint::Web, req).await
}

async fn pub_any(State(app): State<Arc<api::App>>, req: Request<Body>) -> Response {
    gateway(&app, api::Endpoint::Pub, req).await
}

async fn gateway(app: &Arc<api::App>, endpoint: api::Endpoint, req: Request<Body>) -> Response {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let origin = headers.get("origin").and_then(|v| v.to_str().ok()).unwrap_or("");
    let allowed = app.cfg.allowed_origins.clone();
    // OPTIONS 预检：与现网 onRequestOptions 同形（空体 + CORS 头）。
    if method == Method::OPTIONS {
        return api::json_response(
            StatusCode::NO_CONTENT,
            Bytes::new(),
            cors::cors_headers(origin, &allowed),
        );
    }
    if method != Method::POST {
        // 现网只导出了 onRequestPost，别的方谐落到 Pages 的 405；这里保持同一语义。
        return api::json_response(
            StatusCode::METHOD_NOT_ALLOWED,
            Bytes::from(api::method_not_allowed_body()),
            cors::cors_headers(origin, &allowed),
        );
    }
    let (parts, body) = req.into_parts();
    let bytes = match axum::body::to_bytes(body, api::MAX_BODY).await {
        Ok(b) => b,
        Err(_) => return api::fail_response("payload_too_large", "请求体过大", origin, &allowed),
    };
    let _ = parts;
    api::handle_gateway(app, endpoint, &headers, bytes).await
}

async fn print_proxy(State(app): State<Arc<api::App>>, req: Request<Body>) -> Response {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let body = match axum::body::to_bytes(req.into_body(), api::MAX_BODY).await {
        Ok(b) => b,
        Err(_) => Bytes::new(),
    };
    api::handle_print(&app, &path_and_query, &method, &headers, body).await
}

/// 兜底：精确资产 → 目录 index.html → SPA 导航回退 → 404。
async fn fallback(State(app): State<Arc<api::App>>, req: Request<Body>) -> Response {
    let headers = req.headers().clone();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    if let Some(response) = serve_asset(&app, &path, &headers, &method).await {
        return response;
    }
    if let Some(rel) = app.assets.resolve_dir(&path).map(|e| e.rel.clone()) {
        if let Some(response) = serve_asset(&app, &rel, &headers, &method).await {
            return response;
        }
    }
    // 无扩展名的路径 = SPA 导航（HashRouter 时代多数不会出现，但用户手输路径会走这里）。
    if assets::AssetStore::looks_like_navigation(&path) {
        return root_shell(State(app), Request::new(Body::empty())).await;
    }
    let mut out = security_headers(&app);
    out.push(("content-type".to_string(), "text/plain; charset=utf-8".to_string()));
    let mut builder = Response::builder().status(StatusCode::NOT_FOUND);
    for (k, v) in out {
        if let Ok(value) = HeaderValue::from_str(&v) {
            builder = builder.header(k, value);
        }
    }
    builder
        .body(Body::from("404 Not Found"))
        .unwrap_or_else(|_| internal_error_response())
}

/// 资产交付：内容 ETag + _headers 声明的缓存策略 + 预压缩变体 + 304。
async fn serve_asset(
    app: &Arc<api::App>,
    path: &str,
    headers: &HeaderMap,
    method: &Method,
) -> Option<Response> {
    let entry = app.assets.get(path)?;
    let etag = entry.etag.clone();
    let policy_headers = entry.policy_headers.clone();
    let content_type = entry.content_type.clone();
    let source = entry.path.clone();
    let brotli = entry.brotli.clone();
    let gzip = entry.gzip.clone();
    let has_br = brotli.is_some();
    let has_gz = gzip.is_some();

    let mut out = security_headers(app);
    out.extend(policy_headers);
    out.push(("etag".to_string(), etag.clone()));
    out.push(("vary".to_string(), "accept-encoding".to_string()));
    out.push(("content-type".to_string(), content_type));

    if is_not_modified(headers, &etag) {
        return Some(empty_response(StatusCode::NOT_MODIFIED, out));
    }

    let encoding = pick_encoding(headers, has_br, has_gz);
    let (body, enc) = match encoding {
        Encoding::Brotli => (tokio::fs::read(brotli?).await.ok()?, Some("br")),
        Encoding::Gzip => (tokio::fs::read(gzip?).await.ok()?, Some("gzip")),
        Encoding::Identity => (tokio::fs::read(&source).await.ok()?, None),
    };
    if let Some(enc) = enc {
        out.push(("content-encoding".to_string(), enc.to_string()));
    }
    out.push(("content-length".to_string(), body.len().to_string()));

    if method == Method::HEAD {
        return Some(empty_response(StatusCode::OK, out));
    }

    let mut builder = Response::builder().status(StatusCode::OK);
    for (k, v) in out {
        if let Ok(value) = HeaderValue::from_str(&v) {
            builder = builder.header(k, value);
        }
    }
    Some(builder.body(Body::from(body)).unwrap_or_else(|_| internal_error_response()))
}

// ─────────────────────────────────────────────────────────────────────────────
// 头与编码
// ─────────────────────────────────────────────────────────────────────────────

/// _headers 的全局安全头（/* 段）+ 边缘自报头。
fn security_headers(app: &Arc<api::App>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = app
        .policy
        .global
        .iter()
        .filter(|(k, _)| !k.eq_ignore_ascii_case("cache-control"))
        .cloned()
        .collect();
    out.push(("server".to_string(), "supermarket-edge/0.1".to_string()));
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Encoding {
    Identity,
    Gzip,
    Brotli,
}

/// Accept-Encoding 协商：支持 q=0（显式拒绝）与通配。
///
/// 为什么认真解析 q 值：`br;q=0, gzip` 这种头在真实客户端/代理后面确实会出现，
/// 用 contains("br") 会错误地选 brotli —— 客户端明确说了不要，却拿到无法解码的响应。
/// 这类缺陷只在特定代理下暴露，靠手工点页面很难发现。
fn pick_encoding(headers: &HeaderMap, has_br: bool, has_gz: bool) -> Encoding {
    let raw = headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mut br_q = None;
    let mut gz_q = None;
    let mut star_q = None;
    for part in raw.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let mut pieces = part.split(';');
        let name = pieces.next().unwrap_or("").trim().to_ascii_lowercase();
        let mut q = 1.0f32;
        for param in pieces {
            let param = param.trim();
            if let Some(v) = param.strip_prefix("q=") {
                q = v.trim().parse().unwrap_or(0.0);
            }
        }
        match name.as_str() {
            "br" => br_q = Some(q),
            "gzip" | "x-gzip" => gz_q = Some(q),
            "*" => star_q = Some(q),
            _ => {}
        }
    }
    let value = |explicit: Option<f32>| explicit.or(star_q).unwrap_or(0.0);
    let br = has_br && value(br_q) > 0.0;
    let gz = has_gz && value(gz_q) > 0.0;
    // 优先级取「体积更小者」而不是「谁先出现」：br 通常比 gzip 小 15~20%。
    if br {
        Encoding::Brotli
    } else if gz {
        Encoding::Gzip
    } else {
        Encoding::Identity
    }
}

/// If-None-Match 判定：逐项比较（支持逗号列表与 W/ 前缀）。
fn is_not_modified(headers: &HeaderMap, etag: &str) -> bool {
    let Some(raw) = headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    if raw.trim() == "*" {
        return true;
    }
    raw.split(',').any(|candidate| {
        let c = candidate.trim();
        c == etag || c.strip_prefix("W/").map(|s| s == etag).unwrap_or(false)
    })
}

fn empty_response(status: StatusCode, headers: Vec<(String, String)>) -> Response {
    let mut builder = Response::builder().status(status);
    for (k, v) in headers {
        if let Ok(value) = HeaderValue::from_str(&v) {
            builder = builder.header(k, value);
        }
    }
    builder.body(Body::empty()).unwrap_or_else(|_| internal_error_response())
}

fn internal_error_response() -> Response {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .body(Body::from("{}"))
        .expect("最小响应构建不可能失败")
}

// ─────────────────────────────────────────────────────────────────────────────
// 构建期预压缩
// ─────────────────────────────────────────────────────────────────────────────

/// 把 dir 下值得压缩的文本资产写同目录的 .br / .gz。
///
/// 幂等：已存在且不比源文件旧的变体直接跳过（CI 里重复跑不会反复重压）。
/// 返回 (br 数, gz 数, (原始字节, 压缩后字节))。
fn precompress_dir(
    dir: &std::path::Path,
    quality: u32,
    min_bytes: usize,
) -> std::io::Result<(usize, usize, (u64, u64))> {
    let mut stack = vec![dir.to_path_buf()];
    let mut br_count = 0usize;
    let mut gz_count = 0usize;
    let mut raw_total = 0u64;
    let mut compressed_total = 0u64;
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.ends_with(".br") || name.ends_with(".gz") {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(
                ext.as_str(),
                "html" | "htm" | "js" | "mjs" | "css" | "json" | "svg" | "txt" | "map" | "webmanifest"
            ) {
                continue;
            }
            let raw = std::fs::read(&path)?;
            if raw.len() < min_bytes {
                continue;
            }
            raw_total += raw.len() as u64;
            let source_mtime = std::fs::metadata(&path)?.modified().ok();
            for (suffix, is_br) in [(".br", true), (".gz", false)] {
                let out_path = std::path::PathBuf::from(format!("{}{}", path.display(), suffix));
                let fresh = match (out_path.exists(), source_mtime) {
                    (true, Some(smt)) => std::fs::metadata(&out_path)
                        .and_then(|m| m.modified())
                        .map(|omt| omt >= smt)
                        .unwrap_or(false),
                    _ => false,
                };
                if fresh {
                    if is_br {
                        br_count += 1;
                    } else {
                        gz_count += 1;
                    }
                    if let Ok(meta) = std::fs::metadata(&out_path) {
                        compressed_total += meta.len();
                    }
                    continue;
                }
                let bytes = if is_br {
                    let mut out = Vec::new();
                    let mut params = brotli::enc::BrotliEncoderParams::default();
                    params.quality = quality as i32;
                    params.lgwin = 22;
                    let mut reader = std::io::Cursor::new(&raw);
                    brotli::BrotliCompress(&mut reader, &mut out, &params)?;
                    out
                } else {
                    use flate2::write::GzEncoder;
                    use flate2::Compression;
                    use std::io::Write;
                    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
                    encoder.write_all(&raw)?;
                    encoder.finish()?
                };
                compressed_total += bytes.len() as u64;
                std::fs::write(&out_path, bytes)?;
                if is_br {
                    br_count += 1;
                } else {
                    gz_count += 1;
                }
            }
        }
    }
    Ok((br_count, gz_count, (raw_total, compressed_total)))
}
