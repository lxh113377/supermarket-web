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

// ── 出境面收敛（第二十四轮 H7）────────────────────────────────────────
// 上一轮登记册把 orders.wechat / orders.remark 标成"出境=是"，凭据是"aiAdvice 的 SELECT 带了这两列"。
// 本轮按数据流重测：那两列只存在于**投影**里，`buildAdviceInput` 只回传聚合量 ⇒ 值从未进入请求体。
// 下面两条把这件事从"我读了代码"变成"我打了真链路"：
//  ① 线级：故意让假 DB 无视投影、把整行（含微信号/备注/房间号）都交给 adminAiAdvice，
//     断言发给 Dify 的 body 里一个标记都找不到（且必须找得到聚合量，否则"没有"是空扫）；
//  ② 等价：同一批订单，"全列行"与"收敛后的三列行"生成的 prompt **逐字节相同** ⇒ 收敛不改分析结果。
// 之所以能被"无视投影"的假 DB 测出来，正因为边界在 buildAdviceInput 而不在 SQL —— 这条判据因此
// 同时证明：即使有人把列加回 SELECT，只要他不改 buildAdviceInput，值仍然不出境；
// 而"把列加回 SELECT"这一步由 check-pii-inventory.mjs 的 P12 当场判红。
describe('出境面收敛：aiAdvice 的 Dify 请求体不含订单个人数据', () => {
  const ordersFull = [
    { _id: 'o1', roomNumber: 'B3-1201', items: [{ name: '乌龙茶', spec: '500ml', price: 6, quantity: 3 }], totalAmount: 18, status: 'paid', createdAt: new Date().toISOString(), wechat: 'wx_planted_secret_id', remark: '备注里有电话13800001111', updatedAt: new Date().toISOString() },
    { _id: 'o2', roomNumber: 'A1-502', items: [{ name: '气泡水', spec: '', price: 5, quantity: 2 }], totalAmount: 10, status: 'paid', createdAt: new Date().toISOString(), wechat: 'wx_another_secret', remark: '', updatedAt: new Date().toISOString() },
  ]
  const PROJECTION = ['items', 'totalAmount', 'createdAt']
  const env = { DIFY_BASE_URL: BASE, DIFY_ADVICE_APP_KEY: ADVICE_KEY }

  const capturePrompt = async (orders) => {
    const bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(String(init?.body || '')); return okFetch() }))
    const res = await adminAiAdvice(env, fakeDb({ orders, reviews: [{ rating: 2 }, { rating: 5 }], products: [{ _id: 'p1' }] }))
    expect(res.data.source).toBe('dify')
    return bodies
  }

  afterEach(() => vi.unstubAllGlobals())

  it('线级：整行都递进来也不出境（正向对照=聚合量确实在 body 里）', async () => {
    const bodies = await capturePrompt(ordersFull)
    expect(bodies.length).toBe(1)
    const body = bodies[0]
    for (const marker of ['wx_planted_secret_id', 'wx_another_secret', '13800001111', 'B3-1201', 'A1-502', 'paid', 'o1']) {
      expect(body, `个人数据标记「${marker}」出现在发给第三方的请求体里`).not.toContain(marker)
    }
    // 非空扫：分析确实算出了东西并随请求出去
    expect(body).toContain('revenue')
    expect(body).toContain('乌龙茶')
  })

  it('等价：收敛前（全列）与收敛后（三列）的 prompt 逐字节相同', async () => {
    const before = await capturePrompt(ordersFull)
    const after = await capturePrompt(ordersFull.map((o) => Object.fromEntries(PROJECTION.map((k) => [k, o[k]]))))
    expect(after[0]).toBe(before[0])
    expect(after[0].length).toBeGreaterThan(40)
  })
})
