// 结构化日志出口（第五十九轮 H-59-1）。
//
// 一手动因（本轮实测，不是假想）：functions/ 里 20 处失败出口写的是
// `console.error('[admin]', action, e)` 这种**给人看的**形态。Cloudflare Pages 把 console
// 输出原样送进日志面，于是一条故障在检索侧只剩「[admin] createOrder Error: ...」这样一行
// 前缀 + 自由文本：按 level 筛不了、按 action 聚合不了、traceId 无处附着，
// 而 `'[cache] put failed:', key` 把 `rate:login:<ip>` 整串打出去 —— 那串是登记册里的个人数据
// （docs/pii-inventory.md 的 `bucket` 行自己写着「这列就是明文 IP」）。
// 「线上异常无据可查」这条挂了六轮，缺的就是一个统一出口。
//
// 对标：`medusajs/medusa` 的 withLogger（level + 模块名 + 结构化 metadata）、
// `frappe/erpnext` 的 `frappe.logger(json=True)`、`saleor/saleor` 的 Sentry tag 关联、
// `macrozheng/mall` 的 logback pattern + traceId（TLog）。
// 本项目无常驻进程、接不到 ELK，所以取它们里**免费层就能成立**的那三件：
// ① 一行一条 JSON（可被 Tail/日志面按字段检索）；② 稳定字段名（ts/level/mod/msg + fields）；
// ③ 个人数据在离开应用代码前就 redact（不是指望运维不去查）。
//
// 兼容性红线：本文件是 functions/ 里**唯一**允许直接触 console 的地方，
// 由 `npm run verify:logs` 的 L1 双向对账钉住。日志只增不断 —— 输出形态变化不影响任何响应体。

/**
 * 等级只有两档，且这是"够用"而不是"精简"：`functions/` 现存 20 处失败出口全部落在 warn/error，
 * 没有 info 级诉求（要记业务流水属另一件事 —— `ai_trace.js` 的 D1 埋点已经承担）。
 * 第三档 `console.log` 同时被本仓 oxlint 的 `no-console` 判为不允许，硬加一档只会多一条豁免。
 */
export const LEVELS = { warn: 30, error: 40 }

/**
 * 必须在离开应用代码前 redact 的键。
 * 口径不由这里定：`docs/pii-inventory.md`（唯一真相源）里类别为「个人数据」「凭证」的**每个列名**
 * 都必须出现在本集合，`npm run verify:logs` 的 L5 双向对账钉住两个方向 ——
 * 登记册有而这里没有 ⇒ 红（新加敏感列却忘进洗白名单）；这里有而登记册和补充册都没有 ⇒ 也判红（幽灵键，白拦一个不存在的字段）。
 * 从未入库但会流经代码的 4 个键（`phone`/`address`/`adminKey`/`password`）在 docs/logging.md 的补充册里逐个给理由。
 */
export const PII_KEYS = new Set([
  // 登记册：orders
  'roomNumber', 'items', 'wechat', 'remark', 'paymentScreenshot', 'createdAt',
  // 登记册：reviews / submissions
  'user', 'text', 'images', 'formData',
  // 登记册：security_events / ai_calls / rate_limits / stock_movements
  'ip', 'keyFingerprint', 'detail', 'keyFp', 'bucket', 'note',
  // 补充册（非入库键，理由见 docs/logging.md）
  'phone', 'address', 'adminKey', 'password',
])

/** IPv4 / IPv6 形状：串里嵌着的也要洗（key=rate:login:1.2.3.4 这类）。 */
const IP_PATTERNS = [
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  /\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g,
]

function scrubIps(str) {
  let out = str
  for (const re of IP_PATTERNS) out = out.replace(re, '[ip]')
  return out
}

/** 单字段收口：PII 键整值替换，其余标量截断到 300 字，Error 取 name+message。 */
export function scrubValue(key, value) {
  if (PII_KEYS.has(key)) return '[redacted]'
  if (value instanceof Error) return scrubIps(`${value.name}: ${value.message}`.slice(0, 300))
  if (typeof value === 'string') return scrubIps(value.slice(0, 300))
  if (value === null || typeof value !== 'object') return value
  try {
    return scrubIps(JSON.stringify(value).slice(0, 300))
  } catch {
    return '[unserializable]'
  }
}

