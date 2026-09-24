import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import AdminGuard from './components/AdminGuard'
import { routeLoaders } from './routeLoaders'
import { prefetchHotRoutes } from './prefetchBus'

// 与 routeLoaders 共用同一份 import 工厂：预取过的 chunk，点击时无需再下载。
const HomePage = lazy(routeLoaders.home)
const CategoryPage = lazy(routeLoaders.category)
const ServiceFormPage = lazy(routeLoaders.service)
const CustomerPage = lazy(routeLoaders.shop)
const ProductDetailPage = lazy(routeLoaders.product)
const CartPage = lazy(routeLoaders.cart)
const OrderConfirmPage = lazy(routeLoaders.orderConfirm)
const OrderSuccessPage = lazy(routeLoaders.orderSuccess)
const OrderQueryPage = lazy(routeLoaders.orderQuery)
const PaymentPage = lazy(routeLoaders.payment)
const AdminPage = lazy(routeLoaders.admin)
const NotFoundPage = lazy(routeLoaders.notFound)
const AssistantPage = lazy(routeLoaders.assistant)

/**
 * 路由切换的兜底 UI。
 * 相较此前版本的两处改动：
 *   ① 内联 <style> 移到 index.css（原实现每次渲染都往 DOM 注入一段 style，
 *      也是 CSP 不得不放开 style-src 'unsafe-inline' 的原因之一）
 *   ② 背景由不透明 bg-surface 改为半透明 + 轻微模糊，配合预取后基本不再出现，
 *      万一出现也不会「闪白一整屏」
 */
function RouteLoader() {
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface/60 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
    >
      <div className="w-8 h-8 border-[3px] border-brand-100 border-t-brand-500 rounded-full animate-spin" />
      <div className="fixed top-0 left-0 right-0 h-0.5 overflow-hidden">
        <div className="h-full brand-bar rounded-full route-progress" />
      </div>
      <span className="sr-only">页面加载中</span>
    </div>
  )
}


export default function App() {
  // 首屏渲染完成后，空闲时段预取高频路由（分类 / 商城 / 详情 / 购物车）。
  // 不阻塞首屏：请求全部在 requestIdleCallback（降级 setTimeout）中发起。
  useEffect(() => {
    prefetchHotRoutes()
  }, [])

  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/category/:categoryId" element={<CategoryPage />} />
          <Route path="/service/:serviceId" element={<ServiceFormPage />} />
          <Route path="/shop" element={<CustomerPage />} />
          <Route path="/product/:id" element={<ProductDetailPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/order-confirm" element={<OrderConfirmPage />} />
          <Route path="/order-success" element={<OrderSuccessPage />} />
          <Route path="/order-query" element={<OrderQueryPage />} />
          <Route path="/payment" element={<PaymentPage />} />
          <Route path="/admin" element={<AdminGuard><AdminPage /></AdminGuard>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
