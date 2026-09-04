// 安全设施层（从 backend.js 拆出，逻辑零改动）：
// 限流（KV→D1 降级链）、真实 IP、审计、图片/UGC 校验、鉴权角色、CORS 白名单

import { qFirst, qRun, nowISO } from './db.js'

// 公开 action 集合（checkAuth / handleAdmin / handlePublic 共用单源）
export const PUBLIC_ACTIONS = new Set([
  'createOrder', 'getReviews', 'createSubmission', 'addPublicReview',
  'getPublicProducts', 'getPublicCategories', 'aiChat',
])

// 恒定时间字符串比较，防时序侧信道攻击（替代 adminKey !== env.ADMIN_KEY）。
// Workers 运行时无 node:crypto 的 timingSafeEqual，这里用 XOR 累加 + 定长循环实现；
// 长度不等时直接返回 false（与 timingSafeEqual 抛错行为不同，但避免泄露机密内容）。
function constantTimeEqual(a, b) {
  const sa = typeof a === 'string' ? a : ''
  const sb = typeof b === 'string' ? b : ''
  const ea = new TextEncoder().encode(sa)
  const eb = new TextEncoder().encode(sb)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

// ---------- 限流（优先 Workers KV：跨实例、可故障转移，消除限流与业务共用 D1 的单点）----------
// RATE_KV 未绑定（本地 mock / 未配置）时回退 D1 rate_limits 表，保证契约与回滚兼容。
async function checkRateKV(kv, key, windowMs, max) {
  const t = Date.now()
  const raw = await kv.get(key)
  let rec = null
  if (raw) {
    try { rec = JSON.parse(raw) } catch { rec = null }
  }
  const valid = rec && typeof rec.count === 'number' && t <= rec.resetAt
  if (!valid) {
    await kv.put(key, JSON.stringify({ count: 1, resetAt: t + windowMs }), { expirationTtl: Math.ceil(windowMs / 1000) })
    return null
  }
  if (rec.count >= max) return { code: -1, message: '操作过于频繁，请稍后再试' }
  const ttl = Math.max(1, Math.ceil((rec.resetAt - t) / 1000))
  await kv.put(key, JSON.stringify({ count: rec.count + 1, resetAt: rec.resetAt }), { expirationTtl: ttl })
  return null
}

async function checkRateDB(DB, key, windowMs, max) {
  if (!DB) return null
  const t = Date.now()
  const row = await qFirst(DB, `SELECT count, resetAt FROM rate_limits WHERE bucket = ?`, [key])
  if (!row || t > row.resetAt) {
    await qRun(DB,
      `INSERT INTO rate_limits (bucket, count, resetAt) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, resetAt = excluded.resetAt`,
      [key, t + windowMs])
    return null
  }
  if (row.count >= max) return { code: -1, message: '操作过于频繁，请稍后再试' }
  await qRun(DB, `UPDATE rate_limits SET count = count + 1 WHERE bucket = ?`, [key])
  return null
}

async function checkRate(DB, kv, key, windowMs, max) {
  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
    try {
      return await checkRateKV(kv, key, windowMs, max)
    } catch (e) {
      // KV 限流失败（偶发瞬时异常）时优雅回退 D1，避免 1101 影响业务可用性
      console.error('[rate] KV 限流失败，回退 D1:', e)
      return checkRateDB(DB, key, windowMs, max)
    }
  }
  return checkRateDB(DB, key, windowMs, max)
}

export const RATE_LOGIN = { windowMs: 60000, max: 5 }
export const RATE_PUBLIC_WRITE = { windowMs: 60000, max: 20 }
export const RATE_AI = { windowMs: 60000, max: 20 }

// 提取真实客户端 IP：优先 CF-Connecting-IP（Cloudflare 注入，不可伪造），回退 x-forwarded-for
export function getClientIp(request) {
  if (!request || !request.headers) return 'unknown'
  const cf = request.headers.get('CF-Connecting-IP')
  if (cf) return String(cf).slice(0, 64)
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return String(xff).split(',')[0].trim().slice(0, 64)
  return 'unknown'
}

// ---------- 安全工具 ----------

