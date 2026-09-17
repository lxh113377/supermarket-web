import { describe, it, expect } from 'vitest'
import { onRequestGet } from '../functions/_health.js'

// 双向迭代 R5（2026-09-18）：钉住 /_health 的契约与脱敏边界。
// 背景：改 Pages secret 后必须重新部署才生效（坑19），且 AI 可能静默降级为规则版；
// 本测试保证探活端点既能暴露这两种状态，又绝不回显密钥或端点地址。
const SECRET_URL = 'https://dify.example.internal/v1'
const SECRET_KEY = 'app-sk-unsafe-value-123456'

function makeEnv({ dify = true, dbOk = true } = {}) {
  return {
    DB: {
      prepare: () => ({
        first: async () => {
          if (!dbOk) throw new Error('D1 unavailable')
          return { ok: 1 }
        },
      }),
    },
    ...(dify ? { DIFY_BASE_URL: SECRET_URL, DIFY_CHAT_APP_KEY: SECRET_KEY } : {}),
    CF_PAGES_COMMIT_SHA: 'abcdef1234567890',
  }
}

async function call(env) {
  const res = await onRequestGet({ env })
  // Response body 只能读一次：先取文本，再由文本解析 JSON。
  const raw = await res.text()
  return { body: JSON.parse(raw), raw }
}

describe('_health 契约', () => {
  it('返回状态/D1/时间戳/AI 配置态/部署版本', async () => {
    const { body } = await call(makeEnv())
    expect(body.status).toBe('ok')
    expect(body.db).toBe('ok')
    expect(typeof body.ts).toBe('string')
    expect(body.ai).toEqual({ configured: true, source: 'dify' })
    expect(body.deploy).toBe('abcdef1')
  })

  it('未配置 Dify 时标记为规则版（configured=false, source=rule）', async () => {
    const { body } = await call(makeEnv({ dify: false }))
    expect(body.ai).toEqual({ configured: false, source: 'rule' })
  })

  it('D1 异常时 db=error 但端点本身仍 200（探活只报告不掩盖）', async () => {
    const { body } = await call(makeEnv({ dbOk: false }))
    expect(body.db).toBe('error')
    expect(body.status).toBe('ok')
  })

  it('脱敏：响应体绝不出现密钥或 Dify 端点地址', async () => {
    const { raw } = await call(makeEnv())
    expect(raw).not.toContain(SECRET_KEY)
    expect(raw).not.toContain(SECRET_URL)
    expect(raw).not.toContain('sk-unsafe')
  })
})
