import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getProducts, getCategories, getLocalProductReviews, getCloudReviews } from '../db'
import { reviews as seedReviews } from '../data/reviews-seed'
import useCart from '../hooks/useCart'
import ProductGallery, { type GalleryItem } from '../components/product/ProductGallery'
import VariantPicker from '../components/product/VariantPicker'
import DemoOrderSummary from '../components/product/DemoOrderSummary'
import ProductInfoSections from '../components/product/ProductInfoSections'
import RelatedProducts from '../components/product/RelatedProducts'
import ReviewList, { Stars } from '../components/product/ReviewList'
import ReviewForm from '../components/product/ReviewForm'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import { IconEmpty } from '../components/Icons'
import { productImageUrl, productSrcSet } from '../utils/images'
import { formatYuan } from '../utils/format'
import { variantGroupOf } from '../data/variants-demo'
import {
  groupImageOrders,
  initialSelection,
  parseComboKey,
  pickCombo,
  resolveCombo,
  type Selection,
  type VariantGroup,
} from '../utils/variants'
import type { Category, Product, Review } from '../types'

// 商品详情页
// 桌面端：左侧大幅主图 + 缩略图列，右侧标题/介绍/价格/规格选择/购买入口/配送说明；
// 平板与手机自然重排为单列，页面允许纵向滚动（不设固定画布、不裁切内容）。
//
// 「立即购买」只弹演示订单摘要，不建单、不跳 /order-confirm、不接支付；
// 真实下单链路仍由 购物袋 → 确认订单 → 支付 承担。
//
// 变体（口味/包装/容量）取自 src/data/variants-demo.ts 本地演示层：
// 每个可售组合的编号、单价、商品名、图片都对应目录里的真实商品行，聚合关系已在
// disclosure 里如实标注为演示交互。无变体数据的商品不渲染选择器，不编造规格。

/** 某轴某选项 id → 展示文案 */
function optionLabel(group: VariantGroup, axisId: string, optionId: string): string {
  if (optionId === '') return '（无）'
  const axis = group.axes.find((a) => a.id === axisId)
  return axis?.options.find((o) => o.id === optionId)?.label ?? optionId
}

