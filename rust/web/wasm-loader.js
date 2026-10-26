// supermarket-wasm 的浏览器侧胶水（对应 crates/wasm 的 ABI v2）。
//
// 设计要点（每一条都对应 Rust 侧协议里的一处约束，改一处必须两边一起改）：
//   1) **懒加载**：不在首屏加载。默认在首屏渲染完成后经 requestIdleCallback 预热，
//      或第一次真正调用时按需加载 —— wasm 初始化（~1 ms 级）与下载（~23 KB brotli）
//      都不该出现在关键路径上。
//   2) **失败必回落**：任何一步（网络、ABI 版本不符、输入越界、编码异常）都返回 null，
//      由调用方走原本的 JS 实现。加速器坏了，页面必须只是「不快」，不是「不对」。
//   3) **结果不跨调用复用**：结果区是 wasm 内部单块缓冲，读出来必须先拷贝成字符串/对象，
//      否则下一次调用会把上一次的结果覆盖掉（这类缺陷表现为「偶尔算错价」，极难查）。
//   4) 输入用 DataView 直接写字节，**不做 JSON.stringify** —— 在主线程上序列化 65 件商品
//      正是我们要省掉的那部分 CPU。

export const SM_ABI_VERSION = 2

const SM_ERR = {
  '-1': '输入被截断（协议长度与实际字节不符）',
  '-2': '输入里有非法 UTF-8 段',
  '-3': '输入形状不对（数量与长度自相矛盾）',
  '-4': '输入超过上限（24 MiB）',
  '-5': '不认识的算子',
}

/** 小端写入器：按需增长，一次分配后复用。 */
class Writer {
  constructor (initial = 4096) {
    this.buf = new Uint8Array(initial)
    this.view = new DataView(this.buf.buffer)
    this.len = 0
  }

  #ensure (extra) {
    if (this.len + extra <= this.buf.length) return
    let size = this.buf.length
    while (size < this.len + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
    this.view = new DataView(next.buffer)
  }

