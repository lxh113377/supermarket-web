import {  useCallback, useEffect, useMemo, useRef, useState  } from 'react'
import { adminCall } from '../auth'
import { IS_CLOUD } from '../cloudbase'
import { useDashboardCharts } from '../hooks/useDashboardCharts'
import KpiCard from './KpiCard'
import { IconChart, IconBox } from './Icons'
import { csvEscape } from '../utils/csv'
import { formatCount } from '../utils/format'
import { handleTablistKeyDown } from '../utils/rovingTabs'

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
  margin: { drink: MarginSummary | null; food: MarginSummary | null; daily: MarginSummary | null; withCostItems: number; totalItems: number }
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

// AI 经营建议会话级缓存：aiAdvice 是 30s 级的 Dify 后端调用，看板在 tab 间来回切换
// 时每次 mount 都重打一次（等待 + 计费）。缓存后 mount 直接复用，「刷新」按钮强制绕过。
let adviceCache: { content: string; source: string } | null = null

/** 仅测试用：单测间复位缓存，避免上一个用例的结果泄漏到下一个（三态测试会互相污染） */
export function resetAdviceCacheForTest(): void {
  adviceCache = null
}

// props 改为无数据依赖（聚合已服务端化），仅保留初始 rangeDays 供恢复
export default function DashboardTab({ initialRangeDays = 7 }: { initialRangeDays?: number } = {}) {
  const [rangeDays, setRangeDays] = useState(initialRangeDays)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [statsError, setStatsError] = useState('')
  // 手动重试计数（错误态的出路）：自增即触发上面的 effect 重发
  const [reloadTick, setReloadTick] = useState(0)
  const [aiAdvice, setAiAdvice] = useState<{ content: string; source: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  // 拉取聚合（rangeDays 变化重取；reloadTick 供「重试」按钮手动重发）
  // ⚠️ 本地演示模式**不发这个请求**：看板聚合在 H1-2 下沉到服务端 functions/lib/stats.js，
  //   demo 构建没有后端，adminCall 会因 resolveBaseUrl 返回空而当场抛「未配置接口地址」。
  //   发一个必然失败的请求有两个害处：① 白白占一次网络与一次 console 报错（本仓 visual
  //   判据的 watchErrors 会盯页面错误）；② 更要紧的是它把「这个视图在 demo 模式下不存在」
  //   渲染成「数据加载失败」—— 前者是设计边界、后者是故障，让运营去猜是哪一种就是界面失职。
  useEffect(() => {
    if (!IS_CLOUD) { setStats(null); setStatsError(''); return }
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
  }, [rangeDays, reloadTick])

  // 派生值全部 memo 化。关键收益不在计算本身（都很轻），而在于**引用稳定性**：
  // useDashboardCharts 的 setOption effect 依赖 rangeData / pieSegments / topRevenue / reviewTrend，
  // 而 `?? { labels: [], ... }` 这种兜底字面量每次渲染都是新对象 —— 首屏数据未到位期间
  // 会让该 effect 在每次渲染都重跑一遍全量 setOption（重绘 4 张图）。
  const {
    rangeData, delta, revenueSum, orderSum, reviewTrend, margin,
    pieSegments, topRevenue, totalOrders, avgDaily, hasReviews,
  } = useMemo(() => {
    const rangeData = stats?.rangeData ?? { labels: [], orderCounts: [], revenues: [] }
    const reviewTrend = stats?.reviewTrend ?? { counts: [], labels: [] }
    const revenueSum = stats?.revenueSum ?? 0
    return {
      rangeData,
      delta: stats?.delta ?? { ordersDelta: null, revenueDelta: null },
      revenueSum,
      orderSum: stats?.orderSum ?? 0,
      reviewTrend,
      margin: stats?.margin ?? { drink: null, food: null, daily: null, withCostItems: 0, totalItems: 0 },
      pieSegments: stats?.pieSegments ?? [],
      topRevenue: stats?.topRevenue ?? [],
      totalOrders: stats?.totalOrders ?? 0,
      avgDaily: rangeDays > 0 ? revenueSum / rangeDays : 0,
      hasReviews: reviewTrend.counts.some((v) => v > 0),
    }
  }, [stats, rangeDays])

  // ---- 图表实例与 option 更新（抽到 useDashboardCharts：动态 import/resize/dispose/主题） ----
  const { trendRef, reviewRef, pieRef, topRef } = useDashboardCharts({ rangeData, pieSegments, topRevenue, reviewTrend, rangeDays })

  // ---- AI 经营建议（/web aiAdvice，复用 adminCall 会话密钥） ----
  // force=false 时命中会话缓存直接返回（mount 复用路径）；「刷新」按钮传 true 绕过缓存
  const loadAdvice = useCallback(async (force = false) => {
    if (aiLoading) return
    // 同上：AI 建议走 /web aiAdvice，demo 模式下不发必然失败的请求（见拉取聚合处的说明）
    if (!IS_CLOUD) { setAiStatus('idle'); return }
    if (!force && adviceCache) {
      setAiAdvice({ ...adviceCache })
      setAiStatus('loaded')
      return
    }
    setAiLoading(true)
    setAiStatus('loading')
    try {
      const data = await adminCall<{ content: string; source: string }>('aiAdvice', {})
      if (data.code === 0 && data.data) {
        adviceCache = { content: data.data.content, source: data.data.source }
        setAiAdvice({ ...adviceCache })
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

  // 本地演示模式：看板聚合依赖服务端（H1-2 下沉），这里显示**设计边界**而不是"加载失败"。
  // 文案口径复用 AdminPage 的 demo 横幅（amber 系 + 同一句话的措辞），不再新造一套色。
  if (!IS_CLOUD) {
    return (
      <div className="bg-amber-50/80 p-5 rounded-2xl border border-amber-200/60">
        <p className="text-sm leading-relaxed text-amber-800">
          看板需要连接服务端聚合数据，<strong>本地演示模式</strong>下不可用（演示数据仅保存在浏览器中）。
        </p>
        {/* 不用 /80 之类的透明度做"次要感"：text-amber-800/80 合成后实测 4.40:1，
            差 0.10 不过正文 4.5 —— 正是 contrast 判据注释里那句"只差一点点最容易漏"。
            次要层级交给字号（text-xs vs 上面 text-sm）与间距，颜色保持实色 amber-800（6.84:1）。 */}
        <p className="mt-2 text-xs leading-relaxed text-amber-800">
          云端模式下此处展示近 {rangeDays} 天的营收趋势、毛利分析与 AI 经营建议。
        </p>
      </div>
    )
  }

  if (statsError) {
    return (
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card">
        <p className="text-sm leading-relaxed text-red-700">⚠️ {statsError}</p>
        {/* 出路：原语只有"⚠️ 加载失败"一行字，运营除了刷新整页没有别的可做。
            重试只重发本视图的请求（reloadTick 自增触发 effect），比刷整页更轻、
            也不会丢掉其它 tab 的在编辑状态。 */}
        <button
          onClick={() => setReloadTick((n) => n + 1)}
          className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition hover:border-brand-400 hover:text-brand-700 active:scale-[0.98]"
        >
          重试
        </button>
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
        <div
          className="seg-bar"
          role="tablist"
          aria-label="统计时间范围"
          onKeyDown={(e) =>
            handleTablistKeyDown(
              e,
              RANGE_OPTIONS.map((o) => String(o.days)),
              String(rangeDays),
              (v) => setRangeDays(Number(v)),
            )
          }
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              id={`tab-${opt.days}`}
              role="tab"
              aria-selected={rangeDays === opt.days}
              tabIndex={rangeDays === opt.days ? 0 : -1}
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
          <h2 className="section-title">近 {rangeDays} 天营收 / 订单趋势</h2>
          <button
            onClick={() => downloadCsv(buildCsv(rangeData), dateStr)}
            className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100 active:scale-[0.98]"
          >
            导出 CSV
          </button>
        </div>
        <div ref={trendRef} className="h-56 w-full" aria-label={`近${rangeDays}天营收与订单趋势图`} />
      </div>

      {/* 近 14 天评价趋势 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-4">
        <h2 className="section-title mb-3">近 14 天评价趋势</h2>
        {hasReviews ? (
          <div ref={reviewRef} className="h-44 w-full" aria-label="近14天评价趋势图" />
        ) : (
          <div className="text-center py-6">
            <IconChart className="w-8 h-8 mx-auto text-stone-400" />
            <p className="text-stone-500 text-sm mt-3">暂无数据</p>
          </div>
        )}
      </div>

      {/* 毛利率：饮品/食品/日用 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-5">
        <h2 className="section-title mb-4">饮品/食品/日用毛利率</h2>
        {margin.withCostItems === 0 ? (
          <div className="text-center py-6">
            <IconBox className="w-8 h-8 mx-auto text-stone-400" />
            <p className="text-stone-500 text-sm mt-3">待录入</p>
            <p className="text-3xs text-stone-500 mt-1">在商品内联编辑中录入成本价后自动计算</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {([
              ['饮品', margin.drink],
              ['食品', margin.food],
              ['日用', margin.daily],
            ] as Array<[string, MarginSummary | null]>).map(([label, m]) => (
              <div key={label} className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-3xs text-stone-500">{label}</p>
                {m ? (
                  <>
                    <p className="text-lg font-bold text-ink">{m.marginPct}%</p>
                    <p className="text-3xs text-stone-500 mt-0.5">毛利 ¥{formatCount(m.revenue - m.cost)}</p>
                  </>
                ) : (
                  <p className="text-sm text-stone-500 py-2">暂无销售</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分类销量占比（环形） */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-6">
        <h2 className="section-title mb-2">分类销量占比</h2>
        <div className="relative h-56 w-full">
          <div ref={pieRef} className="h-56 w-full" aria-label="饮品、食品与日用销量占比图" />
          {!pieSegments.length && (
            <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-sm" aria-hidden="true">
              暂无数据
            </div>
          )}
        </div>
      </div>

      {/* 销量排行 TOP10（按营收） */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-7">
        <h2 className="section-title mb-2">商品营收 TOP10</h2>
        {topRevenue.length === 0 ? (
          <div className="text-center py-6">
            <IconBox className="w-8 h-8 mx-auto text-stone-400" />
            <p className="text-stone-500 text-sm mt-3">暂无数据</p>
          </div>
        ) : (
          <div ref={topRef} className="h-64 w-full" aria-label="热销商品营收排行图" />
        )}
      </div>

      {/* AI 经营建议 */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100/80 shadow-card animate-fade-in-up stagger-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title flex items-center gap-2">AI 经营建议</h2>
          {aiStatus === 'loaded' && (
            <span className={`text-3xs px-2 py-0.5 rounded-full font-medium ${
              aiAdvice?.source === 'dify' ? 'bg-green-50 text-green-700' :
              aiAdvice?.source === 'rule' ? 'bg-gray-100 text-stone-600' : 'bg-red-50 text-red-700'
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
          <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-line">{aiAdvice.content}</p>
        )}
        {aiStatus === 'error' && (
          <div className="text-sm text-stone-500">
            <p>AI 服务暂不可用，请稍后重试。</p>
          </div>
        )}
        {aiStatus === 'loaded' && (
          <button
            onClick={() => loadAdvice(true)}
            disabled={aiLoading}
            className="mt-3 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100 active:scale-[0.98] disabled:opacity-50"
          >
            刷新
          </button>
        )}
      </div>
    </div>
  )
}
