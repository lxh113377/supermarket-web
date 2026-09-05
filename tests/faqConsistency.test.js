import { describe, it, expect } from 'vitest'
import { SUGGESTED_QUESTIONS, ASSISTANT_GREETING } from '../src/data/assistantFaq'
import { ruleAssistantReply } from '../functions/lib/dify'

// 规则版 FAQ 双端一致性护栏（L1，2026-09-05）
// 前端 src/data/assistantFaq.ts 提供引导语与快捷问题 chips，后端 functions/lib/dify.js RULE_FAQ
// 负责规则版实际回答，注释约定"改动需两侧同步"。本测试强制：每个前端建议问题必须能在
// 后端规则版命中非空回答，否则视为双端漂移（新增建议问题忘记补规则 → 立即红）。
describe('FAQ 双端一致性护栏', () => {
  it('每个快捷问题都能命中规则版回答（非兜底空串）', () => {
    for (const q of SUGGESTED_QUESTIONS) {
      const reply = ruleAssistantReply(q)
      expect(reply.trim(), `建议问题未命中规则版问答: "${q}"`).not.toBe('')
    }
  })

  it('营业时间问题命中营业规则', () => {
    expect(ruleAssistantReply('你们几点营业？')).toContain('营业时间')
  })

  it('支付问题命中支付规则', () => {
    expect(ruleAssistantReply('怎么付款，支持微信吗？')).toContain('支付')
  })

  it('配送问题命中配送规则', () => {
    expect(ruleAssistantReply('多久能送到？')).toContain('配送')
  })

  it('换货问题命中售后规则', () => {
    expect(ruleAssistantReply('买错了能退吗？')).toContain('售后')
  })

  it('引导语提及的核心能力均有后端规则覆盖', () => {
    // 引导语宣称可问"商品推荐、营业时间、配送和支付"——每条都必须能被规则命中
    expect(ruleAssistantReply('营业时间')).toContain('营业时间')
    expect(ruleAssistantReply('配送多久')).toContain('配送')
    expect(ruleAssistantReply('微信支付')).toContain('支付')
    expect(ASSISTANT_GREETING.length).toBeGreaterThan(10)
  })
})