import { useState, useEffect, useRef, useCallback } from 'react'
import { getCart, saveCart, addToCart, removeFromCart, deleteFromCart, getTotalCount, getTotalAmount, getItemQuantity, parseCart } from '../cart'
import type { Cart, Product } from '../types'

export default function useCart() {
  const [cart, setCart] = useState<Cart>(getCart())
  const cartRef = useRef<Cart>(cart)

  // 保持 ref 为最新值，供 callback 读取（避免 stale closure）
  useEffect(() => { cartRef.current = cart }, [cart])

  // 跨 tab 同步：监听 localStorage 变化（P0-16：复用 parseCart 形状校验）
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'sm_cart') {
        setCart(parseCart(e.newValue))
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const persistAndSet = useCallback((newCart: Cart) => {
    setCart(newCart)
    saveCart(newCart)
  }, [])

  const add = useCallback((product: Product) => {
    persistAndSet(addToCart(cartRef.current, product))
  }, [persistAndSet])

  const remove = useCallback((productId: string) => {
    persistAndSet(removeFromCart(cartRef.current, productId))
  }, [persistAndSet])

  const removeItem = useCallback((productId: string) => {
    persistAndSet(deleteFromCart(cartRef.current, productId))
  }, [persistAndSet])

  const clear = useCallback(() => {
    const empty: Cart = { items: [] }
    setCart(empty)
    saveCart(empty)
  }, [])

  return {
    cart,
    add,
    remove,
    removeItem,
    clear,
    totalCount: getTotalCount(cart),
    totalAmount: getTotalAmount(cart),
    getQuantity: (id: string) => getItemQuantity(cart, id),
  }
}
