import { memo } from 'react'
import type { CartItem as CartItemType } from '../types'
import { formatPrice } from '../utils/format'
import { productThumbUrl, productSrcSet } from '../utils/images'

interface CartItemProps {
  item: CartItemType
  onAdd: (item: CartItemType) => void
  onRemove: (item: CartItemType) => void
  onDelete: (item: CartItemType) => void
  /**
   * 目录序号（决定 /images/{order}.webp）。**由父页查目录得到**，不在本组件猜：
   * 一手实测（2026-10-26）购物车里的 productId 形态是 `p006`（补零三位），
   * 而 localStore 给 seed 补的 _id 是 `'p_' + p.order` —— 两条链不同形，
   * 靠正则解 id 会**静默取不到**（不报错、不红、构建照过，只有量 DOM 才看得见）。
   * 缺省（查不到目录 / SSR 冒烟不传）⇒ 整块不渲染而不是摆破图。
   */
  order?: number | string | null
}

/**
 * 购物袋的一行 = 底稿上的一行（2026-10-26 第 91 轮）。
 *
 * 旧形态是通用卡（rounded-2xl + shadow-card + 中间悬一个件数），与本页票脚、确认页
 * 实时票据不是一套语言。现在：缩略图立在暖台上、名称与算式在左、小计压右，
 * 行间虚线而不是卡片描边。
 *
 * 缩略图是本轮补的（目检抓到的最后一处廉价点）：商城卡、详情页灯箱、首页货架都有图，
 * 唯独购物袋这一屏是纯文字清单 —— 而它是转化链上最贵的一屏，「买的是什么」在这里
 * 反而看不见。**取数走 fail-safe**：只有父页能从目录**查到**该商品序号时才挂图，查不到就
 * 整块不渲染，而不是摆一个破图或占位方块 —— 硬猜 id 形态会造出一张指向别的商品的错图
 * （本仓「不编数字」同族的图像版）。
 *
 * 无障碍：图是**装饰**（alt 空串），名称已由 .cart-line-name 那个文字叶承载；给图再念一遍
 * 名称会让读屏每行播两次同名。
 *
 * ⚠️ 两条一手踩坑（都属「写了不报错、也不生效」这一族，与本轮的铜条/shimmer/焦点环同族）：
 *  ① 第一版在这里用正则解 productId 猜序号 —— 实测购物车里的 id 是 `p006`（补零三位），
 *     不是 `p_6`，于是永不匹配、缩略图**静默不渲染**（构建照过、lint 照过、测试照过）。
 *     正解 = 序号由父页查目录传入（CartPage 本来就要拉目录做价格漂移检测，零额外请求）。
 *  ② 写正则时把 \\d 误写成双反斜杠（源码里多一个反斜杠），同样永不匹配。
 *     两次都是「去 DOM 里数一数」才抓到 —— 这类缺陷构建 / lint / 单测三层都看不见。
 */
function CartItem({ item, onAdd, onRemove, onDelete, order }: CartItemProps) {
  const displayName = item.spec ? item.name + ' (' + item.spec + ')' : item.name
  const thumb = order != null && order !== '' ? productThumbUrl(order) : null
  const srcSet = thumb ? productSrcSet(order) : undefined
  return (
    <div className="cart-line">
      {thumb ? (
        <span className="cart-line-photo" aria-hidden="true">
          <img
            src={thumb}
            srcSet={srcSet}
            sizes="56px"
            width={400}
            height={400}
            loading="lazy"
            decoding="async"
            alt=""
          />
        </span>
      ) : null}
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
