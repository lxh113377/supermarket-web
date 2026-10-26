//! 金额/计数/百分比格式化 —— 与 `src/utils/format.ts` 一一对应。
//!
//! 这 4 个函数在现网是「全站唯一真相源」（此前 13+ 处各自内联 `¥{x.toFixed(2)}`，
//! 出现过「有的四舍五入、有的直接拼接」的不一致）。Rust 版是第五个宿主，
//! 所以更要逐字对齐 —— 判据见 `tests/parity.rs` 的 F 组。

/// 价格数字（不含货币符号），固定两位小数：`3.5 → "3.50"`。
///
/// 非有限值（NaN/±∞/null 解出的 NaN）返回 `"0.00"`：与 JS `formatPrice` 的
/// `if (!Number.isFinite(value)) return '0.00'` 同口径（不是 `"—"`，别改）。
pub fn format_price(value: f64) -> String {
    if !value.is_finite() {
        return "0.00".to_string();
    }
    js_to_fixed(value, 2)
}

/// 带 ¥ 前缀：`3.5 → "¥3.50"`。
pub fn format_yuan(value: f64) -> String {
    format!("¥{}", format_price(value))
}

/// 整数计数（千分位）：`1234 → "1,234"`；非有限值 → `"0"`。
pub fn format_count(value: f64) -> String {
    if !value.is_finite() {
        return "0".to_string();
    }
    let rounded = crate::js_round(value);
    // zh-CN 的 Number 格式：拉丁数字、每三位一个 ','，负数带 '-'。
    // 用 (i64, bool) 而不是直接格式化 f64，是为了不把大数写成科学计数法
    // （JS 的 toLocaleString 对 1e21 以上才会退化，这里业务值域远小于它）。
    let neg = rounded < 0.0;
    let abs = rounded.abs();
    if abs >= 9.0e15 {
        // 超过 i64 精确整数范围：退化成 JS 科学计数法的等价写法，并留痕给调用方。
        return format!("{}", rounded);
    }
    let digits = abs as i64;
    let s = group_thousands(digits);
    if neg {
        format!("-{}", s)
    } else {
        s
    }
}

/// 百分比（入参为「小数比率」）：`0.123 → "12.3%"`；`None`/非有限 → `"—"`。
pub fn format_percent(ratio: Option<f64>, digits: usize) -> String {
    let Some(r) = ratio else {
        return "—".to_string();
    };
    if !r.is_finite() {
        return "—".to_string();
    }
    format!("{}%", js_to_fixed(r * 100.0, digits))
}

/// 千分位分组（纯字符串分组，不引入 locale 库）。
fn group_thousands(value: i64) -> String {
    let s = value.to_string();
    let (sign, digits) = match s.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", s.as_str()),
    };
    let bytes = digits.as_bytes();
    let mut out = String::with_capacity(bytes.len() + bytes.len() / 3 + 1);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*b as char);
    }
    format!("{}{}", sign, out)
}

/// `Number.prototype.toFixed` 的等价实现。
///
/// 与 Rust `format!("{:.n}")` 的差异点：ECMAScript 规定「两个候选同样接近时取较大的 n」
/// （即 0.125 保留两位 → "0.13"，不是银行家舍入的 "0.12"）。所以这里先按
/// `10^n` 放大、用 `x + 0.5` 的 floor 规则取整，再手工拼小数点 —— 走的是与 JS
/// 同一条规则，而不是 Rust 默认的 formatter。
///
/// 已知边界：值域超过 `2^53/10^n` 时 JS 同样会退化（toFixed 规范里允许实现相关），
/// 业务面（价格、比例）远小于该边界，故双方都不可达。
pub fn js_to_fixed(value: f64, digits: usize) -> String {
    if !value.is_finite() {
        return if value.is_nan() {
            "NaN".to_string()
        } else if value > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    let scale = 10f64.powi(digits as i32);
    let scaled = value * scale;
    // ECMAScript 的 toFixed 先按「最近的可表示十进制」取整，平局取绝对值更大的那个。
    // 由于 scaled 本身已经有二进制误差，这里用 floor(x*scale + 0.5) 与 JS 实现一致；
    // 极端平局（如 0.125*100 = 12.5 精确）由 +0.5 规则选中 13 ⇒ "0.13"。
    let rounded = (scaled.abs() + 0.5).floor() * scaled.signum();
    if digits == 0 {
        return format!("{}", rounded as i64);
    }
    let neg = rounded < 0.0;
    let abs = rounded.abs();
    let int_part = (abs / scale).floor() as i64;
    let frac_part = (abs - int_part as f64 * scale).round() as i64;
    let mut out = format!("{}", int_part);
    out.push('.');
    out.push_str(&format!("{:0width$}", frac_part, width = digits));
    if neg {
        format!("-{}", out)
    } else {
        out
    }
}
