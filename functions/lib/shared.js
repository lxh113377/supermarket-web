// 共享契约模块（纯逻辑，无 CloudBase 依赖）
// 2026-08-23 从 cloudfunctions/shared.js 迁出：原文件的 CloudBase 专属 handler
// （createOrderHandler 等，依赖 db.collection().where().get() NoSQL API）已随迁移废弃，
// 此处仅保留前端/后端共用的字段白名单常量与无副作用工具函数，统一到线上后端同源目录。

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

function pickFields(data, allowed) {
  const out = {}
  for (const k of allowed) {
    if (k in data) out[k] = data[k]
  }
  return out
}

// 商品字段白名单（单源）
const PRODUCT_FIELDS = [
  'name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order',
  'image', 'images', 'description', 'reviews',
]

// 订单文档字段白名单
const ORDER_FIELDS = [
  'roomNumber', 'items', 'totalAmount', 'status', 'createdAt', 'updatedAt',
  'wechat', 'remark', 'paymentScreenshot',
]
// 评价字段白名单
const REVIEW_FIELDS = ['productOrder', 'user', 'rating', 'text', 'images']
// 服务提交字段白名单
const SUBMISSION_FIELDS = ['serviceId', 'serviceName', 'categoryId', 'categoryName', 'formData', 'images']

export {
  normalizeEvent,
  createRateLimiter,
  getClientIp,
  pickFields,
  PRODUCT_FIELDS,
  ORDER_FIELDS,
  REVIEW_FIELDS,
  SUBMISSION_FIELDS,
}
