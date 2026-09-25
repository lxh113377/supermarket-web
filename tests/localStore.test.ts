/**
 * src/localStore.ts 门面直测（防线轮 K1，原覆盖 ~53%）。
 *
 * 一个必须写下来的坑：`parseCache` 是**模块级** Map，`localStorage.clear()` 清不掉它。
 * 只清磁盘会让用例之间互相看见对方的解析结果（症状是"明明清了 localStorage 却还返回旧表"），
 * 所以本文件每个用例都 vi.resetModules() + 动态 import 取一份新实例。
 * 下面 parseCache 专项里"故意不清"的两条才是真正在测这个缓存本身。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Store = typeof import('../src/localStore')
const PRODUCTS_KEY = 'sm_products_local'
const ORDERS_KEY = 'sm_orders_local'

let s: Store

async function freshStore(): Promise<Store> {
  vi.resetModules()
  return await import('../src/localStore')
}

beforeEach(async () => {
  localStorage.clear()
  s = await freshStore()
})

describe('parseCache（2026-09-23 性能改造的读语义）', () => {
  it('命中缓存后绕过磁盘：直接改 localStorage 不影响下一次读', async () => {
    localStorage.setItem(ORDERS_KEY, JSON.stringify([{ _id: 'o1', totalAmount: 1 }]))
    const one = await freshStore()
    expect(one.getLocalOrders()).toHaveLength(1)
    localStorage.setItem(ORDERS_KEY, JSON.stringify([{ _id: 'a' }, { _id: 'b' }]))
    expect(one.getLocalOrders()).toHaveLength(1) // 仍读缓存，不是盘上的 2 条
  })

  it('重导模块后才重新 parse（证明上一条是模块级缓存，不是 jsdom 存储行为）', async () => {
    localStorage.setItem(ORDERS_KEY, JSON.stringify([{ _id: 'o1' }]))
    expect((await freshStore()).getLocalOrders()).toHaveLength(1)
    localStorage.setItem(ORDERS_KEY, JSON.stringify([{ _id: 'a' }, { _id: 'b' }]))
    expect((await freshStore()).getLocalOrders()).toHaveLength(2)
  })

  it('写路径先落缓存：写完立刻读到最新值，盘上也已同步', () => {
    s.addLocalOrder({ _id: 'oA' })
    expect(s.getLocalOrders()[0]._id).toBe('oA')
    expect(JSON.parse(localStorage.getItem(ORDERS_KEY)!)[0]._id).toBe('oA')
  })
})

describe('getLocalProducts：播种判定（P1-4「删不掉」回归防线）', () => {
  it('键完全不存在才播种，并立刻落盘', () => {
    expect(localStorage.getItem(PRODUCTS_KEY)).toBeNull()
    const list = s.getLocalProducts()
    expect(list.length).toBeGreaterThan(0)
    expect(localStorage.getItem(PRODUCTS_KEY)).not.toBeNull()
  })

  it('已初始化为空数组时返回空，绝不重新播种', async () => {
    localStorage.setItem(PRODUCTS_KEY, '[]')
    expect((await freshStore()).getLocalProducts()).toEqual([])
  })

  it('删光商品后重进模块仍为空（播种判据若写回 length===0 就会复活）', () => {
    const all = s.getLocalProducts()
    expect(s.deleteLocalProducts(all.map((p) => p._id))).toEqual([])
    expect(s.getLocalProducts()).toEqual([])
  })

  it('坏 JSON → 返回空数组且不抛（本地数据坏了不该白屏）', async () => {
    localStorage.setItem(PRODUCTS_KEY, '{不是 JSON')
    expect((await freshStore()).getLocalProducts()).toEqual([])
  })

  it('非数组的合法 JSON（历史脏值）也归零为空数组', async () => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify({ nope: true }))
    expect((await freshStore()).getLocalProducts()).toEqual([])
  })

  it('读出的是浅拷贝：调用方原地 push/清空不污染下一次读', () => {
    const n = s.getLocalProducts().length
    const first = s.getLocalProducts()
    first.push({ _id: 'ghost' } as never)
    first.length = 0
    expect(s.getLocalProducts()).toHaveLength(n)
  })
})

describe('商品写：单条与批量', () => {
  it('upsertLocalProduct 命中则合并字段，未命中则追加', () => {
    const base = s.getLocalProducts()[0]
    const n = s.getLocalProducts().length
    const updated = s.upsertLocalProduct({ _id: base._id, price: 1.5 })
    expect(updated).toHaveLength(n)
    expect(updated.find((p) => p._id === base._id)!.price).toBe(1.5)
    expect(s.upsertLocalProduct({ _id: 'p_new', name: '新品', order: 999 })).toHaveLength(n + 1)
  })

  it('批量 upsert：同 id 后写覆盖先写、原有项就地更新、新项落末尾', () => {
    const before = s.getLocalProducts()
    const n = before.length
    const a = before[0]._id
    s.upsertLocalProducts([{ _id: a, price: 2 }, { _id: a, price: 3 }, { _id: 'p_x', name: 'X' }])
    const after = s.getLocalProducts()
    expect(after).toHaveLength(n + 1)
    expect(after.find((p) => p._id === a)!.price).toBe(3)
    expect(after.findIndex((p) => p._id === 'p_x')).toBe(n)
  })

  it('批量删除只留未命中的；单条删除同口径', () => {
    const all = s.getLocalProducts()
    const [a, b] = all
    expect(s.deleteLocalProducts([a._id])).toHaveLength(all.length - 1)
    expect(s.deleteLocalProduct(b._id).some((p) => p._id === b._id)).toBe(false)
  })

  it('saveLocalProducts 整表覆盖后立即可读', () => {
    s.saveLocalProducts([{ _id: 'only', name: 'ONLY', price: 1, order: 1 } as never])
    expect(s.getLocalProducts().map((p) => p._id)).toEqual(['only'])
  })
})

describe('订单本地持久化', () => {
  it('addLocalOrder：金额按 price×quantity 累加并两位取整，新单排最前', () => {
    const r = s.addLocalOrder({ items: [{ price: 1.005, quantity: 3 }, { price: 2.5, quantity: 2 }] })
    expect(r.totalAmount).toBe(8.02)
    expect(r.status).toBe('pending')
    const again = s.addLocalOrder({ items: [{ price: 1, quantity: 1 }] })
    expect(s.getLocalOrders().map((o) => o._id)).toEqual([again._id, r._id])
  })

  it('items 不是数组时按空处理（金额 0，不抛）', () => {
    expect(s.addLocalOrder({ items: 'nope' }).totalAmount).toBe(0)
    expect(s.addLocalOrder({}).totalAmount).toBe(0)
  })

  it('price/quantity 非数字按 0 计（脏行不让整单 NaN）', () => {
    expect(s.addLocalOrder({ items: [{ price: 'abc', quantity: undefined }] }).totalAmount).toBe(0)
  })

  it('显式字段覆盖默认值，但 totalAmount 恒由 items 算出', () => {
    const r = s.addLocalOrder({ status: 'paid', room: '302', totalAmount: 999, items: [{ price: 1, quantity: 1 }] })
    expect(r.status).toBe('paid')
    expect(r.room).toBe('302')
    expect(r.totalAmount).toBe(1)
  })

  it('updateLocalOrderStatus 只改命中项并刷新 updatedAt；deleteLocalOrder 摘除命中项', () => {
    const o = s.addLocalOrder({ items: [] })
    const list = s.updateLocalOrderStatus(o._id, 'cancelled')
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('cancelled')
    expect(list[0].updatedAt >= o.updatedAt).toBe(true)
    s.addLocalOrder({ items: [] })
    expect(s.deleteLocalOrder(o._id)).toHaveLength(1)
  })

  it('未命中 id 时状态更新原样返回（不误改他单）', () => {
    s.addLocalOrder({ items: [], _id: 'real' } as never)
    expect(s.updateLocalOrderStatus('nope', 'paid')[0].status).toBe('pending')
  })

  it('读出的订单数组是浅拷贝，原地改动不污染下一次读', () => {
    s.addLocalOrder({ items: [] })
    s.getLocalOrders().push({ _id: 'ghost' } as never)
    expect(s.getLocalOrders()).toHaveLength(1)
  })
})

describe('评价本地持久化（越界与截断收口）', () => {
  it('rating：0 与非法值视作未填退 5，越界才钳到 1..5', () => {
    // 实现是 Math.max(1, Math.min(5, Number(rating) || 5))：0 被 `|| 5` 当未填吞掉，
    // 所以下限只有负数才碰得到 —— 别写成 rating:0 → 1（本轮实测踩过这个断言）
    expect(s.addLocalReview(1, { rating: 0 }).rating).toBe(5)
    expect(s.addLocalReview(1, { rating: 'x' as never }).rating).toBe(5)
    expect(s.addLocalReview(1, { rating: 99 }).rating).toBe(5)
    expect(s.addLocalReview(1, { rating: -3 }).rating).toBe(1)
  })

  it('text 截到 500 字，缺省为空串', () => {
    expect(s.addLocalReview(2, { text: '长'.repeat(600) }).text).toHaveLength(500)
    expect(s.addLocalReview(2, {}).text).toBe('')
  })

  it('images 过滤非字符串并截到 5 张；非数组退空', () => {
    expect(s.addLocalReview(3, { images: ['a', 1, 'b', 'c', 'd', 'e', 'f'] as never }).images)
      .toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(s.addLocalReview(3, { images: 'nope' as never }).images).toEqual([])
  })

  it('user 缺省「匿名用户」；productOrder 归一为 number；date 只留年月日', () => {
    expect(s.addLocalReview('42', {})).toMatchObject({ productOrder: 42, user: '匿名用户' })
    expect(s.addLocalReview(42, {}).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('按商品分桶且新评在前；数字与字符串 order 同桶', () => {
    s.addLocalReview(5, { text: 'first' })
    s.addLocalReview(5, { text: 'second' })
    s.addLocalReview(6, { text: 'other' })
    expect(s.getLocalReviews(5).map((r) => r.text)).toEqual(['second', 'first'])
    expect(s.getLocalReviews('5').map((r) => r.text)).toEqual(['second', 'first'])
    expect(s.getLocalReviews(6)).toHaveLength(1)
  })

  it('读不存在的商品返回空数组', () => {
    expect(s.getLocalReviews(77)).toEqual([])
  })

  it('读出的评价数组是浅拷贝', () => {
    s.addLocalReview(8, { text: 'a' })
    s.getLocalReviews(8).push({ text: 'ghost' } as never)
    expect(s.getLocalReviews(8)).toHaveLength(1)
  })
})

describe('localStorage 不可用（隐私模式/配额满）', () => {
  it('写盘失败只告警，不向上打断下单流程', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const itemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => s.addLocalOrder({ items: [{ price: 1, quantity: 1 }] })).not.toThrow()
    expect(spy).toHaveBeenCalled()
    itemSpy.mockRestore()
    spy.mockRestore()
  })

  it('读盘抛错时退化为 fallback（不冒泡成白屏）', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(s.getLocalOrders()).toEqual([])
    getSpy.mockRestore()
  })
})

/*
 * 反例（改回朴素实现后对应用例必须变红；已在本轮逐条实跑）：
 * 1 readJSON 去掉 parseCache 命中分支            → parseCache 前两条红
 * 2 getLocalProducts 用 list.length===0 判未初始化 → 「删光后仍为空」红
 * 3 getLocalProducts 先判空再 readJSON（两次 I/O 旧写法）→ 播种落盘断言仍绿，去掉 raw===null 分支则「空数组返回空」红
 * 4 坏 JSON 分支改成直接抛出                      → 「不抛」两例红
 * 5 去掉 cloneArray（直返缓存引用）               → 三条「浅拷贝」红
 * 6 upsertLocalProducts 不 delete-on-apply        → 「同 id 后写覆盖」变两条，长度断言红
 * 7 totalAmount 改为信任传入值                     → 「恒由 items 算出」红
 * 8 去掉 rating 钳制 / text 截断 / images 过滤     → 对应三条红
 * 9 writeJSON 不 try/catch                        → 「写盘失败不抛」红
 */
