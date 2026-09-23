// 双向迭代 R6（2026-09-18）：看板聚合缓存。
// 三条铁律的落点：
//  ① 跨请求缓存必须配写失效——否则「下单后看板立刻更新」的语义被 60s TTL 破坏（门店方案在此处的已知风险）；
//  ② 必须按 rangeDays 分键——单键会让「7 天视图返回 365 天数据」这种静默错误上线；
//  ③ 无 KV 绑定时优雅回落直查 DB（与限流降级链同构，已由 cache.js 保证）。
import { describe, it, expect } from 'vitest'
import { handleAdmin } from '../functions/lib/backend.js'
import { invalidateDashboard, DASHBOARD_CACHE_PREFIX } from '../functions/lib/cache.js'
import { fakeDb, fakeKv } from './helpers/fakeDb.js'

const KEY = 'test-admin-key'

// handleAdmin 签名：(env, action, adminKey, payload, request)；DB 由 env.DB 提供
function env(db) {
  return { ADMIN_KEY: KEY, RATE_KV: fakeKv(), DB: db }
}

// 只统计看板的三条 SELECT（避免把 DELETE FROM products 计入）
const statsQueries = (statements) =>
  statements.filter((s) => /^\s*SELECT[\s\S]*FROM\s+(orders|reviews|products)/i.test(s)).length

describe('看板缓存', () => {
  it('第二次同区间请求命中缓存，不再查库', async () => {
    const statements = []
    const db = fakeDb({ statements })
    const e = env(db)
    const r1 = await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    const after1 = statsQueries(statements)
    expect(r1.code).toBe(0)
    expect(after1).toBeGreaterThan(0)
    const r2 = await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    expect(r2.code).toBe(0)
    expect(statsQueries(statements)).toBe(after1) // 命中缓存，零新增查询
    expect(r2.data).toEqual(r1.data)
  })

  it('不同 rangeDays 分键隔离，互不污染', async () => {
    const statements = []
    const e = env(fakeDb({ statements }))
    await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    const after7 = statsQueries(statements)
    await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 30 }, null)
    expect(statsQueries(statements)).toBe(after7 * 2) // 30 天视图未命中 7 天缓存
    expect(e.RATE_KV.store.has(`${DASHBOARD_CACHE_PREFIX}7`)).toBe(true)
    expect(e.RATE_KV.store.has(`${DASHBOARD_CACHE_PREFIX}30`)).toBe(true)
  })

  it('写操作（删除商品）后缓存失效，下一次查询重新落库', async () => {
    const statements = []
    const e = env(fakeDb({ statements }))
    await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    const after1 = statsQueries(statements)
    const w = await handleAdmin(e, 'deleteProduct', KEY, { productId: 'p1' }, null)
    expect(w.code).toBe(0)
    expect(e.RATE_KV.store.has(`${DASHBOARD_CACHE_PREFIX}7`)).toBe(false) // 已失效
    await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    expect(statsQueries(statements)).toBe(after1 * 2)
  })

  it('写操作后 AI 建议缓存同步失效（2026-09-23 第三轮优化）', async () => {
    const statements = []
    const e = env(fakeDb({ statements }))
    await e.RATE_KV.put('cache:ai:advice', '{}')
    const w = await handleAdmin(e, 'deleteProduct', KEY, { productId: 'p1' }, null)
    expect(w.code).toBe(0)
    expect(e.RATE_KV.store.has('cache:ai:advice')).toBe(false) // 不再残留旧快照建议 60s
  })

  it('invalidateDashboard 覆盖全部档位键', async () => {
    const kv = fakeKv()
    for (const d of [1, 7, 30, 365]) {
      await kv.put(`${DASHBOARD_CACHE_PREFIX}${d}`, '{}')
    }
    await invalidateDashboard({ RATE_KV: kv })
    for (const d of [1, 7, 30, 365]) {
      expect(kv.store.has(`${DASHBOARD_CACHE_PREFIX}${d}`)).toBe(false)
    }
  })

  it('无 KV 绑定时优雅降级：每次都查库但不报错', async () => {
    const statements = []
    const e = { ADMIN_KEY: KEY, DB: fakeDb({ statements }) } // 无 RATE_KV
    const r1 = await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    const r2 = await handleAdmin(e, 'getDashboardStats', KEY, { rangeDays: 7 }, null)
    expect(r1.code).toBe(0)
    expect(r2.code).toBe(0)
    expect(statsQueries(statements)).toBeGreaterThan(3)
  })
})
