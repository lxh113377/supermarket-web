//! 购物袋：行键、加减、封顶、计价。
//!
//! 与 `src/cart.ts` 一一对应。三条必须逐字保留的口径：
//!
//! 1. **行键 = `productId + spec`**：同商品不同口味是两行。第三十六轮之前只按
//!    productId 合并，顾客先加「黄瓜味」再加「烤虾味」会并成一行、第二次的选择直接丢，
//!    而下单侧本来就支持同商品多行 —— 缺陷 100% 在这一层键控上。
//! 2. **数量封顶 99、不拒绝**：购物袋是本地状态，把点击静默丢掉比封顶更难解释；
//!    真正的拒绝在服务端（`quantity_exceeds_limit`）。
//! 3. **求和不换方向**：`getTotalAmount` 在 JS 里是 `items.reduce((s,i)=>s+i.price*i.quantity, 0)`，
//!    从左到右。Rust 侧同样从左到右，中间值类型同为 f64（JS Number 即 f64）。

use crate::MAX_QTY_PER_LINE;
use serde::{Deserialize, Serialize};

/// 订单行 / 购物袋行（与前端 `OrderItem` 同形，字段名即 JSON 键名）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CartItem {
    // 每个字段都带 `default`：现网 `parseCart` 做的是 TS 断言（`as Cart`），
    // 缺字段不报错、只有 items 不是数组才降级为空袋。若这里用 serde 的严格模式，
    // 一条缺少 price 的历史行会让**整袋**清空 —— 那是行为变更，不是健壮性提升。
    #[serde(rename = "productId", default)]
    pub product_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<String>,
    #[serde(default)]
    pub price: f64,
    #[serde(default)]
    pub quantity: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcategories: Option<Vec<String>>,
}

/// 购物袋（`{ items: [...] }`）。`_id` 之类的额外字段由 serde 忽略——
/// 前端 `parseCart` 也只看 `items` 是不是数组，行为一致。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Cart {
    pub items: Vec<CartItem>,
}

/// 加入购物袋时要用到的最小商品面（前端传的是整条 Product，这里只取要用的字段）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CartProduct {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<String>,
    pub price: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subcategories: Option<Vec<String>>,
}

/// 行键判定：`spec` 为 `None` 时表示「该商品的全部口味」（旧语义），
/// 传了就只匹配那一行。对应 JS 的 `sameLine`。
fn same_line(item: &CartItem, product_id: &str, spec: Option<&str>) -> bool {
    if item.product_id != product_id {
        return false;
    }
    match spec {
        None => true,
        Some(s) => item.spec.as_deref().unwrap_or("") == s,
    }
}

/// 解析购物袋字符串；损坏/畸形一律降级为空袋（对应 JS `parseCart` 的 try/catch）。
///
/// 为什么必须降级而不是报错：这段数据在 localStorage 里，可能是上个版本写的、
/// 也可能是用户手改的；让它在渲染路径上抛异常等于整页白屏。
pub fn parse_cart(raw: Option<&str>) -> Cart {
    let Some(raw) = raw else {
        return Cart::default();
    };
    serde_json::from_str::<Cart>(raw).unwrap_or_default()
}

/// 袋内某商品的总件数（跨口味聚合）—— 商品卡角标要的是「这个商品我拿了几件」。
pub fn item_quantity(cart: &Cart, product_id: &str) -> u32 {
    cart.items
        .iter()
        .filter(|i| i.product_id == product_id)
        .map(|i| i.quantity)
        .sum()
}

/// 加入购物袋（可一次加多件）。
///
/// `qty` 的归一化与 JS 一致：`Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1`。
/// 注意 `qty=1.9` 会变成 1（floor），`Infinity/NaN/0/负数` 都变成 1 —— 这些是
/// 详情页数量步进器的真实输入面，别「顺手优化」成 clamp。
pub fn add_to_cart(cart: &Cart, product: &CartProduct, qty: f64) -> Cart {
    let n = if qty.is_finite() && qty >= 1.0 {
        qty.floor()
    } else {
        1.0
    };
    let spec = product.spec.clone().unwrap_or_default();
    let hit = |item: &CartItem| item.product_id == product.id && item.spec.clone().unwrap_or_default() == spec;

    let mut items: Vec<CartItem> = cart.items.clone();
    if cart.items.iter().any(hit) {
        for item in items.iter_mut() {
            if hit(item) {
                item.quantity = (item.quantity as f64 + n).min(MAX_QTY_PER_LINE as f64) as u32;
            }
        }
    } else {
        items.push(CartItem {
            product_id: product.id.clone(),
            name: product.name.clone(),
            spec: product.spec.clone(),
            price: product.price,
            quantity: (n.min(MAX_QTY_PER_LINE as f64)) as u32,
            subcategories: product.subcategories.clone(),
        });
    }
    Cart { items }
}

/// 减一件：传 `spec` 只减那行，不传则**该商品每行各减一件**（保留旧的整品递减语义）。
pub fn remove_from_cart(cart: &Cart, product_id: &str, spec: Option<&str>) -> Cart {
    let items = cart
        .items
        .iter()
        .map(|item| {
            if same_line(item, product_id, spec) {
                let mut next = item.clone();
                next.quantity = next.quantity.saturating_sub(1);
                next
            } else {
                item.clone()
            }
        })
        .filter(|item| item.quantity > 0)
        .collect();
    Cart { items }
}

/// 删除：传 `spec` 只删那行，不传则删该商品全部口味。
pub fn delete_from_cart(cart: &Cart, product_id: &str, spec: Option<&str>) -> Cart {
    Cart {
        items: cart
            .items
            .iter()
            .filter(|item| !same_line(item, product_id, spec))
            .cloned()
            .collect(),
    }
}

/// 商品小计（折前、不含运费）。
///
/// **不要在 WASM 侧改成 Kahan/分块求和**：前端任何一处显示、服务端任何一次校验
/// 都读这个数，换算法等于换数值；要加速的是「不再让 JS 逐行循环」，
/// 而不是「换一个更准的浮点求和」——后者是行为变更，不是性能优化。
pub fn total_amount(cart: &Cart) -> f64 {
    let mut sum = 0.0f64;
    for item in &cart.items {
        sum += item.price * item.quantity as f64;
    }
    sum
}

/// 总件数。
pub fn total_count(cart: &Cart) -> u32 {
    cart.items.iter().map(|i| i.quantity).sum()
}
