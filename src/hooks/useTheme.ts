import { useCallback, useEffect, useState } from 'react'

/**
 * 昼 / 夜 双主题（2026-10-25 v3）。
 *
 * 口径：主题只换 index.css 里 :root[data-theme='night'] 那一层语义槽的取值，
 * 类名与 DOM 零改动；色块横带（褐黑首屏 / 森林绿门帘 / 页脚）两主题恒定，
 * 它们是「木料与门帘」，不随昼夜换色。
 *
 * 默认 = 昼（暖纸）。理由：① 白昼是顾客的主使用时段，暖纸+色块的编辑式版式
 * 是配色卡自身的语言；② 仓库既有的渲染级判据（layout.spec 的暖白页底钉值、
 * chartOptions 的白卡对比度对账）全部以昼面为基准，默认昼 = 判据零漂移。
 * 夜主题保留 v1/v2 的「夜里亮灯的铺子」气质，作为可切换的第二面孔。
 *
 * 持久化走 localStorage（sm_theme）；首帧在 <html> 上落 data-theme，
 * 避免刷新时闪一下默认主题（FOUC）。
 */
export type ThemeName = 'day' | 'night'

const THEME_KEY = 'sm_theme'

function readStored(): ThemeName {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'night' ? 'night' : 'day'
  } catch {
    return 'day'
  }
}

function applyTheme(name: ThemeName) {
  if (typeof document === 'undefined') return
  if (name === 'night') document.documentElement.setAttribute('data-theme', 'night')
  else document.documentElement.removeAttribute('data-theme')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', name === 'night' ? '#241E19' : '#FAFAF9')
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => readStored())

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* 隐私模式静默 */ }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'day' ? 'night' : 'day'))
  }, [])

  return { theme, toggle }
}
