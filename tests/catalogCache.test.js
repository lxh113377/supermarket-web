import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheSet, clearCatalogCache, CATALOG_CACHE_TTL } from '../src/catalogCache'

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
