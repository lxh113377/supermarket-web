// @vitest-environment jsdom
// 营业状态必须跟着时间走 —— 这条钉的是一个真 bug（2026-10-23 老大报「营业时间显示已打烊」）。
//
// 一手形状：五个消费点都写成 `const open = isBusinessHours()`（组件体里一次性求值）。
// HomePage 的走钟每秒 setState，但那只重渲染 CoverClock 自己；其余四处连定时器都没有。
// ⇒ 17:36 打开页面不刷新的人，17:37 之后仍看到「已打烊」。
// 修法是 src/hooks/useBusinessHours.ts（对齐整分钟重算 + visibilitychange 立即纠正）。
// 本文件既测 hook 也测真实组件，两层都要，因为 bug 恰好只在"组件 + 真实时钟推进"时才现形。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ hours: vi.fn(() => false) }))
vi.mock('../src/utils/businessHours', () => ({
  isBusinessHours: () => mocks.hours(),
  getClosedMessage: () => '当前非营业时间，请在群内先与商家确认营业后再下单',
  getBusinessHoursText: () => '工作日(周一至五) 17:37-23:00 | 周末与节假日 13:00-次日1:00',
}))
vi.mock('react-router-dom', async (ip) => {
  const a = await ip()
  // CategoryPage 用 useParams 取 categoryId：喂一个真实在册的分类（'life'），
  // 否则它渲染「分类不存在」，闭店提示根本不在页面上 —— 那样的腿会以"没找到提示"
  // 的方式假绿（我第一版就是这么错的：断言拿到 null 却写成了 truthy 检查）。
  // 2026-10-23 补：HomePage 的服务索引已从 button 改成 <Link>（编辑式目录，保留原生链接
  // 语义），而 Link 需要 Router 上下文 —— 只 mock 掉 useNavigate/useParams 会抛
  // 「Cannot destructure property 'basename' of useContext(...) as it is null」。
  // 所以这里保留真实 Router 组件，只替换那两个 hook（比整包 mock 更接近真实渲染）。
  return { ...a, useNavigate: () => vi.fn(), useParams: () => ({ categoryId: 'life' }) }
})

import HomePage from '../src/pages/HomePage'
import CategoryPage from '../src/pages/CategoryPage'
import { useBusinessHours } from '../src/hooks/useBusinessHours'

describe('useBusinessHours：状态随时间推进而变化', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.hours.mockReturnValue(false) })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('跨过营业起点后自动翻成 true（这是原 bug 的核心）', () => {
    const { result } = renderHook(() => useBusinessHours())
    expect(result.current, '挂载时应在打烊态').toBe(false)
    mocks.hours.mockReturnValue(true)
    act(() => { vi.advanceTimersByTime(65_000) })
    expect(result.current, '过了一分钟仍未重算 ⇒ 状态被冻结在挂载那一刻').toBe(true)
  })

  it('反向：跨过打烊点后自动翻回 false', () => {
    mocks.hours.mockReturnValue(true)
    const { result } = renderHook(() => useBusinessHours())
    expect(result.current).toBe(true)
    mocks.hours.mockReturnValue(false)
    act(() => { vi.advanceTimersByTime(65_000) })
    expect(result.current, '打烊后仍显示营业中同样是冻结').toBe(false)
  })

  it('卸载后不再重算（定时器必须清掉，否则内存/无谓计算泄漏）', () => {
    const { unmount } = renderHook(() => useBusinessHours())
    const callsAtUnmount = mocks.hours.mock.calls.length
    unmount()
    act(() => { vi.advanceTimersByTime(300_000) })
    expect(mocks.hours.mock.calls.length, '卸载后仍在调用 isBusinessHours ⇒ 定时器没清').toBe(callsAtUnmount)
  })

  it('切回前台立即纠正（手机锁屏时定时器会被节流 ⇒ 必须补一条 visibilitychange）', () => {
    const { result } = renderHook(() => useBusinessHours())
    expect(result.current).toBe(false)
    mocks.hours.mockReturnValue(true)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current, '回到前台没有立即以真实时间纠正').toBe(true)
  })
})

describe('真实组件：首页封面的营业状态不许冻结', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.hours.mockReturnValue(false) })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('挂载时打烊，时间跨过起点后界面翻成「营业中」', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByText('已打烊')).toBeTruthy()
    mocks.hours.mockReturnValue(true)
    act(() => { vi.advanceTimersByTime(65_000) })
    expect(screen.queryByText('已打烊'), '首页封面仍显示已打烊 ⇒ 老大报的就是这个').toBeNull()
    expect(screen.getByText('营业中')).toBeTruthy()
  })

  it('分类页同样不许冻结（它连定时器都没有，是更严重的一处）', () => {
    const { container } = render(<MemoryRouter><CategoryPage /></MemoryRouter>)
    // 打烊态：闭店提示在页面上（用容器整体文本判，避免依赖某个具体节点的 aria 结构）
    expect(container.textContent, '挂载时应有闭店提示').toContain('当前非营业时间')
    mocks.hours.mockReturnValue(true)
    act(() => { vi.advanceTimersByTime(65_000) })
    expect(container.textContent, '分类页的闭店提示仍挂着 ⇒ 它没有定时器，是全部消费点里最严重的一处').not.toContain('当前非营业时间')
  })
})
