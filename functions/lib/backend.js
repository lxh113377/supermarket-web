// Cloudflare Pages Functions 后端核心
// 对齐原 CloudBase 云函数 action 契约：POST { action, adminKey?, payload }
// 存储：D1 (env.DB)。数组/对象以 JSON 文本存储。
//
// 入口：functions/web.js（管理，需 ADMIN_KEY）、functions/pub.js（公开）

const PUBLIC_ACTIONS = new Set([
  'createOrder', 'getReviews', 'createSubmission', 'addPublicReview',
  'getPublicProducts', 'getPublicCategories',
])

// ---------- D1 帮助函数 ----------
async function qAll(DB, sql, params = []) {
  const r = await DB.prepare(sql).bind(...params).all()
  return r.results || []
}
async function qFirst(DB, sql, params = []) {
  return await DB.prepare(sql).bind(...params).first()
}
async function qRun(DB, sql, params = []) {
  return await DB.prepare(sql).bind(...params).run()
}

function jparse(v, fallback) {
  if (v == null) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}

function rowToProduct(row) {
  if (!row) return null
  return {
    _id: row._id,
    name: row.name,
    spec: row.spec || '',
    price: Number(row.price) || 0,
    costPrice: Number(row.costPrice) || 0,
    subcategories: jparse(row.subcategories, []),
    enabled: row.enabled === 1 || row.enabled === true,
    order: Number(row.order) || 0,
    image: row.image || '',
    images: jparse(row.images, []),
    description: row.description || '',
    reviews: jparse(row.reviews, []),
  }
}

function rowToCategory(row) {
  if (!row) return null
  return {
    _id: row._id,
    name: row.name,
    type: row.type || '',
    order: Number(row.order) || 0,
    subcategories: jparse(row.subcategories, []),
  }
}

function nowISO() { return new Date().toISOString() }

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 仅保留白名单字段，防注入；JSON 字段序列化
function pick(input, allowed) {
  const out = {}
  for (const k of allowed) if (k in input) out[k] = input[k]
  return out
}

const PRODUCT_FIELDS = ['name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order', 'image', 'images', 'description', 'reviews']
const ORDER_FIELDS = ['roomNumber', 'items', 'totalAmount', 'status', 'createdAt', 'updatedAt', 'wechat', 'remark', 'paymentScreenshot']
const REVIEW_FIELDS = ['productOrder', 'user', 'rating', 'text', 'images']
const SUBMISSION_FIELDS = ['serviceId', 'serviceName', 'categoryId', 'categoryName', 'formData', 'images']

// 通用插入：按白名单构建列，JSON 字段序列化
async function insert(DB, table, doc) {
  const cols = Object.keys(doc)
  const quoted = cols.map((c) => `"${c}"`).join(', ')
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map((c) => {
    const v = doc[c]
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
    return v
  })
  await qRun(DB, `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`, values)
  return doc._id
}

// ---------- 限流（内存级，实例级有效）----------
function createRateLimiter(windowMs, max) {
  const attempts = new Map()
  return function check(ip) {
    const t = Date.now()
    const rec = attempts.get(ip)
    if (!rec || t > rec.resetAt) { attempts.set(ip, { count: 1, resetAt: t + windowMs }); return null }
    rec.count++
    if (rec.count > max) return { code: -1, message: '操作过于频繁，请稍后再试' }
    return null
  }
}
const rateLogin = createRateLimiter(60000, 5)
const ratePublicWrite = createRateLimiter(60000, 20)
const rateAuthFail = createRateLimiter(60000, 5)

// ---------- 鉴权 ----------
function checkAuth(action, adminKey, env) {
  if (PUBLIC_ACTIONS.has(action)) return null
  if (!env.ADMIN_KEY) return { code: -1, message: '服务未配置 ADMIN_KEY' }
  if (adminKey !== env.ADMIN_KEY) return { code: -1, message: '密钥错误' }
  return null
}

// ================= 公开 + 管理共用 handlers =================

async function getPublicProducts(DB) {
  const rows = await qAll(DB,
    `SELECT _id, name, spec, price, image, "order", subcategories, enabled, description
     FROM products WHERE enabled = 1 ORDER BY "order" ASC LIMIT 1000`)
  return { code: 0, data: rows.map(rowToProduct) }
}

