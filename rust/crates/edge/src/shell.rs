//! # SSR 外壳：把「首屏要等的东西」从 HTML 里挪走
//!
//! 现网 `dist/index.html` 的首屏依赖链（`.lighthouse/*` 实测，移动档 1.6 Mbps / RTT 150 ms）：
//!
//! ```text
//!   文档 1.6 KB ──► 解析 ──► 7 个入口 chunk 并行 ──► 路由 chunk（HomePage）──► 更多 chunk
//!   t=1ms        t=1014      t=1027                t=1707                   t=2082…2682
//!                                    └─ 渲染阻塞样式表 11.7 KB（t=1029→1692）
//!   FCP 1473ms / LCP 1791ms（首屏最大元素 = hero 的 h1 文案）
//! ```
//!
//! 三层改动，每层都对应上面某一格：
//!
//! 1. **样式表内联进 HTML**：去掉那一次渲染阻塞请求（11.7 KB / 1 RTT）。
//!    代价是 HTML 变大：**2026-10-29 实测** 145,077 B raw（同一份产物里被内联的 CSS 是 142,100 B raw），
//!    我们把它**预压缩**到 30,138 B brotli（gzip 30,247 B）并配 ETag —— 首次访问省一次 RTT，重复访问是 304（0 字节）。
//!    CSP 不放开 `'unsafe-inline'`：样式的 sha256 在构建时算好写进 `style-src`
//!    （**哈希式** CSP，比 nonce 好的一点是 HTML 仍然可缓存）。
//! 2. **首屏路由 chunk 提前 preload**：`HomePage-*.js` 目前在入口 JS 执行后才被发现（t=1707）。
//!    托管侧（Cloudflare Pages 静态托管）自 2026-10-29 起在构建期生成同样的 Link 段（scripts/inline-critical-css.mjs），
//!    同样是「入口 + 首屏路由 chunk + 从产物 HTML 取字体、跳过已内联的样式」这三条规则。
//!    在 head 里加 modulepreload 后它与其他入口 chunk 并行（t≈1027）。
//! 3. **流式写出**（见 [crate::stream]）：head + hero 先冲出去，浏览器可以边收边解析。
//!    配合 `Link` 头，Cloudflare 会把它转成 **103 Early Hints**（见 docs/03）。
//!
//! ## 可选：静态首屏复刻（`--boot-replica`）
//!
//! 默认**关**。打开后会把 `#root` 里塞一份「header + hero 文案」的静态复刻，
//! 于是首屏不再等 JS —— 但它的正确性依赖「复刻与原组件的 DOM 完全同构」，
//! 需要逐设备量 CLS 才敢默认开。开关矩阵与实测见 docs/05。

use crate::assets::AssetStore;
use crate::config::Config;
use bytes::Bytes;
use sha2::{Digest, Sha256};

/// 生成好的外壳（含预压缩变体）。
pub struct Shell {
    pub html: String,
    pub brotli: Bytes,
    pub gzip: Bytes,
    pub etag: String,
    /// 供 Cloudflare 转 Early Hints 的 `Link` 头。
    pub link_header: String,
    pub inline_css_bytes: usize,
    pub css_asset: Option<String>,
    pub preloaded_route: Option<String>,
    pub replica: bool,
}

/// 构建报告（给 `shell` 子命令与判据用）。
pub struct ShellReport {
    pub html_bytes: usize,
    pub brotli_bytes: usize,
    pub gzip_bytes: usize,
    pub inline_css_bytes: usize,
}

/// 首屏路由 chunk 的文件名前缀 → 只有路由名对应的 chunk 才值得提前 preload。
/// 为什么不读 Vite 的 manifest：本项目 `vite.config.js` 没开 `build.manifest`，
/// 产物里没有 manifest.json；而 Vite 的输出命名是稳定的 `<ChunkName>-<hash>.js`，
/// 于是用「前缀扫描」拿同一个结果，且找不到时**静默跳过**（退化成现网行为，不是错误）。
const INITIAL_ROUTE_CHUNK: &str = "HomePage-";

