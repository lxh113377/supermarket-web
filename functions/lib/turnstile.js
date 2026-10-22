// Turnstile 人机验证（Cloudflare 免费层 20 组件 / 验证次数不限）。
//
// 为什么加在 /pUblic 的三个写接口上：`createOrder` / `createSubmission` / `addPublicReview`
// 是本站唯一的免登录写入口，当前只靠 IP 限流（`rate:write:*`）。限流挡得住频率，
// 挡不住「换 IP 的脚本」；而这三个接口直接写 D1（下单、投稿、评价），是真实滥用面。
//
// 设计取舍（刻意保持「失败不挡站」）：
//   · **未配置即放行**：`env.TURNSTILE_SECRET` 不存在时本模块直接返回 ok=true，
//     并把 reason 标成 `not_configured`。理由 = 这是**渐进启用**的防护件：
//     没配 secret 的部署（本地 / stub / 回滚态）不能因为引入它而整站不能下单。
//   · **只验 token 存在性由 Cloudflare 判**：我们不自己做行为判定，避免造第二套规则。
//   · **网络/上游异常也不挡**：siteverify 取不到数时按 `unavailable` 放行并留痕，
//     与上一条同向 —— 人机验证的意义是抬脚本成本，不是把真实顾客锁在门外。
//   · 拒绝时返回**具名错误码** `captcha_failed`，前端能据此提示重试。

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * 校验 Turnstile token（纯网络调用 + 纯判定，无副作用）。
 * @param {string} secret   env.TURNSTILE_SECRET
 * @param {string|null} token 前端提交的 cf-turnstile-response
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [opts] 便于单测注入
 * @returns {Promise<{ok: boolean, reason: string}>}
 *   ok=true 的 reason ∈ ok / not_configured / unavailable；ok=false ∈ missing_token / invalid_token
 */
export async function verifyTurnstile(secret, token, opts = {}) {
  if (!secret) return { ok: true, reason: 'not_configured' }
  const tk = typeof token === 'string' ? token.trim() : ''
  if (!tk) return { ok: false, reason: 'missing_token' }

  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const timeoutMs = opts.timeoutMs || 5000
  const body = new URLSearchParams({ secret, response: tk })
  let timer = null
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    if (ctrl) timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    })
    if (!res || typeof res.json !== 'function') return { ok: true, reason: 'unavailable' }
    const data = await res.json()
    return data && data.success === true
      ? { ok: true, reason: 'ok' }
      : { ok: false, reason: 'invalid_token' }
  } catch {
    // 超时 / DNS / 上游 5xx 一律放行并留痕：人机验证不该成为可用性的单点。
    return { ok: true, reason: 'unavailable' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 需要人机验证的公开写接口（单一真相源，供 handler 与文档共用）。 */
export const CAPTCHA_PUBLIC_WRITE_ACTIONS = new Set(['createOrder', 'createSubmission', 'addPublicReview'])

/**
 * 判断某个 public action 是否需要验 token。
 * @param {string} action
 * @returns {boolean}
 */
export function needsCaptcha(action) {
  return CAPTCHA_PUBLIC_WRITE_ACTIONS.has(action)
}
