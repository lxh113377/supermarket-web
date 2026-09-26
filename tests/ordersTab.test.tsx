// @vitest-environment jsdom
// OrdersTab 主体分支（七轮 H1）：超时面板已在 ordersTabStale.test.tsx 专测，这里补
// 筛选/分页/状态流转/删除/复制/CSV 导出/加载态——都是"改错了界面照旧渲染"的高频写路径。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import OrdersTab from '../src/components/OrdersTab'
import type { Order } from '../src/types'

const m = vi.hoisted(() => ({
  updateOrderStatus: vi.fn(),
  deleteOrder: vi.fn(),
  adminCall: vi.fn(),
  getAllOrders: vi.fn(),
  onOrdersChange: vi.fn(),
}))

vi.mock('../src/auth', () => ({
  updateOrderStatus: m.updateOrderStatus,
  deleteOrder: m.deleteOrder,
  adminCall: m.adminCall,
}))
vi.mock('../src/db', () => ({ getAllOrders: m.getAllOrders }))

const mkOrder = (i: number, over: Partial<Order> = {}): Order => ({
  _id: `o${i}`,
  roomNumber: `36栋-${100 + i}`,
  items: [{ name: '可乐', spec: '500ml', price: 3.5, quantity: 2 }],
  totalAmount: 7,
  status: 'pending',
  createdAt: '2026-09-20T10:00:00.000Z',
  ...over,
} as unknown as Order)

const orders2 = [mkOrder(1), mkOrder(2, { status: 'paid', roomNumber: '37栋-201' })]

