import { getDatabase, IS_CLOUD, ensureAuth } from './cloudbase.js'
import { adminCall } from './auth.js'
import {
  getLocalCategories,
  getLocalProducts,
  getLocalOrders,
  addLocalOrder,
  getLocalReviews,
  addLocalReview,
} from './localStore.js'
import { categories as seedCategories, products as seedProducts } from './data/products-seed.js'

let _db = null
async function cloud() {
  if (!_db) _db = await getDatabase()
  return _db
}

async function ensure() {
  await ensureAuth()
}

// --- 只读目录缓存：商品/分类极少变化，加内存 TTL 缓存，砍掉重复云函数+DB 请求 ---
const _catalogCache = new Map()
const CATALOG_CACHE_TTL = 60 * 1000
function cacheGet(key) {
  const hit = _catalogCache.get(key)
  if (hit && Date.now() - hit.ts < CATALOG_CACHE_TTL) return hit.data
  return null
}
function cacheSet(key, data) {
  _catalogCache.set(key, { ts: Date.now(), data })
}
// 管理端改完商品/分类后可调用此函数主动失效缓存（见 auth.js 的写操作）
export function clearCatalogCache() {
  _catalogCache.clear()
}

// 顾客端分类 — 走 HTTP API，不依赖 SDK 匿名登录
export async function getCategories() {
  if (!IS_CLOUD) return getLocalCategories()
  const cacheKey = 'publicCategories'
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  try {
    const result = await adminCall('getPublicCategories', {})
    if (result.code === 0 && result.data?.length) {
      cacheSet(cacheKey, result.data)
      return result.data
    }
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] getPublicCategories failed, using local fallback:', e.message)
    return getLocalCategories()
  }
}

// 顾客端商品（仅上架）— 走 HTTP API，不依赖 SDK 匿名登录
export async function getProducts() {
  if (!IS_CLOUD) return getLocalProducts().filter((p) => p.enabled !== false)
  const cacheKey = 'publicProducts'
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  try {
    const result = await adminCall('getPublicProducts', {})
    if (result.code === 0 && result.data?.length) {
      cacheSet(cacheKey, result.data)
      return result.data
    }
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] getPublicProducts failed, using local fallback:', e.message)
    return getLocalProducts().filter((p) => p.enabled !== false)
  }
}

// 管理端商品（全部，含下架）— 走 HTTP API，与写操作同路径
export async function getAdminProducts() {
  if (!IS_CLOUD) return getLocalProducts()
  try {
    const result = await adminCall('getProducts', {})
    if (result.code === 0 && result.data) return result.data
    throw new Error(result.message || 'empty')
  } catch (e) {
    console.warn('[db] cloud getAdminProducts failed, using local fallback:', e.message)
    return getLocalProducts()
  }
}

// 创建订单（走云函数，服务端重算金额，防客户端篡改）
export async function createOrder(order) {
  if (!IS_CLOUD) {
    return { id: addLocalOrder(order)._id, localFallback: true }
  }
  try {
    const result = await adminCall('createOrder', order)
    if (result.code !== 0) throw new Error(result.message || '创建订单失败')
    return { id: result.data.id }
  } catch (e) {
    console.warn('[db] cloud createOrder failed, using local fallback:', e.message)
    return { id: addLocalOrder(order)._id, localFallback: true }
  }
}

// 查询单个订单（走 SDK 鉴权，仅管理端）
export async function getOrderById(orderId) {
  if (!IS_CLOUD) return getLocalOrders().find(o => o._id === orderId) || null
  try {
    await ensure()
    const res = await (await cloud()).collection('sm_orders').doc(orderId).get()
    return res.data?.[0] || res.data || null
  } catch (e) {
    console.warn('[db] getOrderById failed:', e.message)
    return null
  }
}

// 查询订单（分页，仅管理端）
export async function getOrders({ page = 1, pageSize = 50 } = {}) {
  if (!IS_CLOUD) return getLocalOrders()
  try {
    await ensure()
    const res = await (await cloud()).collection('sm_orders')
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return res.data || []
  } catch (e) {
    console.warn('[db] cloud getOrders failed, using local fallback:', e.message)
    return getLocalOrders()
  }
}

// 提交评价（本地持久化，无需登录/购买，像视频评论区）
// 顾客提交存 localStorage；管理员通过后台提交的会走云函数存云端 sm_reviews
export function addReview(productOrder, review) {
  return addLocalReview(productOrder, review)
}

// 读取本地评价（用户自己提交的）
export function getLocalProductReviews(productOrder) {
  return getLocalReviews(productOrder)
}

