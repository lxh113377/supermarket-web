// @vitest-environment jsdom
// 起送门槛的前端行为用例（2026-10-22 老大立规「购买物品总价低于六元不配送」）。
//
// 与 tests/minDeliveryParity.test.ts 的分工：那条钉「两侧同值 + 屏上不许各写一个数字」（静态契约），
// 本条钉**用户能看见的行为**：未达标时购物车不出现结算入口并给出差额、确认页阻止提交并播报、
// 达标后一切照旧。服务端那条腿在 scripts/verify-backend.mjs 的三腿探针里。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import CartPage from '../src/pages/CartPage'
import OrderConfirmPage from '../src/pages/OrderConfirmPage'
import { saveCart } from '../src/cart'
import { MIN_DELIVERY_AMOUNT, meetsMinDelivery, minDeliveryGap } from '../src/data/deliveryLimits'

const m = vi.hoisted(() => ({ createOrder: vi.fn(), navigate: vi.fn(), getProducts: vi.fn() }))
vi.mock('../src/db', () => ({ createOrder: m.createOrder, getProducts: m.getProducts }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: true }))
vi.mock('../src/utils/businessHours', () => ({ isBusinessHours: () => true, getClosedMessage: () => '' }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => m.navigate }
})

// 单价用真实种子价（乐事薯片 40g = ¥2.66，db/seed.sql order 33），不随手拍数：
// 1 件 2.66（门槛之下）、3 件 7.98（门槛之上），与 e2e 那条同价同口径。
const CHIP = { productId: 'p_33', name: '乐事薯片', spec: '40g', price: 2.66, quantity: 1, subcategories: ['snacks'] }
const cartN = (n: number) => saveCart({ items: [{ ...CHIP, quantity: n }] })
describe('起送门槛：购物车那一站', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    m.getProducts.mockResolvedValue([])
  })
  afterEach(() => cleanup())

  it('未达标：屏上有「不配送」与差额，且不出现结算入口', async () => {
    cartN(1)
    render(<CartPage />)
    expect(await screen.findByText(/不满 ¥6\.00 不配送/)).toBeTruthy()
    expect(screen.getByText(/再挑 ¥3\.34 即可下单/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去支付' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /起送，去凑单/ }))
    expect(m.navigate).toHaveBeenCalledWith('/shop')
  })

  it('达标（3 件 = ¥7.98）：不再有门槛提示，结算入口照常', async () => {
    cartN(3)
    render(<CartPage />)
    expect(await screen.findByRole('button', { name: '去支付' })).toBeTruthy()
    expect(screen.queryByText(/不配送/)).toBeNull()
  })
})

describe('起送门槛：确认订单页（深链／旧包直接进来那一支）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })
  afterEach(() => cleanup())

  it('未达标：横幅当场告知，填完楼栋房间号点提交仍被阻止并播报', async () => {
    cartN(1)
    render(<OrderConfirmPage />)
    expect(screen.getByText(/不满 ¥6\.00 不配送/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '501' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    // 本仓 vitest 没装 jest-dom ⇒ 不写 toContainText。文案节点有两个（顶部横幅 + 提交拦截的
    // #order-error），所以这里**按 id 取那一个**，而不是 getByText（会因多个命中而红，
    // 与 tests/orderConfirmPayment.test.tsx 用 getByText('请填写楼栋号') 单点命中的情形不同）。
    await waitFor(() => expect(document.getElementById('order-error')).toBeTruthy())
    const errNode = document.getElementById('order-error') as HTMLElement
    expect(errNode.textContent).toMatch(/不满 ¥6\.00 不配送/)
    expect(errNode.textContent).toMatch(/请再挑 ¥3\.34 的商品后再下单/)
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.navigate).not.toHaveBeenCalled()
  })

  it('达标：门槛提示消失，提交正常发出（证明这条不是一律拦）', async () => {
    cartN(3)
    m.createOrder.mockResolvedValue({ id: 'o_gate_ok' })
    render(<OrderConfirmPage />)
    expect(screen.queryByText(/不配送/)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('例如：36栋'), { target: { value: '36栋' } })
    fireEvent.change(screen.getByPlaceholderText('例如：501'), { target: { value: '501' } })
    fireEvent.click(screen.getByRole('button', { name: '确认支付' }))
    await waitFor(() => expect(m.createOrder).toHaveBeenCalledTimes(1))
  })

  it('边界：恰好 ¥6.00 算达标（不误伤「刚好起送」）', () => {
    expect(meetsMinDelivery(6)).toBe(true)
    expect(meetsMinDelivery(MIN_DELIVERY_AMOUNT)).toBe(true)
    expect(minDeliveryGap(6)).toBe(0)
    expect(meetsMinDelivery(5.99)).toBe(false)
  })

  it('浮点尾巴不把「精确 6.00」误判成不足（归一到分再比）', () => {
    // 实测：0.7×6 + 1.8 的 IEEE754 和是 5.999999999999999（真值恰为 6.00）
    // ⇒ 直接 sum >= 6 会把这个刚好起送的购物袋拦下来。
    const sum = 0.7 * 6 + 1.8
    expect(sum < 6).toBe(true) // 前提自证：不归一确实会误判
    expect(meetsMinDelivery(sum)).toBe(true)
    expect(minDeliveryGap(sum)).toBe(0)
  })
})
