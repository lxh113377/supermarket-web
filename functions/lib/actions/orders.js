// 订单域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qFirst, qRun, jparse, nowISO, genId, insert } from '../db.js'
import { isSafeImageUrl } from '../security.js'

export async function createOrder(DB, payload) {
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

export async function deleteOrder(DB, payload) {
  const { orderId } = payload
  if (!orderId) return { code: -1, message: '缺少 orderId' }
  await qRun(DB, `DELETE FROM orders WHERE _id = ?`, [orderId])
  return { code: 0 }
}

// 订单履约状态机（2026-09-24 对标 litemall 订单域补齐）：
// pending(待支付) → paid(已支付) → delivering(配送中) → completed(已送达)，任意未完成态可 cancelled。
// status 列为 TEXT 无 CHECK 约束，扩态零迁移；迁移合法性在此处单点强制。
export const ORDER_TRANSITIONS = {
  pending: ['paid', 'cancelled'],
  paid: ['delivering', 'cancelled'],
  delivering: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['pending'],
}

export async function updateOrderStatus(DB, payload) {
  const { orderId, status } = payload
  if (!orderId || !Object.prototype.hasOwnProperty.call(ORDER_TRANSITIONS, status)) return { code: -1, message: '参数无效' }
  const cur = await qFirst(DB, `SELECT status FROM orders WHERE _id = ?`, [orderId])
  if (!cur) return { code: -1, message: '订单不存在' }
  if (!(ORDER_TRANSITIONS[cur.status] || []).includes(status))
    return { code: -1, message: `不允许的状态流转: ${cur.status} → ${status}` }
  const res = await qRun(DB, `UPDATE orders SET status = ?, updatedAt = ? WHERE _id = ?`, [status, nowISO(), orderId])
  if (!res.meta?.changes) return { code: -1, message: '订单不存在' }
  return { code: 0 }
}

// 顾客侧订单进度（公开只读）：仅回状态与更新时间，订单号即凭证（genId 时间戳+随机，不可枚举）
export async function getOrderStatus(DB, orderId) {
  if (!orderId || typeof orderId !== 'string') return { code: -1, message: '缺少订单号' }
  const row = await qFirst(DB, `SELECT status, updatedAt FROM orders WHERE _id = ?`, [orderId])
  if (!row) return { code: -1, message: '订单不存在' }
  return { code: 0, data: { orderId, status: row.status, updatedAt: row.updatedAt } }
}

// 2026-09-18 双向迭代 R6：修正写入由「逐条 UPDATE」改为「分批 CASE WHEN 批量 UPDATE」，
// 语句数从 O(需修正单数) 降为 O(页数 + ceil(需修正/50))——单批 50 条是参数上限与语句长度的折中
// （每条约 3 个参数：CASE 的 _id / totalAmount + WHERE 的 _id）。
const RECALC_CHUNK = 50

export async function recalculateOrders(DB) {
  const BATCH = 200
  let processed = 0, fixed = 0
  while (true) {
    const rows = await qAll(DB, `SELECT _id, items, totalAmount FROM orders ORDER BY _id ASC LIMIT ? OFFSET ?`, [BATCH, processed])
    if (!rows.length) break
    const pending = []
    for (const o of rows) {
      const items = jparse(o.items, [])
      const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0)
      const rounded = Math.round(total * 100) / 100
      if (o.totalAmount == null || Math.abs(Number(o.totalAmount) - rounded) > 0.01) {
        pending.push({ _id: o._id, total: rounded })
      }
    }
    for (let i = 0; i < pending.length; i += RECALC_CHUNK) {
      const chunk = pending.slice(i, i + RECALC_CHUNK)
      const now = nowISO()
      const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ')
      const inPh = chunk.map(() => '?').join(',')
      const params = []
      for (const p of chunk) params.push(p._id, p.total)
      params.push(now)
      params.push(...chunk.map((p) => p._id))
      await qRun(
        DB,
        `UPDATE orders SET totalAmount = CASE _id ${cases} ELSE totalAmount END, updatedAt = ? WHERE _id IN (${inPh})`,
        params,
      )
      fixed += chunk.length
    }
    processed += rows.length
    if (rows.length < BATCH) break
  }
  return { code: 0, data: { total: processed, fixed } }
}

export async function getOrders(DB, payload) {
  const page = Math.max(1, Number(payload.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(payload.pageSize) || 50))
  // 增量模式（管理端轮询）：since = ISO 时间串，只拉 updatedAt 大于该值的订单（含新建+状态变更），
  // 按 updatedAt ASC 排序保证游标单调推进；无 since 时维持原行为（createdAt DESC 分页）。
  const since = typeof payload.since === 'string' && payload.since ? payload.since : null
  const orderByCol = since ? 'updatedAt' : 'createdAt'
  const whereClause = since ? 'WHERE updatedAt > ?' : ''
  const params = since ? [since, pageSize + 1, (page - 1) * pageSize] : [pageSize + 1, (page - 1) * pageSize]
  const rows = await qAll(DB,
    `SELECT _id, roomNumber, items, totalAmount, status, createdAt, wechat, remark, updatedAt
     FROM orders ${whereClause} ORDER BY ${orderByCol} ${since ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`,
    params)
  const hasMore = rows.length > pageSize
  const data = (hasMore ? rows.slice(0, pageSize) : rows)
    .map((r) => ({ ...r, items: jparse(r.items, []) }))
  return { code: 0, data, hasMore, page, pageSize }
}

export async function getOrderById(DB, orderId) {
  const row = await qFirst(DB, `SELECT * FROM orders WHERE _id = ?`, [orderId])
  if (!row) return null
  return { ...row, items: jparse(row.items, []), paymentScreenshot: row.paymentScreenshot || '' }
}
