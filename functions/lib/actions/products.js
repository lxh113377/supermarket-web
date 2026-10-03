// 商品/分类域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qFirst, qRun, jparse, nowISO, genId, pick, insert } from '../db.js'
import { isSafeImageUrl, validateImages } from '../security.js'
import { PRODUCT_FIELDS } from '../shared.js'
import { fail } from '../errors.js'
import { sanitizeTrace } from '../logger.js'
import { insertMovements, deltaForStockChange } from '../stock.js'

export function rowToProduct(row) {
  if (!row) return null
  const opts = jparse(row.specOptions, [])
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
    // 可选口味：脏值（非数组 / 老数据 NULL）一律回退空数组，前端据此不渲染选择器
    specOptions: Array.isArray(opts) ? opts : [],
    reviews: jparse(row.reviews, []),
    // 库存：-1 = 不限售；NULL（历史行/迁移缝隙）按 -1 处理，禁 NaN 外溢
    stock: row.stock == null || Number.isNaN(Number(row.stock)) ? -1 : Math.trunc(Number(row.stock)),
  }
}

export function rowToCategory(row) {
  if (!row) return null
  return {
    _id: row._id,
    name: row.name,
    type: row.type || '',
    order: Number(row.order) || 0,
    subcategories: jparse(row.subcategories, []),
  }
}

export async function getPublicProducts(DB) {
  const rows = await qAll(DB,
    `SELECT _id, name, spec, price, image, "order", subcategories, enabled, description, stock, specOptions
     FROM products WHERE enabled = 1 ORDER BY "order" ASC LIMIT 1000`)
  return { code: 0, data: rows.map(rowToProduct) }
}

/**
 * 商品全集号（第五十一轮 R51-H1）—— /pub 上**唯一**不带密钥就能看到"下架项"的通道。
 *
 * 立它的理由是一手的，不是假想：`getPublicProducts` 的 SQL 带 `WHERE enabled = 1`，
 * 于是 `scripts/verify_images.py` 上一轮把"应有图片集"接到"seed ∪ 现网在售"之后，
 * **下架商品的图仍然不在任何可判面内**（管理端要 ADMIN_KEY，而密钥按 AGENTS.md 红线绝不进 CI/日志）。
 * 那条门禁于是对"下架项缺一张图"永远不响 —— 上一轮只是把这个盲区**印出来**了，点名 ≠ 判过。
 *
 * 权限形状对标 `PostgREST/postgrest`：匿名角色（`db-anon-role`）能读的是**列级授权后的投影**，
 * 不是整行。所以这里只回 `{order, needsLocalImage}` 两个键：不含 name / price / description，
  也**不把 image 字段原样公开**（那是商家自填值，可能是外部 URL）—— 门禁要的不是图在哪，
  而是"这条到底依不依赖本地件"，一个布尔就够了。
 * 也**不加** enabled 过滤 —— 本 action 要回答的问题是"目录里一共出现过多少个号"，
 * "某个号现在是否在卖"属于 `getPublicProducts` 的语义，两者刻意不混。
 */
export async function getCatalogOrders(DB) {
  const rows = await qAll(DB,
    `SELECT "order", image FROM products ORDER BY "order" ASC LIMIT 1000`)
  const seen = new Set()
  const data = []
  for (const row of rows) {
    const n = Number(row && row.order)
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    // 布尔而不是 URL：门禁只需知道"这条依不依赖本地件"。把商家自填的 image 原样公开
    // 会把外部域名/路径写进公开响应，而它对这个判据没有任何增量作用。
    data.push({ order: n, needsLocalImage: !String(row.image || '').trim() })
  }
  return { code: 0, data }
}

export async function getPublicCategories(DB) {
  const rows = await qAll(DB, `SELECT _id, name, type, "order", subcategories FROM categories ORDER BY "order" ASC LIMIT 200`)
  return { code: 0, data: rows.map(rowToCategory) }
}

export async function getProducts(DB) {
  const rows = await qAll(DB, `SELECT * FROM products ORDER BY "order" ASC LIMIT 1000`)
  return { code: 0, data: rows.map(rowToProduct) }
}

export async function createProduct(DB, payload) {
  const data = pick(payload, PRODUCT_FIELDS)
  data.enabled = data.enabled !== false
  sanitizeStock(data)
  sanitizeSpecOptions(data)
  // 图片 scheme 白名单（纵深防御，管理端同样收敛）
  if (data.image && !isSafeImageUrl(data.image)) return fail('invalid_image', '商品主图格式无效')
  if (Array.isArray(data.images)) {
    if (data.images.length > 9) return fail('too_many_images', '商品图册最多 9 张')
    const imgOk = validateImages(data.images)
    if (imgOk === null) return fail('invalid_image', '商品图片格式无效')
    data.images = imgOk
  }
  const doc = { _id: genId('p_'), ...data, createdAt: nowISO(), updatedAt: nowISO() }
  await insert(DB, 'products', doc)
  // E7：建档即建账。有限库存（stock>=0）的新品必须有一条期初流水，
  // 否则不变式「SUM(delta)==stock」对这个新品从第一天就不成立（流水页会显示"有库存无账"）。
  // 取数走 data 不走 doc：doc 是 `{_id, ...data, ...}` 的字面量，展开后的索引签名在 tsc 推断里
  // 会丢（doc.stock 报 TS2339），而 data 是 pick() 的产物、带索引签名；两处同一个值。
  const openingStock = Number(data.stock)
  if (openingStock >= 0) {
    await insertMovements(DB, [{
      productId: doc._id, delta: openingStock, kind: 'init', refType: 'ledger',
      refId: '', actor: 'admin', note: '新品建档期初',
    }])
  }
  return { code: 0, data: doc }
}

