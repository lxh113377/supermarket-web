import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getCategories, getAdminProducts, getAllReviews, seedCloudData, getAllOrders } from '../db'
import { IS_CLOUD } from '../cloudbase'
import DashboardTab from '../components/DashboardTab'
import ProductsTab from '../components/ProductsTab'
import OrdersTab from '../components/OrdersTab'
import ReviewsTab from '../components/ReviewsTab'
import SubmissionsTab from '../components/SubmissionsTab'
import type { Category, Order, Product, Review } from '../types'

const TABS = [
  { key: 'dashboard', label: '看板', icon: '📊' },
  { key: 'products', label: '商品', icon: '📦' },
  { key: 'orders', label: '订单', icon: '🧾' },
  { key: 'submissions', label: '服务', icon: '📋' },
  { key: 'reviews', label: '评价', icon: '⭐' },
]

export default function AdminPage() {
  const [tab, setTab] = useState('products')
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState('')
  const [productsError, setProductsError] = useState('')

  const prevOrderIds = useRef<Set<string>>(new Set())
  const orderTimer = useRef<number | null>(null)
  const pollDelay = useRef<number>(10000)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const loadCategories = useCallback(async () => {
    const cats = await getCategories()
    setCategories(cats)
  }, [])

  const loadProducts = useCallback(async () => {
    try {
      const prods = await getAdminProducts()
      setProducts(prods)
      setProductsError('')
    } catch (e) {
      // 管理端读取失败显式报错，不静默回退本地（掩盖后端故障）
      setProducts([])
      setProductsError(e instanceof Error ? e.message : '获取商品列表失败，请检查后端服务')
    }
  }, [])

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      // 循环拉全量（getOrders 默认 50 条，直接取会截断；getAllOrders 按 hasMore 循环合并）
      const ords = await getAllOrders()
      const ids = new Set(ords.map(o => o._id))
      if (prevOrderIds.current.size > 0) {
        const added = [...ids].filter(id => !prevOrderIds.current.has(id))
        if (added.length > 0) {
          try {
            if (!audioCtxRef.current) {
              // Safari 旧内核前缀 API：精确类型替代 as any；webkitAudioContext 缺失时 new 抛错仍由外层 catch 吞掉（行为不变）
              const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!
              audioCtxRef.current = new AC()
            }
            const ctx = audioCtxRef.current
            const osc = ctx.createOscillator(); const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.frequency.value = 880; gain.gain.value = 0.3
            osc.start(); osc.stop(ctx.currentTime + 0.15)
          } catch {}
        }
      }
      prevOrderIds.current = ids
      setOrders(ords)
      pollDelay.current = 10000
    } catch {
      pollDelay.current = Math.min(pollDelay.current * 2, 60000)
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([loadCategories(), loadOrders()])
      .catch(()=>{})
      .finally(() => setLoading(false))
  }, [loadCategories, loadOrders])

  useEffect(() => {
    if (tab === 'products') loadProducts()
  }, [tab, loadProducts])

  useEffect(() => {
    if (tab !== 'dashboard') return
    getAllReviews()
      .then((revs) => setReviews(revs))
      .catch(() => setReviews([]))
  }, [tab])

  useEffect(() => {
    if (tab === 'orders') {
      loadOrders()
      const scheduleNext = () => {
        orderTimer.current = setTimeout(async () => {
          await loadOrders()
          scheduleNext()
        }, pollDelay.current)
      }
      scheduleNext()
      return () => { if (orderTimer.current) clearTimeout(orderTimer.current) }
    }
    if (orderTimer.current) { clearTimeout(orderTimer.current); orderTimer.current = null }
  }, [tab, loadOrders])

  const doSeed = async () => {
    if (!confirm('将创建云端集合并导入种子商品（仅首次需要）。确定？')) return
    setSeeding(true); setSeedMsg('')
    try {
      const r = await seedCloudData()
      setSeedMsg(`初始化成功：分类 ${r.categories} 个，商品 ${r.products} 个`)
      loadProducts()
    } catch (err) { setSeedMsg('初始化失败：' + (err instanceof Error ? err.message : '未知错误')) }
    finally { setSeeding(false) }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <span className="text-sm text-gray-400">加载中...</span>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-surface p-5 pb-24">
      {/* 标题区 */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-900">管理后台</h1>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${IS_CLOUD ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
          {IS_CLOUD ? '云端模式' : '本地演示'}
        </span>
      </div>

      {/* 状态提示 */}
      {!IS_CLOUD && (
        <div className="mb-5 bg-amber-50/80 border border-amber-200/60 text-amber-700 text-xs rounded-2xl p-4 animate-slide-down">
          当前为<strong>本地演示模式</strong>，数据仅保存在浏览器中
        </div>
      )}
      {IS_CLOUD && products.length === 0 && (
        <div className="mb-5 bg-brand-50/80 border border-brand-200/60 rounded-2xl p-4 space-y-3 animate-slide-down">
          <p className="text-brand-700 text-xs">云端模式已启用，但暂无商品数据</p>
          <button onClick={doSeed} disabled={seeding} className="btn-primary w-full py-2.5 text-sm">
            {seeding ? '初始化中...' : '导入种子数据'}
          </button>
          {seedMsg && <p className="text-brand-600 text-xs">{seedMsg}</p>}
        </div>
      )}

      {/* Tab 导航 - 更精致的分段控件 */}
      <div className="flex gap-1.5 mb-5 bg-white p-1.5 rounded-2xl shadow-card border border-gray-100/80">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 flex flex-col items-center gap-1 ${
              tab === t.key
                ? 'bg-gray-900 text-white shadow-soft'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="text-sm">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 - 带入场动画（P0-6：去掉 key={tab}，避免整块 DOM 强制重挂载） */}
      <div className="animate-fade-in-up">
        {tab === 'dashboard' && <DashboardTab orders={orders} products={products} reviews={reviews} />}
        {tab === 'products' && (
          <>
            {productsError && (
              <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3">
                ⚠️ 商品数据加载失败：{productsError}
              </div>
            )}
            <ProductsTab products={products} categories={categories} onDataChange={loadProducts} />
          </>
        )}
        {tab === 'orders' && <OrdersTab orders={orders} onOrdersChange={setOrders} loading={ordersLoading} />}
        {tab === 'submissions' && <SubmissionsTab />}
        {tab === 'reviews' && <ReviewsTab />}
      </div>
    </div>
  )
}
