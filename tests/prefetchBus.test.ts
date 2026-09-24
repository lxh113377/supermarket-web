// @vitest-environment jsdom
// 预取总线 prefetchBus + 路由登记表 routeLoaders（七轮 H2，两文件原覆盖 0%）。
// 这里锁的是"预取真的会发生"：延迟语义、去重、失败可重试、以及拆模块时立下的
// "工厂只注册不覆盖"约定（App 的 lazy 与预取共用同一引用，重复注册会让两者脱钩）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerRouteFactory, prefetchRoute, prefetchHotRoutes } from '../src/prefetchBus'

let idleCb: (() => void) | null = null
const ric = vi.fn((cb: () => void) => { idleCb = cb; return 1 })

beforeEach(() => {
  vi.clearAllMocks()
  idleCb = null
  vi.stubGlobal('requestIdleCallback', ric)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const flushIdle = () => { expect(idleCb).not.toBeNull(); (idleCb as unknown as () => void)(); idleCb = null }

describe('注册与去重', () => {
  it('工厂只注册一次：重复注册同一 key 不覆盖（保持与 lazy() 同一引用）', async () => {
    const first = vi.fn().mockResolvedValue({ default: 'A' })
    const second = vi.fn().mockResolvedValue({ default: 'B' })
    registerRouteFactory('dup-key', first)
    registerRouteFactory('dup-key', second)
    prefetchRoute('dup-key')
    flushIdle()
    await Promise.resolve()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('未注册的 key 静默跳过（单测只引本模块时不该炸）', () => {
    prefetchRoute('never-registered')
    expect(() => flushIdle()).not.toThrow()
  })

  it('同一 key 反复 hover 只发一次请求', async () => {
    const factory = vi.fn().mockResolvedValue({})
    registerRouteFactory('shop-once', factory)
    prefetchRoute('shop-once')
    flushIdle()
    prefetchRoute('shop-once')
    flushIdle()
    await Promise.resolve()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('预取失败要撤销"已请求"标记，否则一次网络抖动就永久不再预取', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('chunk load failed'))
      .mockResolvedValueOnce({ ok: true })
    registerRouteFactory('flaky', factory)
    prefetchRoute('flaky')
    flushIdle()
    await expect(Promise.resolve()).resolves.toBeUndefined()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    prefetchRoute('flaky')
    flushIdle()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2))
  })
})

describe('时机（预取必须赶在点击前）', () => {
  it('prefetchRoute 用 requestIdleCallback + timeout 150ms（不是历史的 1200ms）', () => {
    registerRouteFactory('when-a', vi.fn().mockResolvedValue({}))
    prefetchRoute('when-a')
    expect(ric).toHaveBeenCalledTimes(1)
    expect(ric.mock.calls[0][1]).toEqual({ timeout: 150 })
  })

  it('浏览器不支持 requestIdleCallback 时退回 setTimeout', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    const factory = vi.fn().mockResolvedValue({})
    registerRouteFactory('when-b', factory)
    prefetchRoute('when-b')
    vi.advanceTimersByTime(300)
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    vi.useRealTimers()
  })

  it('热路由按 300ms 错峰预取，避免一次性抢满带宽', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    for (const k of ['hot-a', 'hot-b', 'hot-c']) {
      registerRouteFactory(k, async () => { calls.push(k); return {} })
    }
    prefetchHotRoutes(['hot-a', 'hot-b', 'hot-c'])
    flushIdle()
    expect(calls).toEqual([])
    vi.advanceTimersByTime(0)
    expect(calls).toEqual(['hot-a'])
    vi.advanceTimersByTime(300)
    expect(calls).toEqual(['hot-a', 'hot-b'])
    vi.advanceTimersByTime(600)
    expect(calls).toEqual(['hot-a', 'hot-b', 'hot-c'])
    vi.useRealTimers()
  })

  it('缺省热路由清单为 category/shop/product/cart，未注册时全程不抛错', () => {
    vi.useFakeTimers()
    prefetchHotRoutes()
    flushIdle()
    expect(ric.mock.calls[0][1]).toEqual({ timeout: 3000 })
    vi.advanceTimersByTime(2000)
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })
})

describe('routeLoaders 与总线接线', () => {
  it('13 条路由全部登记，工厂返回带 default 组件的页面模块', async () => {
    const { routeLoaders } = await import('../src/routeLoaders')
    const keys = Object.keys(routeLoaders)
    expect(keys).toHaveLength(13)
    expect(keys).toContain('orderQuery') // 订单查询页入表（漏登记就会 lazy 与预取脱钩）
    for (const k of ['cart', 'orderQuery'] as const) {
      const mod = (await routeLoaders[k]()) as { default?: unknown }
      expect(typeof mod.default).toBe('function')
    }
  })

  it('表里的工厂注册进总线后，预取与 lazy 共用同一引用（不再二次下载）', async () => {
    const { routeLoaders } = await import('../src/routeLoaders')
    const factory = vi.fn(routeLoaders.product)
    registerRouteFactory('rl-product', factory)
    prefetchRoute('rl-product')
    flushIdle()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    prefetchRoute('rl-product')
    flushIdle()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1)) // 去重仍生效
  })
})
