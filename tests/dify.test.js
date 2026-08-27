// AI 防腐层单测： functions/lib/dify.js 纯函数（不触发网络）
import { describe, it, expect } from 'vitest'
import {
  isDifyError,
  sanitize,
  CircuitBreaker,
  ruleAssistantReply,
  ruleAdvice,
  buildAdviceInput,
  DIFY_ERROR_PREFIX,
  DIFY_UNAVAILABLE_TEXT,
} from '../functions/lib/dify.js'

describe('isDifyError / 脱敏标记', () => {
  it('命中 [DIFY_ERROR] 前缀 → true', () => {
    expect(isDifyError(`${DIFY_ERROR_PREFIX} ${DIFY_UNAVAILABLE_TEXT}`)).toBe(true)
    expect(isDifyError('  [DIFY_ERROR] something')).toBe(true)
  })

  it('普通文本 / 空 / 非字符串 → false', () => {
    expect(isDifyError('AI 服务正常回复')).toBe(false)
    expect(isDifyError('')).toBe(false)
    expect(isDifyError(null)).toBe(false)
    expect(isDifyError(undefined)).toBe(false)
  })

  it('降级文案不含异常细节 / Key（防腐层约定）', () => {
    expect(DIFY_UNAVAILABLE_TEXT).not.toMatch(/DIFY_/)
    expect(DIFY_UNAVAILABLE_TEXT).not.toMatch(/Bearer|token|http|error/i)
  })
})

describe('sanitize', () => {
  it('trim + 长度钳制', () => {
    expect(sanitize('  你好  ')).toBe('你好')
    expect(sanitize('a'.repeat(300), 200)).toHaveLength(200)
    expect(sanitize(null)).toBe('')
    expect(sanitize(123)).toBe('')
  })
})

describe('CircuitBreaker', () => {
  it('连续失败达阈值后熔断，冷却后半开试探并复位', () => {
    const cb = new CircuitBreaker(3, 5000)
    expect(cb.allow()).toBe(true)
    cb.onFailure()
    cb.onFailure()
    cb.onFailure() // 达阈值 → 熔断开启
    expect(cb.allow()).toBe(false)
    // 冷却窗口内仍拒绝
    expect(cb.allow()).toBe(false)
    // 冷却结束（模拟时间跨过）：强制更新 openedAt
    cb.openedAt = Date.now() - 6000
    expect(cb.allow()).toBe(true) // 半开试探放行
    cb.onSuccess() // 试探成功 → 复位
    expect(cb.allow()).toBe(true)
  })
})

describe('ruleAssistantReply（顾客端规则版导购）', () => {
  const products = [{ name: '冰可乐' }, { name: '薯片' }]

  it('营业时间 FAQ 命中，带热销推荐', () => {
    const r = ruleAssistantReply('你们几点营业？', products)
    expect(r).toContain('08:00')
    expect(r).toContain('冰可乐')
  })

  it('支付 FAQ 命中', () => {
    const r = ruleAssistantReply('怎么付款，支持微信吗？', products)
    expect(r).toContain('微信支付')
  })

  it('未知问题走兜底引导', () => {
    const r = ruleAssistantReply('今天天气怎么样', products)
    expect(r).toContain('营业时间')
    expect(r).toContain('热销')
  })

  it('无商品时兜底不崩溃', () => {
    const r = ruleAssistantReply('随便问问')
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('ruleAdvice（管理端规则版经营建议）', () => {
  const orders = [
    { totalAmount: 100, items: [{ name: '冰可乐', quantity: 3 }] },
    { totalAmount: 60, items: [{ name: '薯片', quantity: 2 }] },
    { totalAmount: 40, items: [{ name: '冰可乐', quantity: 1 }] },
  ]
  const reviews = [
    { rating: 1 },
    { rating: 5 },
  ]

  it('近 30 天汇总 + 热销 TOP + 低分提醒', () => {
    const r = ruleAdvice({ orders30: orders, reviews })
    expect(r).toContain('近 30 天')
    expect(r).toContain('冰可乐')
    expect(r).toContain('1 条低分评价')
  })

  it('无订单时返回引导文案', () => {
    const r = ruleAdvice({ orders30: [], reviews: [] })
    expect(r).toContain('暂无近 30 天订单')
  })
})

describe('buildAdviceInput（Dify 结构化输入）', () => {
  const orders = [
    { totalAmount: 100, items: [{ name: '奶茶', quantity: 2 }, { name: '薯片', quantity: 1 }] },
    { totalAmount: 30, items: [{ name: '奶茶', quantity: 1 }] },
  ]
  const reviews = [{ rating: 1 }, { rating: 4 }, { rating: 5 }]

  it('营收/订单/热销排序/均分/低分计数正确', () => {
    const input = buildAdviceInput(orders, reviews, [{ _id: 'p1' }])
    expect(input.days).toBe(30)
    expect(input.orders).toBe(2)
    expect(input.revenue).toBe(130)
    expect(input.topProducts[0].name).toBe('奶茶')
    expect(input.topProducts[0].qty).toBe(3)
    expect(input.avgRating).toBe('3.3')
    expect(input.lowRatingCount).toBe(1)
    expect(input.productCount).toBe(1)
  })
})