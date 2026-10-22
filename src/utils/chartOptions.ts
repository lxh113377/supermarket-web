// 看板图表 option 构造（纯函数：主题与动效作为入参，不依赖 echarts / canvas / DOM）
// 从 useDashboardCharts 抽出：hook 只承担实例生命周期（动态 import、init/resize/dispose），
// option 形态是可直测的纯数据映射——原写法只有真挂 echarts 才走到，等于 4 张图的配置零测试。
export interface ChartData {
  rangeData: { labels: string[]; orderCounts: number[]; revenues: number[] }
  pieSegments: Array<{ name: string; value: number }>
  topRevenue: Array<{ name: string; revenue: number; qty: number }>
  reviewTrend: { counts: number[]; labels: string[] }
  rangeDays: number
}

// XSS 收口（2026-09-24 对标第二轮 A3；GHSA-fgmj-fm8m-jvvx 影响 echarts <6.1.0）：
// tooltip 默认 renderMode:'html' 会把 formatter 返回值当 HTML 注入，而图表 name 取自入库文本
// （商品名/分类名）。plainText 走 textContent，从根上消除该汇点——比"升到 6.1 但继续拼 HTML"更彻底。
export const TOOLTIP_BASE = { renderMode: 'plainText' } as const

export interface ChartTheme {
  /** 主数据墨色（营收线、TOP 榜非前 3 名、饼图第一分类） */
  b1: string
  /** 次数据墨色（订单线、评价线、饼图第二分类） */
  b2: string
  /** 强调墨色（TOP 榜前 3 名） */
  b3: string
  /** 第三分类专用：与 b1/b2 的亮度差都 ≥0.07，保证色盲下三个扇区仍可分 */
  b4: string
  grid: string
  text: string
}

// 与 index.css 的 --chart-* 变量同值：读不到（SSR / 变量未注入）时退到这套兜底色
export const CHART_THEME_FALLBACK: ChartTheme = {
  b1: '#b45309',
  b2: '#14532d',
  b3: '#7c2d12',
  b4: '#0d9488',
  grid: '#f3f4f6',
  text: '#57534e',
}

// 只认十六进制：Tailwind 变量写成 rgb()/oklch() 时宁可用兜底色，也不把非法色值塞进 echarts
// （否则 echarts 内部按 '#xxx' 解析颜色会直接抛错，整块看板白屏）
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const hex = /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : ''
  return hex || fallback
}

/** 一次性读取主题色（CSS 变量全站静态，无主题切换器；调用方 memo 住，避免每次 setOption 重算样式） */
export function readChartTheme(): ChartTheme {
  return {
    b1: cssVar('--chart-b1', CHART_THEME_FALLBACK.b1),
    b2: cssVar('--chart-b2', CHART_THEME_FALLBACK.b2),
    b3: cssVar('--chart-b3', CHART_THEME_FALLBACK.b3),
    b4: cssVar('--chart-b4', CHART_THEME_FALLBACK.b4),
    grid: cssVar('--chart-grid', CHART_THEME_FALLBACK.grid),
    text: cssVar('--chart-text', CHART_THEME_FALLBACK.text),
  }
}

export interface ChartRenderOpts {
  /** prefers-reduced-motion 命中时关动画（无障碍 + 低端机） */
  reducedMotion?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartOption = Record<string, any>

/** 近 N 天 营收 ¥ / 订单数 双轴趋势；rangeDays>=90 时附 dataZoom 并腾出滑条高度 */
export function buildTrendOption(rangeData: ChartData['rangeData'], theme: ChartTheme, opts: ChartRenderOpts & { rangeDays: number }): ChartOption {
  const { b1, b2, grid, text } = theme
  return {
    animation: !opts.reducedMotion,
    color: [b1, b2],
    tooltip: { trigger: 'axis', ...TOOLTIP_BASE },
    legend: { data: ['营收', '订单'], right: 0, top: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: text, fontSize: 11 } },
    grid: { left: 8, right: 8, top: 30, bottom: opts.rangeDays >= 90 ? 28 : 0, containLabel: true },
    xAxis: { type: 'category', data: rangeData.labels, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: text, fontSize: 10 } },
    yAxis: [
      { type: 'value', name: '¥', nameTextStyle: { color: text, fontSize: 9 }, axisLabel: { color: text, fontSize: 9 }, splitLine: { lineStyle: { color: grid } } },
      { type: 'value', name: '单', nameTextStyle: { color: text, fontSize: 9 }, axisLabel: { color: text, fontSize: 9 }, splitLine: { show: false } },
    ],
    dataZoom: opts.rangeDays >= 90 ? [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', height: 16, bottom: 2 }] : [],
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
  }
}

/** 近 14 天评价趋势（单线 + 面积渐变） */
export function buildReviewOption(reviewTrend: ChartData['reviewTrend'], theme: ChartTheme, opts: ChartRenderOpts): ChartOption {
  const { b2, grid, text } = theme
  return {
    animation: !opts.reducedMotion,
    tooltip: { trigger: 'axis', ...TOOLTIP_BASE },
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
  }
}

/** 饮品/食品 环形占比。空态提示由 DashboardTab 的 HTML overlay 负责（不注册 GraphicComponent，省 ~87KB gz） */
export function buildPieOption(pieSegments: ChartData['pieSegments'], theme: ChartTheme, opts: ChartRenderOpts): ChartOption {
  // 分类数 = 3（饮品/食品/日用），所以色板必须给到三个**互相可分**的墨色。
  // 旧写法是 color: [b1, b2] —— 只有两色，第三个扇区回绕到 b1，
  // 于是"日用"与"饮品"画成同一个颜色：图例写着三个名字，图上只有两种颜色。
  const { b1, b2, b4, text } = theme
  return {
    animation: !opts.reducedMotion,
    color: [b1, b2, b4],
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)', ...TOOLTIP_BASE },
    legend: { bottom: 0, left: 'center', icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: text, fontSize: 11 } },
    series: [
      {
        type: 'pie', radius: ['55%', '76%'], center: ['50%', '44%'], padAngle: 3,
        itemStyle: { borderRadius: 6 }, label: { show: false },
        data: pieSegments.length ? pieSegments : [],
      },
    ],
  }
}

/** 热销 TOP10 横向条形（按营收，倒序使第一名在顶部；前 3 名强调色） */
export function buildTopOption(topRevenue: ChartData['topRevenue'], theme: ChartTheme, opts: ChartRenderOpts): ChartOption {
  const { b1, b3, grid, text } = theme
  const names = topRevenue.map((t) => t.name).reverse()
  const values = topRevenue.map((t) => Math.round(t.revenue)).reverse()
  return {
    animation: !opts.reducedMotion,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP_BASE, formatter: (params: Array<{ name: string; value: number }>) => `${params[0].name}\n营收 ¥${params[0].value}` },
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
  }
}
