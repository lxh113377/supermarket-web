//! 超时未支付单盘点（`stalePendingReport`）的纯计算部分：现网 `functions/lib/actions/orders.js:363` 同义实现。
//!
//! 这个动作有一处别处没有的难点：**它依赖当前时间**（`cutoff = Date.now() - minutes*60000`，
//! 以及每单的 `ageMinutes = round((Date.now() - Date.parse(createdAt))/60000)`）。
//! 要把「依赖时间」的部分与「纯组装」的部分分开，才能既对齐现网、又能写稳定用例：
//!
//!   · `stale_minutes` / `parse_iso_ms` / `age_minutes` —— 时间相关的纯函数（now_ms 由调用方传入）；
//!   · `stale_report` —— 纯组装（喂 rows + prods + now_ms，出与原实现逐字节相同的 data）。
//!
//! ## 与 JS 的逐条对齐
//!
//! · `minutes`：`Math.min(Math.max(Number(payload?.minutes) || 60, 1), 10080)` —— 默认 60、钳 [1, 7 天]；
//! · `ageMinutes`：`Math.max(0, Math.round((now - Date.parse(createdAt)) / 60000))` —— 未来时间落 0；
//! · `hasPaymentProof`：`Boolean(paymentScreenshot)`（空串/null 都是 false）；
//! · `stockReserved`：按「订单 → items」的**首次出现顺序**聚合，只算 `stock >= 0` 的商品（不限售项不计占用）；
//!   `reserved += Number(quantity) || 0`；
//! · 空结果**早退**：`{ thresholdMinutes, count: 0, orders: [], stockReserved: [] }`（不做商品查询）。
//!
//! ## 一处**已知差异**（照实写，别让读者以为逐字节全等）
//!
//! 现网用 `Date.parse(createdAt)`：时间串坏掉时得 NaN，`Math.round(NaN)` 仍是 NaN，
//! 再 `Math.max(0, NaN)` 还是 NaN ⇒ 该字段被 JSON 序列化成 `null`。
//! 本实现解析失败时**落 0**（因为 Rust 侧没有 NaN 这种 JSON 值），差异只出现在「createdAt 坏掉」这一种输入上。

use serde_json::{json, Map, Value};

/// 盘点窗口的上限：7 天（现网 `7 * 24 * 60`）。
pub const STALE_MINUTES_MAX: i64 = 7 * 24 * 60;
/// 默认窗口：60 分钟。
pub const STALE_MINUTES_DEFAULT: i64 = 60;

/// `Math.min(Math.max(Number(payload?.minutes) || 60, 1), 10080)`。
pub fn stale_minutes(payload: Option<&Value>) -> i64 {
    let raw = match payload.and_then(|p| p.get("minutes")) {
        None | Some(Value::Null) => 0.0,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(_) => 0.0,
    };
    let base = if raw.is_finite() && raw != 0.0 {
        raw.trunc() as i64
    } else {
        STALE_MINUTES_DEFAULT
    };
    base.clamp(1, STALE_MINUTES_MAX)
}

/// 把 ISO-8601（`YYYY-MM-DDTHH:MM:SS.sssZ`，现网 `new Date().toISOString()` 的形状）解析成毫秒。
///
/// 为什么不引日期库：这个格式是**固定宽度**的（本项目所有时间戳都出自 `toISOString()`），
/// 手写解析 20 行、可被用例逐条钉住；引 chrono/time 只为这一处不值得（依赖精简是明确选择）。
pub fn parse_iso_ms(ts: &str) -> Option<i64> {
    let b = ts.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'.'
    {
        return None;
    }
    let num = |a: usize, z: usize| -> Option<i64> { ts.get(a..z)?.parse::<i64>().ok() };
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, s) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let ms = num(20, 23)?;
    if !(1970..=9999).contains(&y) || !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, mo as u32, d as u32);
    Some(days * 86_400_000 + h * 3_600_000 + mi * 60_000 + s * 1_000 + ms)
}

