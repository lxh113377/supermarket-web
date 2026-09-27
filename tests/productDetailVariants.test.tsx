// @vitest-environment jsdom
// 详情页的规格交互：口味只有一条来路 —— 商品自带的 specOptions（后台写进 D1）。
// 原先的第二条来路是跨记录演示层 src/data/variants-demo.ts，已于 2026-09-28 退役：
// 它不进 D1、不参与下单接口，却在详情页优先渲染出选择器，产出的 specText 服务端
// allowedOrderSpecs 不认，被 resolveOrderSpec 静默回落 ⇒ 顾客选了口味而后台看不见。
//
// 用例商品直接用 products-seed.ts 的真实行，断言里的价格/口味就是目录里的真实值 ——
// 与 variants.test.ts 的诚实性判据同源，不另编一份测试夹具冒充生产数据。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProductDetailPage from '../src/pages/ProductDetailPage'
import { products as seedProducts } from '../src/data/products-seed'
import { allowedOrderSpecs } from '../functions/lib/actions/orders.js'
import { splitOrderSpec } from '../src/utils/spec-options'
import type { Product } from '../src/types'

/**
 * 轴名只从选择器的 fieldset>legend 取。
 * 禁用裸 getByText('口味')：商品参数区也有一行标签叫「口味」，裸文本查询要么
 * 因多个命中直接抛错，要么把参数行误当成「选择器存在」（假绿）。
 */
function axisNames(): string[] {
  return Array.from(document.querySelectorAll('fieldset > legend'))
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
}
const hasAxis = (name: string) => axisNames().some((t) => t.startsWith(name))


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

describe('白象帮泡的口味选择器（口味由 specOptions 承载，跨记录演示层已退役）', () => {
  it('渲染出「口味」单轴，选项就是目录里那条记录维护的三个口味，不硬套「颜色」字样', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(hasAxis('口味')).toBe(true)
    expect(hasAxis('颜色')).toBe(false)
    for (const label of ['十三香', '麻辣香', '山西老陈醋']) {
      expect(screen.getByRole('button', { name: label }), `缺口味 ${label}`).toBeTruthy()
    }
  })

  it('不再有「版本」轴：帮泡与零售是目录里两条独立记录，不在详情页互相切换', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(hasAxis('版本')).toBe(false)
    expect(screen.queryByRole('button', { name: '零售装' })).toBeNull()
  })

  it('无规格数据的商品不渲染选择器（不编造规格）', async () => {
    m.id = '22' // 有糖可乐 罐装330ml：既无聚合组也无口味
    page()
    await screen.findByLabelText('购买数量')
    expect(hasAxis('版本')).toBe(false)
    expect(hasAxis('口味')).toBe(false)
    expect(hasAxis('包装')).toBe(false)
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
    expect(hasAxis('包装')).toBe(false)
    expect(hasAxis('容量')).toBe(false)
  })

  it('进入 order 47（零售装）不渲染任何选择器 —— 它没有口味清单，页面不替它编', async () => {
    m.id = '47'
    page()
    await screen.findByLabelText('购买数量')
    expect(hasAxis('口味')).toBe(false)
    expect(hasAxis('版本')).toBe(false)
  })

  it('选口味不改价：单价仍是这条商品记录的真实值 3.66（口味不是另一条记录）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '山西老陈醋' }))
    await waitFor(() => expect(screen.getAllByText('¥3.66').length).toBeGreaterThan(0))
  })

  it('【缺陷回归】所选口味写进加购 spec 的那串，必须被服务端 allowedOrderSpecs 放行', async () => {
    // 演示层退役前这里产出的是「帮泡装 · 十三香」：服务端白名单里没有这一项，
    // resolveOrderSpec 会**静默**回落成静态规格 —— 不报错、不回传原因，后台就永远看不到口味。
    // 所以这条判据必须打到服务端那个函数上，而不是只比对前端自己的字符串。
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '山西老陈醋' }))
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    const called = m.add.mock.calls[0][0] as { _id: string; spec: string }
    const p46 = rows.find((p) => Number(p.order) === 46)!
    expect([...allowedOrderSpecs(p46)], `服务端不认 "${called.spec}"，会被静默丢掉`).toContain(called.spec)
    expect(splitOrderSpec(called.spec).flavor).toBe('山西老陈醋')
  })

  it('口味是真实目录数据，页面不得再把它标成演示交互', async () => {
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText(/管理后台维护/)).toBeTruthy()
    expect(screen.queryByText(/演示交互/)).toBeNull()
  })
})

