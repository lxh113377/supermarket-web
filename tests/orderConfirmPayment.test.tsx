// @vitest-environment jsdom
// 六轮 F2：确认订单页 / 支付页**剩余分支**（orderFlow.test.tsx 已覆盖主链路与 paid 轮询，
// 这里补的是此前只能手点验证的角落：非营业时间、空车、截图上传三道闸、支付宝提示弹窗、
// 订单被取消、无订单号兜底、返回路径）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import OrderConfirmPage from '../src/pages/OrderConfirmPage'
import PaymentPage from '../src/pages/PaymentPage'
import { saveCart } from '../src/cart'

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  getOrderStatus: vi.fn(),
  navigate: vi.fn(),
  compress: vi.fn(),
  open: true,
  locationState: { orderId: 'o9', totalAmount: 12 } as Record<string, unknown> | null,
}))

vi.mock('../src/db', () => ({ createOrder: m.createOrder, getOrderStatus: m.getOrderStatus }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: true }))
vi.mock('../src/utils/imageCompress', () => ({ compressImageFile: m.compress }))
vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: () => m.open,
  getClosedMessage: () => '营业时间 09:00-21:00',
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => m.navigate,
    useLocation: () => ({ state: m.locationState, search: '', hash: '', pathname: '/', key: 'k' }),
  }
})

const cartOne = () => saveCart({ items: [{ productId: 'p1', name: '可乐', price: 3.5, quantity: 1, spec: '' }] })

