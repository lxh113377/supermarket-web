//! 看板聚合（纯计算）：现网 functions/lib/actions/stats.js 的同义实现（六段聚合 + 入口装配）。
//!
//! ## 一处**刻意照抄的上游缺陷**（不是笔误，请勿顺手修）
//!
//! 现网 localDayLabel(k) 的写法是 new Date(k*DAY_MS - TZ_SHIFT_MS) 再读 UTC 段：
//! 那个瞬间落在**桶的前一天**，所以标签比它标注的 UTC+8 日历日**早一天**
//! （注释声称「与 localDay 同口径」，实际没有做到 —— 它修的是另一个 bug：运行环境时区不同导致的错位）。
//!
//! 实测：nowMs=2026-03-10T04:00:00Z（东八区 3/10 12:00）时，今天那个桶的 label 是 "3/9"。
//! 更麻烦的是现网的 tests/stats.test.js:20 用了**同一个式子**，于是「实现与测试同错」，判据永远抓不到漂移。
//!
//! **本实现的处置**：照抄线上行为，并用用例把早一天写成**断言**，让它成为被记录的既有行为；
//! 修不修由独立工单决定（见 rust/docs/08 §2i.2）。
//!
//! ## 与 JS 的逐条对齐（易错处都在这里）
//!
//! · Math.round 是**向 +∞ 取整**（Rust f64::round 是远离 0）⇒ 本文件用 js_round(x) = floor(x + 0.5)；
//! · 数组长度是 days（不是 days+1）：labels 由 days-1 倒序生成；
//! · 分桶用 UTC+8 的日序号（local_day），越界（diff<0 或 diff>=days）直接跳过；
//! · buildPieSegments 的 quantity **不做 Number() 强转**（与 computeGrossMargin 不同）——
//!   非数字会让该桶变 NaN，而 NaN > 0 为假 ⇒ 该段被过滤掉（Rust 侧用 f64::NAN 复现同一结果）；
//! · buildTopRevenue 的排序是**稳定**排序（同营收保持首次插入序）⇒ Rust 用 sort_by（稳定）；
//! · computeGrossMargin 的 costPrice 为 null 要**跳过**（不是当 0），而 totalItems 已经先加过 qty。

use serde_json::{json, Map, Value};

pub const DAY_MS: i64 = 86_400_000;
pub const TZ_SHIFT_MS: i64 = 8 * 3_600_000;
pub const DRINK_SUBS: [&str; 7] = ["low_sugar", "vitamin", "energy", "tea", "soda", "sweet", "water"];
pub const DAILY_SUBS: [&str; 1] = ["daily_goods"];

/// JS Math.round：向 +∞ 取整（先加 0.5 再 floor）。
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// ISO(UTC) → UTC+8 日序号（stats.js:23 的 localDay）。
pub fn local_day(t_ms: i64) -> i64 {
    (t_ms + TZ_SHIFT_MS).div_euclid(DAY_MS)
}

/// 毫秒 → UTC 的 (年, 月, 日)，对应 new Date(ms) 的 getUTC* 家族。
pub fn civil_from_ms_utc(ms: i64) -> (i64, u32, u32) {
    crate::stale::civil_from_days(ms.div_euclid(DAY_MS))
}

/// 日序号 → 「M/D」标签（stats.js:32 的 localDayLabel，**含上游的早一天行为**）。
pub fn local_day_label(day_index: i64) -> String {
    let (_, m, d) = civil_from_ms_utc(day_index * DAY_MS - TZ_SHIFT_MS);
    format!("{m}/{d}")
}

