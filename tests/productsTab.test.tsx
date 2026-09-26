// @vitest-environment jsdom
// ProductsTab 分支（七轮 H1）：后台最高频的写路径。重点锁三件事——
// ①批量改价的**取整口径**（百分比/绝对价两条路径的小数处理，错了就是资损）；
// ②失败必须内联 notice（禁 alert，且不能静默吞掉服务端部分失败）；
// ③"内联展开"铁律（新增/编辑都在列表原位展开，不出现 dialog）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import ProductsTab from '../src/components/ProductsTab'
import type { Category, Product } from '../src/types'

const m = vi.hoisted(() => ({
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  batchUpdateProducts: vi.fn(),
  batchDeleteProducts: vi.fn(),
  onDataChange: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  updateProduct: m.updateProduct,
  deleteProduct: m.deleteProduct,
  batchUpdateProducts: m.batchUpdateProducts,
  batchDeleteProducts: m.batchDeleteProducts,
}))
vi.mock('../src/components/admin/ProductInlineEditForm', () => ({
  default: ({ product }: { product: Record<string, unknown> }) => (
    <div data-testid="inline-form">{product._id ? `编辑:${product._id}` : '新增表单'}</div>
  ),
}))

const cats: Category[] = [{
  _id: 'c1', name: '饮品', type: 'drink',
  subcategories: [{ id: 's1', name: '碳酸' }, { id: 's2', name: '茶水' }, { id: 's3', name: '第三类' }],
} as unknown as Category, { _id: 'c2', name: '食品', type: 'food', subcategories: [{ id: 'f1', name: '膨化' }] } as unknown as Category]

const mkProduct = (i: number, over: Partial<Product> = {}): Product => ({
  _id: `p${i}`, name: `可乐${i}`, spec: '500ml', price: 10, order: i,
  subcategories: i % 2 === 1 ? ['s1', 's2', 's3'] : ['f1'], enabled: true, stock: -1,
  ...over,
} as unknown as Product)

const list = [mkProduct(1), mkProduct(2)]

function setup(products: Product[] = list) {
  return render(<ProductsTab products={products} categories={cats} onDataChange={m.onDataChange} />)
}

const pickSome = (n: number) => {
  const boxes = screen.getAllByRole('checkbox')
  for (let i = 0; i < n; i++) fireEvent.click(boxes[i])
}

