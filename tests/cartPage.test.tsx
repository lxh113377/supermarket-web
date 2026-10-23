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

  // 两行渲染 + 两个控件的接线，分两条用例各点一次：mock 掉的 mutate 会返回"已空"的 cart，
  // 在同一条用例里连点两次会让第二次点击的目标行先消失（那是夹具的假失败，不是产品缺陷）。
  const twoFlavors = () => {
    const cucumber = { _id: 'c1', productId: 'p_flavor', name: '冰红茶', spec: '40g · 黄瓜味', price: 3, quantity: 1, image: '' }
    const lemon = { _id: 'c2', productId: 'p_flavor', name: '冰红茶', spec: '1L · 柠檬味', price: 3, quantity: 1, image: '' }
    mocks.getCart.mockReturnValue({ items: [cucumber, lemon] })
    mocks.deleteFromCart.mockImplementation(() => ({ items: [] }))
    mocks.removeFromCart.mockImplementation(() => ({ items: [] }))
    render(<CartPage />)
    return { cucumber, lemon }
  }

  it('同商品两个口味 ⇒ 购物车渲染成两行（旧代码里第二次选择在上游就被吞，页面拿不到两行）', async () => {
    twoFlavors()
    const labels = () => screen.getAllByRole('button').map((b) => String(b.getAttribute('aria-label') || ''))
    await waitFor(() => expect(labels().filter((l) => l.startsWith('删除')).length).toBe(2))
    expect(labels().join('|')).toContain('黄瓜味')
    expect(labels().join('|')).toContain('柠檬味')
  })

  it('"删除/减号"按 (productId, spec) 精确作用，不得只传 productId（第三十六轮修 A-19）', async () => {
    const { cucumber, lemon } = twoFlavors()
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(3))
    fireEvent.click(screen.getByLabelText('删除冰红茶 (40g · 黄瓜味)'))
    expect(mocks.deleteFromCart).toHaveBeenCalledWith({ items: [cucumber, lemon] }, 'p_flavor', '40g · 黄瓜味')
    const bad = mocks.deleteFromCart.mock.calls.filter((c: unknown[]) => c.length < 3)
    expect(bad, `有 ${bad.length} 次删除没带 spec ⇒ 会连带改动同商品的其它口味行`).toEqual([])
  })

  it('"减号"点柠檬味只动柠檬味那一行', async () => {
    const { cucumber, lemon } = twoFlavors()
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(3))
    fireEvent.click(screen.getByLabelText('减少冰红茶 (1L · 柠檬味)'))
    expect(mocks.removeFromCart).toHaveBeenCalledWith({ items: [cucumber, lemon] }, 'p_flavor', '1L · 柠檬味')
  })

  /**
   * 清空购物车：内联两步确认（2026-10-24 替代原生 confirm()）。
   * 这个按钮原先**完全没有测试** —— 原生 confirm 时代没人测得到它（jsdom 里点一下就会
   * 因为 window.confirm 不存在而抛错，或被桩掉后跳过整段交互）。两步化后它变成纯状态机，
   * 于是「第一下不删」这条最关键的产品语义第一次可测、也必须测。
   */
  const withOneItem = () => {
    mocks.getCart.mockReturnValue({ items: [item] })
    mocks.getTotalAmount.mockReturnValue(11)
    mocks.getTotalCount.mockReturnValue(2)
    render(<CartPage />)
  }

  it('清空：只点第一下进入待确认态，不写空购物车', async () => {
    withOneItem()
    const btn = await screen.findByRole('button', { name: '清空购物车' })
    fireEvent.click(btn)
    await new Promise((res) => setTimeout(res, 0))
    expect(mocks.saveCart, '第一下就清空 ⇒ 两步确认形同虚设').not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '确认清空购物车' })).toBeTruthy()
  })

  it('清空：第二下才真清（saveCart 收到空 items）', async () => {
    withOneItem()
    fireEvent.click(await screen.findByRole('button', { name: '清空购物车' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认清空购物车' }))
    await waitFor(() => expect(mocks.saveCart).toHaveBeenCalledWith({ items: [] }))
  })

  it('清空：待确认态下按 Esc 回退，不写存储', async () => {
    withOneItem()
    fireEvent.click(await screen.findByRole('button', { name: '清空购物车' }))
    await screen.findByRole('button', { name: '确认清空购物车' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await new Promise((res) => setTimeout(res, 0))
    expect(mocks.saveCart, 'Esc 应取消待确认态').not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '清空购物车' })).toBeTruthy()
  })
})
