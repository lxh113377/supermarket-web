// CustomerPage 测试（对标第五轮 E1：顾客商城页 104 句破零）
// useProducts/useCart 用真实 hook（db 层打桩），路由/prefetch 打桩；
// 覆盖：加载→列表、搜索过滤与空结果、价格排序、加购 toast 与浮球、错误重试。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getProducts: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/db', () => ({ getCategories: h.getCategories, getProducts: h.getProducts }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: false }))
vi.mock('../src/prefetchBus', () => ({ prefetchRoute: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => h.navigate, useLocation: () => ({ state: null }) }
})

import CustomerPage from '../src/pages/CustomerPage'

const cats = [{ _id: 'c1', name: '饮品', type: '', order: 1, subcategories: [{ id: 's1', name: '水' }] }]
const pCheap = { _id: 'p1', name: '农夫山泉', spec: '550ml', price: 2, order: 1, enabled: true, subcategories: ['s1'] }
const pDear = { _id: 'p2', name: '可乐', spec: '500ml', price: 3.5, order: 2, enabled: true, subcategories: ['s1'] }

describe('CustomerPage 商城页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    h.getCategories.mockResolvedValue(cats)
    h.getProducts.mockResolvedValue([pCheap, pDear])
  })

  it('加载完成后渲染商品卡片；loading 期出骨架', async () => {
    let resolve: (v: unknown[]) => void = () => {}
    h.getProducts.mockImplementation(() => new Promise((r) => { resolve = r }))
    render(<CustomerPage />)
    // 骨架阶段不出现商品名
    expect(screen.queryByText(/农夫山泉/)).toBeNull()
    resolve([pCheap, pDear])
    expect(await screen.findByText(/农夫山泉/)).toBeTruthy()
    expect(screen.getByText(/可乐/)).toBeTruthy()
  })

  it('价格升/降排序切换改变卡片顺序', async () => {
    render(<CustomerPage />)
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '价格↑' }))
    await waitFor(() => {
      const order1 = screen.getAllByText(/农夫山泉|可乐/).map((e) => e.textContent)
      expect(order1[0]).toContain('农夫山泉')
    })
    fireEvent.click(screen.getByRole('button', { name: '价格↓' }))
    await waitFor(() => {
      const order2 = screen.getAllByText(/农夫山泉|可乐/).map((e) => e.textContent)
      expect(order2[0]).toContain('可乐')
    })
  })

  it('搜索：命中过滤到 1 条；无结果给空态文案', async () => {
    render(<CustomerPage />)
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '搜索商品' }))
    const input = screen.getByLabelText('搜索商品名称')
    fireEvent.change(input, { target: { value: '可乐' } })
    await waitFor(() => expect(screen.queryByText(/农夫山泉 \(550ml\)/)).toBeNull())
    fireEvent.change(input, { target: { value: '不存在词999' } })
    expect(await screen.findByText(/未找到「不存在词999」相关商品/)).toBeTruthy()
  })

  it('加购：toast 播报 + 浮球计数，点击浮球进购物车', async () => {
    render(<CustomerPage />)
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '添加农夫山泉' }))
    expect(await screen.findByText('已添加 农夫山泉')).toBeTruthy()
    const fab = await screen.findByRole('button', { name: /查看购物车，共 1 件/ })
    fireEvent.click(fab)
    expect(h.navigate).toHaveBeenCalledWith('/cart')
  })

  it('加载失败：错误态 + 重试恢复', async () => {
    h.getProducts.mockRejectedValueOnce(new Error('down'))
    render(<CustomerPage />)
    expect(await screen.findByText(/加载数据失败：down/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText(/农夫山泉/)).toBeTruthy()
  })

  it('排序选中态可被辅助技术读出（aria-pressed），且整组有组名', async () => {
    render(<CustomerPage />)
    await screen.findByText(/农夫山泉/)
    const group = screen.getByRole('group', { name: '商品排序方式' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: '默认' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '价格↑' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '价格↑' }))
    expect(screen.getByRole('button', { name: '价格↑' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '默认' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('结果计数随筛选/搜索/排序改写（文案与实际行为一致）', async () => {
    render(<CustomerPage />)
    // 页面上 role=status 有两个（加购 toast 容器与本计数区），故按文本定位
    const counter = async () => (await screen.findByText(/^共 \d+ 件/)).textContent
    expect(await counter()).toBe('共 2 件')
    fireEvent.click(screen.getByRole('button', { name: '价格↑' }))
    await waitFor(() => expect(counter()).resolves.toContain('按价格升序'))
    fireEvent.click(screen.getByRole('button', { name: '搜索商品' }))
    fireEvent.change(screen.getByLabelText('搜索商品名称'), { target: { value: '可乐' } })
    await waitFor(() => expect(counter()).resolves.toContain('共 1 件'))
    await waitFor(() => expect(counter()).resolves.toContain('匹配「可乐」'))
  })

  it('属于演示变体组的商品卡标出规格数；不带的商品不凭空长出一个规格', async () => {
    // order 6 = 康师傅冰红茶，真实落在「康师傅 1L 茶饮 · 口味」组（8 条真实记录）
    // order 22 = 有糖可乐，不在任何演示变体组里
    h.getProducts.mockResolvedValue([
      { _id: 'p6', name: '康师傅冰红茶', spec: '1L', price: 3.66, order: 6, enabled: true, subcategories: ['s1'] },
      { _id: 'p22', name: '有糖可乐', spec: '罐装330ml', price: 2.66, order: 22, enabled: true, subcategories: ['s1'] },
    ])
    render(<CustomerPage />)
    expect(await screen.findByText('8 种规格')).toBeTruthy()
    expect(screen.getAllByText(/种规格/).length).toBe(1) // 只有变体组那条带角标
    // 卡面价 = 本条记录的真实单价（¥ 符号在嵌套 span 内，故按直接文本 3.66 / 2.66 定位）
    const cardOf = (n: string) => screen.getByText(n).closest('p')!
    expect(cardOf('3.66').textContent).toContain('¥')
    expect(cardOf('3.66').textContent).toContain('8 种规格')
    expect(cardOf('2.66').textContent).not.toContain('种规格') // 无变体组 → 不凭空长出角标
  })
})
