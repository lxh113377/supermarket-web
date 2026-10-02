// 库存流水（第五十六轮 E7）：唯一记账面。
//
// 为什么单独成文件而不是塞进 products.js/orders.js：库存有三个写手（下单占用、取消回补、后台改数），
// 加上本轮新增的手工调整就是四个。流水要能当对账依据，前提是**只有一个地方会写它** ——
// 形状借 opensourcepos 的 `app/Models/Inventory.php`（快照与流水分两个模型）与
// InvenTree 的 `stock/models.py:take_stock`（先改数量、再记 deltas 的顺序），
// 但把它们各自散在 Sale/Receiving/Item 里的"改快照 + 插一行"这段收成一个口。
//
// 不变式（比三个参照仓多出来的那一半；它们都不按流水回算快照）：
//   每个有限库存商品 SUM(stock_movements.delta) === products.stock；不限售项（stock=-1）SUM 必须为 0。
//   这条由 scripts/verify-backend.mjs 的 L 组当场判（见 LEDGER_CHECK_SQL），脱节即具名报出商品号。
import { qAll, qFirst, qRun, qBatch, nowISO } from './db.js'
import { sanitizeTrace } from './logger.js'
import { fail } from './errors.js'

/** 流水类型。init=建账/新品建档，sale=下单占用，void=取消或失败回补，adjust=后台手工改数 */
export const MOVEMENT_KINDS = Object.freeze(['init', 'sale', 'void', 'adjust'])
/** 引用来源：ledger=建账，order=订单，manual=后台 */
export const MOVEMENT_REF_TYPES = Object.freeze(['ledger', 'order', 'manual'])

/** 单页上限与默认页长：与 getOrders 同口径（后台流水页一次拉一页，不做全表） */
export const MOVEMENT_PAGE_MAX = 100
export const MOVEMENT_PAGE_DEFAULT = 30

/**
 * 纯函数：由「改前/改后」推出该记的那一行，推不出就返回 null（不记 = 这次改动不动账面）。
 * 三条边界都在这一个口里，避免调用方各自解释 -1：
 *   -1 → 有限数   = 开始跟踪，记 +after（建账形态，否则不变式对这个新品不成立）
 *   有限数 → -1   = 停止跟踪，记 -before（清零，SUM 回到 0 与 stock=-1 对齐）
 *   -1 → -1 / 相同值 = 不记
 */
export function deltaForStockChange(before, after) {
  const b = Number(before), a = Number(after)
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null
  if (b < 0 && a < 0) return null
  if (b < 0) return a > 0 ? a : null
  if (a < 0) return b > 0 ? -b : null
  return a === b ? null : a - b
}

/** 归一一行流水；非法输入返回 { error }，绝不静默补默认值（流水是要拿来对账的） */
export function normalizeMovement(row = {}) {
  const delta = Number(row.delta)
  if (!Number.isInteger(delta) || delta === 0) return { error: 'delta 必须是非零整数（记 0 行只会污染对账）' }
  if (!row.productId || typeof row.productId !== 'string') return { error: '缺 productId' }
  if (!MOVEMENT_KINDS.includes(row.kind)) return { error: `kind 非法：${row.kind}（在册：${MOVEMENT_KINDS.join('/')}）` }
  const refType = row.refType || (row.kind === 'init' ? 'ledger' : row.kind === 'adjust' ? 'manual' : 'order')
  if (!MOVEMENT_REF_TYPES.includes(refType)) return { error: `refType 非法：${refType}` }
  return {
    row: {
      productId: row.productId,
      delta,
      kind: row.kind,
      refType,
      refId: String(row.refId ?? '').slice(0, 64),
      actor: String(row.actor ?? '').slice(0, 32),
      note: String(row.note ?? '').slice(0, 200),
      createdAt: row.createdAt || nowISO(),
    },
  }
}

/**
 * 一次批量写流水（一条 batch ⇒ 一次往返）。
 * 与"改快照"分两次往返是有意的：D1 的 batch 只在语句**执行失败**时整批回滚，
 * 守卫式 UPDATE 命中 0 行不算失败 ⇒ 同批插行会给失败的扣减留下假流水（本仓 reserveStock 的补偿语义同源）。
 * 返回值带 rows 计数，供调用方与 sql-baseline 对账。
 */
