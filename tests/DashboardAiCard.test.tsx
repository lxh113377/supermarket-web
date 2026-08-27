// @vitest-environment jsdom
// DashboardTab AI 经营建议卡三态渲染测试（mock adminCall + useDashboardCharts，不触网不挂 echarts）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import DashboardTab from '../src/components/DashboardTab'
import type { Order, Product, Review } from '../src/types'

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

const orders: Order[] = []
const products: Product[] = []
const reviews: Review[] = []

describe('DashboardTab AI 经营建议卡', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
  })

  it('source=rule 渲染「规则版」徽章与建议内容', async () => {
    adminCall.mockResolvedValue({ code: 0, data: { content: '近 30 天暂无订单。', source: 'rule' } })
    render(<DashboardTab orders={orders} products={products} reviews={reviews} />)
    await waitFor(() => expect(adminCall).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('规则版')).toBeTruthy())
    expect(screen.getByText('近 30 天暂无订单。')).toBeTruthy()
  })

  it('source=dify 渲染「AI 已接入」徽章', async () => {
    adminCall.mockResolvedValue({ code: 0, data: { content: '建议优先备货可乐。', source: 'dify' } })
    render(<DashboardTab orders={orders} products={products} reviews={reviews} />)
    await waitFor(() => expect(screen.getByText('AI 已接入')).toBeTruthy())
    expect(screen.getByText('建议优先备货可乐。')).toBeTruthy()
  })

  it('接口失败渲染错误降级文案（不渲染原始错误串）', async () => {
    adminCall.mockRejectedValue(new Error('network down'))
    render(<DashboardTab orders={orders} products={products} reviews={reviews} />)
    await waitFor(() => expect(screen.getByText('AI 服务暂不可用，请稍后重试。')).toBeTruthy())
    // 降级铁律：原始错误串不得出现
    expect(screen.queryByText(/network down/)).toBeNull()
  })
})