// 云端评价（顾客端读取，公开接口）
export async function getCloudReviews(productOrder) {
  if (!IS_CLOUD) return []
  try {
    const result = await adminCall('getReviews', { productOrder: Number(productOrder) })
    if (result.code === 0) return result.data || []
    console.warn('[db] getCloudReviews failed:', result.message)
    return []
  } catch (e) {
    console.warn('[db] getCloudReviews error:', e.message)
    return []
  }
}

// 管理员新增评价到云端
export async function addCloudReview(productOrder, review) {
  if (!IS_CLOUD) return addLocalReview(productOrder, review)
  const result = await adminCall('addReview', {
    productOrder: Number(productOrder),
    user: review.user || '管理员',
    rating: Number(review.rating) || 5,
    text: String(review.text || ''),
  })
  if (result.code !== 0) throw new Error(result.message || '新增评价失败')
  return result.data
}

// 管理员删除评价
export async function deleteCloudReview(reviewId) {
  if (!IS_CLOUD) return true
  const result = await adminCall('deleteReview', { reviewId })
  if (result.code !== 0) throw new Error(result.message || '删除评价失败')
  return true
}

// 管理员获取所有评价（管理后台用）
export async function getAllReviews() {
  if (!IS_CLOUD) return []
  const result = await adminCall('getAllReviews', {})
  if (result.code === 0) return result.data || []
  throw new Error(result.message || '获取评价列表失败')
}

// ---------- 服务表单提交 ----------
function safeParse(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}

const PENDING_QUEUE_KEY = 'sm_pending_submissions'

function getPendingQueue() {
  return safeParse(PENDING_QUEUE_KEY)
}

function savePendingQueue(queue) {
  try { localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue)) } catch {}
}

// 重试离线队列中的提交
export async function flushPendingSubmissions() {
  if (!IS_CLOUD) return
  const queue = getPendingQueue()
  if (queue.length === 0) return
  const remaining = []
  for (const item of queue) {
    try {
      const result = await adminCall('createSubmission', item)
      if (result.code !== 0) remaining.push(item)
    } catch {
      remaining.push(item)
    }
  }
  savePendingQueue(remaining)
}

// 网络恢复时自动重试 + 页面加载时补刷离线队列。
// 抽成显式初始化函数，避免在 import 时产生副作用（测试可控、避免重复注册监听）。
// 由应用入口 main.jsx 启动时调用一次。
export function initSubmissionSync() {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => flushPendingSubmissions())
  // 页面加载时也尝试一次（延迟执行，避免阻塞首屏）
  setTimeout(() => flushPendingSubmissions(), 3000)
}

export async function createSubmission(submission) {
  if (!IS_CLOUD) {
    const key = 'sm_submissions'
    const list = safeParse(key)
    const record = { ...submission, _id: 'sub_' + Date.now(), status: 'pending' }
    list.unshift(record)
    localStorage.setItem(key, JSON.stringify(list))
    return { id: record._id }
  }
  try {
    const result = await adminCall('createSubmission', submission)
    if (result.code !== 0) throw new Error(result.message || '提交失败')
    return { id: result.data?.id }
  } catch (e) {
    console.warn('[db] cloud createSubmission failed, queuing for retry:', e.message)
    // 存入离线队列，网络恢复后自动重试
    const queue = getPendingQueue()
    queue.push(submission)
    savePendingQueue(queue)
    // 同时存本地让用户能看到
    const key = 'sm_submissions'
    const list = safeParse(key)
    const record = { ...submission, _id: 'sub_' + Date.now(), status: 'pending', _offline: true }
    list.unshift(record)
    localStorage.setItem(key, JSON.stringify(list))
    return { id: record._id, offline: true }
  }
}

export async function getSubmissions() {
  if (!IS_CLOUD) {
    return safeParse('sm_submissions')
  }
  const result = await adminCall('getSubmissions', {})
  if (result.code === 0) return result.data || []
  throw new Error(result.message || '获取提交列表失败')
}

// ---------- 云端初始化（建集合 + 导入种子，仅管理端） ----------
export async function seedCloudData() {
  if (!IS_CLOUD) throw new Error('仅云端模式可初始化')
  await ensure()
  const db = await cloud()
  const cols = ['sm_categories', 'sm_products', 'sm_orders']
  for (const c of cols) {
    try {
      await db.createCollection(c)
    } catch (e) {
      if (!/exist/i.test(String(e?.message || e))) throw e
    }
  }

  const cc = await db.collection('sm_categories').count()
  if (cc.total === 0) {
    for (const c of seedCategories) await db.collection('sm_categories').add(c)
  }

  const pc = await db.collection('sm_products').count()
  if (pc.total === 0) {
    for (const p of seedProducts) await db.collection('sm_products').add({ ...p, enabled: true })
  }

  const after = await db.collection('sm_products').count()
  return { categories: cc.total, products: after.total }
}
