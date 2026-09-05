import React, { useState } from 'react'
import type { Product } from '../../types'

// 商品图集组件（M6 拆分自 ProductDetailPage，2026-09-05）
// 单图走 srcset 响应式（sm/ 400w 小图），多图轮播（prev/next/指示点），加载失败降级占位。

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

export default function ProductGallery({ product, gallery }: {
  product: Product
  gallery: string[]
}) {
  const [galleryIdx, setGalleryIdx] = useState(0)
  const [galleryErr, setGalleryErr] = useState<Record<number, boolean>>({})
  const orderNum = product?.order != null ? product.order
    : (product?._id ? parseInt(String(product._id).replace(/\D/g, ''), 10) : null)
  const imgSrc = product?.image || (orderNum ? `/images/${orderNum}.webp` : null)

  // 切换商品时重置轮播态（由父 key={product._id} 驱动卸载重挂，此 effect 保证 srcSet 随 product 变化）
  return (
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
  )
}