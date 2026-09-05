// ECharts 看板图表生命周期封装（从 DashboardTab 拆出）
// 职责：动态 import echarts（仅管理端 chunk 增重）+ 实例初始化 + resize/dispose + option 更新
// 纯函数聚合（buildRangeData 等）仍在 DashboardTab 供 vitest 直测，此处只管图表副作用。
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

export interface ChartData {
  rangeData: { labels: string[]; orderCounts: number[]; revenues: number[] }
  pieSegments: Array<{ name: string; value: number }>
  topRevenue: Array<{ name: string; revenue: number; qty: number }>
  reviewTrend: { counts: number[]; labels: string[] }
  rangeDays: number
}

// ECharts 主题工具（从 CSS 变量读取，消除硬编码色值）
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const hex = /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : ''
  return hex || fallback
}

export function useDashboardCharts(d: ChartData) {
  const trendRef = useRef<HTMLDivElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const pieRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  // 平台边界：echarts 类型来自动态模块，此处放宽为 any（与既有约定一致）
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

  // 图表实例生命周期（mount 一次）
  useEffect(() => {
    let cancelled = false
    // P0-1 修复：cleanup 提到 effect 顶层（原写法 return 在 async IIFE 内部 = 无效 cleanup，
    // resize 监听永不注销、chart 永不 dispose，切 tab 后持续泄漏）
    const onResize = () => {
      Object.values(chartsRef.current).forEach((c) => c.resize())
    }
    ;(async () => {
      // 动态 import：代码分割出 echarts chunk，顾客端 bundle 不混入。
      // 注意：必须走 lib 深路径而非 echarts/charts|components barrel——echarts package.json
      // 把 lib/chart/*、lib/component/* 全部声明为 sideEffects，barrel 一旦引入即整包保留
      // （实测全量 gzip ~340KB、barrel 按需 ~327KB，深路径仅 ~1/3）。
      const [core, line, pie, bar, grid, tooltip, legend, dz, dzi, dzs, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/lib/chart/line'),
        import('echarts/lib/chart/pie'),
        import('echarts/lib/chart/bar'),
        import('echarts/lib/component/grid'),
        import('echarts/lib/component/tooltip'),
        import('echarts/lib/component/legend'),
        import('echarts/lib/component/dataZoom'),
        import('echarts/lib/component/dataZoomInside'),
        import('echarts/lib/component/dataZoomSlider'),
        import('echarts/renderers'),
      ])
      if (cancelled) return
      const installs = [
        line.default, pie.default, bar.default,
        grid.default, tooltip.default, legend.default,
        dz.default, dzi.default, dzs.default,
        renderers.CanvasRenderer,
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      core.use(installs as any)
      const echarts = core
      echartsRef.current = echarts
      const hosts: Array<[RefObject<HTMLDivElement | null>, string]> = [
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
  const { rangeData, pieSegments, topRevenue, reviewTrend, rangeDays } = d
  useEffect(() => {
    const echarts = echartsRef.current
    if (!echarts) return
    // 条件渲染容器（评价图/TOP条）晚于 mount 出现时，先补建实例再 setOption
    const ensure = (ref: RefObject<HTMLDivElement | null>, key: string) => {
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
        // 空态提示由 DashboardTab 的 HTML overlay 负责（不再注册 GraphicComponent，省 ~87KB gz）
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeData, pieSegments, topRevenue, reviewTrend, rangeDays, reducedMotion, chartsReady])

  return { trendRef, reviewRef, pieRef, topRef }
}