async function getPublicCategories(DB) {
  const rows = await qAll(DB, `SELECT _id, name, type, "order", subcategories FROM categories ORDER BY "order" ASC LIMIT 200`)
  return { code: 0, data: rows.map(rowToCategory) }
}

async function createOrder(DB, payload) {
  const { roomNumber, items, wechat, remark, paymentScreenshot } = payload
  if (!roomNumber || !Array.isArray(items) || !items.length) return { code: -1, message: '订单数据不完整' }
  if (typeof paymentScreenshot === 'string' && paymentScreenshot.length > 800 * 1024)
    return { code: -1, message: '付款截图过大，请重新上传' }
  const ids = items.map((it) => it.productId)
  const rows = await qAll(DB,
    `SELECT _id, name, spec, price, enabled, subcategories FROM products WHERE _id IN (${ids.map(() => '?').join(',')})`,
    ids)
  const byId = new Map(rows.map((p) => [p._id, p]))
  let total = 0
  const verified = []
  for (const item of items) {
    const p = byId.get(item.productId)
    if (!p) return { code: -1, message: `商品不存在: ${item.productId}` }
    if (p.enabled === 0 || p.enabled === false) return { code: -1, message: `商品已下架: ${p.name}` }
    const qty = Number(item.quantity) || 0
    verified.push({
      productId: p._id, name: p.name, spec: p.spec || '',
      price: Number(p.price) || 0, quantity: qty, subcategories: jparse(p.subcategories, []),
    })
    total += (Number(p.price) || 0) * qty
  }
  const ts = nowISO()
  const doc = {
    _id: genId('o_'), roomNumber: String(roomNumber).trim(), items: verified,
    wechat: String(wechat || '').slice(0, 50), remark: String(remark || '').slice(0, 200),
    paymentScreenshot: typeof paymentScreenshot === 'string' ? paymentScreenshot : '',
    totalAmount: Math.round(total * 100) / 100, status: 'pending', createdAt: ts, updatedAt: ts,
  }
  await insert(DB, 'orders', doc)
  return { code: 0, data: { id: doc._id, totalAmount: doc.totalAmount } }
}

async function getReviews(DB, payload) {
  const { productOrder } = payload
  if (productOrder == null) return { code: -1, message: '缺少 productOrder' }
  const rows = await qAll(DB,
    `SELECT _id, "user", rating, text, productOrder, createdAt, images
     FROM reviews WHERE productOrder = ? ORDER BY createdAt DESC LIMIT 500`,
    [Number(productOrder)])
  return { code: 0, data: rows.map((r) => ({ ...r, images: jparse(r.images, []) })) }
}

async function addReview(DB, payload) {
  const clean = pick(payload, REVIEW_FIELDS)
  if (clean.productOrder == null) return { code: -1, message: '缺少 productOrder' }
  if (Array.isArray(clean.images) && clean.images.length > 5) return { code: -1, message: '最多上传 5 张图片' }
  const safeImages = Array.isArray(clean.images) ? clean.images.slice(0, 5) : []
  for (const img of safeImages) {
    if (typeof img !== 'string' || img.length > 2 * 1024 * 1024) return { code: -1, message: '图片过大或格式无效' }
  }
  const doc = {
    _id: genId('r_'), productOrder: Number(clean.productOrder),
    user: String(clean.user || '匿名用户').slice(0, 20),
    rating: Math.max(1, Math.min(5, Number(clean.rating) || 5)),
    text: String(clean.text || '').slice(0, 500), images: safeImages, createdAt: nowISO(),
  }
  await insert(DB, 'reviews', doc)
  return { code: 0, data: { _id: doc._id, id: doc._id, ...doc } }
}

