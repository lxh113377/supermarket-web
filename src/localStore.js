// 本地模式数据层：无 CloudBase 凭证时使用，数据存于 localStorage。
// 商品 = 种子数据 + 本地覆盖（改价/上下架/新增/删除）；订单同样本地持久化。
import { categories as seedCategories, products as seedProducts } from './data/products-seed.js'

const PRODUCTS_KEY = 'sm_products_local'
const ORDERS_KEY = 'sm_orders_local'
const REVIEWS_KEY = 'sm_reviews_local'

// 为种子商品补全 _id（云端模式下 _id 由数据库提供，本地模式需稳定唯一标识）
function seedToLocal() {
  return seedProducts.map((p) => ({
    _id: 'p_' + p.order,
    name: p.name,
    spec: p.spec || '',
    price: p.price,
    subcategories: p.subcategories || [],
    enabled: true,
    order: p.order,
  }))
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed == null ? fallback : parsed
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('localStore write failed:', e)
  }
}

export function getLocalCategories() {
  return seedCategories
}

export function getLocalProducts() {
  let list = readJSON(PRODUCTS_KEY, null)
  if (!Array.isArray(list) || list.length === 0) {
    list = seedToLocal()
    writeJSON(PRODUCTS_KEY, list)
  }
  return list
}

export function saveLocalProducts(list) {
  writeJSON(PRODUCTS_KEY, list)
}

export function upsertLocalProduct(product) {
  const list = getLocalProducts()
  const idx = list.findIndex((p) => p._id === product._id)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...product }
  } else {
    list.push(product)
  }
  saveLocalProducts(list)
  return list
}

export function deleteLocalProduct(productId) {
  const list = getLocalProducts().filter((p) => p._id !== productId)
  saveLocalProducts(list)
  return list
}

export function getLocalOrders() {
  return readJSON(ORDERS_KEY, [])
}

export function addLocalOrder(order) {
  const list = getLocalOrders()
  const totalAmount = (order.items || []).reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0,
  )
  const record = {
    _id: 'o_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...order,
    totalAmount: Math.round(totalAmount * 100) / 100,
  }
  list.unshift(record)
  writeJSON(ORDERS_KEY, list)
  return record
}

export function updateLocalOrderStatus(orderId, status) {
  const list = getLocalOrders().map((o) =>
    o._id === orderId ? { ...o, status, updatedAt: new Date().toISOString() } : o
  )
  writeJSON(ORDERS_KEY, list)
  return list
}

export function deleteLocalOrder(orderId) {
  const list = getLocalOrders().filter(o => o._id !== orderId)
  writeJSON(ORDERS_KEY, list)
  return list
}

// ---------- 评价（本地持久化，无需登录，像视频评论区） ----------
export function getLocalReviews(productOrder) {
  const all = readJSON(REVIEWS_KEY, {})
  return all[productOrder] || []
}

export function addLocalReview(productOrder, review) {
  const all = readJSON(REVIEWS_KEY, {})
  if (!all[productOrder]) all[productOrder] = []
  const record = {
    user: review.user || '匿名用户',
    rating: Math.max(1, Math.min(5, Number(review.rating) || 5)),
    text: String(review.text || '').slice(0, 500),
    date: new Date().toISOString().slice(0, 10),
  }
  all[productOrder].unshift(record)
  writeJSON(REVIEWS_KEY, all)
  return record
}
