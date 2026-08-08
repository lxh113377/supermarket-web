/**
 * 安全遥测埋点模块（P0-3）
 *
 * ⚠️ 与 shared.js 一样存在副本漂移风险：
 * 修改本文件后必须运行 npm run predeploy 同步到
 * admin-api/security.js 与 public-api/security.js
 *
 * 设计约束（见 docs/security/02-telemetry-and-alerting.md §3）：
 * 1. 绝不因日志失败而影响业务 —— 全程 try/catch 吞异常
 * 2. 必须 await（云函数 return 后未完成的异步可能不被执行），
 *    但加 1.5s 超时上限，避免拖慢业务响应
 * 3. 写入配额保护，防"日志放大攻击"打爆数据库与成本
 * 4. 只存密钥 SHA-256 前 8 位指纹，绝不存明文
 */
const crypto = require('crypto')

const COLLECTION = 'sm_security_events'

const EVENT_TYPES = {
  AUTH_SUCCESS: 'auth.success',      // 鉴权通过
  AUTH_FAIL: 'auth.fail',            // 鉴权失败 ← 爆破检测核心
  RATELIMIT_TRIP: 'ratelimit.trip',  // 限流触发
  ADMIN_ACTION: 'admin.action',      // 管理操作审计（增删改查）
  UNKNOWN_ACTION: 'unknown.action',  // 未知 action ← 端点枚举检测
  INPUT_REJECTED: 'input.rejected',  // 输入校验拒绝
  OVERSIZED: 'anomaly.oversized',    // 超大载荷
  CONFIG_RISK: 'config.risk',        // 配置风险（如密钥占位符未替换）
  INTERNAL_ERROR: 'error.internal',  // 内部异常
}

/** 密钥指纹：SHA-256 前 8 位。绝不存明文。 */
function keyFingerprint(key) {
  if (!key || typeof key !== 'string') return 'empty'
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)
}

/** IP 截断到 /24，用于抗动态 IP 的聚合 */
function truncateIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown'
  const m = String(ip).match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/)
  if (m) return `${m[1]}.${m[2]}.${m[3]}.0/24`
  // IPv6 取前 4 段
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + '::/64'
  return ip
}

function getUserAgent(context, event) {
  const h = (event && (event.headers || event.header)) || {}
  const ua = h['user-agent'] || h['User-Agent'] || ''
  return String(ua).slice(0, 200)
}

function genReqId() {
  return 'r_' + Math.random().toString(36).slice(2, 10)
}

// --- 写入限流：防止"日志放大攻击"打爆数据库与成本 ---
const writeWindow = { startedAt: Date.now(), count: 0 }
const MAX_WRITES_PER_MIN = 120

function allowWrite(severity) {
  const t = Date.now()
  if (t - writeWindow.startedAt > 60000) {
    writeWindow.startedAt = t
    writeWindow.count = 0
  }
  writeWindow.count += 1
  // critical/high 永不丢弃；其余超配额后丢弃
  if (severity === 'critical' || severity === 'high') return true
  return writeWindow.count <= MAX_WRITES_PER_MIN
}

/**
 * 记录安全事件。
 *
 * @param {object|null} db 云数据库实例。为 null（云环境初始化失败）时静默跳过，
 *                         绝不让安全日志影响业务主流程。
 * @param {object} evt 事件对象，字段见 docs/security/02 §2.1
 */
async function logSecurityEvent(db, evt) {
  try {
    if (!db) return
    const severity = evt.severity || 'info'
    if (!allowWrite(severity)) return

    const ip = evt.ip || 'unknown'
    const doc = {
      ts: new Date(),
      eventType: evt.eventType || 'unknown',
      severity,
      fn: evt.fn || 'unknown',
      action: String(evt.action || '').slice(0, 64),
      ip: String(ip).slice(0, 64),
      ipTrunc: truncateIp(ip),
      ua: evt.ua || '',
      authResult: evt.authResult || 'na',
      keyFp: evt.keyFp || '',
      reqId: evt.reqId || genReqId(),
      detail: evt.detail || {},
      createdAt: new Date(),
    }

    await Promise.race([
      db.collection(COLLECTION).add(doc),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
  } catch (e) {
    // 日志失败绝不能影响业务，仅打印到平台日志
    console.error('[security] log failed:', e && e.message)
  }
}

module.exports = {
  EVENT_TYPES,
  logSecurityEvent,
  keyFingerprint,
  truncateIp,
  getUserAgent,
  genReqId,
  SECURITY_COLLECTION: COLLECTION,
}
