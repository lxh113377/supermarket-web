import React from 'react'
import type { CartItem as CartItemType } from '../types'

interface CartItemProps {
  item: CartItemType
  onAdd: () => void
  onRemove: () => void
  onDelete: () => void
}

export default function CartItem({ item, onAdd, onRemove, onDelete }: CartItemProps) {
  const displayName = item.spec
    ? `${item.name} (${item.spec})`
    : item.name

  return (
    <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-gray-100/80 shadow-card transition-all duration-200">
      <div className="flex-1 min-w-0 pr-3">
        <h3 className="text-sm font-medium text-gray-900 leading-tight truncate">{displayName}</h3>
        <p className="text-brand-600 font-bold mt-1.5">
          <span className="text-xs">¥</span>{item.price.toFixed(2)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onRemove}
            aria-label={`减少${displayName}`}
            className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 text-gray-500 flex items-center justify-center text-sm hover:bg-gray-100 transition-all duration-200 active:scale-90"
          >
            -
          </button>
          <span className="text-sm font-semibold w-5 text-center text-gray-800">{item.quantity}</span>
          <button
            onClick={onAdd}
            aria-label={`增加${displayName}`}
            className="w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center text-sm shadow-soft hover:bg-brand-600 transition-all duration-200 active:scale-90"
          >
            +
          </button>
        </div>
        <button
          onClick={onDelete}
          className="text-xs text-red-400 px-2.5 py-1.5 border border-red-100 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all duration-200"
        >
          删除
        </button>
      </div>
    </div>
  )
}
