// 双向迭代 R3（2026-09-18）：AI 三态「结构契约」守护。
// 不追求文本一致，只钉结构：键齐全、source 属白名单、content 恒为非空字符串、三态键集合一致。
// 价值：Dify 生产接入 / 换模型 / 调 prompt 时，结构破坏当场红灯，不会静默把空白卡片渲染给用户。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { pubAiChat, adminAiAdvice } from '../functions/lib/actions/ai.js'
import { AI_SOURCES } from '../functions/lib/ai_trace.js'
import { fakeDb } from './helpers/fakeDb.js'

const BASE = 'https://dify.example.internal'
const CHAT_KEY = 'app-chat-key-secret-value'
const ADVICE_KEY = 'app-advice-key-secret-value'

const okFetch = async () => ({
  ok: true,
  json: async () => ({ answer: '这是 AI 的回答', conversation_id: 'cid-9' }),
})
const failFetch = async () => {
  throw new Error('network unreachable')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI 三态结构契约', () => {
  const chatCases = [
    ['rule', {}, null],
    ['dify', { DIFY_BASE_URL: BASE, DIFY_CHAT_APP_KEY: CHAT_KEY }, okFetch],
    ['dify-error', { DIFY_BASE_URL: BASE, DIFY_CHAT_APP_KEY: CHAT_KEY }, failFetch],
  ]

  it('顾客端 aiChat：三态键集合一致 + source 白名单 + content 恒非空', async () => {
    const shapes = []
    for (const [expectSource, env, impl] of chatCases) {
      if (impl) vi.stubGlobal('fetch', vi.fn(impl))
      const res = await pubAiChat(env, fakeDb(), { question: '你们几点营业' }, '1.2.3.4')
      expect(res.code, `场景 ${expectSource}`).toBe(0)
      expect(res.data.source, `场景 ${expectSource}`).toBe(expectSource)
      expect(AI_SOURCES).toContain(res.data.source)
      expect(typeof res.data.content).toBe('string')
      expect(res.data.content.length).toBeGreaterThan(0)
      shapes.push(Object.keys(res.data).sort().join(','))
    }
    expect(new Set(shapes).size).toBe(1)
    expect(shapes[0]).toBe('content,conversationId,source')
  })

  const adviceCases = [
    ['rule', {}, null],
    ['dify', { DIFY_BASE_URL: BASE, DIFY_ADVICE_APP_KEY: ADVICE_KEY }, okFetch],
    ['dify-error', { DIFY_BASE_URL: BASE, DIFY_ADVICE_APP_KEY: ADVICE_KEY }, failFetch],
  ]

  it('管理端 aiAdvice：三态键集合一致 + source 白名单 + content 恒非空', async () => {
    const shapes = []
    for (const [expectSource, env, impl] of adviceCases) {
      if (impl) vi.stubGlobal('fetch', vi.fn(impl))
      const res = await adminAiAdvice(env, fakeDb())
      expect(res.code, `场景 ${expectSource}`).toBe(0)
      expect(res.data.source, `场景 ${expectSource}`).toBe(expectSource)
      expect(AI_SOURCES).toContain(res.data.source)
      expect(typeof res.data.content).toBe('string')
      expect(res.data.content.length).toBeGreaterThan(0)
      shapes.push(Object.keys(res.data).sort().join(','))
    }
    expect(new Set(shapes).size).toBe(1)
    expect(shapes[0]).toBe('content,source')
  })

  it('dify-error 时不得把 [DIFY_ERROR] 之外的异常细节带出（防腐层约定）', async () => {
    vi.stubGlobal('fetch', vi.fn(failFetch))
    const res = await pubAiChat({ DIFY_BASE_URL: BASE, DIFY_CHAT_APP_KEY: CHAT_KEY }, fakeDb(), { question: 'hi' }, '1.1.1.1')
    expect(res.data.source).toBe('dify-error')
    expect(res.data.content).not.toMatch(/Bearer|app-chat-key|http:\/\/|https:\/\//i)
  })

  it('空问题直接拒绝，不进入 AI 链路', async () => {
    const res = await pubAiChat({}, fakeDb(), { question: '   ' }, '1.1.1.1')
    expect(res.code).toBe(-1)
  })
})
