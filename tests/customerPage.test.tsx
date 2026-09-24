// CustomerPage 商城页测试
// 阶段一重构后筛选态以 URL 为唯一真相，故本文件走真实 MemoryRouter + 路由表，
// 不再 mock useNavigate/useLocation（mock 掉就等于测不到深链）。
// db / cloudbase / prefetchBus 仍打桩。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => ({
  getCategories: vi.fn(),
  getProducts: vi.fn(),
}))

vi.mock('../src/db', () => ({ getCategories: h.getCategories, getProducts: h.getProducts }))
vi.mock('../src/cloudbase', () => ({ IS_CLOUD: false }))
vi.mock('../src/prefetchBus', () => ({ prefetchRoute: vi.fn() }))

import CustomerPage from '../src/pages/CustomerPage'

const cats = [
  {
    _id: 'drinks', name: '饮品', type: '', order: 1,
    subcategories: [{ id: 'sweet', name: '甜口' }, { id: 'water', name: '矿泉水' }],
  },
  {
    _id: 'food', name: '食品', type: '', order: 2,
    subcategories: [{ id: 'snacks', name: '零食' }, { id: 'filling', name: '垫腹' }],
  },
]

const pWater = { _id: 'p1', name: '农夫山泉', spec: '550ml', price: 2, order: 1, enabled: true, subcategories: ['water'] }
const pCola = { _id: 'p2', name: '可乐', spec: '500ml', price: 3.5, order: 2, enabled: true, subcategories: ['sweet'] }
const pSnack = { _id: 'p3', name: '薯片', spec: '70g', price: 4.5, order: 3, enabled: true, subcategories: ['snacks'] }
const pFill = { _id: 'p4', name: '面包', spec: '袋装', price: 5.5, order: 4, enabled: true, subcategories: ['filling'] }

let lastLoc = ''
// 在 effect 里记录而非渲染期赋值：渲染期写模块级变量是 react(globals) 判定的副作用
function LocationSpy() {
  const l = useLocation()
  useEffect(() => { lastLoc = l.pathname + l.search })
  return null
}

