// rust/web/wasm-loader.js 的类型声明（给 TS 侧的 import 用）。
//
// 为什么不把 loader 改写成 TS：它是 `supermarket-wasm` 的**协议胶水**，交付形态是纯 ESM .js
// （与 crate 的 ABI 版本同源、可被 Node 侧的 wasm-host-test.mjs 直接 import 做对账）。
// 改成 TS 会让「同一个胶水」出现两份构建产物；这里用一份 .d.ts 换类型，源码仍是唯一的。

/** 线性内存协议版本：必须与 crates/wasm 的 SM_ABI_VERSION 相等，否则 loader 拒绝加载并回落。 */
export declare const SM_ABI_VERSION: number

export interface CartSummaryResult {
  totalAmount: number
  totalCount: number
  meetsMinDelivery: boolean
  minDeliveryGap: number
}

export interface CatalogQueryInput {
  topSubIds: string[]
  subId?: string | null
  q?: string | null
  sort?: string
}

export interface Accelerator {
  readonly available: boolean
  cartSummary(items: Array<{ price: number; quantity: number }>): CartSummaryResult
  filterIndices(input: { products: unknown[]; topSubIds: string[]; subId?: string | null; q?: string | null; sort?: string }): number[]
  catalogLoad(products: unknown[]): number
  catalogQuery(input: CatalogQueryInput): number[]
  csvExport(header: string[], rows: Array<Array<string | number>>): string
}

/** 加载 wasm；任何失败都返回 null（调用方必须回落 JS 实现）。 */
export declare function loadSupermarketWasm(url?: string, opts?: { fetchImpl?: typeof fetch }): Promise<Accelerator | null>

export interface FacadeOptions {
  url?: string
  fallback?: Record<string, (...args: never[]) => unknown>
  warmup?: boolean
}

export interface FacadeCall<T> {
  value: T | undefined
  via: 'wasm' | 'js'
}

export interface AcceleratorFacade {
  readonly ready: boolean
  warmup(): Promise<Accelerator | null>
  cartSummary(items: Array<{ price: number; quantity: number }>): FacadeCall<CartSummaryResult>
  filterIndices(input: { products: unknown[]; topSubIds: string[]; subId?: string | null; q?: string | null; sort?: string }): FacadeCall<number[]>
  catalogLoad(products: unknown[]): FacadeCall<number>
  catalogQuery(input: CatalogQueryInput): FacadeCall<number[]>
  csvExport(header: string[], rows: Array<Array<string | number>>): FacadeCall<string>
}

/** 带回落与懒加载的门面（见文件头注释：失败必回落，绝不猜）。 */
export declare function createAccelerator(options?: FacadeOptions): AcceleratorFacade
