import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheSet, cacheDel, clearCatalogCache, withCacheInvalidation, CATALOG_CACHE_TTL } from '../src/catalogCache'

// 每个用例前清空，避免用例间互相污染（缓存是模块级单例）
beforeEach(() => {
  clearCatalogCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('catalogCache 读写', () => {
  it('未写入时返回 null', () => {
    expect(cacheGet('publicProducts')).toBeNull()
  })

  it('写入后可命中且值一致', () => {
    const data = [{ _id: 'p1', name: '可乐' }]
    cacheSet('publicProducts', data)
    expect(cacheGet('publicProducts')).toEqual(data)
  })

  it('不同 key 互不干扰', () => {
    cacheSet('publicProducts', ['p'])
    cacheSet('publicCategories', ['c'])
    expect(cacheGet('publicProducts')).toEqual(['p'])
    expect(cacheGet('publicCategories')).toEqual(['c'])
  })
})

describe('catalogCache TTL 过期', () => {
  it('TTL 内仍命中', () => {
    vi.useFakeTimers()
    cacheSet('publicProducts', ['x'])
    vi.advanceTimersByTime(CATALOG_CACHE_TTL - 1000)
    expect(cacheGet('publicProducts')).toEqual(['x'])
  })

  it('超过 TTL 后失效', () => {
    vi.useFakeTimers()
    cacheSet('publicProducts', ['x'])
    vi.advanceTimersByTime(CATALOG_CACHE_TTL + 1)
    expect(cacheGet('publicProducts')).toBeNull()
  })
})

describe('读写拷贝隔离（2026-09-23 第三轮优化）', () => {
  // 调用方原地 sort/push 不得污染 60s 内其他读取方；写侧传入后改动原数组不得反向污染
  it('读出数组改动不污染缓存', () => {
    cacheSet('publicProducts', [{ _id: 'p1' }, { _id: 'p2' }])
    const got = cacheGet('publicProducts')
    got.push({ _id: 'p3' })
    expect(cacheGet('publicProducts')).toEqual([{ _id: 'p1' }, { _id: 'p2' }])
  })

  it('写入后改动原数组不污染缓存', () => {
    const data = [{ _id: 'p1' }]
    cacheSet('publicProducts', data)
    data.push({ _id: 'p2' })
    expect(cacheGet('publicProducts')).toEqual([{ _id: 'p1' }])
  })
})

describe('clearCatalogCache', () => {
  // 这是管理端写商品后的失效钩子，回归会直接导致顾客端最长 60s 看到旧数据
  it('清空后全部 key 失效', () => {
    cacheSet('publicProducts', ['p'])
    cacheSet('publicCategories', ['c'])
    clearCatalogCache()
    expect(cacheGet('publicProducts')).toBeNull()
    expect(cacheGet('publicCategories')).toBeNull()
  })

  it('清空后可重新写入', () => {
    cacheSet('publicProducts', ['old'])
    clearCatalogCache()
    cacheSet('publicProducts', ['new'])
    expect(cacheGet('publicProducts')).toEqual(['new'])
  })
})

// withCacheInvalidation 是全部写路径失效的收口点，语义错则所有上游判据一起失去意义
describe('withCacheInvalidation 收口语义', () => {
  it('成功：返回值原样透传且执行失效', async () => {
    cacheSet('publicProducts', ['p'])
    await expect(withCacheInvalidation(async () => 'ok')).resolves.toBe('ok')
    expect(cacheGet('publicProducts')).toBeNull()
  })

  it('抛错：异常原样上抛（不吞不改写），且 finally 仍失效', async () => {
    cacheSet('publicProducts', ['p'])
    const boom = new Error('请求超时')
    await expect(withCacheInvalidation(() => Promise.reject(boom))).rejects.toBe(boom)
    expect(cacheGet('publicProducts')).toBeNull()
  })

  it('自定义 invalidate 只清指定键，默认全清不误伤', async () => {
    cacheSet('publicProducts', ['p'])
    cacheSet('reviews:1', ['r'])
    await withCacheInvalidation(async () => undefined, () => cacheDel('reviews:1'))
    expect(cacheGet('reviews:1')).toBeNull()
    expect(cacheGet('publicProducts')).not.toBeNull()
    await withCacheInvalidation(async () => undefined)
    expect(cacheGet('publicProducts')).toBeNull()
  })
})
