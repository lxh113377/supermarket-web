// 商品/分类域 handlers（从 backend.js 拆出，逻辑零改动）

import { qAll, qRun, jparse, nowISO, genId, pick, insert } from '../db.js'
import { isSafeImageUrl, validateImages } from '../security.js'
import { PRODUCT_FIELDS } from '../shared.js'

export function rowToProduct(row) {
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
    `SELECT _id, name, spec, price, image, "order", subcategories, enabled, description
     FROM products WHERE enabled = 1 ORDER BY "order" ASC LIMIT 1000`)
  return { code: 0, data: rows.map(rowToProduct) }
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
export async function applyProductUpdate(DB, productId, payload) {
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

export async function updateProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return { code: -1, message: '缺少 productId' }
  return applyProductUpdate(DB, productId, payload)
}

// 批量更新：items = [{ productId, updates }]，逐条应用（同一 updates 或多组均可）。
// 返回成功/失败明细而非整体回滚——批量场景部分失败可定位重试，避免并发 N 请求无明细。
export async function batchUpdateProducts(DB, payload) {
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
// 2026-09-18 双向迭代 R6：由「逐条 DELETE」改为「1 次存在性查询 + 1 次批量 DELETE」，
// 语句数从 O(N) 降为常数（N ≤ 200，远低于 SQLite 999 参数上限）。
export async function batchDeleteProducts(DB, payload) {
  const { productIds } = payload
  if (!Array.isArray(productIds) || !productIds.length) return { code: -1, message: '缺少 productIds' }
  if (productIds.length > 200) return { code: -1, message: '单次批量最多 200 个商品' }
  const ids = [...new Set(productIds.filter((id) => typeof id === 'string' && id))]
  if (!ids.length) return { code: -1, message: '缺少 productIds' }
  const ph = ids.map(() => '?').join(',')
  const existRows = await qAll(DB, `SELECT _id FROM products WHERE _id IN (${ph})`, ids)
  const exist = new Set(existRows.map((r) => r._id))
  await qRun(DB, `DELETE FROM products WHERE _id IN (${ph})`, ids)
  // 删除数以「批量前查到的存在集合」为准：不依赖驱动返回的 meta.changes（各环境口径不一，
  // 甚至可能为 null），保证 deleted 与 failed 之和恒等于去重后的请求数。
  const deleted = exist.size
  const failed = productIds
    .filter((id) => !exist.has(id))
    .map((id) => ({ id, message: '商品不存在' }))
  return { code: 0, data: { deleted, failed, total: productIds.length } }
}

export async function deleteProduct(DB, payload) {
  const { productId } = payload
  if (!productId) return { code: -1, message: '缺少 productId' }
  await qRun(DB, `DELETE FROM products WHERE _id = ?`, [productId])
  return { code: 0 }
}
