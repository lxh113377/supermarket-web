//! 日志/追踪字段的脱敏收口（现网 functions/lib/logger.js:101 的 sanitizeTrace 同义实现）。
//!
//! ## 为什么要在这里实现，而且只实现「够用且可证」的那部分
//!
//! 现网 sanitizeTrace = scrubIps(String(raw)) → 白名单 [^\w:.-] 删掉 → 截断 64。
//! 其中 scrubIps 用一组 IP 正则把地址换成 [ip]（logger.js:52 的 IP_PATTERNS）。
//!
//! Rust 侧**没有 regex 依赖**（依赖精简是明确选择），手工复刻那组正则的风险是
//! 「看起来一样、边界不一样」—— 这类偏差会悄悄改变 orderId 的清洗结果，进而改变 SQL 绑定的值。
//!
//! 所以这里的策略是**两段式**：
//!   1. 正常输入（真实订单号 o_/p_ + base36，过白名单零损失）走原生；
//!   2. 只要输入**看起来像 IP**（4 段点分十进制，或含 :: 或 3 段以上冒号分隔的十六进制组），
//!      就明确判「我不复刻这条路径」，由调用方**回落透传**让现网处理 —— 宁可不原生，也不猜。
//!
//! 这条边界由用例钉住：looks_like_ip 的判定必须覆盖 E2E 里那几个「像 IP」的输入。

/// 现网 logger.js:103 的白名单：只在 [A-Za-z0-9_ : . -] 内保留（\w 含下划线）。
pub fn sanitize_trace_whitelist(raw: &str) -> String {
    let kept: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':' || *c == '.' || *c == '-')
        .collect();
    kept.chars().take(64).collect()
}

/// 输入是否会命中现网的 IP 脱敏（scrubIps）：命中就意味着**本实现不复刻该路径**，调用方应回落。
///
/// 判定刻意偏保守（宁可多回落，不可少回落）：多做一次透传只是慢一点，少一次就是值不同。
pub fn looks_like_ip(raw: &str) -> bool {
    // ① IPv4 形态：4 段 1~3 位数字、点分隔（允许周围有空白/标点：正则 \b 形边界）
    let mut groups = 0usize;
    for part in raw.split(|c: char| !c.is_ascii_digit() && c != '.') {
        if part.is_empty() {
            continue;
        }
        let segs: Vec<&str> = part.split('.').collect();
        if segs.len() == 4
            && segs
                .iter()
                .all(|s| !s.is_empty() && s.len() <= 3 && s.chars().all(|c| c.is_ascii_digit()))
        {
            groups += 1;
        }
    }
    if groups > 0 {
        return true;
    }
    // ② IPv6 形态：含 :: 或 3 段以上冒号分隔的十六进制组
    if raw.contains("::") {
        return true;
    }
    for part in raw.split_whitespace() {
        let segs: Vec<&str> = part.split(':').collect();
        if segs.len() >= 3
            && segs
                .iter()
                .filter(|s| !s.is_empty() && s.len() <= 4 && s.chars().all(|c| c.is_ascii_hexdigit()))
                .count()
                >= 3
        {
            return true;
        }
    }
    false
}
