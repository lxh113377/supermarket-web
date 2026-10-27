//! 现网 API 的**行 → JSON 形状**映射（纯函数，无 IO）。
//!
//! 来源：`functions/lib/actions/products.js` 的 `rowToProduct` / `rowToCategory` 与
//! `getCatalogOrders` 的循环体（逐条在下面标了行号）。这一层单独抽出来的理由：
//!
//! 1. 它是「45 个动作逐个原生化」（P3）里**最容易出错、也最容易验证**的一段 ——
//!    SQL 抄错会 500，而映射抄错只会让某个字段悄悄变成 `null`/`0`（前端不报错，数据已错）；
//! 2. 纯函数 ⇒ 不需要 D1 凭据就能 `cargo test` 钉住（本机确实没有 D1 API token，
//!    见 `rust/docs/08-api-native.md` 的凭据缺口记录）；
//! 3. 两个宿主（边缘服务的原生动作、将来的 WASM 侧）共用同一份映射。
//!
//! ## 与 JS 的逐条对齐（差异点写在注释里，别"顺手优化"）
//!
//! · `Number(x) || 0`：**任何**取不出数字的输入（null/""/"abc"/NaN）都落 0，
//!   而 `0` 本身也落 0 —— 于是"缺值"与"真的是 0"在响应里不可区分，这是现网既定行为；
//! · `row.spec || ''`：falsy（null/""/0/false）都变 `''`；
//! · `row.enabled === 1 || row.enabled === true`：**严格等于**，所以 `"1"`（字符串）判 false；
//! · `stock`：null 或 NaN ⇒ `-1`（= 不限售），否则 `Math.trunc`（向零截断，不是四舍五入）；
//! · `jparse(v, fallback)`：null ⇒ fallback；**非字符串原样返回**（已解析过的数组直接过）；
//!   字符串则 JSON.parse，失败落 fallback；
//! · `specOptions`：jparse 之后再 `Array.isArray` 判一次 —— 解析出对象/标量也算脏值，回空数组；
//! · 字段顺序 = JS 对象字面量顺序（靠 serde_json 的 preserve_order 保持）。

use serde_json::{json, Map, Value};

/// 与 `functions/lib/db.js:24` 的 `jparse` 同语义。
pub fn jparse(v: Option<&Value>, fallback: Value) -> Value {
    match v {
        None => fallback,
        Some(Value::Null) => fallback,
        // 非字符串原样返回：已解析过的数组/对象直接过（D1 的 JSON 列有时是文本、有时已被驱动解析）
        Some(other) if !other.is_string() => other.clone(),
        Some(Value::String(text)) => serde_json::from_str::<Value>(text).unwrap_or(fallback),
        Some(other) => other.clone(),
    }
}

/// JS `Number(x) || 0`。
fn number_or_zero(v: Option<&Value>) -> Value {
    let n = match v {
        None | Some(Value::Null) => 0.0,
        Some(Value::Number(num)) => num.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(_) => 0.0,
    };
    // NaN 也要落 0（JS 里 NaN || 0 === 0）
    let n = if n.is_finite() { n } else { 0.0 };
    num_value(n)
}

/// JS 数字 → JSON：整数写成整数（`3.0` → `3`），带小数才写小数 —— 与 JSON.stringify 同形。
fn num_value(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 9.0e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// JS `x || ''`（只用于字符串列）。
fn string_or_empty(v: Option<&Value>) -> Value {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
        Some(Value::Number(num)) if num.as_f64().unwrap_or(0.0) != 0.0 => {
            Value::String(num.to_string())
        }
        _ => Value::String(String::new()),
    }
}

/// `functions/lib/actions/products.js:11` 的 `rowToProduct`。
///
/// 注意字段顺序：`_id, name, spec, price, costPrice, subcategories, enabled, order, image,
/// images, description, specOptions, reviews, stock` —— 与 JS 字面量逐位一致。
pub fn row_to_product(row: &Value) -> Value {
    let get = |k: &str| row.get(k);
    let opts = jparse(get("specOptions"), json!([]));
    let mut out = Map::new();
    // _id / name 原样（现网这两个字段恒在；缺失时 Rust 会写 null 而 JS 会省略键 —— 见 docs/08 的差异面）
    out.insert("_id".into(), get("_id").cloned().unwrap_or(Value::Null));
    out.insert("name".into(), get("name").cloned().unwrap_or(Value::Null));
    out.insert("spec".into(), string_or_empty(get("spec")));
    out.insert("price".into(), number_or_zero(get("price")));
    out.insert("costPrice".into(), number_or_zero(get("costPrice")));
    out.insert(
        "subcategories".into(),
        jparse(get("subcategories"), json!([])),
    );
    // 严格等于：只有数字 1 或布尔 true 算上架（字符串 "1" 不算 —— 这是现网既定行为）
    let enabled = match get("enabled") {
        Some(Value::Bool(true)) => true,
        Some(Value::Number(n)) => n.as_f64() == Some(1.0),
        _ => false,
    };
    out.insert("enabled".into(), Value::Bool(enabled));
    out.insert("order".into(), number_or_zero(get("order")));
    out.insert("image".into(), string_or_empty(get("image")));
    out.insert("images".into(), jparse(get("images"), json!([])));
    out.insert("description".into(), string_or_empty(get("description")));
    out.insert(
        "specOptions".into(),
        if opts.is_array() { opts } else { json!([]) },
    );
    out.insert("reviews".into(), jparse(get("reviews"), json!([])));
    // stock：null / NaN ⇒ -1；否则向零截断
    let stock = match get("stock") {
        None | Some(Value::Null) => json!(-1),
        Some(v) => {
            let n = match v {
                Value::Number(num) => num.as_f64(),
                Value::String(s) => s.trim().parse::<f64>().ok(),
                Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
                _ => None,
            };
            match n {
                Some(x) if x.is_finite() => json!(x.trunc() as i64),
                _ => json!(-1),
            }
        }
    };
    out.insert("stock".into(), stock);
    Value::Object(out)
}

