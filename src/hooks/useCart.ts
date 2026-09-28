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

  const add = useCallback((product: Product, qty = 1) => {
    persistAndSet(addToCart(cartRef.current, product, qty))
  }, [persistAndSet])

  // spec 可选：传了就只作用在那一行（同商品不同口味是两行），不传＝该商品全部口味。
  const remove = useCallback((productId: string, spec?: string | null) => {
    persistAndSet(removeFromCart(cartRef.current, productId, spec))
  }, [persistAndSet])

  const removeItem = useCallback((productId: string, spec?: string | null) => {
    persistAndSet(deleteFromCart(cartRef.current, productId, spec))
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
