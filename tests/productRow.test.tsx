// @vitest-environment jsdom
// 管理端商品行 ProductRow 单测（六轮 G 批：原覆盖 35.71%，行内交互是后台高频路径）
// 内联编辑表单魔掉（其自身由 inlineEditForm.test.tsx 覆盖），此处只测"行"这一层。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ProductRow from '../src/components/admin/ProductRow'
import type { Product } from '../src/types'

vi.mock('../src/components/admin/ProductInlineEditForm', () => ({
  default: ({ product }: { product: Product }) => <div>内联编辑：{product.name}</div>,
}))

const base: Product = {
  _id: 'p1', name: '可乐', price: 3.5, category: 'drink', subCategory: 'soda',
  order: 12, spec: '500ml', enabled: true, stock: -1,
} as unknown as Product

const noop = () => undefined
function setup(over: Partial<Product> = {}, props: Record<string, unknown> = {}) {
  const handlers = {
    onToggleSelect: vi.fn(), onToggleEdit: vi.fn(), onQuickToggle: vi.fn(),
    onRemove: vi.fn(), onSaved: noop,
  }
  const r = render(
    <ProductRow
      product={{ ...base, ...over }}
      catLabel="饮品"
      isEditing={false}
      selected={false}
      categories={[]}
      onToggleSelect={handlers.onToggleSelect}
      onToggleEdit={handlers.onToggleEdit}
      onQuickToggle={handlers.onQuickToggle}
      onRemove={handlers.onRemove}
      onSaved={handlers.onSaved}
      {...props}
    />,
  )
  return { ...handlers, ...r }
}

beforeEach(() => { cleanup() })

describe('信息展示', () => {
  it('名称带规格、价格两位小数、分类标签来自预建索引', () => {
    setup()
    expect(screen.getByText('可乐 (500ml)')).toBeTruthy()
    expect(screen.getByText('¥3.50')).toBeTruthy()
    expect(screen.getByText('饮品')).toBeTruthy()
  })

  it('无规格时不拼出空括号；catLabel 为空时不渲染标签', () => {
    setup({ spec: '' }, { catLabel: '' })
    expect(screen.getByText(/^可乐/)).toBeTruthy()
    expect(screen.queryByText('()')).toBeNull()
    expect(screen.queryByText('饮品')).toBeNull()
  })

  it('有 order 时按约定拼图片路径（自定义 image 优先且不带 srcSet）', () => {
    const { container } = setup()
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/images/12.webp')
    expect(img.getAttribute('srcset')).toBe('/images/sm/12.webp 400w, /images/12.webp 800w')
    const { container: c2 } = setup({ image: 'https://cdn/x.png' })
    const img2 = c2.querySelector('img')!
    expect(img2.getAttribute('src')).toBe('https://cdn/x.png')
    expect(img2.getAttribute('srcset')).toBeNull()
  })

  it('无 order 且无 image → 渲染「无图」占位，不留破图', () => {
    setup({ order: undefined, image: undefined })
    expect(screen.getByText('无图')).toBeTruthy()
  })

  it('图片加载失败时隐藏 img（避免破图图标）', () => {
    const { container } = setup()
    const img = container.querySelector('img')!
    fireEvent.error(img)
    expect(img.style.display).toBe('none')
  })
})

describe('库存角标', () => {
  it('stock=0 显示缺货；0<stock<=3 显示低库存；-1/未定义不显示', () => {
    const a = setup({ stock: 0 })
    expect(a.getByRole('status').textContent).toBe('缺货')
    cleanup()
    const b = setup({ stock: 2 })
    expect(b.getByRole('status').textContent).toBe('低库存 2')
    cleanup()
    expect(screen.queryByRole('status')).toBeNull()
    setup({ stock: -1 })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('上下架与操作回调', () => {
  it('已上架：开关 aria-pressed=true、名称无删除线；点开关回调整个商品', () => {
    const h = setup()
    const sw = h.getByRole('button', { name: '下架商品' })
    expect(sw.getAttribute('aria-pressed')).toBe('true')
    expect(h.getByText('可乐 (500ml)').className).not.toContain('line-through')
    fireEvent.click(sw)
    expect(h.onQuickToggle).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p1' }))
  })

  it('已下架：文案换成「上架商品」且名称加删除线（灰显）', () => {
    const h = setup({ enabled: false })
    expect(h.getByRole('button', { name: '上架商品' }).getAttribute('aria-pressed')).toBe('false')
    expect(h.getByText('可乐 (500ml)').className).toContain('line-through')
  })

  it('勾选框回调商品 id；删除按钮回调 id', () => {
    const h = setup()
    fireEvent.click(h.getByLabelText('选择 可乐'))
    expect(h.onToggleSelect).toHaveBeenCalledWith('p1')
    fireEvent.click(h.getByRole('button', { name: '删除商品' }))
    expect(h.onRemove).toHaveBeenCalledWith('p1')
  })
})

describe('内联编辑展开（禁弹窗铁律的落点）', () => {
  it('点行 → 回调本行 id 并展开表单在行正下方，aria-expanded 同步', () => {
    const h = setup()
    const row = h.getByRole('button', { name: '编辑可乐' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(h.onToggleEdit).toHaveBeenCalledWith('p1')
    expect(screen.queryByText(/内联编辑：/)).toBeNull()
    cleanup()

    const h2 = setup({}, { isEditing: true })
    expect(h2.getByText('内联编辑：可乐')).toBeTruthy()
    expect(h2.getByRole('button', { name: '收起编辑' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(h2.getByRole('button', { name: '收起编辑' }))
    expect(h2.onToggleEdit).toHaveBeenCalledWith(null)
  })

  it('键盘 Enter/空格等价于点击；其他按键不触发', () => {
    const h = setup()
    const row = h.getByRole('button', { name: '编辑可乐' })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(h.onToggleEdit).toHaveBeenCalledWith('p1')
    fireEvent.keyDown(row, { key: ' ' })
    expect(h.onToggleEdit).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(row, { key: 'a' })
    expect(h.onToggleEdit).toHaveBeenCalledTimes(2)
  })

  it('选中行高亮边框（批量操作时看得见选中了哪些）', () => {
    const { container } = setup({}, { selected: true })
    const card = container.querySelector('div.flex.items-center') as HTMLElement
    expect(card.className).toContain('border-brand-300')
    cleanup()
    const { container: c2 } = setup()
    expect((c2.querySelector('div.flex.items-center') as HTMLElement).className).toContain('border-gray-100')
  })
})
