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

/**
 * 单条 D1 语句的**应用层体积预算**（第三十七轮 R37-H2）。
 * 立它的实测：改前全仓有 5 处各说各话的图体量上限（orders/reviews 各 `800 * 1024` 字符、
 * submissions `2 * 1024 * 1024`、前端两处 `2MB`/无上限），而平台事实是
 * `d1_statement_bytes = 100000 bytes/语句`（见 `docs/limit-provenance.md` 平台事实节）⇒
 * 本仓现有图实测（`public/` 115 张）二进制 p50=22,258B / p90=77,474B / max=153,404B，
 * 换 base64 即 p50≈29,677 / p90≈103,298 / max≈204,538 字符 —— **p90 就已经越过平台预算**，
 * 那些"800KB/2MB"从来没起作用过：真实后果是应用层放行、平台层报错（用户看到的是下单失败）。
 * 取值 90,000 = 100,000 × (1 − 10%)，余量给 SQL 关键字、items JSON 与转义膨胀。
 * 量纲：base64 是 ASCII ⇒ 1 字符 = 1 byte，故"字符数"与"语句字节数"在同一编码下直接可比
 * （这正是第十七轮 M5 说的"须先统一量纲再谈等值"，本轮按实测统一成这一把尺）。
 */
export const MAX_STATEMENT_PAYLOAD_CHARS = 90_000

export {
  PRODUCT_FIELDS,
  ORDER_FIELDS,
  REVIEW_FIELDS,
  SUBMISSION_FIELDS,
}
