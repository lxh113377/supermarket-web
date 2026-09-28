import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getCart, saveCart, addToCart, removeFromCart, deleteFromCart, getTotalAmount, getTotalCount, getItemQuantity, MAX_QTY_PER_LINE } from '../src/cart'

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

  it('新条目携带 subcategories 供看板分类统计', () => {
    const cart = { items: [] }
    const result = addToCart(cart, { _id: 'p1', name: '可乐', price: 3, subcategories: ['soda'] })
    expect(result.items[0].subcategories).toEqual(['soda'])
  })

  it('getItemQuantity 返回已有数量或 0', () => {
    expect(getItemQuantity({ items: [{ productId: 'p1', quantity: 2 }] }, 'p1')).toBe(2)
    expect(getItemQuantity({ items: [] }, 'p9')).toBe(0)
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

  it('空购物车返回 0', () => {
    expect(getTotalCount({ items: [] })).toBe(0)
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

describe('行身份 = (productId, spec)（第三十六轮修 A-19）', () => {
  const p1a = { _id: 'p1', name: '康师傅冰红茶', spec: '40g · 黄瓜味', price: 3 }
  const p1b = { _id: 'p1', name: '康师傅冰红茶', spec: '1L · 柠檬味', price: 3 }

  it('同一商品先后选两个口味 ⇒ 两行，各自的口味都留着（旧行为：第二次的选择被静默吞掉）', () => {
    let cart = { items: [] }
    cart = addToCart(cart, p1a)
    cart = addToCart(cart, p1b)
    expect(cart.items).toHaveLength(2)
    expect(cart.items.map(i => i.spec).sort()).toEqual(['1L · 柠檬味', '40g · 黄瓜味'])
    expect(cart.items.every(i => i.quantity === 1)).toBe(true)
  })

  it('同商品同口味重复加 ⇒ 仍并成一行并累加（别把键控修成"每次都新增一行"）', () => {
    let cart = { items: [] }
    cart = addToCart(cart, p1a)
    cart = addToCart(cart, p1a, 2)
    expect(cart.items).toHaveLength(1)
    expect(cart.items[0].quantity).toBe(3)
  })

  it('减号只减指定口味那一行；不传 spec 才"各口味各减一件"', () => {
    let cart = { items: [] }
    cart = addToCart(cart, p1a, 2)
    cart = addToCart(cart, p1b, 2)
    const one = removeFromCart(cart, 'p1', p1a.spec)
    expect(one.items).toHaveLength(2)
    expect(one.items.find(i => i.spec === p1a.spec).quantity).toBe(1)
    expect(one.items.find(i => i.spec === p1b.spec).quantity).toBe(2)
    const all = removeFromCart(cart, 'p1')
    expect(all.items.every(i => i.quantity === 1)).toBe(true)
  })

  it('删除：传 spec 只删那一行，不传删该商品全部口味（详情页"清掉这个商品"仍要用后者）', () => {
    let cart = { items: [] }
    cart = addToCart(cart, p1a)
    cart = addToCart(cart, p1b)
    cart = addToCart(cart, { _id: 'p2', name: '其它商品', price: 1 })
    const only = deleteFromCart(cart, 'p1', p1a.spec)
    expect(only.items.filter(i => i.productId === 'p1').map(i => i.spec)).toEqual(['1L · 柠檬味'])
    expect(only.items.some(i => i.productId === 'p2')).toBe(true)
    const gone = deleteFromCart(cart, 'p1')
    expect(gone.items.map(i => i.productId)).toEqual(['p2'])
  })

  it('角标 = 该商品跨口味总件数（卡上只有一个数字，它该是"我拿了几件"）', () => {
    let cart = { items: [] }
    cart = addToCart(cart, p1a, 2)
    cart = addToCart(cart, p1b, 3)
    expect(getItemQuantity(cart, 'p1')).toBe(5)
    expect(getItemQuantity(cart, 'p9')).toBe(0)
  })

  it('旧 cart（无 spec 字段的存量数据）不会被拆成新行：undefined 与 "" 同一身份', () => {
    const legacy = { items: [{ productId: 'p1', name: 'T', price: 1, quantity: 2 }] }
    const merged = addToCart(legacy, { _id: 'p1', name: 'T', price: 1 })
    expect(merged.items).toHaveLength(1)
    expect(merged.items[0].quantity).toBe(3)
    expect(removeFromCart(legacy, 'p1', '').items[0].quantity).toBe(1)
    // 反证同一身份判定确实生效：拿"有 spec 的行"去比空串，不该被认成同一行
    const withSpec = { items: [{ productId: 'p1', name: 'T', spec: '40g', price: 1, quantity: 2 }] }
    expect(removeFromCart(withSpec, 'p1', '').items[0].quantity).toBe(2)
  })

  it('不可变性：addToCart 不得就地改调用方手里那份旧 cart（老实现是 existing.quantity += n）', () => {
    const before = { items: [{ productId: 'p1', name: 'T', spec: 'a', price: 1, quantity: 2 }] }
    const snapshot = JSON.stringify(before)
    const after = addToCart(before, { _id: 'p1', name: 'T', spec: 'a', price: 1 }, 5)
    expect(JSON.stringify(before), '旧 cart 被就地改写了 ⇒ 响应式与 cartRef 会拿到污染状态').toBe(snapshot)
    expect(after.items[0].quantity).toBe(7)
    expect(after.items[0]).not.toBe(before.items[0])
  })

  it('总价/总数按行算，两口味两行不互相吞数量', () => {
    let cart = { items: [] }
    cart = addToCart(cart, p1a, 2)
    cart = addToCart(cart, p1b, 1)
    expect(getTotalCount(cart)).toBe(3)
    expect(getTotalAmount(cart)).toBeCloseTo(9, 2)
  })
})

describe('数量封顶（第三十七轮 R37-H3）', () => {
  // 选封顶而不是报错：本地不该出现一个"下单必被服务端拒"的形状；两侧等号由 limitCapParity 钉
  it('封顶不是截断到 0：正常加购不受影响', () => {
    const c = addToCart({ items: [] }, { _id: 'pc1', name: '水', spec: '550ml', price: 1 }, 3)
    expect(c.items[0].quantity).toBe(3)
  })
  it('累加过界停在 99，不会加出第 100 件（本地不该出现必被服务端拒的形状）', () => {
    let c = addToCart({ items: [] }, { _id: 'pc2', name: '面', spec: '', price: 1 }, 98)
    c = addToCart(c, { _id: 'pc2', name: '面', spec: '', price: 1 }, 5)
    expect(c.items).toHaveLength(1)
    expect(c.items[0].quantity).toBe(MAX_QTY_PER_LINE)
  })
  it('一次加 500 件的新行也被封顶（不是"只约束累加"）', () => {
    const c = addToCart({ items: [] }, { _id: 'pc3', name: '纸巾', spec: '抽纸', price: 1 }, 500)
    expect(c.items[0].quantity).toBe(MAX_QTY_PER_LINE)
    expect(getItemQuantity(c, 'pc3')).toBe(MAX_QTY_PER_LINE)
  })
})
