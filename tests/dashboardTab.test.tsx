// @vitest-environment jsdom
// DashboardTab 看板主体单测（六轮 F1）：图表 hook 魔掉，只测"聚合结果 → 界面"这一段。
// 覆盖此前只能靠人工点击验证的分支：区间切换/键盘导航/CSV 导出/毛利卡三态/空态/加载失败。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import DashboardTab, { resetAdviceCacheForTest } from '../src/components/DashboardTab'

const { adminCall } = vi.hoisted(() => ({ adminCall: vi.fn() }))

vi.mock('../src/auth', () => ({ adminCall }))
vi.mock('../src/hooks/useDashboardCharts', () => ({
  useDashboardCharts: () => ({
    trendRef: { current: null }, reviewRef: { current: null },
    pieRef: { current: null }, topRef: { current: null },
  }),
}))

const EMPTY_STATS = {
  rangeDays: 7,
  rangeData: { labels: [], orderCounts: [], revenues: [] },
  delta: { ordersDelta: null, revenueDelta: null },
  reviewTrend: { counts: [], labels: [] },
  margin: { drink: null, food: null, withCostItems: 0, totalItems: 0 },
  pieSegments: [],
  topRevenue: [],
  totalOrders: 0,
  orderSum: 0,
  revenueSum: 0,
}

function stubStats(over: Record<string, unknown> = {}) {
  adminCall.mockImplementation((action: string) => {
    if (action === 'getDashboardStats') return Promise.resolve({ code: 0, data: { ...EMPTY_STATS, ...over } })
    if (action === 'aiAdvice') return Promise.resolve({ code: -1, message: 'no ai' })
    return Promise.resolve({ code: -1, message: 'unknown' })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAdviceCacheForTest()
})
afterEach(() => {
  cleanup()
})

describe('看板数据区渲染', () => {
  it('聚合成功后渲染 KPI 与无障碍摘要，日均营收按区间天数摊算', async () => {
    stubStats({ revenueSum: 700, orderSum: 35, totalOrders: 120 })
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText(/累计 120 单/)).toBeTruthy())
    expect(screen.getByRole('tab', { name: '近7天' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('近 7 天营收 / 订单趋势')).toBeTruthy()
    // 700 / 7 = 100 日均
    expect(screen.getByText(/日均营收 100 元/)).toBeTruthy()
  })

  it('毛利卡：withCostItems>0 时饮品列毛利率与毛利额，缺侧显示「暂无销售」', async () => {
    stubStats({
      margin: { drink: { revenue: 100, cost: 60, marginPct: 40 }, food: null, withCostItems: 3, totalItems: 5 },
    })
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('40%')).toBeTruthy())
    expect(screen.getByText('毛利 ¥40')).toBeTruthy()
    expect(screen.getAllByText('暂无销售')).toHaveLength(1)
  })

  it('毛利卡：withCostItems=0 显示「待录入」引导而非空表', async () => {
    stubStats()
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('待录入')).toBeTruthy())
    expect(screen.getByText(/在商品内联编辑中录入成本价后自动计算/)).toBeTruthy()
  })

  it('三处空态各自提示（评价无 / 占比无 / 榜单无）', async () => {
    stubStats()
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getAllByText('暂无数据')).toHaveLength(3))
  })

  it('有数据时渲染三个图表容器而非空态文案', async () => {
    stubStats({
      reviewTrend: { counts: [1, 2], labels: ['9/1', '9/2'] },
      pieSegments: [{ name: '饮品', value: 3 }],
      topRevenue: [{ name: '可乐', revenue: 12, qty: 3 }],
    })
    const { container } = render(<DashboardTab />)
    await waitFor(() => expect(container.querySelector('[aria-label="近14天评价趋势图"]')).toBeTruthy())
    expect(container.querySelector('[aria-label="饮品与食品销量占比图"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="热销商品营收排行图"]')).toBeTruthy()
    expect(screen.queryByText('暂无数据')).toBeNull()
  })
})

describe('区间切换与导出', () => {
  it('点「近90天」重新拉取聚合并更新表题', async () => {
    stubStats()
    render(<DashboardTab />)
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('getDashboardStats', { rangeDays: 7 }))
    fireEvent.click(screen.getByRole('tab', { name: '近90天' }))
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('getDashboardStats', { rangeDays: 90 }))
    expect(screen.getByText('近 90 天营收 / 订单趋势')).toBeTruthy()
  })

  it('tablist 方向键切换区间（roving tabindex，30 → 90）', async () => {
    stubStats()
    render(<DashboardTab initialRangeDays={30} />)
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('getDashboardStats', { rangeDays: 30 }))
    expect(screen.getByRole('tab', { name: '近90天' }).getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(screen.getByRole('tablist', { name: '统计时间范围' }), { key: 'ArrowRight' })
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('getDashboardStats', { rangeDays: 90 }))
  })

  it('导出 CSV：以聚合行生成 Blob 并触发下载', async () => {
    stubStats({ rangeData: { labels: ['9/1'], orderCounts: [2], revenues: [12.5] } })
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('导出 CSV')).toBeTruthy())
    fireEvent.click(screen.getByText('导出 CSV'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect((blob as unknown as { type: string }).type).toBe('text/csv;charset=utf-8')
    expect(await blob.text()).toContain('9/1,2,12.5')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    clickSpy.mockRestore()
  })
})

describe('聚合失败降级', () => {
  it('业务码非 0 → 渲染接口 message，不再渲染图表区', async () => {
    adminCall.mockImplementation((action: string) =>
      action === 'getDashboardStats'
        ? Promise.resolve({ code: -1, message: 'D1 读配额耗尽' })
        : Promise.resolve({ code: -1, message: 'no ai' }))
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText(/D1 读配额耗尽/)).toBeTruthy())
    expect(screen.queryByText('导出 CSV')).toBeNull()
  })

  it('请求抛错 → 固定降级文案（不泄漏异常串）', async () => {
    adminCall.mockImplementation((action: string) =>
      action === 'getDashboardStats' ? Promise.reject(new Error('boom')) : Promise.resolve({ code: -1 }))
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('⚠️ 看板数据加载失败')).toBeTruthy())
  })
})
