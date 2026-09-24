// AdminPage 测试（对标第五轮 E1：管理壳层 110 句破零）
// 五个子 Tab 全部打桩（各 Tab 逻辑已另有专测），这里只测 AdminPage 自身：
// 数据装载、错误横幅、云端空态种子、tablist 键盘流转、订单增量轮询首拉。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  cloud: true,
  getCategories: vi.fn(),
  getAdminProducts: vi.fn(),
  seedCloudData: vi.fn(),
  getAllOrders: vi.fn(),
}))

vi.mock('../src/cloudbase', () => ({ get IS_CLOUD() { return h.cloud } }))
vi.mock('../src/db', () => ({
  getCategories: h.getCategories,
  getAdminProducts: h.getAdminProducts,
  seedCloudData: h.seedCloudData,
  getAllOrders: h.getAllOrders,
}))
vi.mock('../src/components/DashboardTab', () => ({ default: () => <div data-testid="tab-dashboard" /> }))
vi.mock('../src/components/ProductsTab', () => ({
  default: ({ products }: { products: unknown[] }) => <div data-testid="tab-products" data-count={products.length} />,
}))
vi.mock('../src/components/OrdersTab', () => ({
  default: ({ orders }: { orders: unknown[] }) => <div data-testid="tab-orders" data-count={orders.length} />,
}))
vi.mock('../src/components/ReviewsTab', () => ({ default: () => <div data-testid="tab-reviews" /> }))
vi.mock('../src/components/SubmissionsTab', () => ({ default: () => <div data-testid="tab-submissions" /> }))

import AdminPage from '../src/pages/AdminPage'

const order = { _id: 'o_1', roomNumber: '501', items: [], totalAmount: 3, status: 'pending', createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z' }

describe('AdminPage 管理壳', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.cloud = true
    h.getCategories.mockResolvedValue([{ _id: 'c1', name: '饮品', subcategories: [], order: 1 }])
    h.getAdminProducts.mockResolvedValue([{ _id: 'p1', name: '可乐', price: 3, enabled: true }])
    h.getAllOrders.mockResolvedValue({ orders: [order], maxUpdatedAt: order.updatedAt })
    h.seedCloudData.mockResolvedValue({ categories: 2, products: 55 })
  })

  it('云端模式：徽标、5 个 tab、默认商品 tab 拿到数据、订单首拉全量', async () => {
    render(<AdminPage />)
    expect(await screen.findByText('云端模式')).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(5)
    expect(tabs[1].getAttribute('aria-selected')).toBe('true') // 默认 products
    await waitFor(() => expect(screen.getByTestId('tab-products').getAttribute('data-count')).toBe('1'))
    expect(h.getAllOrders).toHaveBeenCalledWith({ since: null })
  })

  it('商品读取失败：显式错误横幅（禁静默回退）', async () => {
    h.getAdminProducts.mockRejectedValue(new Error('502'))
    render(<AdminPage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('502')
    expect(screen.getByTestId('tab-products').getAttribute('data-count')).toBe('0')
  })

  it('云端空商品：出现"导入种子数据"，confirm 后 seedCloudData 并回显结果', async () => {
    h.getAdminProducts.mockResolvedValue([])
    vi.stubGlobal('confirm', () => true)
    render(<AdminPage />)
    const btn = await screen.findByRole('button', { name: '导入种子数据' })
    fireEvent.click(btn)
    await waitFor(() => expect(h.seedCloudData).toHaveBeenCalled())
    expect(await screen.findByText('初始化成功：分类 2 个，商品 55 个')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('tablist 键盘右移切到订单 tab 并渲染（增量游标复用）', async () => {
    render(<AdminPage />)
    const productsTab = await screen.findByRole('tab', { name: /商品/ })
    productsTab.focus()
    fireEvent.keyDown(productsTab.closest('[role="tablist"]')!, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByTestId('tab-orders')).toBeTruthy())
    expect(screen.getByTestId('tab-orders').getAttribute('data-count')).toBe('1')
  })

  it('本地演示模式：徽标切换 + 演示提示条', async () => {
    h.cloud = false
    render(<AdminPage />)
    expect(await screen.findByText('本地演示')).toBeTruthy()
    expect(screen.getByText(/数据仅保存在浏览器中/)).toBeTruthy()
  })
})
