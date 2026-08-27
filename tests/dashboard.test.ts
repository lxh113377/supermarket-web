import { describe, it, expect } from 'vitest'
import { buildReviewTrend, computeGrossMargin, buildRangeData, buildDelta, buildCsv } from '../src/components/DashboardTab'
import type { Order, Product, Review } from '../src/types'

function daysAgoDate(days: number, hour = 10): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(hour, 0, 0, 0)
  return d
}

function review(over: Partial<Review>): Review {
  return { productOrder: 1, user: 'u', rating: 5, text: 't', ...over }
}

describe('buildReviewTrend', () => {
  it('空数据返回 14 天全零窗口，今天为末位', () => {
    const { counts, labels } = buildReviewTrend([])
    expect(counts).toHaveLength(14)
    expect(labels).toHaveLength(14)
    expect(counts.every((v) => v === 0)).toBe(true)
    const today = new Date()
    expect(labels[13]).toBe(`${today.getMonth() + 1}/${today.getDate()}`)
  })

  it('今天/昨天/第 14 天边界正确聚合', () => {
    const { counts } = buildReviewTrend([
      review({ createdAt: daysAgoDate(0) }),
      review({ createdAt: daysAgoDate(1) }),
      review({ createdAt: daysAgoDate(13) }),
    ])
    expect(counts[13]).toBe(1) // 今天
    expect(counts[12]).toBe(1) // 昨天
    expect(counts[0]).toBe(1) // 第 14 天（窗口首日）
  })

  it('窗口外（第 15 天）不聚合；无 createdAt/非法日期跳过', () => {
    const { counts } = buildReviewTrend([
      review({ createdAt: daysAgoDate(14) }),
      review({ createdAt: 'not-a-date' }),
      review({ createdAt: undefined }),
      review({}),
    ])
    expect(counts.every((v) => v === 0)).toBe(true)
  })

  it('支持自定义窗口天数', () => {
    const { counts, labels } = buildReviewTrend([review({ createdAt: daysAgoDate(3) })], 7)
    expect(counts).toHaveLength(7)
    expect(labels).toHaveLength(7)
    expect(counts[3]).toBe(1)
  })
})

describe('computeGrossMargin', () => {
  const products: Product[] = [
    { _id: 'p1', name: '可乐', price: 3.5, costPrice: 2.2 },
    { _id: 'p2', name: '薯片', spec: '原味', price: 6, costPrice: 4 },
    { _id: 'p3', name: '无成本商品', price: 5 },
  ]

  const order = (items: Order['items']): Order => ({
    _id: 'o1',
    roomNumber: '301',
    status: 'paid',
    items,
    totalAmount: 10,
    createdAt: daysAgoDate(0),
  })

  it('空订单：双分类 null、待录入标记', () => {
    const r = computeGrossMargin([], products)
    expect(r.drink).toBeNull()
    expect(r.food).toBeNull()
    expect(r.withCostItems).toBe(0)
    expect(r.totalItems).toBe(0)
  })

  it('无成本商品不参与统计（待录入）', () => {
    const r = computeGrossMargin([order([{ productId: 'p3', name: '无成本商品', price: 5, quantity: 2 }])], products)
    expect(r.withCostItems).toBe(0)
    expect(r.totalItems).toBe(2)
    expect(r.drink).toBeNull()
    expect(r.food).toBeNull()
  })

  it('productId 匹配 + 子分类归饮品（sweet）：公式与取整正确', () => {
    const r = computeGrossMargin([
      order([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 2, subcategories: ['sweet'] }]),
    ], products)
    expect(r.drink).toEqual({ revenue: 7, cost: 4.4, marginPct: 37 })
    expect(r.food).toBeNull()
    expect(r.withCostItems).toBe(2)
    expect(r.totalItems).toBe(2)
  })

  it('无子分类信息归饮品（与现状一致）', () => {
    const r = computeGrossMargin([
      order([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 1 }]),
    ], products)
    expect(r.drink).not.toBeNull()
    expect(r.food).toBeNull()
  })

  it('name+spec 兜底匹配（productId 失效时）', () => {
    const r = computeGrossMargin([
      order([{ productId: 'missing-id', name: '薯片', spec: '原味', price: 6, quantity: 3, subcategories: ['snack'] }]),
    ], products)
    expect(r.food).toEqual({ revenue: 18, cost: 12, marginPct: 33 })
    expect(r.drink).toBeNull()
  })

  it('cancelled 订单不计入；0 销量条目不产生毛利率', () => {
    const r = computeGrossMargin([
      order([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 2, subcategories: ['sweet'] }]),
      { ...order([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 5, subcategories: ['sweet'] }]), status: 'cancelled' },
      order([{ productId: 'p2', name: '薯片', spec: '原味', price: 6, quantity: 0, subcategories: ['snack'] }]),
    ], products)
    expect(r.totalItems).toBe(2) // 仅第一单
    expect(r.withCostItems).toBe(2)
    expect(r.drink?.revenue).toBe(7)
    expect(r.food).toBeNull() // 0 销量 → 暂无销售
  })
})

