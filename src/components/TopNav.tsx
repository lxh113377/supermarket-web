import { useState, useMemo, useEffect, useRef } from 'react'
import type { Category } from '../types'

interface TopNavProps {
  categories: Category[]
  activeSub: string
  onSubChange: (id: string) => void
  onSearchToggle: () => void
  showSearch: boolean
  onTopChange?: (id: string) => void
}

export default function TopNav({ categories, activeSub, onSubChange, onSearchToggle, showSearch, onTopChange }: TopNavProps) {
  const [activeTop, setActiveTop] = useState(categories[0]?._id || '')
  // 选中子分类后自动滚到可见区：原实现横向滚动条不会跟随，手机上常出现
  // 「点了沙发分类，但标签在屏幕外，看不出选了什么」。
  const activeSubRef = useRef<HTMLButtonElement | null>(null)
  const mountedRef = useRef(false)

  const currentCategory = useMemo(
    () => categories.find(c => c._id === activeTop) || categories[0],
    [categories, activeTop]
  )

  useEffect(() => {
    // 首次挂载不滚动（避免页面加载时把视口带偏）
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    activeSubRef.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }, [activeSub])

  if (!currentCategory) return null

  const handleTopChange = (id: string) => {
    setActiveTop(id)
    onSubChange('')
    if (onTopChange) onTopChange(id)
  }

  return (
    <nav aria-label="商品分类导航" className="bg-white/95 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-20 shadow-soft">
      <div className="flex items-center max-w-5xl mx-auto" role="group" aria-label="商品大类">
        {categories.map(cat => (
          <button
            key={cat._id}
            onClick={() => handleTopChange(cat._id)}
            aria-label={`切换到${cat.name}分类`}
            aria-pressed={activeTop === cat._id}
            className={`flex-1 min-w-0 px-1 py-3.5 text-center text-xs sm:text-sm font-medium transition-all duration-200 relative ${
              activeTop === cat._id
                ? 'text-brand-600'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="block truncate">{cat.name}</span>
            {activeTop === cat._id && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-brand-500 rounded-full" />
            )}
          </button>
        ))}
        {/* 搜索按钮 */}
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
      </div>
      {/* 子分类横向滚动区：加 tabIndex 让键盘用户也能用方向键滚动（原生 overflow 区域默认不可聚焦）。
          lg 及以上屏宽改为换行平铺（lg:flex-wrap + 关闭横向滚动）：桌面/平板不再出现横向滚动条，
          一屏看全全部子分类；小屏保持横滚 + scrollbar-hide，入口位置与移动端习惯不变。 */}
      <div
        role="group"
        aria-label="子分类筛选"
        tabIndex={0}
        className="flex overflow-x-auto whitespace-nowrap px-3 py-2.5 gap-2 bg-surface-warm scrollbar-hide max-w-5xl mx-auto focus-visible:outline-2 focus-visible:outline-brand-500 lg:flex-wrap lg:justify-center lg:overflow-x-visible lg:whitespace-normal"
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