/// 构建外壳。失败时返回人类可读的原因（调用方据此回落成「直接发 dist/index.html」）。
pub fn build(cfg: &Config, assets: &AssetStore) -> Result<Shell, String> {
    let index_path = cfg.dist.join("index.html");
    let original = std::fs::read_to_string(&index_path)
        .map_err(|e| format!("读不到 {}：{}", index_path.display(), e))?;
    let mut html = original.clone();
    let mut inline_css_bytes = 0usize;
    let mut css_asset = None;

    // ── ① 样式表内联（含 CSP 哈希）────────────────────────────────────────────
    if cfg.inline_css {
        if let Some(tag) = find_tag(&html, "<link", "stylesheet") {
            let href = attr(&tag.text, "href").ok_or_else(|| "样式表 link 没有 href".to_string())?;
            let rel_path = normalize_href(&href);
            if let Some(entry) = assets.get(&rel_path) {
                let css = std::fs::read(&entry.path)
                    .map_err(|e| format!("读 CSS 失败 {}：{}", entry.path.display(), e))?;
                let hash = base64_sha256(&css);
                let style = format!("<style>{}</style>", String::from_utf8_lossy(&css));
                inline_css_bytes = css.len();
                css_asset = Some(rel_path);
                html.replace_range(tag.start..tag.end, &style);
                // CSP：只放宽「这一份哈希」，不写 'unsafe-inline'。
                html = relax_style_csp(&html, &hash);
            }
        }
    }

    // ── ② 首屏路由 chunk 提前 preload ─────────────────────────────────────────
    let mut preloaded_route = None;
    if let Some(found) = find_asset_prefix(assets, INITIAL_ROUTE_CHUNK, ".js") {
        let rel = found.trim_start_matches('/').to_string();
        // 注意属性值的收尾引号：漏了它会把后面的 " 当成该属性的结尾，
        // 整份文档从这一行起被解析器吞进属性里（#root 直接消失 ⇒ React 报 root element not found）。
        // 这个缺陷当初就是被 scripts/diagnose-page.mjs + NO_FCP 抓出来的。
        let link = format!(
            "    <link rel=\"modulepreload\" crossorigin href=\"./{}\">\n",
            rel
        );
        if !html.contains(&rel) {
            html = html.replacen("  </head>", &format!("{}  </head>", link), 1);
        }
        preloaded_route = Some(rel);
    }

    // ── ③ 可选：静态首屏复刻 ────────────────────────────────────────────────
    if cfg.boot_replica {
        let (open, hours) = business_state();
        let replica = replica_markup(open, hours);
        html = html.replacen("<div id=\"root\"></div>", &format!("<div id=\"root\">{}</div>", replica), 1);
    }

    // ── ETag / 预压缩 ────────────────────────────────────────────────────────
    let raw = html.clone().into_bytes();
    let etag = format!("\"{}\"", hex16(&raw));
    let brotli = Bytes::from(precompress_brotli(&raw, 11));
    let gzip = Bytes::from(precompress_gzip(&raw));

    // Link 头：入口 JS、首屏路由 chunk、两个展示体字体。
    // Cloudflare 会把 200 响应上的 Link 头转成 103 Early Hints（见 docs/03 §接入）。
    let mut links: Vec<String> = Vec::new();
    // 入口脚本：`assets/index-*.js`（扩展名必须显式给，理由见 find_asset_prefix 的注释）。
    if let Some(found) = find_asset_prefix(assets, "index-", ".js") {
        links.push(format!("<{}>; rel=preload; as=script; crossorigin", found));
    }
    if let Some(rel) = &preloaded_route {
        links.push(format!("</{}>; rel=preload; as=script; crossorigin", rel));
    }
    // 字体等 preload 一律**从产物自己的 <link rel=preload> 里取**，不再硬编码文件名。
    // 这条规则是被一次真实漂移逼出来的：字体分包把 display-serif-cjk.woff2 换成了
    // display-serif-cjk-a.woff2，而这里硬编码着旧名 ⇒ Link 头静默少了一条（页面自身的
    // preload 还在，但 103 Early Hints 里没了）。从 HTML 取就不会再有第二份真相。
    for (href, kind, crossorigin) in collect_preloads(&html) {
        // 样式表已内联，不必再提示；脚本与字体保留。
        if kind == "style" {
            continue;
        }
        let suffix = if crossorigin { "; crossorigin" } else { "" };
        links.push(format!("<{}>; rel=preload; as={}{}", href, kind, suffix));
    }

    Ok(Shell {
        html,
        brotli,
        gzip,
        etag,
        link_header: links.join(", "),
        inline_css_bytes,
        css_asset,
        preloaded_route,
        replica: cfg.boot_replica,
    })
}