beforeEach(() => {
  vi.clearAllMocks()
  m.updateProduct.mockResolvedValue({ ok: true })
  m.deleteProduct.mockResolvedValue({ ok: true })
  m.batchUpdateProducts.mockResolvedValue({ code: 0, data: { failed: [], total: 0 } })
  m.batchDeleteProducts.mockResolvedValue({ code: 0, data: { failed: [], total: 0 } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('筛选与空态', () => {
  it('搜索命中名称或规格；无匹配时给"无匹配结果"而非"暂无商品"', () => {
    setup()
    fireEvent.change(screen.getByLabelText('搜索商品名称或口味'), { target: { value: '500ml' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('搜索商品名称或口味'), { target: { value: '不存在的关键词' } })
    expect(screen.getByText('无匹配结果')).toBeTruthy()
    expect(screen.queryByText('暂无商品')).toBeNull()
  })

  it('商品列表为空 → 种子数据引导文案', () => {
    setup([])
    expect(screen.getByText('暂无商品')).toBeTruthy()
    expect(screen.getByText(/初始化种子数据/)).toBeTruthy()
  })

  it('按分类筛选走子分类索引（drink 命中奇数项）', () => {
    setup([mkProduct(1), mkProduct(2), mkProduct(3)])
    fireEvent.click(screen.getByRole('button', { name: '饮品' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2) // p1、p3
    expect(screen.getByRole('button', { name: '饮品' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('行内分类标签最多两个子分类、用 · 连接（预建索引 O(1) 查表）', () => {
    setup()
    expect(screen.getByText('碳酸 · 茶水')).toBeTruthy()
    expect(screen.queryByText(/第三类/)).toBeNull()
    expect(screen.getByText('膨化')).toBeTruthy()
  })
})

describe('批量选择与全选', () => {
  it('全选按钮在"全选(n)/取消全选"两态间切换，且 n 跟随筛选结果', () => {
    setup([mkProduct(1), mkProduct(2), mkProduct(3)])
    fireEvent.change(screen.getByLabelText('搜索商品名称或口味'), { target: { value: '可乐3' } })
    fireEvent.click(screen.getByRole('button', { name: '全选(1)' }))
    expect(screen.getByRole('button', { name: '取消全选' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    expect(screen.getByRole('button', { name: '全选(1)' })).toBeTruthy()
  })

  it('未选中任何项时不渲染批量操作栏（避免误点空批量）', () => {
    setup()
    expect(screen.queryByText(/已选 \d+ 项/)).toBeNull()
    expect(screen.queryByRole('button', { name: '上架' })).toBeNull()
    expect(m.batchUpdateProducts).not.toHaveBeenCalled()
  })
})

describe('批量操作成功路径与原生 alert 禁回归（并自旧 ProductsTab.test.tsx）', () => {
  // 文件名大小写冲突提醒：本仓曾有 tests/ProductsTab.test.tsx，与本轮新建的
  // tests/productsTab.test.tsx 在 Windows/macOS 大小写不敏感文件系统上是同一个文件，
  // Write 会静默覆盖旧内容（git status 表现为 M 而非 ??）。旧 4 例已并入此处，不得再拆回。
  const simple = [{ _id: 'p1', name: '可乐', price: 3.5, enabled: true, order: 1 } as unknown as Product]

  it('勾选后「上架」下发 enabled:true 且只带上被选中的 id', async () => {
    render(<ProductsTab products={simple} categories={cats} onDataChange={m.onDataChange} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '上架' }))
    await waitFor(() => expect(m.batchUpdateProducts).toHaveBeenCalledWith([{ productId: 'p1', updates: { enabled: true } }]))
  })

  it('「下架」下发 enabled:false（与上架共用一条批量入口，只差取值）', async () => {
    render(<ProductsTab products={simple} categories={cats} onDataChange={m.onDataChange} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '下架' }))
    await waitFor(() => expect(m.batchUpdateProducts).toHaveBeenCalledWith([{ productId: 'p1', updates: { enabled: false } }]))
  })

  it('「删除」只走 batchDeleteProducts，不误触批量改状态', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ProductsTab products={simple} categories={cats} onDataChange={m.onDataChange} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(m.batchDeleteProducts).toHaveBeenCalledWith(['p1']))
    expect(m.batchUpdateProducts).not.toHaveBeenCalled()
  })

  it('部分失败走内联反馈条，且绝不回退到原生 alert（第三轮 alert→notice 不变量）', async () => {
    m.batchUpdateProducts.mockResolvedValue({ code: 0, data: { updated: 0, failed: [{ id: 'p1', message: '商品不存在' }], total: 1 } })
    const alertSpy = vi.fn()
    vi.stubGlobal('alert', alertSpy)
    render(<ProductsTab products={simple} categories={cats} onDataChange={m.onDataChange} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '上架' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('批量上架部分失败：1/1 未生效'))
    expect(alertSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('批量上下架与删除', () => {
  it('批量上架：ids 全量下发并清空选择、通知父级刷新', async () => {
    setup()
    pickSome(2)
    fireEvent.click(screen.getByRole('button', { name: '上架' }))
    await waitFor(() => expect(m.batchUpdateProducts).toHaveBeenCalledWith([
      { productId: 'p1', updates: { enabled: true } },
      { productId: 'p2', updates: { enabled: true } },
    ]))
    await waitFor(() => expect(m.onDataChange).toHaveBeenCalled())
    expect(screen.queryByText(/已选 2 项/)).toBeNull()
  })

  it('批量删除必须二次确认；取消则不发请求', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup()
    pickSome(1)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(m.batchDeleteProducts).not.toHaveBeenCalled()
  })

  it('部分失败要 warn 播报（服务端 failed 明细不能被吞掉）', async () => {
    m.batchDeleteProducts.mockResolvedValue({ code: 0, data: { failed: [{ id: 'p1', message: '被订单引用' }], total: 2 } })
    setup()
    pickSome(2)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('批量删除部分失败：1/2 未生效'))
  })

  it('整体失败（code!=0）→ error 播报并展示服务端 message', async () => {
    m.batchUpdateProducts.mockResolvedValue({ code: -1, message: '权限不足' })
    setup()
    pickSome(1)
    fireEvent.click(screen.getByRole('button', { name: '下架' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('批量下架失败：权限不足'))
    expect(m.onDataChange).not.toHaveBeenCalled()
  })
})

describe('批量改价取整口径', () => {
  it('数字 = 统一价（元），保留两位', async () => {
    setup()
    pickSome(2)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('批量改价：数字表示统一价，数字加百分号表示打折'), { target: { value: '9.99' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(m.batchUpdateProducts).toHaveBeenCalledWith([
      { productId: 'p1', updates: { price: 9.99 } },
      { productId: 'p2', updates: { price: 9.99 } },
    ]))
  })

  it('百分号 = 按原价百分比，四舍五入到分（3.33×33% 这类分位必须准）', async () => {
    setup([mkProduct(1, { price: 3.33 }), mkProduct(2, { price: 10 })])
    pickSome(2)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('批量改价：数字表示统一价，数字加百分号表示打折'), { target: { value: '33%' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(m.batchUpdateProducts).toHaveBeenCalledWith([
      { productId: 'p1', updates: { price: 1.1 } }, // 3.33*33=109.89 → round → 1.10
      { productId: 'p2', updates: { price: 3.3 } }, // 10*33=330 → 3.30
    ]))
  })

  it('非数字输入 → error 播报且不发请求、不弹确认', async () => {
    setup()
    pickSome(1)
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('批量改价：数字表示统一价，数字加百分号表示打折'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('请输入有效数字'))
    expect(m.batchUpdateProducts).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('确认框取消 → 不改价', async () => {
    setup()
    pickSome(1)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(screen.getByLabelText('批量改价：数字表示统一价，数字加百分号表示打折'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(m.batchUpdateProducts).not.toHaveBeenCalled()
  })

  it('改价失败抛错 → error 播报', async () => {
    m.batchUpdateProducts.mockRejectedValue(new Error('D1 超时'))
    setup()
    pickSome(1)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('批量改价：数字表示统一价，数字加百分号表示打折'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('批量改价失败：D1 超时'))
  })
})

describe('行内操作与内联展开铁律', () => {
  it('快捷开关按当前状态取反下发（下架态点一下变上架）', async () => {
    setup([mkProduct(1, { enabled: false }), mkProduct(2)])
    fireEvent.click(screen.getAllByRole('button', { name: '上架商品' })[0])
    await waitFor(() => expect(m.updateProduct).toHaveBeenCalledWith('p1', { enabled: true }))
    expect(m.onDataChange).toHaveBeenCalled()
  })

  it('单条删除失败 → error 播报（不静默）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.deleteProduct.mockRejectedValue(new Error('网络错误'))
    setup()
    fireEvent.click(screen.getAllByRole('button', { name: '删除商品' })[0])
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('删除失败：网络错误'))
  })

  it('「+ 新增」在列表原位展开表单，且全程没有 dialog/抽屉', async () => {
    setup()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ 新增' }))
    expect(screen.getByTestId('inline-form').textContent).toBe('新增表单')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('编辑某行时该行展开、再点收起（同一时刻只有一个编辑位）', () => {
    setup()
    fireEvent.click(screen.getAllByRole('button', { name: '编辑可乐1' })[0])
    expect(screen.getByTestId('inline-form').textContent).toBe('编辑:p1')
    fireEvent.click(screen.getAllByRole('button', { name: '收起编辑' })[0])
    expect(screen.queryByTestId('inline-form')).toBeNull()
  })

  it('notice 5 秒自动消失，且卸载后不再 setState（定时器可清理）', async () => {
    vi.useFakeTimers()
    m.updateProduct.mockRejectedValue(new Error('boom'))
    const { unmount } = setup()
    fireEvent.click(screen.getAllByRole('button', { name: '下架商品' })[0])
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('操作失败：boom'))
    // 定时器回调里的 setState 必须包在 act 内，否则 React 不刷新这帧更新
    act(() => { vi.advanceTimersByTime(5000) })
    // role=alert 容器常驻（这样读屏才会播报），所以判据只能取文案消失
    expect(screen.queryByText('操作失败：boom')).toBeNull()
    unmount()
    vi.useRealTimers()
  })
})
