import { describe, it, expect } from 'vitest'
import { buildReviewTrend, computeGrossMargin, buildRangeData, buildDelta } from '../functions/lib/actions/stats'

// H1-2（2026-09-05）：看板聚合函数从 DashboardTab 迁移至 functions/lib/actions/stats.js，
// 本测试改为直测服务端模块，确保聚合口径不随前端下沉而漂移（口径已统一为固定 UTC+8 自然日）。

// ⚠️ 口径对齐（2026-09-18 修复）：被测函数按「固定 UTC+8 自然日」分桶，
// 测试数据必须在**同一口径**下构造——旧写法用本地时区 setHours()，
// 在 UTC 环境（GitHub Actions runner 默认）会落到相邻桶，导致 CI 红而本地绿。
const DAY_MS = 86400000
const TZ8_MS = 8 * 3600000

const utc8TodayIndex = () => Math.floor((Date.now() + TZ8_MS) / DAY_MS)

function daysAgoDate(days, hour = 10) {
  return new Date((utc8TodayIndex() - days) * DAY_MS + hour * 3600000 - TZ8_MS)
}

function utc8TodayLabel() {
  const d = new Date(utc8TodayIndex() * DAY_MS - TZ8_MS)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

function review(over) {
  return { productOrder: 1, user: 'u', rating: 5, text: 't', ...over }
}

function order(createdAt, totalAmount = 10, status = 'paid') {
  return { _id: Math.random().toString(36).slice(2), roomNumber: '301', status, items: [], totalAmount, createdAt }
}

function orderWithItems(items, status = 'paid') {
  return { _id: 'o1', roomNumber: '301', status, items, totalAmount: 10, createdAt: daysAgoDate(0) }
}

describe('buildReviewTrend', () => {
  it('空数据返回 14 天全零窗口，今天为末位', () => {
    const { counts, labels } = buildReviewTrend([])
    expect(counts).toHaveLength(14)
    expect(labels).toHaveLength(14)
    expect(counts.every((v) => v === 0)).toBe(true)
    // 末位标签 = UTC+8 的今天（与分桶同口径，任何时区下均应一致）
    expect(labels[13]).toBe(utc8TodayLabel())
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
  const products = [
    { _id: 'p1', name: '可乐', price: 3.5, costPrice: 2.2 },
    { _id: 'p2', name: '薯片', spec: '原味', price: 6, costPrice: 4 },
    { _id: 'p3', name: '无成本商品', price: 5 },
  ]

  it('空订单：双分类 null、待录入标记', () => {
    const r = computeGrossMargin([], products)
    expect(r.drink).toBeNull()
    expect(r.food).toBeNull()
    expect(r.withCostItems).toBe(0)
    expect(r.totalItems).toBe(0)
  })

  it('无成本商品不参与统计（待录入）', () => {
    const r = computeGrossMargin([orderWithItems([{ productId: 'p3', name: '无成本商品', price: 5, quantity: 2 }])], products)
    expect(r.withCostItems).toBe(0)
    expect(r.totalItems).toBe(2)
    expect(r.drink).toBeNull()
    expect(r.food).toBeNull()
  })

  it('productId 匹配 + 子分类归饮品（sweet）：公式与取整正确', () => {
    const r = computeGrossMargin([
      orderWithItems([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 2, subcategories: ['sweet'] }]),
    ], products)
    expect(r.drink).toEqual({ revenue: 7, cost: 4.4, marginPct: 37 })
    expect(r.food).toBeNull()
    expect(r.withCostItems).toBe(2)
    expect(r.totalItems).toBe(2)
  })

  it('无子分类信息归饮品（与现状一致）', () => {
    const r = computeGrossMargin([
      orderWithItems([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 1 }]),
    ], products)
    expect(r.drink).not.toBeNull()
    expect(r.food).toBeNull()
  })

  it('name+spec 兜底匹配（productId 失效时）', () => {
    const r = computeGrossMargin([
      orderWithItems([{ productId: 'missing-id', name: '薯片', spec: '原味', price: 6, quantity: 3, subcategories: ['snack'] }]),
    ], products)
    expect(r.food).toEqual({ revenue: 18, cost: 12, marginPct: 33 })
    expect(r.drink).toBeNull()
  })

  it('cancelled 订单不计入；0 销量条目不产生毛利率', () => {
    const r = computeGrossMargin([
      orderWithItems([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 2, subcategories: ['sweet'] }]),
      orderWithItems([{ productId: 'p1', name: '可乐', price: 3.5, quantity: 5, subcategories: ['sweet'] }], 'cancelled'),
      orderWithItems([{ productId: 'p2', name: '薯片', spec: '原味', price: 6, quantity: 0, subcategories: ['snack'] }]),
    ], products)
    expect(r.totalItems).toBe(2) // 仅第一单
    expect(r.withCostItems).toBe(2)
    expect(r.drink?.revenue).toBe(7)
    expect(r.food).toBeNull() // 0 销量 → 暂无销售
  })
})

