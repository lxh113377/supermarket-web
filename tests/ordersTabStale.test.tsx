// OrdersTab 超时未确认订单面板（对标第三轮 B5）：报表展示 + 逐单"取消并释放库存"走同一条状态机路径
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  adminCall: vi.fn(),
  updateOrderStatus: vi.fn(),
  deleteOrder: vi.fn(),
  getAllOrders: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  adminCall: mocks.adminCall,
  updateOrderStatus: mocks.updateOrderStatus,
  deleteOrder: mocks.deleteOrder,
}))
vi.mock('../src/db', () => ({ getAllOrders: mocks.getAllOrders }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: true }))

import OrdersTab from '../src/components/OrdersTab'

const staleReport = {
  thresholdMinutes: 60,
  count: 1,
  orders: [{ id: 'o_stale1', roomNumber: '12栋-301', totalAmount: 8.5, ageMinutes: 190, hasPaymentProof: true }],
  stockReserved: [{ productId: 'p1', name: '可乐', reserved: 2 }],
}
const orders = [{
  _id: 'o_stale1', roomNumber: '12栋-301', totalAmount: 8.5, status: 'pending',
  items: [{ productId: 'p1', name: '可乐', price: 4.25, quantity: 2 }], createdAt: '2026-09-24T00:00:00Z',
}]

describe('OrdersTab 超时订单面板', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllOrders.mockResolvedValue({ orders: [], maxUpdatedAt: null })
    mocks.updateOrderStatus.mockResolvedValue({ code: 0 })
    mocks.adminCall.mockImplementation(async (action) => {
      if (action === 'stalePendingReport') return { code: 0, data: staleReport }
      return { code: 0, data: [] }
    })
  })

  it('挂载后拉取报表：出现汇总行并按库存占用汇总件数', async () => {
    render(<OrdersTab orders={orders} onOrdersChange={() => {}} loading={false} />)
    await waitFor(() => expect(mocks.adminCall).toHaveBeenCalledWith('stalePendingReport', { minutes: 60 }))
    const trigger = await screen.findByRole('button', { name: /超时未确认订单 1 单/ })
    expect(trigger.textContent).toContain('占用有限库存 2 件')
  })

  it('展开清单：付款截图徽标可见；取消按钮走 updateOrderStatus(cancelled) 并刷新', async () => {
    render(<OrdersTab orders={orders} onOrdersChange={() => {}} loading={false} />)
    fireEvent.click(await screen.findByRole('button', { name: /超时未确认订单 1 单/ }))
    expect(await screen.findByText(/已传付款截图/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消并释放库存' }))
    await waitFor(() => expect(mocks.updateOrderStatus).toHaveBeenCalledWith('o_stale1', 'cancelled'))
    // 取消成功后重拉报表（初始 1 次 + 取消后 1 次）
    await waitFor(() => expect(mocks.adminCall).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('超时订单已取消并释放占用库存')).toBeTruthy()
  })

  it('只读密钥被拒：面板静默不显示，不打断订单列表', async () => {
    mocks.adminCall.mockResolvedValue({ code: -1, message: '只读账号不能执行该操作' })
    render(<OrdersTab orders={orders} onOrdersChange={() => {}} loading={false} />)
    await waitFor(() => expect(mocks.adminCall).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /超时未确认订单/ })).toBeNull()
    expect(screen.getByText('房间号：12栋-301')).toBeTruthy()
  })
})