async function createSubmission(DB, payload) {
  const clean = pick(payload, SUBMISSION_FIELDS)
  if (!clean.serviceId || !clean.serviceName) return { code: -1, message: '缺少服务信息' }
  const safeImages = Array.isArray(clean.images) ? clean.images.slice(0, 5) : []
  for (const img of safeImages) {
    if (typeof img !== 'string' || img.length > 2 * 1024 * 1024) return { code: -1, message: '图片过大或格式无效' }
  }
  const safeForm = {}
  if (clean.formData && typeof clean.formData === 'object') {
    for (const [k, v] of Object.entries(clean.formData)) safeForm[String(k).slice(0, 50)] = String(v || '').slice(0, 200)
  }
  const doc = {
    _id: genId('s_'), serviceId: String(clean.serviceId).slice(0, 50),
    serviceName: String(clean.serviceName).slice(0, 50), categoryId: String(clean.categoryId || '').slice(0, 50),
    categoryName: String(clean.categoryName || '').slice(0, 50), formData: safeForm, images: safeImages,
    status: 'pending', createdAt: nowISO(),
  }
  await insert(DB, 'submissions', doc)
  return { code: 0, data: { id: doc._id } }
}

// ================= 管理 handlers =================

async function getProducts(DB) {
  const rows = await qAll(DB, `SELECT * FROM products ORDER BY "order" ASC LIMIT 1000`)
  return { code: 0, data: rows.map(rowToProduct) }
}

async function createProduct(DB, payload) {
  const data = pick(payload, PRODUCT_FIELDS)
  data.enabled = data.enabled !== false
  const doc = { _id: genId('p_'), ...data, createdAt: nowISO(), updatedAt: nowISO() }
  await insert(DB, 'products', doc)
  return { code: 0, data: doc }
}

async function updateProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return { code: -1, message: '缺少 productId' }
  const data = pick(payload, PRODUCT_FIELDS)
  data.updatedAt = nowISO()
  const cols = Object.keys(data)
  if (!cols.length) return { code: -1, message: '无更新字段' }
  const setClause = cols.map((c) => `"${c}" = ?`).join(', ')
  const values = cols.map((c) => {
    const v = data[c]
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
    return v
  })
  const res = await qRun(DB, `UPDATE products SET ${setClause} WHERE _id = ?`, [...values, productId])
  if (!res.meta?.changes) return { code: -1, message: '商品不存在' }
  return { code: 0 }
}

async function deleteProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return { code: -1, message: '缺少 productId' }
  await qRun(DB, `DELETE FROM products WHERE _id = ?`, [productId])
  return { code: 0 }
}

async function deleteOrder(DB, payload) {
  const { orderId } = payload
  if (!orderId) return { code: -1, message: '缺少 orderId' }
  await qRun(DB, `DELETE FROM orders WHERE _id = ?`, [orderId])
  return { code: 0 }
}

async function updateOrderStatus(DB, payload) {
  const { orderId, status } = payload
  if (!orderId || !['pending', 'paid', 'cancelled'].includes(status)) return { code: -1, message: '参数无效' }
  const res = await qRun(DB, `UPDATE orders SET status = ?, updatedAt = ? WHERE _id = ?`, [status, nowISO(), orderId])
  if (!res.meta?.changes) return { code: -1, message: '订单不存在' }
  return { code: 0 }
}

async function recalculateOrders(DB) {
  const BATCH = 200
  let processed = 0, fixed = 0
  while (true) {
    const rows = await qAll(DB, `SELECT _id, items, totalAmount FROM orders ORDER BY _id ASC LIMIT ? OFFSET ?`, [BATCH, processed])
    if (!rows.length) break
    for (const o of rows) {
      const items = jparse(o.items, [])
      const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0)
      const rounded = Math.round(total * 100) / 100
      if (o.totalAmount == null || Math.abs(Number(o.totalAmount) - rounded) > 0.01) {
        await qRun(DB, `UPDATE orders SET totalAmount = ?, updatedAt = ? WHERE _id = ?`, [rounded, nowISO(), o._id])
        fixed++
      }
    }
    processed += rows.length
    if (rows.length < BATCH) break
  }
  return { code: 0, data: { total: processed, fixed } }
}

