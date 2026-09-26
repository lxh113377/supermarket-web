// 订单域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qFirst, qRun, jparse, nowISO, genId, insert } from '../db.js'
import { isSafeImageUrl } from '../security.js'

// ── 下单幂等（2026-09-24 对标第二轮 A1）──
// 对标：Medusa HTTP 层 `Idempotency-Key` + 表内 UNIQUE(index, key)；litemall cart_checkout 唯一索引
//       + @DistributedLock 双层。本项目取同构的两层：
//   ① 带 requestId 的新客户端：服务端把 `房间号@requestId` 存进 idempotencyKey，
//      由**部分唯一索引**在 DB 层兜住并发（唯一约束是最后防线，不靠应用层判断）。
//   ② 不带 requestId 的调用方（顾客端 Service Worker 长缓存，新版 bundle 铺开前旧包仍在下单；
//      以及直接 POST /pub 的集成方）：90s 内容指纹兜底，只对**完全相同**的载荷去重。
// 有 requestId 时**不**走 ②：换了 key 就是有意下新单，指纹会把合法的第二单吞掉。
export const DEDUPE_WINDOW_MS = 90 * 1000

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// 键 = 房间号@requestId#载荷指纹。折叠指纹是刻意偏离 Medusa/Saleor 的地方：
// 纯键语义下"改过内容再用旧键提交"会静默返回旧单、丢掉这次编辑；
// 本项目顾客端要经 Service Worker 长缓存铺开，必须假设存在不守键约定的调用方。
export function idempotencyKey(roomNumber, requestId, fingerprint) {
  if (typeof requestId !== 'string') return null
  const req = requestId.trim().replace(/[^\w:.-]/g, '').slice(0, 64)
  if (!req) return null
  return `${String(roomNumber).trim().slice(0, 40)}@${req}#${fnv1a(fingerprint)}`
}

// 内容指纹：只取"用户改一下就变成另一单"的字段，忽略服务端生成的 id/时间戳
export function orderFingerprint({ roomNumber, wechat, remark, totalAmount, items, paymentScreenshot }) {
  // 口味折在 items[].spec 里，必须参与指纹：否则同房间 90s 内「黄瓜味改成烤虾味」会被判成
  // 重复单直接复用旧单，顾客改口味等于没改（与落库覆盖同属一条链，2026-09-26 一并修）。
  const lines = (Array.isArray(items) ? items : [])
    .map((i) => `${i.productId}x${i.quantity}@${i.spec || ''}`)
    .sort()
    .join(',')
  const shot = typeof paymentScreenshot === 'string' ? `#${paymentScreenshot.length}` : ''
  return [roomNumber, wechat, remark, Number(totalAmount).toFixed(2), lines, shot].join('\u0000')
}

export async function findByFingerprint(DB, { roomNumber, fingerprint }) {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
  // idx_orders_roomNumber + idx_orders_createdAt 支撑；status 限定进行中单
  // （已完成/已取消的历史单不参与去重：顾客隔天再买同样的东西是真单）
  const rows = await qAll(DB,
    `SELECT _id, totalAmount, items, wechat, remark, paymentScreenshot FROM orders
     WHERE roomNumber = ? AND createdAt >= ? AND status IN ('pending','paid')
     ORDER BY createdAt DESC LIMIT 10`,
    [roomNumber, since])
  for (const r of rows) {
    const fp = orderFingerprint({
      roomNumber, wechat: r.wechat, remark: r.remark, totalAmount: r.totalAmount,
      items: jparse(r.items, []), paymentScreenshot: r.paymentScreenshot,
    })
    if (fp === fingerprint) return r
  }
  return null
}

// 顾客所选口味 → 订单 items.spec 的取值口径。
// 客户端把口味折进 spec 字符串（src/utils/spec-options.ts:53 的 `${spec} · ${label}`），
// 服务端不能原样信任：只接受「该商品目录 spec」或商家在后台维护且未关掉的口味组合，
// 其余（脏串、伪造、已下架口味、旧客户端不传）一律回落商品真值。
// 名称/单价/库存仍全部取 DB 行，这里放行的只是"要哪一包"这个信息。
export function allowedOrderSpecs(p) {
  const base = (typeof p.spec === 'string' ? p.spec : '').trim()
  const out = new Set([base])
  for (const o of jparse(p.specOptions, [])) {
    const label = typeof o?.label === 'string' ? o.label.trim() : ''
    if (!label || o?.enabled === false) continue
    out.add(base ? `${base} · ${label}` : label)
  }
  return out
}

