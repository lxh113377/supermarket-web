import React, { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import TopNav from '../components/TopNav'
import ProductCard from '../components/ProductCard'
import useCart from '../hooks/useCart'
import useProducts from '../hooks/useProducts'
import type { Product } from '../types'

interface FlyDotData {
  id: number
  x: number
  y: number
  tx: number
  ty: number
}

// ---- 骨架屏组件 ----
function SkeletonCard() {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl bg-white border border-gray-100/80">
      <div className="flex-1 pr-3 space-y-2.5">
        <div className="h-4 skeleton-shimmer w-3/4" />
        <div className="h-3.5 skeleton-shimmer w-1/4" />
      </div>
      <div className="w-8 h-8 rounded-full skeleton-shimmer" />
    </div>
  )
}

// ---- 加购飞行动画 ----
function FlyDot({ x, y, tx, ty, onDone }: Omit<FlyDotData, 'id'> & { onDone: () => void }) {
  const endX = tx - 10
  const endY = ty - 10
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: x,
    top: y,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#eab308',
    zIndex: 60,
    pointerEvents: 'none' as const,
    transition: 'all 0.6s cubic-bezier(0.5,0,0,1)',
    boxShadow: '0 2px 8px rgba(234,179,8,0.4)',
  })

  // onDone 通过 ref 持有，避免 effect 依赖不稳定的内联回调导致动画重复触发
  const onDoneRef = useRef(onDone)
  // 渲染提交后同步最新回调（react/refs 要求不在渲染期写 ref；timeout 读取时序不变）
  useEffect(() => { onDoneRef.current = onDone })

  useEffect(() => {
    setStyle(s => ({ ...s, left: endX, top: endY, width: 6, height: 6, opacity: 0 }))
    const t = setTimeout(() => onDoneRef.current(), 650)
    return () => clearTimeout(t)
  }, [endX, endY])

  return <div style={style} />
}