describe('buildRangeData', () => {
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
    const r = buildRangeData([order(todayIso, 100), order(yest, 50), order(todayIso, 30)], 7)
    expect(r.orderCounts[6]).toBe(2) // 今天 2 单
    expect(r.orderCounts[5]).toBe(1) // 昨天 1 单
    expect(r.revenues[6]).toBe(130)
    expect(r.revenues[5]).toBe(50)
  })

  it('窗口外订单不聚合；cancelled 不计营收但计订单数', () => {
    const longAgo = new Date(Date.now() - 10 * 86400000).toISOString()
    const today = new Date().toISOString()
    const r = buildRangeData([
      order(longAgo, 999),
      order(today, 100, 'cancelled'),
      order(today, 0, 'cancelled'),
    ], 7)
    expect(r.orderCounts[6]).toBe(2) // cancelled 计入订单数（口径：统计所有订单）
    expect(r.revenues[6]).toBe(0) // cancelled 不计营收
    expect(r.orderCounts.slice(0, 6).every((v) => v === 0)).toBe(true)
  })

  it('非法日期跳过，不抛错', () => {
    const r = buildRangeData([order('not-a-date', 100)], 7)
    expect(r.orderCounts.every((v) => v === 0)).toBe(true)
  })
})

describe('buildDelta', () => {
  it('本期 3 单 vs 上期 2 单：订单 +50%、营收 +50%', () => {
    const today = new Date()
    const d = (ago) => new Date(today.getTime() - ago * 86400000).toISOString()
    // 本期（近7天）3 单 300 元；上期 2 单 200 元
    const orders = [
      order(d(1), 100), order(d(2), 100), order(d(3), 100),
      order(d(8), 100), order(d(9), 100),
    ]
    const r = buildDelta(orders, 7)
    expect(r.ordersDelta).toBe(50) // (3-2)/2
    expect(r.revenueDelta).toBe(50) // (300-200)/200
  })

  it('无上期数据（基数为 0）返回 null', () => {
    const today = new Date()
    const orders = [order(new Date(today.getTime() - 86400000).toISOString(), 10)]
    const r = buildDelta(orders, 7)
    expect(r.ordersDelta).toBeNull()
    expect(r.revenueDelta).toBeNull()
  })

  it('cancelled 计入订单数、不计营收（口径一致）', () => {
    const today = new Date()
    const d = (ago) => new Date(today.getTime() - ago * 86400000).toISOString()
    const orders = [
      order(d(1), 100), order(d(2), 100, 'cancelled'),
      order(d(8), 50), order(d(9), 50),
    ]
    const r = buildDelta(orders, 7)
    expect(r.ordersDelta).toBe(0) // 本期2单 vs 上期2单
    expect(r.revenueDelta).toBe(0) // 本期100 vs 上期100
  })
})