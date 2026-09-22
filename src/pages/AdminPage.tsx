import {  useCallback, useEffect, useRef, useState  } from 'react'
import { getCategories, getAdminProducts, seedCloudData, getAllOrders } from '../db'
import { IS_CLOUD } from '../cloudbase'
import DashboardTab from '../components/DashboardTab'
import ProductsTab from '../components/ProductsTab'
import OrdersTab from '../components/OrdersTab'
import ReviewsTab from '../components/ReviewsTab'
import SubmissionsTab from '../components/SubmissionsTab'
import type { Category, Order, Product } from '../types'
import { handleTablistKeyDown } from '../utils/rovingTabs'

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
  const [loading, setLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState('')
  const [productsError, setProductsError] = useState('')

  const orderTimer = useRef<number | null>(null)
  const pollDelay = useRef<number>(10000)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // H1-1 增量轮询状态：ordersRef 保存全量订单 Map（_id→order），cursorRef 保存上次同步的 maxUpdatedAt。
  // 首次全量拉取，之后带 since 只拉增量合并——轮询带宽从 O(全量) 降为 O(增量)。
  const ordersRef = useRef<Map<string, Order>>(new Map())
  const cursorRef = useRef<string | null>(null)
  const firstSyncRef = useRef(true)

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
      // H1-1 增量轮询：首次全量 + 记录游标；后续带 since 只拉增量合并。
      // 新增判定基于 prior 游标是否已建（新拉到的 _id 不在 Map 中即为新单，触发提示音）。
      const { orders: batch, maxUpdatedAt } = await getAllOrders({ since: cursorRef.current })
      const newlyAdded: string[] = []
      if (!firstSyncRef.current) {
        for (const o of batch) if (!ordersRef.current.has(o._id)) newlyAdded.push(o._id)
      } else {
        firstSyncRef.current = false
      }
      for (const o of batch) ordersRef.current.set(o._id, o)
      if (maxUpdatedAt) cursorRef.current = maxUpdatedAt
      const ords = [...ordersRef.current.values()]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      if (newlyAdded.length > 0) {
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
    if (tab === 'orders') {
      loadOrders()
      const scheduleNext = () => {
        orderTimer.current = setTimeout(async () => {
          // 页面不可见时跳过本轮请求（后台标签页挂着管理页不应持续打云函数），
          // 轮询本身继续排程，回到前台后 visibilitychange 会立即补拉一次
          if (!document.hidden) await loadOrders()
          scheduleNext()
        }, pollDelay.current)
      }
      scheduleNext()
      const onVisible = () => { if (!document.hidden) loadOrders() }
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        if (orderTimer.current) clearTimeout(orderTimer.current)
        document.removeEventListener('visibilitychange', onVisible)
      }
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
      <div className="flex flex-col items-center justify-center h-full gap-3" role="status" aria-live="polite">
        <div className="w-8 h-8 border-[3px] border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <span className="text-sm text-gray-400">加载中...</span>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-surface p-5 pb-24 w-full max-w-5xl lg:max-w-6xl mx-auto">
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
      {/* Tab 导航：补 tablist 语义（读屏能播报「第 N 个，共 5 个」），小屏字号收窄防挤压 */}
      <div
        role="tablist"
        aria-label="管理功能"
        className="flex gap-1.5 mb-5 bg-white p-1.5 rounded-2xl shadow-card border border-gray-100/80"
        onKeyDown={(e) =>
          handleTablistKeyDown(
            e,
            TABS.map((t) => t.key),
            tab,
            setTab,
            (v) => document.getElementById(`admin-tab-${v}`)?.focus(),
          )
        }
      >
        {TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`admin-panel-${t.key}`}
            id={`admin-tab-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            className={`flex-1 min-w-0 py-2.5 rounded-xl text-[11px] sm:text-xs font-medium transition-all duration-200 flex flex-col items-center gap-1 ${
              tab === t.key
                ? 'bg-gray-900 text-white shadow-soft'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="text-sm" aria-hidden="true">{t.icon}</span>
            <span className="truncate max-w-full">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab 内容 - 带入场动画（P0-6：去掉 key={tab}，避免整块 DOM 强制重挂载） */}
      <div
        className="animate-fade-in-up"
        role="tabpanel"
        id={`admin-panel-${tab}`}
        aria-labelledby={`admin-tab-${tab}`}
      >
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'products' && (
          <>
            {productsError && (
              <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3" role="alert">
                <span aria-hidden="true">⚠️</span> 商品数据加载失败：{productsError}
              </div>
            )}
            <ProductsTab products={products} categories={categories} onDataChange={loadProducts} />
          </>
        )}
        {tab === 'orders' && (
          <OrdersTab
            orders={orders}
            onOrdersChange={(list) => {
              // 变更（状态/删除）后重建全量基线并重置游标：下次轮询回到全量，防止增量 Map 残留已删单/旧状态
              ordersRef.current = new Map(list.map((o) => [o._id, o]))
              cursorRef.current = null
              firstSyncRef.current = false
              setOrders(list)
            }}
            loading={ordersLoading}
          />
        )}
        {tab === 'submissions' && <SubmissionsTab />}
        {tab === 'reviews' && <ReviewsTab />}
      </div>
    </div>
  )
}
