import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Order, Product, Review } from '../types'
import { adminCall } from '../auth'
import { IconChart, IconBox } from './Icons'

// ⚠ react(only-export-components) 警告为既有模式：纯函数导出供 vitest 直测（dashboard.test.ts）
// ─────────────────────────────────────────────────────────────
// 纯函数（供单测）：近 14 天评价趋势
export interface ReviewTrend {
  counts: number[]
  labels: string[]
}

function dayNum(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

// 按本地日界聚合 createdAt；今天为末位，labels 格式 M/D；无 createdAt/非法日期跳过
export function buildReviewTrend(reviews: Review[], days = 14): ReviewTrend {
  const now = new Date()
  const counts: number[] = new Array(days).fill(0)
  const labels: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`)
  }
  const today = dayNum(now)
  for (const r of reviews) {
    if (!r.createdAt) continue
    const t = new Date(r.createdAt).getTime()
    if (Number.isNaN(t)) continue
    const diff = today - dayNum(new Date(t))
    if (diff >= 0 && diff < days) counts[days - 1 - diff] += 1
  }
  return { counts, labels }
}

// ─────────────────────────────────────────────────────────────
// 纯函数（供单测）：按自然日区间聚合 订单数/营收
export interface RangeData {
  labels: string[]
  orderCounts: number[]
  revenues: number[]
}

export function buildRangeData(orders: Order[], days: number): RangeData {
  const now = new Date()
  const labels: string[] = []
  const orderCounts: number[] = new Array(days).fill(0)
  const revenues: number[] = new Array(days).fill(0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`)
  }
  // 今天为末位：窗口首日
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)
  const idx = (t: Date): number =>
    Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - start.getTime()) / 86400000)
  for (const o of orders) {
    const t = new Date(o.createdAt)
    if (Number.isNaN(t.getTime())) continue
    const i = idx(t)
    if (i < 0 || i >= days) continue
    orderCounts[i] += 1
    // 营收口径：cancelled 不计（沿用现状）
    if (o.status !== 'cancelled') revenues[i] += Number(o.totalAmount) || 0
  }
  return { labels, orderCounts, revenues }
}

// ─────────────────────────────────────────────────────────────
// 纯函数（供单测）：本期 vs 上期 环比（百分比；基数为 0 时返回 null）
export interface DeltaResult {
  ordersDelta: number | null
  revenueDelta: number | null
}

export function buildDelta(orders: Order[], days: number): DeltaResult {
  const now = new Date()
  const half = (offset: number) => {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset - days + 1)
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset + 1)
    let cnt = 0
    let rev = 0
    for (const o of orders) {
      const t = new Date(o.createdAt)
      if (Number.isNaN(t.getTime())) continue
      if (t >= from && t < to) {
        cnt += 1
        if (o.status !== 'cancelled') rev += Number(o.totalAmount) || 0
      }
    }
    return { cnt, rev }
  }
  const cur = half(0)
  const prev = half(days)
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)
  return {
    ordersDelta: pct(cur.cnt, prev.cnt),
    revenueDelta: pct(cur.rev, prev.rev),
  }
}

// ─────────────────────────────────────────────────────────────
// 纯函数（供单测）：CSV 生成（逗号/引号/换行转义 + Excel UTF-8 BOM）
export function buildCsv(rangeData: RangeData): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = ['日期,订单数,营收(¥)']
  rangeData.labels.forEach((label, i) => {
    rows.push(`${esc(label)},${esc(rangeData.orderCounts[i])},${esc(rangeData.revenues[i])}`)
  })
  return '\uFEFF' + rows.join('\r\n')
}

