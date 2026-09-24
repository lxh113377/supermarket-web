import { useState, type KeyboardEvent } from 'react'
import type { Product } from '../../types'
import { productImageUrl, productSrcSet } from '../../utils/images'
import type { Selection } from '../../utils/variants'

// 商品图集组件（M6 拆分自 ProductDetailPage，2026-09-05；缩略图列 2026-09-25）
// 单图走 srcset 响应式（sm/ 400w 小图），多图轮播（prev/next）+ 缩略图列，加载失败降级占位。
//
// 缩略图列取代了原先的匿名小圆点：圆点只能表达「第几张」，缩略图能表达「这是哪个规格」，
// 且点缩略图可同时切换主图与变体选择（通过 item.selection 回传页面）。
// 布局：移动端横排在主图下方，桌面端竖排在主图左侧（用 lg:order-first 实现，
// DOM 顺序仍是主图在前 —— 既有测试与读屏顺序都按主图优先）。

/** 图集条目。未提供 items 时由 gallery: string[] 自动降级构造 */
export interface GalleryItem {
  src: string
  srcSet?: string
  sizes?: string
  /** 缩略图按钮的无障碍名称；缺省用「查看第 N 张图片」 */
  label?: string
  /** 该图对应的变体选择，点缩略图时回调给页面同步规格 */
  selection?: Selection
  /** 该图所属的真实商品目录编号，页面据此把主图与选中规格对齐 */
  order?: number
}

function Placeholder({ name, spec }: { name: string; spec?: string }) {
  return (
    <div className="w-full h-full min-h-60 flex items-center justify-center bg-gradient-to-br from-brand-50 via-surface-warm to-brand-100/50">
      <div className="text-center animate-scale-in">
        <div className="text-6xl mb-3" aria-hidden="true">🛒</div>
        <p className="text-brand-600 font-bold text-lg">{name}</p>
        {spec && <p className="text-brand-400 text-sm mt-1">{spec}</p>}
        {/* 如实标注：这是占位示意，不是商品实拍 */}
        <p className="text-brand-400/80 text-[11px] mt-2">示意图 · 非商品实拍</p>
      </div>
    </div>
  )
}

