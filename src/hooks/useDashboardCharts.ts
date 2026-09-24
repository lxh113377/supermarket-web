// ECharts 看板图表生命周期封装（从 DashboardTab 拆出）
// 职责：动态 import echarts（仅管理端 chunk 增重）+ 实例初始化 + resize/dispose + setOption 触发
// option 形态本身在 src/utils/chartOptions.ts（纯函数，可直测）；聚合纯函数（buildRangeData 等）
// 已下沉服务端 functions/lib/actions/stats.js。此处只管"实例什么时候建、什么时候重绘"这类副作用。
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  buildPieOption,
  buildReviewOption,
  buildTopOption,
  buildTrendOption,
  readChartTheme,
  type ChartData,
} from '../utils/chartOptions'

export type { ChartData }

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

  // 主题色一次读取：CSS 变量全站静态（index.css，无主题切换器，实测与 fallback 同值）；
  // 原先每次 option 更新做 5 次 getComputedStyle（每次强制样式重算），数据/区间一切换就触发
  const theme = useMemo(readChartTheme, [])

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
      //
      // ⚠️ 六轮实测（生产包 dist/assets/line-*.js 的 module namespace `keys=[] / hasDefault=false`）：
      // `echarts/lib/chart/*`、`echarts/lib/component/*` 是**纯 side-effect 自注册模块**
      // （line.js 末尾自己 `use(install)`，全文件零 export）。把它们当 `core.use([...])` 入参等价于
      // `use(undefined)` → echarts/extension.js 走到 `ext.install(...)` 抛 TypeError；
      // 又因为在 async IIFE 内，整个 init 链静默中断，**症状是看板四张图永久空白且页面不报错**。
      // 只有 renderers 例外：`echarts/renderers` 只导出不自注册，必须显式 use()。
      await Promise.all([
        import('echarts/lib/chart/line'),
        import('echarts/lib/chart/pie'),
        import('echarts/lib/chart/bar'),
        import('echarts/lib/component/grid'),
        import('echarts/lib/component/tooltip'),
        import('echarts/lib/component/legend'),
        import('echarts/lib/component/dataZoom'),
        import('echarts/lib/component/dataZoomInside'),
        import('echarts/lib/component/dataZoomSlider'),
      ])
      const [core, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/renderers'),
      ])
      if (cancelled) return
      core.use([renderers.CanvasRenderer])
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

    // 近 N 天 营收 ¥ / 订单数 双轴趋势
    chartsRef.current.trend?.setOption(buildTrendOption(rangeData, theme, { rangeDays, reducedMotion }), true)
    // 近 14 天评价趋势（单线）
    chartsRef.current.review?.setOption(buildReviewOption(reviewTrend, theme, { reducedMotion }), true)
    // 饮品/食品 环形占比
    chartsRef.current.pie?.setOption(buildPieOption(pieSegments, theme, { reducedMotion }), true)
    // 热销 TOP10 横向条形（按营收，前 3 名强调色）
    chartsRef.current.top?.setOption(buildTopOption(topRevenue, theme, { reducedMotion }), true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeData, pieSegments, topRevenue, reviewTrend, rangeDays, reducedMotion, chartsReady])

  return { trendRef, reviewRef, pieRef, topRef }
}
