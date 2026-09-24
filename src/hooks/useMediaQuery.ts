import { useEffect, useState } from 'react'

/**
 * 媒体查询 hook。窄屏判定必须走 JS 条件渲染而不是 CSS `hidden`：
 * 同一操作（如「加入购物车」）在 DOM 里留两份，读屏会念出两个同名主操作，
 * Playwright 严格模式选择器也会直接报 resolved to 2 elements（详情页实测踩过）。
 *
 * jsdom / 无 matchMedia 环境返回 `false`（按宽屏处理），让单测只看到一套结构。
 */
export default function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false

  const [matches, setMatches] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    setMatches(mq.matches) // 首帧之后校正一次，覆盖 SSR/懒挂载的偏差
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** 是否窄屏（< lg 断点 1024px） */
export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 1023.98px)')
}
