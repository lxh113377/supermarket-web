import { useState, type KeyboardEvent } from 'react'
import type { Product } from '../../types'
import { productImageUrl, productSrcSet } from '../../utils/images'

// 商品图集组件（M6 拆分自 ProductDetailPage，2026-09-05）
// 单图走 srcset 响应式（sm/ 400w 小图），多图轮播（prev/next/指示点），加载失败降级占位。

function Placeholder({ name, spec }: { name: string; spec?: string }) {
  return (
    <div className="w-full h-72 flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-warm to-brand-100/50">
      <div className="text-center animate-scale-in">
        <div className="text-6xl mb-3" aria-hidden="true">🛒</div>
        <p className="text-brand-600 font-bold text-lg">{name}</p>
        {spec && <p className="text-brand-400 text-sm mt-1">{spec}</p>}
      </div>
    </div>
  )
}

export default function ProductGallery({ product, gallery }: {
  product: Product
  gallery: string[]
}) {
  const [galleryIdx, setGalleryIdx] = useState(0)
  const [galleryErr, setGalleryErr] = useState<Record<number, boolean>>({})
  const orderNum = product?.order != null ? product.order
    : (product?._id ? parseInt(String(product._id).replace(/\D/g, ''), 10) : null)
  const imgSrc = product?.image || productImageUrl(orderNum)
  const imgSrcSet = product.image ? undefined : productSrcSet(orderNum)
  // 单图时也必须用 gallery[0]：父页传入的 gallery 可能来自 product.images（与按 order 拼的
  // /images/{order}.webp 不是同一张），只认 imgSrc 会显示错图（七轮 H2 实测修正）
  const singleSrc = gallery.length === 1 ? gallery[0] : imgSrc
  const singleSrcSet = singleSrc === imgSrc ? imgSrcSet : undefined

  const prev = () => setGalleryIdx((i) => (i - 1 + gallery.length) % gallery.length)
  const next = () => setGalleryIdx((i) => (i + 1) % gallery.length)

  // 轮播区支持 ← → 键翻图（原实现只能用鼠标点两侧按钮）
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (gallery.length < 2) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
  }

  // 切换商品时重置轮播态（由父 key={product._id} 驱动卸载重挂，此 effect 保证 srcSet 随 product 变化）
  return (
    <div className="bg-white animate-fade-in">
      {gallery.length > 1 ? (
        <div
          className="relative focus-visible:outline-2 focus-visible:outline-brand-500"
          role="group"
          aria-roledescription="轮播图"
          aria-label={`${product.name} 图片，第 ${galleryIdx + 1} / ${gallery.length} 张`}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {!galleryErr[galleryIdx] ? (
            <img
              src={gallery[galleryIdx]}
              alt={`${product.name} 第 ${galleryIdx + 1} 张`}
              width={600}
              height={288}
              loading="lazy"
              decoding="async"
              className="w-full h-72 object-contain p-6"
              onError={() => setGalleryErr((prevState) => (prevState[galleryIdx] ? prevState : { ...prevState, [galleryIdx]: true }))}
            />
          ) : (
            <Placeholder name={product.name} spec={product.spec} />
          )}
          <button
            onClick={prev}
            aria-label="上一张图片"
            className="tap-44 absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 backdrop-blur-sm shadow-soft flex items-center justify-center text-gray-500 hover:bg-white transition"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            onClick={next}
            aria-label="下一张图片"
            className="tap-44 absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/85 backdrop-blur-sm shadow-soft flex items-center justify-center text-gray-500 hover:bg-white transition"
          >
            <span aria-hidden="true">›</span>
          </button>
          {/* 指示点：视觉仍是 8px 小圆点，但用内边距把命中区撑到 28px
              （原实现按钮本身就是 8px 高，手机上几乎点不中） */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5">
            {gallery.map((_, i) => (
              <button
                key={i}
                onClick={() => setGalleryIdx(i)}
                aria-label={`查看第 ${i + 1} 张图片`}
                aria-current={i === galleryIdx}
                className="p-2.5 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-brand-500 rounded-full"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 rounded-full transition-all ${i === galleryIdx ? 'bg-brand-500 w-4' : 'bg-gray-300 w-2'}`}
                />
              </button>
            ))}
          </div>
        </div>
      ) : singleSrc && !galleryErr[0] ? (
        <img
          src={singleSrc}
          srcSet={singleSrcSet}
          sizes="(max-width: 640px) 100vw, 600px"
          width={600}
          height={288}
          alt={product.name}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          className="w-full h-72 object-contain p-6"
          onError={() => setGalleryErr((prevState) => (prevState[0] ? prevState : { ...prevState, 0: true }))}
        />
      ) : (
        <Placeholder name={product.name} spec={product.spec} />
      )}
    </div>
  )
}