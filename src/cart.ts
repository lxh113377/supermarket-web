import type { Cart, CartItem, Product } from './types'

const CART_KEY = 'sm_cart'

export function getCart(): Cart {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return { items: [] }
    return JSON.parse(raw) as Cart
  } catch {
    return { items: [] }
  }
}

export function saveCart(cart: Cart): void {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify({ ...cart, updatedAt: Date.now() }))
  } catch (e) {
    console.error('save cart failed:', e)
  }
}

export function clearCart(): void {
  try {
    localStorage.removeItem(CART_KEY)
  } catch (e) {
    console.error('clear cart failed:', e)
  }
}

export function getItemQuantity(cart: Cart, productId: string): number {
  return cart.items.find(item => item.productId === productId)?.quantity || 0
}

export function addToCart(cart: Cart, product: Product): Cart {
  const items = [...cart.items]
  const existing = items.find(item => item.productId === product._id)
  if (existing) {
    existing.quantity += 1
  } else {
    items.push({
      productId: product._id,
      name: product.name,
      spec: product.spec,
      price: product.price,
      quantity: 1,
      subcategories: product.subcategories,
    })
  }
  return { ...cart, items }
}

export function removeFromCart(cart: Cart, productId: string): Cart {
  const items: CartItem[] = cart.items
    .map(item => {
      if (item.productId === productId) {
        return { ...item, quantity: item.quantity - 1 }
      }
      return item
    })
    .filter(item => item.quantity > 0)
  return { ...cart, items }
}

export function deleteFromCart(cart: Cart, productId: string): Cart {
  return { ...cart, items: cart.items.filter(item => item.productId !== productId) }
}

export function getTotalAmount(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

export function getTotalCount(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0)
}