function resolveOrderSpec(p, clientSpec) {
  const base = typeof p.spec === 'string' ? p.spec : ''
  const want = typeof clientSpec === 'string' ? clientSpec.trim() : ''
  return want && allowedOrderSpecs(p).has(want) ? want : base
}

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
    `SELECT _id, name, spec, specOptions, price, enabled, subcategories, stock FROM products WHERE _id IN (${ids.map(() => '?').join(',')})`,
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
      productId: p._id, name: p.name, spec: resolveOrderSpec(p, item.spec),
      price: Number(p.price) || 0, quantity: qty, subcategories: jparse(p.subcategories, []),
    })
    total += (Number(p.price) || 0) * qty
  }
  // 防超卖（2026-09-24 对标 C1）：下单即占用库存；不限售项（stock=-1，代码侧读取时判定）
  // 不进入扣减集合——守卫 SQL 的 `stock >= 0` 条件若命中不限售行会把 -1 扣成负数。
  // 守卫式扣减（条件 UPDATE）防并发窗口超卖，任一失败回补本单已扣项后整体拒绝。
  const room = String(roomNumber).trim()
  const wechatNorm = String(wechat || '').slice(0, 50)
  const remarkNorm = String(remark || '').slice(0, 200)
  const shot = typeof paymentScreenshot === 'string' ? paymentScreenshot : ''
  const totalRounded = Math.round(total * 100) / 100
  const fingerprint = orderFingerprint({
    roomNumber: room, wechat: wechatNorm, remark: remarkNorm,
    totalAmount: totalRounded, items: verified, paymentScreenshot: shot,
  })
  const key = idempotencyKey(room, payload.requestId, fingerprint)

  // 幂等前置检查（在扣库存之前）：命中即直接复用既有单，本请求不动库存
  if (key) {
    const hit = await qFirst(DB, `SELECT _id, totalAmount FROM orders WHERE idempotencyKey = ?`, [key])
    if (hit) return { code: 0, data: { id: hit._id, totalAmount: hit.totalAmount, deduplicated: true } }
  } else {
    const dup = await findByFingerprint(DB, { roomNumber: room, fingerprint })
    if (dup) return { code: 0, data: { id: dup._id, totalAmount: dup.totalAmount, deduplicated: true } }
  }

  const stockItems = verified.filter((it) => Number(byId.get(it.productId).stock) >= 0)
  const stockErr = await reserveStock(DB, stockItems)
  if (stockErr) return stockErr
  const ts = nowISO()
  const doc = {
    _id: genId('o_'), roomNumber: room, items: verified,
    wechat: wechatNorm, remark: remarkNorm,
    paymentScreenshot: shot,
    totalAmount: totalRounded, status: 'pending', createdAt: ts, updatedAt: ts,
  }
  if (key) doc.idempotencyKey = key
  try {
    await insert(DB, 'orders', doc)
  } catch (e) {
    // 落库失败必须回补本请求已占用的库存，否则失败一次就凭空少一份可售库存
    if (stockItems.length) await releaseStock(DB, stockItems)
    const msg = e instanceof Error ? e.message : String(e)
    if (key && /UNIQUE constraint failed/i.test(msg) && /idempotencyKey/i.test(msg)) {
      // 并发窗口：另一请求已用同一把 key 落库，把那张单返回给本调用方
      const hit = await qFirst(DB, `SELECT _id, totalAmount FROM orders WHERE idempotencyKey = ?`, [key])
      if (hit) return { code: 0, data: { id: hit._id, totalAmount: hit.totalAmount, deduplicated: true } }
    }
    console.error('[orders] createOrder 落库失败，库存已回补:', msg)
    return { code: -1, message: '订单创建失败，请重试' }
  }
  return { code: 0, data: { id: doc._id, totalAmount: doc.totalAmount } }
}

// 库存占用：逐 item 守卫式 UPDATE（WHERE stock>=qty），0 变更=库存不足；
// 失败时回补此前已成功扣减的条目（同请求内补偿，D1 无跨语句事务时的最小正确实现）
export async function reserveStock(DB, items) {
  const done = []
  for (const it of items) {
    const res = await qRun(DB,
      `UPDATE products SET stock = stock - ?, updatedAt = ? WHERE _id = ? AND stock >= 0 AND stock >= ?`,
      [it.quantity, nowISO(), it.productId, it.quantity])
    if (!res.meta?.changes) {
      if (done.length) await releaseStock(DB, done)
      return { code: -1, message: `库存不足: ${it.name}` }
    }
    done.push(it)
  }
  return null
}

// 库存释放（取消订单回补）：仅回补在售管理的有限库存（stock>=0），不限售项不动
export async function releaseStock(DB, items) {
  for (const it of items) {
    await qRun(DB,
      `UPDATE products SET stock = CASE WHEN stock >= 0 THEN stock + ? ELSE stock END, updatedAt = ? WHERE _id = ?`,
      [it.quantity, nowISO(), it.productId])
  }
}

