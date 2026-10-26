//! 运行配置：命令行 + 环境变量。
//!
//! 为什么手写解析而不是引 clap：本项目一共 9 个开关，clap 会带来一个体量数倍于
//! 本 crate 自身逻辑的依赖树（并且它的 `--help` 生成器在边缘进程里毫无用处）。
//! 手写解析的代价是 120 行，收益是「依赖表上没有为了 9 个开关而多出来的一层」。

use std::path::PathBuf;

/// Cloudflare D1 的 HTTP API 访问参数（用于健康探活与（可选）原生读）。
#[derive(Debug, Clone)]
pub struct D1Config {
    pub account_id: String,
    pub database_id: String,
    pub api_token: String,
}

/// 边缘服务配置。字段全部可经命令行覆盖，环境变量只作为默认值来源 ——
/// 这样「本机跑一遍」与「部署到机器上跑」用的是同一份代码路径。
#[derive(Debug, Clone)]
pub struct Config {
    pub dist: PathBuf,
    pub host: String,
    pub port: u16,
    /// `/web` `/pub` `/api/` 未原生实现的动作向上游 Functions 透传的地址。
    /// 透传是**保真度最高**的迁移形态：字节级等于现网（见 docs/04 的分阶段迁移）。
    pub functions_origin: Option<String>,
    /// `/api/*` 打印反代的上游。
    pub print_origin: Option<String>,
    /// 追加的 CORS 白名单（对应现网 env.ALLOWED_ORIGINS，逗号分隔）。
    pub allowed_origins: Vec<String>,
    /// 是否把构建产物里的 CSS 内联进首屏 HTML（默认开；关掉即回到「外链样式表」对照臂）。
    pub inline_css: bool,
    /// 是否把首屏静态复刻（header + hero 文案）注入 `#root`。
    /// 默认关：它的收益是「首屏不再等 JS」，但只对**完全确定**的那部分成立，
    /// 需要逐设备量 CLS 才敢默认开（见 docs/05 的开关矩阵）。
    pub boot_replica: bool,
    /// 公开读动作的边缘微缓存 TTL（毫秒）；0 = 关闭。
    pub api_cache_ttl_ms: u64,
    pub d1: Option<D1Config>,
    /// 现网 admin 密钥：本地原生化鉴权要用；不配置时 `login` 一律透传上游。
    pub admin_key: Option<String>,
    /// `/_health` 的 ai.configured 判据（与现网同源：两个 Dify 变量同时存在）。
    pub ai_configured: bool,
    /// `/_health` 的 deploy 字段（CF Pages 注入的 commit sha）。
    pub deploy_sha: Option<String>,
    /// 预压缩产物目录（`<dist>/assets/*.br|.gz`）；由 `precompress` 子命令生成。
    pub precompressed: Vec<String>,
}

