import type { KeyboardEvent } from 'react'

/**
 * tablist 方向键导航（WAI-ARIA APG roving tabindex）：
 * 左右键 / Home / End 切换选中并移动焦点。容器内按钮的 tabIndex 只给选中项 0、其余 -1，
 * Tab 键一次即可离开整组（APG 期望行为，原生按钮组做不到）。
 * 约定：每个 tab 按钮需带 id={`tab-${value}`} 供聚焦（AdminPage 的既有 id 除外，见 onFocusTab）。
 */
export function handleTablistKeyDown(
  e: KeyboardEvent<HTMLDivElement>,
  values: string[],
  current: string,
  onPick: (value: string) => void,
  focusTab?: (value: string) => void,
): void {
  const idx = values.indexOf(current)
  if (idx < 0) return
  let next = -1
  if (e.key === 'ArrowRight') next = (idx + 1) % values.length
  else if (e.key === 'ArrowLeft') next = (idx - 1 + values.length) % values.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = values.length - 1
  if (next < 0) return
  e.preventDefault()
  onPick(values[next])
  // 状态更新是异步的，但按钮 DOM 始终存在，直接聚焦即可
  const target = focusTab ?? ((v: string) => document.getElementById(`tab-${v}`)?.focus())
  target(values[next])
}
