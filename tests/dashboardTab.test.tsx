// @vitest-environment jsdom
// DashboardTab 看板主体单测（六轮 F1）：图表 hook 魔掉，只测"聚合结果 → 界面"这一段。
// 覆盖此前只能靠人工点击验证的分支：区间切换/键盘导航/CSV 导出/毛利卡三态/空态/加载失败。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import DashboardTab, { resetAdviceCacheForTest } from '../src/components/DashboardTab'

const { adminCall, cloudFlag } = vi.hoisted(() => ({ adminCall: vi.fn(), cloudFlag: { value: true } }))

vi.mock('../src/auth', () => ({ adminCall }))
// IS_CLOUD 走可变 ref：vite.config.js 的 test.env 已把 VITE_CB_API_BASE 钉成非空
// （消除"本机有没有 .env"这种机器依赖，见那里的注释），所以默认 IS_CLOUD=true，
// 演示模式那条分支要靠这个 getter 显式翻。见文件末尾「模式分支」块。
vi.mock('../src/cloudbase', () => ({ get IS_CLOUD() { return cloudFlag.value } }))
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
  margin: { drink: null, food: null, daily: null, withCostItems: 0, totalItems: 0 },
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
  cloudFlag.value = true  // 默认云端模式（与 vitest 读 .env 的真实值一致）
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
      margin: { drink: { revenue: 100, cost: 60, marginPct: 40 }, food: null, daily: null, withCostItems: 3, totalItems: 5 },
    })
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('40%')).toBeTruthy())
    expect(screen.getByText('毛利 ¥40')).toBeTruthy()
    expect(screen.getAllByText('暂无销售')).toHaveLength(2)
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
    expect(container.querySelector('[aria-label="饮品、食品与日用销量占比图"]')).toBeTruthy()
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

/**
 * 模式分支（2026-10-24 新增）。
 *
 * 为什么必须有这一块：vite.config.js 的 test.env 把 VITE_CB_API_BASE 钉成非空 ⇒ 本文件
 * 其余用例都跑在 IS_CLOUD=true 下。于是「本地演示模式」这条分支**没有任何测试走到过**，这正是老大报「看板数据加载失败」能长期存在的原因：
 * 真机 demo 构建 IS_CLOUD=false，测试环境 IS_CLOUD=true，两边看到的不是同一条代码路径。
 * ⇒ 用 vi.mock 显式造两种模式，把分支各自钉住。
 */
describe('模式分支：本地演示 vs 云端', () => {
  it('演示模式：不发必然失败的聚合请求，且显示设计边界而非「加载失败」', async () => {
    cloudFlag.value = false  // beforeEach 会复位成 true，所以必须在用例内设
    const { IS_CLOUD } = await import('../src/cloudbase')
    expect(IS_CLOUD, '本用例的前提是 vi.mock 已把 IS_CLOUD 置为 false').toBe(false)
    render(<DashboardTab />)
    // 关键断言 ①：一次请求都不该发（发了就是白抛「未配置接口地址」+ 一条 console 噪声）
    expect(adminCall).not.toHaveBeenCalled()
    // 关键断言 ②：文案必须是"需要连接服务端 / 不可用"，不能出现"加载失败"
    await waitFor(() => expect(screen.getByText(/本地演示模式/)).toBeTruthy())
    expect(screen.queryByText(/加载失败/), '演示模式显示"加载失败"会把设计边界误报成故障').toBeNull()
    expect(screen.getByText(/看板需要连接服务端聚合数据/)).toBeTruthy()
  })

  it('云端模式：正常发聚合请求（证明上一条的 not.toHaveBeenCalled 不是因为组件根本没挂载）', async () => {
    cloudFlag.value = true
    stubStats({ revenueSum: 700, orderSum: 35, totalOrders: 120 })
    render(<DashboardTab />)
    await waitFor(() => expect(adminCall).toHaveBeenCalledWith('getDashboardStats', { rangeDays: 7 }))
  })

  it('错误态必须给出路：有「重试」按钮，点击后重发聚合请求', async () => {
    cloudFlag.value = true
    adminCall.mockImplementation((action: string) =>
      action === 'getDashboardStats' ? Promise.reject(new Error('boom')) : Promise.resolve({ code: -1 }))
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('⚠️ 看板数据加载失败')).toBeTruthy())
    const retry = screen.getByRole('button', { name: '重试' })
    const before = adminCall.mock.calls.length
    // 让第二次请求成功，才能证明"重试"真的重发了（而不是只改了文案）
    adminCall.mockImplementation((action: string) =>
      action === 'getDashboardStats'
        ? Promise.resolve({ code: 0, data: { ...EMPTY_STATS, revenueSum: 100, orderSum: 5, totalOrders: 5 } })
        : Promise.resolve({ code: -1 }))
    fireEvent.click(retry)
    await waitFor(() => expect(adminCall.mock.calls.length).toBeGreaterThan(before))
    expect(screen.queryByText('⚠️ 看板数据加载失败')).toBeNull()
  })
})
