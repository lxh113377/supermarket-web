// 新订单外部通知投递（webhook）。设计约束来自对标取证，三条都是硬不变量：
// ① 未配置 ORDER_WEBHOOK_URL ⇒ 纯 no-op：不发请求、不改订单状态、不消耗任何重试配额
//    （litemall `NotifyService.isMailEnable()` 形态：mailSender 为 null 时方法直接 return）。
// ② 投递失败（非 2xx / 抛错 / 超时）绝不冒泡到下单主链路
//    （saleor 把 ORDER_CREATED 走 apply_async 就是为了"端点死了不能碰订单"；
//     我们没有常驻消费者，等价手段是 waitUntil + 全捕获，见 deliverNewOrder）。
// ③ 载荷只放履约必需的最小字段，且**绝不含付款截图**（base64 可达 800KB，且是敏感图像）
//    与微信号——通知目标是第三方端点，最小化外发面。
// 反面参照（刻意不抄）：medusa 的 notification 模块在 provider 未启用时写 FAILURE 行并 throw，
// 等于"未配置也改状态 + 也消耗重试"，与我们要的 no-op 语义相反。

const WEBHOOK_TIMEOUT_MS = 4000

/** 取有效投递地址；任何"不可用"形态统一返回 null，调用方据此 no-op，永不抛错。 */
export function webhookTarget(env) {
  const raw = typeof env?.ORDER_WEBHOOK_URL === 'string' ? env.ORDER_WEBHOOK_URL.trim() : ''
  if (!raw) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // 只认 http/https：file:/data: 之类协议在这里等于把订单数据交给本地处理器
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url
}

/** 白名单载荷（字段级），新增字段必须显式加进这里——默认拒绝而不是默认外发。 */
export function newOrderWebhookBody(order) {
  return {
    event: 'order.created',
    orderId: String(order?.id ?? ''),
    roomNumber: String(order?.roomNumber ?? ''),
    totalAmount: Number(order?.totalAmount) || 0,
    itemCount: Array.isArray(order?.items) ? order.items.length : 0,
    status: String(order?.status ?? 'pending'),
  }
}

/**
 * 投递一次新订单通知。返回结论对象而非抛错：本函数任何分支都不允许把异常交给调用方。
 * deps 是测试注入口（fetchImpl / timeoutMs），生产调用不传即用默认实现。
 */
export async function deliverNewOrder(env, order, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const timeoutMs = deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS
  const target = webhookTarget(env)
  if (!target) return { delivered: false, reason: 'not_configured' }
  if (!order || !order.id) return { delivered: false, reason: 'no_order' }

  let signal
  try {
    signal = deps.signal ?? (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(timeoutMs)
      : undefined)
  } catch {
    signal = undefined
  }

  try {
    const res = await fetchImpl(target.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrderWebhookBody(order)),
      signal,
    })
    const status = Number(res?.status) || 0
    return { delivered: status >= 200 && status < 300, reason: status ? `http_${status}` : 'no_status' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { delivered: false, reason: /timeout|abort/i.test(msg) ? 'timeout' : 'fetch_failed' }
  }
}

/**
 * 主链路唯一入口：把投递挂到 waitUntil 上（响应先返回，运行时保活到 promise settle），
 * 没有 waitUntil 时退化为悬浮 promise。两条路径都 .catch 吞掉，保证不会变成
 * unhandled rejection，也不会影响已经构造好的下单响应。
 */
export function notifyNewOrder(order, env, waitUntil) {
  try {
    if (!webhookTarget(env)) return { scheduled: false, reason: 'not_configured' }
    const task = deliverNewOrder(env, order).then((r) => {
      if (!r.delivered && r.reason !== 'not_configured') {
        // 只记结论，不记载荷：订单数据不进日志
        console.warn(`[notify] 新订单通知未送达 order=${order?.id} reason=${r.reason}`)
      }
      return r
    })
    if (typeof waitUntil === 'function') {
      waitUntil(task)
      return { scheduled: true, reason: 'wait_until' }
    }
    return { scheduled: true, reason: 'detached' }
  } catch (e) {
    console.error('[notify] 通知调度异常（已吞，不影响下单）:', e instanceof Error ? e.message : String(e))
    return { scheduled: false, reason: 'schedule_failed' }
  }
}

/**
 * 两个下单出口（/pub 顾客下单、/web 管理端代客下单）共用的适配器。
 * 刻意做成一个函数两处调用：只在"真的新建了一张单"时通知——
 * `deduplicated` 命中是同一张单的重试，再通知一次就是重复提醒。
 */
export function maybeNotifyNewOrder(env, result, payload, waitUntil) {
  const data = result?.code === 0 ? result.data : null
  if (!data || !data.id || data.deduplicated) return { scheduled: false, reason: 'not_a_new_order' }
  return notifyNewOrder({
    id: data.id,
    roomNumber: typeof payload?.roomNumber === 'string' ? payload.roomNumber.trim() : '',
    totalAmount: data.totalAmount,
    items: Array.isArray(payload?.items) ? payload.items : [],
    status: 'pending',
  }, env, waitUntil)
}
