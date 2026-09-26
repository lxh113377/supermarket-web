import { describe, it, expect } from 'vitest'
import { checkRate, checkRateKV } from '../functions/lib/backend'

// 内存 KV 模拟：对齐 Workers KV get/put 契约（JSON 字符串 + expirationTtl）
function makeKV() {
  const map = new Map()
  const ttlLog = []
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    put: async (key, value, opts = {}) => {
      map.set(key, value)
      if (opts.expirationTtl != null) ttlLog.push(opts.expirationTtl)
    },
    _ttlLog: ttlLog,
  }
}

// 第十八轮：限流响应从 `{code:-1,message}` 扩成带机器语义的信封。
// 这里刻意保留 toEqual 级别的"键集合"约束（不是 toMatchObject）：
// 以后谁再往 fail() 里塞字段，本用例会当场红，而不是静默通过后再被别处踩到。
const RATE_LIMIT_KEYS = ['code', 'errorCode', 'kind', 'message', 'retryAfterMs', 'retryable']
function expectRateLimited(r) {
  expect(Object.keys(r).sort()).toEqual(RATE_LIMIT_KEYS)
  expect(r.code).toBe(-1)
  expect(r.errorCode).toBe('rate_limited')
  expect(r.kind).toBe('quota')
  expect(r.retryable).toBe(true)
  expect(r.message).toBe('操作过于频繁，请稍后再试')
  // Retry-After 的来源：剩到窗口的毫秒数。它必须 >0（否则等于告诉客户端可以立刻再打），
  // 且不得超过窗口本身。
  expect(r.retryAfterMs).toBeGreaterThan(0)
  expect(r.retryAfterMs).toBeLessThanOrEqual(60000)
}

describe('限流迁 Workers KV（checkRateKV）', () => {
  it('窗口内前 N 次通过，超限后拦截', async () => {
    const kv = makeKV()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toBeNull()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toBeNull()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toBeNull()
    expectRateLimited(await checkRateKV(kv, 'rate:login:ip1', 60000, 3))
  })

  it('不同 key / IP 独立计数', async () => {
    const kv = makeKV()
    expect(await checkRate( null, kv, 'a', 60000, 1)).toBeNull()
    expect(await checkRate(null, kv, 'b', 60000, 1)).toBeNull()
    expectRateLimited(await checkRate(null, kv, 'a', 60000, 1))
    expectRateLimited(await checkRate(null, kv, 'b', 60000, 1))
  })

  it('写入带 expirationTtl（秒级，向下取整窗口）', async () => {
    const kv = makeKV()
    await checkRateKV(kv, 'k', 60000, 1)
    expect(kv._ttlLog[0]).toBe(60)
  })

  it('KV/DB 均缺失时安全放行（限流故障不阻塞下单）', async () => {
    expect(await checkRate(null, null, 'x', 60000, 5)).toBeNull()
  })
})