const pickFile = (file: File | undefined) => {
  const input = screen.getByLabelText('选择付款截图')
  fireEvent.change(input, { target: { files: file ? [file] : [] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  m.open = true
  m.locationState = { orderId: 'o9', totalAmount: 12 }
})
afterEach(() => {
  cleanup()
})

describe('OrderConfirmPage 剩余分支', () => {
  it('非营业时间：顶部提示 + 按钮改文案，仍可强制下单', async () => {
    m.open = false
    cartOne()
    m.createOrder.mockResolvedValue({ id: 'o1' })
    render(<OrderConfirmPage />)
    expect(screen.getByText('营业时间 09:00-21:00')).toBeTruthy()
    const btn = screen.getByRole('button', { name: '非营业时间 - 仍要下单' })
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '305' } })
    fireEvent.click(btn)
    await waitFor(() => expect(m.createOrder).toHaveBeenCalledTimes(1))
    expect(m.navigate).toHaveBeenCalledWith('/order-success', expect.objectContaining({ state: expect.objectContaining({ orderId: 'o1' }) }))
  })

  it('购物车为空时阻止提交（防止只填地址打出空单）', async () => {
    localStorage.setItem('sm_cart', JSON.stringify({ items: [] }))
    render(<OrderConfirmPage />)
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '305' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    await waitFor(() => expect(screen.getByText('购物车为空')).toBeTruthy())
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  it('校验失败的输入框带 aria-invalid 并指向错误文案节点', async () => {
    cartOne()
    render(<OrderConfirmPage />)
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    await waitFor(() => expect(screen.getByText('请填写楼栋号')).toBeTruthy())
    const building = screen.getByLabelText(/楼栋号/)
    expect(building.getAttribute('aria-invalid')).toBe('true')
    expect(building.getAttribute('aria-describedby')).toBe('order-error')
    expect(screen.getByText('请填写楼栋号').id).toBe('order-error')
  })

  it('截图三道闸：未选文件忽略 / 超过 5MB 拒绝 / 压缩失败提示', async () => {
    cartOne()
    render(<OrderConfirmPage />)
    pickFile(undefined)
    expect(m.compress).not.toHaveBeenCalled()

    const big = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 })
    pickFile(big)
    await waitFor(() => expect(screen.getByText('图片不能超过 5MB')).toBeTruthy())
    expect(m.compress).not.toHaveBeenCalled()

    m.compress.mockRejectedValueOnce(new Error('decode fail'))
    pickFile(new File(['ok'], 'a.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByText('图片处理失败')).toBeTruthy())
  })

  it('截图成功 → 预览与删除；提交时随单带上 paymentScreenshot', async () => {
    cartOne()
    m.compress.mockResolvedValue({ dataUrl: 'data:image/webp;base64,AAA' })
    m.createOrder.mockResolvedValue({ id: 'o2' })
    render(<OrderConfirmPage />)
    pickFile(new File(['ok'], 'a.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByAltText('转账截图')).toBeTruthy())
    expect(m.compress).toHaveBeenCalledWith(expect.anything(), { maxSize: 800, quality: 0.6 })

    fireEvent.click(screen.getByLabelText('删除付款截图'))
    expect(screen.queryByAltText('转账截图')).toBeNull()

    pickFile(new File(['ok'], 'a.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByAltText('转账截图')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '305' } })
    fireEvent.change(screen.getByPlaceholderText('选填，有其他需求可以写在这里'), { target: { value: '放门口' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    await waitFor(() => expect(m.createOrder).toHaveBeenCalledTimes(1))
    expect(m.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      paymentScreenshot: 'data:image/webp;base64,AAA',
      remark: '放门口',
    }))
  })

  it('顶栏返回走 history.back', () => {
    cartOne()
    render(<OrderConfirmPage />)
    fireEvent.click(screen.getByLabelText('返回'))
    expect(m.navigate).toHaveBeenCalledWith(-1)
  })
})

describe('PaymentPage 剩余分支', () => {
  it('无订单号（直接输入 URL / 会话已清）→ 重定向回首页且不渲染支付界面', async () => {
    m.locationState = null
    const { container } = render(<PaymentPage />)
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(container.firstChild).toBeNull()
  })

  it('刷新后 location.state 丢失 → 从 sessionStorage 续上订单号与金额', async () => {
    m.locationState = null
    sessionStorage.setItem('sm_payment_order', 'o77')
    sessionStorage.setItem('sm_payment_amount', '33.5')
    render(<PaymentPage />)
    expect(m.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    expect(screen.getByText('¥33.50')).toBeTruthy()
    expect(screen.getByLabelText('返回')).toBeTruthy()
  })

  it('支付宝分支：二维码换支付宝图 + 弹温馨提示，关闭后仍在支付宝视图', async () => {
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '支付宝付款' }))
    expect(screen.getByAltText('支付宝二维码')).toBeTruthy()
    expect(screen.getByText('温馨提示')).toBeTruthy()
    expect(screen.getByText(/支付宝付款请告知商家/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }))
    await waitFor(() => expect(screen.queryByText('温馨提示')).toBeNull())
    expect(screen.getByAltText('支付宝二维码')).toBeTruthy()
  })

  it('「返回重新选择」回到方式选择；顶栏返回直接去成功页', () => {
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    fireEvent.click(screen.getByRole('button', { name: '返回重新选择' }))
    expect(screen.getByRole('button', { name: '支付宝付款' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('返回'))
    expect(m.navigate).toHaveBeenCalledWith('/order-success', { state: { orderId: 'o9' } })
  })

  it('轮询到 cancelled → 明确告知订单已取消（不再显示二维码）', async () => {
    m.getOrderStatus.mockResolvedValue({ status: 'cancelled' })
    vi.useFakeTimers()
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByText('该订单已取消')).toBeTruthy()
    expect(screen.queryByAltText('微信支付二维码')).toBeNull()
    vi.useRealTimers()
  })

  it('轮询返回 pending 或抛错时保持待支付视图（不误报已付款）', async () => {
    m.getOrderStatus.mockRejectedValue(new Error('offline'))
    vi.useFakeTimers()
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByAltText('微信支付二维码')).toBeTruthy()
    expect(screen.queryByText('付款已确认')).toBeNull()
    vi.useRealTimers()
  })

  it('金额为 0（异常入口）时不渲染 ¥0 价格行', () => {
    m.locationState = { orderId: 'o9', totalAmount: 0 }
    sessionStorage.setItem('sm_payment_amount', '0')
    render(<PaymentPage />)
    fireEvent.click(screen.getByRole('button', { name: '微信支付' }))
    expect(screen.queryByText('¥0.00')).toBeNull()
  })
})
