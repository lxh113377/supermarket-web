import { Link } from 'react-router-dom'
import type { Product } from '../../types'
import { productThumbUrl, productSrcSet } from '../../utils/images'
import { formatYuan } from '../../utils/format'

// 相关推荐 —— 只从**真实商品目录**里取同类目（共享 subcategory）的商品，
// 不含任何"热销/爆款/编辑推荐"式措辞：那些需要销量或人工背书，而目录里没有这些数据。
// 用 <Link> 而非 div+onClick：保留原生链接语义（键盘 Tab、右键新标签、读屏链接列表）。

interface Props {
  /** 当前商品（用于排除自己） */
  current: Product
  /** 全站真实商品列表（页面已加载，无需再请求） */
  products: Product[]
  /** 最多展示几条 */
  limit?: number
}

export default function RelatedProducts({ current, products, limit = 8 }: Props) {
  const own = new Set(current.subcategories ?? [])
  if (own.size === 0) return null

  const related = products
    .filter((p) => p._id !== current._id && p.enabled !== false)
    .filter((p) => (p.subcategories ?? []).some((s) => own.has(s)))
    .slice(0, limit)

  if (related.length === 0) return null

  return (
    <section aria-labelledby="related-heading" className="mt-4 lg:mt-6">
      <div className="flex items-baseline justify-between gap-3 px-4 lg:px-0 mb-3">
        <h3 id="related-heading" className="section-title">同类商品</h3>
        <span className="text-xs text-gray-400">共 {related.length} 条 · 取自真实商品目录</span>
      </div>
      <ul
        className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-3 lg:px-0 lg:grid lg:grid-cols-3 lg:overflow-visible xl:grid-cols-4"
        style={{ listStyle: 'none', margin: 0, paddingInline: undefined }}
      >
        {related.map((p) => {
          const thumb = productThumbUrl(p.order) ?? null
          const srcSet = productSrcSet(p.order)
          return (
            <li key={p._id} className="shrink-0 w-32 lg:w-auto">
              <Link
                to={`/product/${p._id}`}
                className="block card-interactive p-3 no-underline focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <div className="h-24 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden">
                  {thumb ? (
                    <img
                      src={thumb}
                      srcSet={srcSet}
                      sizes="128px"
                      width={96}
                      height={96}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-2xl" aria-hidden="true">🛒</span>
                  )}
                </div>
                <p className="text-sm text-gray-900 mt-2 line-clamp-2 leading-snug">{p.name}</p>
                {p.spec && <p className="text-xs text-gray-400 mt-0.5 truncate">{p.spec}</p>}
                <p className="text-sm font-bold text-brand-600 mt-1 tabular-nums">{formatYuan(p.price)}</p>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
