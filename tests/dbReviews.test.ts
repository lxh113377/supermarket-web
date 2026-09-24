/**
 * db/reviews 门面全分支测试（六轮 G 批：src/db/reviews.ts 原覆盖 1.81%）
 * 口径与第四轮 dbFacades 一致：可变 IS_CLOUD getter 切云/本地，pickReviewFields 用**真实**
 * 白名单实现（而不是直通函数）——这样"多余字段不进载荷"本身也是被测到的。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  cloud: true,
  adminCall: vi.fn(),
  publicCall: vi.fn(),
}))

vi.mock('../src/cloudbase', () => ({ get IS_CLOUD() { return h.cloud } }))
vi.mock('../src/auth', async () => {
  const f = await import('../src/api/fields')
  return { adminCall: h.adminCall, publicCall: h.publicCall, pickReviewFields: f.pickReviewFields }
})

import {
  addReview, addCloudReview, deleteCloudReview,
  getAllReviews, getCloudReviews, getLocalProductReviews,
} from '../src/db/reviews'
import { clearCatalogCache } from '../src/catalogCache'

beforeEach(() => {
  localStorage.clear()
  clearCatalogCache()
  vi.clearAllMocks()
  h.cloud = true
})

describe('addReview（顾客/管理员共用入口）', () => {
  it('云端成功：走 addPublicReview + 默认值补齐 + 白名单裁剪', async () => {
    h.adminCall.mockResolvedValue({ code: 0, data: { _id: 'r1' } })
    const r = await addReview('20', { text: '好喝', rating: 0, evil: 'x' } as never)
    expect(r).toEqual({ _id: 'r1' })
    const [action, payload] = h.adminCall.mock.calls[0]
    expect(action).toBe('addPublicReview')
    expect(payload).toEqual({ productOrder: 20, user: '匿名用户', rating: 5, text: '好喝' })
    expect('evil' in payload).toBe(false)
  })

  it('云端失败降级本地：返回值可在本地评价里读到', async () => {
    h.adminCall.mockResolvedValue({ code: -1, message: 'quota' })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await addReview(21, { text: '本地留存', user: 'u1', rating: 4, images: ['a.webp'] })
    expect(spy).toHaveBeenCalled()
    const local = getLocalProductReviews(21)
    expect(local[0].text).toBe('本地留存')
    expect(local[0].images).toEqual(['a.webp'])
    spy.mockRestore()
  })

  it('云端抛错同样降级（不向上冒泡打断下单/评价流）', async () => {
    h.adminCall.mockRejectedValue(new Error('offline'))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rec = await addReview(22, { text: 'x' })
    expect((rec as { productOrder: number }).productOrder).toBe(22)
    spy.mockRestore()
  })

  it('本地模式不发请求', async () => {
    h.cloud = false
    await addReview(23, { text: 'y' })
    expect(h.adminCall).not.toHaveBeenCalled()
    expect(getLocalProductReviews(23)).toHaveLength(1)
  })
})

describe('getCloudReviews（60s TTL 缓存）', () => {
  it('成功一次后二次命中缓存；提交评价后精确失效该商品缓存', async () => {
    h.publicCall.mockResolvedValue({ code: 0, data: [{ _id: 'r1', text: 'a' }] })
    expect(await getCloudReviews(30)).toHaveLength(1)
    expect(await getCloudReviews(30)).toHaveLength(1)
    expect(h.publicCall).toHaveBeenCalledTimes(1)

    h.adminCall.mockResolvedValue({ code: 0, data: { _id: 'r2' } })
    await addReview(30, { text: 'new' })
    h.publicCall.mockResolvedValue({ code: 0, data: [{ _id: 'r1' }, { _id: 'r2' }] })
    expect(await getCloudReviews(30)).toHaveLength(2)
    expect(h.publicCall).toHaveBeenCalledTimes(2)
  })

  it('非云端直接空数组（不请求）', async () => {
    h.cloud = false
    expect(await getCloudReviews(31)).toEqual([])
    expect(h.publicCall).not.toHaveBeenCalled()
  })

  it('code!=0 与抛错都降级为空数组（评价读失败不该打断详情页）', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.publicCall.mockResolvedValue({ code: -1, message: 'bad' })
    expect(await getCloudReviews(32)).toEqual([])
    h.publicCall.mockRejectedValue(new Error('net'))
    expect(await getCloudReviews(33)).toEqual([])
    spy.mockRestore()
  })
})

describe('管理端评价写删与列表', () => {
  it('addCloudReview 成功：双键失效（该商品 + 全量列表）', async () => {
    h.publicCall.mockResolvedValue({ code: 0, data: [{ _id: 'r1' }] })
    await getCloudReviews(40)
    h.adminCall.mockResolvedValue({ code: 0, data: { _id: 'r9' } })
    await expect(addCloudReview(40, { text: '管理员补录' })).resolves.toEqual({ _id: 'r9' })
    expect(h.adminCall).toHaveBeenCalledWith('addReview', {
      productOrder: 40, user: '管理员', rating: 5, text: '管理员补录',
    })
    h.publicCall.mockResolvedValue({ code: 0, data: [] })
    await getCloudReviews(40)
    expect(h.publicCall).toHaveBeenCalledTimes(2) // 缓存已失效 → 重新拉
  })

  it('addCloudReview 失败抛错（管理端要看见失败）；本地模式落本地', async () => {
    h.adminCall.mockResolvedValue({ code: -1, message: '权限不足' })
    await expect(addCloudReview(41, { text: 'x' })).rejects.toThrow('权限不足')
    h.cloud = false
    await addCloudReview(41, { text: '本地' })
    expect(getLocalProductReviews(41)).toHaveLength(1)
  })

  it('deleteCloudReview：成功后目录缓存全清，失败抛错，非云端视为成功', async () => {
    h.publicCall.mockResolvedValue({ code: 0, data: [{ _id: 'r1' }] })
    expect(await getCloudReviews(43)).toHaveLength(1)
    h.adminCall.mockResolvedValue({ code: 0 })
    await expect(deleteCloudReview('r1')).resolves.toBe(true)
    h.publicCall.mockResolvedValue({ code: 0, data: [] })
    expect(await getCloudReviews(43)).toEqual([]) // 缓存全清 → 重新拉，不会留着已删的那条
    expect(h.publicCall).toHaveBeenCalledTimes(2)
    h.adminCall.mockResolvedValue({ code: -1, message: '不存在' })
    await expect(deleteCloudReview('rX')).rejects.toThrow('不存在')
    h.cloud = false
    await expect(deleteCloudReview('r1')).resolves.toBe(true)
  })

  it('getAllReviews：缓存命中不重复拉全量，code!=0 抛错', async () => {
    h.adminCall.mockResolvedValue({ code: 0, data: [{ _id: 'a' }, { _id: 'b' }] })
    expect(await getAllReviews()).toHaveLength(2)
    expect(await getAllReviews()).toHaveLength(2)
    expect(h.adminCall).toHaveBeenCalledTimes(1)
    h.cloud = false
    expect(await getAllReviews()).toEqual([])
    h.cloud = true
    clearCatalogCache()
    h.adminCall.mockResolvedValue({ code: -1, message: 'D1 超时' })
    await expect(getAllReviews()).rejects.toThrow('D1 超时')
  })
})
