// 订单查询页组件测试（对标第三轮 B4：页面层覆盖率棘轮）
// mock ../src/db（getOrderStatus）与 router，验证 4 态展示逻辑，不触网。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  getOrderStatus: vi.fn(),
  navigate: vi.fn(),
  locationState: { orderId: '' },
}))

vi.mock('../src/db', () => ({ getOrderStatus: mocks.getOrderStatus }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: true }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ state: mocks.locationState, pathname: '/order-query' }),
  }
})

import OrderQueryPage from '../src/pages/OrderQueryPage'

describe('OrderQueryPage 订单查询页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mocks.locationState = { orderId: '' }
  })

  it('输入单号查询：pending 单渲染 4 步进度并高亮待支付', async () => {
    mocks.getOrderStatus.mockResolvedValue({ status: 'pending', updatedAt: '2026-09-24T08:00:00.000Z' })
    render(<OrderQueryPage />)
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'o_test_1' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    await waitFor(() => expect(mocks.getOrderStatus).toHaveBeenCalledWith('o_test_1'))
    expect(await screen.findByText('待支付')).toBeTruthy()
    expect(screen.getByText('已支付')).toBeTruthy()
    expect(screen.getByText('配送中')).toBeTruthy()
    expect(screen.getByText('已送达')).toBeTruthy()
    // pending 态提供去支付入口
    expect(screen.getByRole('button', { name: '去支付' })).toBeTruthy()
  })

  it('delivering 单：进度定位到配送中，不再显示去支付', async () => {
    mocks.getOrderStatus.mockResolvedValue({ status: 'delivering', updatedAt: '2026-09-24T09:00:00.000Z' })
    render(<OrderQueryPage />)
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'o_test_2' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText(/订单进度|配送中/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去支付' })).toBeNull()
  })

  it('cancelled 单：显示已取消提示', async () => {
    mocks.getOrderStatus.mockResolvedValue({ status: 'cancelled', updatedAt: '' })
    render(<OrderQueryPage />)
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'o_test_3' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('该订单已取消')).toBeTruthy()
  })

  it('查无此单：给出核对提示且不渲染进度', async () => {
    mocks.getOrderStatus.mockResolvedValue(null)
    render(<OrderQueryPage />)
    fireEvent.change(screen.getByLabelText('订单号'), { target: { value: 'o_missing' } })
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText(/未查到该订单/)).toBeTruthy()
    expect(screen.queryByText('待支付')).toBeNull()
  })

  it('空输入点查询：本地校验提示，不发请求', async () => {
    render(<OrderQueryPage />)
    fireEvent.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('请输入订单号')).toBeTruthy()
    expect(mocks.getOrderStatus).not.toHaveBeenCalled()
  })

  it('带 state.orderId 进入：自动查询（零输入）', async () => {
    mocks.locationState = { orderId: 'o_auto' }
    mocks.getOrderStatus.mockResolvedValue({ status: 'paid', updatedAt: '' })
    render(<OrderQueryPage />)
    await waitFor(() => expect(mocks.getOrderStatus).toHaveBeenCalledWith('o_auto'))
    // paid 高亮在时间线第 2 步
    expect(screen.getAllByText('已支付').length).toBeGreaterThan(0)
  })
})
