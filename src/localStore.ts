// 本地模式数据层：无 CloudBase 凭证时使用，数据存于 localStorage。
// 商品 = 种子数据 + 本地覆盖（改价/上下架/新增/删除）；订单同样本地持久化。
import { categories as seedCategories, products as seedProducts } from './data/products-seed'
import type { Category, Order, Product, Review } from './types'

const PRODUCTS_KEY = 'sm_products_local'
const ORDERS_KEY = 'sm_orders_local'
const REVIEWS_KEY = 'sm_reviews_local'

// 为种子商品补全 _id（云端模式下 _id 由数据库提供，本地模式需稳定唯一标识）
function seedToLocal(): Product[] {
  return seedProducts.map((p) => ({
    _id: 'p_' + p.order,
    name: p.name,
    spec: p.spec || '',
    price: p.price,
    subcategories: p.subcategories || [],
    enabled: true,
    order: p.order,
    // 可选口味必须带上：本地演示模式的详情页口味选择器就靠这一个字段
    specOptions: p.specOptions || [],
  }))
}

/**
 * 解析结果缓存（2026-09-23 性能改造）。
 *
 * 原实现每次读都 `JSON.parse` 整表、每次写都 `JSON.stringify` 整表。
 * 加购属于高频写，而管理端一次渲染会触发多次读 —— 反复同步解析是主线程卡顿来源。
 *
 * ⚠️ 存储格式**保持不变**（仍是整表 JSON），因此对已有本地数据零迁移、零破坏。
 * 原计划里的「增量写」需要改成按记录分键存储（= 对既有用户数据做迁移），
 * 收益仅限本地演示模式，风险却落到真实数据上，故本轮不做。
 *
 * 别名安全：读取方一律拿到**浅拷贝**（新数组容器），
 * 既避免调用方原地改动污染缓存，也保留原实现「每次读都是新数组」的语义。
 */
const parseCache = new Map<string, unknown>()

function readJSON<T>(key: string, fallback: T): T {
  if (parseCache.has(key)) return parseCache.get(key) as T
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      parseCache.set(key, fallback)
      return fallback
    }
    const parsed = JSON.parse(raw) as T
    const value = parsed == null ? fallback : parsed
    parseCache.set(key, value)
    return value
  } catch {
    parseCache.set(key, fallback)
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    // 先落缓存再落盘：后续读命中缓存，省掉一次整表 parse（缓存即最新真相源）
    parseCache.set(key, value)
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('localStore write failed:', e)
  }
}

/** 数组读出的统一出口：返回浅拷贝容器，防止调用方原地改动污染缓存 */
function cloneArray<T>(list: T[]): T[] {
  return Array.isArray(list) ? list.slice() : []
}

export function getLocalCategories(): Category[] {
  return seedCategories
}

export function getLocalProducts(): Product[] {
  // P1-4：区分「从未初始化」与「已初始化但为空」。
  // 旧写法用 list.length === 0 判定未初始化，导致管理端把商品删光后刷新又被重新 seed，
  // 表现为"删不掉"。只有键完全不存在时才播种；已存值（含空数组）一律照原样返回。
  //
  // 2026-09-23 第三轮优化：单次 getItem 直解（原先先 getItem 判空、readJSON 内又
  // getItem 一次，每读两次同步 I/O；parseCache 命中时零 I/O 路径不变）。
  const raw = localStorage.getItem(PRODUCTS_KEY)
  if (raw === null) {
    const seeded = seedToLocal()
    writeJSON(PRODUCTS_KEY, seeded)
    return cloneArray(seeded)
  }
  try {
    const parsed = JSON.parse(raw) as Product[] | null
    const list = Array.isArray(parsed) ? parsed : []
    parseCache.set(PRODUCTS_KEY, list)
    return cloneArray(list)
  } catch {
    parseCache.set(PRODUCTS_KEY, [])
    return []
  }
}

export function saveLocalProducts(list: Product[]): void {
  writeJSON(PRODUCTS_KEY, list)
}

export function upsertLocalProduct(product: Partial<Product> & { _id: string }): Product[] {
  const list = getLocalProducts()
  const idx = list.findIndex((p) => p._id === product._id)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...product } as Product
  } else {
    list.push(product as Product)
  }
  saveLocalProducts(list)
  return list
}

/** 批量 upsert：一次读 + 一次写（逐条调 upsertLocalProduct 会对 N 个商品做 N 次整表 stringify） */
export function upsertLocalProducts(items: Array<Partial<Product> & { _id: string }>): Product[] {
  const list = getLocalProducts()
  const pending = new Map(items.map((it) => [it._id, it]))
  for (let i = 0; i < list.length; i++) {
    const it = pending.get(list[i]._id)
    if (it) {
      list[i] = { ...list[i], ...it } as Product
      pending.delete(list[i]._id)
    }
  }
  for (const it of pending.values()) list.push(it as Product)
  saveLocalProducts(list)
  return list
}

/** 批量删除：一次读 + 一次写 */
export function deleteLocalProducts(productIds: string[]): Product[] {
  const ids = new Set(productIds)
  const list = getLocalProducts().filter((p) => !ids.has(p._id))
  saveLocalProducts(list)
  return list
}

export function deleteLocalProduct(productId: string): Product[] {
  const list = getLocalProducts().filter((p) => p._id !== productId)
  saveLocalProducts(list)
  return list
}

export function getLocalOrders(): Order[] {
  return cloneArray(readJSON<Order[]>(ORDERS_KEY, []))
}

export function addLocalOrder(order: Record<string, unknown>): Order {
  const list = getLocalOrders()
  const items = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : []
  const totalAmount = items.reduce(
    (sum: number, item: Record<string, unknown>) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0,
  )
  const record = {
    _id: 'o_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...order,
    totalAmount: Math.round(totalAmount * 100) / 100,
  } as Order
  list.unshift(record)
  writeJSON(ORDERS_KEY, list)
  return record
}

export function updateLocalOrderStatus(orderId: string, status: Order['status']): Order[] {
  const list = getLocalOrders().map((o) =>
    o._id === orderId ? { ...o, status, updatedAt: new Date().toISOString() } : o
  )
  writeJSON(ORDERS_KEY, list)
  return list
}

export function deleteLocalOrder(orderId: string): Order[] {
  const list = getLocalOrders().filter(o => o._id !== orderId)
  writeJSON(ORDERS_KEY, list)
  return list
}

// ---------- 评价（本地持久化，无需登录，像视频评论区） ----------
export function getLocalReviews(productOrder: number | string): Review[] {
  const all = readJSON<Record<string, Review[]>>(REVIEWS_KEY, {})
  return cloneArray(all[String(productOrder)] || [])
}

export function addLocalReview(productOrder: number | string, review: Partial<Review>): Review {
  const all = readJSON<Record<string, Review[]>>(REVIEWS_KEY, {})
  const key = String(productOrder)
  if (!all[key]) all[key] = []
  const record = {
    productOrder: Number(productOrder),
    user: review.user || '匿名用户',
    rating: Math.max(1, Math.min(5, Number(review.rating) || 5)),
    text: String(review.text || '').slice(0, 500),
    images: Array.isArray(review.images)
      ? review.images.filter((x) => typeof x === 'string').slice(0, 5)
      : [],
    date: new Date().toISOString().slice(0, 10),
  }
  all[key].unshift(record)
  writeJSON(REVIEWS_KEY, all)
  return record
}
