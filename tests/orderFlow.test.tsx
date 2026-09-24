// @vitest-environment jsdom
// 顾客端下单主链路集成测试：加购 → 确认订单 → 提交 → 支付（轮询确认）
// mock 后端（db）与 router，验证页面交互与传参，不触网。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import CartPage from '../src/pages/CartPage'
import OrderConfirmPage from '../src/pages/OrderConfirmPage'
import PaymentPage from '../src/pages/PaymentPage'
import { getCart, saveCart } from '../src/cart'

// vi.hoisted 规避 vi.mock factory hoisting 到文件顶部的 TDZ 问题
const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  getOrderById: vi.fn(),
  getOrderStatus: vi.fn(),
  getProducts: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/db', () => ({
  createOrder: mocks.createOrder,
  getOrderById: mocks.getOrderById,
  getOrderStatus: mocks.getOrderStatus,
  getProducts: mocks.getProducts,
}))

vi.mock('../src/cloudbase', () => ({
  IS_CLOUD: true,
}))

vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: () => true,
  getClosedMessage: () => '',
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({
      state: { orderId: 'o1', totalAmount: 7 },
      search: '',
      hash: '',
      pathname: '/',
      key: 'default',
    }),
  }
})

const cartWith = (qty: number) => ({ items: [{ productId: 'p1', name: '可乐', price: 3.5, quantity: qty, spec: '' }] })

describe('下单主链路（加购 → 确认 → 支付）', () => {
  beforeEach(() => {
    // 测试间 DOM 清理由 tests/setup.ts 全局 RTL cleanup 统一负责
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    mocks.getProducts.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('CartPage：渲染购物车商品/数量/合计，点去支付跳确认页', () => {
    saveCart(cartWith(2))
    render(<CartPage />)
    expect(screen.getByText('可乐')).toBeTruthy()
    expect(screen.getByText(/共 2 件/)).toBeTruthy()
    expect(screen.getByText('¥7.00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去支付' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/order-confirm')
  })

  it('CartPage：空购物车显示空态', () => {
    render(<CartPage />)
    expect(screen.getByText('购物车是空的')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去支付' })).toBeNull()
  })

  it('OrderConfirmPage：填单提交 → createOrder 传参正确 + 购物车清空 + 跳成功页', async () => {
    saveCart(cartWith(1))
    mocks.createOrder.mockResolvedValue({ id: 'o1', localFallback: false })
    render(<OrderConfirmPage />)
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '305' } })
    // 微信号已改为选填：不填也能提交
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))

    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledTimes(1))
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      roomNumber: '36栋-305',
      items: [expect.objectContaining({ productId: 'p1', quantity: 1 })],
    }))
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/order-success',
      expect.objectContaining({ state: expect.objectContaining({ orderId: 'o1', building: '36栋', room: '305' }) }),
    )
    // 提交成功后购物车清空
    expect(getCart().items).toHaveLength(0)
  })

  it('OrderConfirmPage：失败重试复用同一把幂等键，重新挂载才换新键（对标 A1）', async () => {
    saveCart(cartWith(1))
    const fillAndSubmit = () => {
      fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
      fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '305' } })
      fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    }
    mocks.createOrder.mockRejectedValueOnce(new Error('网络中断'))
    const { unmount } = render(<OrderConfirmPage />)
    fillAndSubmit()
    await waitFor(() => expect(screen.getByText(/提交订单失败/)).toBeTruthy())
    // 失败不清空购物车，用户直接重试：必须复用同一个 requestId，服务端才会去重
    fillAndSubmit()
    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledTimes(2))
    const [first, second] = mocks.createOrder.mock.calls
    expect(typeof first[0].requestId).toBe('string')
    expect(first[0].requestId.length).toBeGreaterThan(6)
    expect(second[0].requestId).toBe(first[0].requestId)

    unmount()
    saveCart(cartWith(1))
    render(<OrderConfirmPage />)
    fillAndSubmit()
    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledTimes(3))
    const third = mocks.createOrder.mock.calls[2]
    expect(third[0].requestId).not.toBe(first[0].requestId)
  })

  it('OrderConfirmPage：未填楼栋号阻止提交并提示', async () => {
    saveCart(cartWith(1))
    render(<OrderConfirmPage />)
    fireEvent.change(screen.getByPlaceholderText('请输入你的微信号'), { target: { value: 'wx' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    await waitFor(() => expect(screen.getByText('请填写楼栋号')).toBeTruthy())
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('OrderConfirmPage：未填房间号阻止提交并提示（房间号必填）', async () => {
    saveCart(cartWith(1))
    render(<OrderConfirmPage />)
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    await waitFor(() => expect(screen.getByText('请填写房间号')).toBeTruthy())
    expect(mocks.createOrder).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('PaymentPage：选微信支付 → 显示二维码与联系商家提示，无"我已付款"按钮', () => {
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    expect(screen.getByAltText('微信支付二维码')).toBeTruthy()
    expect(screen.getByText(/请截图扫码付款，付款后联系商家进行配送/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '我已付款' })).toBeNull()
  })

  it('PaymentPage：轮询到订单 paid 显示付款已确认（/pub getOrderStatus，顾客免密钥）', async () => {
    mocks.getOrderStatus.mockResolvedValue({ status: 'paid', updatedAt: '2026-09-24T00:00:00Z' })
    vi.useFakeTimers()
    render(<PaymentPage />)
    // 先选支付方式（paid 确认界面仅在 method 选定后渲染）
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    // advanceTimersByTimeAsync 会执行 timer 回调并 flush 其 async 续体（getOrderStatus → setState）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByText('付款已确认')).toBeTruthy()
    expect(mocks.getOrderStatus).toHaveBeenCalledWith('o1')
  })

  it('PaymentPage：订单进入配送中显示「订单进度：配送中」', async () => {
    mocks.getOrderStatus.mockResolvedValue({ status: 'delivering', updatedAt: '2026-09-24T00:00:00Z' })
    vi.useFakeTimers()
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByText('付款已确认')).toBeTruthy()
    expect(screen.getByText('订单进度：配送中')).toBeTruthy()
    vi.useRealTimers()
  })
})
