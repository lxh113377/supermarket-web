/**
 * 云函数公共模块 — admin-api 与 public-api 共享逻辑
 * 部署前通过 npm run predeploy 复制到各函数目录
 * 修改此文件后必须运行 npm run predeploy
 *
 * ⚠️ 漂移风险：admin-api/shared.js 和 public-api/shared.js 是本文件的副本。
 * 禁止直接编辑副本——只改本文件，然后跑 predeploy 同步。
 * 若副本与源不一致，部署后会出现 admin/public 行为分裂。
 */

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return {}
  if (raw.body !== undefined) {
    let b = raw.body
    if (typeof b === 'string') {
      try { b = JSON.parse(b) } catch { b = {} }
    }
    if (b && typeof b === 'object') return b
  }
  return raw
}

function now() {
  return new Date()
}

async function ensureCollection(db, name) {
  try {
    await db.createCollection(name)
  } catch (e) {
    if (!/exist/i.test(String(e?.message || e))) throw e
  }
}

// --- 频率限制 ---
function createRateLimiter(windowMs, maxAttempts, message) {
  const attempts = new Map()
  return function checkRateLimit(ip) {
    const t = Date.now()
    const record = attempts.get(ip)
    if (!record || t > record.resetAt) {
      attempts.set(ip, { count: 1, resetAt: t + windowMs })
      return null
    }
    record.count++
    if (record.count > maxAttempts) {
      return { code: -1, message }
    }
    return null
  }
}

function getClientIp(context, event) {
  return (context && context.source_ip) ||
    (event && event.requestContext && event.requestContext.sourceIp) ||
    'unknown'
}

// --- 共享业务逻辑 ---

async function createOrderHandler(db, payload) {
  const { roomNumber, items, wechat, remark, paymentScreenshot } = payload
  if (!roomNumber || !items?.length) return { code: -1, message: '订单数据不完整' }
  if (typeof paymentScreenshot === 'string' && paymentScreenshot.length > 800 * 1024) {
    return { code: -1, message: '付款截图过大，请重新上传' }
  }

  // 优化：N+1 → 单次批量查询。原来在 for 循环里逐件串行 .doc(id).get()，
  // 一个 N 件商品的订单 = N 次串行 DB 往返；现在一次 .command.in(ids) 拉齐。
  const ids = items.map((it) => it.productId)
  const { data: products } = await db
    .collection('sm_products')
    .where({ _id: db.command.in(ids) })
    .field({ _id: true, name: true, spec: true, price: true, enabled: true, subcategories: true })
    .get()
  const byId = new Map(products.map((p) => [p._id, p]))

  let total = 0
  const verified = []
  for (const item of items) {
    const p = byId.get(item.productId)
    if (!p) return { code: -1, message: `商品不存在: ${item.productId}` }
    if (p.enabled === false) return { code: -1, message: `商品已下架: ${p.name}` }
    const qty = Number(item.quantity) || 0
    verified.push({
      productId: p._id,
      name: p.name,
      spec: p.spec || '',
      price: Number(p.price) || 0,
      quantity: qty,
      // 看板分类占比依赖商品子分类，订单 items 冗余存储一份
      subcategories: p.subcategories || [],
    })
    total += (Number(p.price) || 0) * qty
  }
  const doc = {
    roomNumber: String(roomNumber).trim(),
    items: verified,
    wechat: String(wechat || '').slice(0, 50),
    remark: String(remark || '').slice(0, 200),
    paymentScreenshot: typeof paymentScreenshot === 'string' ? paymentScreenshot : '',
    totalAmount: Math.round(total * 100) / 100,
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
  }
  // 防御性白名单：订单文档只落白名单字段，杜绝任何意外字段入库（双保险，doc 本就只含这些）
  const stored = pickFields(doc, ORDER_FIELDS)
  const res = await db.collection('sm_orders').add(stored)
  return { code: 0, data: { id: res.id || res._id, totalAmount: stored.totalAmount } }
}

async function getReviewsHandler(db, payload) {
  const { productOrder } = payload
  if (productOrder == null) return { code: -1, message: '缺少 productOrder' }
  await ensureCollection(db, 'sm_reviews')
  const res = await db
    .collection('sm_reviews')
    .where({ productOrder: Number(productOrder) })
    .orderBy('createdAt', 'desc')
    .limit(500)
    .field({ _id: true, user: true, rating: true, text: true, productOrder: true, createdAt: true, images: true })
    .get()
  return { code: 0, data: res.data }
}

