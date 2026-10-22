// Turnstile 前端取 token 的降级行为单测（jsdom，不碰真网络）。
// 重点不是「能拿到 token」，而是**拿不到时不许挡站**：
// 未配 sitekey / 脚本加载失败 / 超时 都必须返回空串，由后端决定放行。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = import.meta.env.VITE_TURNSTILE_SITEKEY

function setSitekey(v: string | undefined) {
  if (v === undefined) delete import.meta.env.VITE_TURNSTILE_SITEKEY
  else import.meta.env.VITE_TURNSTILE_SITEKEY = v
}

describe('isCaptchaAction', () => {
  it('三个写接口需要 token', async () => {
    const { isCaptchaAction } = await import('../src/utils/turnstile')
    for (const a of ['createOrder', 'createSubmission', 'addPublicReview']) expect(isCaptchaAction(a)).toBe(true)
  })
  it('读接口不取 token（不扩大拦截面）', async () => {
    const { isCaptchaAction } = await import('../src/utils/turnstile')
    for (const a of ['getPublicProducts', 'getReviews', 'getOrderStatus', 'aiChat']) expect(isCaptchaAction(a)).toBe(false)
  })
})

describe('getCaptchaToken 降级', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { setSitekey(ORIGINAL_ENV) })

  it('未配 sitekey ⇒ 空串（与后端 not_configured 同向）', async () => {
    setSitekey(undefined)
    const { getCaptchaToken } = await import('../src/utils/turnstile')
    expect(await getCaptchaToken(50)).toBe('')
  })

  it('脚本加载失败 ⇒ 空串（不阻断下单）', async () => {
    setSitekey('0xTESTKEY')
    const { getCaptchaToken } = await import('../src/utils/turnstile')
    // jsdom 不会真的加载远端脚本；等 onerror 或超时都应收敛到空串
    const token = await getCaptchaToken(120)
    expect(token).toBe('')
  })
})
