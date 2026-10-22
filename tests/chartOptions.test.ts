// 看板图表 option 纯函数单测（六轮 F1：option 构造从 useDashboardCharts 抽出后可直测）
// 关注点不是"像不像 echarts"，而是三条真实约束：
// ① 所有 tooltip 运行时带 renderMode:'plainText'（XSS 汇点，静态 grep 只防漏写、防不了写错值）
// ② rangeDays>=90 才挂 dataZoom（区间联动）
// ③ TOP 条形倒序 + 前 3 名强调色（展示口径，改错不报错、只会静默画反）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
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

// 假色：故意与真实色板无关，防止任何一条断言偷偷依赖「真值是多少」
const theme: ChartTheme = { b1: '#aaa111', b2: '#bbb222', b3: '#ccc333', b4: '#ddd555', grid: '#ddd444', text: '#eee555' }
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

/**
 * 图表色板的「声明 ⇄ 兑现」对账（2026-10-22 新增）。
 *
 * 为什么单独开一节：chartOptions.ts 的注释长期写着「与 index.css 的 --chart-* 变量同值」，
 * 但没有任何判据核过这句话 —— 正是本仓反复抓的那类「配置写了不等于在用」。
 * 而本轮实测到的三个缺陷全部落在「没人量过色板」这块盲区里：
 *   ① 营收线 b1 = #facc15 压白卡只有 1.53:1（WCAG 1.4.11 图形对象要 3:1）
 *      —— 截图上就是「一条几乎看不见的黄线」；
 *   ② 轴/图例文字 #9ca3af = 2.54:1，且实测是 9–11px 小字（需 4.5:1）；
 *   ③ 饼图三个分类却配 color: [b1, b2] 两色 ⇒ 第三扇区回绕成第一色，
 *      图例三个名字、图上两种颜色，「日用」与「饮品」根本无法区分。
 * 三条都是「改错不报错、只会静默画糊」那一类，只能靠判据钉死。
 */
describe('图表色板对账（index.css ⇄ 兜底色 ⇄ 对比度）', () => {
  // 路径写法随本仓既有测试（minDeliveryParity 等）：vitest cwd = 仓库根，直接给裸相对路径。
  // 不用 new URL('...', import.meta.url) —— 经 transform 后 import.meta.url 可能是 http scheme，readFileSync 会拒。
  const css = readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n')
  const cssVar = (name: string): string => {
    const m = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})\\s*;').exec(css)
    expect(m, 'index.css 里找不到 --' + name + '（色板真相源漂移）').toBeTruthy()
    return m![1].toLowerCase()
  }
  const VARS = { b1: 'chart-b1', b2: 'chart-b2', b3: 'chart-b3', b4: 'chart-b4', grid: 'chart-grid', text: 'chart-text' } as const
  const KEYS = Object.keys(VARS) as (keyof typeof VARS)[]

  it('index.css 的 --chart-* 与 CHART_THEME_FALLBACK 逐字相等（两处必须一起改）', () => {
    for (const k of KEYS) {
      expect(cssVar(VARS[k]), k + '：index.css 与 chartOptions 兜底色不一致').toBe(
        CHART_THEME_FALLBACK[k].toLowerCase(),
      )
    }
  })

  // WCAG 相对亮度（与 e2e-visual/contrast.spec.ts 同一公式，此处是源码级快速腿）
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  const lum = (hex: string) => {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const contrast = (a: string, b: string) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  }
  const WHITE = '#ffffff'

  it('四条数据墨色压白卡都过 3:1（WCAG 1.4.11 非文本图形对象）', () => {
    for (const k of ['b1', 'b2', 'b3', 'b4'] as const) {
      const hex = CHART_THEME_FALLBACK[k]
      const c = contrast(hex, WHITE)
      expect(c, k + '=' + hex + ' 压白卡只有 ' + c.toFixed(2) + ':1，线/条/扇区会看不见').toBeGreaterThanOrEqual(3)
    }
  })

  it('轴与图例文字过 4.5:1（实测 9–11px，属正文档不是大字档）', () => {
    const c = contrast(CHART_THEME_FALLBACK.text, WHITE)
    expect(c, 'text=' + CHART_THEME_FALLBACK.text + ' 压白卡 ' + c.toFixed(2) + ':1，小字看不清').toBeGreaterThanOrEqual(4.5)
  })

  it('饼图三分类亮度两两拉开 ≥0.07（红绿色盲下不靠色相也能分扇区）', () => {
    const pairs: Array<['b1' | 'b2' | 'b4', 'b1' | 'b2' | 'b4']> = [['b1', 'b2'], ['b1', 'b4'], ['b2', 'b4']]
    for (const [x, y] of pairs) {
      const d = Math.abs(lum(CHART_THEME_FALLBACK[x]) - lum(CHART_THEME_FALLBACK[y]))
      expect(d, x + ' 与 ' + y + ' 亮度差仅 ' + d.toFixed(3) + '，色盲下两个扇区会糊成一块').toBeGreaterThanOrEqual(0.07)
    }
  })

  it('饼图色板长度覆盖三个分类（旧写法两色 ⇒ 第三扇区回绕成第一色）', () => {
    const segs = [{ name: '饮品', value: 12 }, { name: '食品', value: 7 }, { name: '日用', value: 5 }]
    const o = buildPieOption(segs, theme, {})
    expect(o.color.length).toBeGreaterThanOrEqual(segs.length)
    expect(new Set(o.color.slice(0, segs.length)).size).toBe(segs.length)
  })
})
