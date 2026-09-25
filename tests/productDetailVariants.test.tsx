// @vitest-environment jsdom
// 详情页的规格交互：两条来源都要过 —— ① 跨记录聚合组（白象 帮泡/零售，src/data/variants-demo.ts）
// ② 商品自带口味（乐事薯片等 4 款，后台写进 D1 的 specOptions）。
//
// 用例商品直接用 products-seed.ts 的真实行，断言里的价格/口味就是目录里的真实值 ——
// 与 variants.test.ts 的诚实性判据同源，不另编一份测试夹具冒充生产数据。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProductDetailPage from '../src/pages/ProductDetailPage'
import { products as seedProducts } from '../src/data/products-seed'
import type { Product } from '../src/types'

const m = vi.hoisted(() => ({
  id: '46',
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

// 22 = 有糖可乐（既无跨记录组也无口味）；33 = 乐事薯片（后台口味）；46/47 = 白象（跨记录组）
const rows: Product[] = seedProducts
  .filter((p) => [22, 33, 34, 45, 46, 47].includes(Number(p.order)))
  .map((p) => ({ ...p, _id: `p${p.order}` })) as Product[]

const page = () => render(<MemoryRouter><ProductDetailPage /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  m.id = '46'
  m.getProducts.mockResolvedValue(rows)
  m.getCategories.mockResolvedValue([
    { _id: 'food', name: '食品', type: 'food', order: 2, subcategories: [{ id: 'snacks', name: '零食', order: 1 }, { id: 'filling', name: '垫腹', order: 2 }] },
  ])
  m.getLocalProductReviews.mockReturnValue([])
  m.getCloudReviews.mockResolvedValue([])
  m.getQuantity.mockReturnValue(0)
})
afterEach(() => { cleanup() })

describe('跨记录规格选择器（白象 帮泡/零售）', () => {
  it('按真实属性渲染两轴（版本 / 口味），不硬套「颜色」字样', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('版本')).toBeTruthy()
    expect(screen.getByText('口味')).toBeTruthy()
    expect(screen.queryByText('颜色')).toBeNull()
  })

  it('无规格数据的商品不渲染选择器（不编造规格）', async () => {
    m.id = '22' // 有糖可乐 罐装330ml：本轮口径下既无聚合组也无口味
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.queryByText('版本')).toBeNull()
    expect(screen.queryByText('口味')).toBeNull()
    expect(screen.queryByText('包装')).toBeNull()
  })

  it('饮品的规格选择器已下线（东鹏 16 不再长出包装/容量两轴）', async () => {
    m.getProducts.mockResolvedValue([
      ...rows,
      ...seedProducts.filter((p) => [16, 17, 18].includes(Number(p.order)))
        .map((p) => ({ ...p, _id: `p${p.order}` })),
    ])
    m.id = '16'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.queryByText('包装')).toBeNull()
    expect(screen.queryByText('容量')).toBeNull()
  })

  it('进入某条目录记录时，选择器初始选中该项自身', async () => {
    m.id = '47' // 白象 零售装
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByRole('button', { name: '零售装' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '帮泡装' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('换规格 → 价格随真实单价变化（帮泡 3.66 ↔ 零售 1.88）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getAllByText('¥3.66').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '零售装' }))
    await waitFor(() => expect(screen.getAllByText('¥1.88').length).toBeGreaterThan(0))
  })

  it('【缺陷回归】帮泡装+十三香 点零售装：口味自动清空并如实播报，不静默改用户规格', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '山西老陈醋' }))
    fireEvent.click(screen.getByRole('button', { name: '零售装' }))
    expect(await screen.findByText(/没有可售组合/)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('¥1.88').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '零售装' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('如实标注哪些是真实值、哪些是聚合交互', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText(/数据说明：/)).toBeTruthy()
    expect(screen.getByText(/演示交互/)).toBeTruthy()
  })
})

