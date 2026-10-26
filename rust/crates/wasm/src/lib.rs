//! # supermarket-wasm —— 浏览器侧加速器（C ABI + 紧凑二进制协议）
//!
//! ## 为什么不用 wasm-bindgen，也不用 JSON
//!
//! 两个决定都被**实测数字**逼出来，不是口味偏好：
//!
//! | 方案 | 产物 raw / brotli | 额外代价 |
//! |---|---|---|
//! | 裸导出 + JSON 协议（serde_json） | 173 KB / 57 KB | 还要在主线程 `JSON.stringify` |
//! | 裸导出 + 紧凑二进制（本实现） | 69 KB / 23 KB | 无序列化库 |
//! | 上面再走 wasm-opt `-Oz` | **59 KB / 22 KB** | — |
//!
//! JSON 协议看着好对账，但它把 `JSON.stringify` 的 CPU 成本留在了 JS 主线程 ——
//! 那正是这次优化的对象。二进制协议把编码成本压成「写 DataView」。
//!
//! ## 协议（小端；ABI 版本 = 2）
//!
//! 调用惯例（胶水见 `rust/web/wasm-loader.js`）：
//! ```text
//!   ptr = sm_alloc(n); 写入输入 → rc = sm_<op>(ptr, n) → sm_free(ptr, n)
//!   rc >= 0 ⇒ 结果在 sm_result_ptr()/sm_result_len()，rc 即结果字节数
//!   rc <  0 ⇒ 失败（SM_ERR_*），胶水据此回落 JS 实现，绝不猜
//! ```
//!
//! 算子的输入布局见各自文档注释；共有 `str := u32 len + len 字节 UTF-8`。
//!
//! ## 三种形态，为什么要分
//!
//! * `sm_cart_summary` —— **纯数字进、纯数字出**，跨边界成本最小，是 wasm 的天然形状；
//! * `sm_filter_indices` —— 一次性筛选（无状态），每调用一次都要重传整张商品表；
//! * `sm_catalog_load` + `sm_catalog_query` —— **常驻索引**形态：
//!   商品表只传一次，之后每次按键只传查询条件（几字节到几十字节）。
//!
//! 实测（docs/05 §4）：一次性形态在 65 件商品上**比 JS 慢**（编码商品表的开销 > 筛选收益），
//! 而常驻形态把每次按键的成本压到「只编码查询串」后才有净收益。这条结论直接决定了
//! 前端接入写法：**先加载索引，再按按键查询**，而不是每次调用都传整张表。

use supermarket_core::{cart, catalog, csv};
use std::cell::RefCell;

/// 线性内存协议版本。任何「入参/出参布局」改动都必须 +1（胶水在不匹配时拒绝加载）。
pub const SM_ABI_VERSION: i32 = 2;

/// 协议错误码：胶水据此回落 JS 实现，不做任何「猜」。
pub const SM_ERR_TRUNCATED: i32 = -1; // 输入长度不够整段读
pub const SM_ERR_BAD_UTF8: i32 = -2; // 某段字符串不是合法 UTF-8
pub const SM_ERR_SHAPE: i32 = -3; // 形状不对（数量与长度自相矛盾、未加载就查询等）
pub const SM_ERR_TOO_LARGE: i32 = -4; // 超过能力上限（防一条坏输入吃光内存）

/// 单次输入上限 24 MiB：不是性能取舍，是**防线** ——
/// 被写坏的 len 会让 wasm 读越界或分配巨量内存（panic=abort 下等于整模块不可用）。
const MAX_INPUT: usize = 24 * 1024 * 1024;

thread_local! {
    /// 结果缓冲区：Rust 侧持有、JS 只读（wasm 单线程，RefCell 足够）。
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };

    /// **常驻**目录索引：一次加载，之后每次查询只传关键字与筛选条件。
    ///
    /// 存的是 (`products`, `prepared`) 两份：前者保留原样（调试/对账用），
    /// 后者是加载时就算好的小写名 + 小写搜索文本 —— 每次按键省掉的是
    /// 「整表 toLowerCase + 拼搜文」这堆 JS 侧每轮都要重做的活。
    static CATALOG: RefCell<Option<(Vec<catalog::Product>, Vec<catalog::Prepared>)>> =
        const { RefCell::new(None) };
}

fn put_result(bytes: Vec<u8>) -> i32 {
    let len = bytes.len() as i32;
    RESULT.with(|cell| {
        *cell.borrow_mut() = bytes;
    });
    len
}

// ─────────────────────────────────────────────────────────────────────────────
// 内存与协议入口
// ─────────────────────────────────────────────────────────────────────────────

