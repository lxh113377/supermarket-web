import {  useCallback, useEffect, useRef, useState  } from 'react'
import { getCategories, getAdminProducts, seedCloudData, getAllOrders } from '../db'
import { IS_CLOUD } from '../cloudbase'
import DashboardTab from '../components/DashboardTab'
import ProductsTab from '../components/ProductsTab'
import OrdersTab from '../components/OrdersTab'
import ReviewsTab from '../components/ReviewsTab'
import SubmissionsTab from '../components/SubmissionsTab'
import type { Category, Order, Product } from '../types'
import WorkspaceShell, { type WorkspaceTab } from '../components/brand/WorkspaceShell'
import { useInlineConfirm } from '../hooks/useInlineConfirm'

const TABS: readonly WorkspaceTab[] = [
  { key: 'dashboard', label: '看板', icon: 'chart' },
  { key: 'products', label: '商品', icon: 'box' },
  { key: 'orders', label: '订单', icon: 'receipt' },
  { key: 'submissions', label: '服务', icon: 'service' },
  { key: 'reviews', label: '评价', icon: 'star' },
]

const TAB_COPY: Record<string, [string, string]> = {
  dashboard: ['经营看板', '看见营收、订单与商品表现，找到今天值得关注的事。'],
  products: ['商品管理', '价格、口味与上架状态，一处更新，顾客端同步。'],
  orders: ['订单处理', '从下单到送达，每笔订单都有清楚的下一步。'],
  submissions: ['服务工单', '集中处理顾客提交的生活与学习服务。'],
  reviews: ['顾客评价', '听顾客怎么说，把每一次反馈变成下一次改进。'],
}

export default function AdminPage() {
  const [tab, setTab] = useState('products')
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  // 导入种子是一次性、不可逆的写操作，走内联两步确认替代原生 confirm()
  const { arm: armSeed, disarm: disarmSeed, isArmed: seedArmed } = useInlineConfirm()
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
    disarmSeed()
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
        <span className="text-sm text-stone-500">加载中...</span>
      </div>
    )
  }

  return (
    <WorkspaceShell tab={tab} tabs={TABS} onTabChange={setTab} title={TAB_COPY[tab][0]} description={TAB_COPY[tab][1]}>
      {!IS_CLOUD && (
        <div className="workspace-demo-note" role="status">
          <span>本地演示模式</span><p>数据仅保存在当前浏览器，不会写入线上数据。</p>
        </div>
      )}
      {IS_CLOUD && products.length === 0 && (
        <div className="mb-5 bg-brand-50/80 border border-brand-200/60 rounded-2xl p-4 space-y-3 animate-slide-down">
          <p className="text-brand-700 text-xs">云端模式已启用，但暂无商品数据</p>
          <button
            onClick={() => (seedArmed('seed') ? doSeed() : armSeed('seed'))}
            onBlur={disarmSeed}
            disabled={seeding}
            aria-label={seedArmed('seed') ? '确认导入种子数据（仅首次需要）' : '导入种子数据'}
            className={
              'w-full py-2.5 text-sm rounded-xl font-semibold transition-colors duration-200 disabled:opacity-50 ' +
              (seedArmed('seed') ? 'bg-red-700 text-white' : 'btn-primary')
            }
          >
            {seeding ? '初始化中...' : seedArmed('seed') ? '确认导入种子数据' : '导入种子数据'}
          </button>
          {seedMsg && <p className="text-brand-700 text-xs">{seedMsg}</p>}
        </div>
      )}
      <div className="workspace-panel" role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'products' && (
          <>
            {productsError && <div className="mb-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3" role="alert">商品数据加载失败：{productsError}</div>}
            <ProductsTab products={products} categories={categories} onDataChange={loadProducts} />
          </>
        )}
        {tab === 'orders' && (
          <OrdersTab orders={orders} onOrdersChange={(list) => {
            ordersRef.current = new Map(list.map((o) => [o._id, o]))
            cursorRef.current = null
            firstSyncRef.current = false
            setOrders(list)
          }} loading={ordersLoading} />
        )}
        {tab === 'submissions' && <SubmissionsTab />}
        {tab === 'reviews' && <ReviewsTab />}
      </div>
    </WorkspaceShell>
 )
}
