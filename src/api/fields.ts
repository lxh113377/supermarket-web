// 客户端字段白名单（src/api/fields.ts）
// 从 src/auth.ts 拆出（2026-09-05 M3）。与服务端 functions/lib/security.js 的 *_FIELDS
// 对称（defence-in-depth）：服务端是信任边界、会重建/校验；此处再在客户端出口收敛一次，
// 即使服务端逻辑回归，客户端也不会发出多余字段。
// 注意：订单客户端只发输入字段（roomNumber/items），服务端另用 ORDER_FIELDS 收敛"存储文档"，二者概念不同。

export const PRODUCT_FIELDS: string[] = ['name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order', 'image', 'images', 'description', 'reviews', 'stock']
export function pickProductFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of PRODUCT_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
}

export const ORDER_FIELDS: string[] = ['roomNumber', 'items', 'wechat', 'remark', 'paymentScreenshot']
export function pickOrderFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of ORDER_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  // 历史兼容：确认订单页曾用 building 字段，这里统一映射为 roomNumber，
  // 防止再次出现"页面传 building、云函数只认 roomNumber"的断链。
  if (clean.roomNumber === undefined && data.building !== undefined) {
    clean.roomNumber = String(data.building).trim()
  }
  return clean
}

export const REVIEW_FIELDS: string[] = ['productOrder', 'user', 'rating', 'text', 'images']
export function pickReviewFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of REVIEW_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
}

export const SUBMISSION_FIELDS: string[] = ['serviceId', 'serviceName', 'categoryId', 'categoryName', 'formData', 'images']
export function pickSubmissionFields(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const k of SUBMISSION_FIELDS) {
    if (data[k] !== undefined) clean[k] = data[k]
  }
  return clean
}