// 事件总线第 3 步：消费者（第六十轮 M-59-1 落地）。
//
// 为什么落 D1 而不是外发：notify.js 的 webhook 只管"新订单提醒"且未配置即 no-op；
// 事件队列是"发生过什么"的追溯面 —— 落库后才有"某单经历过哪些事件"可查，
// 这正是 grocy stock_log / InvenTree StockItemTracking 相对本仓多出来的那一半
// （stock_movements 只记库存账，订单/评价/提交通知事件此前喊完即散）。
//
// 安全形状（与 emit 的白名单同源）：队列里本来就没有 PII（events.js 只收
// type/at/orderId/status/totalAmount/discountAmount，微信号/备注/房间号一律不进），
// 落库只是把队列里的同一批字段原样存下，不新增任何外发面。
// 失败语义：响应已经构造完才调这里，落库失败只记日志，绝不碰响应体。
import { drainEvents } from './events.js'
import { logWarn, logError } from './logger.js'

/** 取出本批事件并逐条 INSERT。空队列零写盘；D1 未绑定直接 no-op（告警一行）。 */
export async function drainAndStore(DB) {
  const events = drainEvents()
  if (!events.length) return { stored: 0 }
  if (!DB) {
    logWarn('event_sink', '队列非空但 D1 未绑定，本批事件丢弃', { count: events.length })
    return { stored: 0, reason: 'db_unbound' }
  }
  const stmt = DB.prepare(
    'INSERT INTO event_log (type, at, orderId, status, totalAmount, discountAmount, createdAt)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const now = new Date().toISOString()
  let stored = 0
  for (const e of events) {
    await stmt.bind(
      String(e.type ?? ''),
      String(e.at ?? now),
      String(e.orderId ?? ''),
      String(e.status ?? 'pending'),
      Number(e.totalAmount) || 0,
      Number(e.discountAmount) || 0,
      now,
    ).run()
    stored += 1
  }
  return { stored }
}

/**
 * 端点层唯一入口（pub.js / web.js 在响应定稿后调）。
 * 挂 waitUntil 上：运行时保活到落库完成，不占响应延迟；没有 waitUntil 时退化为
 * 悬浮 promise —— catch 已就地附上，不会变成 unhandled rejection。
 */
export function scheduleSink(env, holdOpen) {
  try {
    const task = drainAndStore(env ? env.DB : null).catch((e) => {
      try {
        logError('event_sink', '事件落库失败（响应不受影响）', { err: e })
      } catch { /* 日志自身也不可用时放弃 */ }
    })
    if (typeof holdOpen === 'function') holdOpen(task)
  } catch { /* 调度自身永不影响主链路 */ }
}