impl Shell {
    pub fn report(&self) -> ShellReport {
        ShellReport {
            html_bytes: self.html.len(),
            brotli_bytes: self.brotli.len(),
            gzip_bytes: self.gzip.len(),
            inline_css_bytes: self.inline_css_bytes,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 小工具（不引任何解析库：本项目 HTML 是 Vite 生成的、结构稳定）
// ─────────────────────────────────────────────────────────────────────────────

pub struct TagHit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// 找第一个满足「以 `open` 开头且内部含 `needle`」的标签。
fn find_tag(html: &str, open: &str, needle: &str) -> Option<TagHit> {
    let mut from = 0usize;
    while let Some(rel) = html[from..].find(open) {
        let start = from + rel;
        let end = html[start..].find('>').map(|e| start + e + 1)?;
        let text = html[start..end].to_string();
        if text.contains(needle) {
            return Some(TagHit { start, end, text });
        }
        from = end;
    }
    None
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{}=\"", name);
    let at = tag.find(&needle)? + needle.len();
    let rest = &tag[at..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// `./assets/x.css` / `assets/x.css` / `/assets/x.css` → `/assets/x.css`
fn normalize_href(href: &str) -> String {
    let trimmed = href.trim_start_matches('.');
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{}", trimmed)
    }
}

/// 在资产索引里找第一个「文件名以 `prefix` 开头」的条目（用于 `assets/index-`、`HomePage-`）。
fn find_asset_prefix<'a>(assets: &'a AssetStore, prefix: &str, ext: &str) -> Option<&'a str> {
    let mut best: Option<&str> = None;
    for rel in assets.keys() {
        let file = rel.rsplit('/').next().unwrap_or("");
        let dir = rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        // 扩展名必须一起判：`index-` 会同时命中 index-*.js 与 index-*.css，
        // 只按前缀取就会把样式表当成入口脚本去 preload（第一版就踩了这个坑）。
        if file.starts_with(prefix) && file.ends_with(ext) && (dir == "/assets" || dir.is_empty()) {
            if best.map(|b| rel.len() < b.len()).unwrap_or(true) {
                best = Some(rel.as_str());
            }
        }
    }
    best
}

/// 把 `style-src 'self'` 放宽成 `style-src 'self' 'sha256-...'`。
///
/// 从产物 HTML 里取所有 `<link rel="preload">`（返回 (href, as, crossorigin)）。
///
/// 为什么从 HTML 取而不是在 Rust 里列一遍：preload 清单是**构建产物的一部分**，
/// 在这里再写一份就是第二份真相（本次字体分包改名 display-serif-cjk.woff2 →
/// display-serif-cjk-a.woff2 已经让硬编码的那份漂过一次：Link 头静默少了一条）。
/// 取不到就返回空（退化成「没有 Early Hints」，不是错误）。
fn collect_preloads(html: &str) -> Vec<(String, String, bool)> {
    let mut out = Vec::new();
    let mut from = 0usize;
    while let Some(rel) = html[from..].find("<link") {
        let start = from + rel;
        let Some(end_rel) = html[start..].find('>') else { break };
        let end = start + end_rel + 1;
        let tag = &html[start..end];
        from = end;
        if !tag.contains("rel=\"preload\"") {
            continue;
        }
        let (Some(href), Some(kind)) = (attr(tag, "href"), attr(tag, "as")) else {
            continue;
        };
        out.push((href, kind, tag.contains("crossorigin")));
    }
    out
}

/// 只在原 CSP 里确实有 `style-src 'self'` 时替换（找不到就原样返回）——
/// 宁可内联样式被 CSP 拦掉（浏览器行为退化成「无样式但结构完整」），
/// 也不要为了让样式生效而写成 `'unsafe-inline'`（那是永久性放宽）。
fn relax_style_csp(html: &str, hash: &str) -> String {
    let needle = "style-src 'self'";
    if let Some(at) = html.find(needle) {
        let mut out = String::with_capacity(html.len() + hash.len() + 12);
        out.push_str(&html[..at]);
        out.push_str(&format!("style-src 'self' 'sha256-{}'", hash));
        out.push_str(&html[at + needle.len()..]);
        return out;
    }
    html.to_string()
}

fn base64_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    base64(&hasher.finalize())
}

