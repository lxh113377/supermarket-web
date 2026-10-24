import { useTheme } from '../../hooks/useTheme'

/**
 * 昼/夜切换钮（2026-10-25 v3）。
 * 图标语义：昼面显示月亮（点一下进夜），夜面显示太阳 —— 表示「将去往哪里」，
 * 与系统设置面板的通行语义一致。
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const toNight = theme === 'day'
  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle hover:bg-brand-50"
      aria-label={toNight ? '切换到夜间主题' : '切换到日间主题'}
      aria-pressed={!toNight}
      title={toNight ? '夜间主题' : '日间主题'}
    >
      {toNight ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
      {/* 切换结果播报：读屏用户按下后需要知道落到了哪个主题（aria-pressed 只表达开关态） */}
      <span className="sr-only" role="status">{theme === 'day' ? '当前为日间主题' : '当前为夜间主题'}</span>
    </button>
  )
}
