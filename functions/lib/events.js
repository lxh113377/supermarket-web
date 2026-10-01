// 领域事件最小实现（ADR-0006 第 2 步：M-58-2 落地）。
//
// 为什么是这个形状：写 action 增多后出现第二登记点（看板缓存失效、库存流水、webhook 通知），
// 靠人工登记易漏；对标 medusa Workflow/插件制，但 F1 架构前提不成立（CF Pages 免费层无常驻进程），
// 故否决 Redis PubSub/队列服务。本阶段 emit() 只做两件事：① 记内存队列（同进程、可被后续步骤消费）；
// ② 投递复用既有 webhook（notify.js），不新增外部依赖；KV/D1 均不动。
// 新旧两出口（/pub 顾客下单、/web 管理端代客下单）共用 notify.js 的 maybeNotifyNewOrder，
// 事件化只接在那一处 ⇒ 两出口天然同行为（见 tests/orderNotify.test.js「两出口共用一处」）。
export const ORDER_CREATED = 'order.created'
export const ORDER_STATUS_CHANGED = 'order.status_changed'
export const ORDER_CANCELLED = 'order.cancelled'
export const PRODUCT_STOCK_LOW = 'product.stock_low'
export const PRODUCT_STOCK_OUT = 'product.stock_out'
export const REVIEW_CREATED = 'review.created'
export const SUBMISSION_CREATED = 'submission.created'

const KNOWN = new Set([
  ORDER_CREATED, ORDER_STATUS_CHANGED, ORDER_CANCELLED,
  PRODUCT_STOCK_LOW, PRODUCT_STOCK_OUT, REVIEW_CREATED, SUBMISSION_CREATED,
])

// 载荷白名单：id + 状态 + 金额类最小集（RFC 第 1 步）；微信号/备注/付款截图/房间号一律不进队列
// —— 房间号看着无害，但它是住址（PII 登记册 orders.roomNumber），队列未来一旦接出境就是泄漏面，
// 故按 webhook 口径的最严子集收（webhook 另行按自己白名单投递，本函数不替它放宽）。
const queue = []

export function emit(type, payload) {
  if (!KNOWN.has(type)) return { emitted: false, reason: 'unknown_event' }
  const orderId = String(payload?.orderId ?? payload?.id ?? '')
  if (!orderId) return { emitted: false, reason: 'no_order' }
  const rec = {
    type,
    at: new Date().toISOString(),
    orderId,
    status: String(payload?.status ?? 'pending'),
    totalAmount: Number(payload?.totalAmount) || 0,
    discountAmount: Number(payload?.discountAmount) || 0,
  }
  queue.push(rec)
  return { emitted: true, event: rec }
}

/** 取出并清空队列（步骤 3 的消费者原语；测试隔离也用它）。 */
export function drainEvents() {
  return queue.splice(0, queue.length)
}
