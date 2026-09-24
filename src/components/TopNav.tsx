import { useEffect, useRef } from 'react'
import { Skeleton } from './Skeleton'
import { useIsNarrow } from '../hooks/useMediaQuery'
import type { Category } from '../types'

interface TopNavProps {
  categories: Category[]
  /** 受控：当前大类完全由 URL 派生，组件内不再自存一份（原先两份靠回调单向同步会错位） */
  activeTop: string
  activeSub: string
  onTopChange: (id: string) => void
  onSubChange: (id: string) => void
  onSearchToggle: () => void
  showSearch: boolean
}

/**
 * 商品分类导航（阶段二「暖白画廊」）。
 *
 * 两端各自设计，且**按断点条件渲染、不是 CSS 隐藏**：
 * 手机（<1024）是顶部横条 —— 大类 tab 一行 + 子类滑轨一行，贴合微信内单手浏览；
 * 桌面（≥1024）是左侧竖排栏 —— 大类当刊头、子类当目录项，右侧让出整片画廊。
 * 两套结构若同时留在 DOM 里，读屏会念到两组同名按钮，Playwright 严格模式也会当场失败
 * （详情页吸底栏踩过同一个坑）。
 */
export default function TopNav({
  categories,
  activeTop,
  activeSub,
  onTopChange,
  onSubChange,
  onSearchToggle,
  showSearch,
}: TopNavProps) {
  const narrow = useIsNarrow()
  // 选中子分类后自动滚到可见区：原实现横向滚动条不会跟随，手机上常出现
  // 「点了沙发分类，但标签在屏幕外，看不出选了什么」。
  const activeSubRef = useRef<HTMLButtonElement | null>(null)
  const mountedRef = useRef(false)

  const currentCategory = categories.find(c => c._id === activeTop)

  useEffect(() => {
    // 首次挂载不滚动（避免页面加载时把视口带偏）
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    activeSubRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [activeSub])

  const handleTopChange = (id: string) => {
    // 切大类时清空子分类筛选：由调用方写回 URL，本组件不持有状态
    onSubChange('')
    onTopChange(id)
  }

  const searchButton = (
    <button
      onClick={onSearchToggle}
      aria-label={showSearch ? '关闭搜索' : '搜索商品'}
      aria-pressed={showSearch}
      className={`shrink-0 px-3.5 py-3.5 transition-all duration-200 ${showSearch ? 'text-brand-600 scale-110' : 'text-gray-300 hover:text-gray-500'}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </button>
  )

  // 目录尚未到达时渲染骨架占位而不是整条导航消失：原先返回 null 会让导航栏在数据
  // 到达后重新挂载，选中态归零，用户看到「分类条闪一下又跳回第一个」。
  if (!currentCategory) {
    return (
      <nav aria-label="商品分类导航" aria-busy="true" className="bg-white/95 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-20 shadow-soft">
        <div className="flex items-center gap-2 px-3 py-3.5 max-w-5xl mx-auto">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-4 flex-1 rounded-md" />)}
        </div>
        <div className="flex gap-2 px-3 py-2.5 bg-surface-warm max-w-5xl mx-auto">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-7 w-16 rounded-full" />)}
        </div>
      </nav>
    )
  }

  /* ---------- 桌面：左侧竖排分类栏 ---------- */
  if (!narrow) {
    return (
      <nav aria-label="商品分类导航" className="w-52 shrink-0 lg:sticky lg:top-5 lg:self-start lg:max-h-[calc(100dvh-2.5rem)] lg:overflow-y-auto pr-1">
        <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-gray-200">
          <span className="text-xs font-semibold tracking-[0.18em] text-gray-400">分类</span>
          {searchButton}
        </div>

        <div role="group" aria-label="商品大类" className="mt-1">
          {categories.map(cat => (
            <div key={cat._id} className="mt-4">
              <button
                onClick={() => handleTopChange(cat._id)}
                aria-label={`切换到${cat.name}分类`}
                aria-pressed={activeTop === cat._id}
                className={`w-full text-left text-sm font-bold tracking-wide transition-colors duration-200 pb-1.5 border-b ${
                  activeTop === cat._id
                    ? 'text-brand-700 border-brand-400'
                    : 'text-gray-400 border-transparent hover:text-gray-700'
                }`}
              >
                {cat.name}
              </button>
              {/* 子类只在当前大类下展开：竖排栏空间够，不必像手机端那样挤成一条滑轨 */}
              {activeTop === cat._id && (
                <div role="group" aria-label="子分类筛选" tabIndex={0}
                  className="mt-1.5 flex flex-col gap-0.5 focus-visible:outline-2 focus-visible:outline-brand-500">
                  <button
                    onClick={() => onSubChange('')}
                    aria-label="显示全部商品"
                    aria-pressed={activeSub === ''}
                    className={`text-left px-2 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                      activeSub === '' ? 'bg-brand-500 text-white font-medium shadow-soft' : 'text-gray-500 hover:bg-brand-50 hover:text-brand-700'
                    }`}
                  >
                    全部
                  </button>
                  {cat.subcategories.map(sub => (
                    <button
                      key={sub.id}
                      ref={activeSub === sub.id ? activeSubRef : undefined}
                      onClick={() => onSubChange(sub.id)}
                      aria-label={`切换到${sub.name}分类`}
                      aria-pressed={activeSub === sub.id}
                      className={`text-left px-2 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                        activeSub === sub.id ? 'bg-brand-500 text-white font-medium shadow-soft' : 'text-gray-500 hover:bg-brand-50 hover:text-brand-700'
                      }`}
                    >
                      {sub.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </nav>
    )
  }

  /* ---------- 手机 / 平板：顶部横条 ---------- */
  return (
    <nav aria-label="商品分类导航" className="bg-white/95 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-20">
      <div className="flex items-center max-w-5xl mx-auto border-b border-gray-100" role="group" aria-label="商品大类">
        {categories.map(cat => (
          <button
            key={cat._id}
            onClick={() => handleTopChange(cat._id)}
            aria-label={`切换到${cat.name}分类`}
            aria-pressed={activeTop === cat._id}
            className={`flex-1 min-w-0 px-1 py-3.5 text-center text-xs sm:text-sm font-medium transition-all duration-200 relative ${
              activeTop === cat._id
                ? 'text-brand-700'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="block truncate">{cat.name}</span>
            {activeTop === cat._id && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-[3px] bg-brand-500 rounded-full" />
            )}
          </button>
        ))}
        {searchButton}
      </div>
      {/* 子分类横向滚动区：加 tabIndex 让键盘用户也能用方向键滚动（原生 overflow 区默认不可聚焦）。
          桌面端不走这条分支（改由左侧竖排栏承载），所以这里不再需要 lg:flex-wrap。 */}
      <div
        role="group"
        aria-label="子分类筛选"
        tabIndex={0}
        className="flex overflow-x-auto whitespace-nowrap px-3 py-2.5 gap-2 bg-surface-warm scrollbar-hide max-w-5xl mx-auto focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        <button
          onClick={() => onSubChange('')}
          aria-label="显示全部商品"
          aria-pressed={activeSub === ''}
          className={activeSub === '' ? 'pill-active' : 'pill-inactive'}
        >
          全部
        </button>
        {currentCategory.subcategories.map(sub => (
          <button
            key={sub.id}
            ref={activeSub === sub.id ? activeSubRef : undefined}
            onClick={() => onSubChange(sub.id)}
            aria-label={`切换到${sub.name}分类`}
            aria-pressed={activeSub === sub.id}
            className={activeSub === sub.id ? 'pill-active' : 'pill-inactive'}
          >
            {sub.name}
          </button>
        ))}
      </div>
    </nav>
  )
}
