// @vitest-environment jsdom
// useDashboardCharts 生命周期单测（六轮 F1）：echarts 全模块 mock，不真挂 canvas。
// 守的是三条曾经踩过/容易再踩的副作用不变量：
// ① 动态 import 的 11 个深路径模块全部 core.use 注册（漏一个 → 对应图直接报 "series not supported"）
// ② 实例必须随卸载 dispose + resize 监听注销（P0-1：原 cleanup 写在 async IIFE 内部 = 无效，切 tab 泄漏）
// ③ echarts 晚于数据就绪时要重跑 setOption（P0-2：否则首屏图表空白）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useDashboardCharts, type ChartData } from '../src/hooks/useDashboardCharts'

type Stub = { setOption: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }

const h = vi.hoisted(() => {
  const made: Array<{ key: string; stub: unknown }> = []
  const loaded: string[] = []
  const rec = (name: string) => {
    loaded.push(name)
    return {}
  }
  return {
    made,
    loaded,
    rec,
    // use 必须复刻真库语义（echarts/lib/extension.js：非函数入参会走 ext.install(...)）。
    // 上一版这里放的是空 vi.fn()，于是"把 side-effect 模块当 use() 入参"这个致命错误
    // （生产包里 line.default 恒 undefined → TypeError → 四张图静默空白）被 mock 完全掩盖。
    use: vi.fn((list: unknown[]) => {
      for (const item of list as Array<{ install?: unknown }>) {
        if (typeof item === 'function') continue
        if (!item || typeof (item as { install?: unknown }).install !== 'function') {
          throw new TypeError("Cannot read properties of undefined (reading 'install')")
        }
      }
    }),
    init: vi.fn((el: HTMLElement) => {
      const stub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), key: el.dataset.key || '' }
      made.push({ key: stub.key, stub })
      return stub
    }),
  }
})

vi.mock('echarts/core', () => ({ use: h.use, init: h.init }))
// 深路径 chart/component 模块在真库里**没有任何导出**（纯 side-effect 自注册），mock 保持同形，
// 这样任何"取 .default 再塞进 use()"的写法会立刻在上面的 use 里炸掉。
vi.mock('echarts/lib/chart/line', () => h.rec('line'))
vi.mock('echarts/lib/chart/pie', () => h.rec('pie'))
vi.mock('echarts/lib/chart/bar', () => h.rec('bar'))
vi.mock('echarts/lib/component/grid', () => h.rec('grid'))
vi.mock('echarts/lib/component/tooltip', () => h.rec('tooltip'))
vi.mock('echarts/lib/component/legend', () => h.rec('legend'))
vi.mock('echarts/lib/component/dataZoom', () => h.rec('dataZoom'))
vi.mock('echarts/lib/component/dataZoomInside', () => h.rec('dataZoomInside'))
vi.mock('echarts/lib/component/dataZoomSlider', () => h.rec('dataZoomSlider'))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: { install: () => undefined }, SVGRenderer: { install: () => undefined } }))

const DATA: ChartData = {
  rangeData: { labels: ['9/1', '9/2'], orderCounts: [1, 2], revenues: [10, 20] },
  pieSegments: [{ name: '饮品', value: 3 }],
  topRevenue: [{ name: '可乐', revenue: 12.4, qty: 4 }],
  reviewTrend: { counts: [1, 2], labels: ['9/1', '9/2'] },
  rangeDays: 7,
}

// setOption effect 以各数据分片为依赖，必须整体换新引用才会重跑（真实场景 = 服务端聚合返回新对象）
const cloneData = (d: ChartData = DATA): ChartData => ({
  rangeData: { ...d.rangeData, labels: [...d.rangeData.labels] },
  pieSegments: [...d.pieSegments],
  topRevenue: [...d.topRevenue],
  reviewTrend: { counts: [...d.reviewTrend.counts], labels: [...d.reviewTrend.labels] },
  rangeDays: d.rangeDays,
})