/**
 * 是否为窄屏（< lg 断点 1024px）。吸底加购栏按它**条件渲染**而不是只藏 CSS：
 * 两份「加入购物车」同时存在于 DOM 会让辅助技术读到两个同名主操作，
 * 也会让 e2e 的严格模式选择器直接失败（实测踩过）。
 * jsdom / 无 matchMedia 环境返回 false（按桌面处理），此时只渲染右栏那一个。
 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 1023.98px)').matches
      : false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 1023.98px)')
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    setNarrow(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export default function ProductDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add, getQuantity } = useCart()
  const [product, setProduct] = useState<Product | null>(null)
  const [catalog, setCatalog] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewSort, setReviewSort] = useState('newest')
  const [userReviews, setUserReviews] = useState<Review[]>([])
  const [cloudReviews, setCloudReviews] = useState<Review[]>([])
  const [selectionOverride, setSelectionOverride] = useState<Selection | null>(null)
  const [autoNote, setAutoNote] = useState('')
  const [qty, setQty] = useState(1)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [addedNote, setAddedNote] = useState('')

  const orderNum = product?.order != null ? product.order
    : (product?._id ? parseInt(String(product._id).replace(/\D/g, ''), 10) : null)
  const imgSrc = product?.image || productImageUrl(orderNum)

  // 变体组与图集（必须在条件 return 之前计算，遵守 Hooks 顺序）
  const group = useMemo(() => variantGroupOf(orderNum), [orderNum])

  const galleryItems: GalleryItem[] = useMemo(() => {
    if (group) {
      return groupImageOrders(group).map((order) => {
        // 同一 order 可能对应多个组合（白象帮泡装三个口味共用一条记录）——
        // 取声明顺序第一个可售组合，点这张图就落到那个规格。
        const entry = Object.entries(group.combos).find(([, c]) => c.available && c.order === order)
        if (!entry) return { src: productImageUrl(order) ?? '', srcSet: productSrcSet(order), order }
        const [key, combo] = entry
        const spec = combo.specText ? ` ${combo.specText}` : ''
        return {
          src: productImageUrl(order) ?? '',
          srcSet: productSrcSet(order),
          sizes: '(max-width: 1023px) 100vw, 560px',
          label: `查看图片：${combo.productName}${spec}`,
          selection: parseComboKey(group, key),
          order,
        }
      }).filter((it) => it.src !== '')
    }
    const own = Array.isArray(product?.images) ? (product!.images as string[]).filter(Boolean) : []
    if (own.length > 0) return own.map((src) => ({ src }))
    return imgSrc ? [{ src: imgSrc, srcSet: productSrcSet(orderNum) }] : []
  }, [group, product, imgSrc, orderNum])

  // 当前选择 = 用户显式选择，否则派生为该商品自身对应的真实规格。
  // 刻意不用「effect 事后回填 selection」：那样首帧 selection 为空，
  // 规格选择器会先闪一遍未选中态再跳成正确值（真实缺陷，非测试噪声）。
  const selection = useMemo<Selection>(
    () => selectionOverride ?? (group ? initialSelection(group, orderNum) : {}),
    [selectionOverride, group, orderNum],
  )

  const combo = group ? resolveCombo(group, selection) : undefined
  const effName = combo ? combo.productName : (product?.name ?? '')
  const effSpec = combo?.specText ?? product?.spec
  const effPrice = combo ? combo.price : (product?.price ?? 0)
  const effOrder = combo ? combo.order : orderNum

  /** 当前主图序号：以选中变体对应的真实 order 为准（主图与规格双向联动） */
  const activeIdx = Math.max(0, galleryItems.findIndex((it) => Number(it.order) === Number(effOrder)))

  /** 入购物袋的商品对象：优先用变体对应的那条真实目录记录（价格/规格/_id 才对得上） */
  const cartProduct = useMemo(() => {
    if (!product) return null
    if (combo == null) return product
    return catalog.find((p) => Number(p.order) === combo.order) ?? product
  }, [product, combo, catalog])

  useEffect(() => {
    let cancelled = false
    async function load() {
      // 换商品时把瞬时态与 load 结果放在同一批更新里重置，
      // 避免先渲染出上一个商品的规格/数量/摘要再纠正
      setSelectionOverride(null)
      setAutoNote('')
      setQty(1)
      setAddedNote('')
      setSummaryOpen(false)
      try {
        const [products, cats] = await Promise.all([getProducts(), getCategories()])
        if (cancelled) return
        setCatalog(products)
        setCategories(cats)
        setProduct(products.find((p) => p._id === id || String(p.order) === id) || null)
      } catch {
        if (!cancelled) {
          setCatalog([])
          setProduct(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    let cancelled = false
    if (product?.order != null) {
      setUserReviews(getLocalProductReviews(product.order) || [])
      // P0-3 修复：异步请求加取消保护，快速切换商品时旧评价不覆盖新商品
      getCloudReviews(product.order)
        .then((revs) => { if (!cancelled) setCloudReviews(revs) })
        .catch(() => { if (!cancelled) setCloudReviews([]) })
    } else {
      setUserReviews([])
      setCloudReviews([])
    }
    return () => { cancelled = true }
  }, [product])

  const productReviews = useMemo(() => {
    const fallback = product ? seedReviews.filter((r) => r.productOrder === product.order) : []
    const merged = [...cloudReviews, ...userReviews, ...fallback]
    if (reviewSort === 'highest') return [...merged].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    if (reviewSort === 'lowest') return [...merged].sort((a, b) => (a.rating || 0) - (b.rating || 0))
    return merged // newest：云端已按 createdAt 倒序，本地新评价在前
  }, [cloudReviews, userReviews, product, reviewSort])

  const refreshReviews = () => {
    if (product?.order == null) return
    setUserReviews(getLocalProductReviews(product.order) || [])
    getCloudReviews(product.order)
      .then(setCloudReviews)
      .catch(() => setCloudReviews([]))
  }

  /**
   * 改规格：用户点的那一项一定生效（pickCombo 硬钉该轴），
   * 其余轴若凑不出可售组合则自动回落，并把回落事实播报出来 —— 不静默改用户的规格。
   */
  const handleAxisChange = useCallback((axisId: string, optionId: string) => {
    if (!group) return
    const requested: Selection = { ...selection, [axisId]: optionId }
    const exact = resolveCombo(group, requested)
    const picked = pickCombo(group, requested, axisId)
    if (!picked) return
    setSelectionOverride(picked.selection)
    if (exact) {
      setAutoNote('')
      return
    }
    const moved = group.axes.find(
      (a) => a.id !== axisId && (selection[a.id] ?? '') !== (picked.selection[a.id] ?? ''),
    )
    setAutoNote(moved
      ? `「${optionLabel(group, axisId, optionId)}」与${moved.name}「${optionLabel(group, moved.id, selection[moved.id] ?? '')}」没有可售组合，${moved.name}已自动切为「${optionLabel(group, moved.id, picked.selection[moved.id] ?? '')}」，当前 ${formatYuan(picked.combo.price)}。`
      : '')
  }, [group, selection])

  /** 点缩略图 / 翻图：切主图的同时把规格切过去（同一份 selection 驱动，不会两态打架） */
  const applyItemSelection = useCallback((item?: GalleryItem) => {
    if (!group || !item?.selection) return
    const picked = pickCombo(group, item.selection)
    if (!picked) return
    setSelectionOverride(picked.selection)
    setAutoNote('')
  }, [group])

  const handleAdd = useCallback((n = qty) => {
    if (!cartProduct) return
    add(cartProduct, n)
    setAddedNote(`已把 ${n} 件「${effName}」加入购物袋`)
  }, [add, cartProduct, qty, effName])

  const avgRating = productReviews.length > 0
    ? (productReviews.reduce((s, r) => s + r.rating, 0) / productReviews.length).toFixed(1)
    : null
  const inBag = getQuantity(cartProduct?._id ?? '')
  const narrow = useIsNarrow()

  if (loading) {
    // 加载态与列表页统一为骨架屏（原先是转圈 spinner，与 CustomerPage 的 SkeletonList 两种语言）
    return (
      <div className="flex flex-col h-full bg-surface" role="status" aria-live="polite" aria-label="内容加载中">
        <div className="flex items-center px-4 py-3.5 bg-white/95 border-b border-gray-100">
          <Skeleton className="w-9 h-9 rounded-full" />
          <Skeleton className="h-4 w-32 rounded-md ml-3" />
        </div>
        <div className="flex-1 overflow-hidden">
          <Skeleton className="w-full aspect-square rounded-none" />
          <div className="bg-white mt-2.5 p-5 space-y-3">
            <Skeleton className="h-5 w-2/3 rounded-md" />
            <Skeleton className="h-4 w-1/4 rounded-md" />
          </div>
          <div className="bg-white mt-2.5 p-5 space-y-2.5">
            <Skeleton className="h-4 w-1/3 rounded-md" />
            <Skeleton className="h-3.5 w-full rounded-md" />
            <Skeleton className="h-3.5 w-5/6 rounded-md" />
          </div>
        </div>
        <span className="sr-only">内容加载中</span>
      </div>
    )
  }

  if (!product) {
    return (
      <EmptyState
        className="h-full justify-center"
        icon={<IconEmpty className="w-6 h-6" />}
        title="商品不存在或已下架"
        description="可能已被商家下架，去看看其他商品吧"
        action={
          <button onClick={() => navigate('/')} className="btn-primary px-5 py-2.5 text-sm">
            返回首页
          </button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 顶栏 */}
      <div className="flex items-center px-4 py-3.5 bg-white/95 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200 mr-2"
        >
          ←
        </button>
        <h1 className="text-sm font-bold text-gray-900 truncate">{effName}</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-28 lg:pb-10 w-full">
        {/* 面包屑：把这一页接回「首页 › 生活 › 零食饮料」的真实入口 */}
        <nav aria-label="面包屑" className="max-w-6xl mx-auto px-4 lg:px-6 pt-3">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400 list-none m-0 p-0 flex-wrap">
            <li><Link to="/" className="hover:text-brand-600 text-gray-500">首页</Link></li>
            <li aria-hidden="true">›</li>
            <li><Link to="/category/life" className="hover:text-brand-600 text-gray-500">生活</Link></li>
            <li aria-hidden="true">›</li>
            <li><Link to="/shop" className="hover:text-brand-600 text-gray-500">零食饮料</Link></li>
            <li aria-hidden="true">›</li>
            <li className="text-gray-700 truncate max-w-[12rem]" aria-current="page">{effName}</li>
          </ol>
        </nav>

        {/* 桌面双栏：左图集（含缩略图列） / 右购买信息；平板手机单列纵向堆叠。
            左栏给 1.25fr：1440 下主图实测约 470px，撑得起「大幅商品主图」；
            1.05fr 时只有 421px，被缩略图列和网格比例挤小了。
            lg:items-start 不能省：网格默认 align-items:stretch 会把左栏卡片拉到与右栏等高，
            图片下方留出一大块空白（实测截图可见）。 */}
        <div className="max-w-3xl lg:max-w-6xl mx-auto lg:grid lg:items-start lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-8 lg:px-6 lg:py-5">
          <ProductGallery
            key={product._id}
            product={product}
            gallery={[]}
            items={galleryItems}
            index={group ? activeIdx : undefined}
            onIndexChange={(i) => applyItemSelection(galleryItems[i])}
            onItemSelect={(_i, item) => applyItemSelection(item)}
          />

          <div className="px-4 lg:px-0">
            {/* 标题 / 价格 / 规格 */}
            <div className="bg-white lg:bg-transparent mt-2.5 lg:mt-0 p-5 lg:p-0 animate-fade-in-up stagger-1">
              <h2 className="text-xl lg:text-2xl font-bold text-gray-900 min-w-0 leading-snug">{effName}</h2>
              {effSpec && <p className="text-sm text-gray-500 mt-1.5">规格：{effSpec}</p>}
              {avgRating && (
                <div className="flex items-center gap-2 mt-3">
                  <Stars rating={Math.round(Number(avgRating))} />
                  <span className="text-xs text-gray-400">{avgRating} 分 · {productReviews.length} 条评价</span>
                </div>
              )}
              <p className="text-3xl font-bold text-brand-600 mt-4 tabular-nums">{formatYuan(effPrice)}</p>
              {combo && Number(effOrder) !== Number(product.order) && (
                <p className="text-xs text-gray-400 mt-1">
                  价格随所选规格变化 · 当前对应目录编号 {String(effOrder)}
                </p>
              )}
            </div>

            {/* 规格选择 */}
            {group && (
              <div className="bg-white lg:bg-transparent mt-2.5 lg:mt-6 p-5 lg:p-0 lg:border-t lg:border-gray-100 lg:pt-5 animate-fade-in-up stagger-2">
                <VariantPicker
                  group={group}
                  selection={selection}
                  onChange={handleAxisChange}
                  autoAdjustNote={autoNote}
                />
              </div>
            )}

            {/* 商品介绍 */}
            {product.description && (
              <div className="bg-white lg:bg-transparent mt-2.5 lg:mt-6 p-5 lg:p-0 lg:border-t lg:border-gray-100 lg:pt-5 animate-fade-in-up stagger-2">
                <h3 className="section-title mb-3">商品介绍</h3>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{product.description}</p>
              </div>
            )}

            {/* 购买入口：宽屏在此处给按钮，窄屏交给吸底栏 —— 二选一，
                任何视口下 DOM 里都只有一个「加入购物车」，辅助技术不会读到两个同名主操作 */}
            <div className="bg-white lg:bg-transparent mt-2.5 lg:mt-6 p-5 lg:p-0 lg:border-t lg:border-gray-100 lg:pt-5 animate-fade-in-up stagger-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl px-1">
                  <button
                    type="button"
                    onClick={() => setQty((n) => Math.max(1, n - 1))}
                    disabled={qty <= 1}
                    aria-label="减少购买数量"
                    className="tap-44 w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <span
                    role="status"
                    aria-label="购买数量"
                    className="text-sm font-semibold text-gray-900 w-10 text-center tabular-nums"
                  >{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty((n) => Math.min(99, n + 1))}
                    disabled={qty >= 99}
                    aria-label="增加购买数量"
                    className="tap-44 w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span aria-hidden="true">＋</span>
                  </button>
                </div>

                {!narrow && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAdd()}
                      className="btn-primary px-6 py-3 text-sm rounded-xl"
                    >
                      加入购物车
                    </button>
                    <button
                      type="button"
                      onClick={() => setSummaryOpen(true)}
                      className="btn-secondary px-5 py-3 text-sm rounded-xl"
                    >
                      立即购买（演示摘要）
                    </button>
                  </>
                )}
                {narrow && (
                  <p className="text-xs text-gray-500">数量已选定，结算入口在屏幕底部。</p>
                )}
              </div>

              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                「立即购买」只展示演示订单摘要，不创建真实订单、不发起支付；实际下单请通过购物袋结算。
              </p>
              {/* 加购结果就地播报（窄屏时吸底栏遮挡本区块，故同时写进 aria-live 供读屏） */}
              <p className="text-xs text-green-700 mt-2 min-h-[1rem]" role="status" aria-live="polite">{addedNote}</p>
              {inBag > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  <span>购物车已有 {inBag} 件</span> · <Link to="/cart" className="text-brand-600 font-medium">去购物袋结算</Link>
                </p>
              )}
            </div>

            {/* 配送说明（右栏摘要；完整口径见下方「配送说明」区块） */}
            <div className="bg-white lg:bg-transparent mt-2.5 lg:mt-6 p-5 lg:p-0 lg:border-t lg:border-gray-100 lg:pt-5 animate-fade-in-up stagger-4">
              <h3 className="section-title mb-2">配送说明</h3>
              <ul className="text-xs text-gray-500 space-y-1.5 leading-relaxed list-disc pl-4 m-0">
                <li>宿舍楼栋配送，下单时填写楼栋号。</li>
                <li>营业时间外需先在群内与商家确认。</li>
                <li>详情见下方「配送说明」区块。</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 参数 / 详细配送 / 售后 */}
        <div className="max-w-3xl lg:max-w-6xl mx-auto px-4 lg:px-6">
          <ProductInfoSections product={product} categories={categories} combo={combo} />
        </div>

        {/* 相关推荐 */}
        <div className="max-w-3xl lg:max-w-6xl mx-auto">
          <RelatedProducts current={product} products={catalog} />
        </div>

        {/* 买家评价 + 写评价 */}
        <div className="max-w-3xl lg:max-w-6xl mx-auto px-4 lg:px-0 lg:px-6">
          <ReviewList reviews={productReviews} sort={reviewSort} onSortChange={setReviewSort} />
          {product.order != null && (
            <ReviewForm key={product.order} productOrder={Number(product.order)} onPublished={refreshReviews} />
          )}
        </div>
      </div>

      {/* 底部吸底栏：仅窄屏渲染，且是该视口下唯一的加购入口 */}
      {narrow && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-4 py-3 z-20 safe-bottom">
          <div className="flex items-center gap-3 w-full max-w-3xl mx-auto">
            <span className="text-xl font-bold text-brand-600 tabular-nums shrink-0">{formatYuan(effPrice)}</span>
            <button
              type="button"
              onClick={() => setSummaryOpen(true)}
              className="btn-secondary px-3 py-3 text-sm rounded-xl flex-1 min-w-0"
            >
              立即购买
            </button>
            <button
              type="button"
              onClick={() => handleAdd()}
              className="btn-primary px-5 py-3.5 rounded-2xl shadow-elevated flex-1 min-w-0"
            >
              加入购物车
            </button>
          </div>
        </div>
      )}

      <DemoOrderSummary
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        productName={effName}
        specText={effSpec}
        unitPrice={effPrice}
        quantity={qty}
        combo={combo}
      />
    </div>
  )
}
