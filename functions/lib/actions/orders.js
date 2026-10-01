// 订单域 handlers（从 backend.js 拆出，逻辑零改动）

import { logError } from '../logger.js'
import { qAll, qFirst, qRun, qBatch, jparse, nowISO, genId, insert } from '../db.js'
import { insertMovements } from '../stock.js'
import { isSafeImageUrl } from '../security.js'
import { fail } from '../errors.js'
import { MAX_STATEMENT_PAYLOAD_CHARS } from '../shared.js'

// ── 下单幂等（2026-09-24 对标第二轮 A1）──
// 对标：Medusa HTTP 层 `Idempotency-Key` + 表内 UNIQUE(index, key)；litemall cart_checkout 唯一索引
//       + @DistributedLock 双层。本项目取同构的两层：
//   ① 带 requestId 的新客户端：服务端把 `房间号@requestId` 存进 idempotencyKey，
//      由**部分唯一索引**在 DB 层兜住并发（唯一约束是最后防线，不靠应用层判断）。
//   ② 不带 requestId 的调用方（顾客端 Service Worker 长缓存，新版 bundle 铺开前旧包仍在下单；
//      以及直接 POST /pub 的集成方）：90s 内容指纹兜底，只对**完全相同**的载荷去重。
// 有 requestId 时**不**走 ②：换了 key 就是有意下新单，指纹会把合法的第二单吞掉。
export const DEDUPE_WINDOW_MS = 90 * 1000

/**
 * 单行数量上界（第三十七轮 R37-H3）。
 * 一手事实：改前这里只判 `Number.isInteger(qty) && qty > 0` ⇒ **数量无界**；
 * 且 `stock === -1`（不限售项）连库存守卫都不过 ⇒ 前端虽有 `qty >= 99` 硬顶
 * （`src/pages/ProductDetailPage.tsx:432`），一个直接 POST /pub 的调用方可以下 10⁹ 件的单。
 * 取值 = **继承本项目在册的产品决定 99**，不新拍一个数：
 * `saleor/saleor` 的 `DEFAULT_LIMIT_QUANTITY_PER_CHECKOUT: Final[int] = 50`（`saleor/site/models.py:23`）
 * 是"站点可配默认值"而不是行业常数，`medusajs/medusa` 则根本不设数量上界、只校库存
 * （`INSUFFICIENT_INVENTORY` + zod `quantity.gt(0)`）⇒ 两家都支持"上界必须是产品决定"这一点。
 * 两侧同值由 `tests/limitCapParity.test.ts` 钉（前端 `MAX_QTY_PER_LINE` ⇄ 本常量）。
 */
export const MAX_QUANTITY_PER_LINE = 99

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
// 客户端把口味折进 spec 字符串（src/utils/spec-options.ts 的 SPEC_FLAVOR_SEP，
// 即 `${spec} · ${label}`），服务端不能原样信任：只接受「该商品目录 spec」或商家在后台维护且未关掉的口味组合，
// 其余（脏串、伪造、已下架口味、旧客户端不传）一律回落商品真值。
// 名称/单价/库存仍全部取 DB 行，这里放行的只是"要哪一包"这个信息。
// 分隔符在本文件与前端各写一份（Pages Functions 与 src/ 是两条构建链，无法共享模块），
// 由 tests/specFlavorContract.test.js 钉住两侧一致；改这里的字面量会让那条用例判红。
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

// ── 满减促销最小闭环（2026-09-30 对标 P2）──
// 对标 mall 的满减 / medusa 的 Promotion 模块：本项目只取"按下单小计自动选最优一档"。
// 防御式读取：promotions 表不存在（迁移未执行的老库）⇒ 返回零优惠，行为与旧版一致。
export async function bestPromotion(DB, subtotal) {
  try {
    const rows = await qAll(DB,
      `SELECT _id, threshold, discount FROM promotions WHERE enabled = 1`)
    let best = null
    for (const r of rows) {
      const th = Number(r.threshold) || 0
      const dc = Number(r.discount) || 0
      if (th <= 0 || dc <= 0) continue
      if (subtotal >= th && (!best || dc > best.discountAmount)) {
        best = { promotionId: r._id, discountAmount: Math.min(dc, subtotal) }
      }
    }
    return best || { promotionId: '', discountAmount: 0 }
  } catch {
    return { promotionId: '', discountAmount: 0 }
  }
}

