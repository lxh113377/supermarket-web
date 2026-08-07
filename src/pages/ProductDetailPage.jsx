import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProducts, addReview, getLocalProductReviews, getCloudReviews } from '../db.js'
import { reviews as seedReviews } from '../data/reviews-seed.js'
import useCart from '../hooks/useCart.js'

function Stars({ rating }) {
  return (
    <span className="text-brand-400 text-sm tracking-tight">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  )
}

export default function ProductDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add, getQuantity } = useCart()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState(false)
  const [reviewUser, setReviewUser] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewText, setReviewText] = useState('')
  const [userReviews, setUserReviews] = useState([])
  const [cloudReviews, setCloudReviews] = useState([])

  useEffect(() => {
    async function load() {
      try {
        const products = await getProducts()
        const found = products.find(p => p._id === id || String(p.order) === id)
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
    if (product?.order != null) {
      setUserReviews(getLocalProductReviews(product.order) || [])
      getCloudReviews(product.order).then(revs => setCloudReviews(revs)).catch(() => setCloudReviews([]))
    } else {
      setUserReviews([])
      setCloudReviews([])
    }
  }, [product])

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

  const seedFallback = seedReviews.filter(r => r.productOrder === product.order)
  const productReviews = [...cloudReviews, ...userReviews, ...seedFallback]
  const avgRating = productReviews.length > 0
    ? (productReviews.reduce((s, r) => s + r.rating, 0) / productReviews.length).toFixed(1)
    : null
  const orderNum = product.order != null ? product.order
    : (product._id ? parseInt(String(product._id).replace(/\D/g, ''), 10) : null)
  const imgSrc = product.image || (orderNum ? `/images/${orderNum}.webp` : null)
  const quantity = getQuantity(product._id)

  const handleSubmitReview = () => {
    if (!reviewText.trim() || product.order == null) return
    addReview(product.order, {
      user: reviewUser.trim() || '匿名用户',
      rating: reviewRating,
      text: reviewText.trim(),
    })
    setUserReviews(getLocalProductReviews(product.order) || [])
    setReviewText('')
    setReviewUser('')
    setReviewRating(5)
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* 顶栏 */}
      <div className="flex items-center px-4 py-3.5 bg-white/95 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200 mr-2"
        >
          ←
        </button>
        <h1 className="text-sm font-bold text-gray-900 truncate">{product.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* 商品图片 */}
        <div className="bg-white animate-fade-in">
          {imgSrc && !imgError ? (
            <img
              src={imgSrc}
              srcSet={orderNum ? `/images/sm/${orderNum}.webp 400w, ${imgSrc} 800w` : undefined}
              sizes="(max-width: 640px) 100vw, 600px"
              alt={product.name}
              loading="lazy"
              className="w-full h-72 object-contain p-6"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-72 flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-warm to-brand-100/50">
              <div className="text-center animate-scale-in">
                <div className="text-6xl mb-3">🛒</div>
                <p className="text-brand-600 font-bold text-lg">{product.name}</p>
                {product.spec && <p className="text-brand-400 text-sm mt-1">{product.spec}</p>}
              </div>
            </div>
          )}
        </div>

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
              <Stars rating={Math.round(avgRating)} />
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

        {/* 买家评价 */}
        <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-3">
          <h3 className="section-title mb-4">买家评价 ({productReviews.length})</h3>
          {productReviews.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-3xl block mb-2">💬</span>
              <p className="text-sm text-gray-300">暂无评价，快来抢沙发~</p>
            </div>
          ) : (
            <div className="space-y-4">
              {productReviews.map((review, i) => (
                <div key={i} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-700">{review.user}</span>
                    <span className="text-xs text-gray-300">{review.date}</span>
                  </div>
                  <Stars rating={review.rating} />
                  <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{review.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 写评价 */}
        <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-4">
          <h3 className="section-title mb-4">写评价</h3>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="昵称（选填，默认匿名用户）"
              value={reviewUser}
              onChange={(e) => setReviewUser(e.target.value)}
              className="input-base"
            />
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">评分</span>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n}
                    onClick={() => setReviewRating(n)}
                    className={`text-2xl transition-all duration-150 ${n <= reviewRating ? 'text-brand-400 scale-110' : 'text-gray-200 hover:text-brand-200 hover:scale-105'}`}
                    aria-label={`${n}星`}
                  >★</button>
                ))}
              </div>
            </div>
            <textarea
              placeholder="说说你的感受...（最多500字）"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              className="input-base resize-none"
              rows="3"
              maxLength="500"
            />
            <button
              onClick={handleSubmitReview}
              disabled={!reviewText.trim()}
              className="btn-primary w-full py-3"
            >
              发布评价
            </button>
          </div>
        </div>
      </div>

      {/* 底部加购栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-5 py-4 flex items-center gap-4 z-20">
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
