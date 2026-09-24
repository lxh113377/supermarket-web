// 看板图表 option 纯函数单测（六轮 F1：option 构造从 useDashboardCharts 抽出后可直测）
// 关注点不是"像不像 echarts"，而是三条真实约束：
// ① 所有 tooltip 运行时带 renderMode:'plainText'（XSS 汇点，静态 grep 只防漏写、防不了写错值）
// ② rangeDays>=90 才挂 dataZoom（区间联动）
// ③ TOP 条形倒序 + 前 3 名强调色（展示口径，改错不报错、只会静默画反）
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildPieOption,
  buildReviewOption,
  buildTopOption,
  buildTrendOption,
  readChartTheme,
  CHART_THEME_FALLBACK,
  TOOLTIP_BASE,
  type ChartTheme,
} from '../src/utils/chartOptions'

const theme: ChartTheme = { b1: '#aaa111', b2: '#bbb222', b3: '#ccc333', grid: '#ddd444', text: '#eee555' }
const rangeData = { labels: ['9/1', '9/2', '9/3'], orderCounts: [3, 1, 2], revenues: [30.4, 10.2, 20] }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readChartTheme', () => {
  it('jsdom 下 CSS 变量读不到 → 全部退到兜底色（与 index.css 同值）', () => {
    expect(readChartTheme()).toEqual(CHART_THEME_FALLBACK)
  })

  it('只认十六进制：非 hex 的变量值（rgb/oklch）按兜底处理', () => {
    const props: Record<string, string> = { '--chart-b1': '#123456', '--chart-b2': 'rgb(1, 2, 3)', '--chart-grid': '  #abc  ' }
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (k: string) => props[k] ?? '' }))
    const t = readChartTheme()
    expect(t.b1).toBe('#123456')
    expect(t.b2).toBe(CHART_THEME_FALLBACK.b2)
    expect(t.grid).toBe('#abc')
    expect(t.text).toBe(CHART_THEME_FALLBACK.text)
  })

  it('无 window（SSR / 预渲染）时不抛错，直接返回兜底色', () => {
    vi.stubGlobal('window', undefined)
    expect(readChartTheme()).toEqual(CHART_THEME_FALLBACK)
  })
})

describe('buildTrendOption', () => {
  it('双轴：营收走 ¥ 轴、订单走 单 轴，数据按序映射', () => {
    const o = buildTrendOption(rangeData, theme, { rangeDays: 7 })
    expect(o.color).toEqual([theme.b1, theme.b2])
    expect(o.xAxis.data).toEqual(['9/1', '9/2', '9/3'])
    expect(o.yAxis.map((y: { name: string }) => y.name)).toEqual(['¥', '单'])
    expect(o.series).toHaveLength(2)
    expect(o.series[0].data).toEqual(rangeData.revenues)
    expect(o.series[0].yAxisIndex).toBe(0)
    expect(o.series[1].data).toEqual(rangeData.orderCounts)
    expect(o.series[1].yAxisIndex).toBe(1)
  })

  it('rangeDays>=90 才挂 dataZoom，并腾出滑条高度', () => {
    const short = buildTrendOption(rangeData, theme, { rangeDays: 30 })
    expect(short.dataZoom).toEqual([])
    expect(short.grid.bottom).toBe(0)
    const long = buildTrendOption(rangeData, theme, { rangeDays: 90 })
    expect(long.dataZoom.map((z: { type: string }) => z.type)).toEqual(['inside', 'slider'])
    expect(long.grid.bottom).toBe(28)
  })

  it('reducedMotion 命中时关动画（无障碍）', () => {
    expect(buildTrendOption(rangeData, theme, { rangeDays: 7 }).animation).toBe(true)
    expect(buildTrendOption(rangeData, theme, { rangeDays: 7, reducedMotion: true }).animation).toBe(false)
  })

  it('面积渐变由 b1 派生两个 offset 色标（不硬编码第二套色值）', () => {
    const stops = buildTrendOption(rangeData, theme, { rangeDays: 7 }).series[0].areaStyle.color.colorStops
    expect(stops).toEqual([
      { offset: 0, color: theme.b1 + '3d' },
      { offset: 1, color: theme.b1 + '0a' },
    ])
  })

  it('tooltip 运行时是 plainText', () => {
    const o = buildTrendOption(rangeData, theme, { rangeDays: 7 })
    expect(o.tooltip.renderMode).toBe('plainText')
    expect(o.tooltip.trigger).toBe('axis')
  })
})

