// @vitest-environment jsdom
// 商品详情页 ProductDetailPage（七轮 H2，原覆盖 0%）：顾客端进入最深的一页。
// 锁：加载态语言统一（骨架而非 spinner）、商品不存在/接口失败的兜底、云端+本地+种子三路评价合并、
// 排序切换、图集 key 重挂、加购与"购物车已有 N 件"。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProductDetailPage from '../src/pages/ProductDetailPage'
import type { Product, Review } from '../src/types'

const m = vi.hoisted(() => ({
  id: '12',
  navigate: vi.fn(),
  getProducts: vi.fn(),
  getCategories: vi.fn(),
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
  getCategories: m.getCategories,
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

const seedRv = (over: Partial<Review>): Review => ({ user: '本地', rating: 2, text: '本地差评', ...over } as unknown as Review)
const cloudRv = (over: Partial<Review>): Review => ({ user: '云端', rating: 4, text: '云端好评', ...over } as unknown as Review)

beforeEach(() => {
  vi.clearAllMocks()
  m.id = '12'
  m.getProducts.mockResolvedValue([product])
  // 详情页参数表要真实分类名，与商品并批拉取（Promise.all）——
  // 少 mock 这一个会让整批抛错被 catch，页面直接判「商品不存在」
  m.getCategories.mockResolvedValue([
    { _id: 'drinks', name: '饮品', type: 'drink', order: 1, subcategories: [{ id: 'soda', name: '碳酸', order: 5 }] },
  ])
  m.getLocalProductReviews.mockReturnValue([seedRv({})])
  m.getCloudReviews.mockResolvedValue([cloudRv({})])
  m.getQuantity.mockReturnValue(0)
})
afterEach(() => { cleanup() })

describe('加载与兜底', () => {
  it('加载中用骨架屏并带 aria-label（与列表页同一套语言，不再用 spinner）', () => {
    let resolveFn: (v: Product[]) => void = () => undefined
    m.getProducts.mockReturnValue(new Promise((r) => { resolveFn = r }))
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    expect(screen.getByLabelText('内容加载中')).toBeTruthy()
    expect(screen.getByText('内容加载中')).toBeTruthy() // sr-only 播报
    resolveFn([product])
  })

  it('找不到商品 → 下架空态 + 返回首页按钮', async () => {
    m.getProducts.mockResolvedValue([])
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('商品不存在或已下架')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }))
    expect(m.navigate).toHaveBeenCalledWith('/')
  })

  it('接口抛错也走同一空态（不白屏、不泄漏异常串）', async () => {
    m.getProducts.mockRejectedValue(new Error('network boom'))
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('商品不存在或已下架')).toBeTruthy())
    expect(screen.queryByText(/network boom/)).toBeNull()
  })

  it('_id 与 order 两种路由参数都能命中商品', async () => {
    m.id = 'p12'
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('可乐').length).toBeGreaterThan(0))
    expect(m.getProducts).toHaveBeenCalled()
  })

  /**
   * 跨环境可寻址：_id 命名按来源不同（本地 p_<order>、D1 种子 p001 式、管理端随机串），
   * 从某一环境复制出来的链接在另一环境里必须还能落到同一商品，而不是白屏式 404。
   */
  it.each(['p12', 'p_12', 'p-12', 'p012', 'P0012', '12', '012'])(
    '参数 %s 都能归一到 order 12 命中同一商品', async (id) => {
      m.id = id
      render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
      await waitFor(() => expect(screen.getAllByText('可乐').length).toBeGreaterThan(0))
      expect(screen.queryByText(/商品不存在或已下架/)).toBeNull()
    })

  it('管理端随机 _id 不得被剥数字后静默命中别的商品', async () => {
    // 目录里放一条 order=1 的商品：若归一实现是"一律剥掉非数字"，
    // p_mufyndudcyu1ji 会缩成 "1" 并静默渲染出冰糖雪梨 —— 那比报「商品不存在」糟糕得多。
    // 这条用例就是用来钉住"归一只认形如 order 的 id"的。
    m.getProducts.mockResolvedValue([
      product,
      { _id: 'p1', name: '冰糖雪梨', spec: '1L', price: 3.5, order: 1 } as unknown as Product,
    ])
    m.id = 'p_mufyndudcyu1ji'
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText(/商品不存在或已下架/)).toBeTruthy())
    expect(screen.queryByText('冰糖雪梨')).toBeNull()
    expect(screen.queryByText('可乐')).toBeNull()
  })

  it('纯数字参数按 order 命中，非商品 id 的乱码不给归一', async () => {
    m.getProducts.mockResolvedValue([
      product,
      { _id: 'p1', name: '冰糖雪梨', spec: '1L', price: 3.5, order: 1 } as unknown as Product,
    ])
    m.id = '1'
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('冰糖雪梨').length).toBeGreaterThan(0))
  })
})

