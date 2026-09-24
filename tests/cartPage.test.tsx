// 购物车页组件测试（对标第三轮 B4：页面层覆盖率棘轮）
// mock ../src/cart 与 ../src/db，验证空态/条目/合计/价格漂移提示/结算跳转。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  cart: { items: [] as unknown[] },
  getCart: vi.fn(),
  saveCart: vi.fn(),
  addToCart: vi.fn(),
  removeFromCart: vi.fn(),
  deleteFromCart: vi.fn(),
  getTotalAmount: vi.fn(),
  getTotalCount: vi.fn(),
  getProducts: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/cart', () => ({
  getCart: mocks.getCart,
  saveCart: mocks.saveCart,
  addToCart: mocks.addToCart,
  removeFromCart: mocks.removeFromCart,
  deleteFromCart: mocks.deleteFromCart,
  getTotalAmount: mocks.getTotalAmount,
  getTotalCount: mocks.getTotalCount,
}))
vi.mock('../src/db', () => ({ getProducts: mocks.getProducts }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: false }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import CartPage from '../src/pages/CartPage'

const item = { _id: 'ci_1', productId: 'p_33', name: '乐事薯片', spec: '70g', price: 5.5, quantity: 2, image: '' }

describe('CartPage 购物车页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCart.mockReturnValue({ items: [] })
    mocks.getTotalAmount.mockReturnValue(0)
    mocks.getTotalCount.mockReturnValue(0)
    mocks.getProducts.mockResolvedValue([])
  })

  it('空车：显示空态与去逛商城引导', async () => {
    render(<CartPage />)
    expect(await screen.findByRole('heading', { name: '购物车' })).toBeTruthy()
    expect(screen.getByText(/空空如也|购物车是空的/)).toBeTruthy()
  })

  it('有车：渲染条目、件数、合计与去支付按钮，点击跳结算', async () => {
    mocks.getCart.mockReturnValue({ items: [item] })
    mocks.getTotalAmount.mockReturnValue(11)
    mocks.getTotalCount.mockReturnValue(2)
    render(<CartPage />)
    expect(await screen.findByText('乐事薯片 (70g)')).toBeTruthy()
    expect(screen.getByText('共 2 件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去支付' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/order-confirm')
  })

  it('价格漂移：现价变化时提示且结算按钮可用（按最新价语义）', async () => {
    mocks.getCart.mockReturnValue({ items: [item] })
    mocks.getTotalAmount.mockReturnValue(11)
    mocks.getTotalCount.mockReturnValue(2)
    mocks.getProducts.mockResolvedValue([{ _id: 'p_33', name: '乐事薯片', spec: '70g', price: 6.0, enabled: true }])
    render(<CartPage />)
    expect(await screen.findByText(/价格已变动/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '去支付' })).toBeTruthy()
  })

  it('数量增减走 addToCart/removeFromCart 回调', async () => {
    mocks.getCart.mockReturnValue({ items: [item] })
    mocks.getTotalAmount.mockReturnValue(11)
    mocks.getTotalCount.mockReturnValue(2)
    // handler 会把返回值写回 cart state：mock 必须返回合法 Cart，否则复渲染即崩
    mocks.addToCart.mockReturnValue({ items: [{ ...item, quantity: 3 }] })
    mocks.removeFromCart.mockReturnValue({ items: [{ ...item, quantity: 1 }] })
    render(<CartPage />)
    const inc = await screen.findByRole('button', { name: /增加乐事薯片/ })
    fireEvent.click(inc)
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /减少乐事薯片/ }))
    await waitFor(() => expect(mocks.removeFromCart).toHaveBeenCalled())
  })
})
