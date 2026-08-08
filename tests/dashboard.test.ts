import { describe, it, expect } from 'vitest'
import { buildReviewTrend, computeGrossMargin } from '../src/components/DashboardTab'
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
