import { IS_CLOUD } from './cloudbase'
import { clearCatalogCache } from './catalogCache'
import {
  upsertLocalProduct,
  deleteLocalProduct,
  updateLocalOrderStatus,
  deleteLocalOrder,
} from './localStore'
import type { ApiResult, Order } from './types'

// 管理后台鉴权：直接 HTTP 直调 Cloudflare Pages Functions（/web 端点），不再依赖云函数 SDK。
const ADMIN_KEY_STORAGE = 'sm_admin_key'

// 公开接口走 /pub 端点（Pages Functions 独立路由）
const PUBLIC_ACTIONS = ['createOrder', 'getReviews', 'createSubmission', 'addPublicReview', 'getPublicProducts', 'getPublicCategories']

function getApiBase(action: string): string {
  // 公开接口优先走 /pub 端点（如果配置了）
  if (PUBLIC_ACTIONS.includes(action) && import.meta.env.VITE_CB_PUBLIC_API_BASE) {
    return import.meta.env.VITE_CB_PUBLIC_API_BASE
  }
  // 管理接口 / 未配置公开端点时走 /web 端点
  if (import.meta.env.VITE_CB_API_BASE) return import.meta.env.VITE_CB_API_BASE
  // 未配置则显式返回空，由 callAdminApi 抛明确错误（不再拼任何兜底域名，避免误导）
  return ''
}

function getCachedKey(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

// 统一的云函数 HTTP 调用（不依赖 SDK 鉴权）
async function callAdminApi(action: string, adminKey: string, payload: Record<string, unknown>): Promise<ApiResult<any>> {
  const url = getApiBase(action)
  if (!url) throw new Error('未配置接口地址（VITE_CB_API_BASE / VITE_CB_PUBLIC_API_BASE），无法连接后端')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, adminKey: adminKey || '', payload: payload || {} }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (typeof data.code !== 'number') {
      throw new Error('云函数返回异常（可能网络不可达或跨域被拦截）')
    }
    return data
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// 登录：校验密钥，成功则缓存到会话
export async function loginAdmin(key: string): Promise<boolean> {
  if (!IS_CLOUD) {
    console.warn('[auth] 未配置 VITE_CB_API_BASE，进入本地演示模式：管理登录/操作不入库')
    return true
  }
  const data = await callAdminApi('login', key, {})
  if (data.code === 0) {
    try {
      sessionStorage.setItem(ADMIN_KEY_STORAGE, key)
    } catch {}
    return true
  }
  // 把云函数返回的真实错误（如"密钥错误"/"服务未配置 ADMIN_KEY"）抛给前端显示
  throw new Error(data.message || '密钥错误')
}

// 管理写操作：每次带上缓存的密钥
export async function adminCall(action: string, payload: Record<string, unknown> = {}): Promise<ApiResult<any>> {
  const data = await callAdminApi(action, getCachedKey(), payload)
  return data
}

export async function verifyAdminKey(key: string): Promise<boolean> {
  if (!IS_CLOUD) return true
  try {
    const data = await callAdminApi('verifyKey', key, {})
    return data.code === 0
  } catch {
    return false
  }
}

export const PRODUCT_FIELDS: string[] = ['name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order', 'image', 'images', 'description', 'reviews']
export function pickProductFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of PRODUCT_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
}

// 客户端字段白名单（与服务端 shared.js 的 *_FIELDS 对称，defence-in-depth）
// 服务端是信任边界、会重建/校验；此处再在客户端出口收敛一次，
// 即使服务端逻辑回归，客户端也不会发出多余字段。
// 注意：订单客户端只发输入字段（roomNumber/items），服务端另用 ORDER_FIELDS 收敛"存储文档"，二者概念不同。

export const ORDER_FIELDS: string[] = ['roomNumber', 'items', 'wechat', 'remark', 'paymentScreenshot']
export function pickOrderFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of ORDER_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  // 历史兼容：确认订单页曾用 building 字段，这里统一映射为 roomNumber，
  // 防止再次出现"页面传 building、云函数只认 roomNumber"的断链。
  if (clean.roomNumber === undefined && data.building !== undefined) {
    clean.roomNumber = String(data.building).trim()
  }
  return clean
}

export const REVIEW_FIELDS: string[] = ['productOrder', 'user', 'rating', 'text', 'images']
export function pickReviewFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of REVIEW_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
}

export const SUBMISSION_FIELDS: string[] = ['serviceId', 'serviceName', 'categoryId', 'categoryName', 'formData', 'images']
export function pickSubmissionFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of SUBMISSION_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
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

export async function updateProduct(productId: string, data: Record<string, unknown>): Promise<ApiResult<any> | { ok: true }> {
  if (!IS_CLOUD) {
    upsertLocalProduct({ _id: productId, ...pickProductFields(data) })
    return { ok: true }
  }
  return withCatalogInvalidation(() =>
    adminCall('updateProduct', { productId, ...pickProductFields(data) }),
  )
}

export async function createProduct(data: Record<string, unknown>): Promise<ApiResult<any> | { ok: true; _id: string }> {
  const clean = pickProductFields(data)
  if (!IS_CLOUD) {
    const id = 'p_' + Date.now()
    upsertLocalProduct({ _id: id, order: Date.now(), enabled: true, ...clean })
    return { ok: true, _id: id }
  }
  return withCatalogInvalidation(() => adminCall('createProduct', clean))
}

export async function deleteProduct(productId: string): Promise<ApiResult<any> | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalProduct(productId)
    return { ok: true }
  }
  return withCatalogInvalidation(() => adminCall('deleteProduct', { productId }))
}

export async function updateOrderStatus(orderId: string, status: string): Promise<ApiResult<any> | { ok: true }> {
  if (!IS_CLOUD) {
    updateLocalOrderStatus(orderId, status as Order['status'])
    return { ok: true }
  }
  return adminCall('updateOrderStatus', { orderId, status })
}

export async function deleteOrder(orderId: string): Promise<ApiResult<any> | { ok: true }> {
  if (!IS_CLOUD) {
    deleteLocalOrder(orderId)
    return { ok: true }
  }
  return adminCall('deleteOrder', { orderId })
}
