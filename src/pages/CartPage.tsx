import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import CartItem from '../components/CartItem'
import EmptyState from '../components/EmptyState'
import { IconCart } from '../components/Icons'
import { getCart, saveCart, addToCart, removeFromCart, deleteFromCart, getTotalAmount, getTotalCount } from '../cart'
import { getProducts } from '../db'
import { formatYuan } from '../utils/format'
import type { Cart, CartItem as CartItemType, Product } from '../types'

interface PriceChange {
  name: string
  oldPrice: number
  newPrice: number
}

export default function CartPage() {
  const navigate = useNavigate()
  const [cart, setCart] = React.useState<Cart>(() => getCart())
  const [priceChanges, setPriceChanges] = React.useState<PriceChange[]>([])

  // 检测价格变动并同步刷新购物车显示价格（仅在页面打开时同步一次）
  const initialCartRef = React.useRef<Cart>(cart)
  React.useEffect(() => {
    const cart = initialCartRef.current
    if (cart.items.length === 0) return
    getProducts().then((products: Product[]) => {
      const changes: PriceChange[] = []
      let needUpdate = false
      const updatedItems = cart.items.map(item => {
        const latest = products.find(p => p._id === item.productId)
        if (latest && Math.abs(latest.price - item.price) > 0.001) {
          changes.push({ name: item.name, oldPrice: item.price, newPrice: latest.price })
          needUpdate = true
          return { ...item, price: latest.price }
        }
        return item
      })
      setPriceChanges(changes)
      if (needUpdate) {
        const newCart = { items: updatedItems }
        setCart(newCart)
        saveCart(newCart)
      }
    }).catch(() => {})
  }, [])

  // 三个回调用 useCallback 固定引用：CartItem 已 memo，
  // 传内联箭头函数会让 memo 完全失效（每次渲染都是新函数）。
  const handleAdd = useCallback((item: CartItemType) => {
    const product = { _id: item.productId, name: item.name, spec: item.spec, price: item.price }
    const newCart = addToCart(cart, product)
    setCart(newCart)
    saveCart(newCart)
  }, [cart])

  const handleRemove = useCallback((item: CartItemType) => {
    const newCart = removeFromCart(cart, item.productId)
    setCart(newCart)
    saveCart(newCart)
  }, [cart])

  const handleDelete = useCallback((item: CartItemType) => {
    const newCart = deleteFromCart(cart, item.productId)
    setCart(newCart)
    saveCart(newCart)
  }, [cart])

  const handleClose = () => {
    saveCart(cart)
    navigate(-1)
  }

  const totalAmount = getTotalAmount(cart)
  const totalCount = getTotalCount(cart)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-4 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
          aria-label="返回"
        >
          ←
        </button>
        <h2 className="text-base font-bold text-gray-900">购物车</h2>
        <div className="flex items-center gap-2">
          {cart.items.length > 0 && (
            <button
              onClick={() => {
                if (confirm('确定清空购物车？')) {
                  const empty = { items: [] }
                  setCart(empty)
                  saveCart(empty)
                }
              }}
              className="text-xs text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors duration-200"
            >
              清空
            </button>
          )}
          <button
            onClick={handleClose}
            aria-label="关闭"
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200 text-lg"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 w-full max-w-3xl lg:max-w-4xl mx-auto">
        {priceChanges.length > 0 && (
          <div className="mb-4 bg-amber-50/80 border border-amber-200/60 rounded-2xl p-4 animate-slide-down" role="status">
            <p className="text-amber-700 text-xs font-medium mb-2">以下商品价格已变动（结算按最新价格）：</p>
            {priceChanges.map((c, i) => (
              <p key={i} className="text-amber-600 text-xs mt-1">
                {c.name}：{formatYuan(c.oldPrice)} → {formatYuan(c.newPrice)}
              </p>
            ))}
          </div>
        )}
        {cart.items.length === 0 ? (
          <EmptyState
            className="h-full justify-center"
            icon={<IconCart className="w-6 h-6" />}
            title="购物车是空的"
            description="还没有添加任何商品"
            action={
              <button
                onClick={() => navigate('/shop')}
                className="btn-primary px-5 py-2.5 text-sm"
              >
                去逛逛
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {cart.items.map((item, i) => (
              <div key={item.productId} className={`animate-fade-in-up stagger-${Math.min(i + 1, 6)}`}>
                <CartItem
                  item={item}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* safe-bottom 覆盖下内边距，为 iPhone 底部小黑条留白 */}
      {cart.items.length > 0 && (
        <div className="border-t border-gray-100 px-5 pt-5 bg-white/95 backdrop-blur-sm safe-bottom">
          <div className="w-full max-w-3xl lg:max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-gray-500">共 {totalCount} 件</span>
              <span className="text-xl font-bold text-gray-900">
                <span className="text-xs font-medium text-gray-500 mr-1">合计</span>
                <span className="text-brand-600">{formatYuan(totalAmount)}</span>
              </span>
            </div>
            <button
              onClick={() => navigate('/order-confirm')}
              className="btn-primary w-full py-4 rounded-2xl text-base shadow-elevated"
            >
              去支付
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
