// Cloudflare Pages Functions 后端核心
// 对齐原 CloudBase 云函数 action 契约：POST { action, adminKey?, payload }
// 存储：D1 (env.DB)。数组/对象以 JSON 文本存储。
//
// 入口：functions/web.js（管理，需 ADMIN_KEY）、functions/pub.js（公开）

import {
  callDifyChat,
  callDifyCompletion,
  enabled,
  ruleAssistantReply,
  ruleAdvice,
  buildAdviceInput,
  sanitize,
  DIFY_UNAVAILABLE_TEXT,
} from './dify.js'

const PUBLIC_ACTIONS = new Set([
  'createOrder', 'getReviews', 'createSubmission', 'addPublicReview',
  'getPublicProducts', 'getPublicCategories', 'aiChat',
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

// 恒定时间字符串比较，防时序侧信道攻击（替代 adminKey !== env.ADMIN_KEY）。
// Workers 运行时无 node:crypto 的 timingSafeEqual，这里用 XOR 累加 + 定长循环实现；
// 长度不等时直接返回 false（与 timingSafeEqual 抛错行为不同，但避免泄露机密内容）。
function constantTimeEqual(a, b) {
  const sa = typeof a === 'string' ? a : ''
  const sb = typeof b === 'string' ? b : ''
  const ea = new TextEncoder().encode(sa)
  const eb = new TextEncoder().encode(sb)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

const PRODUCT_FIELDS = ['name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order', 'image', 'images', 'description', 'reviews']
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

// ---------- 限流（优先 Workers KV：跨实例、可故障转移，消除限流与业务共用 D1 的单点）----------
// RATE_KV 未绑定（本地 mock / 未配置）时回退 D1 rate_limits 表，保证契约与回滚兼容。
async function checkRateKV(kv, key, windowMs, max) {
  const t = Date.now()
  const raw = await kv.get(key)
  let rec = null
  if (raw) {
    try { rec = JSON.parse(raw) } catch { rec = null }
  }
  const valid = rec && typeof rec.count === 'number' && t <= rec.resetAt
  if (!valid) {
    await kv.put(key, JSON.stringify({ count: 1, resetAt: t + windowMs }), { expirationTtl: Math.ceil(windowMs / 1000) })
    return null
  }
  if (rec.count >= max) return { code: -1, message: '操作过于频繁，请稍后再试' }
  const ttl = Math.max(1, Math.ceil((rec.resetAt - t) / 1000))
  await kv.put(key, JSON.stringify({ count: rec.count + 1, resetAt: rec.resetAt }), { expirationTtl: ttl })
  return null
}

async function checkRateDB(DB, key, windowMs, max) {
  if (!DB) return null
  const t = Date.now()
  const row = await qFirst(DB, `SELECT count, resetAt FROM rate_limits WHERE bucket = ?`, [key])
  if (!row || t > row.resetAt) {
    await qRun(DB,
      `INSERT INTO rate_limits (bucket, count, resetAt) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, resetAt = excluded.resetAt`,
      [key, t + windowMs])
    return null
  }
  if (row.count >= max) return { code: -1, message: '操作过于频繁，请稍后再试' }
  await qRun(DB, `UPDATE rate_limits SET count = count + 1 WHERE bucket = ?`, [key])
  return null
}

async function checkRate(DB, kv, key, windowMs, max) {
  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
    try {
      return await checkRateKV(kv, key, windowMs, max)
    } catch (e) {
      // KV 限流失败（偶发瞬时异常）时优雅回退 D1，避免 1101 影响业务可用性
      console.error('[rate] KV 限流失败，回退 D1:', e)
      return checkRateDB(DB, key, windowMs, max)
    }
  }
  return checkRateDB(DB, key, windowMs, max)
}

const RATE_LOGIN = { windowMs: 60000, max: 5 }
const RATE_PUBLIC_WRITE = { windowMs: 60000, max: 20 }

// 提取真实客户端 IP：优先 CF-Connecting-IP（Cloudflare 注入，不可伪造），回退 x-forwarded-for
function getClientIp(request) {
  if (!request || !request.headers) return 'unknown'
  const cf = request.headers.get('CF-Connecting-IP')
  if (cf) return String(cf).slice(0, 64)
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return String(xff).split(',')[0].trim().slice(0, 64)
  return 'unknown'
}

// ---------- 安全工具 ----------

// 密钥指纹（SHA-256 前 8 位 hex，审计用；不落原始密钥）
async function sha256Fingerprint(s) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s || '')))
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8)
  } catch {
    return ''
  }
}

