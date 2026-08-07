import { IS_CLOUD } from './cloudbase.js'
import { clearCatalogCache } from './catalogCache.js'
import {
  upsertLocalProduct,
  deleteLocalProduct,
  updateLocalOrderStatus,
  deleteLocalOrder,
} from './localStore.js'

// 管理后台鉴权：直接 HTTP 直调云函数（绕过 SDK callFunction 在浏览器端的鉴权/CORS 问题）。
// 走 CloudBase 云函数 HTTP 访问服务 /web 端点；请求体即 event（部分触发会把 body 包成字符串，云函数已兼容）。
const ADMIN_KEY_STORAGE = 'sm_admin_key'

// 公开接口走独立函数（部署后在 CloudBase 控制台配置 HTTP 访问服务路径）
const PUBLIC_ACTIONS = ['createOrder', 'getReviews', 'createSubmission', 'getPublicProducts', 'getPublicCategories']

function getApiBase(action) {
  // 公开接口优先走 public-api（如果配置了）
  if (PUBLIC_ACTIONS.includes(action) && import.meta.env.VITE_CB_PUBLIC_API_BASE) {
    return import.meta.env.VITE_CB_PUBLIC_API_BASE
  }
  // 管理接口 / 未配置公开端点时走 admin-api
  if (import.meta.env.VITE_CB_API_BASE) return import.meta.env.VITE_CB_API_BASE
  // 兜底：用 envId 拼 tcb-api 域名（旧写法，该域名并非 HTTP 访问服务端点，通常不通）
  const envId = import.meta.env.VITE_CB_ENV_ID
  return envId
    ? `https://${envId}.ap-shanghai.tcb-api.tencentcloud.com/web?env=${envId}&name=admin-api`
    : ''
}

function getCachedKey() {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

// 统一的云函数 HTTP 调用（不依赖 SDK 鉴权）
async function callAdminApi(action, adminKey, payload) {
  const url = getApiBase(action)
  if (!url) throw new Error('未配置 VITE_CB_ENV_ID，无法连接云函数')
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
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// 登录：校验密钥，成功则缓存到会话
export async function loginAdmin(key) {
  if (!IS_CLOUD) return true
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
export async function adminCall(action, payload = {}) {
  const data = await callAdminApi(action, getCachedKey(), payload)
  return data
}

export async function verifyAdminKey(key) {
  if (!IS_CLOUD) return true
  try {
    const data = await callAdminApi('verifyKey', key, {})
    return data.code === 0
  } catch {
    return false
  }
}

const PRODUCT_FIELDS = ['name', 'spec', 'price', 'subcategories', 'enabled', 'order', 'image', 'description', 'reviews']
function pickProductFields(data) {
  const clean = {}
  for (const k of PRODUCT_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
}

// 商品写操作统一在此收口：无论成功还是抛错都失效目录缓存。
// 用 finally 而非"仅成功时清"——请求可能已落库但响应解析失败，
// 那种情况下不清缓存会让顾客端最长 60s 拿到旧数据，代价远大于多拉一次。
async function withCatalogInvalidation(fn) {
  try {
    return await fn()
  } finally {
    clearCatalogCache()
  }
}

export async function updateProduct(productId, data) {
  if (!IS_CLOUD) {
    upsertLocalProduct({ _id: productId, ...pickProductFields(data) })
    return { ok: true }
  }
  return withCatalogInvalidation(() =>
    adminCall('updateProduct', { productId, ...pickProductFields(data) }),
  )
}

export async function createProduct(data) {
  const clean = pickProductFields(data)
  if (!IS_CLOUD) {
    const id = 'p_' + Date.now()
    upsertLocalProduct({ _id: id, order: Date.now(), enabled: true, ...clean })
    return { ok: true, _id: id }
  }
  return withCatalogInvalidation(() => adminCall('createProduct', clean))
}

export async function deleteProduct(productId) {
  if (!IS_CLOUD) {
    deleteLocalProduct(productId)
    return { ok: true }
  }
  return withCatalogInvalidation(() => adminCall('deleteProduct', { productId }))
}

export async function updateOrderStatus(orderId, status) {
  if (!IS_CLOUD) {
    updateLocalOrderStatus(orderId, status)
    return { ok: true }
  }
  return adminCall('updateOrderStatus', { orderId, status })
}

export async function deleteOrder(orderId) {
  if (!IS_CLOUD) {
    deleteLocalOrder(orderId)
    return { ok: true }
  }
  return adminCall('deleteOrder', { orderId })
}
