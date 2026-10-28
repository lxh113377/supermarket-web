//! 商品域写动作的纯计算层：现网 functions/lib/actions/products.js 的字段归一与校验。
//!
//! 三个动作（createProduct / updateProduct / deleteProduct）共用同一份字段白名单（现网 shared.js:9 的 PRODUCT_FIELDS）
//! 与同一套归一规则。抽出来的理由与前面几批一样：抄错不报错，只会让「后台写的值」与「顾客看到/对账的值」不是同一个。

use serde_json::{json, Value};

/// 现网 shared.js:9 的 PRODUCT_FIELDS（出现序即 INSERT 列序，不能重排）。
pub const PRODUCT_FIELDS: [&str; 13] = [
    "name",
    "spec",
    "price",
    "costPrice",
    "subcategories",
    "enabled",
    "order",
    "image",
    "images",
    "description",
    "reviews",
    "stock",
    "specOptions",
];

/// 商品图册上限（现网 products.js:100）。
pub const MAX_PRODUCT_IMAGES: usize = 9;
/// 口味项上限（现网 products.js:132 的 SPEC_OPTION_LIMIT）。
pub const SPEC_OPTION_LIMIT: usize = 20;

/// 现网 db.js:37 的 pick：只保留「在白名单里且入参真的带了」的键，顺序按白名单。
pub fn pick_product_fields(payload: Option<&Value>) -> Vec<(String, Value)> {
    let mut out: Vec<(String, Value)> = Vec::new();
    let Some(obj) = payload.and_then(|p| p.as_object()) else {
        return out;
    };
    for k in PRODUCT_FIELDS {
        if let Some(v) = obj.get(k) {
            out.push((k.to_string(), v.clone()));
        }
    }
    out
}
/// 现网 products.js:122 的 sanitizeStock：Math.trunc(Number(x))，非有限或小于 0 则 -1。
pub fn sanitize_stock(v: Option<&Value>) -> Value {
    let n = match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
        Some(Value::Bool(b)) => if *b { 1.0 } else { 0.0 },
        _ => f64::NAN,
    };
    if !n.is_finite() {
        return json!(-1);
    }
    let t = n.trunc();
    if t >= 0.0 {
        json!(t as i64)
    } else {
        json!(-1)
    }
}

/// 现网 products.js:133 的 sanitizeSpecOptions：只留 label 与 enabled 两个键，label 去空白、截 20 字、同名去重、上限 20 项。
pub fn sanitize_spec_options(v: Option<&Value>) -> Value {
    let raw = match v {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<Value> = Vec::new();
    for item in raw {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let label: String = obj
            .get("label")
            .map(|x| match x {
                Value::String(s) => s.clone(),
                Value::Number(n) => crate::jsnum::js_number_string(n.as_f64().unwrap_or(0.0)),
                Value::Bool(b) => {
                    if *b {
                        "true".to_string()
                    } else {
                        String::new()
                    }
                }
                _ => String::new(),
            })
            .unwrap_or_default()
            .trim()
            .chars()
            .take(20)
            .collect();
        if label.is_empty() || seen.contains(&label) {
            continue;
        }
        seen.push(label.clone());
        // enabled 的判定是「不等于 false」：缺省、0、null 都算启用
        let enabled = obj.get("enabled").and_then(|x| x.as_bool()) != Some(false);
        out.push(json!({ "label": label, "enabled": enabled }));
        if out.len() >= SPEC_OPTION_LIMIT {
            break;
        }
    }
    Value::Array(out)
}
/// 现网 products.js:100-105 的图册校验：超过 9 张则 too_many_images；任一项非字符串或不安全则 invalid_image。
///
/// 返回 None 表示图册无效（调用方按 invalid_image 回），Some(list) 表示通过（原样返回）。
pub fn validate_images(v: &Value) -> Option<Vec<Value>> {
    let Value::Array(list) = v else {
        return None;
    };
    if list.len() > MAX_PRODUCT_IMAGES {
        return None;
    }
    for it in list {
        match it {
            Value::String(s) if crate::order_intake::is_safe_image_url(s) => {}
            _ => return None,
        }
    }
    Some(list.clone())
}

/// 现网 products.js:94 的 enabled 归一：只要不是显式的 false 就算启用（缺省 / 0 / null 都启用）。
pub fn enabled_flag(v: Option<&Value>) -> bool {
    v.and_then(|x| x.as_bool()) != Some(false)
}

/// INSERT / UPDATE 的值序列化（现网 db.js:61-67）：数组与对象走 JSON 字符串，其余原样绑定。
/// 现网 db.js:55 的 insertSql：列名逐个加双引号、逗号加空格连接（列序即键序）。
pub fn insert_sql(table: &str, cols: &[String]) -> String {
    let quoted: Vec<String> = cols.iter().map(|c| format!("\"{c}\"")).collect();
    let placeholders = vec!["?"; cols.len()].join(", ");
    format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        quoted.join(", "),
        placeholders
    )
}

/// 现网 products.js:179 的 SET 子句：列名加双引号，逐个等号加问号。
pub fn update_set_sql(cols: &[String]) -> String {
    cols.iter()
        .map(|c| format!("\"{c}\" = ?"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn bind_value(v: &Value) -> Value {
    match v {
        Value::Array(_) | Value::Object(_) => json!(v.to_string()),
        other => other.clone(),
    }
}