// 审计日志：管理写操作 / 认证失败落 security_events 表
async function logSecurityEvent(DB, { ip = '', action = '', result = '', keyFingerprint = '', detail = '' }) {
  if (!DB) return
  try {
    await qRun(DB,
      `INSERT INTO security_events (ts, ip, action, result, keyFingerprint, detail) VALUES (?, ?, ?, ?, ?, ?)`,
      [nowISO(), String(ip).slice(0, 64), String(action).slice(0, 64), String(result).slice(0, 16),
        String(keyFingerprint).slice(0, 16), String(detail).slice(0, 500)])
  } catch (e) {
    console.error('[audit] logSecurityEvent failed:', e)
  }
}

// 图片串 scheme 白名单：仅允许 data:image/(jpeg|png|webp|gif);base64 或 https 受信 URL。
// 阻止 javascript:/data:text/html 等注入向量（渲染侧未来改动也不会变成 XSS）。
function isSafeImageUrl(url) {
  if (typeof url !== 'string' || !url) return false
  if (/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)) return true
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !!u.hostname
  } catch {
    return false
  }
}

// 图片数组校验：返回过滤后数组；发现非法项返回 null（调用方拒绝，不静默丢弃）
function validateImages(images) {
  if (!Array.isArray(images)) return []
  const out = []
  for (const img of images) {
    if (typeof img !== 'string' || !isSafeImageUrl(img)) return null
    out.push(img)
  }
  return out
}

// 公开 UGC 内容校验：长度上限 + 基础注入关键词拦截
function checkPublicText(text, maxLen) {
  const s = String(text || '')
  if (s.length > maxLen) return false
  const low = s.toLowerCase()
  return !low.includes('<script') && !low.includes('javascript:') && !low.includes('onerror=') && !low.includes('onload=')
}

// ---------- 鉴权 ----------
// 双密钥：ADMIN_KEY=全权限；可选 ADMIN_READONLY_KEY=只读（未配置时行为与单密钥完全一致）。
function resolveRole(adminKey, env) {
  if (env.ADMIN_KEY && constantTimeEqual(adminKey, env.ADMIN_KEY)) return 'admin'
  if (env.ADMIN_READONLY_KEY && constantTimeEqual(adminKey, env.ADMIN_READONLY_KEY)) return 'readonly'
  return null
}

function checkAuth(action, adminKey, env) {
  if (PUBLIC_ACTIONS.has(action)) return null
  // 统一错误回显，不泄露"未配置 ADMIN_KEY"等部署态信息
  if (!resolveRole(adminKey, env)) return { code: -1, message: '认证失败' }
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
  // 付款截图 scheme 白名单：拒绝非 data:image / https 的注入向量
  if (typeof paymentScreenshot === 'string' && paymentScreenshot) {
    if (paymentScreenshot.length > 800 * 1024 || !isSafeImageUrl(paymentScreenshot))
      return { code: -1, message: '付款截图格式无效，请重新上传' }
  }
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
    // 数量必须为正整数：拦截负数/小数/缺失，防订单负金额或异常金额
    const qty = Number(item.quantity)
    if (!Number.isInteger(qty) || qty <= 0) return { code: -1, message: `商品数量无效: ${p.name}` }
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
  if (Array.isArray(clean.images) && clean.images.length > 3) return { code: -1, message: '最多上传 3 张图片' }
  // 图片 scheme 白名单：仅 data:image/(jpeg|png|webp|gif);base64 或 https
  const cleanImages = validateImages(clean.images)
  if (cleanImages === null) return { code: -1, message: '图片格式无效' }
  for (const img of cleanImages) {
    if (img.length > 800 * 1024) return { code: -1, message: '图片过大或格式无效' }
  }
  // UGC 内容校验：长度上限 + 基础黑名单拦截（纵深防御的一种；最终 HTML 注入防线依赖渲染端 React 转义）
  if (!checkPublicText(clean.text, 500)) return { code: -1, message: '评价内容无效' }
  const doc = {
    _id: genId('r_'), productOrder: Number(clean.productOrder),
    user: String(clean.user || '匿名用户').slice(0, 20),
    rating: Math.max(1, Math.min(5, Number(clean.rating) || 5)),
    text: String(clean.text || '').slice(0, 500), images: cleanImages, createdAt: nowISO(),
  }
  await insert(DB, 'reviews', doc)
  return { code: 0, data: { _id: doc._id, id: doc._id, ...doc } }
}

