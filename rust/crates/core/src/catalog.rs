//! 商城筛选/排序/搜索建议 —— 与 `src/pages/CustomerPage.tsx` 的 `filteredProducts`
//! 与 `suggestions` 两个 `useMemo` 一一对应。
//!
//! 现状：这两个 `useMemo` 在每次按键（`useDeferredValue` 之后）与每次分类切换时，
//! 在 JS 侧对整份商品表做「子分类判定 + 两次 toLowerCase + includes」。
//! 商品表目前 65 件，但这个数字是会长大的（现网商品面每轮都在加），
//! 且 `toLowerCase` 与字符串分配是 JS 侧最贵的部分 —— 搬到 WASM 后是
//! 「一次线性扫描 + 预拼的搜索文本」，这条路径的收益随商品数增长（见 docs/05 的对照表）。

use serde::{Deserialize, Serialize};

/// 与前端 `SpecOption` 同形。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpecOption {
    pub label: String,
    #[serde(default)]
    pub enabled: Option<bool>,
}

/// 与前端 `Product` 的**参与筛选的字段**同形（其余字段不参与，故不声明）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Product {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub spec: Option<String>,
    #[serde(default)]
    pub price: f64,
    #[serde(default)]
    pub subcategories: Option<Vec<String>>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub order: Option<f64>,
    #[serde(default)]
    pub spec_options: Option<Vec<SpecOption>>,
}

/// 排序键，取值与 `src/hooks/useShopFilters.ts` 的 `SORT_OPTIONS` 一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortKey {
    Default,
    PriceAsc,
    PriceDesc,
}

impl SortKey {
    /// 非法值一律归零到 Default（URL 可被手输，不给未定义行为留口子）。
    pub fn parse(raw: &str) -> SortKey {
        match raw {
            "price-asc" => SortKey::PriceAsc,
            "price-desc" => SortKey::PriceDesc,
            _ => SortKey::Default,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SortKey::Default => "default",
            SortKey::PriceAsc => "price-asc",
            SortKey::PriceDesc => "price-desc",
        }
    }
}

/// 后台没关掉、且名字非空的口味；同名只取第一条（后台手滑重复不会渲染出两个按钮）。
pub fn enabled_spec_options(product: &Product) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    let Some(options) = &product.spec_options else {
        return out;
    };
    for option in options {
        let label = option.label.trim();
        if label.is_empty() || option.enabled == Some(false) || seen.iter().any(|s| s == label) {
            continue;
        }
        seen.push(label.to_string());
        out.push(label.to_string());
    }
    out
}

/// 搜索用文本 = 静态规格 + 顾客可见的口味名（后台关掉的口味不参与匹配 ——
/// 搜出一个点不到的结果，比搜不到更糟）。与 JS `specSearchText` 同口径。
pub fn spec_search_text(product: &Product) -> String {
    let mut parts: Vec<String> = Vec::new();
    let base = product.spec.as_deref().unwrap_or("").trim();
    if !base.is_empty() {
        parts.push(base.to_string());
    }
    for label in enabled_spec_options(product) {
        parts.push(label);
    }
    parts.join(" ")
}

/// 筛选 + 排序。
///
/// 口径逐条对齐 CustomerPage：
///   - 选了子分类：`p.subcategories.includes(subId)`；
///   - 「全部」：`p.subcategories.some(sub => topSubIds.has(sub))`；
///   - 关键字：`name.toLowerCase().includes(q) || specSearchText(p).toLowerCase().includes(q)`，
///     注意是 **两个字段各自 lowercase 后各自 includes**，不是先拼接再匹配；
///   - 排序：价格升降序，**稳定排序**（JS `Array.prototype.sort` 自 ES2019 起保证稳定，
///     等值商品的相对顺序 = 上游数据顺序，改成不稳定排序会让「点两次排序看到两种顺序」）。
pub fn filter_products(
    products: &[Product],
    top_sub_ids: &[String],
    sub_id: Option<&str>,
    query: Option<&str>,
    sort: SortKey,
) -> Vec<Product> {
    filter_indices(products, top_sub_ids, sub_id, query, sort)
        .into_iter()
        .map(|i| products[i].clone())
        .collect()
}

/// 与 filter_products 共用同一份判定，返回**原数组下标**。
///
/// 为什么需要它：WASM 侧只回下标，让 JS 用下标去取原对象 —— 商品对象有几十个字段且两端
/// 都在加字段，让加速器「重整一遍对象」等于把筛选升级成字段搬迁（新增字段会被静默丢掉）。
/// 两个函数共用 [keep] 这一个谓词，所以「下标版」与「对象版」不可能给出不同结果。
pub fn filter_indices(
    products: &[Product],
    top_sub_ids: &[String],
    sub_id: Option<&str>,
    query: Option<&str>,
    sort: SortKey,
) -> Vec<usize> {
    let needle = query.map(|q| q.to_lowercase()).filter(|q| !q.is_empty());
    let mut idx: Vec<usize> = (0..products.len())
        .filter(|&i| keep(&products[i], top_sub_ids, sub_id, needle.as_deref()))
        .collect();

    // 稳定排序：JS 的 Array.prototype.sort 自 ES2019 起保证稳定，
    // 等值商品的相对顺序 = 上游数据顺序；换成不稳定排序会让「点两次排序看到两种顺序」。
    match sort {
        SortKey::Default => {}
        SortKey::PriceAsc => idx.sort_by(|&a, &b| cmp_price(products[a].price, products[b].price)),
        SortKey::PriceDesc => idx.sort_by(|&a, &b| cmp_price(products[b].price, products[a].price)),
    }
    idx
}

