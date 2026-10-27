// 商城页的 WASM 常驻索引：**按需加载**的加速器模块（由商城页 dynamic import）。
//
// ## 分工
//
// · 灰度开关判定在 src/wasmFlag.ts（轻量、静态引用）；
// · 本模块（含 loader 与协议胶水）只在开关打开时才被 dynamic import ⇒ 默认路径零字节成本；
// · 索引装载失败 / wasm 不可用 / ABI 不符 / 运行期异常 ⇒ query 返回 null，调用方走原 JS 实现。
//
// ## 为什么只加速「筛选 + 排序」
//
// 实测（rust/docs/05 §4）：常驻索引把「每次按键都要对整表 toLowerCase + 拼搜索文本」挪到加载时，
// 查询本身快 2.47×；而一次性筛选（每次重传整表）与 CSV 导出在实测里都更慢，所以**不接**。
// 搜索建议（draftQ 驱动的下拉）与 deferredQ 不是同一条时间线，本轮也不接（避免把两件事的回归面叠起来）。

import { createAccelerator } from '../rust/web/wasm-loader.js'
import type { Product } from './types'

/** wasm 产物路径（构建脚本写进 public/wasm/；见 rust/scripts/build-wasm.mjs）。 */
export const WASM_URL = '/wasm/supermarket_wasm.wasm'

export interface CatalogQuery {
  topSubIds: string[]
  subId?: string | null
  q?: string | null
  sort?: string
}

export interface CatalogAccel {
  ready: boolean
  /** 命中下标（原数组下标，字段一个都不动）；未就绪/失败返回 null。 */
  query(input: CatalogQuery): number[] | null
}

// 模块级单例：wasm 实例化与索引装载都是「一次就够」的重活，切路由再回来不该重付。
let facade: ReturnType<typeof createAccelerator> | null = null
let loadedKey = ''
let current: CatalogAccel | null = null

function keyOf(products: Product[]): string {
  // 用「长度 + 首尾 id」当内容指纹：products 每次 refresh 都换新数组引用，
  // 只比引用会反复重装索引（重装一次要重编码整张表）。
  return products.length + ':' + (products[0]?._id ?? '') + ':' + (products[products.length - 1]?._id ?? '')
}

/** 装载（或复用）常驻索引，返回查询句柄。永不抛：任何失败都退化为 ready=false。 */
export async function loadCatalogAccel(products: Product[]): Promise<CatalogAccel> {
  if (!facade) facade = createAccelerator({ url: WASM_URL, warmup: false })
  const a = await facade.warmup()
  if (!a) return { ready: false, query: () => null }
  const key = keyOf(products)
  if (loadedKey !== key || !current) {
    try {
      a.catalogLoad(products)
      loadedKey = key
    } catch {
      return { ready: false, query: () => null }
    }
  }
  current = {
    ready: true,
    query(input: CatalogQuery): number[] | null {
      try {
        return facade!.catalogQuery(input).value ?? null
      } catch {
        // 运行期失败由门面内部置为永久回落；这里再兜一层，保证页面不因加速器抛错
        return null
      }
    },
  }
  return current
}