// 管理端促销档位只读视图（M-58-3：档位定义 + 每档命中统计；纯读，不进 DASHBOARD_WRITE_ACTIONS）。
// 防御式：缺表老库⇒空档位零命中（页面展示"未配置满减"，不抛错，与旧版一致）。
export async function getPromotions(DB) {
  try {
    const tiers = await qAll(DB,
      `SELECT _id, name, threshold, discount, enabled, updatedAt FROM promotions ORDER BY threshold ASC`)
    let hits = []
    try {
      hits = await qAll(DB,
        `SELECT promotionId, COUNT(*) AS orders, COALESCE(SUM(discountAmount), 0) AS totalDiscount FROM order_discounts GROUP BY promotionId`)
    } catch { hits = [] }
    const byId = new Map(hits.map((h) => [h.promotionId, { orders: Number(h.orders) || 0, totalDiscount: Number(h.totalDiscount) || 0 }]))
    return {
      code: 0,
      data: tiers.map((t) => ({
        _id: t._id, name: t.name || '', threshold: Number(t.threshold) || 0,
        discount: Number(t.discount) || 0, enabled: Number(t.enabled) === 1, updatedAt: t.updatedAt || '',
        hits: byId.get(t._id) || { orders: 0, totalDiscount: 0 },
      })),
    }
  } catch {
    return { code: 0, data: [] }
  }
}

// 订单优惠明细读取（order_discounts 新表轨；老库缺表⇒零优惠，与旧版一致）。
export async function getDiscount(DB, orderId) {
  try {
    const r = await qFirst(DB,
      `SELECT discountAmount, promotionId FROM order_discounts WHERE orderId = ?`, [orderId])
    if (!r) return { discountAmount: 0, promotionId: '' }
    return { discountAmount: Number(r.discountAmount) || 0, promotionId: r.promotionId || '' }
  } catch {
    return { discountAmount: 0, promotionId: '' }
  }
}

