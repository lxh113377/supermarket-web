//! 下单入口的**纯计算层**：现网 functions/lib/actions/orders.js 的校验 / 计价 / 指纹 / 幂等 / 最优档 / 规格解析。
//!
//! 为什么先做这一层：createOrder 是全仓最长的写动作（20 步），而其中只有最后 6 步碰 SQL。
//! 前面全是可喂构造数据逐字节对账的纯函数，也正是最容易抄错的地方 —— 抄错不报错，
//! 只会让「同一单被判成两单」或「顾客改了口味等于没改」这类事故静默发生（现网 2026-09-26 真出过后者）。
//!
//! 几处必须逐字对齐的点：
//! · 指纹六段用 NUL 字符连接：room / wechat / remark / 金额(toFixed(2)) / 行规约 / 截图长度段；
//! · 行规约 = 每行 productId + x + quantity + @ + (spec 或空串)，排序后用逗号连接 —— 口味折在 spec 里，
//!   必须参与指纹（否则同房间 90 秒内改口味会被判成重复单、复用旧单）；
//! · 截图段只在字符串时才有：井号 + 长度（只取长度，不把 base64 灌进指纹）；
//! · fnv1a 按 UTF-16 码元逐位做（对应 JS 的 charCodeAt），乘法用 Math.imul 的 32 位环绕语义；
//! · 幂等键 = 房间号(trim/40 字符) + @ + requestId(白名单字符 + 64 字符) + 井号 + fnv1a(指纹)，
//!   requestId 不是字符串或过滤后为空则返回 None（走指纹去重路径）。

use serde_json::{json, Value};

use crate::{js_round, MAX_QTY_PER_LINE, MIN_DELIVERY_AMOUNT};

/// 指纹的连接符：JS 用的是一串里的 NUL 字符（这里等价地构造）。
fn nul_sep() -> String {
    String::from(char::from(0u8))
}

/// 现网 functions/lib/shared.js:36 —— 单语句体积预算（整条记录序列化后的字符数）。
pub const MAX_STATEMENT_PAYLOAD_CHARS: usize = 90_000;

/// JS 的 fnv1a（orders.js:33）：UTF-16 码元、Math.imul 环绕、8 位 hex 补零。
pub fn fnv1a(s: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for unit in s.encode_utf16() {
        h ^= unit as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{h:08x}")
}

/// JS 的 Number(x).toFixed(2)（指纹里用的是它）。
pub fn js_to_fixed2(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".to_string() } else { "-Infinity".to_string() };
    }
    // JS 的 (-0).toFixed(2) 是 "0.00"（负零不带负号），而 Rust 会打成 "-0.00"
    // —— 而 (-0.001).toFixed(2) 又是 "-0.00"（非零负数保留负号），所以只特判真正的 0。
    if x == 0.0 {
        return "0.00".to_string();
    }
    // JS 的 toFixed 是「按 double 的**精确十进制值**取两位，恰好半值取较大者」。
    // 两种天真的实现都会错：
    //   · format!("{x:.2}") 走半偶 ⇒ 0.125 给 0.12（JS 是 0.13）；
    //   · (x*100).round()/100 会引入乘法误差 ⇒ 2.675 给 2.68（JS 是 2.67）。
    // 所以取 20 位小数展开（double 的有效十进制位 ≤ 17 位，20 位足够），再手工按半值向上修约到两位。
    let negative = x < 0.0;
    let s = format!("{:.20}", x.abs());
    let (int_part, frac_part) = s.split_once(String::from(char::from(46)).as_str()).unwrap_or((s.as_str(), "0"));
    let head = format!("{int_part}{}", &frac_part[..2]);
    let round_up = frac_part.as_bytes().get(2).map(|b| *b >= b'5').unwrap_or(false);
    let mut cents: u128 = head.parse::<u128>().unwrap_or(0);
    if round_up {
        cents += 1;
    }
    let int_digits = int_part.len();
    let cents_str = format!("{cents:0width$}", width = int_digits + 2);
    let (i, f) = cents_str.split_at(int_digits);
    let sign = if negative && cents != 0 { "-" } else { "" };
    format!("{sign}{i}.{f}")
}

