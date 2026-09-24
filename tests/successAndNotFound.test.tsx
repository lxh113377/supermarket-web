// @vitest-environment jsdom
// 成功页 + 404 页单测（六轮 G 批，两文件原覆盖 0%）
// 成功页的重点是"下单后顾客能不能自己找到订单号"：跨导航兜底键、复制、查询入口。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import OrderSuccessPage from '../src/pages/OrderSuccessPage'
import NotFoundPage from '../src/pages/NotFoundPage'

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  state: { building: '36栋', room: '501', orderId: 'o_abc', totalAmount: 12.5 } as Record<string, unknown> | null,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => m.navigate, useLocation: () => ({ state: m.state, search: '', hash: '', pathname: '/', key: 'k' }) }
})

const writeText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  m.state = { building: '36栋', room: '501', orderId: 'o_abc', totalAmount: 12.5 }
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => { cleanup() })

describe('OrderSuccessPage', () => {
  it('展示楼栋/房间/金额/订单号，并把单号写进跨导航兜底键', () => {
    render(<OrderSuccessPage />)
    expect(screen.getByText('下单成功！')).toBeTruthy()
    expect(screen.getByText('36栋')).toBeTruthy()
    expect(screen.getByText('501')).toBeTruthy()
    expect(screen.getByText('¥12.50')).toBeTruthy()
    expect(screen.getByText(/订单号：o_abc/)).toBeTruthy()
    expect(sessionStorage.getItem('sm_query_order')).toBe('o_abc')
  })

  it('去支付带上订单号与金额；继续选购回首页', () => {
    render(<OrderSuccessPage />)
    fireEvent.click(screen.getByRole('button', { name: '去支付' }))
    expect(m.navigate).toHaveBeenCalledWith('/payment', { state: { orderId: 'o_abc', totalAmount: 12.5 } })
    fireEvent.click(screen.getByRole('button', { name: '继续选购' }))
    expect(m.navigate).toHaveBeenCalledWith('/')
  })

  it('复制订单号成功→「已复制 ✓」，失败→按钮文案不变（不假装成功）', async () => {
    writeText.mockResolvedValueOnce(undefined)
    render(<OrderSuccessPage />)
    fireEvent.click(screen.getByRole('button', { name: '复制订单号' }))
    expect(writeText).toHaveBeenCalledWith('o_abc')
    await waitFor(() => expect(screen.getByText('已复制 ✓')).toBeTruthy())
    cleanup()

    writeText.mockRejectedValueOnce(new Error('clipboard blocked'))
    render(<OrderSuccessPage />)
    fireEvent.click(screen.getByRole('button', { name: '复制订单号' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '复制订单号' })).toBeTruthy()
  })

  it('查询入口带着单号跳查询页', () => {
    render(<OrderSuccessPage />)
    fireEvent.click(screen.getByRole('button', { name: '查询订单状态' }))
    expect(m.navigate).toHaveBeenCalledWith('/order-query', { state: { orderId: 'o_abc' } })
  })

  it('无单号/无地址的裸 state（旧链接直达）→ 不渲染单号区与复制/查询按钮，也不写兜底键', () => {
    m.state = null
    render(<OrderSuccessPage />)
    expect(screen.getByText('下单成功！')).toBeTruthy()
    expect(screen.queryByText(/订单号：/)).toBeNull()
    expect(screen.queryByRole('button', { name: '复制订单号' })).toBeNull()
    expect(screen.queryByRole('button', { name: '查询订单状态' })).toBeNull()
    expect(sessionStorage.getItem('sm_query_order')).toBeNull()
  })
})

describe('NotFoundPage', () => {
  it('渲染 404 说明并可返回首页', () => {
    render(<NotFoundPage />)
    expect(screen.getByText('页面走丢了')).toBeTruthy()
    expect(screen.getByText('404')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))
    expect(m.navigate).toHaveBeenCalledWith('/')
  })
})
