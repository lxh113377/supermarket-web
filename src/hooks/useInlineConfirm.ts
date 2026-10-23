import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 内联两步确认（arm → confirm）—— 替代浏览器原生确认框的状态机。
 *
 * 为什么要有它（2026-10-24，清第十七轮登记的那笔棘轮欠账）：原生确认框阻塞整条主线程、
 * 样式完全由浏览器决定（与本站「纸 + 墨 + 柿」的品牌毫无关系），是模板站最直观的痕迹之一；
 * 而本仓有硬红线：后台禁弹窗/禁抽屉，唯一交互是内联展开 ⇒ 既不能上自定义 modal，也不该
 * 用 Overlay 那套 dialog 来做二次确认。native-dialogs 判据从 2026-10-23 起把它登记成
 * 棘轮（现值 8、只准降不准升），注释原话是「清零要改 8 处控制流，属独立一轮工作」。
 *
 * 交互口径（一次设计取舍，逐条都有理由）：
 *   ① **同一时刻只 arm 一个**（armedKey 是单值）：一行列表里每个条目都有自己的删除按钮，
 *      若允许多个同时待确认，用户会记不住哪个已经点亮；点 B 时 A 自动回退更符合直觉。
 *   ② **再点一次 = 确认**，而不是「出现第二个确认按钮」：待确认态下按钮文字变成
 *      「确认删除」并换成红底，视觉上已经足够明确；再加一个「取消」按钮会挤坏行内布局
 *      （这些按钮都在一排操作里，宽度是紧的），而取消有三条路（见 ③④⑤）。
 *   ③ **超时自动回退**（默认 6s）：用户点亮后走开、回来发现按钮卡在「确认删除」上，
 *      是比原生弹窗更糟的体验；6s 够读完一句话并决定，又不至于永久挂起。
 *   ④ **Esc 回退**：键盘用户的直觉出口，也是无障碍要求（对话框语义里 Esc 就该取消）。
 *   ⑤ **焦点移出即回退**（onBlur）：点了同一行别的按钮/别的地方，说明意图已变。
 *      ③④⑤ 合起来保证「取消」永远有路可走 —— 这是这个方案能不加「取消」按钮的前提，
 *      缺任何一条都会变成"用户被困在确认态"。
 *
 * 用法（调用方负责把 isArmed 映射到文案/样式/aria-label）：
 *   const { arm, disarm, isArmed } = useInlineConfirm()
 *   <button onClick={() => (isArmed(id) ? doDelete(id) : arm(id))} onBlur={disarm}
 *     aria-label={isArmed(id) ? '确认删除该订单（不可撤销）' : '删除订单'}>
 *
 * 不做的事：不持久化、不跨组件共享 —— 待确认态是**瞬时意图**，刷新后不该复活。
 */
export const DEFAULT_ARM_TIMEOUT_MS = 6000

export function useInlineConfirm(timeoutMs: number = DEFAULT_ARM_TIMEOUT_MS) {
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const disarm = useCallback(() => {
    clearTimer()
    setArmedKey(null)
  }, [clearTimer])

  /** 点亮某个待确认目标；重复 arm 同一个 key 会重置超时（用户又点了一次 = 还在考虑） */
  const arm = useCallback((key: string) => {
    clearTimer()
    setArmedKey(key)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setArmedKey(null)
    }, timeoutMs)
  }, [clearTimer, timeoutMs])

  const isArmed = useCallback((key: string) => armedKey !== null && armedKey === key, [armedKey])

  // Esc 回退：只在有 armed 目标时挂监听，避免给每个列表项都留一个全局 handler
  useEffect(() => {
    if (armedKey === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') disarm() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [armedKey, disarm])

  // 卸载清定时器：否则超时回调会在组件已销毁后 setState（React 会告警，且是真实泄漏）
  useEffect(() => clearTimer, [clearTimer])

  return { armedKey, arm, disarm, isArmed }
}
