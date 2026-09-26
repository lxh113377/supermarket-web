import React, { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import TopNav from '../components/TopNav'
import ProductCard from '../components/ProductCard'
import FlyDot from '../components/shop/FlyDot'
import EmptyState from '../components/EmptyState'
import { SkeletonList } from '../components/Skeleton'
import { IconCart, IconEmpty } from '../components/Icons'
import useCart from '../hooks/useCart'
import useProducts from '../hooks/useProducts'
import { useShopFilters, SORT_OPTIONS } from '../hooks/useShopFilters'
import { useIsNarrow } from '../hooks/useMediaQuery'
import { formatYuan } from '../utils/format'
import { specSearchText } from '../utils/spec-options'
import { prefetchRoute } from '../prefetchBus'
import type { Product } from '../types'

interface FlyDotData {
  id: number
  x: number
  y: number
  tx: number
  ty: number
}

export default function CustomerPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { add, remove, totalCount, totalAmount, getQuantity } = useCart()
  const { categories, products, loading, error, refresh } = useProducts()
  const { category, subId, q, sort, selectCategory, selectSub, setQuery, setSortBy } =
    useShopFilters(categories)
  const narrow = useIsNarrow()
  const [toast, setToast] = useState('')
  const [showSearch, setShowSearch] = useState(() => q !== '')
  const [flyDots, setFlyDots] = useState<FlyDotData[]>([])
  const cartBtnRef = useRef<HTMLDivElement | null>(null)

  // 搜索框的值走本地草稿，不直接绑 URL 派生的 q：中文输入法在「每次按键都往返写
  // URL」的受控输入下会丢字（组合输入未完成就被回写覆盖）。URL 仍是筛选的唯一真相，
  // 草稿只是编辑缓冲；外部改地址（返回键 / 深链）时由下面的 effect 把缓冲对齐。
  const [draftQ, setDraftQ] = useState(q)
  useEffect(() => { setDraftQ(q) }, [q])

  const deferredQ = useDeferredValue(q)

  // 当前顶级分类的子分类 ID 集合
  const currentTopSubIds = useMemo(() => {
    if (!category) return new Set<string>()
    return new Set(category.subcategories.map(s => s.id))
  }, [category])

  const filteredProducts = useMemo(() => {
    let list
    if (subId) {
      // 选了具体子分类：按子分类过滤
      list = products.filter(p => p.subcategories?.includes(subId))
    } else {
      // "全部"：只显示当前顶级分类下的商品
      list = products.filter(p =>
        p.subcategories?.some(sub => currentTopSubIds.has(sub))
      )
    }

    if (deferredQ) {
      const needle = deferredQ.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(needle) ||
        specSearchText(p).toLowerCase().includes(needle)
      )
    }
    // 排序
    if (sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price)
    else if (sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price)
    return list
  }, [products, subId, currentTopSubIds, deferredQ, sort])

  // 搜索建议
  const suggestions = useMemo(() => {
    if (!draftQ || draftQ.length < 1) return []
    const needle = draftQ.toLowerCase()
    return products.filter(p =>
      p.name.toLowerCase().includes(needle) || specSearchText(p).toLowerCase().includes(needle)
    ).slice(0, 5)
  }, [products, draftQ])

  // toast 定时器需可清理：原实现每次 showToast 直接 setTimeout 且无人回收，
  // 组件卸载（如点返回）后仍会执行 setState，产生「已卸载组件更新」告警。
  const toastTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(''), 1200)
  }, [])

  // handleAdd / handleRemove 用 useCallback 固定引用：
  // ProductCard 已 memo，回调若每次渲染都新建则 memo 完全失效。
  const handleAdd = useCallback((product: Product, e?: React.MouseEvent) => {
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
  }, [add, showToast])

  // 减数量也要播报：原先每张商品卡自带一个 aria-live 报数字，55 张卡就是 55 个
  // live region，加一次购读屏会连播一屏。现统一收敛到页面级这一条 toast。
  const handleRemove = useCallback((product: Product) => {
    remove(product._id)
    showToast('已减少 ' + product.name)
  }, [remove, showToast])

  const removeDot = (id: number) => setFlyDots(prev => prev.filter(d => d.id !== id))

  const activeSubName = category?.subcategories.find(s => s.id === subId)?.name

  // TopNav 在两种布局里位置不同（手机在滚动容器之上、桌面在滚动容器内的左栏），
  // 且必须只存在一个实例，所以按断点条件渲染而不是 CSS 隐藏。
  const nav = (
    <TopNav
      categories={categories}
      activeTop={category?._id ?? ''}
      activeSub={subId}
      onTopChange={selectCategory}
      onSubChange={selectSub}
      onSearchToggle={() => setShowSearch(!showSearch)}
      showSearch={showSearch}
    />
  )

  const searchPanel = showSearch && (
    <div className="pb-3 animate-slide-down">
      <input
        type="search"
        className="input-base"
        placeholder="搜索商品名称或口味…"
        aria-label="搜索商品名称或口味"
        value={draftQ}
        onChange={(e) => { setDraftQ(e.target.value); setQuery(e.target.value) }}
        autoFocus
      />
      {suggestions.length > 0 && (
        <div className="mt-2 bg-white border border-gray-100 rounded-xl shadow-elevated overflow-hidden animate-scale-in">
          {suggestions.map(p => (
            <button
              key={p._id}
              onClick={() => { setDraftQ(p.name); setQuery(p.name); setShowSearch(false) }}
              className="w-full text-left px-4 py-3 text-sm hover:bg-brand-50/50 flex justify-between items-center transition-colors duration-150 border-b border-gray-50 last:border-0"
            >
              <span className="text-gray-700">{p.name}{p.spec ? ` (${p.spec})` : ''}</span>
              <span className="text-brand-700 text-xs font-semibold">{formatYuan(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const sortRow = (
    <div className="flex gap-2" role="group" aria-label="商品排序方式">
      {SORT_OPTIONS.map(s => (
        <button
          key={s.key}
          onClick={() => setSortBy(s.key)}
          aria-pressed={sort === s.key}
          className={sort === s.key ? 'pill-active' : 'pill-inactive'}
        >
          {s.label}
        </button>
      ))}
    </div>
  )

  // 筛选结果计数：分类/子分类/搜索/排序任一变化都会改写这里的数字，
  // 作为 aria-live 区域播报，避免视力正常用户也要靠数卡片才知道筛完了
  const counterRow = (
    <p className="text-xs text-gray-500" role="status" aria-live="polite">
      共 {filteredProducts.length} 件
      {deferredQ && <> · 匹配「{deferredQ}」</>}
      {sort !== 'default' && <> · 按{sort === 'price-asc' ? '价格升序' : '价格降序'}</>}
    </p>
  )

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-surface">
        {nav}
        <div className="flex-1 overflow-y-auto p-4 pb-24">
          <SkeletonList rows={6} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6" role="alert">
        <span className="text-3xl" aria-hidden="true">😵</span>
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

  const grid = (
    <>
      {filteredProducts.length === 0 && !deferredQ && (
        <EmptyState
          className="mt-10"
          icon={<IconCart className="w-6 h-6" />}
          title="暂无该类商品"
          description="换个分类看看，或稍后再来"
        />
      )}
      {filteredProducts.length === 0 && deferredQ && (
        <EmptyState
          className="mt-10"
          icon={<IconEmpty className="w-6 h-6" />}
          title={`未找到「${deferredQ}」相关商品`}
          description="试试更短的关键词，或换个说法"
        />
      )}
      {/* 图注式网格：手机双列（微信内拇指区刚好一屏四件）→ 平板三列 → 桌面四列。
          旧版是手机单列横排小图，桌面也才三列，图片只有 56px，等于没有图。 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-5 enter-stagger">
        {filteredProducts.map(product => (
          <ProductCard
            key={product._id}
            product={product}
            quantity={getQuantity(product._id)}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </>
  )

  /* ---------------- 桌面：刊头 + 左侧分类栏 + 右侧画廊 ---------------- */
  if (!narrow) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="flex items-center px-6 lg:px-10 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-100">
          <button
            onClick={() => (location.state?.fromCategory ? navigate(-1) : navigate('/'))}
            aria-label="返回"
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200 -ml-2 mr-3"
          >
            ←
          </button>
          <span className="text-sm font-semibold tracking-[0.2em] text-gray-400">江科一站通</span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 lg:px-10 py-6 pb-28">
          <div className="flex gap-8 items-start max-w-[80rem] mx-auto">
            {nav}

            <div className="flex-1 min-w-0">
              {/* 刊头：分类当卷名，子类与件数当副题 —— 这是"杂志"隐喻的落点 */}
              <div className="flex items-end justify-between gap-4 flex-wrap pb-4 mb-5 border-b border-gray-200">
                <div className="min-w-0">
                  <h1 className="text-3xl font-bold tracking-tight text-gray-900 leading-none">
                    {category?.name || '全部商品'}
                  </h1>
                  <p className="text-xs text-gray-400 mt-2 tracking-wide">
                    {activeSubName || '全部'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2.5">
                  {sortRow}
                  {counterRow}
                </div>
              </div>

              {searchPanel}
              {grid}
            </div>
          </div>
        </div>

        {totalCount > 0 && (
          <div className="safe-offset-bottom fixed left-5 right-5 z-30 animate-slide-up" ref={cartBtnRef}>
            <button
              onClick={() => navigate('/cart')}
              onMouseEnter={() => prefetchRoute('cart')}
              onFocus={() => prefetchRoute('cart')}
              aria-label={`查看购物车，共 ${totalCount} 件，合计 ${formatYuan(totalAmount)}`}
              className="w-full max-w-2xl mx-auto bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-2xl shadow-float flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98]"
            >
              <span className="font-medium">购物车</span>
              <span className="bg-brand-500 px-2.5 py-0.5 rounded-full text-xs font-bold">
                {totalCount} 件
              </span>
              <span className="font-bold text-brand-300">{formatYuan(totalAmount)}</span>
            </button>
          </div>
        )}
        {toastLayer(toast)}
        {flyDots.map(d => (
          <FlyDot key={d.id} x={d.x} y={d.y} tx={d.tx} ty={d.ty} onDone={() => removeDot(d.id)} />
        ))}
      </div>
    )
  }

  /* ---------------- 手机 / 平板：顶部横条 + 双列大图 ---------------- */
  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center px-4 py-2.5 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => (location.state?.fromCategory ? navigate(-1) : navigate('/'))}
          aria-label="返回"
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
        >
          ←
        </button>
        <span className="ml-2 text-sm font-semibold text-gray-800">
          {category?.name || '全部商品'}
        </span>
      </div>
      {nav}

      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-32">
        {searchPanel}
        <div className="flex items-center justify-between gap-3 flex-wrap pb-2">
          {sortRow}
          {counterRow}
        </div>
        {grid}
      </div>

      {totalCount > 0 && (
        <div className="safe-offset-bottom fixed left-5 right-5 z-30 animate-slide-up" ref={cartBtnRef}>
          <button
            onClick={() => navigate('/cart')}
            onMouseEnter={() => prefetchRoute('cart')}
            onFocus={() => prefetchRoute('cart')}
            aria-label={`查看购物车，共 ${totalCount} 件，合计 ${formatYuan(totalAmount)}`}
            className="w-full max-w-2xl mx-auto bg-gray-900 hover:bg-gray-800 text-white py-4 rounded-2xl shadow-float flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98]"
          >
            <span className="font-medium">购物车</span>
            <span className="bg-brand-500 px-2.5 py-0.5 rounded-full text-xs font-bold">
              {totalCount} 件
            </span>
            <span className="font-bold text-brand-300">{formatYuan(totalAmount)}</span>
          </button>
        </div>
      )}
      {toastLayer(toast)}
      {flyDots.map(d => (
        <FlyDot key={d.id} x={d.x} y={d.y} tx={d.tx} ty={d.ty} onDone={() => removeDot(d.id)} />
      ))}
    </div>
  )
}

/** 瞬时反馈统一走这一条页面级 live region（取代旧版每卡一个 aria-live） */
function toastLayer(toast: string) {
  return (
    <div
      className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toast && (
        <div className="bg-gray-900/90 backdrop-blur-sm text-white text-sm px-5 py-2.5 rounded-full shadow-float animate-scale-in">
          {toast}
        </div>
      )}
    </div>
  )
}
