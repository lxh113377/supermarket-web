import { memo } from 'react'
import type { OrderItem as OrderItemType } from '../types'
import { formatYuan } from '../utils/format'

function OrderItem({ item }: { item: OrderItemType }) {
  const displayName = item.spec
    ? `${item.name} (${item.spec})`
    : item.name

  return (
    <div className="flex justify-between items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <span className="text-sm text-gray-700 truncate">{displayName}</span>
        <span className="text-xs text-gray-400 ml-2">x{item.quantity}</span>
      </div>
      <span className="text-sm font-semibold text-gray-900 shrink-0">
        {formatYuan(item.price * item.quantity)}
      </span>
    </div>
  )
}

// 订单明细行是纯展示、按 item 渲染的列表项，memo 避免父级刷新时整列重算
export default memo(OrderItem)