async function createSubmission(DB, payload) {
  const clean = pick(payload, SUBMISSION_FIELDS)
  if (!clean.serviceId || !clean.serviceName) return { code: -1, message: '缺少服务信息' }
  // 图片 scheme 白名单：仅 data:image/(jpeg|png|webp|gif);base64 或 https
  const cleanImages = validateImages(clean.images)
  if (cleanImages === null) return { code: -1, message: '图片格式无效' }
  for (const img of cleanImages) {
    if (img.length > 2 * 1024 * 1024) return { code: -1, message: '图片过大或格式无效' }
  }
  const safeForm = {}
  if (clean.formData && typeof clean.formData === 'object') {
    for (const [k, v] of Object.entries(clean.formData)) {
      const key = String(k).slice(0, 50)
      const val = String(v || '').slice(0, 200)
      if (!checkPublicText(val, 200)) return { code: -1, message: '表单内容无效' }
      safeForm[key] = val
    }
  }
  const doc = {
    _id: genId('s_'), serviceId: String(clean.serviceId).slice(0, 50),
    serviceName: String(clean.serviceName).slice(0, 50), categoryId: String(clean.categoryId || '').slice(0, 50),
    categoryName: String(clean.categoryName || '').slice(0, 50), formData: safeForm, images: cleanImages,
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
  // 图片 scheme 白名单（纵深防御，管理端同样收敛）
  if (data.image && !isSafeImageUrl(data.image)) return { code: -1, message: '商品主图格式无效' }
  if (Array.isArray(data.images)) {
    const imgOk = validateImages(data.images)
    if (imgOk === null) return { code: -1, message: '商品图片格式无效' }
    data.images = imgOk
  }
  const doc = { _id: genId('p_'), ...data, createdAt: nowISO(), updatedAt: nowISO() }
  await insert(DB, 'products', doc)
  return { code: 0, data: doc }
}

// 单商品更新核心逻辑（updateProduct 与 batchUpdateProducts 复用；字段白名单/图片 scheme/部分更新守卫统一在此）
async function applyProductUpdate(DB, productId, payload) {
  const data = pick(payload, PRODUCT_FIELDS)
  // enabled 守卫：仅当显式传了 enabled 才更新上架状态，防止部分更新时静默重上架缺货商品
  if ('enabled' in payload) data.enabled = payload.enabled !== false
  // 图片 scheme 白名单（纵深防御）
  if (data.image && !isSafeImageUrl(data.image)) return { code: -1, message: '商品主图格式无效' }
  if (Array.isArray(data.images)) {
    const imgOk = validateImages(data.images)
    if (imgOk === null) return { code: -1, message: '商品图片格式无效' }
    data.images = imgOk
  }
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

async function updateProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return { code: -1, message: '缺少 productId' }
  return applyProductUpdate(DB, productId, payload)
}

// 批量更新：items = [{ productId, updates }]，逐条应用（同一 updates 或多组均可）。
// 返回成功/失败明细而非整体回滚——批量场景部分失败可定位重试，避免并发 N 请求无明细。
async function batchUpdateProducts(DB, payload) {
  const { items } = payload
  if (!Array.isArray(items) || !items.length) return { code: -1, message: '缺少 items' }
  if (items.length > 200) return { code: -1, message: '单次批量最多 200 个商品' }
  const failed = []
  let updated = 0
  for (const it of items) {
    if (!it || !it.productId) { failed.push({ id: '?', message: '缺少 productId' }); continue }
    const r = await applyProductUpdate(DB, it.productId, it.updates || {})
    if (r.code === 0) updated++
    else failed.push({ id: it.productId, message: r.message })
  }
  return { code: 0, data: { updated, failed, total: items.length } }
}

// 批量删除：productIds 数组，返回成功/失败明细
async function batchDeleteProducts(DB, payload) {
  const { productIds } = payload
  if (!Array.isArray(productIds) || !productIds.length) return { code: -1, message: '缺少 productIds' }
  if (productIds.length > 200) return { code: -1, message: '单次批量最多 200 个商品' }
  const failed = []
  let deleted = 0
  for (const productId of productIds) {
    const res = await qRun(DB, `DELETE FROM products WHERE _id = ?`, [productId])
    if (res.meta?.changes) deleted++
    else failed.push({ id: productId, message: '商品不存在' })
  }
  return { code: 0, data: { deleted, failed, total: productIds.length } }
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
  const data = (hasMore ? rows.slice(0, pageSize) : rows)
    .map((r) => ({ ...r, items: jparse(r.items, []) }))
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

// 管理端写操作（审计日志覆盖范围）
const ADMIN_WRITE_ACTIONS = new Set([
  'createProduct', 'updateProduct', 'deleteProduct',
  'deleteOrder', 'updateOrderStatus',
  'deleteReview', 'updateSubmissionStatus', 'deleteSubmission',
])

// CORS 精准放行：仅允许白名单源（双前端部署 + 本地开发），不反射任意 Origin。
// 可经 env.ALLOWED_ORIGINS（逗号分隔）追加额外源。
const DEFAULT_ALLOWED_ORIGINS = [
  'https://supermarket-web.pages.dev',
  'https://lxh113377.github.io',
]
export function resolveCorsHeaders(request, env = {}) {
  const origin = request?.headers?.get?.('Origin') || ''
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])
  const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
  if (allowed.has(origin) || isLocalDev) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export async function handleAdmin(env, action, adminKey, payload = {}, request = null) {
  const DB = env.DB
  if (!DB) return { code: -1, message: '未配置 D1 数据库绑定' }
  const ip = getClientIp(request)
  // 登录限流必须在鉴权之前：无论密钥对错都计数，才能真正防暴力破解
  if (action === 'login') {
    const r = await checkRate(DB, env.RATE_KV, `rate:login:${ip}`, RATE_LOGIN.windowMs, RATE_LOGIN.max)
    if (r) return r
  }
  const authErr = checkAuth(action, adminKey, env)
  if (authErr) {
    // 认证失败审计（不落原始密钥，仅指纹）
    if (!PUBLIC_ACTIONS.has(action)) {
      await logSecurityEvent(DB, { ip, action, result: 'auth_failed', keyFingerprint: await sha256Fingerprint(adminKey) })
    }
    return authErr
  }
  // 权限细分：只读密钥禁止管理写操作
  const role = resolveRole(adminKey, env)
  if (role === 'readonly' && ADMIN_WRITE_ACTIONS.has(action)) {
    return { code: -1, message: '只读账号不能执行该操作' }
  }

  let result
  try {
    switch (action) {
      case 'login': {
        result = { code: 0, role }
        break
      }
      case 'verifyKey':
        result = { code: 0, role }
        break
      case 'getProducts': result = await getProducts(DB); break
      case 'createProduct': result = await createProduct(DB, payload); break
      case 'updateProduct': result = await updateProduct(DB, payload); break
      case 'deleteProduct': result = await deleteProduct(DB, payload); break
      case 'deleteOrder': result = await deleteOrder(DB, payload); break
      case 'updateOrderStatus': result = await updateOrderStatus(DB, payload); break
      case 'createOrder': result = await createOrder(DB, payload); break
      case 'recalculateOrders': result = await recalculateOrders(DB); break
      case 'getOrders': result = await getOrders(DB, payload); break
      case 'getOrder': result = { code: 0, data: await getOrderById(DB, payload.orderId) }; break
      case 'getPublicProducts': result = await getPublicProducts(DB); break
      case 'getPublicCategories': result = await getPublicCategories(DB); break
      case 'getAllReviews': result = await getAllReviews(DB); break
      case 'getReviews': result = await getReviews(DB, payload); break
      case 'addPublicReview': result = await addReview(DB, payload); break
      case 'addReview': {
        result = await addReview(DB, payload)
        if (result.code === 0 && result.data && result.data.id && !result.data._id) result.data._id = result.data.id
        break
      }
      case 'deleteReview': result = await deleteReview(DB, payload); break
      case 'seedReviews': result = await seedReviews(DB); break
      case 'createSubmission': result = await createSubmission(DB, payload); break
      case 'getSubmissions': result = await getSubmissions(DB); break
      case 'updateSubmissionStatus': result = await updateSubmissionStatus(DB, payload); break
      case 'deleteSubmission': result = await deleteSubmission(DB, payload); break
      default: result = { code: -1, message: '未知操作' }
    }
  } catch (e) {
    console.error('[admin]', action, e)
    result = { code: -1, message: '服务暂时不可用，请稍后重试' }
  }
  // 管理写操作 / 登录审计
  if (action === 'login' || ADMIN_WRITE_ACTIONS.has(action)) {
    await logSecurityEvent(DB, {
      ip, action, result: result.code === 0 ? 'ok' : 'fail', keyFingerprint: await sha256Fingerprint(adminKey),
    })
  }
  return result
}

export async function handlePublic(env, action, payload = {}, request = null) {
  const DB = env.DB
  if (!DB) return { code: -1, message: '未配置 D1 数据库绑定' }
  if (!PUBLIC_ACTIONS.has(action)) return { code: -1, message: '未知操作（public 仅支持公开接口）' }
  const ip = getClientIp(request)
  if (['createOrder', 'createSubmission', 'addPublicReview'].includes(action)) {
    const r = await checkRate(DB, env.RATE_KV, `rate:write:${ip}`, RATE_PUBLIC_WRITE.windowMs, RATE_PUBLIC_WRITE.max)
    if (r) return r
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

export { checkRate, checkRateKV, batchUpdateProducts, batchDeleteProducts }
