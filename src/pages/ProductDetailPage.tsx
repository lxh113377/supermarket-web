import {  useEffect, useMemo, useState  } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProducts, getLocalProductReviews, getCloudReviews } from '../db'
import { reviews as seedReviews } from '../data/reviews-seed'
import useCart from '../hooks/useCart'
import ProductGallery from '../components/product/ProductGallery'
import ReviewList, { Stars } from '../components/product/ReviewList'
import ReviewForm from '../components/product/ReviewForm'
import type { Product, Review } from '../types'

// 商品详情页（M6 拆分 2026-09-05：图集→ProductGallery、评价列表→ReviewList、写评价→ReviewForm）
export default function ProductDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add, getQuantity } = useCart()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewSort, setReviewSort] = useState('newest')
  const [userReviews, setUserReviews] = useState<Review[]>([])
  const [cloudReviews, setCloudReviews] = useState<Review[]>([])

  // 商品图集（必须在条件 return 之前计算，遵守 Hooks 顺序）
  const orderNum = product?.order != null ? product.order
    : (product?._id ? parseInt(String(product._id).replace(/\D/g, ''), 10) : null)
  const imgSrc = product?.image || (orderNum ? `/images/${orderNum}.webp` : null)
  const gallery: string[] = product
    ? (() => {
        const list = Array.isArray(product.images) ? product.images.filter(Boolean) : []
        if (list.length === 0 && imgSrc) list.push(imgSrc)
        return list
      })()
    : []
  const productReviews = useMemo(() => {
    const fallback = product ? seedReviews.filter((r) => r.productOrder === product.order) : []
    const merged = [...cloudReviews, ...userReviews, ...fallback]
    if (reviewSort === 'highest') return [...merged].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    if (reviewSort === 'lowest') return [...merged].sort((a, b) => (a.rating || 0) - (b.rating || 0))
    return merged // newest：云端已按 createdAt 倒序，本地新评价在前
  }, [cloudReviews, userReviews, product, reviewSort])

  useEffect(() => {
    async function load() {
      try {
        const products = await getProducts()
        const found = products.find((p) => p._id === id || String(p.order) === id)
        setProduct(found || null)
      } catch {
        setProduct(null)
      } finally {
        setLoading(false)
      }
    }
    load()
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

  const refreshReviews = () => {
    if (product?.order == null) return
    setUserReviews(getLocalProductReviews(product.order) || [])
    getCloudReviews(product.order)
      .then(setCloudReviews)
      .catch(() => setCloudReviews([]))
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <span className="text-sm text-gray-400">加载中...</span>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-4xl">😢</span>
        <p className="text-gray-400 text-sm">商品不存在或已下架</p>
        <button onClick={() => navigate('/')} className="text-brand-600 text-sm font-medium hover:underline">返回首页</button>
      </div>
    )
  }

  const avgRating = productReviews.length > 0
    ? (productReviews.reduce((s, r) => s + r.rating, 0) / productReviews.length).toFixed(1)
    : null
  const quantity = getQuantity(product._id)

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
        <h1 className="text-sm font-bold text-gray-900 truncate">{product.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* 商品图片（多图轮播，key 驱动切商品时重置轮播态） */}
        <ProductGallery key={product._id} product={product} gallery={gallery} />

        {/* 商品信息 */}
        <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-1">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-gray-900">{product.name}</h2>
            <span className="text-2xl font-bold text-brand-600">
              <span className="text-sm">¥</span>{product.price.toFixed(2)}
            </span>
          </div>
          {product.spec && <p className="text-sm text-gray-400 mt-1.5">规格：{product.spec}</p>}
          {avgRating && (
            <div className="flex items-center gap-2 mt-3">
              <Stars rating={Math.round(Number(avgRating))} />
              <span className="text-xs text-gray-400">{avgRating} 分 · {productReviews.length} 条评价</span>
            </div>
          )}
        </div>

        {/* 商品介绍 */}
        {product.description && (
          <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-2">
            <h3 className="section-title mb-3">商品介绍</h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{product.description}</p>
          </div>
        )}

        {/* 买家评价 + 写评价 */}
        <ReviewList reviews={productReviews} sort={reviewSort} onSortChange={setReviewSort} />
        {product.order != null && (
          <ReviewForm key={product.order} productOrder={Number(product.order)} onPublished={refreshReviews} />
        )}
      </div>

      {/* 底部加购栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-5 py-4 flex items-center gap-4 z-20 safe-bottom">
        <div className="flex-1">
          <span className="text-xl font-bold text-brand-600">
            <span className="text-xs">¥</span>{product.price.toFixed(2)}
          </span>
          {quantity > 0 && <span className="text-xs text-gray-400 ml-2">购物车已有 {quantity} 件</span>}
        </div>
        <button
          onClick={() => add(product)}
          className="btn-primary px-8 py-3.5 rounded-2xl shadow-elevated"
        >
          加入购物车
        </button>
      </div>
    </div>
  )
}