/// 申请输入区：长度**精确**（不用 `Vec::with_capacity` —— 它按增长策略多要内存，
/// 之后按 (ptr,len) 归还就与真实布局不符）。
#[no_mangle]
pub extern "C" fn sm_alloc(len: usize) -> *mut u8 {
    let mut boxed = vec![0u8; len].into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    ptr
}

/// 归还输入区。
#[no_mangle]
pub extern "C" fn sm_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

/// ABI 版本。
#[no_mangle]
pub extern "C" fn sm_abi_version() -> i32 {
    SM_ABI_VERSION
}

/// 结果区指针。
#[no_mangle]
pub extern "C" fn sm_result_ptr() -> *const u8 {
    RESULT.with(|cell| cell.borrow().as_ptr())
}

/// 结果区长度。
#[no_mangle]
pub extern "C" fn sm_result_len() -> i32 {
    RESULT.with(|cell| cell.borrow().len() as i32)
}

// ─────────────────────────────────────────────────────────────────────────────
// 极简读写器（不依赖任何序列化库）
// ─────────────────────────────────────────────────────────────────────────────

/// 顺序读取器：每一步都做边界检查，越界立即返回错误码而不是 panic
/// （wasm 里 panic=abort 会让整个模块不可恢复，一个坏输入不该有这个后果）。
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], i32> {
        if self.pos + n > self.buf.len() {
            return Err(SM_ERR_TRUNCATED);
        }
        let out = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, i32> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, i32> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f64(&mut self) -> Result<f64, i32> {
        let b = self.take(8)?;
        Ok(f64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]))
    }

    /// 长度受限的计数：防止「声称有 40 亿个元素」把后续分配变成攻击面。
    fn count(&mut self, unit: usize) -> Result<usize, i32> {
        let n = self.u32()? as usize;
        if unit > 0 && n.saturating_mul(unit) > MAX_INPUT {
            return Err(SM_ERR_TOO_LARGE);
        }
        Ok(n)
    }

    /// 借用式读字符串：切片直接指向输入缓冲，不复制（CSV 导出依赖这一点）。
    fn str_slice(&mut self) -> Result<&'a str, i32> {
        let len = self.count(1)?;
        let bytes = self.take(len)?;
        std::str::from_utf8(bytes).map_err(|_| SM_ERR_BAD_UTF8)
    }

    fn string(&mut self) -> Result<String, i32> {
        Ok(self.str_slice()?.to_string())
    }

    fn at_end(&self) -> bool {
        self.pos == self.buf.len()
    }
}

/// 顺序写入器。
struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    fn with_capacity(n: usize) -> Self {
        Writer { buf: Vec::with_capacity(n) }
    }
    fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn f64(&mut self, v: f64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
}

unsafe fn input_slice<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], i32> {
    if ptr.is_null() {
        return Err(SM_ERR_SHAPE);
    }
    if len > MAX_INPUT {
        return Err(SM_ERR_TOO_LARGE);
    }
    if len == 0 {
        return Ok(&[]);
    }
    Ok(std::slice::from_raw_parts(ptr, len))
}

// ─────────────────────────────────────────────────────────────────────────────
// 共享编解码件
// ─────────────────────────────────────────────────────────────────────────────

/// 读商品表（`u32 n` + n × 商品）。
///
/// 商品段布局（与前端 `Product` 里**参与筛选的字段**对应，其余字段不参与故不传输）：
/// ```text
///   f64 price
///   u32 nSubs, nSubs × str
///   str name
///   str spec
///   u32 nOptions, nOptions × (str label, u8 enabled)
/// ```
fn read_products(r: &mut Reader<'_>) -> Result<Vec<catalog::Product>, i32> {
    let n_products = r.count(48)?;
    let mut products: Vec<catalog::Product> = Vec::with_capacity(n_products);
    for index in 0..n_products {
        let price = r.f64()?;
        let n_subs = r.count(4)?;
        let mut subs: Vec<String> = Vec::with_capacity(n_subs);
        for _ in 0..n_subs {
            subs.push(r.string()?);
        }
        let name = r.string()?;
        let spec = r.string()?;
        let n_options = r.count(5)?;
        let mut options: Vec<catalog::SpecOption> = Vec::with_capacity(n_options);
        for _ in 0..n_options {
            let label = r.string()?;
            let enabled = Some(r.u8()? != 0);
            options.push(catalog::SpecOption { label, enabled });
        }
        products.push(catalog::Product {
            // id 只用于调试；**下标就是身份**（回下标协议的整个要点）。
            id: index.to_string(),
            name,
            spec: if spec.is_empty() { None } else { Some(spec) },
            price,
            subcategories: Some(subs),
            enabled: Some(true),
            order: None,
            spec_options: Some(options),
        });
    }
    Ok(products)
}

