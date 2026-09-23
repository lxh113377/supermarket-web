// 看板聚合域 handlers（functions/lib/actions/stats.js）
// H1-2（2026-09-05）：把原 DashboardTab 的客户端聚合（buildRangeData/buildDelta/buildReviewTrend/
// computeGrossMargin/pieSegments/topRevenue）下沉到服务端，前端只收小结果集，
// 消除"浏览器持有全量订单/评价/商品明细做 90/365 天聚合"的内存与渲染压力。
//
// 口径与原前端纯函数逐一对应（dashboard.test.ts 用例迁移到 tests/stats.test.js，防漂移）：
// - 营收口径：cancelled 不计（orderCounts 计全部订单数；revenues 仅非取消）
// - 饮品/食品判定：item.subcategories 命中 drinkSubs 集合 → 饮品，否则食品；无子分类信息归饮品
// - 毛利率：仅统计已填 costPrice 商品的订单（productId 匹配，兜底 name+spec）
// - 时间聚合：按自然日（固定 UTC+8，与服务端统一存储的 ISO UTC 对齐，中国无夏令时）
// 注意：AI 建议（aiAdvice）走 application/actions/ai.js，不在此表。

import { qAll, jparse } from '../db.js'

// ── 常量（与前端 useDashboardCharts/DashboardTab 同源）
const drinkSubs = new Set(['low_sugar', 'vitamin', 'energy', 'tea', 'soda', 'sweet', 'water'])

const DAY_MS = 86400000
const TZ_SHIFT_MS = 8 * 3600000 // UTC+8（Asia/Shanghai，无夏令时）

// ISO(UTC) → 本地(z+8) 日序号（以 epoch day 计）
function localDay(t) {
  return Math.floor((t + TZ_SHIFT_MS) / DAY_MS)
}

// 日序号 → UTC+8 自然日的「M/D」标签（与 localDay 同口径）。
// ⚠️ 旧实现直接用 new Date(...).getMonth()/getDate()——那是**运行环境本地时区**：
//    在 Cloudflare / GitHub Actions 等 UTC 环境下，标签会比 UTC+8 分桶**整体错位一天**
//    （2026-09-18 CI 实测暴露：分桶按 UTC+8、标签按 UTC）。此处统一走 UTC 方法读取。
function localDayLabel(dayIndex) {
  const d = new Date(dayIndex * DAY_MS - TZ_SHIFT_MS)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

// 自然日区间聚合 订单数/营收（labels 本地 M/D；今天为末位）
// nowMs 由 getDashboardStats 单次传入：三个聚合函数各调一次 Date.now() 会在
// 午夜边界错开一天（分桶与标签各执一词）。默认 Date.now() 保持单测 2 参调用兼容。
export function buildRangeData(orders, days, nowMs = Date.now()) {
  const now = nowMs
  const labels = []
  const orderCounts = new Array(days).fill(0)
  const revenues = new Array(days).fill(0)
  const today = localDay(now)
  // labels 与分桶同源（UTC+8 日序号），避免运行环境时区导致标签与数据错位
  for (let i = days - 1; i >= 0; i--) {
    labels.push(localDayLabel(today - i))
  }
  for (const o of orders) {
    const t = new Date(o.createdAt).getTime()
    if (Number.isNaN(t)) continue
    const diff = today - localDay(t)
    if (diff < 0 || diff >= days) continue
    orderCounts[days - 1 - diff] += 1
    if (o.status !== 'cancelled') revenues[days - 1 - diff] += Number(o.totalAmount) || 0
  }
  return { labels, orderCounts, revenues }
}

// 本期 vs 上期 环比（百分比；基数为 0 返回 null）
export function buildDelta(orders, days, nowMs = Date.now()) {
  const now = nowMs
  const today = localDay(now)
  const half = (offsetDays) => {
    const from = (today - offsetDays - days + 1) * DAY_MS - TZ_SHIFT_MS
    const to = (today - offsetDays + 1) * DAY_MS - TZ_SHIFT_MS
    let cnt = 0
    let rev = 0
    for (const o of orders) {
      const t = new Date(o.createdAt).getTime()
      if (Number.isNaN(t)) continue
      if (t >= from && t < to) {
        cnt += 1
        if (o.status !== 'cancelled') rev += Number(o.totalAmount) || 0
      }
    }
    return { cnt, rev }
  }
  const cur = half(0)
  const prev = half(days)
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)
  return { ordersDelta: pct(cur.cnt, prev.cnt), revenueDelta: pct(cur.rev, prev.rev) }
}

// 近 N 天评价趋势（今天为末位）
export function buildReviewTrend(reviews, days = 14, nowMs = Date.now()) {
  const now = nowMs
  const counts = new Array(days).fill(0)
  const labels = []
  const today = localDay(now)
  // 同 buildRangeData：labels 与分桶同源（UTC+8 日序号）
  for (let i = days - 1; i >= 0; i--) {
    labels.push(localDayLabel(today - i))
  }
  for (const r of reviews) {
    if (!r.createdAt) continue
    const t = new Date(r.createdAt).getTime()
    if (Number.isNaN(t)) continue
    const diff = today - localDay(t)
    if (diff >= 0 && diff < days) counts[days - 1 - diff] += 1
  }
  return { counts, labels }
}

