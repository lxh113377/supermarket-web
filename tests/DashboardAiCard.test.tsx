// @vitest-environment jsdom
// DashboardTab AI 经营建议卡三态渲染测试（mock adminCall + useDashboardCharts，不触网不挂 echarts）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import DashboardTab, { resetAdviceCacheForTest } from '../src/components/DashboardTab'

// vi.hoisted 规避 vi.mock 工厂 hoisting 的 TDZ 问题
const { adminCall } = vi.hoisted(() => ({ adminCall: vi.fn() }))

vi.mock('../src/auth', () => ({
  adminCall,
}))

// 图表 hook 返回空引用（本测试只关注 AI 卡，不初始化 echarts）
vi.mock('../src/hooks/useDashboardCharts', () => ({
  useDashboardCharts: () => ({
    trendRef: { current: null },
    reviewRef: { current: null },
    pieRef: { current: null },
    topRef: { current: null },
  }),
}))

// DashboardTab 挂载时会先拉 getDashboardStats 聚合（H1-2 服务端化），再拉 aiAdvice。
// 这里把两个 action 的返回都魔起来：聚合返回合法空口径，AI 按用例注入三态。
function mockStatsOk() {
  adminCall.mockImplementation((action) => {
    if (action === 'getDashboardStats') {
      return Promise.resolve({
        code: 0,
        data: {
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
        },
      })
    }
    if (action === 'aiAdvice') {
      return Promise.resolve({ code: 0, data: { content: '近 30 天暂无订单。', source: 'rule' } })
    }
    return Promise.resolve({ code: -1, message: 'unknown' })
  })
}

describe('DashboardTab AI 经营建议卡', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // AI 建议现为会话级缓存（mount 复用），不复位会让上一用例结果泄漏进下一用例
    resetAdviceCacheForTest()
    mockStatsOk()
  })
  afterEach(() => {
    cleanup()
  })

  it('source=rule 渲染「规则版」徽章与建议内容', async () => {
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('规则版')).toBeTruthy())
    expect(screen.getByText('近 30 天暂无订单。')).toBeTruthy()
  })

  it('source=dify 渲染「AI 已接入」徽章', async () => {
    adminCall.mockImplementation((action) => {
      if (action === 'getDashboardStats') return Promise.resolve({ code: 0, data: { rangeData: { labels: [], orderCounts: [], revenues: [] } } })
      return Promise.resolve({ code: 0, data: { content: '建议优先备货可乐。', source: 'dify' } })
    })
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('AI 已接入')).toBeTruthy())
    expect(screen.getByText('建议优先备货可乐。')).toBeTruthy()
  })

  it('接口失败渲染错误降级文案（不渲染原始错误串）', async () => {
    adminCall.mockImplementation((action) => {
      if (action === 'getDashboardStats') return Promise.resolve({ code: 0, data: { rangeData: { labels: [], orderCounts: [], revenues: [] } } })
      return Promise.reject(new Error('network down'))
    })
    render(<DashboardTab />)
    await waitFor(() => expect(screen.getByText('AI 服务暂不可用，请稍后重试。')).toBeTruthy())
    // 降级铁律：原始错误串不得出现
    expect(screen.queryByText(/network down/)).toBeNull()
  })
})