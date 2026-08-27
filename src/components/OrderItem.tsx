import React from 'react'
import type { OrderItem as OrderItemType } from '../types'

export default function OrderItem({ item }: { item: OrderItemType }) {
  const displayName = item.spec
    ? `${item.name} (${item.spec})`
    : item.name

  return (
    <div className="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <span className="text-sm text-gray-700 truncate">{displayName}</span>
        <span className="text-xs text-gray-400 ml-2">x{item.quantity}</span>
      </div>
      <span className="text-sm font-semibold text-gray-900 ml-3">
        ¥{(item.price * item.quantity).toFixed(2)}
      </span>
    </div>
  )
}
