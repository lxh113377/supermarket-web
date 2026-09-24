/**
 * db 门面层全分支测试（对标第四轮 D1：覆盖率爬坡主攻 src/db/*.ts）
 * 用可变 IS_CLOUD getter 切云/本地两态；adminCall/publicCall 为纯 mock；
 * catalogCache/localStore 用真实模块（jsdom localStorage 可用）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  cloud: true,
  adminCall: vi.fn(),
  publicCall: vi.fn(),
  passthrough: (d: Record<string, unknown>) => d,
}))

vi.mock('../src/cloudbase', () => ({ get IS_CLOUD() { return h.cloud } }))
vi.mock('../src/auth', () => ({
  adminCall: h.adminCall,
  publicCall: h.publicCall,
  pickOrderFields: h.passthrough,
  pickSubmissionFields: h.passthrough,
}))
vi.mock('../src/api/client', () => ({
  adminCall: h.adminCall,
  publicCall: h.publicCall,
}))

import { getCategories, getProducts, getAdminProducts } from '../src/db/products'
import { createOrder, getOrderById, getOrderStatus, getAllOrders } from '../src/db/orders'
import { createSubmission, getSubmissions, flushPendingSubmissions } from '../src/db/submissions'
import { clearCatalogCache } from '../src/catalogCache'

const mkOrder = (id: string, updatedAt: string) => ({ _id: id, roomNumber: '501', items: [], totalAmount: 1, status: 'pending', createdAt: updatedAt, updatedAt })

describe('db/products 目录门面', () => {
  beforeEach(() => { localStorage.clear(); clearCatalogCache(); h.cloud = true; vi.clearAllMocks() })

  it('本地模式：分类/商品走 localStore（种子数据）', async () => {
    h.cloud = false
    const cats = await getCategories()
    expect(cats.length).toBeGreaterThan(0)
    const prods = await getProducts()
    expect(prods.length).toBeGreaterThan(0)
    expect(prods.every((p) => p.enabled !== false)).toBe(true)
  })

  it('分类：云端成功后二次命中内存缓存；空列表是合法态', async () => {
    h.publicCall.mockResolvedValue({ code: 0, data: [] })
    expect(await getCategories()).toEqual([])
    expect(h.publicCall).toHaveBeenCalledTimes(1)
    expect(await getCategories()).toEqual([]) // 缓存命中不再发请求
    expect(h.publicCall).toHaveBeenCalledTimes(1)
  })

  it('商品：云端 code!=0 → 回退持久缓存（首次失败无缓存再退本地）', async () => {
    h.publicCall.mockResolvedValue({ code: -1, message: 'down' })
    expect((await getProducts()).length).toBeGreaterThan(0) // 无持久缓存 → 本地种子兜底
    // 先成功一次写入持久缓存，再断网 → 回退到持久数据
    clearCatalogCache()
    h.publicCall.mockResolvedValue({ code: 0, data: [{ _id: 'p1', enabled: true }] })
    await getProducts()
    clearCatalogCache()
    h.publicCall.mockRejectedValue(new Error('network'))
    const fb = await getProducts()
    expect(fb).toEqual([{ _id: 'p1', enabled: true }])
  })

  it('管理端读取失败必须显式抛错（禁静默回退）', async () => {
    h.adminCall.mockResolvedValue({ code: -1, message: 'boom' })
    await expect(getAdminProducts()).rejects.toThrow('boom')
    h.adminCall.mockResolvedValue({ code: 0, data: [{ _id: 'p9' }] })
    expect(await getAdminProducts()).toEqual([{ _id: 'p9' }])
  })
})

describe('db/orders 订单门面', () => {
  beforeEach(() => { localStorage.clear(); h.cloud = true; vi.clearAllMocks() })

  it('createOrder：云端成功 / 失败降级本地（localFallback 标记）', async () => {
    h.publicCall.mockResolvedValue({ code: 0, data: { id: 'o_1', deduplicated: false } })
    expect(await createOrder({ roomNumber: '501', items: [] })).toEqual({ id: 'o_1', deduplicated: false })
    h.publicCall.mockRejectedValue(new Error('offline'))
    const fb = await createOrder({ roomNumber: '502', items: [] })
    expect(fb.localFallback).toBe(true)
    expect(fb.id.startsWith('o_')).toBe(true)
  })

  it('getOrderById：云端 code!=0 → null；本地查单', async () => {
    h.adminCall.mockResolvedValue({ code: -1 })
    expect(await getOrderById('o_x')).toBeNull()
    h.cloud = false
    expect(await getOrderById('o_none')).toBeNull()
  })

  it('getOrderStatus：云端返回体透传；code!=0/异常均 null；本地命中', async () => {
    h.publicCall.mockResolvedValue({ code: 0, data: { status: 'paid', updatedAt: 't' } })
    expect(await getOrderStatus('o_1')).toEqual({ status: 'paid', updatedAt: 't' })
    h.publicCall.mockResolvedValue({ code: -1 })
    expect(await getOrderStatus('o_1')).toBeNull()
    h.publicCall.mockRejectedValue(new Error('x'))
    expect(await getOrderStatus('o_1')).toBeNull()
    h.cloud = false
    const created = await createOrder({ roomNumber: '503', items: [] })
    h.cloud = false
    const st = await getOrderStatus(created.id)
    expect(st?.status).toBe('pending')
  })

  it('getAllOrders：分页拼全量 + 去重 + maxUpdatedAt；code!=0 抛错；本地直读', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => mkOrder('a' + i, '2026-09-24T00:00:0' + (i % 10) + 'Z'))
    h.adminCall
      .mockResolvedValueOnce({ code: 0, data: page1, hasMore: true })
      .mockResolvedValueOnce({ code: 0, data: [mkOrder('b1', '2026-09-24T08:00:00Z'), mkOrder('a1', '2026-09-24T00:00:01Z')], hasMore: false })
    const r = await getAllOrders({ since: '2026-09-23T00:00:00Z' })
    expect(r.orders.length).toBe(101) // 去重生效（a1 重复只算一次）
    expect(r.maxUpdatedAt).toBe('2026-09-24T08:00:00Z')
    expect(h.adminCall).toHaveBeenLastCalledWith('getOrders', { page: 2, pageSize: 100, since: '2026-09-23T00:00:00Z' })
    h.adminCall.mockResolvedValue({ code: -1, message: 'db down' })
    await expect(getAllOrders()).rejects.toThrow(/getAllOrders失败/)
    h.cloud = false
    const local = await getAllOrders()
    expect(local.orders.length).toBeGreaterThan(0) // 前面本地降级建过单
    expect(local.maxUpdatedAt).toBeNull()
  })
})

describe('db/submissions 提交门面与离线队列', () => {
  beforeEach(() => { localStorage.clear(); h.cloud = true; vi.clearAllMocks() })

  it('云端失败 → 入离线队列 + _offline 本地记录', async () => {
    h.publicCall.mockRejectedValue(new Error('net'))
    const r = await createSubmission({ serviceId: 's1', serviceName: '开锁' })
    expect(r.offline).toBe(true)
    const q = JSON.parse(localStorage.getItem('sm_pending_submissions') || '[]')
    expect(q.length).toBe(1)
    const list = JSON.parse(localStorage.getItem('sm_submissions') || '[]')
    expect(list[0]._offline).toBe(true)
  })

  it('flushPendingSubmissions：成功清队、失败保留（重入锁防并发双刷）', async () => {
    h.publicCall.mockRejectedValue(new Error('net'))
    await createSubmission({ serviceId: 's1', serviceName: '开锁' })
    await createSubmission({ serviceId: 's2', serviceName: '换锁' })
    h.publicCall.mockReset()
    h.publicCall.mockResolvedValue({ code: 0, data: { id: 'x1' } })
    await Promise.all([flushPendingSubmissions(), flushPendingSubmissions()]) // 并发触发
    expect(JSON.parse(localStorage.getItem('sm_pending_submissions') || '[]')).toEqual([])
    // 再入队一条，flush 时 code!=0 → 保留
    h.publicCall.mockResolvedValue({ code: -1, message: 'reject' })
    h.publicCall.mockRejectedValueOnce(new Error('net')) // createSubmission 走失败入队
    await createSubmission({ serviceId: 's3', serviceName: '维修' })
    h.publicCall.mockResolvedValue({ code: -1 })
    await flushPendingSubmissions()
    expect(JSON.parse(localStorage.getItem('sm_pending_submissions') || '[]').length).toBe(1)
  })

  it('getSubmissions：云端 code0/抛错 + 本地直读', async () => {
    h.adminCall.mockResolvedValue({ code: 0, data: [{ _id: 'sub_1' }] })
    expect(await getSubmissions()).toEqual([{ _id: 'sub_1' }])
    h.adminCall.mockResolvedValue({ code: -1, message: 'nope' })
    await expect(getSubmissions()).rejects.toThrow('nope')
    h.cloud = false
    expect(await getSubmissions()).toEqual([])
  })
})