// 库存入参收敛：非负整数才生效，其余（-1/NaN/负数/字符串垃圾）一律归 -1（不限售）
export function sanitizeStock(data) {
  if ('stock' in data) {
    const n = Math.trunc(Number(data.stock))
    data.stock = Number.isFinite(n) && n >= 0 ? n : -1
  }
}

// 可选口味入参收敛：只留 {label, enabled} 两个键，label 去空白、截 20 字、同名去重、上限 20 项。
// 后台是唯一写入口，但服务端仍是信任边界 —— 非数组/字符串项/空 label 一律丢弃，绝不让任意
// JSON 原样落库（前端会把 label 渲染成按钮文案）。
export const SPEC_OPTION_LIMIT = 20
export function sanitizeSpecOptions(data) {
  if (!('specOptions' in data)) return
  const raw = Array.isArray(data.specOptions) ? data.specOptions : []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const label = String(item.label ?? '').trim().slice(0, 20)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push({ label, enabled: item.enabled !== false })
    if (out.length >= SPEC_OPTION_LIMIT) break
  }
  data.specOptions = out
}

/**
 * 单商品更新核心逻辑（updateProduct 与 batchUpdateProducts 复用；字段白名单/图片 scheme/部分更新守卫统一在此）
 * @param stockBefore 批量入口预读到的改前库存；单条入口留空时本函数自己读一次（只在 payload 带 stock 时才读）
 * @returns {Promise<{ code: number, message?: string, errorCode?: string, kind?: string, retryable?: boolean }>}
 *   失败面由 fail() 带上 message/errorCode/kind；成功面只有 code，调用方按 code===0 分支取用。
 */
export async function applyProductUpdate(DB, productId, payload, stockBefore) {
  const data = pick(payload, PRODUCT_FIELDS)
  sanitizeStock(data)
  sanitizeSpecOptions(data)
  // E7：绝对值入口也必须留痕，否则"后台把 5 改成 3"这件事在流水里根本不存在。
  // 读必须在 UPDATE **之前** —— 改完再读就得到改后的值，delta 恒为 0，账就记空了。
  let before = stockBefore
  if ('stock' in data && (before === undefined || before === null)) {
    const row = await qFirst(DB, `SELECT stock FROM products WHERE _id = ?`, [productId])
    before = row ? Number(row.stock) : null
  }
  // enabled 守卫：仅当显式传了 enabled 才更新上架状态，防止部分更新时静默重上架缺货商品
  if ('enabled' in payload) data.enabled = payload.enabled !== false
  // 图片 scheme 白名单（纵深防御）
  if (data.image && !isSafeImageUrl(data.image)) return fail('invalid_image', '商品主图格式无效')
  if (Array.isArray(data.images)) {
    if (data.images.length > 9) return fail('too_many_images', '商品图册最多 9 张')
    const imgOk = validateImages(data.images)
    if (imgOk === null) return fail('invalid_image', '商品图片格式无效')
    data.images = imgOk
  }
  data.updatedAt = nowISO()
  const cols = Object.keys(data)
  if (!cols.length) return fail('no_update_fields', '无更新字段')
  const setClause = cols.map((c) => `"${c}" = ?`).join(', ')
  const values = cols.map((c) => {
    const v = data[c]
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
    return v
  })
  const res = await qRun(DB, `UPDATE products SET ${setClause} WHERE _id = ?`, [...values, productId])
  if (!res.meta?.changes) return fail('product_not_found', '商品不存在')
  if ('stock' in data) {
    const delta = deltaForStockChange(before, data.stock)
    if (delta !== null) {
      await insertMovements(DB, [{
        productId, delta, kind: 'adjust', refType: 'manual',
        refId: '', actor: 'admin', note: '后台商品编辑改数',
      }])
    }
  }
  return { code: 0 }
}

export async function updateProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return fail('missing_product_id', '缺少 productId')
  return applyProductUpdate(DB, productId, payload)
}