/// 单件商品是否命中：子分类 + 关键字两条判定。
///
/// 关键字口径（逐字对齐 CustomerPage）：name.toLowerCase().includes(q) 或
/// specSearchText(p).toLowerCase().includes(q) —— 是**两个字段各自小写后各自匹配**，
/// 不是先拼接再匹配（拼接会让「跨字段的偶然相邻」也命中，属行为变更）。
fn keep(product: &Product, top_sub_ids: &[String], sub_id: Option<&str>, needle: Option<&str>) -> bool {
    let by_sub = match sub_id.filter(|s| !s.is_empty()) {
        Some(sub) => product
            .subcategories
            .as_ref()
            .map(|subs| subs.iter().any(|s| s == sub))
            .unwrap_or(false),
        None => product
            .subcategories
            .as_ref()
            .map(|subs| subs.iter().any(|s| top_sub_ids.iter().any(|t| t == s)))
            .unwrap_or(false),
    };
    if !by_sub {
        return false;
    }
    match needle {
        None => true,
        Some(needle) => {
            product.name.to_lowercase().contains(needle)
                || spec_search_text(product).to_lowercase().contains(needle)
        }
    }
}

/// 价格比较：与 JS `a.price - b.price` 同语义（NaN 在 JS 里会得到未定义顺序，
/// 这里显式判成 Equal，让稳定排序决定 —— 商品价格永远有限，这条只是防呆）。
fn cmp_price(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// 预计算索引项：把「每件商品每次查询都要做的小写转换与搜索文本拼接」提前到**加载时**做一次。
///
/// 为什么这才是 WASM 的正确形状：JS 侧每次按键都要对整份商品表重新 `toLowerCase()`
/// 与拼 `specSearchText`（V8 再快也得为每个商品各分配一次小写串）；常驻索引可以在
/// 加载时把这些中间量算好，之后每次查询只剩「对预计算串做 contains」——
/// 于是加速器卖的不是「Rust 跑得快」，而是**把重复计算挪到加载时**。
#[derive(Debug, Clone)]
pub struct Prepared {
    pub price: f64,
    /// 预计算的小写商品名。
    pub name_lower: String,
    /// 预计算的小写搜索文本（规格 + 可见口味）。
    pub search_lower: String,
    pub subcategories: Vec<String>,
}

/// 构建预计算索引（只在目录加载/变更时调用一次）。
pub fn prepare(products: &[Product]) -> Vec<Prepared> {
    products
        .iter()
        .map(|p| Prepared {
            price: p.price,
            name_lower: p.name.to_lowercase(),
            search_lower: spec_search_text(p).to_lowercase(),
            subcategories: p.subcategories.clone().unwrap_or_default(),
        })
        .collect()
}

/// 在预计算索引上做与 [filter_indices] **完全同值**的筛选（同值由本文件的单测钉住）。
pub fn query_prepared(
    prepared: &[Prepared],
    top_sub_ids: &[String],
    sub_id: Option<&str>,
    query: Option<&str>,
    sort: SortKey,
) -> Vec<usize> {
    let needle = query.map(|q| q.to_lowercase()).filter(|q| !q.is_empty());
    let mut idx: Vec<usize> = (0..prepared.len())
        .filter(|&i| {
            let p = &prepared[i];
            let by_sub = match sub_id.filter(|s| !s.is_empty()) {
                Some(sub) => p.subcategories.iter().any(|s| s == sub),
                None => p
                    .subcategories
                    .iter()
                    .any(|s| top_sub_ids.iter().any(|t| t == s)),
            };
            if !by_sub {
                return false;
            }
            match &needle {
                None => true,
                Some(needle) => {
                    p.name_lower.contains(needle.as_str()) || p.search_lower.contains(needle.as_str())
                }
            }
        })
        .collect();
    match sort {
        SortKey::Default => {}
        SortKey::PriceAsc => idx.sort_by(|&a, &b| cmp_price(prepared[a].price, prepared[b].price)),
        SortKey::PriceDesc => idx.sort_by(|&a, &b| cmp_price(prepared[b].price, prepared[a].price)),
    }
    idx
}

/// 搜索建议：只按名字/口味匹配、取前 `limit` 条（JS 侧 `.slice(0, 5)`）。
pub fn suggestions(products: &[Product], draft_query: &str, limit: usize) -> Vec<Product> {
    suggestions_indices(products, draft_query, limit)
        .into_iter()
        .map(|i| products[i].clone())
        .collect()
}

/// 搜索建议的下标版（同一份匹配口径，理由同 filter_indices）。
pub fn suggestions_indices(products: &[Product], draft_query: &str, limit: usize) -> Vec<usize> {
    if draft_query.is_empty() {
        return Vec::new();
    }
    let needle = draft_query.to_lowercase();
    (0..products.len())
        .filter(|&i| {
            let p = &products[i];
            p.name.to_lowercase().contains(needle.as_str())
                || spec_search_text(p).to_lowercase().contains(needle.as_str())
        })
        .take(limit)
        .collect()
}