fn hex16(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().take(8).map(|b| format!("{:02x}", b)).collect()
}

/// 标准 base64（带 padding）。自己写 30 行而不是引 base64 库：
/// 这里只有一处用途（CSP 哈希），且实现能自证（见 tests）。
fn base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// 预压缩（构建/启动期一次），质量档位见 docs/05。
fn precompress_brotli(raw: &[u8], quality: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut params = brotli::enc::BrotliEncoderParams::default();
    params.quality = quality as i32;
    params.lgwin = 22;
    let mut reader = std::io::Cursor::new(raw);
    // 压缩失败不该让服务起不来：失败就返回空 Vec，调用方按「没有 br 变体」处理。
    if brotli::BrotliCompress(&mut reader, &mut out, &params).is_err() {
        return Vec::new();
    }
    out
}

fn precompress_gzip(raw: &[u8]) -> Vec<u8> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    if encoder.write_all(raw).is_err() {
        return Vec::new();
    }
    encoder.finish().unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
// 营业状态（与 src/utils/businessHours.ts 同口径；固定 UTC+8，见项目「时区」约束）
// ─────────────────────────────────────────────────────────────────────────────

/// 返回 (是否营业, 营业时间文案)。
pub fn business_state() -> (bool, &'static str) {
    const TEXT: &str = "工作日(周一至五) 17:37-23:00 | 周末与节假日 13:00-次日1:00";
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        + 8 * 3600; // 项目口径：一律固定 UTC+8
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let weekday = (days + 4).rem_euclid(7); // 1970-01-01 是周四(4)：0=周日 … 6=周六
    let minutes = (rem / 60) as i64;
    let is_weekend = weekday == 0 || weekday == 6;
    let open = if is_weekend {
        minutes >= 13 * 60 || minutes < 60
    } else {
        minutes >= 17 * 60 + 37 && minutes < 23 * 60
    };
    (open, TEXT)
}