describe('buildReviewOption', () => {
  const reviewTrend = { counts: [2, 0, 5], labels: ['9/1', '9/2', '9/3'] }
  it('单线评价趋势：纵轴整数刻度 + b2 面积渐变', () => {
    const o = buildReviewOption(reviewTrend, theme, {})
    expect(o.yAxis.minInterval).toBe(1)
    expect(o.series).toHaveLength(1)
    expect(o.series[0].data).toEqual([2, 0, 5])
    expect(o.series[0].itemStyle.color).toBe(theme.b2)
    expect(o.series[0].areaStyle.color.colorStops[0].color).toBe(theme.b2 + '30')
    expect(o.animation).toBe(true)
    expect(o.tooltip.renderMode).toBe('plainText')
  })
})

describe('buildPieOption', () => {
  it('占比数据原样透传，空数组不报错', () => {
    const segs = [{ name: '饮品', value: 12 }, { name: '食品', value: 7 }]
    const o = buildPieOption(segs, theme, { reducedMotion: true })
    expect(o.series[0].data).toEqual(segs)
    expect(o.animation).toBe(false)
    expect(buildPieOption([], theme, {}).series[0].data).toEqual([])
  })

  it('空态靠 HTML overlay，不注册 echarts graphic（省 ~87KB gz 的判据）', () => {
    const o = buildPieOption([], theme, {})
    expect('graphic' in o).toBe(false)
  })

  it('环形双半径 + plainText tooltip 模板', () => {
    const o = buildPieOption([{ name: '饮品', value: 1 }], theme, {})
    expect(o.series[0].radius).toEqual(['55%', '76%'])
    expect(o.tooltip.renderMode).toBe('plainText')
    expect(o.tooltip.formatter).toBe('{b}: {c} ({d}%)')
  })
})

describe('buildTopOption', () => {
  const topRevenue = [
    { name: '可乐', revenue: 120.6, qty: 40 },
    { name: '薯片', revenue: 80.4, qty: 30 },
    { name: '气泡水', revenue: 60.2, qty: 20 },
    { name: '辣条', revenue: 10.1, qty: 5 },
  ]

  it('倒序绘制（第一名在顶部）且营收取整', () => {
    const o = buildTopOption(topRevenue, theme, {})
    expect(o.yAxis.data).toEqual(['辣条', '气泡水', '薯片', '可乐'])
    expect(o.series[0].data).toEqual([10, 60, 80, 121])
  })

  it('前 3 名强调色 b3，其余 b1（rank 由 dataIndex 反推）', () => {
    const color = buildTopOption(topRevenue, theme, {}).series[0].itemStyle.color
    expect(color({ dataIndex: 3 })).toBe(theme.b3) // 视觉顶部 = 第 1 名
    expect(color({ dataIndex: 1 })).toBe(theme.b3) // 第 3 名
    expect(color({ dataIndex: 0 })).toBe(theme.b1) // 第 4 名
  })

  it('tooltip formatter 输出纯文本两行，不含 HTML 标签', () => {
    const o = buildTopOption(topRevenue, theme, {})
    expect(o.tooltip.renderMode).toBe(TOOLTIP_BASE.renderMode)
    expect(o.tooltip.formatter([{ name: '可乐', value: 121 }])).toBe('可乐\n营收 ¥121')
    expect(o.tooltip.formatter([{ name: '<img src=x>', value: 1 }])).toBe('<img src=x>\n营收 ¥1')
    expect(o.series[0].label.formatter).toBe('¥{c}')
  })

  it('空榜不抛错（组件侧其实有条件渲染，此处只保证 option 构造本身安全）', () => {
    const o = buildTopOption([], theme, { reducedMotion: true })
    expect(o.yAxis.data).toEqual([])
    expect(o.series[0].data).toEqual([])
    expect(o.animation).toBe(false)
  })
})
