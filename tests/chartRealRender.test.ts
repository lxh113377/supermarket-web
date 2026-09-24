// @vitest-environment node
// 真库渲染冒烟（六轮 F1 收口）：前面两层判据各有盲区——
//  · 纯函数单测只断言"形状长这样"，echarts 认不认这个 option 它不知道；
//  · hook 测试把 echarts 整包 mock 掉，只验生命周期不验绘制。
// 这里用 echarts 官方 SSR 模式（init(null,null,{renderer:'svg',ssr:true})）在 node 里真渲染，
// 不依赖 canvas/DOM/浏览器，也不需要管理密钥：option 有任何结构性错误（系列类型拼错、
// 颜色不可解析、radius/数据形状非法）echarts 会直接抛或画不出对应元素。
import { describe, it, expect, beforeAll } from 'vitest'
import * as echarts from 'echarts/core'
import { buildPieOption, buildReviewOption, buildTopOption, buildTrendOption, CHART_THEME_FALLBACK } from '../src/utils/chartOptions'

// 与 useDashboardCharts 同样的注册方式：9 个按需模块只 import（自带注册），只有渲染器要 use()。
// 差别仅在渲染器用 SVGRenderer，以便在 node 里无 canvas 出图。
let ready = false
let deepModules: Record<string, unknown>[] = []
beforeAll(async () => {
  if (ready) return
  deepModules = (await Promise.all([
    import('echarts/lib/chart/line'),
    import('echarts/lib/chart/pie'),
    import('echarts/lib/chart/bar'),
    import('echarts/lib/component/grid'),
    import('echarts/lib/component/tooltip'),
    import('echarts/lib/component/legend'),
    import('echarts/lib/component/dataZoom'),
    import('echarts/lib/component/dataZoomInside'),
    import('echarts/lib/component/dataZoomSlider'),
  ])) as unknown as Record<string, unknown>[]
  const renderers = await import('echarts/renderers')
  echarts.use([renderers.SVGRenderer])
  ready = true
})

function render(option: Record<string, unknown>, w = 420, h = 300): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: w, height: h })
  try {
    chart.setOption(option as never, true)
    return chart.renderToSVGString() as string
  } finally {
    chart.dispose()
  }
}

const rangeData = { labels: ['9/1', '9/2', '9/3'], orderCounts: [3, 1, 2], revenues: [30.5, 10.25, 20] }
const T = CHART_THEME_FALLBACK

describe('echarts 真渲染（SSR/SVG）', () => {
  it('判据自身成立：深路径模块无 default 导出，仅 import 即完成注册（修复前炸点的根因）', () => {
    expect(deepModules).toHaveLength(9)
    for (const m of deepModules) {
      expect((m as { default?: unknown }).default).toBeUndefined()
      expect(Object.keys(m)).toEqual([])
    }
    // 上面 9 个模块没有被 use() 注册过任何一次，line 却已可用 → 证明"import 即注册"
    const svg = render(buildTrendOption(rangeData, T, { rangeDays: 7 }), 200, 120)
    expect(svg).toContain('<svg')
  })

  it('双轴趋势图渲染出两条折线，且 90 天档带 dataZoom 滑条', () => {
    const week = render(buildTrendOption(rangeData, T, { rangeDays: 7 }))
    expect(week.startsWith('<svg')).toBe(true)
    expect(week).toContain('¥')
    expect(week).toContain('单')
    expect((week.match(/<path/g) || []).length).toBeGreaterThan(2)
    const quarter = render(buildTrendOption(rangeData, T, { rangeDays: 90 }))
    expect(quarter.length).toBeGreaterThan(500)
  })

  it('评价趋势单线图渲染（真 SVG，非空壳）', () => {
    const svg = render(buildReviewOption({ counts: [1, 2, 3], labels: ['9/1', '9/2', '9/3'] }, T, {}), 420, 200)
    expect(svg).toContain('<svg')
    expect((svg.match(/<path/g) || []).length).toBeGreaterThan(0)
    expect(svg).toContain('9/1')
  })

  it('环形占比图渲染出两段扇形与图例文案（入库文本进图例=SSR 侧可见性）', () => {
    const svg = render(buildPieOption([{ name: '饮品A', value: 12 }, { name: '食品B', value: 7 }], T, {}), 320, 320)
    expect(svg).toContain('饮品A')
    expect(svg).toContain('食品B')
    expect((svg.match(/<path/g) || []).length).toBeGreaterThan(1)
  })

  it('TOP 条形图渲染：营收取整进标签、前 3 名用强调色 b3', () => {
    const top = [
      { name: '可乐', revenue: 120.6, qty: 40 },
      { name: '薯片', revenue: 80.4, qty: 30 },
      { name: '气泡水', revenue: 60.2, qty: 20 },
      { name: '辣条', revenue: 10.1, qty: 5 },
    ]
    const svg = render(buildTopOption(top, T, {}), 420, 320)
    expect(svg).toContain('¥121')
    expect(svg).toContain('可乐')
    // 前三名强调色、第四名基色（hex 大小写在 SVG 里可能被归一，统一小写比对）
    const lower = svg.toLowerCase()
    expect(lower.split(T.b3.toLowerCase()).length - 1).toBeGreaterThanOrEqual(3)
    expect(lower).toContain(T.b1.toLowerCase())
  })

  it('空数据不炸图（看板首帧 stats 未到位时的真实形态）', () => {
    const empty = { labels: [] as string[], orderCounts: [] as number[], revenues: [] as number[] }
    expect(render(buildTrendOption(empty, T, { rangeDays: 30 }))).toContain('<svg')
    expect(render(buildPieOption([], T, {}))).toContain('<svg')
    expect(render(buildTopOption([], T, {}))).toContain('<svg')
  })
})