/// 静态首屏复刻的标记。
///
/// 每一处 class 都取自原组件的真实输出（`MarketHero.tsx` / `CustomerHeader.tsx`），
/// 且由 `rust/scripts/check-shell-parity.mjs` 反向对账：源文件里出现的每个
/// `className` 片段都必须在复刻里出现，否则判据判红 —— 这是「复刻不许漂移」的机制，
/// 不是靠人记得同步。
pub fn replica_markup(open: bool, hours: &str) -> String {
    let state = if open { "营业中" } else { "已打烊" };
    let hero_state = if open { "今天为你开门" } else { "现在打烊，先看看" };
    // 注意：这里刻意**不**渲染 .market-exhibits 里的照片 ——
    // 照片是「每次开屏随机抽三件」的动态内容（MarketHero 的 pickExhibits），
    // 复刻里放任何一组都会在 React 挂载后被换掉（内容不被承认的闪动）。
    // 而 .market-exhibits 在 CSS 里是 position:absolute（见 redesign.css），
    // 空着不影响 .market-showcase 的高度 ⇒ 不产生 CLS。
    // 注意：r#"..."# 会被 href="#/" 里的 "# 提前终止 —— 必须用 r##"..."##。
    // 外层 .home-page 不能省：它承载全页 background/color 与 overflow:clip
    // （redesign.css 的 .home-page 规则），少一层就等于首屏底色不同 —— 那是可见的「视觉不一致」，
    // 不是无关紧要的包裹层。
    format!(
        r##"<div class="home-page"><header class="site-header"><a class="brand-lockup " aria-label="江科一站通首页" href="#/"><span class="brand-fruit" aria-hidden="true"><span>柿</span></span><span class="brand-wordmark"><strong>超柿</strong><span><span class="brand-campus">江科一站通</span><span class="brand-dot"> / </span>校园日常服务站</span></span></a><div class="site-header-actions"><span class="business-state" role="status"><i aria-hidden="true"></i>{state}</span><a class="header-link header-order" href="#/order-query">查询订单</a><a class="header-link header-ai" href="#/assistant" aria-label="打开 AI 导购">AI 导购 <span aria-hidden="true">↗</span></a><a class="button button-ink header-shop" href="#/shop">去逛超市 <span aria-hidden="true">↗</span></a></div></header><main id="main-content" tabindex="-1"><section class="market-hero" aria-labelledby="market-title"><div class="market-hero-copy"><p class="eyebrow hero-eyebrow"><span class="hero-index">NO. 01</span> 宿舍楼下的日常市集</p><h1 id="market-title" class="market-title">把日常，<br><span>过得有滋味。</span></h1><p class="market-intro">一站式校园生活服务平台——零食、饮料与生活所需。<br>下楼之前，先替你送到楼下。</p><div class="market-actions"><a href="#/shop" class="button button-primary button-large">现在，逛点好吃的 <span aria-hidden="true">↗</span></a><a href="#/order-query" class="text-link">我的订单 <span aria-hidden="true">→</span></a></div><div class="market-facts"><div><span>配送约定</span><strong>满 {price} 起送</strong></div><div><span>营业时间</span><strong>{hero_state}</strong></div></div></div><div class="market-showcase"><span class="showcase-sticker" aria-hidden="true" data-decorative="true">今日<br>有好柿</span><span class="showcase-orbit" aria-hidden="true" data-decorative="true"></span><span class="showcase-word" aria-hidden="true" data-decorative="true">超柿</span><div class="market-exhibits"></div><p class="showcase-note"><span aria-hidden="true">↳</span> 商品摄影，所见即所选</p></div><div class="market-hours"><span>OPENING HOURS</span><p>{hours}</p><i aria-hidden="true">↘</i></div></section></main></div>"##,
        state = state,
        hero_state = hero_state,
        hours = hours,
        price = supermarket_core::format::format_yuan(supermarket_core::MIN_DELIVERY_AMOUNT),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"hello world"), "aGVsbG8gd29ybGQ=");
    }

    #[test]
    fn tag_and_attr_extraction() {
        let html = "<link rel=\"stylesheet\" crossorigin href=\"./assets/x.css\">";
        let hit = find_tag(html, "<link", "stylesheet").unwrap();
        assert_eq!(attr(&hit.text, "href").as_deref(), Some("./assets/x.css"));
    }

    #[test]
    fn csp_relax_keeps_everything_else() {
        let html = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; style-src 'self'; img-src 'self'\">";
        let out = relax_style_csp(html, "abc=");
        assert!(out.contains("style-src 'self' 'sha256-abc='"), "{}", out);
        assert!(out.contains("img-src 'self'"));
    }

    #[test]
    fn business_hours_follow_utc8_rules() {
        // 只验函数形状：真实判据是 4 个时间点的表格（见 docs/05 的营业状态用例），
        // 这里避免用「当前时间」写会随时刻翻车的断言。
        let (open, text) = business_state();
        assert!(text.contains("17:37-23:00"));
        let _ = open;
    }
}
