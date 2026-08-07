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
  const { roomNumber, items } = payload
  if (!roomNumber || !items?.length) return { code: -1, message: '订单数据不完整' }

  // 优化：N+1 → 单次批量查询。原来在 for 循环里逐件串行 .doc(id).get()，
  // 一个 N 件商品的订单 = N 次串行 DB 往返；现在一次 .command.in(ids) 拉齐。
  const ids = items.map((it) => it.productId)
  const { data: products } = await db
    .collection('sm_products')
    .where({ _id: db.command.in(ids) })
    .field({ _id: true, name: true, spec: true, price: true, enabled: true })
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
    })
    total += (Number(p.price) || 0) * qty
  }
  const doc = {
    roomNumber: String(roomNumber).trim(),
    items: verified,
    totalAmount: Math.round(total * 100) / 100,
    status: 'pending',
    createdAt: now(),
    updatedAt: now(),
  }
  const res = await db.collection('sm_orders').add(doc)
  return { code: 0, data: { id: res.id || res._id, totalAmount: doc.totalAmount } }
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
    .field({ _id: true, user: true, rating: true, text: true, productOrder: true, createdAt: true })
    .get()
  return { code: 0, data: res.data }
}

async function createSubmissionHandler(db, payload) {
  const { serviceId, serviceName, categoryId, categoryName, formData, images } = payload
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

module.exports = {
  normalizeEvent,
  now,
  ensureCollection,
  createRateLimiter,
  getClientIp,
  createOrderHandler,
  getReviewsHandler,
  createSubmissionHandler,
}
