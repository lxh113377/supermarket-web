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

/**
 * 购物车行身份 = `productId + spec`（第三十六轮）。
 * 为什么必须含 spec：一条商品记录可以带多个口味（`product.specOptions`），详情页选中的口味
 * 以 `spec` 落到行上（`ProductDetailPage.tsx` 的 `add({ ...cartProduct, spec: effSpec }, n)`）。
 * 只按 productId 合并时，顾客先加「黄瓜味」再加「烤虾味」会并成一行且保留第一个口味 ⇒ 第二次的
 * 选择在购物袋层面就丢了，而下单侧本来就支持同商品多行（`functions/lib/actions/orders.js`
 * 逐 item 一行、幂等指纹含 spec）—— 缺陷 100% 在这一层键控上。
 * 口味不影响单价（`src/utils/spec-options.ts` 头部口径：口味只决定「要哪一个」），
 * 所以价格、图片、名称仍取这条商品记录的真值，行键只管"是不是同一行"。
 */
const sameLine = (item: CartItem, productId: string, spec?: string | null) =>
  item.productId === productId && (spec === undefined || spec === null || (item.spec || '') === spec)

/** 袋里该商品的总件数（跨口味聚合）—— 商品卡角标要的是"这个商品我拿了几件"，不是某一口味。 */
export function getItemQuantity(cart: Cart, productId: string): number {
  return cart.items.reduce((sum, item) => (item.productId === productId ? sum + item.quantity : sum), 0)
}

/**
 * 加入购物车。qty 支持一次加多件 —— 详情页的「数量」步进器需要它。
 * 不能靠调用方循环 add()：useCart 的 cartRef 在 effect 里才同步，
 * 同一批同步调用会读到同一个旧 cart，第二件覆盖第一件，最终只加 1 件。
 */
export function addToCart(cart: Cart, product: Product, qty = 1): Cart {
  const n = Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1
  const spec = product.spec || ''
  const hit = (item: CartItem) => item.productId === product._id && (item.spec || '') === spec
  // 命中就走 map 新建对象：原先是 `existing.quantity += n`，而 `[...cart.items]` 只拷数组不拷元素，
  // 等于把调用方手里那份旧 cart 就地改了（Vue 响应式与 cartRef 都拿到被污染的"上一个状态"）。
  const exists = cart.items.some(hit)
  const items: CartItem[] = exists
    ? cart.items.map(item => (hit(item) ? { ...item, quantity: item.quantity + n } : item))
    : [...cart.items, {
      productId: product._id,
      name: product.name,
      spec: product.spec,
      price: product.price,
      quantity: n,
      subcategories: product.subcategories,
    }]
  return { ...cart, items }
}

/** 减一件。传 spec 只减该口味那一行；不传 spec＝该商品所有口味各减一件（保留旧的整品递减语义）。 */
export function removeFromCart(cart: Cart, productId: string, spec?: string | null): Cart {
  const items: CartItem[] = cart.items
    .map(item => (sameLine(item, productId, spec) ? { ...item, quantity: item.quantity - 1 } : item))
    .filter(item => item.quantity > 0)
  return { ...cart, items }
}

/** 删除。传 spec＝只删那一行（口味 A）；不传＝删该商品全部口味（详情页"清空这个商品"用得上）。 */
export function deleteFromCart(cart: Cart, productId: string, spec?: string | null): Cart {
  return { ...cart, items: cart.items.filter(item => !sameLine(item, productId, spec)) }
}

export function getTotalAmount(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

export function getTotalCount(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0)
}