/// 读筛选条件：`u32 nTopSubs, nTopSubs × str, u8 hasSubId, [str], u8 hasQuery, [str], u8 sort`。
fn read_filter(r: &mut Reader<'_>) -> Result<(Vec<String>, Option<String>, Option<String>, catalog::SortKey), i32> {
    let n_top = r.count(4)?;
    let mut top_sub_ids: Vec<String> = Vec::with_capacity(n_top);
    for _ in 0..n_top {
        top_sub_ids.push(r.string()?);
    }
    let has_sub_id = r.u8()? != 0;
    let sub_id = if has_sub_id { Some(r.string()?) } else { None };
    let has_query = r.u8()? != 0;
    let query = if has_query { Some(r.string()?) } else { None };
    let sort = match r.u8()? {
        0 => catalog::SortKey::Default,
        1 => catalog::SortKey::PriceAsc,
        2 => catalog::SortKey::PriceDesc,
        _ => return Err(SM_ERR_SHAPE),
    };
    Ok((top_sub_ids, sub_id, query, sort))
}

fn encode_indices(indices: &[usize]) -> Vec<u8> {
    let mut w = Writer::with_capacity(4 + indices.len() * 4);
    w.u32(indices.len() as u32);
    for i in indices {
        w.u32(*i as u32);
    }
    w.buf
}

// ─────────────────────────────────────────────────────────────────────────────
// 算子 1：购物袋汇总
// ─────────────────────────────────────────────────────────────────────────────

/// 购物袋汇总：`u32 nItems, n × (f64 price, u32 quantity)`
/// → `f64 totalAmount, u32 totalCount, u8 meetsMinDelivery, f64 minDeliveryGap`。
///
/// 纯数字进出（无字符串），跨边界成本最小 —— 这是 wasm 最该被用到的形状。
/// **没有** productId：前端按商品的角标数量是 O(商品数 × 行数) 的平凡循环
/// （65 件 × ≤20 行），为它引入字符串编码是负收益（实测见 docs/05）。
#[no_mangle]
pub extern "C" fn sm_cart_summary(ptr: *const u8, len: usize) -> i32 {
    let buf = match unsafe { input_slice(ptr, len) } {
        Ok(b) => b,
        Err(code) => return code,
    };
    let mut r = Reader::new(buf);
    let n_items = match r.count(12) {
        Ok(n) => n,
        Err(code) => return code,
    };
    let mut items: Vec<cart::CartItem> = Vec::with_capacity(n_items);
    for _ in 0..n_items {
        let price = match r.f64() {
            Ok(v) => v,
            Err(code) => return code,
        };
        let quantity = match r.u32() {
            Ok(v) => v,
            Err(code) => return code,
        };
        // 行键与 spec 不参与「合计/件数」（JS 的 getTotalAmount 同样只看 price×qty），
        // 填空值是为了复用 core::cart 里**那一份**求和实现 —— 求和方向不能各写一份。
        items.push(cart::CartItem {
            product_id: String::new(),
            name: String::new(),
            spec: None,
            price,
            quantity,
            subcategories: None,
        });
    }
    let snapshot = cart::Cart { items };
    let total_amount = cart::total_amount(&snapshot);
    let total_count = cart::total_count(&snapshot);
    let mut w = Writer::with_capacity(8 + 4 + 1 + 8);
    w.f64(total_amount);
    w.u32(total_count);
    w.u8(u8::from(supermarket_core::meets_min_delivery(total_amount)));
    w.f64(supermarket_core::min_delivery_gap(total_amount));
    put_result(w.buf)
}

// ─────────────────────────────────────────────────────────────────────────────
// 算子 2：一次性目录筛选（无状态）
// ─────────────────────────────────────────────────────────────────────────────

/// 一次性筛选：商品表段 + 筛选条件段 → `u32 k, k × u32 index`。
///
/// 每次调用都要重传整张商品表 —— 适合「表只查一次」的场景与对账测试；
/// 交互式（每次按键都查）请用 [sm_catalog_load] + [sm_catalog_query]。
#[no_mangle]
pub extern "C" fn sm_filter_indices(ptr: *const u8, len: usize) -> i32 {
    let buf = match unsafe { input_slice(ptr, len) } {
        Ok(b) => b,
        Err(code) => return code,
    };
    let mut r = Reader::new(buf);
    let products = match read_products(&mut r) {
        Ok(p) => p,
        Err(code) => return code,
    };
    let (top_sub_ids, sub_id, query, sort) = match read_filter(&mut r) {
        Ok(v) => v,
        Err(code) => return code,
    };
    // 尾部多余字节 = 输入与协议不符（例如 ABI 漂移）。静默忽略会让
    // 「ABI 没对上」变成「结果看着对但错了」，所以直接判形状错。
    if !r.at_end() {
        return SM_ERR_SHAPE;
    }
    let indices = catalog::filter_indices(&products, &top_sub_ids, sub_id.as_deref(), query.as_deref(), sort);
    put_result(encode_indices(&indices))
}