function setup(orders: Order[] = orders2, loading = false) {
  return render(<OrdersTab orders={orders} onOrdersChange={m.onOrdersChange} loading={loading} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.adminCall.mockResolvedValue({ code: 0, data: { thresholdMinutes: 60, count: 0, orders: [], stockReserved: [] } })
  m.getAllOrders.mockResolvedValue({ orders: [], maxUpdatedAt: null })
  m.updateOrderStatus.mockResolvedValue({ ok: true })
  m.deleteOrder.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('加载态与空态', () => {
  it('loading 且无数据 → 骨架屏 + sr-only 播报，不发超时报表请求', () => {
    setup([], true)
    // 骨架容器自身也带 role=status，这里按文本定位播报节点
    expect(screen.getAllByRole('status').some((el) => el.textContent === '加载订单中')).toBe(true)
    expect(m.adminCall).not.toHaveBeenCalled()
  })

  it('非 loading 且无数据 → EmptyState 文案', () => {
    setup([])
    expect(screen.getByText('暂无订单')).toBeTruthy()
    expect(screen.getByText(/未开启匿名登录/)).toBeTruthy()
  })

  it('有数据时 mount 即拉一次超时报表（只读密钥失败也静默）', async () => {
    m.adminCall.mockRejectedValueOnce(new Error('403'))
    setup()
    await waitFor(() => expect(m.adminCall).toHaveBeenCalledWith('stalePendingReport', { minutes: 60 }))
    expect(screen.queryByText(/超时未确认订单/)).toBeNull()
  })
})

describe('筛选与分页', () => {
  it('按房间号搜索实时过滤，并把页码复位到第 1 页', async () => {
    setup([...Array.from({ length: 25 }, (_, i) => mkOrder(i + 1)), mkOrder(99, { roomNumber: '特殊栋-777' })])
    await waitFor(() => expect(screen.getByText(/共 26 单 · 第 1\/2 页/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('按房间号、商品或口味搜索订单'), { target: { value: '特殊' } })
    expect(screen.getByText(/特殊栋-777/)).toBeTruthy()
    expect(screen.queryByText(/共 26 单/)).toBeNull()
  })

  it('按状态下拉筛选（下拉选项来自 5 态表）', () => {
    setup()
    const sel = screen.getByLabelText('按订单状态筛选') as HTMLSelectElement
    fireEvent.change(sel, { target: { value: 'paid' } })
    expect(screen.getByText(/房间号：37栋-201/)).toBeTruthy()
    expect(screen.queryByText(/36栋-101/)).toBeNull()
  })

  it('翻页：下一页/上一页可点，边界处禁用', async () => {
    const many = Array.from({ length: 21 }, (_, i) => mkOrder(i + 1))
    setup(many)
    await waitFor(() => expect(screen.getByText(/共 21 单 · 第 1\/2 页/)).toBeTruthy())
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText(/第 2\/2 页/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(screen.getByText(/第 1\/2 页/)).toBeTruthy()
  })

  it('每页只渲染 20 条（防全量 DOM 卡顿的核心判据）', async () => {
    setup(Array.from({ length: 25 }, (_, i) => mkOrder(i + 1)))
    await waitFor(() => expect(screen.getAllByText(/房间号：/)).toHaveLength(20))
  })
})

describe('状态流转', () => {
  it('合法迁移成功 → 内联 notice + 重拉列表回传父级', async () => {
    const fresh = [mkOrder(1, { status: 'paid' })]
    m.getAllOrders.mockResolvedValue({ orders: fresh, maxUpdatedAt: 'x' })
    setup()
    fireEvent.change(screen.getAllByLabelText(/订单 .* 的状态/)[0], { target: { value: 'paid' } })
    await waitFor(() => expect(m.updateOrderStatus).toHaveBeenCalledWith('o1', 'paid'))
    expect(screen.getByRole('status').textContent).toBe('订单状态已更新为「已支付」')
    expect(m.onOrdersChange).toHaveBeenCalledWith(fresh)
  })

  it('服务端拒绝（code!=0）→ notice 展示服务端 message，不刷新列表', async () => {
    m.updateOrderStatus.mockResolvedValue({ code: -1, message: '订单已被他人更新，请刷新后重试' })
    setup()
    fireEvent.change(screen.getAllByLabelText(/订单 .* 的状态/)[0], { target: { value: 'cancelled' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('订单已被他人更新'))
    expect(m.getAllOrders).not.toHaveBeenCalled()
  })

  it('抛错分支 → notice「更新失败：<原因>」', async () => {
    m.updateOrderStatus.mockRejectedValue(new Error('network down'))
    setup()
    fireEvent.change(screen.getAllByLabelText(/订单 .* 的状态/)[0], { target: { value: 'paid' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('更新失败：network down'))
  })

  it('下拉只给合法迁移项（completed 终态无可选后继）', () => {
    setup([mkOrder(1, { status: 'completed' })])
    const sel = screen.getByLabelText(/订单 36栋-101 的状态/) as HTMLSelectElement
    // 终态：仅剩自身一项（value 必须存在于 options，否则 React 会静默置空）
    expect(sel.options.length).toBe(1)
    expect(sel.value).toBe('completed')
  })
})

describe('删除订单', () => {
  it('确认取消 → 不调用删除接口', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup()
    fireEvent.click(screen.getAllByLabelText('删除订单')[0])
    await new Promise((r) => setTimeout(r, 0))
    expect(m.deleteOrder).not.toHaveBeenCalled()
  })

  it('确认删除 → 成功后重拉列表并 notice', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const rest = [mkOrder(2)]
    m.getAllOrders.mockResolvedValue({ orders: rest, maxUpdatedAt: null })
    setup()
    fireEvent.click(screen.getAllByLabelText('删除订单')[0])
    await waitFor(() => expect(m.deleteOrder).toHaveBeenCalledWith('o1'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('订单已删除'))
    expect(m.onOrdersChange).toHaveBeenCalledWith(rest)
  })

  it('删除失败（code!=0）→ notice 展示原因且清除 deleting 态', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.deleteOrder.mockResolvedValue({ code: -1, message: '订单不存在' })
    setup()
    fireEvent.click(screen.getAllByLabelText('删除订单')[0])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('删除失败：订单不存在'))
    expect(screen.getAllByLabelText('删除订单')[0].hasAttribute('disabled')).toBe(false)
  })
})

describe('复制与导出', () => {
  it('复制订单文本含房间号/明细/合计/状态，成功后 notice', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    setup()
    fireEvent.click(screen.getAllByRole('button', { name: '复制' })[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('房间号：36栋-101')
    expect(text).toContain('可乐(500ml) x2 ¥7.00')
    expect(text).toContain('合计：¥7.00')
    expect(text).toContain('状态：待支付')
    expect(screen.getByRole('status').textContent).toBe('已复制到剪贴板')
  })

  it('CSV 导出：表头 + 逐商品行 + 状态中文化，锚点先挂 DOM 再点击（Firefox 判据）', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:csv')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const parents: Array<Element | null> = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      parents.push(this.parentElement) // 必须在点击那一刻取：点完就被 removeChild，之后再查必然是 null
    })
    setup([mkOrder(1)])
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    const blob = createObjectURL.mock.calls[0][0] as Blob    // BOM 必须在**字节层**断言：Blob.text() 按规范会吞掉前导 BOM，用字符串比对会得到假失败
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const csv = await blob.text()
    expect(csv).toContain('房间号,商品,口味,数量,单价,小计,状态,时间')
    expect(csv).toContain('可乐(500ml)  x2,,2,3.50,7.00,待支付')
    expect(parents).toHaveLength(1)
    expect(parents[0]).toBe(document.body) // 点击时仍在文档内（Firefox 判据）
    expect(spy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
    spy.mockRestore()
    vi.useRealTimers()
  })
})

describe('口味（从订单快照 spec 拆出来给后台看）', () => {
  // 一条带口味（顾客在详情页选过）、一条不带（历史单或本就无口味的商品），
  // 两条同单：既验"该显示的显示"，也验"不该凭空长出的不长出"
  const flavored = () => mkOrder(7, {
    roomNumber: '38栋-501',
    items: [
      { productId: 'p033', name: '乐事薯片', spec: '40g · 黄瓜味', price: 2.66, quantity: 2 },
      { productId: 'p022', name: '有糖可乐', spec: '罐装330ml', price: 3.5, quantity: 1 },
    ] as unknown as Order['items'],
  })

  it('选过口味的商品挂口味标签，没挂的不凭空长出标签', () => {
    setup([flavored()])
    expect(screen.getByText('口味 黄瓜味')).toBeTruthy()
    expect(screen.getAllByText(/口味/).length).toBe(1)
    expect(screen.getByText(/乐事薯片\(40g\)x2/)).toBeTruthy()
    expect(screen.getByText(/有糖可乐\(罐装330ml\)x1/)).toBeTruthy()
  })

  it('按口味搜索能命中订单：查"谁买了黄瓜味"不必逐单翻', async () => {
    setup([mkOrder(1), flavored()])
    fireEvent.change(screen.getByLabelText('按房间号、商品或口味搜索订单'), { target: { value: '黄瓜味' } })
    await waitFor(() => {
      expect(screen.getByText(/38栋-501/)).toBeTruthy()
      expect(screen.queryByText(/36栋-101/)).toBeNull()
    })
  })

  it('CSV：口味独立成列，商品列只留静态规格（能直接按口味透视）', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:flavor')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    setup([flavored()])
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    const csv = await (createObjectURL.mock.calls[0][0] as Blob).text()
    expect(csv).toContain('乐事薯片(40g)  x2,黄瓜味,2,2.66,5.32,待支付')
    expect(csv).toContain('有糖可乐(罐装330ml)  x1,,1,3.50,3.50,待支付')
    vi.advanceTimersByTime(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:flavor')
    spy.mockRestore()
    vi.useRealTimers()
  })
})
