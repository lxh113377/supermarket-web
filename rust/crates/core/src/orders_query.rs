//! 订单分页查询的构造（纯函数）：现网 `functions/lib/actions/orders.js:524` 的 `getOrders` 同义实现。
//!
//! ## 这个动作要小心的是「三个派生值必须同源」
//!
//! 现网有三处从 `since` 派生：
//!   · `whereClause`：`since ? 'WHERE o.updatedAt > ?' : ''
//!   · `orderByCol`：`since ? 'o.updatedAt' : 'o.createdAt'
//!   · 排序方向：`since ? 'ASC' : 'DESC'
//! 以及参数数组的前缀：`since ? [since, ...] : [...]`。
//!
//! 这四处**必须由同一个 since 判定派生**：手工写四遍时，最典型的错是「WHERE 用了 since 但 ORDER BY 没用」——
//! 游标会按 createdAt 推进而不是 updatedAt，增量轮询就永远追不上状态变更（而列表看起来「有数据」）。
//! 所以这里一次构造 `OrdersQuery`，四处都从它取。
//!
//! ## 与 JS 的逐条对齐
//!
//! · `page`：`Math.max(1, Number(payload.page) || 1)` —— 注意 `|| 1` 在 max **之内**：0/NaN/"abc" 都落 1；
//! · `pageSize`：`Math.min(100, Math.max(1, Number(payload.pageSize) || 50))` —— 同上，0/NaN 落 50，>100 落 100；
//! · `since`：`typeof payload.since === 'string' && payload.since` —— **非字符串一律判 null**（数字/布尔不采纳）；
//! · 参数：`since ? [since, pageSize + 1, (page - 1) * pageSize] : [pageSize + 1, (page - 1) * pageSize]`；
//!   LIMIT 取 `pageSize + 1`（多取一条只为判 `hasMore`），OFFSET 取 `(page - 1) * pageSize`；
//! · `hasMore = rows.length > pageSize`；`data = hasMore ? rows.slice(0, pageSize) : rows`；
//! · 每行映射：`{ ...r, items: jparse(r.items, []) }`（**只覆盖 items**，其余字段原样，键序保留）。

use serde_json::{json, Map, Value};

pub const ORDER_PAGE_MAX: i64 = 100;
pub const ORDER_PAGE_SIZE_DEFAULT: i64 = 50;

/// 一次构造出的订单分页参数（四处派生值都在这里，避免手写多遍时不同源）。
#[derive(Debug, Clone, PartialEq)]
pub struct OrdersQuery {
    /// `since ? "WHERE o.updatedAt > ?" : ""`
    pub where_clause: &'static str,
    /// `since ? "o.updatedAt" : "o.createdAt"`
    pub order_by_col: &'static str,
    /// `since ? "ASC" : "DESC"`
    pub dir: &'static str,
    /// SQL 绑定的前缀（since 模式下比非 since 多一个 since 值）。
    pub params_prefix: Vec<Value>,
    /// `pageSize + 1`（多取一条判 hasMore）
    pub fetch: i64,
    /// `(page - 1) * pageSize`
    pub offset: i64,
    pub page: i64,
    pub page_size: i64,
    /// 清洗后仍要回显给响应/游标的 since（None = 非增量模式）
    pub since: Option<String>,
}

/// JS `Number(x) || fallback`（NaN/0/取不出数都落 fallback）。
fn number_or(v: Option<&Value>, fallback: f64) -> f64 {
    let n = match v {
        None | Some(Value::Null) => 0.0,
        Some(Value::Number(x)) => x.as_f64().unwrap_or(0.0),
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
    if n.is_finite() && n != 0.0 {
        n.trunc()
    } else {
        fallback
    }
}

/// 现网 `getOrders` 的前半段（分页归一 + 四处派生）。
pub fn orders_query(payload: Option<&Value>) -> OrdersQuery {
    let get = |k: &str| payload.and_then(|p| p.get(k));
    let page = (number_or(get("page"), 1.0) as i64).max(1);
    let page_size = (number_or(get("pageSize"), ORDER_PAGE_SIZE_DEFAULT as f64) as i64)
        .clamp(1, ORDER_PAGE_MAX);
    // since：必须是**非空字符串**才采纳（数字/布尔/空串一律回落分页模式）
    let since = match get("since") {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    };
    let mut params_prefix: Vec<Value> = Vec::new();
    if let Some(s) = &since {
        params_prefix.push(json!(s));
    }
    OrdersQuery {
        where_clause: if since.is_some() {
            "WHERE o.updatedAt > ?"
        } else {
            ""
        },
        order_by_col: if since.is_some() {
            "o.updatedAt"
        } else {
            "o.createdAt"
        },
        dir: if since.is_some() { "ASC" } else { "DESC" },
        params_prefix,
        fetch: page_size + 1,
        offset: (page - 1) * page_size,
        page,
        page_size,
        since,
    }
}

/// `hasMore` 与 `data` 的裁切（现网 `rows.length > pageSize` + `slice(0, pageSize)`）。
///
/// 注意 `hasMore` 为假时**整份 rows 都要返回**（不做 slice）—— 两分支的结果在这点上不同，
/// 且 LIMIT 已是 pageSize+1，所以「多出来的那一条」永远不会漏进 data。
pub fn visible_rows(rows: Vec<Value>, page_size: i64) -> (Vec<Value>, bool) {
    let has_more = rows.len() as i64 > page_size;
    let data = if has_more {
        rows.into_iter().take(page_size as usize).collect()
    } else {
        rows
    };
    (data, has_more)
}

/// 现网 `getOrders` 的行映射：`{ ...r, items: jparse(r.items, []) }`（只覆盖 items）。
pub fn order_row_to_json(row: &Value) -> Value {
    let mut out = Map::new();
    if let Value::Object(obj) = row {
        for (k, v) in obj {
            out.insert(k.clone(), v.clone());
        }
    }
    out.insert("items".into(), crate::api_shapes::jparse(row.get("items"), json!([])));
    Value::Object(out)
}

/// 现网 `getOrderById` 的行映射：`{ ...row, items: jparse(...), paymentScreenshot: row.paymentScreenshot || '' }`。
///
/// `|| ''` 是 falsy 判定：null/空串/0 都落空串；注意它**在键序里保持在原位**（若行里本来有该列）。
pub fn order_detail_row_to_json(row: &Value) -> Value {
    let mut out = Map::new();
    if let Value::Object(obj) = row {
        for (k, v) in obj {
            out.insert(k.clone(), v.clone());
        }
    }
    out.insert("items".into(), crate::api_shapes::jparse(row.get("items"), json!([])));
    let shot = match row.get("paymentScreenshot") {
        Some(Value::String(s)) if !s.is_empty() => Value::String(s.clone()),
        Some(Value::Number(n)) if n.as_f64().unwrap_or(0.0) != 0.0 => Value::String(n.to_string()),
        _ => Value::String(String::new()),
    };
    out.insert("paymentScreenshot".into(), shot);
    Value::Object(out)
}
