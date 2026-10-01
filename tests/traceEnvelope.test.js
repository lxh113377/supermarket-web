/**
 * 统一 trace 信封单测（第六十轮 M-59-2）。
 * 口径：断言**端点层**的两次 withTrace 调用点（失败出口 + 主路径），不是 handle 层——
 * trace 挂在 pub.js/web.js 的 onRequestPost，handle 层录制（api-response-contract）
 * 本来就看不见它，这里是唯一的回归钉。
 * 为什么测 invalid_json 路径：它不碰 DB，仅凭 request stub 就能证明"端点把 trace 塞进了响应"，
 * 成功路径共用同一个 withTrace，形状由下面的纯函数断言覆盖。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { withTrace } from '../functions/lib/errors.js'
import { onRequestPost as pubPost } from '../functions/pub.js'
import { onRequestPost as webPost } from '../functions/web.js'

const badJsonReq = (ray) => ({
  json: async () => { throw new Error('not json') },
  headers: { get: (k) => (String(k).toLowerCase() === 'cf-ray' ? ray : null) },
})
const headerReq = (name, value) => ({
  json: async () => { throw new Error('not json') },
  headers: { get: (k) => (String(k).toLowerCase() === name ? value : null) },
})

describe('withTrace：纯追加，不碰既有键', () => {
  it('有 trace 时 spread 出新对象，原对象不被污染（KV 缓存共享体安全）', () => {
    const src = { code: 0, data: [1] }
    const out = withTrace(src, 'ray-1')
    expect(out.trace).toBe('ray-1')
    expect(out.code).toBe(0)
    expect(src).not.toHaveProperty('trace')
    expect(out).not.toBe(src)
  })
  it('空串/缺失 trace 原样返回（本地与单测环境响应逐字节不变）', () => {
    const src = { code: -1, errorCode: 'invalid_json' }
    expect(withTrace(src, '')).toBe(src)
    expect(withTrace(src, null)).toBe(src)
    expect(withTrace(null, 'ray-1')).toBeNull()
  })
  it('失败信封的 code/errorCode/kind 一个字不动，只多 trace', () => {
    const out = withTrace({ code: -1, errorCode: 'action_not_public', kind: 'auth', retryable: false, message: 'x' }, 'ray-9')
    expect(out).toMatchObject({ code: -1, errorCode: 'action_not_public', kind: 'auth', retryable: false, trace: 'ray-9' })
  })
})

describe('端点层：失败出口带 trace（/pub 与 /web 同行为）', () => {
  for (const [name, post] of [['/pub', pubPost], ['/web', webPost]]) {
    it(`${name} invalid_json：trace 进响应体，HTTP 语义状态码不变`, async () => {
      const res = await post({ request: badJsonReq('ray-pub-1'), env: {}, context: {} })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe(-1)
      expect(body.errorCode).toBe('invalid_json')
      expect(body.trace).toBe('ray-pub-1')
    })
    it(`${name} 无 cf-ray 时不加 trace 键（旧行为逐字节一致）`, async () => {
      const res = await post({ request: badJsonReq(null), env: {}, context: {} })
      const body = await res.json()
      expect(body.code).toBe(-1)
      expect(body).not.toHaveProperty('trace')
    })
    // 第六十轮 R60-1：响应体是对外面，`x-request-id` 由请求方自己写 ⇒ 不得原样回显。
    // 修前这一条必红（实测旧行为：5000 字头进 5000 字 trace，且换行/引号照抄）。
    it(`${name} 恶意 x-request-id 被收口才回显（长度 ≤64、无控制符/引号/花括号）`, async () => {
      const evil = 'e' + String.fromCharCode(10) + '{"code":0}' + 'B'.repeat(500)
      const res = await post({ request: headerReq('x-request-id', evil), env: {}, context: {} })
      const body = await res.json()
      expect(typeof body.trace).toBe('string')
      expect(body.trace.length).toBeLessThanOrEqual(64)
      expect(body.trace).not.toMatch(/[\n"{}]/)
      expect(body.code).toBe(-1)
    })
    it(`${name} 头值整串非法时不产 trace 键（宁可无线索，不返回空串占位）`, async () => {
      const res = await post({ request: headerReq('x-request-id', '<<<>>>'), env: {}, context: {} })
      expect(await res.json()).not.toHaveProperty('trace')
    })
  }
})
