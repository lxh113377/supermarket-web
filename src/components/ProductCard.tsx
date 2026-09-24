import React, { memo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Product } from '../types'
import { productImageUrl, productSrcSet } from '../utils/images'
import { formatPrice } from '../utils/format'
import { variantGroupOf } from '../data/variants-demo'
import { groupImageOrders } from '../utils/variants'
import { prefetchRoute } from '../prefetchBus'

interface ProductCardProps {
  product: Product
  quantity: number
  // 回调签名带上 product：父组件因此可以传「引用稳定」的函数，
  // memo 才真正生效（原先父组件用内联箭头函数，每次渲染都是新引用，memo 形同虚设）
  onAdd: (product: Product, e?: React.MouseEvent) => void
  onRemove: (product: Product) => void
}

function ProductCard({ product, quantity, onAdd, onRemove }: ProductCardProps) {
  const navigate = useNavigate()
  const disabled = product.enabled === false
  const [imgErr, setImgErr] = useState(false)
  const displayName = product.spec
    ? `${product.name} (${product.spec})`
    : product.name
  const imgSrc = productImageUrl(product.order)
  const imgSrcSet = productSrcSet(product.order)
  // 该商品在演示变体层里有几条真实记录（无变体组时为 0，不显示角标）
  const group = variantGroupOf(product.order)
  const variantCount = group ? groupImageOrders(group).length : 0

  const goDetail = () => {
    if (!disabled) navigate(`/product/${product._id}`)
  }

  return (
    <div
      // P0-9：补按钮语义与键盘可达（Enter/Space 进详情），键盘用户可操作商品卡
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? -1 : 0}
      aria-label={disabled ? undefined : `查看${displayName}详情`}
      className={`flex items-center gap-3 p-3.5 rounded-2xl transition-all duration-300 ${
        disabled
          ? 'bg-gray-50 opacity-50 grayscale border border-gray-100'
          : 'bg-white border border-gray-100/80 shadow-card hover:shadow-elevated hover:-translate-y-0.5 cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-brand-500'
      }`}
      onClick={goDetail}
      onMouseEnter={() => {
        if (!disabled) prefetchRoute('product')
      }}
      onFocus={() => {
        if (!disabled) prefetchRoute('product')
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          goDetail()
        }
      }}
    >
      {/* 商品缩略图：显式 width/height 固定占位（消除 CLS）+ decoding="async"（解码不阻塞主线程） */}
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-50 border border-gray-100/60 shrink-0">
        {imgSrc && !imgErr ? (
          <img
            src={imgSrc}
            srcSet={imgSrcSet}
            sizes="56px"
            width={56}
            height={56}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl bg-gradient-to-br from-brand-50 to-orange-50">
            <span aria-hidden="true">
              {product.subcategories?.includes('snacks') || product.subcategories?.includes('filling') ? '🍜' : '🥤'}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className={`text-sm font-medium leading-tight truncate ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
            {displayName}
          </h3>
          {disabled && (
            <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-md font-medium shrink-0">
              已下架
            </span>
          )}
        </div>
        <p className={`text-base font-bold mt-0.5 ${disabled ? 'text-gray-400' : 'text-brand-600'}`}>
          <span className="text-xs font-medium">¥</span>{formatPrice(product.price)}
          {/* 卡面只标这一条记录自己的真实价格，不用「¥x 起」——
              那样点进详情默认选中的是这一条本身，价格会对不上。
              变体数量另用角标提示，进详情页由选择器承载。 */}
          {variantCount > 1 && (
            <span className="ml-1.5 align-middle text-[10px] font-medium text-gray-400 border border-gray-200 rounded-md px-1 py-px">
              {variantCount} 种规格
            </span>
          )}
        </p>
      </div>

      {!disabled && (
        // gap 由 10px 提到 12px：配合 .tap-44 的命中区扩展，避免相邻按钮命中区重叠误触。
        // 原先这里是 <div onClick={stopPropagation}>（无语义、无键盘支持），
        // 改为在每个按钮自身阻止冒泡 —— 少一层非语义交互壳。
        <div className="flex items-center gap-3">
          {quantity > 0 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(product)
                }}
                aria-label={`减少${product.name}`}
                className="tap-44 w-8 h-8 rounded-full bg-gray-50 border border-gray-200 text-gray-500 flex items-center justify-center text-sm hover:bg-gray-100 hover:border-gray-300 transition-all duration-200 active:scale-90"
              >
                <span aria-hidden="true">-</span>
              </button>
              {/* 刻意不加 aria-live：列表里每张卡各挂一个 live region，加一次购
                  读屏就会连播一屏数字。增减数量的播报统一由页面级 toast 承担。 */}
              <span className="text-sm font-semibold w-5 text-center text-gray-800">
                {quantity}
              </span>
            </>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAdd(product, e)
            }}
            aria-label={`添加${product.name}`}
            className="tap-44 w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center text-sm shadow-soft hover:bg-brand-600 hover:shadow-elevated transition-all duration-200 active:scale-90"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      )}
    </div>
  )
}

// 列表项重渲染优化：商品列表在加购/改数量时会整列重渲染，
// memo 后只有数量变化的那张卡重新渲染（依赖父组件传入稳定的 onAdd/onRemove）。
export default memo(ProductCard)
