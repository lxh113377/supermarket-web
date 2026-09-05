import React, { useEffect, useState } from 'react'
import type { Review } from '../../types'
import { resolveReviewImages } from '../../utils/reviewImages'

// 评价展示子组件（M6 拆分自 ProductDetailPage，2026-09-05）

export function Stars({ rating }: { rating: number }) {
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

export default function ReviewList({ reviews, sort, onSortChange }: {
  reviews: Review[]
  sort: string
  onSortChange: (s: string) => void
}) {
  return (
    <div className="bg-white mt-2.5 p-5 animate-fade-in-up stagger-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title">买家评价 ({reviews.length})</h3>
        <div className="flex gap-1.5">
          {[
            { key: 'newest', label: '最新' },
            { key: 'highest', label: '高分' },
            { key: 'lowest', label: '低分' },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => onSortChange(s.key)}
              className={sort === s.key ? 'pill-active' : 'pill-inactive'}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {reviews.length === 0 ? (
        <div className="text-center py-8">
          <span className="text-3xl block mb-2">💬</span>
          <p className="text-sm text-gray-300">暂无评价，快来抢沙发~</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review, i) => (
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
  )
}