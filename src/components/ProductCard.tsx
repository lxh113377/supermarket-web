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

/**
 * 图注式商品卡（阶段二「暖白画廊」）。
 *
 * 与旧版的根本差别：旧卡是 56px 小缩略图 + 文字横排，图片只是个符号；
 * 新卡让图片当主角（1:1 满幅、白底自然融入暖白页底），文字退成图注。
 *
 * 一个由真实数据逼出来的决定：上架 28 件里「农夫山泉矿泉水」和「怡宝矿泉水」
 * 各出现两次，**只有 spec 能区分**（1.5L vs 550ml / 2.08L vs 550ml）。
 * 所以规格从旧版的括号附注提升为独立一行，不再挤在品名后面。
 *
 * 价格色由 brand-600(#ca8a04) 改为 brand-700(#a16207)：前者对白底只有 2.82:1，
 * 连 AA 大字标准 3:1 都不过；后者 4.71:1，正文级也够。
 */
function ProductCard({ product, quantity, onAdd, onRemove }: ProductCardProps) {
  const navigate = useNavigate()
  const disabled = product.enabled === false
  const [imgErr, setImgErr] = useState(false)
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
      aria-label={disabled ? undefined : `查看${product.name}${product.spec ? ` ${product.spec}` : ''}详情`}
      className={`group relative flex flex-col overflow-hidden rounded-2xl text-left transition-all duration-300 ${
        disabled
          ? 'bg-gray-50 opacity-50 grayscale border border-gray-100'
          : 'bg-white/60 border border-transparent hover:border-brand-200 hover:shadow-elevated cursor-pointer active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand-500'
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
      {/* 图区：1:1 满幅。商品图本身多为白底，用 object-contain 不裁切包装信息，
          白底与卡片底色相接看不出边界；hover 时轻微放大，是「画廊里凑近看」的动作隐喻。 */}
      <div className="relative w-full aspect-square overflow-hidden bg-white">
        {imgSrc && !imgErr ? (
          <img
            src={imgSrc}
            srcSet={imgSrcSet}
            sizes="(max-width: 639px) 46vw, (max-width: 1023px) 30vw, 240px"
            width={400}
            height={400}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-contain p-2 transition-transform duration-500 ease-out group-hover:scale-[1.06]"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand-50 to-orange-50">
            <span className="text-4xl" aria-hidden="true">
              {product.subcategories?.includes('snacks') || product.subcategories?.includes('filling') ? '🍜' : '🥤'}
            </span>
            <span className="text-[10px] text-gray-400">示意图 · 非商品实拍</span>
          </div>
        )}

        {/* 已加购件数：角标压在图左上，取代旧版挤在按钮中间的数字 */}
        {quantity > 0 && !disabled && (
          <span
            className="absolute top-2 left-2 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center tabular-nums shadow-soft"
            aria-hidden="true"
          >{quantity}</span>
        )}

        {/* 加购控件压在图右下：卡片其余区域整块可点进详情，操作与浏览互不干扰 */}
        {!disabled && (
          <div className="absolute right-2 bottom-2 flex items-center gap-3">
            {quantity > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(product)
                }}
                aria-label={`减少${product.name}`}
                className="tap-44 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm border border-gray-200 text-gray-600 flex items-center justify-center text-base leading-none shadow-soft hover:bg-white hover:border-brand-300 transition-all duration-200 active:scale-90"
              >
                <span aria-hidden="true">-</span>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAdd(product, e)
              }}
              aria-label={`添加${product.name}`}
              className="tap-44 w-9 h-9 rounded-full bg-brand-500 text-white flex items-center justify-center text-lg leading-none shadow-elevated hover:bg-brand-600 transition-all duration-200 active:scale-90"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        )}
      </div>

      {/* 图注区 */}
      <div className="flex flex-col flex-1 min-w-0 px-3 pt-2.5 pb-3">
        <h3 className={`text-sm font-semibold leading-snug line-clamp-2 ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
          {product.name}
        </h3>
        {/* 规格独立成行：同名商品（农夫山泉矿泉水 / 怡宝矿泉水）全靠它区分，不能缩成附注 */}
        {product.spec ? (
          <p className={`text-xs mt-1 ${disabled ? 'text-gray-400' : 'text-gray-500'}`}>{product.spec}</p>
        ) : (
          <p className="text-xs mt-1 text-transparent select-none" aria-hidden="true">·</p>
        )}
        {disabled && (
          <span className="self-start mt-1.5 text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-md font-medium">
            已下架
          </span>
        )}
        <p className={`text-xl font-bold mt-1.5 tabular-nums ${disabled ? 'text-gray-400' : 'text-brand-700'}`}>
          <span className="text-xs font-semibold align-top">¥</span>{formatPrice(product.price)}
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
    </div>
  )
}

// 列表项重渲染优化：商品列表在加购/改数量时会整列重渲染，
// memo 后只有数量变化的那张卡重新渲染（依赖父组件传入稳定的 onAdd/onRemove）。
export default memo(ProductCard)
