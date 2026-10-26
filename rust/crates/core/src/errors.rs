//! 错误码登记表与失败封套 —— 与现网 `functions/lib/errors.js` 的 `ERRORS` 表逐条对齐。
//!
//! 表里每一行都是**判据**而不只是文案：`kind` 决定调用方动作（唯一允许「先暂住」的是
//! `platform`），`status` 决定 HTTP 状态，`retryable` 决定「同一载荷原样重发有没有意义」。
//! 现网 CI 用 `verify:errors` 做 E2 双向对账（表里有的必须被引用、被引用的必须在表里），
//! Rust 侧用 `tests/parity.rs` 的 E 组对同一张表做逐条断言 —— 两侧对的是同一份事实。

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// 失败码的五类语义，取值与 JS 侧 `ERROR_KINDS` 完全一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorKind {
    /// 入参不合法：改载荷才可能成功。
    Input,
    /// 资源状态不允许：改业务输入（换商品/加件）才可能成功。
    State,
    /// 鉴权/授权：重新登录或换密钥。
    Auth,
    /// 配额：服务端活着并明确说「慢点」，重试有意义。
    Quota,
    /// 平台自身故障：**唯一**允许调用方先行兜底、不丢用户意图的一类。
    Platform,
}

impl ErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorKind::Input => "input",
            ErrorKind::State => "state",
            ErrorKind::Auth => "auth",
            ErrorKind::Quota => "quota",
            ErrorKind::Platform => "platform",
        }
    }
}

/// 单条错误码的元数据。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorMeta {
    pub kind: ErrorKind,
    pub status: u16,
    pub retryable: bool,
}

/// 未登记码的兜底：fail-closed 记成平台故障（可观测），而不是猜一个 4xx。
pub const UNKNOWN_ERROR_CODE: &str = "internal_error";

/// 登记表全量 42 条，顺序与 `functions/lib/errors.js` 的分组顺序一致（对账时好逐行比）。
pub const ERRORS: &[(&str, ErrorMeta)] = &[
    // ── 协议 / 输入 ──
    ("invalid_json", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_params", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_order_id", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_product_id", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_product_ids", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_product_order", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_items", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_review_id", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_submission_id", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("missing_service_info", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("no_update_fields", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_order_payload", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_quantity", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_text", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_image", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("too_many_images", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("image_too_large", ErrorMeta { kind: ErrorKind::Input, status: 413, retryable: false }),
    ("payload_too_large", ErrorMeta { kind: ErrorKind::Input, status: 413, retryable: false }),
    ("quantity_exceeds_limit", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_delta", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_kind", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("batch_too_large", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    ("invalid_action", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    // ── 资源状态 ──
    ("product_not_found", ErrorMeta { kind: ErrorKind::State, status: 404, retryable: false }),
    ("order_not_found", ErrorMeta { kind: ErrorKind::State, status: 404, retryable: false }),
    ("submission_not_found", ErrorMeta { kind: ErrorKind::State, status: 404, retryable: false }),
    ("product_disabled", ErrorMeta { kind: ErrorKind::State, status: 409, retryable: false }),
    ("stock_insufficient", ErrorMeta { kind: ErrorKind::State, status: 409, retryable: false }),
    ("below_min_delivery", ErrorMeta { kind: ErrorKind::State, status: 409, retryable: false }),
    ("stock_untracked", ErrorMeta { kind: ErrorKind::State, status: 409, retryable: false }),
    ("invalid_transition", ErrorMeta { kind: ErrorKind::State, status: 409, retryable: false }),
    ("concurrent_update", ErrorMeta { kind: ErrorKind::State, status: 409, retryable: false }),
    // ── 鉴权 / 授权 ──
    ("auth_failed", ErrorMeta { kind: ErrorKind::Auth, status: 401, retryable: false }),
    ("readonly_denied", ErrorMeta { kind: ErrorKind::Auth, status: 403, retryable: false }),
    ("action_not_public", ErrorMeta { kind: ErrorKind::Auth, status: 403, retryable: false }),
    // ── 配额 ──
    ("rate_limited", ErrorMeta { kind: ErrorKind::Quota, status: 429, retryable: true }),
    // ── 打印服务文件 ──
    ("print_storage_unavailable", ErrorMeta { kind: ErrorKind::Platform, status: 500, retryable: false }),
    ("print_file_too_large", ErrorMeta { kind: ErrorKind::Input, status: 413, retryable: false }),
    ("print_file_type_denied", ErrorMeta { kind: ErrorKind::Input, status: 400, retryable: false }),
    // ── 平台自身 ──
    ("db_unbound", ErrorMeta { kind: ErrorKind::Platform, status: 500, retryable: true }),
    ("internal_error", ErrorMeta { kind: ErrorKind::Platform, status: 500, retryable: true }),
    ("order_create_failed", ErrorMeta { kind: ErrorKind::Platform, status: 500, retryable: true }),
];

/// 查表；未登记码一律按 [UNKNOWN_ERROR_CODE] 处理（不猜 4xx，见文件头）。
pub fn meta_of(error_code: &str) -> ErrorMeta {
    ERRORS
        .iter()
        .find(|(code, _)| *code == error_code)
        .map(|(_, meta)| *meta)
        .unwrap_or_else(|| meta_of(UNKNOWN_ERROR_CODE))
}

/// 该失败码对应的 HTTP 状态（未登记 → 500）。
pub fn http_status_of(error_code: Option<&str>) -> u16 {
    match error_code {
        Some(code) => meta_of(code).status,
        None => meta_of(UNKNOWN_ERROR_CODE).status,
    }
}

/// 构造失败载荷。
///
/// `code` 恒定 `-1` —— 这是**兼容性红线**（见 `functions/lib/errors.js` 文件头）：
/// 顾客端 Service Worker 里的旧 bundle 判定失败用的是 `code !== 0`，
/// 把 -1 换成别的数会让旧客户端把「失败」读成「成功」。
pub fn fail(error_code: &str, message: &str, extra: Map<String, Value>) -> Value {
    let meta = meta_of(error_code);
    let mut out = Map::new();
    out.insert("code".into(), json!(-1));
    out.insert("errorCode".into(), json!(error_code));
    out.insert("kind".into(), json!(meta.kind.as_str()));
    out.insert("retryable".into(), json!(meta.retryable));
    out.insert("message".into(), json!(message));
    for (k, v) in extra {
        out.insert(k, v);
    }
    Value::Object(out)
}

/// 成功载荷：`{ code: 0, data: ... }`。
///
/// 现网各 action 的返回形状不统一（有的直接返回数组），所以这里只提供
/// 「带 code 的成功封套」这一种最常用的形态；其余形状由网关原样透传上游字节，
/// 语义一致但字节级零改写（见 `crates/edge/src/api.rs` 的 passthrough 段）。
pub fn ok(data: Value) -> Value {
    let mut out = Map::new();
    out.insert("code".into(), json!(0));
    out.insert("data".into(), data);
    Value::Object(out)
}

/// 429 的 `Retry-After` 秒数，与 JS 侧 `retryAfterSeconds` 同口径。
pub fn retry_after_seconds(retry_after_ms: Option<f64>) -> u64 {
    // 逐字对齐 JS：`Math.max(1, Math.ceil((Number(windowMs) || 0) / 1000))`。
    // `|| 0` 会同时吃掉 undefined / null / NaN / 0，负数经 ceil 后仍 <=0、再被 max(1) 抬到 1。
    let ms = match retry_after_ms {
        Some(ms) if ms.is_finite() => ms,
        _ => 0.0,
    };
    ((ms / 1000.0).ceil() as i64).max(1) as u64
}
