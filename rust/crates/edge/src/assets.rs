//! 静态资产：索引、内容类型、ETag、预压缩变体、缓存头。
//!
//! ## 为什么在内存里建索引而不是每个请求 `stat` 一次
//!
//! 首屏要发的请求有 7~10 个，每个都 `stat` + 判类型 + 算 ETag 意味着把「磁盘元数据」
//! 放进关键路径。启动时扫一遍（本项目 dist 7 MB / 约 500 个文件，实测 ~30 ms）
//! 之后，请求路径只剩「查表 + 读文件 + 组装头」。
//!
//! ## ETag 怎么算
//!
//! 小文件（≤ 8 MiB）取**内容 sha256** 前 16 位 —— 这样「同名换内容」也能正确失效
//! （本项目有一族同名换内容的资产：`/images/{order}.webp`、`sw.js`）。
//! 大文件退化到「长度 + mtime」，避免启动时为几个大图读满一遍磁盘；
//! 这两个值在部署产物里不会变（每次部署都是新目录），工程上足够。
//!
//! ## 缓存头从哪来
//!
//! **不在这里另写一张表**：规则读 `dist/_headers`（Cloudflare Pages 的声明文件），
//! 见 [crate::policy]。这样「边缘发的头」与「Pages 发的头」同源，CI 的
//! `check-cache-headers` 对账的仍然是同一份事实。

use crate::policy::Policy;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

/// 一个可交付的静态资产。
#[derive(Debug, Clone)]
pub struct AssetEntry {
    /// 相对 dist 根的路径（以 `/` 开头，例如 `/assets/index-abc.js`）。
    pub rel: String,
    pub path: PathBuf,
    pub content_type: String,
    pub size: u64,
    pub etag: String,
    /// 预压缩变体（由 `precompress` 子命令生成）。
    pub brotli: Option<PathBuf>,
    pub gzip: Option<PathBuf>,
    /// `_headers` 命中的头（Cache-Control 等）。
    pub policy_headers: Vec<(String, String)>,
    /// 是否为「入口 HTML」（`/`、`/index.html` 与各子应用的 index.html）——
    /// 它们要走「每次回源复验」而不是长缓存。
    pub is_html: bool,
}

#[derive(Debug)]
pub struct AssetStore {
    pub root: PathBuf,
    entries: HashMap<String, AssetEntry>,
}

/// 内容类型：只覆盖本项目实际存在的扩展名（不引 mime 库 —— 那是一个为 1000 种类型
/// 准备的表，我们只需要 15 种，而多一个依赖就是多一份供应链面）。
pub fn content_type_of(ext: &str) -> &'static str {
    match ext {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// 文件是否值得预压缩（已经压过的格式再压一次只会变大，且白耗构建时间）。
fn is_compressible(ext: &str) -> bool {
    matches!(
        ext,
        "html" | "htm" | "js" | "mjs" | "css" | "json" | "svg" | "txt" | "map" | "webmanifest" | "xml"
    )
}

fn hash_etag(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let hex: String = digest.iter().take(8).map(|b| format!("{:02x}", b)).collect();
    format!("\"{}\"", hex)
}

fn meta_etag(size: u64, mtime: std::time::SystemTime) -> String {
    let secs = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("\"m{:x}-{:x}\"", size, secs)
}

impl AssetStore {
    /// 扫描 `root` 建索引。`.br`/`.gz` 变体不单独成条目，而是挂到原文件上。
    pub fn load(root: &Path, policy: &Policy) -> io::Result<AssetStore> {
        let mut entries = HashMap::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let mut children: Vec<PathBuf> = Vec::new();
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                children.push(entry.path());
            }
            for path in children {
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                // 预压缩变体不单独暴露：浏览器请求的是原文件，编码由响应头决定。
                if name.ends_with(".br") || name.ends_with(".gz") {
                    continue;
                }
                let rel = format!(
                    "/{}",
                    path.strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/")
                );
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let meta = std::fs::metadata(&path)?;
                let size = meta.len();
                // 首屏关键资产的 ETag 必须按内容算；大图退化到元数据（见文件头）。
                let etag = if size <= 8 * 1024 * 1024 {
                    hash_etag(&std::fs::read(&path)?)
                } else {
                    meta_etag(size, meta.modified().unwrap_or(std::time::UNIX_EPOCH))
                };
                let brotli = if is_compressible(&ext) {
                    let candidate = PathBuf::from(format!("{}.br", path.display()));
                    candidate.exists().then_some(candidate)
                } else {
                    None
                };
                let gzip = if is_compressible(&ext) {
                    let candidate = PathBuf::from(format!("{}.gz", path.display()));
                    candidate.exists().then_some(candidate)
                } else {
                    None
                };
                let entry = AssetEntry {
                    rel: rel.clone(),
                    path,
                    content_type: content_type_of(&ext).to_string(),
                    size,
                    etag,
                    brotli,
                    gzip,
                    policy_headers: policy.headers_for(&rel),
                    is_html: ext == "html",
                };
                entries.insert(rel, entry);
            }
        }
        Ok(AssetStore { root: root.to_path_buf(), entries })
    }

    pub fn get(&self, path: &str) -> Option<&AssetEntry> {
        self.entries.get(path)
    }

    /// 目录型路径解析：`/admin` → `/admin/index.html`（与 Pages/静态托管的目录语义一致）。
    pub fn resolve_dir(&self, path: &str) -> Option<&AssetEntry> {
        let trimmed = path.trim_end_matches('/');
        let candidate = format!("{}/index.html", trimmed);
        self.entries.get(&candidate)
    }

    /// 该路径是否属于「SPA 导航」（无扩展名 ⇒ 交给外壳路由）。
    pub fn looks_like_navigation(path: &str) -> bool {
        let last = path.rsplit('/').next().unwrap_or("");
        !last.contains('.')
    }

    pub fn count(&self) -> usize {
        self.entries.len()
    }

    /// 供外壳构建期做「前缀扫描」（assets/index- / HomePage-）用。
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.entries.keys()
    }
}
