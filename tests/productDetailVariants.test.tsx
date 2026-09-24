// @vitest-environment jsdom
// 详情页的变体交互（规格选择改价 / 自动回落播报 / 缩略图与规格双向联动 / 演示订单摘要）
//
// 用例商品直接用 products-seed.ts 的真实行（东鹏特饮 盒装250ml / 瓶装250ml / 瓶装500ml），
// 断言里的价格就是目录里的真实价格 —— 与 variants.test.ts 的诚实性判据同源。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProductDetailPage from '../src/pages/ProductDetailPage'
import { products as seedProducts } from '../src/data/products-seed'
import type { Product } from '../src/types'

const m = vi.hoisted(() => ({
  id: '16',
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

// 真实目录行 → 前端 Product 形状（_id 用 p+order 模拟后端下发）
const rows: Product[] = seedProducts
  .filter((p) => [16, 17, 18, 22, 24, 27].includes(Number(p.order)))
  .map((p) => ({ ...p, _id: `p${p.order}` })) as Product[]

const page = () => render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  m.id = '16'
  m.getProducts.mockResolvedValue(rows)
  m.getCategories.mockResolvedValue([
    { _id: 'drinks', name: '饮品', type: 'drink', order: 1, subcategories: [{ id: 'energy', name: '提神', order: 3 }] },
  ])
  m.getLocalProductReviews.mockReturnValue([])
  m.getCloudReviews.mockResolvedValue([])
  m.getQuantity.mockReturnValue(0)
})
afterEach(() => { cleanup() })

describe('规格选择器', () => {
  it('有变体数据的商品按真实属性渲染两轴（包装 / 容量），不硬套「颜色」字样', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('包装')).toBeTruthy()
    expect(screen.getByText('容量')).toBeTruthy()
    expect(screen.queryByText('颜色')).toBeNull()
  })

  it('无变体数据的商品不渲染选择器（不编造规格）', async () => {
    m.id = '22' // 有糖可乐 罐装330ml，不在演示变体组里
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.queryByText('包装')).toBeNull()
    expect(screen.queryByText('容量')).toBeNull()
  })

  it('进入某条目录记录时，选择器初始选中该项自身', async () => {
    m.id = '18' // 东鹏特饮 500ml 瓶装
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByRole('button', { name: '瓶装' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '500ml' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '盒装' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('换规格 → 价格随真实单价变化（盒装250ml 2.33 ↔ 瓶装500ml 4.66）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getAllByText('¥2.33').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '瓶装' }))
    fireEvent.click(screen.getByRole('button', { name: '500ml' }))
    await waitFor(() => expect(screen.getAllByText('¥4.66').length).toBeGreaterThan(0))
    expect(screen.queryByText('¥2.33')).toBeNull()
  })

  it('选到不存在的组合（盒装 + 500ml）时自动回落并如实播报，不静默改用户规格', async () => {
    m.id = '18' // 当前：瓶装 + 500ml
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '盒装' }))
    // 盒装没有 500ml → 容量自动切回 250ml，价格回到真实的 2.33
    expect(await screen.findByText(/没有可售组合/)).toBeTruthy()
    expect(screen.getByText(/容量已自动切为「250ml」/)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('¥2.33').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '盒装' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '250ml' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('变体组如实标注哪些是真实值、哪些是演示聚合', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText(/数据说明：/)).toBeTruthy()
    expect(screen.getByText(/演示交互/)).toBeTruthy()
  })
})