describe('后台口味选择器（specOptions · 乐事薯片）', () => {
  it('渲染出「口味」单轴，选项就是后台维护的那份清单', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('口味')).toBeTruthy()
    const lay = rows.find((p) => Number(p.order) === 33)!
    for (const opt of lay.specOptions ?? []) {
      expect(screen.getByRole('button', { name: opt.label })).toBeTruthy()
    }
  })

  it('选口味不改价：单价仍是这条商品记录的真实值（口味不是另一条记录）', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getAllByText('¥2.66').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '烤虾味' }))
    await waitFor(() => expect(screen.getAllByText('¥2.66').length).toBeGreaterThan(0))
    expect(screen.getByText('规格：40g · 烤虾味')).toBeTruthy()
  })

  it('后台关掉的口味不在页面上出现（不是灰掉，灰掉等于告诉用户缺货）', async () => {
    m.getProducts.mockResolvedValue(rows.map((p) => (Number(p.order) === 33
      ? { ...p, specOptions: (p.specOptions ?? []).map((o) => (o.label === '烤虾味' ? { ...o, enabled: false } : o)) }
      : p)))
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.queryByText('烤虾味')).toBeNull()
    expect(screen.getByRole('button', { name: '原味' })).toBeTruthy()
  })

  it('口味清单为空的商品不渲染选择器', async () => {
    m.getProducts.mockResolvedValue(rows.map((p) => (Number(p.order) === 33 ? { ...p, specOptions: [] } : p)))
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.queryByText('口味')).toBeNull()
  })

  it('如实说明口味来自后台、共用同一单价与实拍图', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText(/口味清单由商家在管理后台维护/)).toBeTruthy()
  })
})

describe('缩略图与主图双向联动', () => {
  it('跨记录组有几条真实商品记录就出几张真实缩略图', async () => {
    const { container } = page()
    await screen.findByLabelText('购买数量')
    const nav = screen.getByRole('navigation', { name: /图片缩略图/ })
    expect(nav.querySelectorAll('button').length).toBe(2)
    expect(nav.querySelectorAll('img').length).toBe(2)
    expect(container.querySelector('[data-main-image] img')).toBeTruthy()
  })

  it('点缩略图同时切主图与规格（同一份 selection 驱动，不会两态打架）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    const nav = screen.getByRole('navigation', { name: /图片缩略图/ })
    fireEvent.click(nav.querySelectorAll('button')[1]) // 第二张 = 零售装（order 47）
    await waitFor(() => expect(screen.getAllByText('¥1.88').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '零售装' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(
      document.querySelector('[data-main-image] img')!.getAttribute('src'),
    ).toBe('/images/47.webp'))
  })
})

describe('加购按规格入账', () => {
  it('跨记录组加购带的是该规格对应的那条真实商品（价格与 _id 都对得上）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '零售装' }))
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(m.add).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'p47', price: 1.88, name: '白象方便面' }),
      1,
    )
  })

  it('口味加购把所选口味写进规格文案，商家才知道要哪一包', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '黄瓜味' }))
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(m.add).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'p33', price: 2.66, name: '乐事薯片', spec: '40g · 黄瓜味' }),
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

  it('摘要里的金额 = 规格真实单价 × 所选数量', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '零售装' })) // ¥1.88
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }))
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' })) // 数量 3
    fireEvent.click(screen.getByRole('button', { name: '立即购买（演示摘要）' }))
    await screen.findByRole('dialog', { name: '演示订单摘要' })
    expect(screen.getByText('× 3')).toBeTruthy()
    expect(screen.getByText('¥5.64')).toBeTruthy() // 1.88 × 3
    expect(screen.getByText(/当前对应目录编号 47/)).toBeTruthy()
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
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('商品参数')).toBeTruthy()
    expect(screen.getByText('食品 · 零食')).toBeTruthy()
    expect(screen.getByText('目录编号')).toBeTruthy()
    expect(screen.getByText(/^33$/)).toBeTruthy()
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
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText('同类商品')).toBeTruthy()
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/product/'))
    const hrefs = links.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/product/p34')
    expect(hrefs).toContain('/product/p45')
  })

  it('面包屑取商品自己的真实分类，且两级都指向可点回去的 /shop 深链', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    const nav = screen.getByRole('navigation', { name: '面包屑' })
    const hrefs = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/shop/food', '/shop/food/snacks'])
    expect(nav.textContent).toContain('食品')
    expect(nav.textContent).toContain('零食')
    // 写死的「生活 › 零食饮料」必须彻底消失：它与商城页显示的「食品 › 零食」互相矛盾
    expect(nav.textContent).not.toContain('零食饮料')
  })
})