/// Howard Hinnant 的 days_from_civil（`civil_from_days` 的逆；与 `chrono` 同一算法）。
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if m > 2 { (m - 3) as u64 } else { (m + 9) as u64 };
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// 任意毫秒 → ISO-8601（与 `new Date(ms).toISOString()` 同形）。
///
/// 现网用 `new Date(Date.now() - minutes*60000).toISOString()` 造 cutoff，
/// 边缘侧也需要「给定毫秒的 ISO」——放在这里，避免两处各写一份格式化。
pub fn iso_from_ms(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let hh = rem / 3_600_000;
    let mm = (rem % 3_600_000) / 60_000;
    let ss = (rem % 60_000) / 1_000;
    let mss = rem % 1_000;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{mss:03}Z")
}

/// `days_from_civil` 的逆（Howard Hinnant 同一套算法）。
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

/// 从 pending 单里按**出现顺序去重**取出 productId（现网 `[...new Set(rows.flatMap(...))]`）。
pub fn stale_product_ids(rows: &[Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in rows {
        let items = crate::api_shapes::jparse(r.get("items"), json!([]));
        if let Value::Array(list) = &items {
            for it in list {
                if let Some(pid) = it.get("productId").and_then(|v| v.as_str()) {
                    if !pid.is_empty() && !out.iter().any(|x| x == pid) {
                        out.push(pid.to_string());
                    }
                }
            }
        }
    }
    out
}

/// `Math.max(0, Math.round((now - created) / 60000))`；解析不出时间 ⇒ 0（见文件头的已知差异）。
pub fn age_minutes(now_ms: i64, created_at: &str) -> i64 {
    let Some(created) = parse_iso_ms(created_at) else {
        return 0;
    };
    let diff = (now_ms - created) as f64 / 60_000.0;
    let r = diff.round();
    if r.is_finite() {
        (r as i64).max(0)
    } else {
        0
    }
}

/// 现网 stalePendingReport 的纯组装部分：`{ thresholdMinutes, count, orders, stockReserved }`。
///
/// `rows` = 已按 createdAt 升序的 pending 单；`prods` = 相关商品（按 productId 索引）。
pub fn stale_report(rows: &[Value], prods: &[Value], now_ms: i64, minutes: i64) -> Value {
    // 空结果早退（现网就是这么写的：连商品查询都不做）
    if rows.is_empty() {
        return json!({
            "thresholdMinutes": minutes,
            "count": 0,
            "orders": [],
            "stockReserved": [],
        });
    }
    let find_prod = |id: &str| -> Option<&Value> {
        prods
            .iter()
            .find(|p| p.get("_id").and_then(|v| v.as_str()) == Some(id))
    };
    let mut orders: Vec<Value> = Vec::new();
    // stockReserved 用 Vec 保序（JS 的 Map 也是插入序）
    let mut reserved: Vec<(String, Value)> = Vec::new();
    for r in rows {
        let items = crate::api_shapes::jparse(r.get("items"), json!([]));
        if let Value::Array(list) = &items {
            for it in list {
                let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
                let Some(p) = find_prod(pid) else { continue };
                // 不限售（stock < 0）不计占用
                let stock = p.get("stock").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if stock < 0.0 {
                    continue;
                }
                let qty = it.get("quantity").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let name = p.get("name").cloned().unwrap_or(Value::Null);
                match reserved.iter_mut().find(|(k, _)| k == pid) {
                    Some((_, v)) => {
                        let cur = v.get("reserved").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        v["reserved"] = json!((cur + qty) as i64);
                    }
                    None => {
                        reserved.push((
                            pid.to_string(),
                            json!({ "productId": pid, "name": name, "reserved": qty as i64 }),
                        ));
                    }
                }
            }
        }
        let created = r.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let has_proof = match r.get("paymentScreenshot") {
            Some(Value::String(s)) => !s.is_empty(),
            Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
            Some(Value::Bool(b)) => *b,
            _ => false,
        };
        let mut o = Map::new();
        o.insert("id".into(), r.get("_id").cloned().unwrap_or(Value::Null));
        o.insert(
            "roomNumber".into(),
            r.get("roomNumber").cloned().unwrap_or(Value::Null),
        );
        o.insert(
            "totalAmount".into(),
            r.get("totalAmount").cloned().unwrap_or(Value::Null),
        );
        o.insert("ageMinutes".into(), json!(age_minutes(now_ms, created)));
        o.insert("hasPaymentProof".into(), Value::Bool(has_proof));
        orders.push(Value::Object(o));
    }
    json!({
        "thresholdMinutes": minutes,
        "count": orders.len(),
        "orders": orders,
        "stockReserved": reserved.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
    })
}