function downloadCsv(csv: string, dateStr: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `看板数据_${dateStr}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────────────
// 纯函数（供单测）：饮品/食品毛利率（沿用现状）
export interface MarginSummary {
  revenue: number
  cost: number
  marginPct: number
}

export interface MarginResult {
  drink: MarginSummary | null
  food: MarginSummary | null
  /** 已填成本商品的销量（件）——为 0 时 UI 显示「待录入」 */
  withCostItems: number
  /** 非取消订单总销量（件） */
  totalItems: number
}

const drinkSubs = new Set(['low_sugar', 'vitamin', 'energy', 'tea', 'soda', 'sweet', 'water'])

function nameSpecKey(name: string, spec?: string): string {
  return `${name}|${spec || ''}`
}

function toMargin(revenue: number, cost: number): MarginSummary | null {
  if (revenue <= 0) return null
  const r = Math.round(revenue * 100) / 100
  const c = Math.round(cost * 100) / 100
  return { revenue: r, cost: c, marginPct: Math.round(((r - c) / r) * 100) }
}

// 仅统计已填 costPrice 商品的订单；productId 匹配，兜底 name+spec
export function computeGrossMargin(orders: Order[], products: Product[]): MarginResult {
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
        : true // 无子分类信息归饮品（与现状一致）
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

// ─────────────────────────────────────────────────────────────
// KPI count-up 动画（尊重 prefers-reduced-motion，直接落最终值）
function useCountUp(target: number, duration = 700): number {
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
    [],
  )
  const [value, setValue] = useState(0)
  const prevRef = useRef(0)
  useEffect(() => {
    if (reduced) {
      setValue(target)
      prevRef.current = target
      return
    }
    const from = prevRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      if (p >= 1) {
        setValue(target)
        prevRef.current = target
      } else {
        setValue(from + (target - from) * (1 - Math.pow(1 - p, 3)))
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      prevRef.current = target
    }
  }, [target, duration, reduced])
  return value
}

function DeltaBadge({ value, positiveIsGood = true }: { value: number | null; positiveIsGood?: boolean }) {
  if (value === null) return <span className="delta-badge delta-flat">—</span>
  const up = value > 0
  const good = up === positiveIsGood
  return (
    <span className={`delta-badge ${value === 0 ? 'delta-flat' : good ? 'delta-up' : 'delta-down'}`}>
      {up ? '▲' : value < 0 ? '▼' : '◆'}{Math.abs(value)}%
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// ECharts 主题工具（从 CSS 变量读取，消除硬编码色值）
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const hex = /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : ''
  return hex || fallback
}

// ─────────────────────────────────────────────────────────────
// 主组件
const RANGE_OPTIONS = [
  { days: 7, label: '近7天' },
  { days: 30, label: '近30天' },
  { days: 90, label: '近90天' },
  { days: 365, label: '全年' },
]

export default function DashboardTab({ orders, products, reviews }: {
  orders: Order[]
  products: Product[]
  reviews: Review[]
}) {
  const [rangeDays, setRangeDays] = useState(7)
  const [aiAdvice, setAiAdvice] = useState<{ content: string; source: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  // ---- 数据聚合（纯函数 + 现状口径） ----
  const rangeData = useMemo(() => buildRangeData(orders, rangeDays), [orders, rangeDays])
  const delta = useMemo(() => buildDelta(orders, rangeDays), [orders, rangeDays])
  const revenueSum = useMemo(() => rangeData.revenues.reduce((s, v) => s + v, 0), [rangeData])
  const orderSum = useMemo(() => rangeData.orderCounts.reduce((s, v) => s + v, 0), [rangeData])
  const avgDaily = revenueSum / rangeDays

  const reviewTrend = useMemo(() => buildReviewTrend(reviews), [reviews])
  const margin = useMemo(() => computeGrossMargin(orders, products), [orders, products])
  const hasReviews = reviewTrend.counts.some((v) => v > 0)

  // 饮品/食品销量占比（沿用现状子分类判定）
  const pieSegments = useMemo(() => {
    let drinkQty = 0
    let foodQty = 0
    orders.filter((o) => o.status !== 'cancelled').forEach((o) => {
      o.items.forEach((i) => {
        if (Array.isArray(i.subcategories)) {
          if (i.subcategories.some((s) => drinkSubs.has(s))) drinkQty += i.quantity
          else foodQty += i.quantity
        } else {
          drinkQty += i.quantity
        }
      })
    })
    return [
      { name: '饮品', value: drinkQty },
      { name: '食品', value: foodQty },
    ].filter((s) => s.value > 0)
  }, [orders])

  // 热销 TOP10（按营收，cancelled 不计）
  const topRevenue = useMemo(() => {
    const rev = new Map<string, number>()
    const qty = new Map<string, number>()
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
  }, [orders])

  // ---- 图表实例（动态引入 echarts，仅管理端 chunk 增重） ----
  const trendRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const pieRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  // 平台边界：echarts 类型来自动态模块，此处放宽为 any（与 cloudbase.ts 边界注释一致的既有约定）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const echartsRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartsRef = useRef<Record<string, any>>({})
  // echarts 就绪标志：动态 import 完成后置 true，驱动 setOption effect 重跑（修复就绪竞态）
  const [chartsReady, setChartsReady] = useState(false)

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
    [],
  )

  useEffect(() => {
    let cancelled = false
    // P0-1 修复：cleanup 提到 effect 顶层（原写法 return 在 async IIFE 内部 = 无效 cleanup，
    // resize 监听永不注销、chart 永不 dispose，切 tab 后持续泄漏）
    const onResize = () => {
      Object.values(chartsRef.current).forEach((c: { resize: () => void }) => c?.resize())
    }
    ;(async () => {
      // 动态 import：代码分割出 echarts chunk，顾客端 bundle 不混入
      const echarts = await import('echarts')
      if (cancelled) return
      echartsRef.current = echarts
      const hosts: Array<[React.RefObject<HTMLDivElement | null>, string]> = [
        [trendRef, 'trend'],
        [reviewRef, 'review'],
        [pieRef, 'pie'],
        [topRef, 'top'],
      ]
      for (const [ref, key] of hosts) {
        if (ref.current) chartsRef.current[key] = echarts.init(ref.current)
      }
      window.addEventListener('resize', onResize)
      // P0-2 修复：就绪后通知 setOption effect 重跑，避免数据先到、echarts 后到时首屏图表空白
      setChartsReady(true)
    })()
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      Object.values(chartsRef.current).forEach((c: { dispose: () => void }) => c?.dispose())
      chartsRef.current = {}
    }
  }, [])

  // 图表 option 更新（数据/区间/主题联动）
  useEffect(() => {
    const echarts = echartsRef.current
    if (!echarts) return
    // 条件渲染容器（评价图/TOP条）晚于 mount 出现时，先补建实例再 setOption
    const ensure = (ref: React.RefObject<HTMLDivElement | null>, key: string) => {
      if (ref.current && !chartsRef.current[key]) chartsRef.current[key] = echarts.init(ref.current)
    }
    ensure(trendRef, 'trend')
    ensure(reviewRef, 'review')
    ensure(pieRef, 'pie')
    ensure(topRef, 'top')
    const b1 = cssVar('--chart-b1', '#facc15')
    const b2 = cssVar('--chart-b2', '#14532d')
    const b3 = cssVar('--chart-b3', '#f97316')
    const grid = cssVar('--chart-grid', '#f3f4f6')
    const text = cssVar('--chart-text', '#9ca3af')
    const noAnim = reducedMotion

    // 近 N 天 营收 ¥ / 订单数 双轴趋势
    const trend = chartsRef.current.trend
    if (trend) {
      trend.setOption({
        animation: !noAnim,
        color: [b1, b2],
        tooltip: { trigger: 'axis' },
        legend: { data: ['营收', '订单'], right: 0, top: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: text, fontSize: 11 } },
        grid: { left: 8, right: 8, top: 30, bottom: rangeDays >= 90 ? 28 : 0, containLabel: true },
        xAxis: { type: 'category', data: rangeData.labels, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: text, fontSize: 10 } },
        yAxis: [
          { type: 'value', name: '¥', nameTextStyle: { color: text, fontSize: 9 }, axisLabel: { color: text, fontSize: 9 }, splitLine: { lineStyle: { color: grid } } },
          { type: 'value', name: '单', nameTextStyle: { color: text, fontSize: 9 }, axisLabel: { color: text, fontSize: 9 }, splitLine: { show: false } },
        ],
        dataZoom: rangeDays >= 90 ? [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', height: 16, bottom: 2 }] : [],
        series: [
          {
            name: '营收', type: 'line', smooth: true, symbol: 'circle', symbolSize: 4, yAxisIndex: 0,
            data: rangeData.revenues, lineStyle: { width: 2.5, color: b1 }, itemStyle: { color: b1 },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: b1 + '3d' },
                  { offset: 1, color: b1 + '0a' },
                ],
              },
            },
          },
          {
            name: '订单', type: 'line', smooth: true, symbol: 'circle', symbolSize: 4, yAxisIndex: 1,
            data: rangeData.orderCounts, lineStyle: { width: 2, color: b2 }, itemStyle: { color: b2 },
          },
        ],
      }, true)
    }

    // 近 14 天评价趋势（单线）
    const review = chartsRef.current.review
    if (review) {
      review.setOption({
        animation: !noAnim,
        tooltip: { trigger: 'axis' },
        grid: { left: 8, right: 8, top: 20, bottom: 4, containLabel: true },
        xAxis: { type: 'category', data: reviewTrend.labels, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: text, fontSize: 10 } },
        yAxis: { type: 'value', minInterval: 1, axisLabel: { color: text, fontSize: 9 }, splitLine: { lineStyle: { color: grid } } },
        series: [
          {
            name: '评价', type: 'line', smooth: true, symbol: 'circle', symbolSize: 4,
            data: reviewTrend.counts, lineStyle: { width: 2.5, color: b2 }, itemStyle: { color: b2 },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: b2 + '30' },
                  { offset: 1, color: b2 + '08' },
                ],
              },
            },
          },
        ],
      }, true)
    }

    // 饮品/食品 环形占比
    const pie = chartsRef.current.pie
    if (pie) {
      pie.setOption({
        animation: !noAnim,
        color: [b1, b2],
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, left: 'center', icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: text, fontSize: 11 } },
        series: [
          {
            type: 'pie', radius: ['55%', '76%'], center: ['50%', '44%'], padAngle: 3,
            itemStyle: { borderRadius: 6 }, label: { show: false },
            data: pieSegments.length ? pieSegments : [],
          },
        ],
        graphic: pieSegments.length ? undefined : [
          {
            type: 'text', left: 'center', top: '40%',
            style: { text: '暂无数据', fill: text, fontSize: 12 },
          },
        ],
      }, true)
    }

    // 热销 TOP10 横向条形（按营收，前 3 名强调色）
    const top = chartsRef.current.top
    if (top) {
      const names = topRevenue.map((t) => t.name).reverse()
      const values = topRevenue.map((t) => Math.round(t.revenue)).reverse()
      top.setOption({
        animation: !noAnim,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: Array<{ name: string; value: number }>) => `${params[0].name}<br/>营收 ¥${params[0].value}` },
        grid: { left: 8, right: 48, top: 8, bottom: 4, containLabel: true },
        xAxis: { type: 'value', axisLabel: { color: text, fontSize: 9 }, splitLine: { lineStyle: { color: grid } } },
        yAxis: { type: 'category', data: names, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: text, fontSize: 10 } },
        series: [
          {
            type: 'bar', barWidth: 10, data: values,
            label: { show: true, position: 'right', color: text, fontSize: 9, formatter: '¥{c}' },
            itemStyle: {
              borderRadius: [0, 5, 5, 0],
              color: (p: { dataIndex: number }) => {
                const rank = topRevenue.length - 1 - p.dataIndex
                return rank < 3 ? b3 : b1
              },
            },
          },
        ],
      }, true)
    }
  }, [rangeData, pieSegments, topRevenue, reviewTrend, rangeDays, reducedMotion, chartsReady])

  // ---- AI 经营建议（/web aiAdvice，复用 adminCall 会话密钥） ----
  const loadAdvice = async () => {
    if (aiLoading) return
    setAiLoading(true)
    setAiStatus('loading')
    try {
      const data = await adminCall('aiAdvice', {})
      if (data.code === 0 && data.data) {
        setAiAdvice({ content: data.data.content, source: data.data.source })
        setAiStatus('loaded')
      } else {
        setAiStatus('error')
      }
    } catch {
      setAiStatus('error')
    } finally {
      setAiLoading(false)
    }
  }
  useEffect(() => { loadAdvice() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const kpiRevenue = useCountUp(Math.round(revenueSum))
  const kpiOrders = useCountUp(orderSum)
  const kpiAvg = useCountUp(Math.round(avgDaily))

  const dateStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      {/* 无障碍摘要（仅读屏可见，参照 iCAN sr-only） */}
      <p className="sr-only">
        近 {rangeDays} 天：营收 {Math.round(revenueSum).toLocaleString()} 元，共 {orderSum} 单，日均营收 {Math.round(avgDaily).toLocaleString()} 元。
      </p>

      {/* 时间范围切换 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="seg-bar" role="tablist" aria-label="统计时间范围">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              role="tab"
              aria-selected={rangeDays === opt.days}
              onClick={() => setRangeDays(opt.days)}
              className={`seg ${rangeDays === opt.days ? 'active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 数据卡片（count-up + 环比徽章，首卡 accent） */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`p-4 rounded-2xl border border-gray-100/80 text-center ${rangeDays === 7 ? 'card-accent animate-fade-in-up stagger-1' : 'bg-white shadow-card animate-fade-in-up stagger-1'}`}>
          <p className="text-xl font-bold text-brand-700">¥{kpiRevenue.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 mt-1">近{rangeDays}天营收</p>
          <div className="mt-1 flex justify-center">
            <DeltaBadge value={delta.revenueDelta} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-gray-100/80 shadow-card text-center animate-fade-in-up stagger-2">
          <p className="text-xl font-bold text-gray-900">{kpiOrders.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 mt-1">近{rangeDays}天订单</p>
          <div className="mt-1 flex justify-center">
            <DeltaBadge value={delta.ordersDelta} />
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-gray-100/80 shadow-card text-center animate-fade-in-up stagger-3">
          <p className="text-xl font-bold text-gray-900">¥{kpiAvg.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 mt-1">日均营收</p>
          <p className="text-[10px] text-gray-400 mt-1">累计 {orders.length} 单</p>
        </div>
      </div>

      {/* 趋势图（近 N 天 营收/订单 双轴） */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="section-title">近 {rangeDays} 天营收 / 订单趋势</h3>
          <button
            onClick={() => downloadCsv(buildCsv(rangeData), dateStr)}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            导出 CSV
          </button>
        </div>
        <div ref={trendRef} className="h-56 w-full" aria-label={`近${rangeDays}天营收与订单趋势图`} />
      </div>

      {/* 近 14 天评价趋势 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-4">
        <h3 className="section-title mb-3">近 14 天评价趋势</h3>
        {hasReviews ? (
          <div ref={reviewRef} className="h-44 w-full" aria-label="近14天评价趋势图" />
        ) : (
          <div className="text-center py-6">
            <IconChart className="w-8 h-8 mx-auto text-gray-300" />
            <p className="text-gray-300 text-sm mt-3">暂无数据</p>
          </div>
        )}
      </div>

      {/* 毛利率：饮品/食品 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-5">
        <h3 className="section-title mb-4">饮品/食品毛利率</h3>
        {margin.withCostItems === 0 ? (
          <div className="text-center py-6">
            <IconBox className="w-8 h-8 mx-auto text-gray-300" />
            <p className="text-gray-300 text-sm mt-3">待录入</p>
            <p className="text-[10px] text-gray-300 mt-1">在商品内联编辑中录入成本价后自动计算</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {([
              ['饮品', margin.drink],
              ['食品', margin.food],
            ] as Array<[string, MarginSummary | null]>).map(([label, m]) => (
              <div key={label} className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-400">{label}</p>
                {m ? (
                  <>
                    <p className="text-lg font-bold text-gray-900">{m.marginPct}%</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">毛利 ¥{(m.revenue - m.cost).toFixed(0)}</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-300 py-2">暂无销售</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分类销量占比（环形） */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-6">
        <h3 className="section-title mb-2">分类销量占比</h3>
        <div ref={pieRef} className="h-56 w-full" aria-label="饮品与食品销量占比图" />
      </div>

      {/* 销量排行 TOP10（按营收） */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-7">
        <h3 className="section-title mb-2">商品营收 TOP10</h3>
        {topRevenue.length === 0 ? (
          <div className="text-center py-6">
            <IconBox className="w-8 h-8 mx-auto text-gray-300" />
            <p className="text-gray-300 text-sm mt-3">暂无数据</p>
          </div>
        ) : (
          <div ref={topRef} className="h-64 w-full" aria-label="热销商品营收排行图" />
        )}
      </div>

      {/* AI 经营建议 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="section-title flex items-center gap-2">AI 经营建议</h3>
          {aiStatus === 'loaded' && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              aiAdvice?.source === 'dify' ? 'bg-green-50 text-green-600' :
              aiAdvice?.source === 'rule' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-500'
            }`}>
              {aiAdvice?.source === 'dify' ? 'AI 已接入' : aiAdvice?.source === 'rule' ? '规则版' : 'AI 服务暂不可用'}
            </span>
          )}
        </div>
        {aiStatus === 'loading' && (
          <div className="space-y-2">
            <div className="skeleton-shimmer h-4 w-4/5" />
            <div className="skeleton-shimmer h-4 w-3/5" />
            <div className="skeleton-shimmer h-4 w-2/5" />
          </div>
        )}
        {aiStatus === 'loaded' && aiAdvice && (
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{aiAdvice.content}</p>
        )}
        {aiStatus === 'error' && (
          <div className="text-sm text-gray-400">
            <p>AI 服务暂不可用，请稍后重试。</p>
          </div>
        )}
        {aiStatus === 'loaded' && (
          <button
            onClick={loadAdvice}
            disabled={aiLoading}
            className="mt-3 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            刷新
          </button>
        )}
      </div>
    </div>
  )
}