export async function createOrder(DB, payload) {
  const { roomNumber, items, wechat, remark, paymentScreenshot } = payload
  if (!roomNumber || !Array.isArray(items) || !items.length) return fail('invalid_order_payload', '订单数据不完整')
  // 付款截图 scheme 白名单：拒绝非 data:image / https 的注入向量
  if (typeof paymentScreenshot === 'string' && paymentScreenshot) {
    // 两个原因分开报错（第三十七轮）：原先 size 与 scheme 共用 `invalid_image`，
    // 用户图太大时看到的是"格式无效"——那是把用户往错方向支使（改图格式并不会变小）。
    if (paymentScreenshot.length > MAX_STATEMENT_PAYLOAD_CHARS) {
      return fail('image_too_large', `付款截图过大（${paymentScreenshot.length} 字符 > 单语句预算 ${MAX_STATEMENT_PAYLOAD_CHARS}），请先裁剪或降低清晰度`)
    }
    if (!isSafeImageUrl(paymentScreenshot)) return fail('invalid_image', '付款截图格式无效，请重新上传')
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
    if (!p) return fail('product_not_found', `商品不存在: ${item.productId}`)
    if (p.enabled === 0 || p.enabled === false) return fail('product_disabled', `商品已下架: ${p.name}`)
    // 数量必须为正整数：拦截负数/小数/缺失，防订单负金额或异常金额
    const qty = Number(item.quantity)
    if (!Number.isInteger(qty) || qty <= 0) return fail('invalid_quantity', `商品数量无效: ${p.name}`)
    if (qty > MAX_QUANTITY_PER_LINE) {
      return fail('quantity_exceeds_limit', `单品数量不能超过 ${MAX_QUANTITY_PER_LINE} 件: ${p.name}`)
    }
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
  // 单语句体积守卫（第三十七轮 R37-H2）：整条记录序列化后必须落在 D1 语句预算内。
  // 这条**取代**原先"每图 800 * 1024 字符"的假上限 —— 实测本仓现有图 base64 的 p90≈103,298 字符
  // 就已越过平台预算，旧值形同虚设：放行后失败发生在平台层，用户只看到"下单失败"。
  const payloadChars = JSON.stringify({ room, wechat: wechatNorm, remark: remarkNorm, items: verified, shot }).length
  if (payloadChars > MAX_STATEMENT_PAYLOAD_CHARS) {
    return fail('payload_too_large', `订单数据过大（序列化 ${payloadChars} 字符 > 预算 ${MAX_STATEMENT_PAYLOAD_CHARS}）：请压小付款截图`)
  }
  const totalRounded = Math.round(total * 100) / 100
  // 满减（2026-09-30 P2）：服务端按小计自动选最优启用档；默认种子关闭⇒discount 0，老行为不变。
  // 指纹沿用折后总额（totalRounded 被下面覆盖为实付）：同一载荷在促销开关前后 90s 内复下，
  // 会被视为不同单——这是刻意偏向"多收钱不如多记单"，与指纹注释的口味口径同方向。
  const promo = await bestPromotion(DB, totalRounded)
  const discountRounded = Math.round((promo.discountAmount || 0) * 100) / 100
  const payableRounded = Math.round((totalRounded - discountRounded) * 100) / 100
  const fingerprint = orderFingerprint({
    roomNumber: room, wechat: wechatNorm, remark: remarkNorm,
    totalAmount: payableRounded, items: verified, paymentScreenshot: shot,
  })
  const key = idempotencyKey(room, payload.requestId, fingerprint)

  // 幂等前置检查（在扣库存之前）：命中即直接复用既有单，本请求不动库存
  if (key) {
    const hit = await qFirst(DB, `SELECT _id, totalAmount FROM orders WHERE idempotencyKey = ?`, [key])
    if (hit) {
      const d = await getDiscount(DB, hit._id)
      return { code: 0, data: { id: hit._id, totalAmount: hit.totalAmount, ...d, deduplicated: true } }
    }
  } else {
    const dup = await findByFingerprint(DB, { roomNumber: room, fingerprint })
    if (dup) {
      const d = await getDiscount(DB, dup._id)
      return { code: 0, data: { id: dup._id, totalAmount: dup.totalAmount, ...d, deduplicated: true } }
    }
  }

  const stockItems = verified.filter((it) => Number(byId.get(it.productId).stock) >= 0)
  // E7：单号在扣库存**之前**生成，好让流水的 refId 指得到这张单。
  // 原先是 insert 时才 genId ⇒ 流水只能记空号，对账时查不到"这次扣减属于哪一单"。
  // 落库失败时这个号随单一起作废，不会留下悬空引用（下面那条回补路径会记 kind='void'）。
  const orderId = genId('o_')
  const stockErr = await reserveStock(DB, stockItems, { orderId })
  if (stockErr) return stockErr
  const ts = nowISO()
  const doc = {
    _id: orderId, roomNumber: room, items: verified,
    wechat: wechatNorm, remark: remarkNorm,
    paymentScreenshot: shot,
    totalAmount: payableRounded, status: 'pending', createdAt: ts, updatedAt: ts,
  }
  if (key) doc.idempotencyKey = key
  try {
    await insert(DB, 'orders', doc)
    // 优惠明细只在有优惠时落行（order_discounts 新表轨；缺表老库上此句抛错⇒整体走下单失败？不：
    // insert 目标表缺失会抛，包进 try 让外层统一回补库存并返回 order_create_failed，保持"要么全有要么全无"）。
    if (discountRounded > 0) {
      await qRun(DB,
        `INSERT INTO order_discounts (orderId, discountAmount, promotionId, createdAt) VALUES (?, ?, ?, ?)`,
        [orderId, discountRounded, promo.promotionId, ts])
    }
  } catch (e) {
    // 落库失败必须回补本请求已占用的库存，否则失败一次就凭空少一份可售库存
    if (stockItems.length) await releaseStock(DB, stockItems, { orderId, actor: 'system' })
    const msg = e instanceof Error ? e.message : String(e)
    if (key && /UNIQUE constraint failed/i.test(msg) && /idempotencyKey/i.test(msg)) {
      // 并发窗口：另一请求已用同一把 key 落库，把那张单返回给本调用方
      const hit = await qFirst(DB, `SELECT _id, totalAmount FROM orders WHERE idempotencyKey = ?`, [key])
      if (hit) {
        const d = await getDiscount(DB, hit._id)
        return { code: 0, data: { id: hit._id, totalAmount: hit.totalAmount, ...d, deduplicated: true } }
      }
    }
    logError('orders', 'createOrder 落库失败，库存已回补', { err: msg })
    return fail('order_create_failed', '订单创建失败，请重试')
  }
  return { code: 0, data: { id: doc._id, totalAmount: doc.totalAmount, discountAmount: discountRounded, promotionId: promo.promotionId } }
}

// 库存占用：N 条守卫式 UPDATE（WHERE stock>=qty）合成**一次** batch 往返（对标第十四轮 D1 batch）。
// 0 变更=库存不足——注意 batch 只在语句**执行失败**时整批回滚，0 变更不是失败，
// 所以不足那条之前的已成功扣减仍需用**再一次** batch 补偿（往返 N+1 → 最坏 2，happy path 1）。
//
// 第五十六轮 E7：扣减成功后补一行流水（kind='sale'，delta 为负）。
// 为什么不同批插流水：同上一条"0 变更不是失败"的语义 —— 把 INSERT 混进守卫 UPDATE 的那一批，
// 扣减失败的那件商品照样会留下流水，账面与流水当场脱节。宁可多一次往返（+1），换可对账。
export async function reserveStock(DB, items, ref = {}) {
  if (!items.length) return null
  const ts = nowISO()
  const stmts = items.map((it) => DB.prepare(
    `UPDATE products SET stock = stock - ?, updatedAt = ? WHERE _id = ? AND stock >= 0 AND stock >= ?`,
  ).bind(it.quantity, ts, it.productId, it.quantity))
  const results = await qBatch(DB, stmts)
  const bad = results.findIndex((r) => !r.meta?.changes)
  if (bad >= 0) {
    if (bad > 0) await releaseStock(DB, items.slice(0, bad), ref)
    return fail('stock_insufficient', `库存不足: ${items[bad].name}`)
  }
  await insertMovements(DB, items.map((it) => ({
    productId: it.productId, delta: -Math.trunc(Number(it.quantity) || 0),
    kind: 'sale', refType: 'order', refId: ref.orderId || '', actor: ref.actor || 'pub',
  })))
  return null
}

// 库存释放（取消订单/删除单/落库失败回补）：一次 batch 回补，仅回补在售管理的有限库存（stock>=0），不限售项不动。
// E7 前置那次 IN 查询是必须的：流水只对"真的动了账面"的商品记，不限售项在 SQL 里被 CASE 跳过，
// 在 JS 里也必须跳过，否则记出去的 +delta 没有对应的快照变化，不变式当场就破。
export async function releaseStock(DB, items, ref = {}) {
  if (!items.length) return
  const ids = items.map((it) => it.productId).filter(Boolean)
  if (!ids.length) return
  const ph = ids.map(() => '?').join(',')
  const rows = await qAll(DB, `SELECT _id, stock FROM products WHERE _id IN (${ph})`, ids)
  const tracked = new Set(rows.filter((r) => Number(r.stock) >= 0).map((r) => r._id))
  const list = items.filter((it) => tracked.has(it.productId))
  if (!list.length) return
  const ts = nowISO()
  const stmts = list.map((it) => DB.prepare(
    `UPDATE products SET stock = CASE WHEN stock >= 0 THEN stock + ? ELSE stock END, updatedAt = ? WHERE _id = ?`,
  ).bind(it.quantity, ts, it.productId))
  await qBatch(DB, stmts)
  await insertMovements(DB, list.map((it) => ({
    productId: it.productId, delta: Math.trunc(Number(it.quantity) || 0),
    kind: 'void', refType: 'order', refId: ref.orderId || '', actor: ref.actor || 'admin',
  })))
}

export async function deleteOrder(DB, payload) {
  const { orderId } = payload
  if (!orderId) return fail('missing_order_id', '缺少 orderId')
  // 删除进行中订单（pending/paid/delivering）= 库存占用作废，需回补；
  // cancelled 已在取消时释放、completed 视为已交付消耗，均不回补（防删除历史单凭空加库存）
  const cur = await qFirst(DB, `SELECT status, items FROM orders WHERE _id = ?`, [orderId])
  await qRun(DB, `DELETE FROM orders WHERE _id = ?`, [orderId])
  if (cur && !['cancelled', 'completed'].includes(cur.status)) {
    const items = jparse(cur.items, [])
    if (items.length) await releaseStock(DB, items, { orderId, actor: 'admin' })
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
  if (!orderId || !Object.prototype.hasOwnProperty.call(ORDER_TRANSITIONS, status)) return fail('invalid_params', '参数无效')
  const cur = await qFirst(DB, `SELECT status, items FROM orders WHERE _id = ?`, [orderId])
  if (!cur) return fail('order_not_found', '订单不存在')
  if (!(ORDER_TRANSITIONS[cur.status] || []).includes(status))
    return fail('invalid_transition', `不允许的状态流转: ${cur.status} → ${status}`)
  const items = jparse(cur.items, [])
  // 取消 = 释放本单占用的有限库存（不限售项由 releaseStock 内 CASE 条件天然跳过）
  if (status === 'cancelled' && items.length) await releaseStock(DB, items, { orderId, actor: 'admin' })
  // 误取消恢复（cancelled→pending）= 重新占用；库存已被别人占走则拒绝恢复，状态不动
  if (cur.status === 'cancelled' && status === 'pending' && items.length) {
    const err = await reserveStock(DB, items, { orderId, actor: 'admin' })
    if (err) return err
  }
  // 乐观锁（对标 litemall OrderUtil.updateWithOptimisticLocker / Medusa updateWithOptimisticLocker）：
  // 上面的合法性判定基于"读到的 cur.status"，两个管理员同时点同一单会双双通过。
  // 把读到的状态写进 WHERE 条件，0 变更即说明有人抢先改过，本次迁移作废。
  const res = await qRun(DB, `UPDATE orders SET status = ?, updatedAt = ? WHERE _id = ? AND status = ?`,
    [status, nowISO(), orderId, cur.status])
  if (!res.meta?.changes) {
    // 抢占失败时，本请求刚为"误取消恢复"扣下的库存必须回补，否则凭空少一份可售库存
    if (cur.status === 'cancelled' && status === 'pending' && items.length) await releaseStock(DB, items, { orderId, actor: 'system' })
    return fail('concurrent_update', '订单已被他人更新，请刷新后重试')
  }
  return { code: 0 }
}

// 顾客侧订单进度（公开只读）：仅回状态与更新时间，订单号即凭证（genId 时间戳+随机，不可枚举）
export async function getOrderStatus(DB, orderId) {
  if (!orderId || typeof orderId !== 'string') return fail('missing_order_id', '缺少订单号')
  const row = await qFirst(DB, `SELECT status, updatedAt FROM orders WHERE _id = ?`, [orderId])
  if (!row) return fail('order_not_found', '订单不存在')
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
    // 优惠明细同批 LEFT JOIN 带出（order_discounts 新表轨；缺表老库上 JOIN 抛错⇒整批走外层失败，
    // 与 createOrder 的 fail-closed 同方向；生产按"先迁移后部署"顺序不会走到该分支）。
    const rows = await qAll(DB,
      `SELECT o._id, o.items, o.totalAmount,
              COALESCE(d.discountAmount, 0) AS discountAmount, COALESCE(d.promotionId, '') AS promotionId
       FROM orders o LEFT JOIN order_discounts d ON d.orderId = o._id
       ORDER BY o._id ASC LIMIT ? OFFSET ?`, [BATCH, processed])
    if (!rows.length) break
    const pending = []
    for (const o of rows) {
      const items = jparse(o.items, [])
      const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0)
      const subtotal = Math.round(total * 100) / 100
      // 满减感知（2026-09-30 P2）：按下单时锁定的 promotionId 重算；规则已关/门槛不满足⇒优惠归零。
      // 无 promotionId 的历史单走老口径（折后==小计），存量行为不变。
      let expectTotal = subtotal
      let expectDiscount = 0
      let expectPid = ''
      const pid = typeof o.promotionId === 'string' ? o.promotionId : ''
      if (pid) {
        try {
          const rule = await qFirst(DB, `SELECT threshold, discount, enabled FROM promotions WHERE _id = ?`, [pid])
          const th = Number(rule?.threshold) || 0
          const dc = Number(rule?.discount) || 0
          if (rule?.enabled === 1 && th > 0 && dc > 0 && subtotal >= th) {
            expectDiscount = Math.min(dc, subtotal)
            expectTotal = Math.round((subtotal - expectDiscount) * 100) / 100
            expectPid = pid
          }
        } catch { /* 促销表缺失的老库：回落老口径 */ }
      }
      const rounded = expectTotal
      if (o.totalAmount == null || Math.abs(Number(o.totalAmount) - rounded) > 0.01
        || Math.abs((Number(o.discountAmount) || 0) - expectDiscount) > 0.01) {
        pending.push({ _id: o._id, total: rounded, discount: expectDiscount, pid: expectPid })
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
      // 优惠明细同批 UPSERT（多行 VALUES 单语句，无优惠的单也写 0 行占位⇒读侧 LEFT JOIN 永远有数可对；
      // 无修正的批次不执行本句，语句峰值基线不受影响）。
      const dvals = chunk.map(() => '(?, ?, ?, ?)').join(', ')
      const dparams = []
      for (const p of chunk) dparams.push(p._id, p.discount, p.pid, now)
      await qRun(
        DB,
        `INSERT INTO order_discounts (orderId, discountAmount, promotionId, createdAt) VALUES ${dvals}
         ON CONFLICT(orderId) DO UPDATE SET discountAmount = excluded.discountAmount, promotionId = excluded.promotionId`,
        dparams,
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
  const orderByCol = since ? 'o.updatedAt' : 'o.createdAt'
  const whereClause = since ? 'WHERE o.updatedAt > ?' : ''
  const params = since ? [since, pageSize + 1, (page - 1) * pageSize] : [pageSize + 1, (page - 1) * pageSize]
  const rows = await qAll(DB,
    `SELECT o._id, o.roomNumber, o.items, o.totalAmount, o.status, o.createdAt, o.wechat, o.remark, o.updatedAt,
            COALESCE(d.discountAmount, 0) AS discountAmount, COALESCE(d.promotionId, '') AS promotionId
     FROM orders o LEFT JOIN order_discounts d ON d.orderId = o._id
     ${whereClause} ORDER BY ${orderByCol} ${since ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`,
    params)
  const hasMore = rows.length > pageSize
  const data = (hasMore ? rows.slice(0, pageSize) : rows)
    .map((r) => ({ ...r, items: jparse(r.items, []) }))
  return { code: 0, data, hasMore, page, pageSize }
}

export async function getOrderById(DB, orderId) {
  const row = await qFirst(DB,
    `SELECT o.*, COALESCE(d.discountAmount, 0) AS discountAmount, COALESCE(d.promotionId, '') AS promotionId
     FROM orders o LEFT JOIN order_discounts d ON d.orderId = o._id WHERE o._id = ?`, [orderId])
  if (!row) return null
  return { ...row, items: jparse(row.items, []), paymentScreenshot: row.paymentScreenshot || '' }
}
