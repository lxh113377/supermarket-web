//! CSV 导出（Excel 兼容）—— 与 `src/utils/csv.ts` 一一对应。
//!
//! 这份实现存在的理由是**它是全站唯一一处 CPU 密集、且输入规模由外部决定的纯计算**：
//! 管理后台导出订单/看板时行数可达数千到数万行，JS 侧是「逐单元格正则 + 字符串拼接」，
//! 在手机上（管理端也可能被手机打开）会明显掉帧。把它搬进 WASM 是本次
//! 「用 Rust 提升响应速度」里收益最直接的一处（体积与初始化成本见 docs/05）。

/// 单元格转义：含 **逗号/引号/换行** 的值用双引号包裹，内部 `"` 翻倍。
///
/// 判据与 JS `/[",\n]/.test(s)` 完全一致：只认这三个字符（`\r` **不算** ——
/// 这是 JS 侧的既有行为，改了会让既有导出文件的列数在 Excel 里对不上）。
pub fn csv_escape(v: &str) -> String {
    if v.contains('"') || v.contains(',') || v.contains('\n') {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

/// 数字 → JS `String(number)` 等价文本。
///
/// 三个差异点（都是实测过的，不是理论）：
///   - `123.0` ⇒ JS 是 `"123"`，serde_json 会写 `"123.0"`；
///   - `0.1+0.2` 这类二进制尾巴 ⇒ 双方都输出最短往返表示，一致；
///   - `1e21` 以上 ⇒ JS 走科学计数法（`"1e+21"`），本函数不处理（业务值域不可达）。
pub fn js_number_to_string(n: f64) -> String {
    if !n.is_finite() {
        // JS 的 String(NaN) / String(Infinity)：CSV 里出现它们说明上游算错了，
        // 但格式仍要对齐（否则 Excel 打开会看到 "NaN" 与 "NaN" 之外的东西）。
        return if n.is_nan() {
            "NaN".to_string()
        } else if n > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if n == n.trunc() && n.abs() < 1e15 {
        return format!("{}", n as i64);
    }
    // 最短往返：Rust 的 `{}` 对 f64 走的是「最短且能往返」的表示，与 JS 一致。
    let s = format!("{}", n);
    s
}

/// 构建 CSV 文本：**自动加 UTF-8 BOM + 一律 CRLF**、末行不带换行。
///
/// BOM 不是装饰：不加的话 Excel（Windows 简中）会按 GBK 解码，中文列全变乱码；
/// 这是现网既有行为，Rust 侧照抄而不是「顺手去掉看不见的字符」。
pub fn build_csv_text(header: &[String], rows: &[Vec<String>]) -> String {
    let header_refs: Vec<&str> = header.iter().map(|s| s.as_str()).collect();
    let row_refs: Vec<Vec<&str>> = rows
        .iter()
        .map(|row| row.iter().map(|s| s.as_str()).collect())
        .collect();
    build_csv_text_refs(&header_refs, &row_refs)
}

/// 借用式版本：`build_csv_text` 的实现本体（字符串切片进、一整块 String 出）。
///
/// 为什么单独有这个函数：WASM 侧的输入本来就在线性内存里，如果先逐单元格
/// `to_string()` 再调 `build_csv_text`，一次导出会产生上万个临时 String，
/// 实测这比原来的 JS 正则实现还慢（见 docs/05「被数据否掉的一条优化」）。
/// 借用式 + 追加式把分配降到「一次输出缓冲」，才是这条路径该有的形状。
pub fn build_csv_text_refs(header: &[&str], rows: &[Vec<&str>]) -> String {
    // 预分配：CSV 输出通常略大于输入（引号翻倍、BOM、CRLF）。按 1.2 倍起手，
    // 避免上万行时反复增长（这是这条路径上唯一有意义的一次估算）。
    let estimate = header.iter().map(|c| c.len()).sum::<usize>()
        + rows
            .iter()
            .flat_map(|row| row.iter())
            .map(|c| c.len() + 3)
            .sum::<usize>();
    let mut out = String::with_capacity(estimate + estimate / 5 + 3);
    out.push('\u{FEFF}');
    append_csv_line(&mut out, header);
    for row in rows {
        out.push('\r');
        out.push('\n');
        append_csv_line(&mut out, row);
    }
    out
}

/// 把一行（已借用）追加进输出：单元格之间逗号分隔，**不分配任何临时 String**。
fn append_csv_line(out: &mut String, cells: &[&str]) {
    for (index, cell) in cells.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        append_escaped(out, cell);
    }
}

/// 与 [csv_escape] 同一判定，但直接写进输出缓冲。
pub fn append_escaped(out: &mut String, value: &str) {
    // 只在必要（含逗号/引号/换行）时才走转义分支 —— 导出表里绝大多数单元格是干净的。
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        out.push('"');
        for ch in value.chars() {
            if ch == '"' {
                out.push('"');
            }
            out.push(ch);
        }
        out.push('"');
    } else {
        out.push_str(value);
    }
}
