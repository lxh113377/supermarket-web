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
import { formatYuan } from '../utils/format'
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
        (p.spec || '').toLowerCase().includes(needle)
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
      p.name.toLowerCase().includes(needle) || (p.spec || '').toLowerCase().includes(needle)
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

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <TopNav
          categories={[]}
          activeTop=""
          activeSub=""
          onTopChange={() => {}}
          onSubChange={() => {}}
          onSearchToggle={() => {}}
          showSearch={false}
        />
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

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 返回栏：标题取 URL 命中的真实分类，不再依赖 location.state.title
          （CategoryPage 从来没传过这个字段，导致从「生活›超市」进来恒显「全部商品」，
          而下方导航高亮的是「饮品」——两处说法打架）。 */}
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
      <TopNav
        categories={categories}
        activeTop={category?._id ?? ''}
        activeSub={subId}
        onTopChange={selectCategory}
        onSubChange={selectSub}
        onSearchToggle={() => setShowSearch(!showSearch)}
        showSearch={showSearch}
      />

      {/* 搜索栏 */}
      {showSearch && (
        <div className="px-4 pb-2.5 animate-slide-down">
          <input
            type="search"
            className="input-base"
            placeholder="搜索商品名称…"
            aria-label="搜索商品名称"
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
                  <span className="text-brand-600 text-xs font-semibold">{formatYuan(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 排序：选中态原先只靠 pill-active 类着色表达，读屏与键盘用户拿不到「当前按什么排」，
          故补 role=group + aria-pressed；排序确实改变了下方列表顺序，文案与行为一致。 */}
      <div className="px-4 pb-2.5 flex gap-2" role="group" aria-label="商品排序方式">
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

      {/* 筛选结果计数：分类/子分类/搜索/排序任一变化都会改写这里的数字，
          作为 aria-live 区域播报，避免视力正常用户也要靠数卡片才知道筛完了 */}
      <p className="px-4 pb-2 text-xs text-gray-500" role="status" aria-live="polite">
        共 {filteredProducts.length} 件
        {deferredQ && <> · 匹配「{deferredQ}」</>}
        {sort !== 'default' && <> · 按{sort === 'price-asc' ? '价格升序' : '价格降序'}</>}
      </p>

      <div className="flex-1 overflow-y-auto p-4 pb-32">
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
        {/* 响应式：手机 1 列 → 平板 2 列 → 桌面 3 列（原实现桌面也只排 2 列） */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 enter-stagger">
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
      </div>

      {/* Toast：补 role="status" + aria-live —— 加购成功这类瞬时反馈此前读屏完全听不到 */}
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

      {/* 飞行动画 */}
      {flyDots.map(d => (
        <FlyDot key={d.id} x={d.x} y={d.y} tx={d.tx} ty={d.ty} onDone={() => removeDot(d.id)} />
      ))}

      {/* 购物车浮球 - 更圆润 */}
      {/* 底部位置改用 .safe-offset-bottom：原 bottom-5 会被 iPhone 底部小黑条盖住结算入口 */}
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

    </div>
  )
}
