// 路由级代码分割的唯一登记表（route → dynamic import 工厂）。
//
// App.tsx 的 React.lazy 与预取总线共用同一份 import 工厂：预取过的 chunk，
// 点击时无需再下载。工厂在模块初始化时注册到 prefetchBus。
//
// ⚠️ 页面/组件禁止 import 本表（只要 hover 预取就去 import prefetchBus）：
// 本表 import 全部页面，页面再 import 本表即循环依赖（2026-09-23 实测 3 处）。
import { registerRouteFactory } from './prefetchBus'

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
  orderQuery: () => import('./pages/OrderQueryPage'),
  payment: () => import('./pages/PaymentPage'),
  admin: () => import('./pages/AdminPage'),
  notFound: () => import('./pages/NotFoundPage'),
} as const

export type RouteKey = keyof typeof routeLoaders

for (const [key, factory] of Object.entries(routeLoaders)) {
  registerRouteFactory(key, factory)
}
