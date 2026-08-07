import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getCart, saveCart, addToCart, removeFromCart, deleteFromCart, getTotalAmount, getTotalCount } from '../src/cart.js'

beforeAll(() => {
  const store = {}
  vi.stubGlobal('localStorage', {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = v },
    removeItem: (k) => { delete store[k] },
  })
})

describe('addToCart', () => {
  it('should add a new item', () => {
    const cart = { items: [] }
    const product = { _id: 'p1', name: '测试商品', spec: '500ml', price: 2.5 }
    const result = addToCart(cart, product)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].productId).toBe('p1')
    expect(result.items[0].quantity).toBe(1)
  })

  it('should increment quantity of existing item', () => {
    const cart = { items: [{ productId: 'p1', name: 'T', price: 1, quantity: 2 }] }
    const result = addToCart(cart, { _id: 'p1', name: 'T', price: 1 })
    expect(result.items[0].quantity).toBe(3)
  })
})

describe('removeFromCart', () => {
  it('should decrement quantity', () => {
    const cart = { items: [{ productId: 'x', name: 'X', price: 5, quantity: 3 }] }
    const result = removeFromCart(cart, 'x')
    expect(result.items[0].quantity).toBe(2)
  })

  it('should remove item when quantity hits 0', () => {
    const cart = { items: [{ productId: 'x', name: 'X', price: 5, quantity: 1 }] }
    const result = removeFromCart(cart, 'x')
    expect(result.items).toHaveLength(0)
  })

  it('should not modify cart if productId not found', () => {
    const cart = { items: [{ productId: 'a', name: 'A', price: 1, quantity: 1 }] }
    const result = removeFromCart(cart, 'nonexistent')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].quantity).toBe(1)
  })
})

describe('deleteFromCart', () => {
  it('should remove item regardless of quantity', () => {
    const cart = { items: [{ productId: 'x', name: 'X', price: 5, quantity: 99 }] }
    const result = deleteFromCart(cart, 'x')
    expect(result.items).toHaveLength(0)
  })
})

describe('getTotalAmount', () => {
  it('should sum item totals', () => {
    const cart = {
      items: [
        { productId: 'a', price: 2, quantity: 3 },
        { productId: 'b', price: 5, quantity: 1 },
      ],
    }
    expect(getTotalAmount(cart)).toBe(11) // 2*3 + 5*1
  })

  it('should return 0 for empty cart', () => {
    expect(getTotalAmount({ items: [] })).toBe(0)
  })
})

describe('getTotalCount', () => {
  it('should sum quantities', () => {
    const cart = { items: [{ quantity: 2 }, { quantity: 3 }] }
    expect(getTotalCount(cart)).toBe(5)
  })
})

describe('cart persist', () => {
  it('should save and load from localStorage', () => {
    const cart = { items: [{ productId: 'p1', price: 1, quantity: 1 }] }
    saveCart(cart)
    const loaded = getCart()
    expect(loaded.items).toHaveLength(1)
    expect(loaded.items[0].productId).toBe('p1')
  })
})