/// 指纹里的行规约：每行 productId x quantity @ spec，排序后逗号连接。
pub fn fingerprint_lines(items: &[Value]) -> String {
    let mut lines: Vec<String> = items
        .iter()
        .map(|i| {
            let pid = i.get("productId").and_then(|v| v.as_str()).unwrap_or("");
            let qty = i
                .get("quantity")
                .and_then(|v| v.as_f64())
                .map(crate::jsnum::js_number_string)
                .unwrap_or_else(|| "NaN".to_string());
            let spec = i.get("spec").and_then(|v| v.as_str()).unwrap_or("");
            format!("{pid}x{qty}@{spec}")
        })
        .collect();
    lines.sort();
    lines.join(",")
}

/// 现网 orders.js:53 的 orderFingerprint（六段）。
pub fn order_fingerprint(
    room_number: &str,
    wechat: &str,
    remark: &str,
    total_amount: f64,
    items: &[Value],
    payment_screenshot: Option<&Value>,
) -> String {
    let lines = fingerprint_lines(items);
    let shot = match payment_screenshot {
        Some(Value::String(s)) => format!("#{}", s.chars().count()),
        _ => String::new(),
    };
    [
        room_number.to_string(),
        wechat.to_string(),
        remark.to_string(),
        js_to_fixed2(total_amount),
        lines,
        shot,
    ]
    .join(&nul_sep())
}
/// 现网 orders.js:45 的 idempotencyKey：requestId 不是字符串或过滤后为空则 None。
pub fn idempotency_key(
    room_number: &str,
    request_id: Option<&Value>,
    fingerprint: &str,
) -> Option<String> {
    let Value::String(raw) = request_id? else {
        return None;
    };
    // JS 的 \w 是 [A-Za-z0-9_]；另外保留 : . - 三类标点
    let filtered: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':' || *c == '.' || *c == '-')
        .take(64)
        .collect();
    if filtered.is_empty() {
        return None;
    }
    let room: String = slice_utf16(room_number.trim(), 40);
    Some(format!("{room}@{filtered}#{}", fnv1a(fingerprint)))
}

/// 现网 orders.js:90 的 allowedOrderSpecs：商品目录 spec 加上每个启用的口味组合。
pub fn allowed_order_specs(product: &Value) -> Vec<String> {
    let base = product
        .get("spec")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let mut out: Vec<String> = vec![base.clone()];
    let opts = crate::api_shapes::jparse(product.get("specOptions"), json!([]));
    if let Value::Array(list) = opts {
        for o in list {
            let label = o
                .get("label")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if label.is_empty() {
                continue;
            }
            if o.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
                continue;
            }
            let combo = if base.is_empty() {
                label.clone()
            } else {
                format!("{base} · {label}")
            };
            if !out.contains(&combo) {
                out.push(combo);
            }
        }
    }
    out
}

/// 现网 orders.js:106 的 resolveOrderSpec：非法 / 空 / 未启用则回落商品真值 spec。
pub fn resolve_order_spec(product: &Value, client_spec: Option<&Value>) -> String {
    let base = product.get("spec").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let want = match client_spec {
        Some(Value::String(s)) => s.trim().to_string(),
        _ => String::new(),
    };
    if !want.is_empty() && allowed_order_specs(product).iter().any(|x| x == &want) {
        want
    } else {
        base
    }
}

/// 现网 orders.js:110 的 bestPromotion（防御式：缺表则零优惠）。返回 (promotionId, discountAmount)。
pub fn best_promotion(rows: &[Value], subtotal: f64) -> (String, f64) {
    let mut best: Option<(String, f64)> = None;
    for r in rows {
        let th = crate::jsnum::js_number_of(r.get("threshold"));
        let dc = crate::jsnum::js_number_of(r.get("discount"));
        if th <= 0.0 || dc <= 0.0 {
            continue;
        }
        let better = match &best {
            None => true,
            Some((_, cur)) => dc > *cur,
        };
        if subtotal >= th && better {
            let id = r.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            best = Some((id, dc.min(subtotal)));
        }
    }
    best.unwrap_or_else(|| (String::new(), 0.0))
}