export async function deleteOrder(DB, payload) {
  const { orderId } = payload
  if (!orderId) return { code: -1, message: '缺少 orderId' }
  // 删除进行中订单（pending/paid/delivering）= 库存占用作废，需回补；
  // cancelled 已在取消时释放、completed 视为已交付消耗，均不回补（防删除历史单凭空加库存）
  const cur = await qFirst(DB, `SELECT status, items FROM orders WHERE _id = ?`, [orderId])
  await qRun(DB, `DELETE FROM orders WHERE _id = ?`, [orderId])
  if (cur && !['cancelled', 'completed'].includes(cur.status)) {
    const items = jparse(cur.items, [])
    if (items.length) await releaseStock(DB, items)
  }
  return { code: 0 }
}

// 超时未支付单盘点（对标 litemall OrderUnpaidTask / Saleor checkout_cleaner 的「只盘不砍」版）
// 为什么不照抄自动取消：本项目支付是**线下确认制**（顾客转账 → 管理员手工置 paid），
// pending 超时可能是"已转账待确认"，定时自动取消会误杀真单。因此这里只出报表，
// 取消仍由管理员逐单决定（走 updateOrderStatus，库存回补路径与用户取消完全同一条）。
export async function stalePendingReport(DB, payload) {
  const minutes = Math.min(Math.max(Number(payload?.minutes) || 60, 1), 7 * 24 * 60)
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString()
  const rows = await qAll(DB,
    `SELECT _id, roomNumber, totalAmount, items, paymentScreenshot, createdAt FROM orders
     WHERE status = 'pending' AND createdAt < ? ORDER BY createdAt ASC LIMIT 200`,
    [cutoff])
  if (!rows.length) return { code: 0, data: { thresholdMinutes: minutes, count: 0, orders: [], stockReserved: [] } }

  // 这些单占用了多少"有限库存"（不限售项 stock<0 不计入占用）
  const productIds = [...new Set(rows.flatMap((r) => jparse(r.items, []).map((i) => i.productId)))]
  const prods = await qAll(DB,
    `SELECT _id, name, stock FROM products WHERE _id IN (${productIds.map(() => '?').join(',')})`, productIds)
  const prodById = new Map(prods.map((p) => [p._id, p]))
  const tied = new Map()
  const nowMs = Date.now()
  const orders = rows.map((r) => {
    const items = jparse(r.items, [])
    for (const it of items) {
      const p = prodById.get(it.productId)
      if (!p || Number(p.stock) < 0) continue
      const cur = tied.get(it.productId) || { productId: it.productId, name: p.name, reserved: 0 }
      cur.reserved += Number(it.quantity) || 0
      tied.set(it.productId, cur)
    }
    return {
      id: r._id, roomNumber: r.roomNumber, totalAmount: r.totalAmount,
      ageMinutes: Math.max(0, Math.round((nowMs - Date.parse(r.createdAt)) / 60_000)),
      // 有截图 = 顾客已自称付款，属"待确认"而非"跑单"，管理端据此分优先级处理
      hasPaymentProof: Boolean(r.paymentScreenshot),
    }
  })
  return { code: 0, data: { thresholdMinutes: minutes, count: orders.length, orders, stockReserved: [...tied.values()] } }
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
  const cur = await qFirst(DB, `SELECT status, items FROM orders WHERE _id = ?`, [orderId])
  if (!cur) return { code: -1, message: '订单不存在' }
  if (!(ORDER_TRANSITIONS[cur.status] || []).includes(status))
    return { code: -1, message: `不允许的状态流转: ${cur.status} → ${status}` }
  const items = jparse(cur.items, [])
  // 取消 = 释放本单占用的有限库存（不限售项由 releaseStock 内 CASE 条件天然跳过）
  if (status === 'cancelled' && items.length) await releaseStock(DB, items)
  // 误取消恢复（cancelled→pending）= 重新占用；库存已被别人占走则拒绝恢复，状态不动
  if (cur.status === 'cancelled' && status === 'pending' && items.length) {
    const err = await reserveStock(DB, items)
    if (err) return err
  }
  // 乐观锁（对标 litemall OrderUtil.updateWithOptimisticLocker / Medusa updateWithOptimisticLocker）：
  // 上面的合法性判定基于"读到的 cur.status"，两个管理员同时点同一单会双双通过。
  // 把读到的状态写进 WHERE 条件，0 变更即说明有人抢先改过，本次迁移作废。
  const res = await qRun(DB, `UPDATE orders SET status = ?, updatedAt = ? WHERE _id = ? AND status = ?`,
    [status, nowISO(), orderId, cur.status])
  if (!res.meta?.changes) {
    // 抢占失败时，本请求刚为"误取消恢复"扣下的库存必须回补，否则凭空少一份可售库存
    if (cur.status === 'cancelled' && status === 'pending' && items.length) await releaseStock(DB, items)
    return { code: -1, message: '订单已被他人更新，请刷新后重试' }
  }
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
