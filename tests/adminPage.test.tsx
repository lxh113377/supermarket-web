// AdminPage 测试（对标第五轮 E1：管理壳层 110 句破零）
// 五个子 Tab 全部打桩（各 Tab 逻辑已另有专测），这里只测 AdminPage 自身：
// 数据装载、错误横幅、云端空态种子、tablist 键盘流转、订单增量轮询首拉。
//
// 2026-10-25 视觉 v2：AdminPage 外壳换成 WorkspaceShell，侧栏里有 <Link to="/">，
// 而本文件此前是裸 render(<AdminPage />) ⇒ react-router 的 useContext 为 null ⇒
// 整份 AdminPage 测试 5 条全红（TypeError: Cannot destructure property 'basename' of
// React10.useContext(...) as it is null）。修法是给渲染套一层 MemoryRouter：
// 组件本身没改，是**测试的宿主环境**跟上了外壳的路由依赖。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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

/** 渲染 AdminPage 并提供路由上下文（外壳侧栏含 <Link>，无 Router 会整棵抛错） */
function renderAdmin() {
  return render(<MemoryRouter><AdminPage /></MemoryRouter>)
}

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
    renderAdmin()
    expect(await screen.findByText('云端模式')).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(5)
    expect(tabs[1].getAttribute('aria-selected')).toBe('true') // 默认 products
    await waitFor(() => expect(screen.getByTestId('tab-products').getAttribute('data-count')).toBe('1'))
    expect(h.getAllOrders).toHaveBeenCalledWith({ since: null })
  })

  it('商品读取失败：显式错误横幅（禁静默回退）', async () => {
    h.getAdminProducts.mockRejectedValue(new Error('502'))
    renderAdmin()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('502')
    expect(screen.getByTestId('tab-products').getAttribute('data-count')).toBe('0')
  })

  // 内联两步确认（2026-10-24 替代原生 confirm()）：导入是一次性写库操作，
  // 「只点第一下不会真导入」必须单独测 —— 它是两步确认存在的全部理由。
  it('云端空商品：导入种子走两步确认，第二下才 seedCloudData 并回显结果', async () => {
    h.getAdminProducts.mockResolvedValue([])
    renderAdmin()
    const btn = await screen.findByRole('button', { name: '导入种子数据' })
    fireEvent.click(btn)
    await new Promise((res) => setTimeout(res, 0))
    expect(h.seedCloudData, '第一下就导入 ⇒ 两步确认形同虚设（这是写库操作）').not.toHaveBeenCalled()
    const confirmBtn = await screen.findByRole('button', { name: '确认导入种子数据（仅首次需要）' })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(h.seedCloudData).toHaveBeenCalled())
    expect(await screen.findByText('初始化成功：分类 2 个，商品 55 个')).toBeTruthy()
  })

  it('tablist 键盘右移切到订单 tab 并渲染（增量游标复用）', async () => {
    renderAdmin()
    const productsTab = await screen.findByRole('tab', { name: /商品/ })
    productsTab.focus()
    fireEvent.keyDown(productsTab.closest('[role="tablist"]')!, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByTestId('tab-orders')).toBeTruthy())
    expect(screen.getByTestId('tab-orders').getAttribute('data-count')).toBe('1')
  })

  it('本地演示模式：徽标切换 + 演示提示条', async () => {
    h.cloud = false
    renderAdmin()
    expect(await screen.findByText('本地演示')).toBeTruthy()
    expect(screen.getByText(/数据仅保存在/)).toBeTruthy()
  })
})
