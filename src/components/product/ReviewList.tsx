import {  useEffect, useMemo, useState  } from 'react'
import type { Review } from '../../types'
import { resolveReviewImages } from '../../utils/reviewImages'
import GlyphIcon from '../brand/GlyphIcon'

// 评价展示子组件（M6 拆分自 ProductDetailPage，2026-09-05）

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-600 text-sm tracking-tight" aria-label={`${rating} 星`}>
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

/**
 * 口碑账本（第 91 轮）：星级分布做成五条铜轨 + 逐行记档。
 *
 * 为什么不是通用「4.5 分 + 一堆星星」：分数把 20 条评价压成一个数，读者**看不出这是一家
 * 稳店还是一家赌店** —— 4.5 分可以是「全 4-5 星」也可以是「一半 5 星一半 1 星」，
 * 而这两种情况的决策含义完全相反。分布才是信息。
 *
 * 实现口径：
 *  - 纯 CSS 条（宽度 = 占比），不引图表库：这里只有 5 个分类，ECharts 是杀鸡用牛刀，
 *    且看板那套 chart-* 令牌是暗面板语境，纸面/面板上的小分布该走本站的铜轨语言；
 *  - 逐行是 <button>：点一行 = 按该星级筛（再点取消）。键盘可达、按压反馈在册；
 *    不做「hover 才出内容」—— 触屏没有 hover。
 *  - 占比条用 aria-hidden，真实数字在行内的「N 条」文字叶上（读屏拿到的不是百分比条）。
 */
function RatingLedger({ reviews, active, onToggle }: {
  reviews: Review[]
  active: number | null
  onToggle: (star: number) => void
}) {
  const total = reviews.length
  const rows = useMemo(() => {
    const by = [0, 0, 0, 0, 0]
    for (const r of reviews) {
      const i = Math.min(4, Math.max(0, Math.round(r.rating) - 1))
      by[i] += 1
    }
    return by.map((count, i) => ({ star: 5 - i, count, pct: total ? Math.round((count / total) * 100) : 0 }))
  }, [reviews, total])
  return (
    <div className="rating-ledger" role="group" aria-label="星级分布">
      {rows.map((row) => (
        <button
          key={row.star}
          type="button"
          onClick={() => onToggle(row.star)}
          aria-pressed={active === row.star}
          aria-label={row.count > 0 ? `只看 ${row.star} 星评价（${row.count} 条）` : `${row.star} 星评价 0 条`}
          className={`rating-ledger-row${active === row.star ? ' is-active' : ''}${row.count === 0 ? ' is-empty' : ''}`}
        >
          <span className="rating-ledger-star">{row.star}★</span>
          <span className="rating-ledger-rail" aria-hidden="true" data-decorative="true">
            <i style={{ width: row.pct + '%' }} />
          </span>
          <span className="rating-ledger-num price-num">{row.count}</span>
        </button>
      ))}
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
            <div className="w-full h-full flex items-center justify-center bg-gray-50 text-stone-400"><span className="thumb-fallback" aria-hidden="true"><GlyphIcon glyph="🖼" /></span></div>
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
  // 星级筛选是**展示层**的一层过滤：不改父页给的数据，也不与三档排序打架
  // （排序仍由父页负责，这里只负责「看哪一档」）。
  const [starFilter, setStarFilter] = useState<number | null>(null)
  const shown = starFilter === null ? reviews : reviews.filter((r) => Math.round(r.rating) === starFilter)
  return (
    <div className="bg-panel mt-2.5 p-5 animate-fade-in-up stagger-3">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">买家评价 ({reviews.length})</h2>
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
          <span className="empty-stage mx-auto mb-3"><GlyphIcon glyph="💬" /></span>
          <p className="text-sm font-bold text-ink">还没有人留下口碑</p>
          <p className="text-xs leading-relaxed text-mute mt-1.5">第一家说的人，会被后面每个看到这条商品的人读到。</p>
        </div>
      ) : (
        <>
          <div className="review-ledger-split">
            <RatingLedger
              reviews={reviews}
              active={starFilter}
              onToggle={(s) => setStarFilter((cur) => (cur === s ? null : s))}
            />
            <div className="review-ledger-side">
              <p className="review-ledger-avg price-num">{avgOf(reviews)}</p>
              <p className="review-ledger-cap">综合评分 · {reviews.length} 条</p>
              {starFilter !== null && (
                <button type="button" onClick={() => setStarFilter(null)} className="review-ledger-clear">
                  已筛 {starFilter}★ · 清除
                </button>
              )}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-xs leading-relaxed text-mute py-4">这一档暂时没有人写过。</p>
          ) : (
            <div className="space-y-4 mt-1">
              {shown.map((review, i) => (
                <div key={i} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-stone-700">{review.user}</span>
                    <span className="text-xs text-stone-500">{formatReviewDate(review)}</span>
                  </div>
                  <Stars rating={review.rating} />
                  <p className="text-sm text-stone-600 mt-1.5 leading-relaxed">{review.text}</p>
                  {Array.isArray(review.images) && review.images.length > 0 && (
                    <ReviewImages images={review.images.slice(0, 5)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 综合评分：一位小数；无评价时不显示（调用方已在 reviews.length===0 分支里） */
function avgOf(reviews: Review[]): string {
  if (reviews.length === 0) return '—'
  const s = reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0)
  return (s / reviews.length).toFixed(1)
}
