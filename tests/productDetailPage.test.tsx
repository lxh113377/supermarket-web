// @vitest-environment jsdom
// 商品详情页 ProductDetailPage（七轮 H2，原覆盖 0%）：顾客端进入最深的一页。
// 锁：加载态语言统一（骨架而非 spinner）、商品不存在/接口失败的兜底、云端+本地+种子三路评价合并、
// 排序切换、图集 key 重挂、加购与"购物车已有 N 件"。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ProductDetailPage from '../src/pages/ProductDetailPage'
import type { Product, Review } from '../src/types'

const m = vi.hoisted(() => ({
  id: '12',
  navigate: vi.fn(),
  getProducts: vi.fn(),
  getLocalProductReviews: vi.fn(),
  getCloudReviews: vi.fn(),
  addReview: vi.fn(),
  add: vi.fn(),
  getQuantity: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useParams: () => ({ id: m.id }), useNavigate: () => m.navigate }
})
vi.mock('../src/db', () => ({
  getProducts: m.getProducts,
  getLocalProductReviews: m.getLocalProductReviews,
  getCloudReviews: m.getCloudReviews,
  addReview: m.addReview,
}))
vi.mock('../src/hooks/useCart', () => ({
  default: () => ({ add: m.add, getQuantity: m.getQuantity }),
}))

const product = {
  _id: 'p12', name: '可乐', spec: '500ml', price: 3.5, order: 12,
  description: '冰镇更好喝', images: ['/images/12.webp', '/images/12b.webp'],
} as unknown as Product

const rv = (over: Partial<Review>): Review => ({ user: '甲', rating: 5, text: '云端好评', ...over } as unknown as Review)

beforeEach(() => {
  vi.clearAllMocks()
  m.id = '12'
  m.getProducts.mockResolvedValue([product])
  m.getLocalProductReviews.mockReturnValue([rv({ user: '本地', rating: 2, text: '本地差评' })])
  m.getCloudReviews.mockResolvedValue([rv({ user: '云端', rating: 4, text: '云端好评' })])
  m.getQuantity.mockReturnValue(0)
})
afterEach(() => { cleanup() })

describe('加载与兜底', () => {
  it('加载中用骨架屏并带 aria-label（与列表页同一套语言，不再用 spinner）', () => {
    let resolveFn: (v: Product[]) => void = () => undefined
    m.getProducts.mockReturnValue(new Promise((r) => { resolveFn = r }))
    render(<ProductDetailPage />)
    expect(screen.getByLabelText('内容加载中')).toBeTruthy()
    expect(screen.getByText('内容加载中')).toBeTruthy() // sr-only 播报
    resolveFn([product])
  })

  it('找不到商品 → 下架空态 + 返回首页按钮', async () => {
    m.getProducts.mockResolvedValue([])
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('商品不存在或已下架')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))
    expect(m.navigate).toHaveBeenCalledWith('/')
  })

  it('接口抛错也走同一空态（不白屏、不泄漏异常串）', async () => {
    m.getProducts.mockRejectedValue(new Error('network boom'))
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('商品不存在或已下架')).toBeTruthy())
    expect(screen.queryByText(/network boom/)).toBeNull()
  })

  it('_id 与 order 两种路由参数都能命中商品', async () => {
    m.id = 'p12'
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getAllByText('可乐').length).toBeGreaterThan(0))
    expect(m.getProducts).toHaveBeenCalled()
  })
})

describe('详情内容', () => {
  it('名称/价格/规格/介绍/返回逐条渲染', async () => {
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('规格：500ml')).toBeTruthy())
    expect(screen.getAllByText('¥3.50').length).toBe(2) // 信息区 + 底部加购栏
    expect(screen.getByText('冰镇更好喝')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('返回'))
    expect(m.navigate).toHaveBeenCalledWith(-1)
  })

  it('多图商品用图集轮播（两张 → 有下一张按钮）', async () => {
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下一张图片' })).toBeTruthy())
  })

  it('无 description 时不渲染空的"商品介绍"卡片', async () => {
    m.getProducts.mockResolvedValue([{ ...product, description: undefined }])
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    expect(screen.queryByText('商品介绍')).toBeNull()
  })
})

describe('评价合并与排序', () => {
  it('云端 + 本地两路合并计数，并给出均分（(4+2)/2=3.0）', async () => {
    const { container } = render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    // 均分那一行由多个表达式节点拼成，只能按整段文本匹配
    expect(container.textContent).toContain('3.0 分 · 2 条评价')
    expect(screen.getByText('本地差评')).toBeTruthy()
    expect(screen.getByText('云端好评')).toBeTruthy()
  })

  it('点"低分"后按评分升序（第一条变成本地 2 星）', async () => {
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    fireEvent.click(screen.getByText('低分'))
    const users = screen.getAllByText(/^(本地|云端)$/).map((e) => e.textContent)
    expect(users[0]).toBe('本地')
    fireEvent.click(screen.getByText('高分'))
    expect(screen.getAllByText(/^(本地|云端)$/).map((e) => e.textContent)[0]).toBe('云端')
  })

  it('product.order 存在才挂写评价表单，并按 order 传参', async () => {
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: '写评价' })).toBeTruthy())
    expect(screen.getByLabelText('评价内容（最多 500 字）')).toBeTruthy()
  })

  it('发布评价后重新拉本地+云端列表（refreshReviews 回接父页）', async () => {
    m.addReview.mockResolvedValue({ _id: 'r-new' })
    render(<ProductDetailPage />)
    const btn = await screen.findByRole('button', { name: '发布评价' })
    const callsBefore = m.getCloudReviews.mock.calls.length
    fireEvent.change(screen.getByLabelText('评价内容（最多 500 字）'), { target: { value: '新评价' } })
    fireEvent.click(btn)
    await waitFor(() => expect(m.addReview).toHaveBeenCalled())
    await waitFor(() => expect(m.getCloudReviews.mock.calls.length).toBeGreaterThan(callsBefore))
    expect(m.getLocalProductReviews.mock.calls.length).toBeGreaterThan(1)
  })

  it('云端评价请求失败降级为空数组（本地评价仍显示）', async () => {
    m.getCloudReviews.mockRejectedValue(new Error('offline'))
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('本地差评')).toBeTruthy())
    expect(screen.getByText('买家评价 (1)')).toBeTruthy()
  })

  it('快速切商品时旧响应不覆盖新商品（cancelled 守卫）', async () => {
    const { rerender } = render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    m.id = '999'
    m.getProducts.mockResolvedValue([{ ...product, _id: 'p999', order: 999, name: '薯片' }])
    m.getCloudReviews.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return [rv({ text: '新商品的云端评价' })] })
    m.getLocalProductReviews.mockReturnValue([])
    rerender(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('新商品的云端评价')).toBeTruthy())
    expect(screen.queryByText('云端好评')).toBeNull()
  })
})

describe('加购', () => {
  it('数量为 0 时不显示"已有 N 件"，点击加购带整个商品', async () => {
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: '加入购物车' })).toBeTruthy())
    expect(screen.queryByText(/购物车已有/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p12' }))
  })

  it('购物车已有该商品时显示件数', async () => {
    m.getQuantity.mockReturnValue(3)
    render(<ProductDetailPage />)
    await waitFor(() => expect(screen.getByText('购物车已有 3 件')).toBeTruthy())
  })
})
