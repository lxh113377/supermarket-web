import { memo } from 'react'
import type { OrderItem as OrderItemType } from '../types'
import { formatYuan } from '../utils/format'

/**
 * 确认页「已选商品」的一行 = 收据上的一行（2026-10-26 第 91 轮）。
 *
 * 旧形态是通用列表行（text-sm + border-b + 右侧灰字件数），与本页右栏那张实时票据
 * 不是一套语言 —— 同一张单上「商品行」与「金额行」长得不一样，读起来像两个页面拼的。
 * 现在直接复用收据的行版式：栏目名在左（字距拉开的小字）、金额在右（等宽粗体），
 * 件数并进名称那一侧而不是悬在中间。
 *
 * 本组件唯一的消费者就是 OrderConfirmPage（实测 grep 全站仅此一处 import），
 * 所以改它不会波及其他页面；行身份 (productId, spec) 由调用方的 key 承担。
 */
function OrderItem({ item }: { item: OrderItemType }) {
  return (
    <div className="receipt-row">
      <span>
        {item.name}
        {item.spec ? ` (${item.spec})` : ''} ×{item.quantity}
      </span>
      <strong>{formatYuan(item.price * item.quantity)}</strong>
    </div>
  )
}

// 订单明细行是纯展示、按 item 渲染的列表项，memo 避免父级刷新时整列重算
export default memo(OrderItem)