describe('缩略图与主图双向联动', () => {
  it('变体组有几条真实商品记录就出几张真实缩略图', async () => {
    const { container } = page()
    await screen.findByLabelText('购买数量')
    const nav = screen.getByRole('navigation', { name: /图片缩略图/ })
    expect(nav.querySelectorAll('button').length).toBe(3)
    expect(nav.querySelectorAll('img').length).toBe(3)
    expect(container.querySelector('[data-main-image] img')).toBeTruthy()
  })

  it('点缩略图同时切主图与规格（同一份 selection 驱动，不会两态打架）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    const nav = screen.getByRole('navigation', { name: /图片缩略图/ })
    fireEvent.click(nav.querySelectorAll('button')[2]) // 第三张 = 瓶装 500ml
    await waitFor(() => expect(screen.getAllByText('¥4.66').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '瓶装' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '500ml' }).getAttribute('aria-pressed')).toBe('true')
    // 主图跟着换成该规格对应的真实实拍图
    await waitFor(() => expect(
      document.querySelector('[data-main-image] img')!.getAttribute('src'),
    ).toBe('/images/18.webp'))
  })
})

describe('加购按变体入账', () => {
  it('加购带的是变体对应的那条真实商品（价格与 _id 都对得上）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '500ml' }))
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(m.add).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'p18', price: 4.66, name: '东鹏特饮' }),
      1,
    )
  })
})

describe('演示订单摘要（不真实支付）', () => {
  it('点「立即购买」只弹演示摘要，不跳转任何真实下单路由', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '立即购买（演示摘要）' }))
    const dialog = await screen.findByRole('dialog', { name: '演示订单摘要' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText(/不产生真实订单、不发起任何支付/)).toBeTruthy()
    expect(m.navigate).not.toHaveBeenCalled()
  })

  it('摘要里的金额 = 变体真实单价 × 所选数量', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '500ml' })) // ¥4.66
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }))
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' })) // 数量 3
    fireEvent.click(screen.getByRole('button', { name: '立即购买（演示摘要）' }))
    await screen.findByRole('dialog', { name: '演示订单摘要' })
    expect(screen.getByText('× 3')).toBeTruthy()
    expect(screen.getByText('¥13.98')).toBeTruthy() // 4.66 × 3
    expect(screen.getByText(/当前对应目录编号 18/)).toBeTruthy()
  })

  it('关闭摘要后焦点回到触发按钮（Overlay 的焦点归还）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    const trigger = screen.getByRole('button', { name: '立即购买（演示摘要）' })
    // jsdom 的 fireEvent.click 不移动焦点（真实浏览器点击会把焦点放到按钮上），
    // 故先显式 focus，才能验到「打开时记录的 lastFocused = 触发按钮」这一半。
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: '演示订单摘要' })
    fireEvent.click(screen.getByRole('button', { name: '我知道了（返回商品页）' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toBe(document.activeElement)
  })
})

describe('参数与相关推荐', () => {
  it('参数表用真实分类名，且标注字段未经加工', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('商品参数')).toBeTruthy()
    expect(screen.getByText('饮品 · 提神')).toBeTruthy()
    expect(screen.getByText('目录编号')).toBeTruthy()
    expect(screen.getByText(/^16$/)).toBeTruthy()
    expect(screen.getByText(/取自商品目录真实记录/)).toBeTruthy()
  })

  it('售后说明整块标为演示文案，不作为商家承诺', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('售后说明')).toBeTruthy()
    expect(screen.getAllByText('演示文案').length).toBeGreaterThan(0)
    expect(screen.getByText(/不构成任何真实承诺/)).toBeTruthy()
  })

  it('相关推荐只出同类目真实商品并以原生链接可达', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('同类商品')).toBeTruthy()
    // 同为 energy 子分类的 17/18 应出现在推荐里，且是真实链接（可右键新标签、可读屏列链接）
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/product/'))
    const hrefs = links.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/product/p17')
    expect(hrefs).toContain('/product/p18')
    expect(screen.getByText('共 2 条 · 取自真实商品目录')).toBeTruthy()
  })

  it('面包屑把页面接回 首页 › 生活 › 零食饮料 的真实入口', async () => {
    page()
    await screen.findByLabelText('购买数量')
    const nav = screen.getByRole('navigation', { name: '面包屑' })
    const hrefs = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/category/life', '/shop'])
  })
})
