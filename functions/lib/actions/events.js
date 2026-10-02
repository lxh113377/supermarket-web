// 订单事件时间线读接口（第六十一轮后续：event_log 读路径）。
//
// 写侧在 functions/lib/event_sink.js（drainAndStore）；本文件只读。
// 口径：按单查（orderId 必填，与 idx_event_log_order_ts 同向；全表扫会按扫描行
// 计入 D1 行数配额，故不提供无条件列表）。列天然无 PII（events.js 白名单 6 字段，
// 见 event_sink.js 头注；pii-inventory.md「覆盖表：event_log」）。
import { qAll } from '../db.js'
import { fail } from '../errors.js'
import { sanitizeTrace } from '../logger.js'

// 单单最多回多少行：正常单一生事件 <10 条（5 态状态机），100 是 10 倍余量，
// 且窄行远低于 D1 行数配额；default 50 是"一屏时间线"的产品取值。
// 注：limit-provenance.md 的八类形状目前不含 Math.min 钳位（CONST_RE 只认
// 行首 MAX|MIN|LIMIT… 前缀，SQL 侧是 LIMIT ? 占位无字面量）⇒ 这两值由本处注释
// 载明依据，不另立登记行（立了也没人读的行才是第二真相源）。
const EVENT_TIMELINE_LIMIT_DEFAULT = 50
const EVENT_TIMELINE_LIMIT_MAX = 100

export async function getEventTimeline(DB, payload = {}) {
  // 先洗再查（第六十四轮 M-64-1）：清洗后的值同时用于 SQL 绑定与 data.orderId 回显，
  // 于是"回显的串"与"真正查过的串"必然同一个 —— 分别洗两处迟早会分叉。
  // 真实订单号（o_/p_ + base36）过 `[\w:.-]` 白名单零损失 ⇒ 合法调用行为不变；
  // 纯空白入参洗成空串后走 missing_order_id，不再拿空格去查一遍空结果。
  const orderId = sanitizeTrace(String(payload.orderId || ''))
  if (!orderId) return fail('missing_order_id', '缺少 orderId')
  const n = Math.trunc(Number(payload.limit ?? EVENT_TIMELINE_LIMIT_DEFAULT))
  const limit = Number.isFinite(n)
    ? Math.min(Math.max(n, 1), EVENT_TIMELINE_LIMIT_MAX)
    : EVENT_TIMELINE_LIMIT_DEFAULT
  const rows = await qAll(
    DB,
    'SELECT type, at, orderId, status, totalAmount, discountAmount, createdAt'
    + ' FROM event_log WHERE orderId = ? ORDER BY at ASC, id ASC LIMIT ?',
    [orderId, limit],
  )
  return { code: 0, data: { orderId, events: rows } }
}
