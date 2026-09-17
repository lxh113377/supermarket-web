// 双向迭代 R4（2026-09-18）：AI 调用留痕。
// 借鉴门店 ai_trace：每次调用落一行，产出可用率 / 平均延迟 / 回退次数。
// 本套断言同时钉死两条边界：① keyFp 绝不落明文；② 留痕失败绝不影响主流程。
import { describe, it, expect } from 'vitest'
import { traceAiCall, aiCallStats, AI_SOURCES } from '../functions/lib/ai_trace.js'
import { pubAiChat } from '../functions/lib/actions/ai.js'
import { fakeDb } from './helpers/fakeDb.js'

const KEY = 'app-sk-plain-secret-abcdef'

describe('traceAiCall', () => {
  it('写入一行，字段与入参一致', async () => {
    const inserts = []
    const ts = await traceAiCall(fakeDb({ inserts }), {
      scene: 'aiChat',
      source: 'dify',
      ok: true,
      fallback: false,
      latencyMs: 1234.6,
      tokens: 321,
      keyFp: 'abcd1234',
    })
    expect(ts).toBeTruthy()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].sql).toContain('ai_calls')
    const p = inserts[0].params
    expect(p[0]).toBe(ts)
    expect(p[1]).toBe('aiChat')
    expect(p[2]).toBe('dify')
    expect(p[3]).toBe(1)
    expect(p[4]).toBe(0)
    expect(p[5]).toBe(1235) // 延迟取整
    expect(p[6]).toBe(321)
  })

  it('source 三态均可留痕（rule 也要留，否则"是否真在用 AI"无从自证）', async () => {
    for (const source of AI_SOURCES) {
      const inserts = []
      await traceAiCall(fakeDb({ inserts }), { scene: 'aiAdvice', source, ok: source !== 'dify-error', fallback: source !== 'dify' })
      expect(inserts[0].params[2]).toBe(source)
    }
  })

  it('脱敏：传 keyRaw 时只落指纹，绝不落明文密钥', async () => {
    const inserts = []
    await traceAiCall(fakeDb({ inserts }), { scene: 'aiChat', source: 'dify', ok: true, keyRaw: KEY })
    const fp = inserts[0].params[7]
    expect(fp).not.toBe(KEY)
    expect(String(fp)).not.toContain(KEY)
    expect(KEY).not.toContain(String(fp)) // 指纹不应等于原文的任意子串
  })

  it('留痕失败（D1 写入异常）不抛错，返回 null', async () => {
    await expect(
      traceAiCall(fakeDb({ failInsert: true }), { scene: 'aiChat', source: 'rule', ok: true }),
    ).resolves.toBeNull()
  })

  it('DB 缺失时静默跳过', async () => {
    await expect(traceAiCall(null, { scene: 'aiChat', source: 'rule', ok: true })).resolves.toBeNull()
  })
})

describe('handler 端到端留痕', () => {
  it('规则版分支也留痕（scene=aiChat / source=rule / fallback=1）', async () => {
    const inserts = []
    const res = await pubAiChat({}, fakeDb({ inserts }), { question: '营业时间' }, '1.2.3.4')
    expect(res.code).toBe(0)
    expect(res.data.source).toBe('rule')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].params[1]).toBe('aiChat')
    expect(inserts[0].params[2]).toBe('rule')
    expect(inserts[0].params[4]).toBe(1) // fallback
  })

  it('留痕失败不影响主流程：DB 写入异常时仍返回正常结果', async () => {
    const res = await pubAiChat({}, fakeDb({ failInsert: true }), { question: '配送多久' }, '1.2.3.4')
    expect(res.code).toBe(0)
    expect(res.data.source).toBe('rule')
    expect(res.data.content.length).toBeGreaterThan(0)
  })
})

describe('aiCallStats', () => {
  it('可用率 / 平均延迟 / 回退次数统计正确', async () => {
    const stats = await aiCallStats(
      fakeDb({
        aiCalls: [{ ts: '2026-09-18T10:00:00.000Z', scene: 'aiChat', source: 'dify', ok: 1, fallback: 0, latencyMs: 1000 }],
        agg: { total: 4, okCount: 3, fallbackCount: 2, avgLatency: 1500 },
      }),
      20,
    )
    expect(stats.total).toBe(4)
    expect(stats.okRate).toBeCloseTo(0.75)
    expect(stats.avgLatencyMs).toBe(1500)
    expect(stats.fallbackCount).toBe(2)
    expect(stats.recent).toHaveLength(1)
  })

  it('无数据 / 无 DB 时返回空结构而不抛错', async () => {
    const empty = await aiCallStats(fakeDb(), 20)
    expect(empty).toEqual({ total: 0, okRate: null, avgLatencyMs: null, fallbackCount: 0, recent: [] })
    expect(await aiCallStats(null)).toEqual({ total: 0, okRate: null, avgLatencyMs: null, fallbackCount: 0, recent: [] })
  })
})
