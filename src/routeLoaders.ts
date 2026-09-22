// 路由级代码分割的唯一登记表（route → dynamic import 工厂）。
//
// 为什么单独抽出来：App.tsx 的 React.lazy 与「预取」必须共用同一份 import 工厂，
// 否则同一个页面会被打两个入口、或在预取后点击还要再下一次。
// 预取策略：hover / focus 时预取目标路由；首屏稳定后空闲预取高频路径。

export const routeLoaders = {
  home: () => import('./pages/HomePage'),
  category: () => import('./pages/CategoryPage'),
  service: () => import('./pages/ServiceFormPage'),
  shop: () => import('./pages/CustomerPage'),
  product: () => import('./pages/ProductDetailPage'),
  cart: () => import('./pages/CartPage'),
  assistant: () => import('./pages/AssistantPage'),
  orderConfirm: () => import('./pages/OrderConfirmPage'),
  orderSuccess: () => import('./pages/OrderSuccessPage'),
  payment: () => import('./pages/PaymentPage'),
  admin: () => import('./pages/AdminPage'),
  notFound: () => import('./pages/NotFoundPage'),
} as const

export type RouteKey = keyof typeof routeLoaders

/** 已发起过预取/加载的 key，避免重复触发同一个 chunk 请求 */
const requested = new Set<RouteKey>()

/** 空闲时执行回调（requestIdleCallback 不可用时退回 setTimeout） */
function onIdle(fn: () => void, timeout = 2000) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout })
  else setTimeout(fn, 200)
}

function load(key: RouteKey) {
  if (requested.has(key)) return
  requested.add(key)
  routeLoaders[key]().catch(() => {
    // 预取失败不处理：用户真正导航时 lazy() 会重新发起并走 Suspense 兜底
    requested.delete(key)
  })
}

/**
 * 预取单个路由的 chunk。
 * 用于 hover / focus 等「用户意图已出现但尚未点击」的时机。
 */
export function prefetchRoute(key: RouteKey) {
  onIdle(() => load(key), 1200)
}

/**
 * 首屏就绪后空闲预取高频路由。
 * 只在窗口空闲时执行，不抢占首屏的带宽与主线程。
 */
export function prefetchHotRoutes(keys: RouteKey[] = ['category', 'shop', 'product', 'cart']) {
  onIdle(() => {
    keys.forEach((k, i) => {
      // 逐个错开，避免同一帧并发发起多个请求
      onIdle(() => load(k), 1500 + i * 300)
    })
  }, 3000)
}
