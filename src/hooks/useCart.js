import { useState, useEffect, useRef, useCallback } from 'react'
import { getCart, saveCart, addToCart, removeFromCart, deleteFromCart, getTotalCount, getTotalAmount, getItemQuantity } from '../cart.js'

export default function useCart() {
  const [cart, setCart] = useState(getCart())
  const cartRef = useRef(cart)

  // 保持 ref 为最新值，供 callback 读取（避免 stale closure）
  useEffect(() => { cartRef.current = cart }, [cart])

  // 跨 tab 同步：监听 localStorage 变化
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'sm_cart') {
        try { setCart(JSON.parse(e.newValue || '{"items":[]}')) } catch {}
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const persistAndSet = useCallback((newCart) => {
    setCart(newCart)
    saveCart(newCart)
  }, [])

  const add = useCallback((product) => {
    persistAndSet(addToCart(cartRef.current, product))
  }, [persistAndSet])

  const remove = useCallback((productId) => {
    persistAndSet(removeFromCart(cartRef.current, productId))
  }, [persistAndSet])

  const removeItem = useCallback((productId) => {
    persistAndSet(deleteFromCart(cartRef.current, productId))
  }, [persistAndSet])

  const clear = useCallback(() => {
    const empty = { items: [] }
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
    getQuantity: (id) => getItemQuantity(cart, id),
  }
}