async function addReviewHandler(db, payload) {
  // 白名单收敛输入：只取允许字段，丢弃注入的 _id/status/role 等
  const { productOrder, user, rating, text, images } = pickFields(payload, REVIEW_FIELDS)
  if (productOrder == null) return { code: -1, message: '缺少 productOrder' }
  if (Array.isArray(images) && images.length > 5) return { code: -1, message: '最多上传 5 张图片' }
  const safeImages = Array.isArray(images) ? images.slice(0, 5) : []
  for (const img of safeImages) {
    if (typeof img !== 'string' || img.length > 2 * 1024 * 1024) {
      return { code: -1, message: '图片过大或格式无效' }
    }
  }
  await ensureCollection(db, 'sm_reviews')
  const doc = {
    productOrder: Number(productOrder),
    user: String(user || '匿名用户').slice(0, 20),
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    text: String(text || '').slice(0, 500),
    images: safeImages,
    createdAt: now(),
  }
  const res = await db.collection('sm_reviews').add(doc)
  // 同时返回 id 与 _id：前端统一用 _id 作删除/更新 key（管理端与顾客端同源修复）
  return { code: 0, data: { _id: res.id || res._id, id: res.id || res._id, ...doc } }
}

async function createSubmissionHandler(db, payload) {
  // 防御性白名单：只取白名单顶层字段，丢弃注入的 _id/status/role 等
  const { serviceId, serviceName, categoryId, categoryName, formData, images } = pickFields(payload, SUBMISSION_FIELDS)
  if (!serviceId || !serviceName) return { code: -1, message: '缺少服务信息' }
  const safeImages = Array.isArray(images) ? images.slice(0, 5) : []
  for (const img of safeImages) {
    if (typeof img !== 'string' || img.length > 2 * 1024 * 1024) {
      return { code: -1, message: '图片过大或格式无效' }
    }
  }
  const safeForm = {}
  if (formData && typeof formData === 'object') {
    for (const [k, v] of Object.entries(formData)) {
      safeForm[String(k).slice(0, 50)] = String(v || '').slice(0, 200)
    }
  }
  await ensureCollection(db, 'sm_submissions')
  const doc = {
    serviceId: String(serviceId).slice(0, 50),
    serviceName: String(serviceName).slice(0, 50),
    categoryId: String(categoryId || '').slice(0, 50),
    categoryName: String(categoryName || '').slice(0, 50),
    formData: safeForm,
    images: safeImages,
    status: 'pending',
    createdAt: now(),
  }
  const res = await db.collection('sm_submissions').add(doc)
  return { code: 0, data: { id: res.id || res._id } }
}

// --- 商品字段白名单（单源）---
// 管理端 createProduct/updateProduct 只接受白名单字段，防客户端注入 _id/totalAmount/role 等。
// 此处为唯一来源，predeploy 同步到 admin-api/shared.js 与 public-api/shared.js。
const PRODUCT_FIELDS = [
  'name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order',
  'image', 'images', 'description', 'reviews',
]

function pickFields(data, allowed) {
  const out = {}
  for (const k of allowed) {
    if (k in data) out[k] = data[k]
  }
  return out
}

// 各写实体字段白名单（单源，与 PRODUCT_FIELDS 同范式）
// 订单文档由服务端全量重建，这里再白名单收敛一次，防未来代码误把客户端字段直接入库
const ORDER_FIELDS = [
  'roomNumber', 'items', 'totalAmount', 'status', 'createdAt', 'updatedAt',
  'wechat', 'remark', 'paymentScreenshot',
]
// 评价只接受这些字段，其余（如 _id/status/role）一律丢弃
const REVIEW_FIELDS = ['productOrder', 'user', 'rating', 'text', 'images']
// 服务提交只接受这六项顶层字段，动态表单内容在 formData 内单独截断
const SUBMISSION_FIELDS = ['serviceId', 'serviceName', 'categoryId', 'categoryName', 'formData', 'images']

module.exports = {
  normalizeEvent,
  now,
  ensureCollection,
  createRateLimiter,
  getClientIp,
  createOrderHandler,
  getReviewsHandler,
  addReviewHandler,
  createSubmissionHandler,
  pickFields,
  PRODUCT_FIELDS,
  ORDER_FIELDS,
  REVIEW_FIELDS,
  SUBMISSION_FIELDS,
}
