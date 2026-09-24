import type { Cart, CartItem, Product } from './types'

const CART_KEY = 'sm_cart'

// P0-15/16 共享：解析并校验购物车数据（损坏/畸形数据安全降级，避免 items.find 崩溃）
export function parseCart(raw: string | null): Cart {
  if (!raw) return { items: [] }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Cart).items)) {
      return { items: [] }
    }
    return parsed as Cart
  } catch {
    return { items: [] }
  }
}

export function getCart(): Cart {
  return parseCart(localStorage.getItem(CART_KEY))
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

/**
 * 加入购物车。qty 支持一次加多件 —— 详情页的「数量」步进器需要它。
 * 不能靠调用方循环 add()：useCart 的 cartRef 在 effect 里才同步，
 * 同一批同步调用会读到同一个旧 cart，第二件覆盖第一件，最终只加 1 件。
 */
export function addToCart(cart: Cart, product: Product, qty = 1): Cart {
  const n = Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1
  const items = [...cart.items]
  const existing = items.find(item => item.productId === product._id)
  if (existing) {
    existing.quantity += n
  } else {
    items.push({
      productId: product._id,
      name: product.name,
      spec: product.spec,
      price: product.price,
      quantity: n,
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