describe('buildRangeData', () => {
  const o = (createdAt: string, totalAmount = 10, status: string = 'paid'): Order => ({
    _id: Math.random().toString(36).slice(2),
    roomNumber: '301',
    status: status as Order['status'],
    items: [],
    totalAmount,
    createdAt,
  })

  it('空订单返回 N 天窗口（今天为末位，全零）', () => {
    const r = buildRangeData([], 7)
    expect(r.labels).toHaveLength(7)
    expect(r.orderCounts.every((v) => v === 0)).toBe(true)
    expect(r.revenues.every((v) => v === 0)).toBe(true)
  })

  it('今天/昨天正确聚合，营收与订单数独立计数', () => {
    const today = new Date()
    const todayIso = today.toISOString()
    const yest = new Date(today.getTime() - 86400000).toISOString()
    const r = buildRangeData([o(todayIso, 100), o(yest, 50), o(todayIso, 30)], 7)
    expect(r.orderCounts[6]).toBe(2) // 今天 2 单
    expect(r.orderCounts[5]).toBe(1) // 昨天 1 单
    expect(r.revenues[6]).toBe(130)
    expect(r.revenues[5]).toBe(50)
  })

  it('窗口外订单不聚合；cancelled 不计营收但计订单数', () => {
    const longAgo = new Date(Date.now() - 10 * 86400000).toISOString()
    const today = new Date().toISOString()
    const r = buildRangeData([
      o(longAgo, 999),
      o(today, 100, 'cancelled'),
      o(today, 0, 'cancelled'),
    ], 7)
    expect(r.orderCounts[6]).toBe(2) // cancelled 计入订单数（口径：统计所有订单）
    expect(r.revenues[6]).toBe(0) // cancelled 不计营收
    expect(r.orderCounts.slice(0, 6).every((v) => v === 0)).toBe(true)
  })

  it('非法日期跳过，不抛错', () => {
    const r = buildRangeData([o('not-a-date', 100)], 7)
    expect(r.orderCounts.every((v) => v === 0)).toBe(true)
  })
})

describe('buildDelta', () => {
  const o = (createdAt: string, totalAmount = 10, status: string = 'paid'): Order => ({
    _id: Math.random().toString(36).slice(2),
    roomNumber: '301',
    status: status as Order['status'],
    items: [],
    totalAmount,
    createdAt,
  })

  it('本期 3 单 vs 上期 2 单：订单 +50%、营收 +50%', () => {
    const today = new Date()
    const d = (ago: number) => new Date(today.getTime() - ago * 86400000).toISOString()
    // 本期（近7天）3 单 300 元；上期 2 单 200 元
    const orders = [
      o(d(1), 100), o(d(2), 100), o(d(3), 100),
      o(d(8), 100), o(d(9), 100),
    ]
    const r = buildDelta(orders, 7)
    expect(r.ordersDelta).toBe(50) // (3-2)/2
    expect(r.revenueDelta).toBe(50) // (300-200)/200
  })

  it('无上期数据（基数为 0）返回 null', () => {
    const today = new Date()
    const orders = [o(new Date(today.getTime() - 86400000).toISOString(), 10)]
    const r = buildDelta(orders, 7)
    expect(r.ordersDelta).toBeNull()
    expect(r.revenueDelta).toBeNull()
  })

  it('cancelled 计入订单数、不计营收（口径一致）', () => {
    const today = new Date()
    const d = (ago: number) => new Date(today.getTime() - ago * 86400000).toISOString()
    const orders = [
      o(d(1), 100), o(d(2), 100, 'cancelled'),
      o(d(8), 50), o(d(9), 50),
    ]
    const r = buildDelta(orders, 7)
    expect(r.ordersDelta).toBe(0) // 本期2单 vs 上期2单
    expect(r.revenueDelta).toBe(0) // 本期100 vs 上期100
  })
})

describe('buildCsv', () => {
  it('含 BOM、表头齐全、顺序与标签一致', () => {
    const csv = buildCsv({ labels: ['8/27', '8/28'], orderCounts: [1, 2], revenues: [10, 20] })
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace('\uFEFF', '').split('\r\n')
    expect(lines[0]).toBe('日期,订单数,营收(¥)')
    expect(lines[1]).toBe('8/27,1,10')
    expect(lines[2]).toBe('8/28,2,20')
  })

  it('含逗号/引号的内容正确转义', () => {
    const csv = buildCsv({ labels: ['a,b', 'x"y'], orderCounts: [1, 2], revenues: [0, 0] })
    const lines = csv.replace('\uFEFF', '').split('\r\n')
    expect(lines[1]).toBe('"a,b",1,0')
    expect(lines[2]).toBe('"x""y",2,0')
  })
})