describe('详情内容', () => {
  it('名称/价格/规格/介绍/返回逐条渲染', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('规格：500ml')).toBeTruthy())
    // 两处：右栏主价 / 商品参数表「单价」行（吸底栏按视口条件渲染，jsdom 里不出现）
    expect(screen.getAllByText('¥3.50').length).toBe(2)
    expect(screen.getByText('冰镇更好喝')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('返回'))
    expect(m.navigate).toHaveBeenCalledWith(-1)
  })

  it('多图商品用图集轮播（两张 → 有下一张按钮）', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '下一张图片' })).toBeTruthy())
  })

  it('无 description 时不渲染空的"商品介绍"卡片', async () => {
    m.getProducts.mockResolvedValue([{ ...product, description: undefined }])
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    expect(screen.queryByText('商品介绍')).toBeNull()
  })
})

describe('评价合并与排序', () => {
  it('云端 + 本地两路合并计数，并给出均分（(4+2)/2=3.0）', async () => {
    const { container } = render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    // 均分那一行由多个表达式节点拼成，只能按整段文本匹配
    expect(container.textContent).toContain('3.0 分 · 2 条评价')
    expect(screen.getByText('本地差评')).toBeTruthy()
    expect(screen.getByText('云端好评')).toBeTruthy()
  })

  it('点"低分"后按评分升序（第一条变成本地 2 星）', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    fireEvent.click(screen.getByText('低分'))
    const users = screen.getAllByText(/^(本地|云端)$/).map((e) => e.textContent)
    expect(users[0]).toBe('本地')
    fireEvent.click(screen.getByText('高分'))
    expect(screen.getAllByText(/^(本地|云端)$/).map((e) => e.textContent)[0]).toBe('云端')
  })

  it('product.order 存在才挂写评价表单，并按 order 传参', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('heading', { name: '写评价' })).toBeTruthy())
    expect(screen.getByLabelText('评价内容（最多 500 字）')).toBeTruthy()
  })

  it('发布评价后重新拉本地+云端列表（refreshReviews 回接父页）', async () => {
    m.addReview.mockResolvedValue({ _id: 'r-new' })
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
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
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('本地差评')).toBeTruthy())
    expect(screen.getByText('买家评价 (1)')).toBeTruthy()
  })

  it('快速切商品时旧响应不覆盖新商品（cancelled 守卫）', async () => {
    const { rerender } = render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('买家评价 (2)')).toBeTruthy())
    m.id = '999'
    m.getProducts.mockResolvedValue([{ ...product, _id: 'p999', order: 999, name: '薯片' }])
    m.getCloudReviews.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return [rv({ text: '新商品的云端评价' })] })
    m.getLocalProductReviews.mockReturnValue([])
    rerender(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('新商品的云端评价')).toBeTruthy())
    expect(screen.queryByText('云端好评')).toBeNull()
  })
})

describe('加购', () => {
  // 吸底栏按视口条件渲染（jsdom 无 matchMedia → 按桌面处理），
  // 所以 DOM 里**只能有一个**「加入购物车」——两份同名主按钮曾让 e2e 严格模式失败。
  const addButton = () => screen.getByRole('button', { name: '加入购物车' })

  it('同屏只渲染一个「加入购物车」主按钮（不变量）', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByRole('button', { name: '加入购物车' }).length).toBe(1))
  })

  it('数量为 0 时不显示"已有 N 件"，点击加购带整个商品与数量', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(addButton()).toBeTruthy())
    expect(screen.queryByText(/购物车已有/)).toBeNull()
    fireEvent.click(addButton())
    expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p12' }), 1)
  })

  it('数量步进器改数量，加购按该数量一次入账', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(addButton()).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }))
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }))
    expect(screen.getByLabelText('购买数量').textContent).toBe('3')
    fireEvent.click(addButton())
    expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p12' }), 3)
  })

  it('数量减到 1 后继续减不再下降（下限锁死，避免加进 0 件）', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    const minus = await screen.findByRole('button', { name: '减少购买数量' })
    expect(minus.disabled).toBe(true) // 初值 1，下限直接锁住
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }))
    await waitFor(() => expect(screen.getByLabelText('购买数量').textContent).toBe('2'))
    fireEvent.click(screen.getByRole('button', { name: '减少购买数量' }))
    await waitFor(() => expect(screen.getByLabelText('购买数量').textContent).toBe('1'))
    expect(screen.getByRole('button', { name: '减少购买数量' }).disabled).toBe(true)
  })

  it('加购后就地播报结果文案', async () => {
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(addButton()).toBeTruthy())
    fireEvent.click(addButton())
    expect(await screen.findByText('已把 1 件「可乐」加入购物袋')).toBeTruthy()
  })

  it('购物车已有该商品时显示件数并给出结算入口', async () => {
    m.getQuantity.mockReturnValue(3)
    render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('购物车已有 3 件')).toBeTruthy())
    expect(screen.getByRole('link', { name: '去购物袋结算' })).toBeTruthy()
  })
})