  u8 (v) { this.#ensure(1); this.view.setUint8(this.len, v); this.len += 1 }
  u32 (v) { this.#ensure(4); this.view.setUint32(this.len, v, true); this.len += 4 }
  f64 (v) { this.#ensure(8); this.view.setFloat64(this.len, Number.isFinite(v) ? v : 0, true); this.len += 8 }
  str (v) {
    const text = typeof v === 'string' ? v : v == null ? '' : String(v)
    const bytes = this.encoder.encode(text)
    this.u32(bytes.length)
    this.#ensure(bytes.length)
    this.buf.set(bytes, this.len)
    this.len += bytes.length
  }
  get bytes () { return this.buf.subarray(0, this.len) }
}

Writer.prototype.encoder = new TextEncoder()
Writer.prototype.encoderValue = undefined

/**
 * 写一件商品（商品段布局，见 Rust 侧 read_products）。
 * 只写**参与筛选的字段** —— 其余字段留在 JS 手里（回下标协议的要点）。
 */
function writeProduct (w, p) {
  w.f64(p && p.price)
  const subs = Array.isArray(p && p.subcategories) ? p.subcategories : []
  w.u32(subs.length)
  for (const s of subs) w.str(s)
  w.str(p && p.name)
  w.str(p && p.spec)
  const options = Array.isArray(p && p.specOptions) ? p.specOptions : []
  let count = 0
  for (const o of options) if (o && typeof o.label === 'string' && o.label.trim()) count += 1
  w.u32(count)
  for (const o of options) {
    if (!o || typeof o.label !== 'string' || !o.label.trim()) continue
    w.str(o.label)
    w.u8(o.enabled === false ? 0 : 1)
  }
}

/** 结果读取器。 */
class Reader {
  constructor (bytes) { this.bytes = bytes; this.pos = 0 }
  u32 () { const v = (this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8) | (this.bytes[this.pos + 2] << 16) | (this.bytes[this.pos + 3] << 24)) >>> 0; this.pos += 4; return v }
  f64 () { const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8); this.pos += 8; return view.getFloat64(0, true) }
  u8 () { return this.bytes[this.pos++] }
  u32List (n) { const out = new Array(n); for (let i = 0; i < n; i += 1) out[i] = this.u32(); return out }
  // ignoreBOM: true —— TextDecoder 默认会把开头的 U+FEFF 当字节序标记**删掉**，
  // 而 CSV 的 BOM 是数据契约的一部分（Excel 靠它认 UTF-8，去掉就乱码）。
  // 这个默认值曾让本仓库的导出对账差 1 个字节（正好是 BOM 的长度），故显式钉死。
  text () { return new TextDecoder('utf-8', { ignoreBOM: true }).decode(this.bytes) }
}

/**
 * 加载并实例化。返回 null 表示「不可用，请回落 JS」。
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function loadSupermarketWasm (url = '/wasm/supermarket_wasm.wasm', opts = {}) {
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null)
  const instantiate = (bytes) => WebAssembly.instantiate(bytes, {})
  try {
    let instance
    if (doFetch && WebAssembly.instantiateStreaming) {
      try {
        const response = await doFetch(url)
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const result = await WebAssembly.instantiateStreaming(response, {})
        instance = result.instance
      } catch {
        // 有些静态托管不给 application/wasm，instantiateStreaming 会拒绝 ——
        // 这不是错误，退回 arrayBuffer 路径即可（多一次内存拷贝，但只在首次）。
        instance = null
      }
    }
    if (!instance) {
      const response = await doFetch(url)
      if (!response.ok) throw new Error('HTTP ' + response.status)
      instance = (await instantiate(await response.arrayBuffer())).instance
    }
    const exports_ = instance.exports
    if (typeof exports_.sm_abi_version !== 'function') throw new Error('导出的算子表不完整')
    const version = exports_.sm_abi_version()
    if (version !== SM_ABI_VERSION) {
      // ABI 不符必须拒绝加载：错位的参数解释器会读出「看着像数字的垃圾」，
      // 那比算不出来危险得多（线上表现为偶尔算错价）。
      throw new Error('ABI 版本不符：wasm=' + version + ' 胶水=' + SM_ABI_VERSION)
    }
    return new Accelerator(exports_)
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[wasm] 加速器不可用，已回落 JS 实现：', error && error.message)
    return null
  }
}

export class Accelerator {
  constructor (exports_) {
    this.exports = exports_
    this.memory = exports_.memory
    this.writer = new Writer()
  }

  get available () { return true }

  /** 统一的「写入 → 调用 → 读结果」流程；rc < 0 抛错（调用方捕获后回落）。 */
  #call (op, fill, decode) {
    const writer = this.writer
    writer.len = 0
    fill(writer)
    const input = writer.bytes
    const ptr = this.exports.sm_alloc(input.length)
    if (!ptr) throw new Error('wasm 分配输入区失败')
    try {
      new Uint8Array(this.memory.buffer, ptr, input.length).set(input)
      const rc = this.exports[op](ptr, input.length)
      if (rc < 0) throw new Error('wasm 返回错误码 ' + rc + '（' + (SM_ERR[String(rc)] || '未知') + '）')
      const resultPtr = this.exports.sm_result_ptr()
      const resultLen = this.exports.sm_result_len()
      if (resultLen !== rc) throw new Error('wasm 结果长度与返回码不一致：' + resultLen + ' vs ' + rc)
      // 必须立即拷贝：结果区是下一 次调用会覆盖的同一块内存。
      const copy = new Uint8Array(resultLen)
      copy.set(new Uint8Array(this.memory.buffer, resultPtr, resultLen))
      return decode(new Reader(copy))
    } finally {
      this.exports.sm_free(ptr, input.length)
    }
  }

  /**
   * 购物袋汇总。
   * @param {Array<{price:number, quantity:number}>} items
   * @returns {{totalAmount:number, totalCount:number, meetsMinDelivery:boolean, minDeliveryGap:number}}
   */
  cartSummary (items) {
    return this.#call(
      'sm_cart_summary',
      (w) => {
        w.u32(items.length)
        for (const item of items) {
          w.f64(item && item.price)
          w.u32(Math.max(0, Math.floor(Number(item && item.quantity) || 0)))
        }
      },
      (r) => ({
        totalAmount: r.f64(),
        totalCount: r.u32(),
        meetsMinDelivery: r.u8() === 1,
        minDeliveryGap: r.f64(),
      }),
    )
  }

  /**
   * 目录筛选/排序 → **原数组下标**（调用方用下标取自己的对象，字段一个都不动）。
   * @param {{products:Array, topSubIds:string[], subId?:string|null, q?:string|null, sort?:string}} input
   * @returns {number[]}
   */
  filterIndices ({ products, topSubIds, subId, q, sort }) {
    return this.#call(
      'sm_filter_indices',
      (w) => {
        w.u32(products.length)
        for (const p of products) writeProduct(w, p)
        w.u32(topSubIds.length)
        for (const s of topSubIds) w.str(s)
        const hasSub = subId != null && subId !== ''
        w.u8(hasSub ? 1 : 0)
        if (hasSub) w.str(subId)
        const hasQuery = q != null && q !== ''
        w.u8(hasQuery ? 1 : 0)
        if (hasQuery) w.str(q)
        w.u8(sort === 'price-asc' ? 1 : sort === 'price-desc' ? 2 : 0)
      },
      (r) => r.u32List(r.u32()),
    )
  }

  /**
   * 加载常驻目录索引（一次加载、多次查询）。入参是完整商品表。
   * @param {Array} products
   * @returns {number} 装进来的件数（< 0 表示失败）
   */
  catalogLoad (products) {
    const writer = this.writer
    writer.len = 0
    writer.u32(products.length)
    for (const p of products) writeProduct(writer, p)
    const input = writer.bytes
    const ptr = this.exports.sm_alloc(input.length)
    if (!ptr) throw new Error('wasm 分配输入区失败')
    try {
      new Uint8Array(this.memory.buffer, ptr, input.length).set(input)
      const rc = this.exports.sm_catalog_load(ptr, input.length)
      if (rc < 0) throw new Error('sm_catalog_load 返回错误码 ' + rc)
      return rc
    } finally {
      this.exports.sm_free(ptr, input.length)
    }
  }

  /**
   * 查询常驻目录（每次按键只编码查询条件，不重传商品表）。
   * @param {{topSubIds:string[], subId?:string|null, q?:string|null, sort?:string}} input
   * @returns {number[]} 原数组下标
   */
  catalogQuery ({ topSubIds, subId, q, sort }) {
    return this.#call(
      'sm_catalog_query',
      (w) => {
        w.u32(topSubIds.length)
        for (const s of topSubIds) w.str(s)
        const hasSub = subId != null && subId !== ''
        w.u8(hasSub ? 1 : 0)
        if (hasSub) w.str(subId)
        const hasQuery = q != null && q !== ''
        w.u8(hasQuery ? 1 : 0)
        if (hasQuery) w.str(q)
        w.u8(sort === 'price-asc' ? 1 : sort === 'price-desc' ? 2 : 0)
      },
      (r) => r.u32List(r.u32()),
    )
  }

  /**
   * CSV 导出（BOM + CRLF，Excel 兼容）。
   * @param {string[]} header
   * @param {Array<Array<string|number>>} rows
   * @returns {string}
   */
  csvExport (header, rows) {
    return this.#call(
      'sm_csv_export',
      (w) => {
        w.u32(header.length)
        for (const cell of header) w.str(cell)
        w.u32(rows.length)
        for (const row of rows) {
          w.u32(row.length)
          for (const cell of row) {
            // 数字按 JS 的 String(n) 归一 —— 与 core::csv::js_number_to_string 同一口径
            // （Rust 侧为 123.0 写 "123" 的规则在两侧都有用例钉住）。
            w.str(typeof cell === 'number' ? String(cell) : cell == null ? '' : cell)
          }
        }
      },
      (r) => r.text(),
    )
  }
}

