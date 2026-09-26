import { IS_CLOUD } from './cloudbase'
import { withCacheInvalidation } from './catalogCache'
import {
  upsertLocalProduct,
  upsertLocalProducts,
  deleteLocalProduct,
  deleteLocalProducts,
  getLocalOrders,
  updateLocalOrderStatus,
  deleteLocalOrder,
} from './localStore'
import { canTransitionOrder } from './utils/orderStatus'
import type { Order } from './types'
import { adminCall, publicCall, loginAdmin, verifyAdminKey } from './api/client'
import {
  PRODUCT_FIELDS, pickProductFields,
  ORDER_FIELDS, pickOrderFields,
  REVIEW_FIELDS, pickReviewFields,
  SUBMISSION_FIELDS, pickSubmissionFields,
} from './api/fields'

// API 客户端与字段白名单已拆至 src/api/client.ts / src/api/fields.ts（2026-09-05 M3）。
// 本文件保留：re-export（兼容既有 `import { ... } from '../auth'` 调用方）+ 商品/订单写操作收口。
export { adminCall, publicCall, loginAdmin, verifyAdminKey }
export {
  PRODUCT_FIELDS, pickProductFields,
  ORDER_FIELDS, pickOrderFields,
  REVIEW_FIELDS, pickReviewFields,
  SUBMISSION_FIELDS, pickSubmissionFields,
}

// 商品/订单写操作的缓存失效统一走 catalogCache 的 withCacheInvalidation（finally 语义）。

// 批量商品操作结果（与 backend.js batchUpdateProducts/batchDeleteProducts 返回对齐）
export interface BatchMutationResult {
  updated?: number
  deleted?: number
  failed: Array<{ id: string; message: string }>
  total: number
}

export async function updateProduct(productId: string, data: Record<string, unknown>): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    upsertLocalProduct({ _id: productId, ...pickProductFields(data) })
    return { ok: true }
  }
  return withCacheInvalidation(() =>
    adminCall('updateProduct', { productId, ...pickProductFields(data) }),
  )
}

export async function createProduct(data: Record<string, unknown>): Promise<{ code: number; message?: string; data?: unknown } | { ok: true; _id: string }> {
  const clean = pickProductFields(data)
  if (!IS_CLOUD) {
    const id = 'p_' + Date.now()
    upsertLocalProduct({ _id: id, order: Date.now(), enabled: true, ...clean })
    return { ok: true, _id: id }
  }
  return withCacheInvalidation(() => adminCall('createProduct', clean))
}

export async function deleteProduct(productId: string): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalProduct(productId)
    return { ok: true }
  }
  return withCacheInvalidation(() => adminCall('deleteProduct', { productId }))
}

// 批量商品更新（items 逐条更新，支持每组不同 updates）；返回服务端成功/失败明细
// 分片大小必须等于服务端 BATCH_UPDATE_MAX（40）：那边按 D1 免费档「每调用 50 查询」推导，
// 这里只是把一次多选拆成若干次合法请求。由 tests/batchChunkContract.test.js 钉住两侧一致
// （形态沿用 src/utils/spec-options.ts 与 orders.js 的口味分隔符双写 + 契约测试先例）。
export const BATCH_UPDATE_CHUNK = 40

export async function batchUpdateProducts(items: { productId: string; updates: Record<string, unknown> }[]): Promise<{ code: number; message?: string; data?: BatchMutationResult } | { ok: true }> {
  if (!IS_CLOUD) {
    upsertLocalProducts(items.map((it) => ({ _id: it.productId, ...pickProductFields(it.updates) })))
    return { ok: true }
  }
  return withCacheInvalidation(() => runInChunks(items))
}

// 逐片提交：某片失败不把整批判死，该片条目记进 failed —— 与服务端"部分失败可定位重试"同语义。
async function runInChunks(items: { productId: string; updates: Record<string, unknown> }[]) {
  let updated = 0
  const merged: BatchMutationResult = { failed: [], total: items.length }
  for (let i = 0; i < items.length; i += BATCH_UPDATE_CHUNK) {
    const chunk = items.slice(i, i + BATCH_UPDATE_CHUNK)
    const r = await adminCall<BatchMutationResult>('batchUpdateProducts', { items: chunk })
    if (r.code !== 0) {
      merged.failed.push(...chunk.map((c) => ({ id: c.productId, message: r.message || '分片提交失败' })))
      continue
    }
    updated += r.data?.updated ?? 0
    merged.failed.push(...(r.data?.failed ?? []))
  }
  return { code: 0, data: { ...merged, updated } }
}

// 批量删除商品；返回服务端成功/失败明细
export async function batchDeleteProducts(productIds: string[]): Promise<{ code: number; message?: string; data?: BatchMutationResult } | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalProducts(productIds)
    return { ok: true }
  }
  return withCacheInvalidation(() => adminCall<BatchMutationResult>('batchDeleteProducts', { productIds }))
}

export async function updateOrderStatus(orderId: string, status: string): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    // 本地演示模式与云端同规则强制状态机（迁移表单源见 src/utils/orderStatus.ts）
    const cur = getLocalOrders().find((o) => o._id === orderId)
    if (cur && !canTransitionOrder(cur.status, status))
      return { code: -1, message: `不允许的状态流转: ${cur.status} → ${status}` }
    updateLocalOrderStatus(orderId, status as Order['status'])
    return { ok: true }
  }
  // 订单状态变更会在服务端改 products.stock（取消回补 / 误取消重新占用），
  // 而顾客端商品列表（含 stock）正走 catalogCache ⇒ 不失效则同会话最长 60s 看到旧库存。
  return withCacheInvalidation(() => adminCall('updateOrderStatus', { orderId, status }))
}

export async function deleteOrder(orderId: string): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalOrder(orderId)
    return { ok: true }
  }
  // 删除进行中订单同样回补库存，失效口径与 updateOrderStatus 一致
  return withCacheInvalidation(() => adminCall('deleteOrder', { orderId }))
}