// 批量更新：items = [{ productId, updates }]，逐条应用（同一 updates 或多组均可）。
// 返回成功/失败明细而非整体回滚——批量场景部分失败可定位重试，避免并发 N 请求无明细。
//
// 上限推导（第十七轮 M2 立，第五十六轮 E7 重推）：本 action 语句数 = 1 + n + k
//   （k = 本次里**带库存改动**的商品数，每个多一条流水 INSERT；1 = E7 预读那一条 IN 查询，只在有库存改动时发）。
// D1 官方 limits 页「Queries per Worker invocation — 1000 (Workers Paid) / 50 (Free)」，
// 本仓按最坏情况（免费档 50，且最坏=n 件全带库存改动 ⇒ 1+2n）设防：1+2n ≤ 50-9 ⇒ n ≤ 20。
// 第九轮原值 40 是按「1 条 UPDATE/件」推的；流水进来后每件最多 2 条，所以**预算折到 20**。
// 这不是"顺手收紧"：留着 40 等于让「批量改 40 个商品的库存」在免费档下半途抛错（比改价更糟——
// 前半截已落库、流水只记了一半，正是不变式要防的那种半程状态）。
// ⚠️ 与下面 batchDeleteProducts 的 200 不是一回事：那边语句数是常数，受的是 SQLite 999 绑定参数。
// 两侧（本文件与 src/auth.ts 的分片大小）由 tests/batchChunkContract.test.js 钉住一致。
export const BATCH_UPDATE_MAX = 20
export async function batchUpdateProducts(DB, payload) {
  const { items } = payload
  if (!Array.isArray(items) || !items.length) return fail('missing_items', '缺少 items')
  if (items.length > BATCH_UPDATE_MAX) return fail('batch_too_large', `单次批量最多 ${BATCH_UPDATE_MAX} 个商品，请分批提交`)
  const failed = []
  let updated = 0
  // E7 预读：把"改前库存"一次性拿全（1 条 IN 查询），避免逐件 SELECT 把语句数推到 n 倍
  const stockIds = items.filter((it) => it && it.productId && it.updates && 'stock' in it.updates).map((it) => it.productId)
  const beforeMap = new Map()
  if (stockIds.length) {
    const ph = stockIds.map(() => '?').join(',')
    const rows = await qAll(DB, `SELECT _id, stock FROM products WHERE _id IN (${ph})`, stockIds)
    for (const r of rows) beforeMap.set(r._id, Number(r.stock))
  }
  for (const it of items) {
    if (!it || !it.productId) { failed.push({ id: '?', message: '缺少 productId' }); continue }
    const has = beforeMap.has(it.productId)
    const r = await applyProductUpdate(DB, it.productId, it.updates || {}, has ? beforeMap.get(it.productId) : undefined)
    if (r.code === 0) updated++
    // 回显走 sanitizeTrace（第六十五轮 M-64-5）：`failed` 这一支恰恰是「该 id 没命中 DB」，
    // 所以没有任何主键形状钳住它 —— 与 adjustStock 的成功回显（必须先 readStockRow 命中）不同类。
    else failed.push({ id: sanitizeTrace(String(it.productId)), message: r.message })
  }
  return { code: 0, data: { updated, failed, total: items.length } }
}

// 批量删除：productIds 数组，返回成功/失败明细
// 2026-09-18 双向迭代 R6：由「逐条 DELETE」改为「1 次存在性查询 + 1 次批量 DELETE」，
// 语句数从 O(N) 降为常数（1 次存在性查询 + 1 次批量 DELETE），所以这里的预算是**绑定参数数**
// 而不是查询数：SQLite SQLITE_MAX_VARIABLE_NUMBER 旧默认 999，N=200 ⇒ 每条语句 200 个参数，安全。
// 与 BATCH_UPDATE_MAX=20 差 10 倍是有原因的，两处都不是拍的 —— 见各自注释与 docs/limit-provenance.md。
export const BATCH_DELETE_MAX = 200
export async function batchDeleteProducts(DB, payload) {
  const { productIds } = payload
  if (!Array.isArray(productIds) || !productIds.length) return fail('missing_product_ids', '缺少 productIds')
  if (productIds.length > BATCH_DELETE_MAX) return fail('batch_too_large', `单次批量最多 ${BATCH_DELETE_MAX} 个商品`)
  const ids = [...new Set(productIds.filter((id) => typeof id === 'string' && id))]
  if (!ids.length) return fail('missing_product_ids', '缺少 productIds')
  const ph = ids.map(() => '?').join(',')
  const existRows = await qAll(DB, `SELECT _id FROM products WHERE _id IN (${ph})`, ids)
  const exist = new Set(existRows.map((r) => r._id))
  await qRun(DB, `DELETE FROM products WHERE _id IN (${ph})`, ids)
  // 删除数以「批量前查到的存在集合」为准：不依赖驱动返回的 meta.changes（各环境口径不一，
  // 甚至可能为 null），保证 deleted 与 failed 之和恒等于去重后的请求数。
  const deleted = exist.size
  // 同上：`failed` 是「没命中主键」的那一批，入参长度与字符集都不受服务端约束；
  // 且这里是 BATCH_DELETE_MAX=200 条同时回显（放大 200 倍），比单条入口更该收。
  const failed = productIds
    .filter((id) => !exist.has(id))
    .map((id) => ({ id: sanitizeTrace(String(id)), message: '商品不存在' }))
  return { code: 0, data: { deleted, failed, total: productIds.length } }
}

export async function deleteProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return fail('missing_product_id', '缺少 productId')
  await qRun(DB, `DELETE FROM products WHERE _id = ?`, [productId])
  return { code: 0 }
}