/// 现网 security.js:135 的 isSafeImageUrl（三段白名单：data:image / r2: / https）。
pub fn is_safe_image_url(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    for kind in ["jpeg", "png", "webp", "gif"] {
        let prefix = format!("data:image/{kind};base64,");
        if let Some(rest) = url.strip_prefix(&prefix) {
            if !rest.is_empty()
                && rest
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
            {
                return true;
            }
        }
    }
    if let Some(rest) = url.strip_prefix("r2:") {
        let len = rest.chars().count();
        if (1..=128).contains(&len)
            && !rest.contains("..")
            && rest
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '_' || c == '.' || c == '-')
        {
            return true;
        }
    }
    // https：scheme 大小写不敏感（JS 的 new URL 会归一），且必须真有主机 ——
    // "https:///x" 这种空主机在 JS 里 hostname 为空则拒；第一版只判前缀长度，会误放。
    let lower = url.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("https://") {
        let stop = [char::from(47u8), char::from(63u8), char::from(35u8)];
        let authority = rest.split(|c: char| stop.contains(&c)).next().unwrap_or("");
        return !authority.is_empty();
    }
    false
}

/// 现网 orders.js:219 的舍入点：Math.round(x*100)/100。
pub fn round2(x: f64) -> f64 {
    js_round(x * 100.0) / 100.0
}

/// 现网 orders.js:203 的计价：price × qty（price 走 Number(x)||0）。
pub fn line_total(price: f64, qty: i64) -> f64 {
    price * qty as f64
}

/// 起送门槛判定（折前小计，与前端 meetsMinDelivery 同口径）。
pub fn below_min_delivery(total_rounded: f64) -> bool {
    !crate::meets_min_delivery(total_rounded)
}

/// 单行数量必须是正整数（拦负数 / 小数 / 缺失）。
pub fn valid_quantity(qty: f64) -> bool {
    qty.is_finite() && qty.fract() == 0.0 && qty > 0.0
}

/// 单行数量硬顶。
pub fn quantity_over_limit(qty: i64) -> bool {
    qty > MAX_QTY_PER_LINE as i64
}

/// 起送门槛常量（边缘层写消息时要用同一个值）。
pub fn min_delivery_amount() -> f64 {
    MIN_DELIVERY_AMOUNT
}

/// 现网 orders.js:214 的体积守卫：整条记录序列化后的字符数（按 UTF-16 码元计）。
pub fn statement_payload_chars(
    room: &str,
    wechat: &str,
    remark: &str,
    verified_items: &[Value],
    shot: &str,
) -> usize {
    // 关键：数字要先按 JS 的写法规整。serde_json 把 f64 的 3.0 打成 "3.0"，
    // 而 JSON.stringify(3.0) 是 "3" —— 差两个字符，体积守卫会算偏（复核子代理点出来的）。
    let items: Vec<Value> = verified_items
        .iter()
        .map(|it| {
            let mut m = it.as_object().cloned().unwrap_or_default();
            for key in ["price", "quantity"] {
                if let Some(v) = m.get(key).and_then(|v| v.as_f64()) {
                    m.insert(key.to_string(), crate::jsnum::js_number(v));
                }
            }
            Value::Object(m)
        })
        .collect();
    let doc = json!({
        "room": room,
        "wechat": wechat,
        "remark": remark,
        "items": items,
        "shot": shot,
    });
    doc.to_string().encode_utf16().count()
}

/// JS 的 String.prototype.slice(0, n)：按 **UTF-16 码元**计（不是字符数）。
///
/// 差别只在星平面字符（emoji）上体现：JS 把一个 emoji 算作 2 个单元，按 40 截断时可能劈开代理对。
/// 房号/备注出现 emoji 虽罕见，但「静默少半截」比报错更难查，所以照 JS 口径实现。
pub fn slice_utf16(s: &str, n: usize) -> String {
    let mut out = String::new();
    let mut used = 0usize;
    for c in s.chars() {
        let w = c.len_utf16();
        if used + w > n {
            break;
        }
        out.push(c);
        used += w;
    }
    out
}