// 宿主组件：把 4 个 ref 绑到真实 DOM（ref.current 为 null 时 hook 不建实例，测不到 init）
function Harness({ d = DATA, late }: { d?: ChartData; late?: boolean }) {
  const { trendRef, reviewRef, pieRef, topRef } = useDashboardCharts(d)
  return (
    <div>
      <div data-key="trend" ref={trendRef} />
      {!late && <div data-key="review" ref={reviewRef} />}
      <div data-key="pie" ref={pieRef} />
      <div data-key="top" ref={topRef} />
    </div>
  )
}

const stubFor = (key: string): Stub | undefined => h.made.find((m) => m.key === key)?.stub as Stub | undefined

beforeEach(() => {
  h.made.length = 0
  h.use.mockClear()
  h.init.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useDashboardCharts 生命周期', () => {
  it('9 个按需模块按 side-effect 引入，use() 只收渲染器（真库语义判据）', async () => {
    render(<Harness />)
    await waitFor(() => expect(h.init).toHaveBeenCalledTimes(4))
    expect(h.use).toHaveBeenCalledTimes(1)
    // 传入项必须全部"可安装"——这正是修复前炸掉的地方（9 个 undefined 混进来）
    const installs = h.use.mock.calls[0][0] as unknown[]
    expect(installs).toHaveLength(1)
    expect(h.loaded.slice().sort()).toEqual([
      'bar', 'dataZoom', 'dataZoomInside', 'dataZoomSlider', 'grid', 'legend', 'line', 'pie', 'tooltip',
    ])
  })

  it('echarts 就绪后每张图都收到 plainText tooltip 的 option（P0-2 重跑路径）', async () => {
    render(<Harness />)
    await waitFor(() => expect(stubFor('trend')?.setOption).toHaveBeenCalled())
    for (const key of ['trend', 'pie', 'top']) {
      const opt = stubFor(key)!.setOption.mock.calls[0][0]
      expect(opt.tooltip.renderMode).toBe('plainText')
    }
    // 第二参 notMerge=true：区间切换后旧 series 不残留
    expect(stubFor('trend')!.setOption.mock.calls[0][1]).toBe(true)
    expect(stubFor('trend')!.setOption.mock.calls[0][0].series).toHaveLength(2)
  })

  it('条件渲染晚出现的容器在数据变化时补建实例（评价图 hasReviews 切换）', async () => {
    const r = render(<Harness late />)
    await waitFor(() => expect(h.init).toHaveBeenCalledTimes(3))
    expect(stubFor('review')).toBeUndefined()
    r.rerender(<Harness d={cloneData(DATA)} />)
    await waitFor(() => expect(stubFor('review')?.setOption).toHaveBeenCalled())
    expect(stubFor('review')!.setOption.mock.calls[0][0].series[0].data).toEqual([1, 2])
  })

  it('resize 联动全部实例；卸载后 dispose 且监听注销（P0-1 泄漏回归）', async () => {
    const r = render(<Harness />)
    await waitFor(() => expect(h.init).toHaveBeenCalledTimes(4))
    fireEvent(window, new Event('resize'))
    expect(stubFor('trend')?.resize).toHaveBeenCalled()
    r.unmount()
    for (const m of h.made) expect((m.stub as Stub).dispose).toHaveBeenCalledTimes(1)
    fireEvent(window, new Event('resize'))
    expect(stubFor('trend')?.resize).toHaveBeenCalledTimes(1)
  })

  it('import 未回来就卸载 → 不建实例、不 setState（cancelled 守卫）', async () => {
    const r = render(<Harness />)
    r.unmount()
    await new Promise((res) => setTimeout(res, 0))
    expect(h.init).not.toHaveBeenCalled()
    expect(h.use).not.toHaveBeenCalled()
  })

  it('prefers-reduced-motion 命中时关动画', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    render(<Harness />)
    await waitFor(() => expect(stubFor('trend')?.setOption).toHaveBeenCalled())
    expect(stubFor('trend')!.setOption.mock.calls[0][0].animation).toBe(false)
  })
})