/**
 * 门面：把「加载 + 回落」藏起来，调用方只写 `acc.cartSummary(items)`。
 *
 * @param {{url?:string, fallback?:object, warmup?:boolean}} options
 */
export function createAccelerator (options = {}) {
  const { url = '/wasm/supermarket_wasm.wasm', fallback = {}, warmup = true } = options
  let instance = null
  let loading = null
  let enabled = true

  const ensure = () => {
    if (!enabled) return Promise.resolve(null)
    if (instance) return Promise.resolve(instance)
    if (!loading) {
      loading = loadSupermarketWasm(url, options).then((acc) => {
        instance = acc
        if (!acc) enabled = false
        return acc
      })
    }
    return loading
  }

  /** 预热：首屏渲染完成后空闲时加载（不阻塞 LCP）。 */
  const idle = (cb) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 2000 })
    else setTimeout(cb, 1200)
  }
  if (warmup && typeof window !== 'undefined') idle(() => { ensure() })

  const call = (method, args, jsFallback) => {
    if (instance) {
      try {
        return { value: instance[method](...args), via: 'wasm' }
      } catch (error) {
        // 运行期失败（含坏输入触发的错误码）→ 永久回落，避免每次交互都白跑一次 wasm。
        enabled = false
        instance = null
        if (typeof console !== 'undefined') console.warn('[wasm] 调用失败，回落 JS：', error && error.message)
      }
    }
    return { value: typeof jsFallback === 'function' ? jsFallback(...args) : undefined, via: 'js' }
  }

  return {
    /** 是否已经加载成功（判据脚本用）。 */
    get ready () { return Boolean(instance) },
    warmup: ensure,
    cartSummary: (items) => call('cartSummary', [items], fallback.cartSummary),
    filterIndices: (input) => call('filterIndices', [input], fallback.filterIndices),
    catalogLoad: (products) => call('catalogLoad', [products], fallback.catalogLoad),
    catalogQuery: (input) => call('catalogQuery', [input], fallback.catalogQuery),
    csvExport: (header, rows) => call('csvExport', [header, rows], fallback.csvExport),
  }
}
