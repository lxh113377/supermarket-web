import {  useState, useMemo  } from 'react'
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

  const currentCategory = useMemo(
    () => categories.find(c => c._id === activeTop) || categories[0],
    [categories, activeTop]
  )

  if (!currentCategory) return null

  const handleTopChange = (id: string) => {
    setActiveTop(id)
    onSubChange('')
    if (onTopChange) onTopChange(id)
  }

  return (
    <div className="bg-white/95 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-20 shadow-soft">
      <div className="flex items-center">
        {categories.map(cat => (
          <button
            key={cat._id}
            onClick={() => handleTopChange(cat._id)}
            aria-label={`切换到${cat.name}分类`}
            aria-pressed={activeTop === cat._id}
            className={`flex-1 py-3.5 text-center text-sm font-medium transition-all duration-200 relative ${
              activeTop === cat._id
                ? 'text-brand-600'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {cat.name}
            {activeTop === cat._id && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-brand-500 rounded-full" />
            )}
          </button>
        ))}
        {/* 搜索按钮 */}
        <button
          onClick={onSearchToggle}
          aria-label={showSearch ? '关闭搜索' : '搜索商品'}
          className={`px-3.5 py-3.5 transition-all duration-200 ${showSearch ? 'text-brand-600 scale-110' : 'text-gray-300 hover:text-gray-500'}`}
          title="搜索"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>
      <div className="flex overflow-x-auto whitespace-nowrap px-3 py-2.5 gap-2 bg-surface-warm scrollbar-hide">
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
            onClick={() => onSubChange(sub.id)}
            aria-label={`切换到${sub.name}分类`}
            aria-pressed={activeSub === sub.id}
            className={activeSub === sub.id ? 'pill-active' : 'pill-inactive'}
          >
            {sub.name}
          </button>
        ))}
      </div>
    </div>
  )
}