function renderShop(path = '/shop') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationSpy />
      <Routes>
        <Route path="/shop/:categoryId?/:subId?" element={<CustomerPage />} />
        <Route path="/cart" element={<div>购物车页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CustomerPage 商城页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    lastLoc = ''
    h.getCategories.mockResolvedValue(cats)
    h.getProducts.mockResolvedValue([pWater, pCola, pSnack, pFill])
  })

  it('加载完成后渲染商品卡片；loading 期出骨架', async () => {
    let resolve: (v: unknown[]) => void = () => {}
    h.getProducts.mockImplementation(() => new Promise((r) => { resolve = r }))
    renderShop()
    // 骨架阶段不出现商品名
    expect(screen.queryByText(/农夫山泉/)).toBeNull()
    // 分类导航在目录到达前出骨架占位，而不是整条消失后重新挂载
    expect(document.querySelectorAll('.skeleton-shimmer').length).toBeGreaterThan(0)
    resolve([pWater, pCola, pSnack, pFill])
    expect(await screen.findByText(/农夫山泉/)).toBeTruthy()
    expect(screen.getByText(/可乐/)).toBeTruthy()
  })

  it('默认落在第一个分类，页头与导航高亮同一件事', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    // 页头文字与导航选中态各出现一次「饮品」，两处必须一致（此前页头恒显「全部商品」）
    expect(screen.getAllByText('饮品').length).toBe(2)
    expect(screen.getByRole('button', { name: '切换到饮品分类' }).getAttribute('aria-pressed')).toBe('true')
    // 食品分类下的商品不该混进饮品视图
    expect(screen.queryByText(/薯片/)).toBeNull()
  })

  it('价格升/降排序切换改变卡片顺序', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '价格↑' }))
    await waitFor(() => {
      expect(screen.getAllByText(/农夫山泉|可乐/)[0].textContent).toContain('农夫山泉')
    })
    fireEvent.click(screen.getByRole('button', { name: '价格↓' }))
    await waitFor(() => {
      expect(screen.getAllByText(/农夫山泉|可乐/)[0].textContent).toContain('可乐')
    })
  })

  it('搜索：命中过滤到 1 条；无结果给空态文案', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '搜索商品' }))
    const input = screen.getByLabelText('搜索商品名称')
    fireEvent.change(input, { target: { value: '可乐' } })
    await waitFor(() => expect(screen.queryByText(/农夫山泉 \(550ml\)/)).toBeNull())
    fireEvent.change(input, { target: { value: '不存在词999' } })
    expect(await screen.findByText(/未找到「不存在词999」相关商品/)).toBeTruthy()
  })

  it('加购：toast 播报 + 浮球计数，点击浮球真路由进购物车', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '添加农夫山泉' }))
    expect(await screen.findByText('已添加 农夫山泉')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /查看购物车，共 1 件/ }))
    expect(await screen.findByText('购物车页')).toBeTruthy()
  })

  it('减数量同样有页面级播报（替代每卡一个 live region）', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '添加农夫山泉' }))
    await screen.findByText('已添加 农夫山泉')
    fireEvent.click(screen.getByRole('button', { name: '减少农夫山泉' }))
    expect(await screen.findByText('已减少 农夫山泉')).toBeTruthy()
  })

  it('加载失败：错误态 + 重试恢复', async () => {
    h.getProducts.mockRejectedValueOnce(new Error('down'))
    renderShop()
    expect(await screen.findByText(/加载数据失败：down/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText(/农夫山泉/)).toBeTruthy()
  })

  it('排序选中态可被辅助技术读出（aria-pressed），且整组有组名', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    expect(screen.getByRole('group', { name: '商品排序方式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '默认' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '价格↑' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '价格↑' }))
    expect(screen.getByRole('button', { name: '价格↑' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '默认' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('结果计数随筛选/搜索/排序改写（文案与实际行为一致）', async () => {
    renderShop()
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
      { _id: 'p6', name: '康师傅冰红茶', spec: '1L', price: 3.66, order: 6, enabled: true, subcategories: ['sweet'] },
      { _id: 'p22', name: '有糖可乐', spec: '罐装330ml', price: 2.66, order: 22, enabled: true, subcategories: ['sweet'] },
    ])
    renderShop()
    expect(await screen.findByText('8 种规格')).toBeTruthy()
    expect(screen.getAllByText(/种规格/).length).toBe(1) // 只有变体组那条带角标
    const cardOf = (n: string) => screen.getByText(n).closest('p')!
    expect(cardOf('3.66').textContent).toContain('¥')
    expect(cardOf('3.66').textContent).toContain('8 种规格')
    expect(cardOf('2.66').textContent).not.toContain('种规格')
  })

  // ---- 阶段一新增：筛选态以 URL 为唯一真相 ----

  it('深链 /shop/food/snacks 直达零食页，只出零食商品', async () => {
    renderShop('/shop/food/snacks')
    await screen.findByText(/薯片/)
    expect(screen.queryByText(/农夫山泉/)).toBeNull()
    expect(screen.queryByText(/面包/)).toBeNull()
    expect(screen.getByRole('button', { name: '切换到零食分类' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/^共 1 件$/)).toBeTruthy()
  })

  it('点分类/子分类会把选择写进 URL（可分享可刷新）', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    fireEvent.click(screen.getByRole('button', { name: '切换到食品分类' }))
    await waitFor(() => expect(lastLoc).toBe('/shop/food'))
    fireEvent.click(screen.getByRole('button', { name: '切换到垫腹分类' }))
    await waitFor(() => expect(lastLoc).toBe('/shop/food/filling'))
    expect(screen.getByText(/面包/)).toBeTruthy()
  })

  it('排序与搜索写进 query，非法 sort 归零为默认', async () => {
    renderShop('/shop/drinks?sort=bogus')
    await screen.findByText(/农夫山泉/)
    expect(screen.getByRole('button', { name: '默认' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '价格↓' }))
    await waitFor(() => expect(lastLoc).toBe('/shop/drinks?sort=price-desc'))
  })

  it('未知分类回落第一个分类，而不是渲染一个骗人的空列表', async () => {
    renderShop('/shop/nope')
    await screen.findByText(/农夫山泉/)
    expect(screen.queryByText(/暂无该类商品/)).toBeNull()
    expect(screen.getByRole('button', { name: '切换到饮品分类' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('子分类不属于当前分类时按「全部」处理，不空列表', async () => {
    renderShop('/shop/drinks/snacks')
    await screen.findByText(/农夫山泉/)
    expect(screen.getByText(/可乐/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '显示全部商品' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('live region 收敛到页面级：整页只有 2 个，而不是每张商品卡一个', async () => {
    renderShop()
    await screen.findByText(/农夫山泉/)
    expect(document.querySelectorAll('[aria-live]').length).toBe(2)
  })
})
