//! sanitizeTrace 相关用例：白名单/截断 + 「什么时候必须回落」的边界。
//!
//! 这套用例的存在理由：原生路径**只实现 sanitizeTrace 里可证的那一段**，
//! 另一段（IP 正则脱敏）明确回落。边界若没有用例钉住，「回落」会退化成一句注释。

use supermarket_core::sanitize::{looks_like_ip, sanitize_trace_whitelist};

#[test]
fn c_whitelist_keeps_real_order_ids_untouched() {
    // 真实订单号（o_/p_ + base36）过白名单零损失 —— 这是「为什么可以原生」的前提
    for id in ["o_abc123", "p_x9y8z7", "o_1a2b3c4d5e", "ABC-123_456.7:8"] {
        assert_eq!(sanitize_trace_whitelist(id), id, "{id} 不该被清洗改动");
    }
}

#[test]
fn c_whitelist_drops_other_chars_and_truncates() {
    // 白名单外的字符（空格、星号、中文、斜杠）一律删掉
    assert_eq!(sanitize_trace_whitelist("o_abc 123*"), "o_abc123");
    assert_eq!(sanitize_trace_whitelist("  订单 o_1  "), "o_1");
    // 截断到 64（与现网 slice(0, 64) 同）
    let long = "a".repeat(100);
    assert_eq!(sanitize_trace_whitelist(&long).len(), 64);
    // 全被洗掉 ⇒ 空串（调用方据此回 missing_order_id）
    assert_eq!(sanitize_trace_whitelist("中文 ***"), "");
}

#[test]
fn c_looks_like_ip_covers_the_fallback_cases() {
    // ④ 段点分十进制（含被空白/标点包裹的）
    assert!(looks_like_ip("1.2.3.4"));
    assert!(looks_like_ip("192.168.1.1"));
    assert!(looks_like_ip("x 10.0.0.255 y"));
    // IPv6：含 :: 或 3 段以上冒号分隔的十六进制组
    assert!(looks_like_ip("::1"));
    assert!(looks_like_ip("2001:db8:85a3:0:0:8a2e:370:7334"));
    // 真实订单号**不能**被误判（误判会让本该原生的调用全部回落，白做一场）
    assert!(!looks_like_ip("o_abc123"));
    assert!(!looks_like_ip("p_x9y8z7"));
    assert!(!looks_like_ip(""));
    assert!(!looks_like_ip("o_2026.10.27"));
    assert!(!looks_like_ip("a:b"));
}