// ─────────────────────────────────────────────────────────────────────────────
// 算子 3：常驻目录索引（load + query）
// ─────────────────────────────────────────────────────────────────────────────

/// 加载/替换常驻目录（入参 = 商品表段）。返回商品件数；失败返回负错误码。
#[no_mangle]
pub extern "C" fn sm_catalog_load(ptr: *const u8, len: usize) -> i32 {
    let buf = match unsafe { input_slice(ptr, len) } {
        Ok(b) => b,
        Err(code) => return code,
    };
    let mut r = Reader::new(buf);
    let products = match read_products(&mut r) {
        Ok(p) => p,
        Err(code) => return code,
    };
    if !r.at_end() {
        return SM_ERR_SHAPE;
    }
    let count = products.len() as i32;
    // 预计算放在**加载时**（每次按键只做 contains）：这是常驻索引存在的全部理由。
    let prepared = catalog::prepare(&products);
    CATALOG.with(|cell| {
        *cell.borrow_mut() = Some((products, prepared));
    });
    put_result(Vec::new());
    count
}

/// 查询常驻目录（入参 = 筛选条件段）→ `u32 k, k × u32 index`。
///
/// 未加载就查询 ⇒ 明确报形状错，**不返回空列表**：空列表会被上层读成
/// 「这个分类没货」，那是把状态错误显示成业务结论。
#[no_mangle]
pub extern "C" fn sm_catalog_query(ptr: *const u8, len: usize) -> i32 {
    let buf = match unsafe { input_slice(ptr, len) } {
        Ok(b) => b,
        Err(code) => return code,
    };
    let mut r = Reader::new(buf);
    let (top_sub_ids, sub_id, query, sort) = match read_filter(&mut r) {
        Ok(v) => v,
        Err(code) => return code,
    };
    if !r.at_end() {
        return SM_ERR_SHAPE;
    }
    let result = CATALOG.with(|cell| {
        let borrowed = cell.borrow();
        match borrowed.as_ref() {
            None => Err(SM_ERR_SHAPE),
            Some((_products, prepared)) => Ok(catalog::query_prepared(
                prepared,
                &top_sub_ids,
                sub_id.as_deref(),
                query.as_deref(),
                sort,
            )),
        }
    });
    match result {
        Ok(indices) => put_result(encode_indices(&indices)),
        Err(code) => code,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 算子 4：CSV 导出
// ─────────────────────────────────────────────────────────────────────────────

/// CSV 导出：`u32 nHeader, cells × str, u32 nRows, rows × (u32 nCells, cells × str)`
/// → CSV 文本字节（BOM + CRLF）。
///
/// 单元格一律按**字符串**传：数字由 JS 侧 `String(n)` 归一，与
/// `core::csv::js_number_to_string` 同一口径（两侧都有用例钉住）。
///
/// 关于它的性能结论：这条路径**跨边界成本高于计算收益**（实测 2000 行时
/// wasm 略慢于 JS，规模到 20k 行仍不占优，见 docs/05）——
/// 它保留在模块里是作为「已量化、未启用」的对照实现，前端导出仍走原 JS 路径。
#[no_mangle]
pub extern "C" fn sm_csv_export(ptr: *const u8, len: usize) -> i32 {
    let buf = match unsafe { input_slice(ptr, len) } {
        Ok(b) => b,
        Err(code) => return code,
    };
    let mut r = Reader::new(buf);
    let n_header = match r.count(4) {
        Ok(n) => n,
        Err(code) => return code,
    };
    // 借用输入缓冲里的字节，不 to_string()：一次导出上万个单元格，
    // 逐格分配会让这条路径比 JS 正则版本还慢（实测数据见 docs/05）。
    let mut header: Vec<&str> = Vec::with_capacity(n_header);
    for _ in 0..n_header {
        match r.str_slice() {
            Ok(s) => header.push(s),
            Err(code) => return code,
        }
    }
    let n_rows = match r.count(4) {
        Ok(n) => n,
        Err(code) => return code,
    };
    let mut rows: Vec<Vec<&str>> = Vec::with_capacity(n_rows);
    for _ in 0..n_rows {
        let n_cells = match r.count(4) {
            Ok(n) => n,
            Err(code) => return code,
        };
        let mut cells: Vec<&str> = Vec::with_capacity(n_cells);
        for _ in 0..n_cells {
            match r.str_slice() {
                Ok(s) => cells.push(s),
                Err(code) => return code,
            }
        }
        rows.push(cells);
    }
    if !r.at_end() {
        return SM_ERR_SHAPE;
    }
    put_result(csv::build_csv_text_refs(&header, &rows).into_bytes())
}