/// 子命令。
pub enum Command {
    Serve(Config),
    /// 构建期预压缩：把 `<dir>` 下的文本资产压成 `.br` / `.gz`（幂等，已存在且更新则复用）。
    Precompress { dir: PathBuf, quality: u32, min_bytes: usize },
    /// 打印生成的 SSR 外壳到 stdout（判据与人工目检用）。
    PrintShell(Config),
    Help,
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

/// 解析命令行。支持 `--flag value` 与 `--flag=value` 两种写法。
pub fn parse_args(args: &[String]) -> Result<Command, String> {
    let mut it = args.iter();
    let Some(sub) = it.next() else {
        return Ok(Command::Help);
    };
    if sub == "--help" || sub == "-h" || sub == "help" {
        return Ok(Command::Help);
    }
    let mut cfg = Config {
        dist: env_opt("DIST_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("dist")),
        host: env_opt("HOST").unwrap_or_else(|| "127.0.0.1".to_string()),
        port: env_opt("PORT").and_then(|p| p.parse().ok()).unwrap_or(8788),
        functions_origin: env_opt("FUNCTIONS_ORIGIN"),
        print_origin: env_opt("CAMPUS_PRINT_ORIGIN"),
        allowed_origins: env_opt("ALLOWED_ORIGINS")
            .map(|v| v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default(),
        inline_css: true,
        boot_replica: false,
        api_cache_ttl_ms: env_opt("API_CACHE_TTL_MS").and_then(|v| v.parse().ok()).unwrap_or(60_000),
        d1: match (env_opt("D1_ACCOUNT_ID"), env_opt("D1_DATABASE_ID"), env_opt("D1_API_TOKEN")) {
            (Some(account_id), Some(database_id), Some(api_token)) => {
                Some(D1Config { account_id, database_id, api_token })
            }
            _ => None,
        },
        admin_key: env_opt("ADMIN_KEY"),
        ai_configured: env_opt("DIFY_BASE_URL").is_some() && env_opt("DIFY_CHAT_APP_KEY").is_some(),
        deploy_sha: env_opt("CF_PAGES_COMMIT_SHA"),
        precompressed: Vec::new(),
    };

    let mut quality = 11u32;
    let mut min_bytes = 1024usize;
    let mut rest = args.iter().skip(1).peekable();
    while let Some(arg) = rest.next() {
        let (key, inline_value) = match arg.split_once('=') {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (arg.clone(), None),
        };
        let mut value = || -> Result<String, String> {
            if let Some(v) = inline_value.clone() {
                return Ok(v);
            }
            rest.next().cloned().ok_or_else(|| format!("{} 需要一个取值", key))
        };
        match key.as_str() {
            "--dist" => cfg.dist = PathBuf::from(value()?),
            "--host" => cfg.host = value()?,
            "--port" => cfg.port = value()?.parse().map_err(|_| "端口必须是数字".to_string())?,
            "--functions-origin" => cfg.functions_origin = Some(value()?),
            "--print-origin" => cfg.print_origin = Some(value()?),
            "--allowed-origin" => cfg.allowed_origins.push(value()?),
            "--no-inline-css" => cfg.inline_css = false,
            "--boot-replica" => cfg.boot_replica = true,
            "--api-cache-ttl-ms" => cfg.api_cache_ttl_ms = value()?.parse().map_err(|_| "TTL 必须是毫秒数".to_string())?,
            "--quality" => quality = value()?.parse().map_err(|_| "quality 必须是数字".to_string())?,
            "--min-bytes" => min_bytes = value()?.parse().map_err(|_| "min-bytes 必须是数字".to_string())?,
            other => return Err(format!("不认识的参数：{}", other)),
        }
    }

    match sub.as_str() {
        "serve" => Ok(Command::Serve(cfg)),
        "shell" => Ok(Command::PrintShell(cfg)),
        "precompress" => Ok(Command::Precompress { dir: cfg.dist.clone(), quality, min_bytes }),
        other => Err(format!("不认识的子命令：{}（可用：serve / shell / precompress）", other)),
    }
}

/// `--help` 文本（同时充当 docs/04 的「本地运行」一节的可执行版本）。
pub const USAGE: &str = r#"supermarket-edge —— 江科一站通 Rust 边缘服务

子命令：
  serve      [--dist DIR] [--host H] [--port N] [--functions-origin URL]
             [--print-origin URL] [--allowed-origin ORIGIN]... [--no-inline-css]
             [--boot-replica] [--api-cache-ttl-ms N]
             启动边缘服务（SSR 外壳 + 资产 + /web /pub 网关 + /_health + /api 打印反代）
  shell      [--dist DIR] [--no-inline-css] [--boot-replica]
             只生成 SSR 外壳并打印到 stdout（判据/目检用，不起服务）
  precompress --dist DIR [--quality N] [--min-bytes N]
             构建期把文本资产预压缩成 .br/.gz（幂等）

环境变量（命令行优先）：
  DIST_DIR DIST 目录（默认 dist）        HOST / PORT        监听地址
  FUNCTIONS_ORIGIN    /web /pub 未原生实现动作的透传上游
  CAMPUS_PRINT_ORIGIN /api/* 打印反代上游
  ALLOWED_ORIGINS     追加 CORS 白名单（逗号分隔）
  D1_ACCOUNT_ID / D1_DATABASE_ID / D1_API_TOKEN   D1 HTTP API（/_health 探活等）
  ADMIN_KEY           本地原生鉴权用（不配则 login 一律透传）
  DIFY_BASE_URL / DIFY_CHAT_APP_KEY  /_health 的 ai.configured 判据
  CF_PAGES_COMMIT_SHA  /_health 的 deploy 字段
"#;
