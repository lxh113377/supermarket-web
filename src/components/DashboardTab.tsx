import React, { useCallback, useEffect, useRef, useState } from 'react'
import { adminCall } from '../auth'
import { useDashboardCharts } from '../hooks/useDashboardCharts'
import KpiCard from './KpiCard'
import { IconChart, IconBox } from './Icons'
import { csvEscape } from '../utils/csv'

// ⚠ react(only-export-components) 警告为既有模式：buildCsv 纯函数导出供 vitest 直测
// H1-2（2026-09-05）：数据聚合已下沉 functions/lib/actions/stats.js（getDashboardStats），
// 本组件只负责任务：调聚合接口 + 渲染图表/AI 建议。buildRangeData/buildDelta/buildReviewTrend/
// computeGrossMargin/pieSegments/topRevenue 等纯函数已迁移服务端，单测迁至 tests/stats.test.js。
// ─────────────────────────────────────────────────────────────
// 纯函数（供单测）：CSV 生成（逗号/引号/换行转义 + Excel UTF-8 BOM）
// 转义逻辑复用 src/utils/csv.ts（OrdersTab 同源），此处仅组装行结构
export interface RangeData {
  labels: string[]
  orderCounts: number[]
  revenues: number[]
}

export function buildCsv(rangeData: RangeData): string {
  const rows = ['日期,订单数,营收(¥)']
  rangeData.labels.forEach((label, i) => {
    rows.push(`${csvEscape(label)},${csvEscape(rangeData.orderCounts[i])},${csvEscape(rangeData.revenues[i])}`)
  })
  return '\uFEFF' + rows.join('\r\n')
}

// 看板聚合结果（与服务端 stats.js getDashboardStats 返回对齐）
interface MarginSummary {
  revenue: number
  cost: number
  marginPct: number
}
interface DashboardStats {
  rangeDays: number
  rangeData: RangeData
  delta: { ordersDelta: number | null; revenueDelta: number | null }
  reviewTrend: { counts: number[]; labels: string[] }
  margin: { drink: MarginSummary | null; food: MarginSummary | null; withCostItems: number; totalItems: number }
  pieSegments: Array<{ name: string; value: number }>
  topRevenue: Array<{ name: string; revenue: number; qty: number }>
  totalOrders: number
  orderSum: number
  revenueSum: number
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
// 主组件
const RANGE_OPTIONS = [
  { days: 7, label: '近7天' },
  { days: 30, label: '近30天' },
  { days: 90, label: '近90天' },
  { days: 365, label: '全年' },
]

// props 改为无数据依赖（聚合已服务端化），仅保留初始 rangeDays 供恢复
export default function DashboardTab({ initialRangeDays = 7 }: { initialRangeDays?: number } = {}) {
  const [rangeDays, setRangeDays] = useState(initialRangeDays)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [statsError, setStatsError] = useState('')
  const [aiAdvice, setAiAdvice] = useState<{ content: string; source: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  // 拉取聚合（rangeDays 变化重取）
  useEffect(() => {
    let cancelled = false
    setStatsError('')
    adminCall<DashboardStats>('getDashboardStats', { rangeDays })
      .then((r) => {
        if (cancelled) return
        if (r.code === 0 && r.data) setStats(r.data)
        else setStatsError(r.message || '看板数据加载失败')
      })
      .catch(() => { if (!cancelled) setStatsError('看板数据加载失败') })
    return () => { cancelled = true }
  }, [rangeDays])

  const rangeData = stats?.rangeData ?? { labels: [], orderCounts: [], revenues: [] }
  const delta = stats?.delta ?? { ordersDelta: null, revenueDelta: null }
  const revenueSum = stats?.revenueSum ?? 0
  const orderSum = stats?.orderSum ?? 0
  const reviewTrend = stats?.reviewTrend ?? { counts: [], labels: [] }
  const margin = stats?.margin ?? { drink: null, food: null, withCostItems: 0, totalItems: 0 }
  const pieSegments = stats?.pieSegments ?? []
  const topRevenue = stats?.topRevenue ?? []
  const totalOrders = stats?.totalOrders ?? 0
  const avgDaily = rangeDays > 0 ? revenueSum / rangeDays : 0
  const hasReviews = reviewTrend.counts.some((v) => v > 0)

  // ---- 图表实例与 option 更新（抽到 useDashboardCharts：动态 import/resize/dispose/主题） ----
  const { trendRef, reviewRef, pieRef, topRef } = useDashboardCharts({ rangeData, pieSegments, topRevenue, reviewTrend, rangeDays })

  // ---- AI 经营建议（/web aiAdvice，复用 adminCall 会话密钥） ----
  const loadAdvice = useCallback(async () => {
    if (aiLoading) return
    setAiLoading(true)
    setAiStatus('loading')
    try {
      const data = await adminCall<{ content: string; source: string }>('aiAdvice', {})
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
  }, [aiLoading])
  // 只在 mount 触发一次：用 ref 持有最新 loadAdvice（避免 deps=[loadAdvice] 时 aiLoading 变化导致无限重跑循环）
  const loadAdviceRef = useRef(loadAdvice)
  // 渲染提交后同步最新回调（react/refs 要求不在渲染期写 ref；mount effect 调用时序不变）
  useEffect(() => { loadAdviceRef.current = loadAdvice })
  useEffect(() => { loadAdviceRef.current() }, [])

  const kpiRevenue = Math.round(revenueSum)
  const kpiOrders = orderSum
  const kpiAvg = Math.round(avgDaily)

  const dateStr = new Date().toISOString().slice(0, 10)

  if (statsError) {
    return (
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card">
        <p className="text-sm text-red-500">⚠️ {statsError}</p>
      </div>
    )
  }

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

      {/* 数据卡片（count-up + 环比徽章；count-up 动画隔离在 KpiCard 子树，避免每帧触发整页重渲染） */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label={`近${rangeDays}天营收`}
          value={kpiRevenue}
          prefix="¥"
          accent={rangeDays === 7}
          delta={delta}
          deltaMetric="revenue"
          staggerCls="stagger-1"
        />
        <KpiCard
          label={`近${rangeDays}天订单`}
          value={kpiOrders}
          delta={delta}
          deltaMetric="orders"
          staggerCls="stagger-2"
        />
        <KpiCard
          label="日均营收"
          value={kpiAvg}
          prefix="¥"
          sub={`累计 ${totalOrders} 单`}
          staggerCls="stagger-3"
        />
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
        <div className="relative h-56 w-full">
          <div ref={pieRef} className="h-56 w-full" aria-label="饮品与食品销量占比图" />
          {!pieSegments.length && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm" aria-hidden="true">
              暂无数据
            </div>
          )}
        </div>
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