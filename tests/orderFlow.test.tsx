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
  getProducts: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/db', () => ({
  createOrder: mocks.createOrder,
  getOrderById: mocks.getOrderById,
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
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋305' } })
    fireEvent.change(screen.getByPlaceholderText('请输入你的微信号'), { target: { value: 'wx_test' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))

    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledTimes(1))
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      building: '36栋305',
      wechat: 'wx_test',
      items: [expect.objectContaining({ productId: 'p1', quantity: 1 })],
    }))
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/order-success',
      expect.objectContaining({ state: expect.objectContaining({ orderId: 'o1' }) }),
    )
    // 提交成功后购物车清空
    expect(getCart().items).toHaveLength(0)
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

  it('PaymentPage：选微信支付 → 我已付款 → 显示已收到确认', () => {
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    expect(screen.getByAltText('微信支付二维码')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '我已付款' }))
    expect(screen.getByText('已收到你的付款确认')).toBeTruthy()
  })

  it('PaymentPage：轮询到订单 paid 显示付款已确认', async () => {
    mocks.getOrderById.mockResolvedValue({ status: 'paid' })
    vi.useFakeTimers()
    render(<PaymentPage />)
    // 先选支付方式（paid 确认界面仅在 method 选定后渲染）
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    // advanceTimersByTimeAsync 会执行 timer 回调并 flush 其 async 续体（getOrderById → setPaid）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(screen.getByText('付款已确认')).toBeTruthy()
    expect(mocks.getOrderById).toHaveBeenCalledWith('o1')
  })
})