describe('后台口味选择器（specOptions · 乐事薯片）', () => {
  it('渲染出「口味」单轴，选项就是后台维护的那份清单', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(hasAxis('口味')).toBe(true)
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
    expect(screen.getByText('口味：40g · 烤虾味')).toBeTruthy()
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
    expect(hasAxis('口味')).toBe(false)
  })

  it('如实说明口味来自后台、共用同一单价与实拍图', async () => {
    m.id = '33'
    page()
    await screen.findByLabelText('购买数量')
    expect(screen.getByText(/口味清单由商家在管理后台维护/)).toBeTruthy()
  })
})

describe('缩略图与主图：口味共用同一条商品记录的真实实拍图', () => {
  it('白象帮泡三个口味都落在 order 46 ⇒ 图集里只有 46 那张，不凭空多出零售装那张', async () => {
    page()
    await screen.findByLabelText('购买数量')
    // 单图时 ProductGallery 不渲染缩略图导航，所以按 src 取证而不是数导航按钮
    const main = document.querySelector('[data-main-image] img')
    expect(main!.getAttribute('src')).toBe('/images/46.webp')
    const shown = Array.from(document.querySelectorAll('img'))
      .map((i) => i.getAttribute('src') || '')
      .filter((s) => /^\/images\/\d+\.webp$/.test(s))
    expect(shown).toContain('/images/46.webp')
    expect(shown, '零售装（47）的图不该出现在帮泡详情页').not.toContain('/images/47.webp')
  })

  it('换口味不改主图（口径：口味只决定"要哪一个"，图/价/名仍是这条记录的真值）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    const before = document.querySelector('[data-main-image] img')!.getAttribute('src')
    expect(before).toBe('/images/46.webp')
    fireEvent.click(screen.getByRole('button', { name: '麻辣香' }))
    await waitFor(() => expect(
      document.querySelector('[data-main-image] img')!.getAttribute('src'),
    ).toBe(before))
  })
})

describe('加购按规格入账', () => {
  it('白象帮泡加购带的就是 order 46 这条记录本身（_id 与真实单价对得上）', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(m.add).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'p46', price: 3.66, name: '白象方便面' }),
      1,
    )
  })

  it('零售装（order 47）加购带的是它自己那条记录，价格 1.88 不被帮泡顶掉', async () => {
    m.id = '47'
    page()
    await screen.findByLabelText('购买数量')
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

  it('摘要里的金额 = 规格真实单价 × 所选数量，且口味不改单价', async () => {
    page()
    await screen.findByLabelText('购买数量')
    fireEvent.click(screen.getByRole('button', { name: '麻辣香' })) // 单价仍 3.66
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }))
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' })) // 数量 3
    fireEvent.click(screen.getByRole('button', { name: '立即购买（演示摘要）' }))
    await screen.findByRole('dialog', { name: '演示订单摘要' })
    expect(screen.getByText('× 3')).toBeTruthy()
    expect(screen.getByText('¥10.98')).toBeTruthy() // 3.66 × 3
    expect(screen.getByText('已选口味：麻辣香')).toBeTruthy()
    // 「当前对应目录编号 N」那行只在所选规格落到**另一条**商品记录时才出现（跨记录聚合组的痕迹）。
    // 口味共用同一条记录 ⇒ 这行不该存在；它若回来了，说明又有人让前端把用户指向别的行。
    expect(screen.queryByText(/当前对应目录编号/)).toBeNull()
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