/** 逐键洗 fields：命中 PII 名的键保留（让运维知道有该字段被拦），值换成占位。 */
export function redactFields(fields = {}) {
  const out = {}
  for (const [k, v] of Object.entries(fields || {})) out[k] = scrubValue(k, v)
  return out
}

/**
 * 关联标识：Pages Functions 拿得到边缘节点写的 `cf-ray`，优先复用它，
 * 于是「顾客报障截图上的时间」可以对着同一时刻的日志行查（对标 Stripe 的 request-id）。
 * 本地 wrangler / 单测环境没有这个头 —— 返回空串而不是编一个，避免把假 traceId 当线索。
 *
 * 出口一律过 `sanitizeTrace`：`x-request-id` 是**请求方自己就能写**的头，原样返回等于让
 * 它决定日志字段与响应体的内容（第六十轮实测：5000 字头 ⇒ 5000 字 trace，绕开本文件
 * 对其余每个字段都执行的 300 字截断）。收口放在这里而不是两个消费点各收一遍 ——
 * 日志侧（buildRecord 的 trace）与响应侧（errors.js 的 withTrace）共用同一个生产者。
 */
export function traceIdOf(request) {
  const h = request && typeof request.headers?.get === 'function' ? request.headers : null
  return sanitizeTrace((h && (h.get('cf-ray') || h.get('x-request-id'))) || '')
}

/**
 * 把外部可写的标识收成「可安全出现在一行 JSON 与一段响应体里」的形态：
 * ① 洗 IP 形状（本文件对每个字符串字段执行的同一条口径，trace 不开例外）；
 * ② 剔掉白名单 `[\w:.-]` 之外的字符（换行/引号/花括号/空格一律不留）；
 * ③ 截到 64 字（cf-ray 实测形态 32hex-机场码 远小于此；与 orders.js 的 requestId 64 同族）。
 * 顺序不可换：先洗 IP 再过白名单，`[ip]` 的方括号会被剔成 `ip` —— 单测按这个口径钉。
 * 清洗后为空一律返回空串 ⇒ 日志与响应两端同时省略 trace 键，不留 `trace:""` 这种假关联。
 */
export function sanitizeTrace(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return ''
  return scrubIps(String(raw)).replace(/[^\w:.-]/g, '').slice(0, 64)
}

/**
 * 组装一行日志对象（导出供单测直接判形状，不必劫持 console）。
 * @param {string} level
 * @param {string} mod
 * @param {string} msg
 * @param {Record<string, unknown>} [fields]
 * @param {string} [at]
 */
export function buildRecord(level, mod, msg, fields = {}, at = new Date().toISOString()) {
  const rec = { ts: at, level, mod, msg: scrubIps(String(msg ?? '')) }
  const trace = fields && fields.trace !== undefined ? fields.trace : undefined
  const rest = { ...(fields || {}) }
  delete rest.trace
  // 出口自己再收一次：现存 4 个调用点都从 traceIdOf 拿值，但"trace 已 sanitize"这条
  // 不变式若只活在生产者一侧，下一个调用点随手传个用户输入就能作废它 —— 与 msg/fields 同等待遇。
  const safeTrace = sanitizeTrace(trace)
  if (safeTrace) rec.trace = safeTrace
  for (const [k, v] of Object.entries(redactFields(rest))) {
    if (k === 'ts' || k === 'level' || k === 'mod' || k === 'msg') continue
    rec[k] = v
  }
  return rec
}

/** 落一行 JSON；换行在字符串里已被 JSON 转义，所以一条记录恒为一行。 */
export function emit(level, rec) {
  const line = JSON.stringify(rec)
  if (level === 'error') console.error(line)
  else console.warn(line)
}

function log(level, mod, msg, fields = {}) {
  try {
    emit(level, buildRecord(level, mod, msg, fields))
  } catch {
    // 日志绝不能把主流程带下去：errors.js 的 fail() 就在日志路径上，这里一抛
    // 等于把「记不上日志」升级成「鉴权链 500」。降级成最朴素的单串，且不再进本函数。
    try {
      console.error(`[logger] 降级输出 mod=${mod} msg=${msg}`)
    } catch { /* 连 console 都没有（极端沙箱）：放弃本次记录 */ }
  }
}

export const logWarn = (mod, msg, fields) => log('warn', mod, msg, fields || {})
export const logError = (mod, msg, fields) => log('error', mod, msg, fields || {})