/// 现网 stats.js:203 的 rangeDays 归一（非整数 ⇒ None：现网会在 new Array(7.5) 抛 RangeError ⇒ 500）。
pub fn stats_range_days(payload: Option<&Value>) -> Option<i64> {
    let raw = match payload.and_then(|p| p.get("rangeDays")) {
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
    let base = if raw.is_finite() && raw != 0.0 { raw } else { 7.0 };
    let clamped = base.clamp(1.0, 365.0);
    if clamped.fract() != 0.0 {
        return None;
    }
    Some(clamped as i64)
}
/// stats.js:36 的 buildRangeData。
pub fn build_range_data(orders: &[Value], days: i64, now_ms: i64) -> Value {
    let today = local_day(now_ms);
    let mut labels: Vec<Value> = Vec::new();
    let mut counts = vec![0f64; days as usize];
    let mut revenues = vec![0f64; days as usize];
    for i in (0..days).rev() {
        labels.push(json!(local_day_label(today - i)));
    }
    for o in orders {
        let ts = o.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let Some(t) = crate::stale::parse_iso_ms(ts) else {
            continue;
        };
        let diff = today - local_day(t);
        if diff < 0 || diff >= days {
            continue;
        }
        let idx = (days - 1 - diff) as usize;
        counts[idx] += 1.0;
        if o.get("status").and_then(|v| v.as_str()) != Some("cancelled") {
            revenues[idx] += number_of(o.get("totalAmount"));
        }
    }
    json!({
        "labels": labels,
        "orderCounts": counts.into_iter().map(num).collect::<Vec<_>>(),
        "revenues": revenues.into_iter().map(num).collect::<Vec<_>>(),
    })
}

/// stats.js:61 的 buildDelta。
pub fn build_delta(orders: &[Value], days: i64, now_ms: i64) -> Value {
    let today = local_day(now_ms);
    let half = |offset: i64| -> (f64, f64) {
        let from = (today - offset - days + 1) * DAY_MS - TZ_SHIFT_MS;
        let to = (today - offset + 1) * DAY_MS - TZ_SHIFT_MS;
        let (mut cnt, mut rev) = (0f64, 0f64);
        for o in orders {
            let ts = o.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
            let Some(t) = crate::stale::parse_iso_ms(ts) else {
                continue;
            };
            if t >= from && t < to {
                cnt += 1.0;
                if o.get("status").and_then(|v| v.as_str()) != Some("cancelled") {
                    rev += number_of(o.get("totalAmount"));
                }
            }
        }
        (cnt, rev)
    };
    let (cc, cr) = half(0);
    let (pc, pr) = half(days);
    let pct = |a: f64, b: f64| -> Value {
        if b > 0.0 {
            num(js_round((a - b) / b * 100.0))
        } else {
            Value::Null
        }
    };
    json!({ "ordersDelta": pct(cc, pc), "revenueDelta": pct(cr, pr) })
}

/// stats.js:86 的 buildReviewTrend（counts 在 labels 之前 —— 键序别抄反）。
pub fn build_review_trend(reviews: &[Value], days: i64, now_ms: i64) -> Value {
    let today = local_day(now_ms);
    let mut counts = vec![0f64; days as usize];
    let mut labels: Vec<Value> = Vec::new();
    for i in (0..days).rev() {
        labels.push(json!(local_day_label(today - i)));
    }
    for r in reviews {
        let raw = r.get("createdAt");
        let truthy = match raw {
            Some(Value::String(s)) => !s.is_empty(),
            Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
            Some(Value::Bool(b)) => *b,
            _ => false,
        };
        if !truthy {
            continue;
        }
        let ts = raw.and_then(|v| v.as_str()).unwrap_or("");
        let Some(t) = crate::stale::parse_iso_ms(ts) else {
            continue;
        };
        let diff = today - local_day(t);
        if diff >= 0 && diff < days {
            counts[(days - 1 - diff) as usize] += 1.0;
        }
    }
    json!({
        "counts": counts.into_iter().map(num).collect::<Vec<_>>(),
        "labels": labels,
    })
}

/// 现网 Number(x) 与逻辑或 0 的同义（取不出数 ⇒ 0）。
fn number_of(v: Option<&Value>) -> f64 {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    if n.is_finite() {
        n
    } else {
        0.0
    }
}

/// JS 数字 → JSON：整数写整数（JSON.stringify(50) 是 50，不是 50.0）。
fn num(x: f64) -> Value {
    if !x.is_finite() {
        return Value::Null;
    }
    if x.fract() == 0.0 && x.abs() < 9.0e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

fn to_margin(revenue: f64, cost: f64) -> Value {
    if revenue <= 0.0 {
        return Value::Null;
    }
    let r = js_round(revenue * 100.0) / 100.0;
    let c = js_round(cost * 100.0) / 100.0;
    let mut out = Map::new();
    out.insert("revenue".into(), num(r));
    out.insert("cost".into(), num(c));
    out.insert("marginPct".into(), num(js_round((r - c) / r * 100.0)));
    Value::Object(out)
}

fn has_sub(item: &Value, set: &[&str]) -> bool {
    match item.get("subcategories") {
        Some(Value::Array(list)) => list
            .iter()
            .any(|s| s.as_str().map(|x| set.contains(&x)).unwrap_or(false)),
        _ => false,
    }
}

/// stats.js:117 的 computeGrossMargin。
pub fn compute_gross_margin(orders: &[Value], products: &[Value]) -> Value {
    let (mut drink, mut food, mut daily) = ((0f64, 0f64), (0f64, 0f64), (0f64, 0f64));
    let mut with_cost_items = 0f64;
    let mut total_items = 0f64;
    for o in orders {
        if o.get("status").and_then(|v| v.as_str()) == Some("cancelled") {
            continue;
        }
        let items = crate::api_shapes::jparse(o.get("items"), json!([]));
        let Value::Array(list) = items else {
            continue;
        };
        for it in list {
            let qty = number_of(it.get("quantity"));
            total_items += qty;
            let pid = it.get("productId").and_then(|v| v.as_str()).unwrap_or("");
            let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let spec = it.get("spec").and_then(|v| v.as_str()).unwrap_or("");
            let key = format!("{name}|{spec}");
            let p = products
                .iter()
                .find(|p| p.get("_id").and_then(|v| v.as_str()) == Some(pid))
                .or_else(|| {
                    products.iter().find(|p| {
                        let pn = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let ps = p.get("spec").and_then(|v| v.as_str()).unwrap_or("");
                        format!("{pn}|{ps}") == key
                    })
                });
            let Some(p) = p else { continue };
            let Some(cp) = p.get("costPrice") else { continue };
            if cp.is_null() {
                continue;
            }
            let cost_unit = number_of(Some(cp));
            let revenue = number_of(it.get("price")) * qty;
            let cost = cost_unit * qty;
            let is_daily = has_sub(&it, &DAILY_SUBS);
            let is_drink = match it.get("subcategories") {
                Some(Value::Array(_)) => has_sub(&it, &DRINK_SUBS),
                _ => true,
            };
            if is_daily {
                daily.0 += revenue;
                daily.1 += cost;
            } else if is_drink {
                drink.0 += revenue;
                drink.1 += cost;
            } else {
                food.0 += revenue;
                food.1 += cost;
            }
            with_cost_items += qty;
        }
    }
    let mut out = Map::new();
    out.insert("drink".into(), to_margin(drink.0, drink.1));
    out.insert("food".into(), to_margin(food.0, food.1));
    out.insert("daily".into(), to_margin(daily.0, daily.1));
    out.insert("withCostItems".into(), num(with_cost_items));
    out.insert("totalItems".into(), num(total_items));
    Value::Object(out)
}

/// stats.js:158 的 buildPieSegments（quantity **不做 Number 强转**）。
pub fn build_pie_segments(orders: &[Value]) -> Value {
    let (mut drink, mut food, mut daily) = (0f64, 0f64, 0f64);
    for o in orders {
        if o.get("status").and_then(|v| v.as_str()) == Some("cancelled") {
            continue;
        }
        let items = crate::api_shapes::jparse(o.get("items"), json!([]));
        let Value::Array(list) = items else {
            continue;
        };
        for it in list {
            let qty = match it.get("quantity") {
                Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                _ => f64::NAN,
            };
            match it.get("subcategories") {
                Some(Value::Array(_)) => {
                    if has_sub(&it, &DAILY_SUBS) {
                        daily += qty;
                    } else if has_sub(&it, &DRINK_SUBS) {
                        drink += qty;
                    } else {
                        food += qty;
                    }
                }
                _ => drink += qty,
            }
        }
    }
    let mut out: Vec<Value> = Vec::new();
    for (name, v) in [("饮品", drink), ("食品", food), ("日用", daily)] {
        if v > 0.0 {
            out.push(json!({ "name": name, "value": num(v) }));
        }
    }
    Value::Array(out)
}

/// stats.js:182 的 buildTopRevenue（稳定排序 ⇒ 同营收保持首次插入序）。
pub fn build_top_revenue(orders: &[Value]) -> Value {
    let mut rev: Vec<(String, f64, f64)> = Vec::new();
    for o in orders {
        if o.get("status").and_then(|v| v.as_str()) == Some("cancelled") {
            continue;
        }
        let items = crate::api_shapes::jparse(o.get("items"), json!([]));
        let Value::Array(list) = items else {
            continue;
        };
        for it in list {
            let name = it.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let spec = it.get("spec").and_then(|v| v.as_str()).unwrap_or("");
            let key = if spec.is_empty() {
                name.to_string()
            } else {
                format!("{name}({spec})")
            };
            let q = number_of(it.get("quantity"));
            let add = number_of(it.get("price")) * q;
            match rev.iter_mut().find(|(k, _, _)| k == &key) {
                Some((_, r, qq)) => {
                    *r += add;
                    *qq += q;
                }
                None => rev.push((key, add, q)),
            }
        }
    }
    rev.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let out: Vec<Value> = rev
        .into_iter()
        .take(10)
        .map(|(name, revenue, qty)| json!({ "name": name, "revenue": num(revenue), "qty": num(qty) }))
        .collect();
    Value::Array(out)
}

/// stats.js:228 的入口装配：六段 + 三个合计，键序照抄。
pub fn dashboard_data(
    orders: &[Value],
    reviews: &[Value],
    products: &[Value],
    range_days: i64,
    now_ms: i64,
) -> Value {
    let range_data = build_range_data(orders, range_days, now_ms);
    let delta = build_delta(orders, range_days, now_ms);
    let review_trend = build_review_trend(reviews, 14, now_ms);
    let margin = compute_gross_margin(orders, products);
    let pie = build_pie_segments(orders);
    let top = build_top_revenue(orders);
    let revenue_sum: f64 = range_data["revenues"]
        .as_array()
        .map(|a| a.iter().map(|v| v.as_f64().unwrap_or(0.0)).sum())
        .unwrap_or(0.0);
    let order_sum: f64 = range_data["orderCounts"]
        .as_array()
        .map(|a| a.iter().map(|v| v.as_f64().unwrap_or(0.0)).sum())
        .unwrap_or(0.0);
    let mut out = Map::new();
    out.insert("rangeDays".into(), json!(range_days));
    out.insert("rangeData".into(), range_data);
    out.insert("delta".into(), delta);
    out.insert("reviewTrend".into(), review_trend);
    out.insert("margin".into(), margin);
    out.insert("pieSegments".into(), pie);
    out.insert("topRevenue".into(), top);
    out.insert("revenueSum".into(), num(revenue_sum));
    out.insert("orderSum".into(), num(order_sum));
    out.insert("totalOrders".into(), json!(orders.len()));
    Value::Object(out)
}