export default function ProductGallery({ product, gallery, items, index, onIndexChange, onItemSelect }: {
  product: Product
  /** 兼容旧调用：纯 src 列表 */
  gallery: string[]
  /** 新调用：带 srcSet / 无障碍名 / 变体选择的富条目（给了就以它为准） */
  items?: GalleryItem[]
  /** 受控当前图序号；不传则组件内部自管（既有调用方零改动） */
  index?: number
  onIndexChange?: (index: number) => void
  /** 点缩略图时回调（页面据此同步变体选择） */
  onItemSelect?: (index: number, item: GalleryItem) => void
}) {
  const [internalIdx, setInternalIdx] = useState(0)
  const [galleryErr, setGalleryErr] = useState<Record<number, boolean>>({})
  const orderNum = product?.order != null ? product.order
    : (product?._id ? parseInt(String(product._id).replace(/\D/g, ''), 10) : null)
  const imgSrc = product?.image || productImageUrl(orderNum)
  const imgSrcSet = product.image ? undefined : productSrcSet(orderNum)

  const list: GalleryItem[] = items && items.length > 0
    ? items
    : gallery.filter(Boolean).map((src) => ({ src }))

  // 受控优先；越界（如变体组切换后条目数变少）自动夹回合法区间，不渲染出 undefined
  const rawIdx = index ?? internalIdx
  const galleryIdx = list.length === 0 ? 0 : ((rawIdx % list.length) + list.length) % list.length

  // 单图时也必须用 list[0].src：父页传入的图可能来自 product.images（与按 order 拼的
  // /images/{order}.webp 不是同一张），只认 imgSrc 会显示错图（七轮 H2 实测修正）
  const singleSrc = list.length === 1 ? list[0].src : imgSrc
  const singleSrcSet = list.length === 1
    ? (list[0].srcSet ?? (singleSrc === imgSrc ? imgSrcSet : undefined))
    : imgSrcSet
  const singleSizes = list.length === 1 ? list[0].sizes : undefined

  const setIdx = (i: number) => {
    const n = list.length === 0 ? 0 : ((i % list.length) + list.length) % list.length
    setInternalIdx(n)
    if (onIndexChange) onIndexChange(n)
  }

  const prev = () => setIdx(galleryIdx - 1)
  const next = () => setIdx(galleryIdx + 1)

  const goTo = (i: number) => {
    setIdx(i)
    const item = list[i]
    if (item && onItemSelect) onItemSelect(i, item)
  }

  // 轮播区支持 ← → 键翻图（原实现只能用鼠标点两侧按钮）
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (list.length < 2) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
  }

  const thumbLabel = (item: GalleryItem, i: number) => item.label || `查看第 ${i + 1} 张图片`

  // 切换商品时重置轮播态（由父 key={product._id} 驱动卸载重挂）
  return (
    <div className="bg-white animate-fade-in">
      <div className="flex flex-col lg:flex-row lg:items-start lg:gap-4 lg:p-4">
        {/* 主图区 —— DOM 顺序在前 */}
        <div className="flex-1 min-w-0" data-main-image="">
          {list.length > 1 ? (
            <div
              className="relative focus-visible:outline-2 focus-visible:outline-brand-500"
              role="group"
              aria-roledescription="轮播图"
              aria-label={`${product.name} 图片，第 ${galleryIdx + 1} / ${list.length} 张`}
              tabIndex={0}
              onKeyDown={onKeyDown}
            >
              {!galleryErr[galleryIdx] ? (
                <img
                  src={list[galleryIdx].src}
                  srcSet={list[galleryIdx].srcSet}
                  sizes={list[galleryIdx].sizes || '(max-width: 1023px) 100vw, 560px'}
                  alt={`${product.name} 第 ${galleryIdx + 1} 张`}
                  width={600}
                  height={288}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-72 lg:h-[420px] object-contain p-6 lg:p-4"
                  onError={() => setGalleryErr((prevState) => (prevState[galleryIdx] ? prevState : { ...prevState, [galleryIdx]: true }))}
                />
              ) : (
                <div className="h-72 lg:h-[420px]">
                  <Placeholder name={product.name} spec={product.spec} />
                </div>
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
            </div>
          ) : singleSrc && !galleryErr[0] ? (
            <img
              src={singleSrc}
              srcSet={singleSrcSet}
              sizes={singleSizes || '(max-width: 1023px) 100vw, 560px'}
              width={600}
              height={288}
              alt={product.name}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="w-full h-72 lg:h-[420px] object-contain p-6 lg:p-4"
              onError={() => setGalleryErr((prevState) => (prevState[0] ? prevState : { ...prevState, 0: true }))}
            />
          ) : (
            <div className="h-72 lg:h-[420px]">
              <Placeholder name={product.name} spec={product.spec} />
            </div>
          )}
        </div>

        {/* 缩略图列：桌面竖排在主图左侧，移动端横排在主图下方 */}
        {list.length > 1 && (
          <nav
            aria-label={`${product.name} 图片缩略图`}
            className="lg:order-first lg:w-20 lg:shrink-0 flex gap-2 overflow-x-auto scrollbar-hide px-3 pb-3 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:max-h-[420px] lg:px-0 lg:pb-0"
          >
            {list.map((item, i) => (
              <button
                key={`${item.src}-${i}`}
                onClick={() => goTo(i)}
                aria-label={thumbLabel(item, i)}
                aria-current={i === galleryIdx}
                title={item.label}
                className={`shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-xl overflow-hidden border-2 bg-gray-50 transition-all duration-200 focus-visible:outline-2 focus-visible:outline-brand-500 ${
                  i === galleryIdx
                    ? 'border-brand-500 shadow-soft'
                    : 'border-gray-100 hover:border-brand-300'
                }`}
              >
                {galleryErr[i] ? (
                  <span className="w-full h-full flex items-center justify-center text-lg" aria-hidden="true">🛒</span>
                ) : (
                  <img
                    src={item.src}
                    srcSet={item.srcSet}
                    sizes="80px"
                    width={80}
                    height={80}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-contain p-1.5"
                    onError={() => setGalleryErr((prevState) => (prevState[i] ? prevState : { ...prevState, [i]: true }))}
                  />
                )}
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
