/**
 * 结构化日志单测（第五十九轮 H-59-1）。
 * 口径：断言**日志行的形状与洗白结果**，不断言任何业务响应；出口用 spy 接住，不真打屏幕。
 * 为什么值得单列一件：`verify:logs` 判的是"代码走没走这个出口"（登记面），
 * 本件判的是"走了之后到底产出什么"（行为面）—— 两件不重叠，缺后者则出口可以是个只会 print 的空壳。
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  LEVELS, PII_KEYS, buildRecord, emit, logError, redactFields, scrubValue, traceIdOf,
} from '../functions/lib/logger.js'

const AT = '2026-10-01T06:00:00.000Z'

afterEach(() => { vi.restoreAllMocks() })
const req = (headers) => ({ headers: { get: (k) => headers[String(k).toLowerCase()] ?? null } })

describe('logger：一行一条 JSON', () => {
  it('固定头齐备，且序列化后不含裸换行（一条记录恒为一行）', () => {
    const rec = buildRecord('error', 'orders', '落库失败\n第二行', { err: new Error('boom') }, AT)
    const line = JSON.stringify(rec)
    expect(rec).toMatchObject({ ts: AT, level: 'error', mod: 'orders', msg: '落库失败\n第二行' })
    expect(line).not.toContain('\n')
    expect(JSON.parse(line)).toEqual(rec)
  })

  it('level 两档各自落到自己的 console 出口（error 走 error，warn 走 warn）', () => {
    const spy = { error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}) }
    emit('error', { level: 'error' })
    emit('warn', { level: 'warn' })
    expect(spy.error).toHaveBeenCalledTimes(1)
    expect(spy.warn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(spy.error.mock.calls[0][0])).toEqual({ level: 'error' })
    expect(Object.keys(LEVELS)).toEqual(['warn', 'error'])
  })

  it('trace 有则单列一个字段，无则整个键不出现（不留 trace="" 这种假关联）', () => {
    expect(buildRecord('warn', 'pub', 'x', { trace: 'a1b2.ord' }, AT).trace).toBe('a1b2.ord')
    expect('trace' in buildRecord('warn', 'pub', 'x', { action: 'login' }, AT)).toBe(false)
  })

  it('调用方字段不得顶掉 ts/level/mod/msg 四个保留位', () => {
    const rec = buildRecord('error', 'orders', '真消息', { level: 'info', mod: 'fake', msg: '假' }, AT)
    expect(rec.level).toBe('error')
    expect(rec.mod).toBe('orders')
    expect(rec.msg).toBe('真消息')
  })

  it('循环引用不得抛出（日志绝不能把主流程带下去）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const circular = {}
    circular.self = circular
    expect(() => logError('orders', 'x', { circular })).not.toThrow()
    logError('orders', 'x', { circular })
    expect(JSON.parse(spy.mock.calls[0][0]).circular).toBe('[unserializable]')
  })
})

describe('logger：个人数据在离开口径前就洗掉', () => {
  it('命中 PII 键 ⇒ 值换成占位、键保留（让运维知道有该字段被拦而不是"这次恰好没有"）', () => {
    const out = redactFields({ roomNumber: '3栋 502', orderId: 'o_1', totalAmount: 12 })
    expect(out).toEqual({ roomNumber: '[redacted]', orderId: 'o_1', totalAmount: 12 })
  })

  it('cache key 里嵌的 IPv4 / IPv6 一并洗成 [ip]（`rate:login:<ip>` 就是登记册里的明文 IP）', () => {
    expect(scrubValue('key', 'rate:login:203.0.113.7')).toBe('rate:login:[ip]')
    expect(scrubValue('key', 'cache:ipv6=2001:db8::1')).toContain('[ip]')
    expect(scrubValue('key', 'cache:catalog:v1')).toBe('cache:catalog:v1')
  })

  it('Error 实例收成一行 "Name: message" 并截 300 字', () => {
    const long = new Error('x'.repeat(500))
    const s = scrubValue('err', long)
    expect(s.startsWith('Error: xxx')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(300)
  })

  it('PII_KEYS 非空且含 orders 的住址列（解析失败时判据会红，但这里也要有一条真断言）', () => {
    expect(PII_KEYS.size).toBeGreaterThan(10)
    expect(PII_KEYS.has('roomNumber')).toBe(true)
    expect(PII_KEYS.has('paymentScreenshot')).toBe(true)
    expect(PII_KEYS.has('orderId')).toBe(false) // 派生列：排障必需，两处口径（events 白名单/本册）一致放行
  })
})

describe('logger：trace 取自边缘节点而不是自己编', () => {
  it('cf-ray 优先，其次 x-request-id，都没有则空串（本地/单测环境不产假 traceId）', () => {
    expect(traceIdOf(req({ 'cf-ray': 'a1', 'x-request-id': 'b2' }))).toBe('a1')
    expect(traceIdOf(req({ 'x-request-id': 'b2' }))).toBe('b2')
    expect(traceIdOf(req({}))).toBe('')
    expect(traceIdOf(null)).toBe('')
    expect(traceIdOf({})).toBe('')
  })
})