export async function insertMovements(DB, movements) {
  const list = []
  const errors = []
  for (const m of movements || []) {
    const n = normalizeMovement(m)
    if (n.error) { errors.push(n.error); continue }
    list.push(n.row)
  }
  if (!list.length) return { code: 0, inserted: 0, errors }
  const ts = nowISO()
  const stmts = list.map((r) => DB.prepare(
    `INSERT INTO stock_movements (productId, delta, kind, refType, refId, actor, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(r.productId, r.delta, r.kind, r.refType, r.refId, r.actor, r.note, r.createdAt || ts))
  await qBatch(DB, stmts)
  return { code: 0, inserted: list.length, errors }
}

/** 对账 SQL（只读）：返回所有脱节的商品。判据与报表共用这一句，避免两处各写一份口径 */
export const LEDGER_CHECK_SQL = `
SELECT p._id AS productId, p.name AS name, p.stock AS stock,
       COALESCE(SUM(m.delta), 0) AS ledger, COUNT(m.id) AS movementRows
FROM products p
LEFT JOIN stock_movements m ON m.productId = p._id AND m.voided = 0
GROUP BY p._id
HAVING (p.stock >= 0 AND COALESCE(SUM(m.delta), 0) <> p.stock)
    OR (p.stock < 0 AND COALESCE(SUM(m.delta), 0) <> 0)`

/**
 * 只读视图：流水分页（新→旧）。productId/kind 二选一或同时用；limit 收敛到 [1, MOVEMENT_PAGE_MAX]。
 * 不做聚合报表（第五十六轮的范围就是"写入 + 只读视图"，报表登记给下一轮）。
 */
export async function queryMovements(DB, payload = {}) {
  const where = []
  const params = []
  if (payload.productId) { where.push('m.productId = ?'); params.push(String(payload.productId)) }
  if (payload.kind) {
    // 回显走 sanitizeTrace（第六十四轮 M-64-1，与 orders.js:187 / events.js 同一处收口）：
    // 模板串对数组/对象会做 String() 化，`kind: ['a'.repeat(5000)]` 原样进 message 不受长度约束。
    if (!MOVEMENT_KINDS.includes(payload.kind)) return fail('invalid_kind', `kind 非法：${sanitizeTrace(String(payload.kind))}（在册：${MOVEMENT_KINDS.join('/')}）`)
    where.push('m.kind = ?'); params.push(payload.kind)
  }
  const limit = Math.min(MOVEMENT_PAGE_MAX, Math.max(1, Number(payload.limit) || MOVEMENT_PAGE_DEFAULT))
  const offset = Math.max(0, Math.trunc(Number(payload.offset) || 0))
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = await qAll(DB,
    `SELECT m.id, m.productId, m.delta, m.kind, m.refType, m.refId, m.actor, m.note, m.voided, m.voidedAt, m.createdAt,
            p.name AS productName
     FROM stock_movements m LEFT JOIN products p ON p._id = m.productId
     ${clause} ORDER BY m.createdAt DESC, m.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset])
  const total = await qFirst(DB, `SELECT COUNT(*) AS c FROM stock_movements m ${clause}`, params)
  return { code: 0, data: { items: rows, total: Number(total?.c || 0), limit, offset } }
}

/** 单商品当前账面（对账/调试用；-1 表示不限售）。找不到商品返回 null */
export async function readStockRow(DB, productId) {
  return qFirst(DB, `SELECT _id, name, stock FROM products WHERE _id = ?`, [productId])
}

/**
 * 快照写入 + 记账的成对出口：改 products.stock 并留下那一行流水。
 * 判别式用 `ok` 而不是 `code`：fail() 返回的 `code` 被 TS 宽化成 number，联合类型窄化不下来
 * （第五十六轮 tsc 实测在调用方报 TS2339 —— 拿 `code !== 0` 当窄化是假的）。
 * 失败面只带 errorCode/message，kind/retryable 由调用方经 fail() 从登记册统一附，不在这里各写一份。
 * @returns {Promise<{ ok: true, changed: boolean, recorded: boolean, delta: number, ledgerErrors?: string[] } | { ok: false, errorCode: string, message: string }>}
 */
export async function applyStockSnapshot(DB, { productId, before, after, kind, refType, refId, actor, note }) {
  const ts = nowISO()
  const res = await qRun(DB, `UPDATE products SET stock = ?, updatedAt = ? WHERE _id = ?`, [after, ts, productId])
  if (!res.meta?.changes) return { ok: false, errorCode: 'product_not_found', message: '商品不存在' }
  const delta = deltaForStockChange(before, after)
  if (delta === null) return { ok: true, changed: true, recorded: false, delta: 0 }
  const r = await insertMovements(DB, [{ productId, delta, kind, refType, refId, actor, note }])
  return { ok: true, changed: true, recorded: true, delta, ledgerErrors: r.errors }
}
