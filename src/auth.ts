import { IS_CLOUD } from './cloudbase'
import { clearCatalogCache } from './catalogCache'
import {
  upsertLocalProduct,
  deleteLocalProduct,
  updateLocalOrderStatus,
  deleteLocalOrder,
} from './localStore'
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

// 商品写操作统一在此收口：无论成功还是抛错都失效目录缓存。
// 用 finally 而非"仅成功时清"——请求可能已落库但响应解析失败，
// 那种情况下不清缓存会让顾客端最长 60s 拿到旧数据，代价远大于多拉一次。
async function withCatalogInvalidation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } finally {
    clearCatalogCache()
  }
}

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
  return withCatalogInvalidation(() =>
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
  return withCatalogInvalidation(() => adminCall('createProduct', clean))
}

export async function deleteProduct(productId: string): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalProduct(productId)
    return { ok: true }
  }
  return withCatalogInvalidation(() => adminCall('deleteProduct', { productId }))
}

// 批量商品更新（items 逐条更新，支持每组不同 updates）；返回服务端成功/失败明细
export async function batchUpdateProducts(items: { productId: string; updates: Record<string, unknown> }[]): Promise<{ code: number; message?: string; data?: BatchMutationResult } | { ok: true }> {
  if (!IS_CLOUD) {
    for (const it of items) upsertLocalProduct({ _id: it.productId, ...pickProductFields(it.updates) })
    return { ok: true }
  }
  return withCatalogInvalidation(() => adminCall<BatchMutationResult>('batchUpdateProducts', { items }))
}

// 批量删除商品；返回服务端成功/失败明细
export async function batchDeleteProducts(productIds: string[]): Promise<{ code: number; message?: string; data?: BatchMutationResult } | { ok: true }> {
  if (!IS_CLOUD) {
    for (const id of productIds) deleteLocalProduct(id)
    return { ok: true }
  }
  return withCatalogInvalidation(() => adminCall<BatchMutationResult>('batchDeleteProducts', { productIds }))
}

export async function updateOrderStatus(orderId: string, status: string): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    updateLocalOrderStatus(orderId, status as Order['status'])
    return { ok: true }
  }
  return adminCall('updateOrderStatus', { orderId, status })
}

export async function deleteOrder(orderId: string): Promise<{ code: number; message?: string; data?: unknown } | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalOrder(orderId)
    return { ok: true }
  }
  return adminCall('deleteOrder', { orderId })
}