// Turnstile 校验的纯函数单测（注入 fetch，零网络）。
// 重点不是「验证通过」这一条，而是**降级方向**：未配置/上游异常都必须放行，
// 否则引入防护件本身就可能让顾客下不了单（那是比被刷更严重的故障）。
import { describe, it, expect, vi } from 'vitest'
import { verifyTurnstile, needsCaptcha, CAPTCHA_PUBLIC_WRITE_ACTIONS } from '../functions/lib/turnstile.js'

const okFetch = (payload) => vi.fn(async () => ({ json: async () => payload }))

describe('verifyTurnstile', () => {
  it('未配置 secret ⇒ 放行且标 not_configured（渐进启用，不得挡站）', async () => {
    const r = await verifyTurnstile('', 'any-token')
    expect(r).toEqual({ ok: true, reason: 'not_configured' })
  })

  it('已配置但缺 token ⇒ 拒绝 missing_token', async () => {
    const r = await verifyTurnstile('sec', '')
    expect(r).toEqual({ ok: false, reason: 'missing_token' })
  })

  it('siteverify 回 success:true ⇒ 放行', async () => {
    const f = okFetch({ success: true })
    const r = await verifyTurnstile('sec', 'tk', { fetchImpl: f })
    expect(r).toEqual({ ok: true, reason: 'ok' })
    expect(f).toHaveBeenCalledTimes(1)
    // 秘密走 form-urlencoded body，不得出现在 URL 里（防日志泄密）
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(String(init.body)).toContain('secret=sec')
    expect(url).not.toContain('sec')
  })

  it('siteverify 回 success:false ⇒ 拒绝 invalid_token', async () => {
    const r = await verifyTurnstile('sec', 'tk', { fetchImpl: okFetch({ success: false }) })
    expect(r).toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('上游抛异常 ⇒ 放行且标 unavailable（人机验证不得成为可用性单点）', async () => {
    const f = vi.fn(async () => { throw new Error('ECONNRESET') })
    const r = await verifyTurnstile('sec', 'tk', { fetchImpl: f })
    expect(r).toEqual({ ok: true, reason: 'unavailable' })
  })

  it('上游回非 JSON ⇒ 放行且标 unavailable（形状守卫，禁硬崩）', async () => {
    const f = vi.fn(async () => ({ json: undefined }))
    const r = await verifyTurnstile('sec', 'tk', { fetchImpl: f })
    expect(r).toEqual({ ok: true, reason: 'unavailable' })
  })
})

describe('needsCaptcha', () => {
  it('三个公开写接口需要验证', () => {
    for (const a of ['createOrder', 'createSubmission', 'addPublicReview']) expect(needsCaptcha(a)).toBe(true)
  })
  it('读接口不需要验证（不得扩大拦截面）', () => {
    for (const a of ['getPublicProducts', 'getReviews', 'aiChat', 'getOrderStatus']) expect(needsCaptcha(a)).toBe(false)
  })
  it('清单是单一真相源', () => {
    expect(CAPTCHA_PUBLIC_WRITE_ACTIONS.size).toBe(3)
  })
})