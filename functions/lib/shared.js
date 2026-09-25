// 共享契约模块（纯常量，无副作用）
// 2026-08-23 从 cloudfunctions/shared.js 迁出：原 CloudBase 专属 handler
// （createOrderHandler 等，依赖 db.collection().where().get() NoSQL API）已随迁移废弃；
// normalizeEvent/createRateLimiter/getClientIp/pickFields 四个遗留函数生产零引用，
// 2026-09-05 已删除（生产用 security.js:getClientIp/checkRate 与 db.js:pick）。
// 此处仅保留前端/后端共用的字段白名单常量（防御纵深：服务端为信任边界，白名单单源迭代）。

// 商品字段白名单（单源）
const PRODUCT_FIELDS = [
  'name', 'spec', 'price', 'costPrice', 'subcategories', 'enabled', 'order',
  'image', 'images', 'description', 'reviews', 'stock', 'specOptions',
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
  PRODUCT_FIELDS,
  ORDER_FIELDS,
  REVIEW_FIELDS,
  SUBMISSION_FIELDS,
}
