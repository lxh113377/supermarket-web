import { describe, it, expect } from 'vitest'

// 测试云函数共享模块的纯逻辑部分（现位于 functions/lib/shared.js，随 CloudBase→Pages Functions 迁移迁出旧 cloudfunctions/ 目录）
const {
  normalizeEvent,
  createRateLimiter,
  getClientIp,
} = await import('../functions/lib/shared')

describe('shared - normalizeEvent', () => {
  it('直接对象原样返回', () => {
    const input = { action: 'test', payload: { a: 1 } }
    expect(normalizeEvent(input)).toEqual(input)
  })

  it('HTTP 触发 body 字符串解析', () => {
    const input = { body: JSON.stringify({ action: 'createOrder', payload: {} }) }
    expect(normalizeEvent(input)).toEqual({ action: 'createOrder', payload: {} })
  })

  it('body 非法 JSON 返回空对象', () => {
    const input = { body: 'not-json{{{' }
    expect(normalizeEvent(input)).toEqual({})
  })

  it('null 输入返回空对象', () => {
    expect(normalizeEvent(null)).toEqual({})
    expect(normalizeEvent(undefined)).toEqual({})
  })

  it('body 已是对象直接使用', () => {
    const input = { body: { action: 'test' } }
    expect(normalizeEvent(input)).toEqual({ action: 'test' })
  })
})

describe('shared - createRateLimiter', () => {
  it('前 N 次通过，超限后拦截', () => {
    const limiter = createRateLimiter(60000, 3, '太频繁')
    expect(limiter('ip1')).toBeNull()
    expect(limiter('ip1')).toBeNull()
    expect(limiter('ip1')).toBeNull()
    expect(limiter('ip1')).toEqual({ code: -1, message: '太频繁' })
  })

  it('不同 IP 独立计数', () => {
    const limiter = createRateLimiter(60000, 1, '限流')
    expect(limiter('a')).toBeNull()
    expect(limiter('b')).toBeNull()
    expect(limiter('a')).toEqual({ code: -1, message: '限流' })
    expect(limiter('b')).toEqual({ code: -1, message: '限流' })
  })
})

describe('shared - getClientIp', () => {
  it('从 context.source_ip 取', () => {
    expect(getClientIp({ source_ip: '1.2.3.4' }, {})).toBe('1.2.3.4')
  })

  it('从 event.requestContext.sourceIp 取', () => {
    expect(getClientIp(null, { requestContext: { sourceIp: '5.6.7.8' } })).toBe('5.6.7.8')
  })

  it('都没有返回 unknown', () => {
    expect(getClientIp(null, null)).toBe('unknown')
  })
})
