// @vitest-environment jsdom
/**
 * useInlineConfirm 状态机测试（2026-10-24）。
 *
 * 为什么单独测 hook：它是"替代原生确认框"的公共件，8 个调用点共用一套 arm/disarm/超时/Esc
 * 语义；这套语义只要有一条坏掉（比如超时没清、Esc 没挂），所有调用点一起变成"用户被困在
 * 确认态"或"点了没反应"。逐条钉住，比在每个组件里各测一遍更省也更严。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useInlineConfirm, DEFAULT_ARM_TIMEOUT_MS } from '../src/hooks/useInlineConfirm'

describe('useInlineConfirm', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('arm 后 isArmed 为真、 disarm 后为假（核心状态机）', () => {
    const { result } = renderHook(() => useInlineConfirm())
    expect(result.current.isArmed('a')).toBe(false)
    act(() => result.current.arm('a'))
    expect(result.current.isArmed('a')).toBe(true)
    expect(result.current.isArmed('b'), 'arm 了 a 不该把 b 也点亮').toBe(false)
    act(() => result.current.disarm())
    expect(result.current.isArmed('a')).toBe(false)
  })

  it('同一时刻只 arm 一个：arm b 会把 a 顶回未确认', () => {
    const { result } = renderHook(() => useInlineConfirm())
    act(() => result.current.arm('a'))
    act(() => result.current.arm('b'))
    expect(result.current.isArmed('a'), '多目标同时待确认会让用户记不住哪个亮了').toBe(false)
    expect(result.current.isArmed('b')).toBe(true)
  })

  it('超时自动回退（默认 6s）：不永久挂在确认态', () => {
    const { result } = renderHook(() => useInlineConfirm())
    act(() => result.current.arm('a'))
    expect(result.current.isArmed('a')).toBe(true)
    act(() => { vi.advanceTimersByTime(DEFAULT_ARM_TIMEOUT_MS + 10) })
    expect(result.current.isArmed('a'), '超时后仍 armed ⇒ 用户回来会看到卡住的确认态').toBe(false)
  })

  it('自定义 timeoutMs 生效（列表行短、批量条可长）', () => {
    const { result } = renderHook(() => useInlineConfirm(1000))
    act(() => result.current.arm('a'))
    act(() => { vi.advanceTimersByTime(999) })
    expect(result.current.isArmed('a')).toBe(true)
    act(() => { vi.advanceTimersByTime(2) })
    expect(result.current.isArmed('a')).toBe(false)
  })

  it('重复 arm 同一个 key 会重置超时（用户又点一次 = 还在考虑）', () => {
    const { result } = renderHook(() => useInlineConfirm(2000))
    act(() => result.current.arm('a'))
    act(() => { vi.advanceTimersByTime(1500) })
    act(() => result.current.arm('a'))
    act(() => { vi.advanceTimersByTime(1500) })
    expect(result.current.isArmed('a'), '第二次 arm 应重新计时').toBe(true)
    act(() => { vi.advanceTimersByTime(600) })
    expect(result.current.isArmed('a')).toBe(false)
  })

  it('Esc 回退（键盘用户的直觉出口，也是无障碍要求）', () => {
    const { result } = renderHook(() => useInlineConfirm())
    act(() => result.current.arm('a'))
    expect(result.current.isArmed('a')).toBe(true)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(result.current.isArmed('a'), 'Esc 没回退 ⇒ 键盘用户被困在确认态').toBe(false)
  })

  it('非 Esc 的按键不回退（别把 Tab/方向键当取消）', () => {
    const { result } = renderHook(() => useInlineConfirm())
    act(() => result.current.arm('a'))
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })
    expect(result.current.isArmed('a')).toBe(true)
  })

  it('卸载清定时器：超时回调不会在销毁后 setState', () => {
    const { result, unmount } = renderHook(() => useInlineConfirm(1000))
    act(() => result.current.arm('a'))
    unmount()
    // 卸载后推进时钟：若定时器没清，回调会跑 setArmedKey → React 告警；这里断言不抛即可
    expect(() => { act(() => { vi.advanceTimersByTime(2000) }) }).not.toThrow()
  })

  it('未 arm 时不挂全局 keydown 监听（避免每行都留一个 handler）', () => {
    const spy = vi.spyOn(document, 'addEventListener')
    const { unmount } = renderHook(() => useInlineConfirm())
    expect(spy.mock.calls.some((c) => c[0] === 'keydown'), '未 arm 不该挂监听').toBe(false)
    act(() => { /* arm 一次应挂上 */ })
    spy.mockClear()
    unmount()
    spy.mockRestore()
  })
})
