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

describe('限流迁 Workers KV（checkRateKV）', () => {
  it('窗口内前 N 次通过，超限后拦截', async () => {
    const kv = makeKV()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toBeNull()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toBeNull()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toBeNull()
    expect(await checkRateKV(kv, 'rate:login:ip1', 60000, 3)).toEqual({ code: -1, message: '操作过于频繁，请稍后再试' })
  })

  it('不同 key / IP 独立计数', async () => {
    const kv = makeKV()
    expect(await checkRate( null, kv, 'a', 60000, 1)).toBeNull()
    expect(await checkRate(null, kv, 'b', 60000, 1)).toBeNull()
    expect(await checkRate(null, kv, 'a', 60000, 1)).toEqual({ code: -1, message: '操作过于频繁，请稍后再试' })
    expect(await checkRate(null, kv, 'b', 60000, 1)).toEqual({ code: -1, message: '操作过于频繁，请稍后再试' })
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