// 密钥指纹（SHA-256 前 8 位 hex，审计用；不落原始密钥）
async function sha256Fingerprint(s) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s || '')))
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8)
  } catch {
    return ''
  }
}

// 审计日志：管理写操作 / 认证失败落 security_events 表
// 保留策略（2026-08-28）：写入后以 5% 概率裁剪 90 天前记录，控制表体积、防 D1 免费写配额(100k 行/天)被审计表吞掉。
// Pages 无 Cron Trigger，故用「写时采样」组合；另有 scripts/purge-security-events.mjs 可手动全量清理。
async function logSecurityEvent(DB, { ip = '', action = '', result = '', keyFingerprint = '', detail = '' }) {
  if (!DB) return
  try {
    await qRun(DB,
      `INSERT INTO security_events (ts, ip, action, result, keyFingerprint, detail) VALUES (?, ?, ?, ?, ?, ?)`,
      [nowISO(), String(ip).slice(0, 64), String(action).slice(0, 64), String(result).slice(0, 16),
        String(keyFingerprint).slice(0, 16), String(detail).slice(0, 500)])
    // 写时采样裁剪：每次写入 5% 概率触发，清理失败不影响审计主逻辑
    if (Math.random() < 0.05) {
      try {
        await qRun(DB, `DELETE FROM security_events WHERE ts < datetime('now', '-90 days')`)
      } catch (e2) {
        console.error('[audit] prune old security_events failed:', e2)
      }
    }
  } catch (e) {
    console.error('[audit] logSecurityEvent failed:', e)
  }
}

// 图片串 scheme 白名单：仅允许 data:image/(jpeg|png|webp|gif);base64 或 https 受信 URL。
// 阻止 javascript:/data:text/html 等注入向量（渲染侧未来改动也不会变成 XSS）。
export function isSafeImageUrl(url) {
  if (typeof url !== 'string' || !url) return false
  if (/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)) return true
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !!u.hostname
  } catch {
    return false
  }
}

// 图片数组校验：返回过滤后数组；发现非法项返回 null（调用方拒绝，不静默丢弃）
export function validateImages(images) {
  if (!Array.isArray(images)) return []
  const out = []
  for (const img of images) {
    if (typeof img !== 'string' || !isSafeImageUrl(img)) return null
    out.push(img)
  }
  return out
}

// 公开 UGC 内容校验：长度上限 + 基础注入关键词拦截
export function checkPublicText(text, maxLen) {
  const s = String(text || '')
  if (s.length > maxLen) return false
  const low = s.toLowerCase()
  return !low.includes('<script') && !low.includes('javascript:') && !low.includes('onerror=') && !low.includes('onload=')
}

// ---------- 鉴权 ----------
// 双密钥：ADMIN_KEY=全权限；可选 ADMIN_READONLY_KEY=只读（未配置时行为与单密钥完全一致）。
export function resolveRole(adminKey, env) {
  if (env.ADMIN_KEY && constantTimeEqual(adminKey, env.ADMIN_KEY)) return 'admin'
  if (env.ADMIN_READONLY_KEY && constantTimeEqual(adminKey, env.ADMIN_READONLY_KEY)) return 'readonly'
  return null
}

export function checkAuth(action, adminKey, env) {
  if (PUBLIC_ACTIONS.has(action)) return null
  // 统一错误回显，不泄露"未配置 ADMIN_KEY"等部署态信息
  if (!resolveRole(adminKey, env)) return { code: -1, message: '认证失败' }
  return null
}

// ---------- CORS ----------
// CORS 精准放行：仅允许白名单源（双前端部署 + 本地开发），不反射任意 Origin。
// 可经 env.ALLOWED_ORIGINS（逗号分隔）追加额外源。
const DEFAULT_ALLOWED_ORIGINS = [
  'https://supermarket-web.pages.dev',
  'https://lxh113377.github.io',
]

export function resolveCorsHeaders(request, env = {}) {
  const origin = request?.headers?.get?.('Origin') || ''
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])
  const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
  if (allowed.has(origin) || isLocalDev) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export { checkRate, checkRateKV, sha256Fingerprint, logSecurityEvent }