// 饮品/食品毛利率
function nameSpecKey(name, spec) {
  return `${name}|${spec || ''}`
}

function toMargin(revenue, cost) {
  if (revenue <= 0) return null
  const r = Math.round(revenue * 100) / 100
  const c = Math.round(cost * 100) / 100
  return { revenue: r, cost: c, marginPct: Math.round(((r - c) / r) * 100) }
}

export function computeGrossMargin(orders, products) {
  const byId = new Map(products.map((p) => [p._id, p]))
  const byNameSpec = new Map(products.map((p) => [nameSpecKey(p.name, p.spec), p]))
  const acc = { drink: { revenue: 0, cost: 0 }, food: { revenue: 0, cost: 0 } }
  let withCostItems = 0
  let totalItems = 0
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    for (const item of o.items || []) {
      const qty = Number(item.quantity) || 0
      totalItems += qty
      const product = byId.get(item.productId) || byNameSpec.get(nameSpecKey(item.name, item.spec))
      if (!product || product.costPrice == null) continue
      const revenue = (Number(item.price) || 0) * qty
      const cost = Number(product.costPrice) * qty
      const isDrink = Array.isArray(item.subcategories)
        ? item.subcategories.some((s) => drinkSubs.has(s))
        : true
      if (isDrink) {
        acc.drink.revenue += revenue
        acc.drink.cost += cost
      } else {
        acc.food.revenue += revenue
        acc.food.cost += cost
      }
      withCostItems += qty
    }
  }
  return {
    drink: toMargin(acc.drink.revenue, acc.drink.cost),
    food: toMargin(acc.food.revenue, acc.food.cost),
    withCostItems,
    totalItems,
  }
}

// 饮品/食品销量占比（与前端 subcategories 判定一致）
export function buildPieSegments(orders) {
  let drinkQty = 0
  let foodQty = 0
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    for (const i of o.items || []) {
      if (Array.isArray(i.subcategories)) {
        if (i.subcategories.some((s) => drinkSubs.has(s))) drinkQty += i.quantity
        else foodQty += i.quantity
      } else {
        drinkQty += i.quantity
      }
    }
  }
  return [
    { name: '饮品', value: drinkQty },
    { name: '食品', value: foodQty },
  ].filter((s) => s.value > 0)
}

// 热销 TOP10（按营收，cancelled 不计）
export function buildTopRevenue(orders) {
  const rev = new Map()
  const qty = new Map()
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    for (const it of o.items || []) {
      const key = it.name + (it.spec ? `(${it.spec})` : '')
      const q = Number(it.quantity) || 0
      rev.set(key, (rev.get(key) || 0) + (Number(it.price) || 0) * q)
      qty.set(key, (qty.get(key) || 0) + q)
    }
  }
  return [...rev.entries()]
    .map(([name, revenue]) => ({ name, revenue, qty: qty.get(name) || 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
}

// 一次拉齐看板所需数据并做服务端聚合，返回小结果集。
// 数据量：社区超市量级，订单 LIMIT 5000（覆盖全年 365 天看板）足够。
export async function getDashboardStats(DB, payload) {
  const rangeDays = Math.min(365, Math.max(1, Number(payload?.rangeDays) || 7))
  // 单次快照时刻：三个聚合函数共用同一 nowMs，午夜边界分桶一致
  const nowMs = Date.now()
  const orderRows = await qAll(DB,
    `SELECT _id, roomNumber, items, totalAmount, status, createdAt
     FROM orders ORDER BY createdAt DESC LIMIT 5000`)
  const orders = orderRows.map((r) => ({ ...r, items: jparse(r.items, []) }))

  const reviewRows = await qAll(DB,
    `SELECT createdAt FROM reviews WHERE createdAt >= ?`,
    [new Date(Date.now() - 14 * DAY_MS).toISOString()])
  const reviews = reviewRows.map((r) => ({ createdAt: r.createdAt }))

  const prodRows = await qAll(DB, `SELECT _id, name, spec, costPrice FROM products LIMIT 1000`)
  const products = prodRows.map((r) => ({
    _id: r._id, name: r.name, spec: r.spec || '', costPrice: r.costPrice == null ? null : Number(r.costPrice),
  }))

  const rangeData = buildRangeData(orders, rangeDays, nowMs)
  const delta = buildDelta(orders, rangeDays, nowMs)
  const reviewTrend = buildReviewTrend(reviews, 14, nowMs)
  const margin = computeGrossMargin(orders, products)
  const pieSegments = buildPieSegments(orders)
  const topRevenue = buildTopRevenue(orders)
  const revenueSum = rangeData.revenues.reduce((s, v) => s + v, 0)
  const orderSum = rangeData.orderCounts.reduce((s, v) => s + v, 0)
  const totalOrders = orders.length

  return {
    code: 0,
    data: { rangeDays, rangeData, delta, reviewTrend, margin, pieSegments, topRevenue, revenueSum, orderSum, totalOrders },
  }
}