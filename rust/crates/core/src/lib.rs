//! # supermarket-core —— 契约与纯计算的唯一真相源
//!
//! 这个 crate 只有两类东西，且**只有**这两类：
//!
//! 1. **契约**（[contract] / [errors]）：与现网 `functions/lib/errors.js` 逐字对齐的
//!    成功/失败封套、42 条错误码的 `kind/status/retryable` 登记表。
//!    之所以把 JS 那张表在这里重写一遍，是因为「错误语义」在现网是**机器可读判据**
//!    （前端 `kind` 决定要不要把订单先暂住），不是文案；抄错的代价是丢单，
//!    所以它必须能被 `cargo test` 钉住（见 `tests/parity.rs` 的 E 组用例）。
//!
//! 2. **纯计算**（[cart] / [format] / [csv] / [catalog]）：前端 JS 里被反复调用、
//!    且**没有 DOM/网络副作用**的那几条：购物袋行键与计价、金额格式化、CSV 转义、
//!    商城筛选/排序/搜索建议。
//!    它们同时被两个宿主使用：
//!      - `supermarket-edge`（服务端 SSG/网关，用于校验与快照）；
//!      - `supermarket-wasm`（浏览器侧加速器，替换前端热点）。
//!    同一份实现给两个宿主 ⇒ 「Rust 版和 JS 版算出两个数」这种事故在物理上不可能发生。
//!
//! ## 兼容性红线（写代码时先读这一节）
//!
//! - **不复用浮点求和顺序**：`getTotalAmount` 在 JS 里是 `items.reduce((s,i)=>s+i.price*i.quantity, 0)`，
//!   从左到右依次相加。Rust 侧必须保持**同一个方向与同一批中间值**，否则尾数位会漂移，
//!   前端显示 `¥6.00`、服务端算 `5.999999999999999` 这种事会直接变成「下单被拒」。
//! - **数量上界一律封顶不拒绝**：99 这个数在两个仓各自写了一次，且都被测试钉住
//!   （JS 侧 `tests/limitCapParity.test.ts`）。
//! - **JS 的 `String(number)` 与 Rust 的 `{}` 不是同一个函数**：CSV 里要把数字写成
//!   `"3.5"` 而不是 `"3.5f64"`，也**不能**写成 `"123.0"`（JS 的 `String(123)` 是 `"123"`）。
//!   这一族差异收口在 [csv::js_number_to_string] 一个函数里，别在别处再写一遍。

pub mod api_shapes;
pub mod auth;
pub mod cart;
pub mod catalog;
pub mod contract;
pub mod csv;
pub mod errors;
pub mod order_intake;
pub mod order_state;
pub mod product_writes;
pub mod recalc;
pub mod review_writes;
pub mod submission_writes;
pub mod orders_query;
pub mod sanitize;
pub mod stale;
pub mod stats;
pub mod stock_ops;
pub mod stock_query;
pub mod format;
pub mod jsnum;

/// 与 `functions/lib/shared.js` 同值的起送门槛（元）。
///
/// 前端 `src/data/deliveryLimits.ts` 已有一份、Cloudflare 侧又有一份，
/// 这里是第三份 —— 三份同值由各侧测试钉住。取值出处见 `docs/limit-provenance.md`。
pub const MIN_DELIVERY_AMOUNT: f64 = 6.0;

/// 单行数量硬顶，与 `src/cart.ts` 的 `MAX_QTY_PER_LINE`、
/// `functions/lib/actions/orders.js` 的 `MAX_QUANTITY_PER_LINE` 同值。
pub const MAX_QTY_PER_LINE: u32 = 99;

/// 是否已达起送门槛。
///
/// 口径 = 购物车商品小计（**折前**、不含运费），与前端 `meetsMinDelivery` 一致。
/// 先乘 100 再取整，是为了避开 `0.1+0.2` 这类浮点尾巴把「刚好 6 元」判成不足 ——
/// 这条注释对应的是真实缺陷（前端 2026-10-22 那一轮修的同一个坑）。
pub fn meets_min_delivery(total_amount: f64) -> bool {
    js_round(js_round(total_amount * 100.0)) >= js_round(MIN_DELIVERY_AMOUNT * 100.0)
}

/// 距离起送还差多少钱（已达标返回 0），与前端 `minDeliveryGap` 同口径。
pub fn min_delivery_gap(total_amount: f64) -> f64 {
    let gap = js_round(js_round((MIN_DELIVERY_AMOUNT - total_amount) * 100.0)) / 100.0;
    if gap > 0.0 {
        gap
    } else {
        0.0
    }
}

/// ECMAScript `Math.round` 的等价物：`floor(x + 0.5)`。
///
/// 为什么不用 `f64::round()`：Rust 的 round 是「远离零取整」（-2.5 → -3），
/// JS 的 Math.round 是「平局取 +∞」（-2.5 → -2）。这一处差异恰好落在
/// 「-0.5 元的差额」这类边界上，与其在调用点各写一次特判，不如收口成一个函数。
#[inline]
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    (x + 0.5).floor()
}
