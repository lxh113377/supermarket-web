import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function ProductCard({ product, quantity, onAdd, onRemove }) {
  const navigate = useNavigate()
  const disabled = product.enabled === false
  const [imgErr, setImgErr] = useState(false)
  const displayName = product.spec
    ? `${product.name} (${product.spec})`
    : product.name
  const imgSrc = product.order ? `/images/${product.order}.webp` : null

  const goDetail = () => {
    if (!disabled) navigate(`/product/${product._id}`)
  }

  return (
    <div
      className={`flex items-center gap-3 p-3.5 rounded-2xl transition-all duration-300 ${
        disabled
          ? 'bg-gray-50 opacity-50 grayscale border border-gray-100'
          : 'bg-white border border-gray-100/80 shadow-card hover:shadow-elevated hover:-translate-y-0.5 cursor-pointer active:scale-[0.98]'
      }`}
      onClick={goDetail}
    >
      {/* 商品缩略图 */}
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-50 border border-gray-100/60 shrink-0">
        {imgSrc && !imgErr ? (
          <img
            src={imgSrc}
            srcSet={`/images/sm/${product.order}.webp 400w, ${imgSrc} 800w`}
            sizes="56px"
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl bg-gradient-to-br from-brand-50 to-orange-50">
            {product.subcategories?.includes('snacks') || product.subcategories?.includes('filling') ? '🍜' : '🥤'}
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
          <span className="text-xs font-medium">¥</span>{product.price.toFixed(2)}
        </p>
      </div>

      {!disabled && (
        <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          {quantity > 0 && (
            <>
              <button
                onClick={onRemove}
                aria-label={`减少${product.name}`}
                className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 text-gray-500 flex items-center justify-center text-sm hover:bg-gray-100 hover:border-gray-300 transition-all duration-200 active:scale-90"
              >
                -
              </button>
              <span className="text-sm font-semibold w-5 text-center text-gray-800">{quantity}</span>
            </>
          )}
          <button
            onClick={(e) => onAdd(e)}
            aria-label={`添加${product.name}`}
            className="w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center text-sm shadow-soft hover:bg-brand-600 hover:shadow-elevated transition-all duration-200 active:scale-90"
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}
