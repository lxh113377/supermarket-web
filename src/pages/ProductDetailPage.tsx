import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getProducts, addReview, getLocalProductReviews, getCloudReviews } from '../db'
import { reviews as seedReviews } from '../data/reviews-seed'
import useCart from '../hooks/useCart'
import { compressImage, uploadReviewImages, resolveReviewImages } from '../utils/reviewImages'
import type { Product, Review } from '../types'

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-brand-400 text-sm tracking-tight" aria-label={`${rating} 星`}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  )
}

function formatReviewDate(review: Review): string {
  if (review.date) return review.date
  if (review.createdAt) {
    const d = new Date(review.createdAt)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return ''
}

export default function ProductDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { add, getQuantity } = useCart()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [galleryErr, setGalleryErr] = useState<Record<number, boolean>>({})
  const [reviewUser, setReviewUser] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewText, setReviewText] = useState('')
  const [reviewImages, setReviewImages] = useState<string[]>([])
  const [reviewImageBlobs, setReviewImageBlobs] = useState<Blob[]>([])
  const [reviewSort, setReviewSort] = useState('newest')
  const [submitting, setSubmitting] = useState(false)
  const [reviewMsg, setReviewMsg] = useState('')
  const [userReviews, setUserReviews] = useState<Review[]>([])
  const [cloudReviews, setCloudReviews] = useState<Review[]>([])
  const [galleryIdx, setGalleryIdx] = useState(0)

  // 商品图集与评价列表（必须在条件 return 之前计算，遵守 Hooks 顺序）
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

  // 切换商品时清空轮播错误态（图片集合随商品变化）
  useEffect(() => {
    setGalleryErr({})
    setGalleryIdx(0)
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

  const handleReviewImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    setReviewMsg('')
    const remaining = 5 - reviewImages.length
    if (remaining <= 0) {
      setReviewMsg('最多上传 5 张图片')
      return
    }
    const valid = files
      .slice(0, remaining)
      .filter((f) => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024)
    try {
      const compressed = (await Promise.all(valid.map((f) => compressImage(f))))
        .filter((d) => d.dataUrl.length <= 2 * 1024 * 1024)
      setReviewImages((prev) => [...prev, ...compressed.map((d) => d.dataUrl)].slice(0, 5))
      setReviewImageBlobs((prev) => [...prev, ...compressed.map((d) => d.blob)].slice(0, 5))
      if (compressed.length < valid.length) setReviewMsg('部分图片过大，已自动跳过')
    } catch {
      setReviewMsg('图片处理失败，请重试')
    }
  }

  const handleSubmitReview = async () => {
    if (!reviewText.trim() || product.order == null) return
    setSubmitting(true)
    setReviewMsg('')
    try {
      // 评价晒图：压缩后 base64 dataURL 直传入库（D1 reviews.images）
      let images: string[] = []
      if (reviewImageBlobs.length > 0) {
        try {
          images = await uploadReviewImages(reviewImageBlobs)
        } catch {
          setReviewMsg('图片上传失败：请检查云存储配置后重试')
          return
        }
      }
      await addReview(product.order, {
        user: reviewUser.trim() || '匿名用户',
        rating: reviewRating,
        text: reviewText.trim(),
        images,
      })
      setUserReviews(getLocalProductReviews(product.order) || [])
      const revs = await getCloudReviews(product.order).catch(() => [])
      setCloudReviews(revs)
      setReviewText('')
      setReviewUser('')
      setReviewRating(5)
      setReviewImages([])
      setReviewImageBlobs([])
      setReviewMsg('评价已发布 ✓')
    } catch (e) {
      setReviewMsg('发布失败：' + (e instanceof Error ? e.message : '网络错误'))
    } finally {
      setSubmitting(false)
    }
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
        <h1 className="text-sm font-bold text-gray-900 truncate">{product.name}</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* 商品图片（多图轮播） */}
        <div className="bg-white animate-fade-in">
          {gallery.length > 1 ? (
            <div className="relative">
              {!galleryErr[galleryIdx] ? (
                <img
                  src={gallery[galleryIdx]}
                  alt={product.name}
                  loading="lazy"
                  className="w-full h-72 object-contain p-6"
                  onError={() => setGalleryErr((prev) => (prev[galleryIdx] ? prev : { ...prev, [galleryIdx]: true }))}
                />
              ) : (
                <Placeholder name={product.name} spec={product.spec} />
              )}
              <button
                onClick={() => setGalleryIdx((i) => (i - 1 + gallery.length) % gallery.length)}
                aria-label="上一张图片"
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 backdrop-blur-sm shadow-soft flex items-center justify-center text-gray-500 hover:bg-white transition"
              >
                ‹
              </button>
              <button
                onClick={() => setGalleryIdx((i) => (i + 1) % gallery.length)}
                aria-label="下一张图片"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 backdrop-blur-sm shadow-soft flex items-center justify-center text-gray-500 hover:bg-white transition"
              >
                ›
              </button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {gallery.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setGalleryIdx(i)}
                    aria-label={`查看第 ${i + 1} 张图片`}
                    className={`w-2 h-2 rounded-full transition-all ${i === galleryIdx ? 'bg-brand-500 w-4' : 'bg-gray-300'}`}
                  />
                ))}
              </div>
            </div>
          ) : imgSrc && !galleryErr[0] ? (
            <img
              src={imgSrc}
              srcSet={orderNum ? `/images/sm/${orderNum}.webp 400w, ${imgSrc} 800w` : undefined}
              sizes="(max-width: 640px) 100vw, 600px"
              alt={product.name}
              loading="eager"
              fetchPriority="high"
              className="w-full h-72 object-contain p-6"
              onError={() => setGalleryErr((prev) => (prev[0] ? prev : { ...prev, 0: true }))}
            />
          ) : (
            <Placeholder name={product.name} spec={product.spec} />
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

        {/* 买家评价 */}
        <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title">买家评价 ({productReviews.length})</h3>
            <div className="flex gap-1.5">
              {[
                { key: 'newest', label: '最新' },
                { key: 'highest', label: '高分' },
                { key: 'lowest', label: '低分' },
              ].map((s) => (
                <button
                  key={s.key}
                  onClick={() => setReviewSort(s.key)}
                  className={reviewSort === s.key ? 'pill-active' : 'pill-inactive'}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
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
                    <span className="text-xs text-gray-300">{formatReviewDate(review)}</span>
                  </div>
                  <Stars rating={review.rating} />
                  <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{review.text}</p>
                  {Array.isArray(review.images) && review.images.length > 0 && (
                    <ReviewImages images={review.images.slice(0, 5)} />
                  )}
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
              maxLength={20}
              className="input-base"
            />
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">评分</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setReviewRating(n)}
                    aria-label={`${n}星`}
                    className={`text-2xl transition-all duration-150 ${n <= reviewRating ? 'text-brand-400 scale-110' : 'text-gray-200 hover:text-brand-200 hover:scale-105'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <textarea
              placeholder="说说你的感受...（最多500字）"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              className="input-base resize-none"
              rows={3}
              maxLength={500}
            />
            {/* 晒图（最多 3 张，自动压缩） */}
            <div>
              {reviewImages.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {reviewImages.map((src, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-gray-100">
                      <img src={src} alt={`待发布图片 ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => {
                          setReviewImages((prev) => prev.filter((_, j) => j !== i))
                          setReviewImageBlobs((prev) => prev.filter((_, j) => j !== i))
                        }}
                        aria-label={`删除图片 ${i + 1}`}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 text-white rounded-full text-xs flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {reviewImages.length < 3 && (
                <label className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-4 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 hover:bg-brand-50/30 transition-all duration-300 flex flex-col items-center cursor-pointer">
                  <span className="text-xl mb-1">📷</span>
                  添加图片（选填，最多 3 张）
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleReviewImages} />
                </label>
              )}
            </div>
            {reviewMsg && (
              <p className={`text-xs ${reviewMsg.includes('✓') ? 'text-green-600' : 'text-red-400'}`}>{reviewMsg}</p>
            )}
            <button
              onClick={handleSubmitReview}
              disabled={!reviewText.trim() || submitting}
              className="btn-primary w-full py-3"
            >
              {submitting ? '发布中...' : '发布评价'}
            </button>
          </div>
        </div>
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

function Placeholder({ name, spec }: { name: string; spec?: string }) {
  return (
    <div className="w-full h-72 flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-warm to-brand-100/50">
      <div className="text-center animate-scale-in">
        <div className="text-6xl mb-3">🛒</div>
        <p className="text-brand-600 font-bold text-lg">{name}</p>
        {spec && <p className="text-brand-400 text-sm mt-1">{spec}</p>}
      </div>
    </div>
  )
}

// 评价图渲染：fileID 异步解析临时 URL（带缓存），旧 base64/http 图直出，加载失败显示占位
function ReviewImages({ images }: { images: string[] }) {
  const [urls, setUrls] = useState<string[]>(images)
  const [failed, setFailed] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setUrls(images)
    setFailed({})
    resolveReviewImages(images)
      .then((resolved) => {
        if (!cancelled) setUrls(resolved)
      })
      .catch(() => {
        // 解析失败保留原值，交由 img onError 兜底
      })
    return () => {
      cancelled = true
    }
  }, [images])

  return (
    <div className="flex gap-2 mt-2">
      {urls.map((src, j) => (
        <div key={j} className="w-16 h-16 rounded-xl overflow-hidden border border-gray-100 relative">
          {src && !failed[j] ? (
            <img
              src={src}
              alt={`评价图片 ${j + 1}`}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={() => setFailed((prev) => (prev[j] ? prev : { ...prev, [j]: true }))}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-300 text-lg">🖼</div>
          )}
        </div>
      ))}
    </div>
  )
}