async function getOrders(DB, payload) {
  const page = Math.max(1, Number(payload.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize) || 50))
  const rows = await qAll(DB,
    `SELECT _id, roomNumber, items, totalAmount, status, createdAt, wechat, remark, updatedAt
     FROM orders ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [pageSize + 1, (page - 1) * pageSize])
  const hasMore = rows.length > pageSize
  const data = hasMore ? rows.slice(0, pageSize) : rows
  return { code: 0, data, hasMore, page, pageSize }
}

async function getOrderById(DB, orderId) {
  const row = await qFirst(DB, `SELECT * FROM orders WHERE _id = ?`, [orderId])
  if (!row) return null
  return { ...row, items: jparse(row.items, []), paymentScreenshot: row.paymentScreenshot || '' }
}

async function getAllReviews(DB) {
  const rows = await qAll(DB,
    `SELECT _id, "user", rating, text, productOrder, createdAt FROM reviews ORDER BY createdAt DESC LIMIT 1000`)
  return { code: 0, data: rows }
}

async function deleteReview(DB, payload) {
  const { reviewId } = payload
  if (!reviewId) return { code: -1, message: '缺少 reviewId' }
  await qRun(DB, `DELETE FROM reviews WHERE _id = ?`, [reviewId])
  return { code: 0 }
}

async function seedReviews(DB) {
  const count = await qFirst(DB, `SELECT COUNT(*) AS c FROM reviews`)
  if (count && count.c > 0) return { code: 0, data: { added: 0, skipped: true } }
  const SEED = [
    { productOrder: 1, user: '小明', rating: 5, text: '冰糖雪梨yyds，冰一下更好喝！' },
    { productOrder: 1, user: '阿杰', rating: 4, text: '甜度刚好，1L够喝一天' },
    { productOrder: 5, user: '茶茶', rating: 5, text: '康师傅绿茶永远的神，回购无数次' },
    { productOrder: 6, user: '路人甲', rating: 4, text: '冰红茶配泡面绝了' },
    { productOrder: 8, user: '养生青年', rating: 5, text: '东方树叶青柑普洱，无糖茶天花板' },
    { productOrder: 8, user: '打工人', rating: 4, text: '解腻神器，吃完食堂来一瓶' },
    { productOrder: 14, user: 'VC达人', rating: 5, text: '水溶C100酸酸甜甜，补充维C' },
    { productOrder: 16, user: '熬夜选手', rating: 5, text: '东鹏特饮期末周救命水' },
    { productOrder: 16, user: '考研人', rating: 4, text: '便宜大碗，提神效果不错' },
    { productOrder: 18, user: '健身哥', rating: 4, text: '500ml大瓶划算，运动前来一瓶' },
    { productOrder: 22, user: '可乐党', rating: 5, text: '冰可乐夏天必备，快乐水！' },
    { productOrder: 22, user: '宅男', rating: 5, text: '罐装就是比瓶装好喝，不接受反驳' },
    { productOrder: 24, user: '跑步人', rating: 5, text: '农夫山泉有点甜，1.5L运动够用' },
    { productOrder: 32, user: '吃货', rating: 5, text: '士力架横扫饥饿，下午续命必备' },
    { productOrder: 33, user: '薯片爱好者', rating: 4, text: '乐事原味永远经典，40g刚好不怕胖' },
    { productOrder: 38, user: '辣条王', rating: 5, text: '卫龙大面筋辣条yyds！' },
    { productOrder: 46, user: '深夜食堂', rating: 5, text: '白象方便面加个卤蛋，宵夜天花板' },
    { productOrder: 46, user: '省钱达人', rating: 4, text: '十三香味道不错，比食堂便宜多了' },
    { productOrder: 48, user: '早餐人', rating: 4, text: '乡巴佬卤蛋配泡面，简单但满足' },
    { productOrder: 49, user: '火腿肠粉丝', rating: 4, text: '双汇火腿肠烤一下更香' },
  ]
  for (const s of SEED) {
    await insert(DB, 'reviews', { _id: genId('r_'), productOrder: Number(s.productOrder), user: s.user, rating: s.rating, text: s.text, images: [], createdAt: nowISO() })
  }
  return { code: 0, data: { added: SEED.length } }
}

async function getSubmissions(DB) {
  const rows = await qAll(DB, `SELECT * FROM submissions ORDER BY createdAt DESC LIMIT 500`)
  return { code: 0, data: rows.map((r) => ({ ...r, formData: jparse(r.formData, {}), images: jparse(r.images, []) })) }
}

async function updateSubmissionStatus(DB, payload) {
  const { submissionId, status } = payload
  if (!submissionId) return { code: -1, message: '缺少 submissionId' }
  const res = await qRun(DB, `UPDATE submissions SET status = ?, updatedAt = ? WHERE _id = ?`, [status || 'done', nowISO(), submissionId])
  if (!res.meta?.changes) return { code: -1, message: '提交不存在' }
  return { code: 0 }
}

async function deleteSubmission(DB, payload) {
  const { submissionId } = payload
  if (!submissionId) return { code: -1, message: '缺少 submissionId' }
  await qRun(DB, `DELETE FROM submissions WHERE _id = ?`, [submissionId])
  return { code: 0 }
}

// ================= 调度 =================

export async function handleAdmin(env, action, adminKey, payload = {}) {
  const DB = env.DB
  if (!DB) return { code: -1, message: '未配置 D1 数据库绑定' }
  const authErr = checkAuth(action, adminKey, env)
  if (authErr) return authErr

  const ip = 'unknown'
  try {
    switch (action) {
      case 'login': {
        const r = rateLogin(ip); if (r) return r
        if (adminKey !== env.ADMIN_KEY) return { code: -1, message: '密钥错误' }
        return { code: 0 }
      }
      case 'verifyKey':
        return { code: 0 }
      case 'getProducts': return await getProducts(DB)
      case 'createProduct': return await createProduct(DB, payload)
      case 'updateProduct': return await updateProduct(DB, payload)
      case 'deleteProduct': return await deleteProduct(DB, payload)
      case 'deleteOrder': return await deleteOrder(DB, payload)
      case 'updateOrderStatus': return await updateOrderStatus(DB, payload)
      case 'createOrder': return await createOrder(DB, payload)
      case 'recalculateOrders': return await recalculateOrders(DB)
      case 'getOrders': return await getOrders(DB, payload)
      case 'getOrder': return { code: 0, data: await getOrderById(DB, payload.orderId) }
      case 'getPublicProducts': return await getPublicProducts(DB)
      case 'getPublicCategories': return await getPublicCategories(DB)
      case 'getAllReviews': return await getAllReviews(DB)
      case 'getReviews': return await getReviews(DB, payload)
      case 'addPublicReview': return await addReview(DB, payload)
      case 'addReview': {
        const r = await addReview(DB, payload)
        if (r.code === 0 && r.data && r.data.id && !r.data._id) r.data._id = r.data.id
        return r
      }
      case 'deleteReview': return await deleteReview(DB, payload)
      case 'seedReviews': return await seedReviews(DB)
      case 'createSubmission': return await createSubmission(DB, payload)
      case 'getSubmissions': return await getSubmissions(DB)
      case 'updateSubmissionStatus': return await updateSubmissionStatus(DB, payload)
      case 'deleteSubmission': return await deleteSubmission(DB, payload)
      default: return { code: -1, message: '未知操作' }
    }
  } catch (e) {
    console.error('[admin]', action, e)
    return { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
}

export async function handlePublic(env, action, payload = {}) {
  const DB = env.DB
  if (!DB) return { code: -1, message: '未配置 D1 数据库绑定' }
  if (!PUBLIC_ACTIONS.has(action)) return { code: -1, message: '未知操作（public 仅支持公开接口）' }
  const ip = 'unknown'
  if (['createOrder', 'createSubmission', 'addPublicReview'].includes(action)) {
    const r = ratePublicWrite(ip); if (r) return r
  }
  try {
    switch (action) {
      case 'getPublicProducts': return await getPublicProducts(DB)
      case 'getPublicCategories': return await getPublicCategories(DB)
      case 'createOrder': return await createOrder(DB, payload)
      case 'getReviews': return await getReviews(DB, payload)
      case 'addPublicReview': return await addReview(DB, payload)
      case 'createSubmission': return await createSubmission(DB, payload)
      default: return { code: -1, message: '未知操作' }
    }
  } catch (e) {
    console.error('[pub]', action, e)
    return { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
}
