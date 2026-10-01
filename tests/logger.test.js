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

/**
 * trace 卫生（第六十轮 R60-1）。
 * 一手动因（本轮实跑上一会话遗留的 `.tmp-trace-probe.mjs` 取到的读数，不是假想）：
 * `x-request-id` 是**请求方自己就能写**的头，旧 `traceIdOf` 原样返回 ⇒
 *   · 5000 字的头 ⇒ trace 5000 字，绕开本文件对每个字段都执行的 300 字截断；
 *   · `evil\n{"level":"info",...}` ⇒ 原样进串。探针同时**否证**了"能伪造出第二条日志"这个
 *     假设（JSON.stringify 把换行转义，实测行数恒为 1）⇒ 活下来的缺陷是"无长度/字符上限"，
 *     不是日志注入。修的是前者，不许把后者写进理由充数。
 * 顺序口径：先洗 IP 形状再过白名单（`[ip]` 的方括号会被白名单剔掉，故期望值是 `r:ip` 而不是 `r:[ip]`）。
 */
describe('logger：trace 不接受请求方决定的长度与字符', () => {
  it('cf-ray 真实形态逐字通过 —— 收口不许把正常线索改坏', () => {
    // 形态取自实测 `curl -I https://supermarket-web.pages.dev/_health` → `CF-RAY: a43d3ddddcb3d908-LAX`。
    // 注：**Worker 侧收到的 cf-ray 不含机房后缀**（第六十轮线上实测：响应头 `-LAX`、同一请求体里
    // trace 只有 16 字，而本地 sanitizeTrace('...-LAX') 原样保留 ⇒ 截断不发生在白名单）——
    // 本条按**带后缀**的形态钉，是因为白名单必须对两种形态都放行，不是断言 Worker 一定看得到后缀。
    expect(traceIdOf(req({ 'cf-ray': 'a43d3ddddcb3d908-LAX' }))).toBe('a43d3ddddcb3d908-LAX')
  })
  it('超长头截到 64 字（本文件里 trace 与 300 字同族，但要的是标识不是正文）', () => {
    expect(traceIdOf(req({ 'x-request-id': 'A'.repeat(5000) }))).toBe('A'.repeat(64))
  })
  it('白名单剔掉控制符/引号/花括号：请求方决定不了日志字段的形状', () => {
    const evil = 'evil' + String.fromCharCode(10) + '{"level":"info","msg":"x"}'
    // 期望值取自**实测**而不是手算：逗号也被剔（不在 [\w:.-]），所以 info 与 msg 之间没有分隔符。
    expect(traceIdOf(req({ 'x-request-id': evil }))).toBe('evillevel:infomsg:x')
  })
  it('整串都是非法字符 ⇒ 清洗后为空串 ⇒ 与"没有 cf-ray"同路径，日志不出 trace 键', () => {
    const t = traceIdOf(req({ 'x-request-id': '/// <<<>>>' }))
    expect(t).toBe('')
    expect('trace' in buildRecord('error', 'pub', 'x', { trace: t }, AT)).toBe(false)
  })
  it('串内 IP 形状照本文件口径洗掉（trace 不是"唯一不洗的字段"）', () => {
    expect(traceIdOf(req({ 'x-request-id': 'r:192.168.1.7' }))).toBe('r:ip')
  })
  it('非字符串头值（数组/对象）不得抛：降级空串', () => {
    expect(traceIdOf({ headers: { get: () => ['a', 'b'] } })).toBe('')
    expect(traceIdOf({ headers: { get: () => ({ a: 1 }) } })).toBe('')
  })
})
