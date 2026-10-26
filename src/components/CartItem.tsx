import { memo } from 'react'
import type { CartItem as CartItemType } from '../types'
import { formatPrice } from '../utils/format'

interface CartItemProps {
  item: CartItemType
  onAdd: (item: CartItemType) => void
  onRemove: (item: CartItemType) => void
  onDelete: (item: CartItemType) => void
}

/**
 * 购物袋的一行 = 底稿上的一行（2026-10-26 第 91 轮）。
 *
 * 旧形态是通用卡（rounded-2xl + shadow-card + border-gray-100/80 + 中间悬一个件数），
 * 与本页票脚、确认页实时票据不是一套语言 —— 同一条链路上「车」与「票」长得像两个产品。
 * 现在：名称与规格在左（可换行，不再 truncate 掉长名）、单价与件数在中间成式、
 * 小计压右（等宽数字，与票据金额同一档），行间用虚线而不是卡片描边。
 *
 * 件数那格保留 aria-live：它是「按了 +/- 之后到底变没变」的读屏回执；
 * 视觉上它是算式的一部分（¥2.66 × 3），不再是一个悬在中间的孤立数字。
 */
function CartItem({ item, onAdd, onRemove, onDelete }: CartItemProps) {
  const displayName = item.spec ? item.name + ' (' + item.spec + ')' : item.name
  return (
    <div className="cart-line">
      <div className="cart-line-main">
        <span className="cart-line-name">{displayName}</span>
        <span className="cart-line-formula price-num">
          ¥{formatPrice(item.price)} <span aria-hidden="true">×</span>
          <span aria-live="polite">{item.quantity}</span>
        </span>
      </div>
      <div className="cart-line-side">
        <strong className="cart-line-amount price-num">{formatPrice(item.price * item.quantity)}</strong>
        <div className="flex items-center gap-1">
          {/* gap 12px 配合 .tap-44 命中区外扩，避免相邻按钮误触（触控闸口径） */}
          <button
            onClick={() => onRemove(item)}
            aria-label={'减少' + displayName}
            className="tap-44 cart-step bg-gray-50 border border-gray-200 text-stone-500 hover:bg-gray-100 hover:text-stone-700 transition duration-200 active:scale-90"
          >
            <span aria-hidden="true">-</span>
          </button>
          <button
            onClick={() => onAdd(item)}
            aria-label={'增加' + displayName}
            className="tap-44 cart-step bg-brand-500 text-espresso hover:bg-brass shadow-soft transition duration-200 active:scale-90"
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            onClick={() => onDelete(item)}
            aria-label={'删除' + displayName}
            className="cart-remove text-xs text-red-700 border border-red-100 hover:bg-red-50 hover:text-cream hover:border-red-700 transition duration-200"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(CartItem)