/// `products.js:34` 的 `rowToCategory`。
pub fn row_to_category(row: &Value) -> Value {
    let get = |k: &str| row.get(k);
    let mut out = Map::new();
    out.insert("_id".into(), get("_id").cloned().unwrap_or(Value::Null));
    out.insert("name".into(), get("name").cloned().unwrap_or(Value::Null));
    out.insert("type".into(), string_or_empty(get("type")));
    out.insert("order".into(), number_or_zero(get("order")));
    out.insert(
        "subcategories".into(),
        jparse(get("subcategories"), json!([])),
    );
    Value::Object(out)
}

/// `functions/lib/actions/reviews.js:8` 的 `getReviews` 里那行映射：
/// `rows.map((r) => ({ ...r, images: jparse(r.images, []) }))`。
///
/// 这里**不写死字段清单**，而是照搬 spread 的语义：按行里自己的键序原样拷一遍，
/// 再把 `images` 覆盖成 `jparse` 的结果（serde_json 的 preserve_order 让「覆盖已存在的键」
/// 保持它原来的位置 —— 与 JS 的字面量展开一致）。
/// 写死清单的写法会在「SQL 加了列」时静默漏字段；照搬 spread 则自动跟着走。
pub fn review_row_to_json(row: &Value) -> Value {
    let mut out = Map::new();
    if let Value::Object(obj) = row {
        for (k, v) in obj {
            out.insert(k.clone(), v.clone());
        }
    }
    // 覆盖 images（键已存在 ⇒ 位置不变；不存在则追加，与 JS 的语义相同）
    out.insert("images".into(), jparse(row.get("images"), json!([])));
    Value::Object(out)
}

/// `functions/lib/actions/submissions.js:76` 的 `getSubmissions` 映射：
/// `rows.map((r) => ({ ...r, formData: jparse(r.formData, {}), imageCount: Number(r.imageCount) || 0 }))`。
///
/// 两个细节别抄漏：**formData 的 fallback 是对象 {} 而不是数组**；`imageCount` 是 SQL 里
/// `CASE WHEN json_valid(images) ... AS imageCount` 算出来的字符串/数字，必须 `Number(...) || 0`。
pub fn submission_row_to_json(row: &Value) -> Value {
    let mut out = Map::new();
    if let Value::Object(obj) = row {
        for (k, v) in obj {
            out.insert(k.clone(), v.clone());
        }
    }
    out.insert("formData".into(), jparse(row.get("formData"), json!({})));
    out.insert(
        "imageCount".into(),
        number_or_zero(row.get("imageCount")),
    );
    Value::Object(out)
}
/// `functions/lib/actions/orders.js:438` 的 `getOrderStatus` 成功响应：
/// `{ code: 0, data: { orderId, status: row.status, updatedAt: row.updatedAt } }`。
///
/// 注意这是**对象**而不是数组（与 getPublicProducts 那几个不同）—— 形状差异必须逐字保留，
/// 前端 `data.status` 的读法直接依赖它。
pub fn order_status_data(order_id: &str, row: &Value) -> Value {
    json!({
        "orderId": order_id,
        "status": row.get("status").cloned().unwrap_or(Value::Null),
        "updatedAt": row.get("updatedAt").cloned().unwrap_or(Value::Null),
    })
}

/// `products.js:66` 的 `getCatalogOrders` 循环体：按 `order` 去重、只回两个键。
///
/// `Number.isInteger(n) && n > 0` 的判据必须逐字保留：`3.0` 在 JS 里是整数（接受），
/// `2.5` / `"3"→3`（接受）/ `null`（拒）都要按同一规则走。
pub fn catalog_orders(rows: &[Value]) -> Vec<Value> {
    let mut seen: Vec<i64> = Vec::new();
    let mut data = Vec::new();
    for row in rows {
        let raw = row.get("order");
        let n = match raw {
            None | Some(Value::Null) => continue,
            Some(Value::Number(num)) => num.as_f64(),
            Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
            Some(_) => None,
        };
        let Some(n) = n.filter(|x| x.is_finite()) else {
            continue;
        };
        if n.fract() != 0.0 || n <= 0.0 {
            continue;
        }
        let n = n as i64;
        if seen.contains(&n) {
            continue;
        }
        seen.push(n);
        // needsLocalImage = !String(row.image || '').trim()
        let image = match row.get("image") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(num)) => num.to_string(),
            _ => String::new(),
        };
        data.push(json!({ "order": n, "needsLocalImage": image.trim().is_empty() }));
    }
    data
}