export default function CustomerPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { add, remove, totalCount, totalAmount, getQuantity } = useCart()
  const { categories, products, loading, error, refresh } = useProducts()
  const [activeTop, setActiveTop] = useState('')
  const [activeSub, setActiveSub] = useState('')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [flyDots, setFlyDots] = useState<FlyDotData[]>([])
  const [sortBy, setSortBy] = useState('default')
  const cartBtnRef = useRef<HTMLDivElement | null>(null)

  const deferredSearch = useDeferredValue(search)

  // 当前顶级分类的子分类 ID 集合
  const currentTopSubIds = useMemo(() => {
    const cat = categories.find(c => c._id === activeTop) || categories[0]
    if (!cat) return new Set()
    return new Set(cat.subcategories.map(s => s.id))
  }, [categories, activeTop])

  const filteredProducts = useMemo(() => {
    let list
    if (activeSub) {
      // 选了具体子分类：按子分类过滤
      list = products.filter(p => p.subcategories?.includes(activeSub))
    } else {
      // "全部"：只显示当前顶级分类下的商品
      list = products.filter(p =>
        p.subcategories?.some(sub => currentTopSubIds.has(sub))
      )
    }

    if (deferredSearch) {
      const q = deferredSearch.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.spec || '').toLowerCase().includes(q)
      )
    }
    // 排序
    if (sortBy === 'price-asc') list = [...list].sort((a, b) => a.price - b.price)
    else if (sortBy === 'price-desc') list = [...list].sort((a, b) => b.price - a.price)
    return list
  }, [products, activeSub, currentTopSubIds, deferredSearch, sortBy])

  // 搜索建议
  const suggestions = useMemo(() => {
    if (!search || search.length < 1) return []
    const q = search.toLowerCase()
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || (p.spec || '').toLowerCase().includes(q)
    ).slice(0, 5)
  }, [products, search])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 1200)
  }

  const handleAdd = (product: Product, e?: React.MouseEvent) => {
    add(product)
    showToast('已添加 ' + product.name)
    const rect = e?.currentTarget?.getBoundingClientRect?.() || null
    if (rect) {
      const ct = cartBtnRef.current?.getBoundingClientRect()
      // 事件回调内生成飞行点 id（非渲染期调用；oxlint purity 静态分析无法区分调用时机，行内豁免）
      // oxlint-disable-next-line react/purity
      const dotId = Date.now() + Math.random()
      setFlyDots(prev => [...prev, {
        id: dotId,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        tx: ct ? ct.left + ct.width / 2 : rect.left + 100,
        ty: ct ? ct.top + ct.height / 2 : rect.top + 400,
      }])
    }
  }

  const handleRemove = (product: Product) => {
    remove(product._id)
  }

  const removeDot = (id: number) => setFlyDots(prev => prev.filter(d => d.id !== id))

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <TopNav categories={[]} activeSub="" onSubChange={() => {}} onSearchToggle={() => {}} showSearch={false} />
        <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <span className="text-3xl">😵</span>
        <p className="text-red-400 text-sm text-center">{error}</p>
        <button
          onClick={refresh}
          className="mt-2 px-5 py-2.5 btn-secondary text-sm"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 返回栏 */}
      <div className="flex items-center px-4 py-2.5 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => (location.state?.fromCategory ? navigate(-1) : navigate('/'))}
          aria-label="返回"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
        >
          ←
        </button>
        <span className="ml-2 text-sm font-semibold text-gray-800">
          {location.state?.title || categories.find((c) => c._id === activeTop)?.name || '全部商品'}
        </span>
      </div>
      <TopNav
        categories={categories}
        activeSub={activeSub}
        onSubChange={setActiveSub}
        onTopChange={setActiveTop}
        onSearchToggle={() => setShowSearch(!showSearch)}
        showSearch={showSearch}
      />

      {/* 搜索栏 */}
      {showSearch && (
        <div className="px-4 pb-2.5 animate-slide-down">
          <input
            type="text"
            className="input-base"
            placeholder="搜索商品名称…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {suggestions.length > 0 && (
            <div className="mt-2 bg-white border border-gray-100 rounded-xl shadow-elevated overflow-hidden animate-scale-in">
              {suggestions.map(p => (
                <button
                  key={p._id}
                  onClick={() => { setSearch(p.name); setShowSearch(false) }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-brand-50/50 flex justify-between items-center transition-colors duration-150 border-b border-gray-50 last:border-0"
                >
                  <span className="text-gray-700">{p.name}{p.spec ? ` (${p.spec})` : ''}</span>
                  <span className="text-brand-600 text-xs font-semibold">¥{p.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 排序 */}
      <div className="px-4 pb-2.5 flex gap-2">
        {[
          { key: 'default', label: '默认' },
          { key: 'price-asc', label: '价格↑' },
          { key: 'price-desc', label: '价格↓' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setSortBy(s.key)}
            className={sortBy === s.key ? 'pill-active' : 'pill-inactive'}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-32">
        {filteredProducts.length === 0 && !deferredSearch && (
          <div className="flex flex-col items-center gap-2 mt-16 text-gray-300">
            <span className="text-4xl">🛒</span>
            <span className="text-sm">暂无该类商品</span>
          </div>
        )}
        {filteredProducts.length === 0 && deferredSearch && (
          <div className="flex flex-col items-center gap-2 mt-16 text-gray-300">
            <span className="text-4xl">🔍</span>
            <span className="text-sm">未找到 "{deferredSearch}" 相关商品</span>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredProducts.map(product => (
            <ProductCard
              key={product._id}
              product={product}
              quantity={getQuantity(product._id)}
              onAdd={(e) => handleAdd(product, e)}
              onRemove={() => handleRemove(product)}
            />
          ))}
        </div>
      </div>

      {/* Toast - 更精致的弹出 */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-scale-in">
          <div className="bg-gray-900/90 backdrop-blur-sm text-white text-sm px-5 py-2.5 rounded-full shadow-float">
            {toast}
          </div>
        </div>
      )}

      {/* 飞行动画 */}
      {flyDots.map(d => (
        <FlyDot key={d.id} x={d.x} y={d.y} tx={d.tx} ty={d.ty} onDone={() => removeDot(d.id)} />
      ))}

      {/* 购物车浮球 - 更圆润 */}
      {totalCount > 0 && (
        <div className="fixed bottom-5 left-5 right-5 z-30 animate-slide-up" ref={cartBtnRef}>
          <button
            onClick={() => navigate('/cart')}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-2xl shadow-float flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98]"
          >
            <span className="font-medium">购物车</span>
            <span className="bg-brand-500 px-2.5 py-0.5 rounded-full text-xs font-bold">
              {totalCount} 件
            </span>
            <span className="font-bold text-brand-300">¥{totalAmount.toFixed(2)}</span>
          </button>
        </div>
      )}

    </div>
  )
}
