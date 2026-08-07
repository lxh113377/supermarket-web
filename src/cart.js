const CART_KEY = 'sm_cart'

export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (!raw) return { items: [] }
    return JSON.parse(raw)
  } catch {
    return { items: [] }
  }
}

export function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify({ ...cart, updatedAt: Date.now() }))
  } catch (e) {
    console.error('save cart failed:', e)
  }
}

export function clearCart() {
  try {
    localStorage.removeItem(CART_KEY)
  } catch (e) {
    console.error('clear cart failed:', e)
  }
}

export function getItemQuantity(cart, productId) {
  return cart.items.find(item => item.productId === productId)?.quantity || 0
}

export function addToCart(cart, product) {
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
    })
  }
  return { ...cart, items }
}

export function removeFromCart(cart, productId) {
  const items = cart.items
    .map(item => {
      if (item.productId === productId) {
        return { ...item, quantity: item.quantity - 1 }
      }
      return item
    })
    .filter(item => item.quantity > 0)
  return { ...cart, items }
}

export function deleteFromCart(cart, productId) {
  return { ...cart, items: cart.items.filter(item => item.productId !== productId) }
}

export function getTotalAmount(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

export function getTotalCount(cart) {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0)
}
