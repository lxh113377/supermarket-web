/**
 * 写操作缓存失效收口判据（防线轮 K1）。
 *
 * 钉的是「时机」而不是「范围」：写请求可能已落库但响应丢失/解析失败，
 * 那种情况下不清缓存会让读取方最长 60s 拿到旧数据（TTL 见 catalogCache.CATALOG_CACHE_TTL）。
 * 所以每条都成对跑：成功路径失效 + 抛错路径仍失效。
 * 反例（必须让本文件变红）：把 withCacheInvalidation 的 finally 改成只在成功分支失效。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ cloud: true, adminCall: vi.fn() }))

vi.mock('../src/cloudbase', () => ({ get IS_CLOUD() { return h.cloud } }))
vi.mock('../src/api/client', () => ({
  adminCall: h.adminCall,
  publicCall: vi.fn(),
  loginAdmin: vi.fn(),
  verifyAdminKey: vi.fn(),
}))

import { updateProduct, updateOrderStatus, deleteOrder } from '../src/auth'
import { cacheGet, cacheSet, clearCatalogCache } from '../src/catalogCache'

const KEY = 'publicProducts'

/** 预置一份目录缓存，模拟"上一次读留下的 60s 快照" */
function seedCatalog() {
  cacheSet(KEY, [{ _id: 'p1', stock: 9 }])
  expect(cacheGet(KEY)).not.toBeNull()
}

beforeEach(() => {
  localStorage.clear()
  clearCatalogCache()
  vi.clearAllMocks()
  h.cloud = true
})

describe('商品写：抛错路径仍失效（finally 语义）', () => {
  it('updateProduct 云端抛错：异常原样上抛，且目录缓存已失效', async () => {
    seedCatalog()
    h.adminCall.mockRejectedValue(new Error('请求超时，请检查网络后重试'))
    await expect(updateProduct('p1', { price: 3 })).rejects.toThrow('请求超时')
    expect(cacheGet(KEY)).toBeNull()
  })

  it('updateProduct 云端成功：同样失效（防只修抛错分支的半截改动）', async () => {
    seedCatalog()
    h.adminCall.mockResolvedValue({ code: 0 })
    await expect(updateProduct('p1', { price: 3 })).resolves.toEqual({ code: 0 })
    expect(cacheGet(KEY)).toBeNull()
  })

  it('updateProduct 云端返回 code≠0：也失效（不清的代价大于多拉一次）', async () => {
    seedCatalog()
    h.adminCall.mockResolvedValue({ code: -1, message: '权限不足' })
    await updateProduct('p1', { price: 3 })
    expect(cacheGet(KEY)).toBeNull()
  })
})

describe('订单写：失效收口（本轮修的零失效缺陷）', () => {
  it('updateOrderStatus 云端成功：失效含 stock 的商品列表缓存', async () => {
    seedCatalog()
    h.adminCall.mockResolvedValue({ code: 0 })
    await expect(updateOrderStatus('o1', 'paid')).resolves.toEqual({ code: 0 })
    expect(h.adminCall).toHaveBeenCalledWith('updateOrderStatus', { orderId: 'o1', status: 'paid' })
    expect(cacheGet(KEY)).toBeNull()
  })

  it('updateOrderStatus 云端抛错：异常上抛且仍失效', async () => {
    seedCatalog()
    h.adminCall.mockRejectedValue(new Error('net down'))
    await expect(updateOrderStatus('o1', 'cancelled')).rejects.toThrow('net down')
    expect(cacheGet(KEY)).toBeNull()
  })

  it('deleteOrder 云端成功：失效', async () => {
    seedCatalog()
    h.adminCall.mockResolvedValue({ code: 0 })
    await deleteOrder('o1')
    expect(cacheGet(KEY)).toBeNull()
  })

  it('deleteOrder 云端抛错：仍失效', async () => {
    seedCatalog()
    h.adminCall.mockRejectedValue(new Error('boom'))
    await expect(deleteOrder('o1')).rejects.toThrow('boom')
    expect(cacheGet(KEY)).toBeNull()
  })

  it('本地模式不发请求（失效只属云端写路径）', async () => {
    h.cloud = false
    seedCatalog()
    await updateOrderStatus('o1', 'paid')
    await deleteOrder('o1')
    expect(h.adminCall).not.toHaveBeenCalled()
  })
})
