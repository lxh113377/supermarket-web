import React, { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import AdminGuard from './components/AdminGuard.jsx'

const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const CategoryPage = lazy(() => import('./pages/CategoryPage.jsx'))
const ServiceFormPage = lazy(() => import('./pages/ServiceFormPage.jsx'))
const CustomerPage = lazy(() => import('./pages/CustomerPage.jsx'))
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage.jsx'))
const CartPage = lazy(() => import('./pages/CartPage.jsx'))
const OrderConfirmPage = lazy(() => import('./pages/OrderConfirmPage.jsx'))
const OrderSuccessPage = lazy(() => import('./pages/OrderSuccessPage.jsx'))
const PaymentPage = lazy(() => import('./pages/PaymentPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))

function RouteLoader() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface">
      <div className="w-8 h-8 border-[3px] border-brand-100 border-t-brand-500 rounded-full animate-spin" />
      <div className="fixed top-0 left-0 right-0 h-0.5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-brand-400 to-brand-500 rounded-full"
          style={{ animation: 'routeProgress 0.8s cubic-bezier(0.4,0,0.2,1) forwards' }}
        />
      </div>
      <style>{`
        @keyframes routeProgress {
          0% { width: 0; opacity: 1; }
          70% { width: 85%; opacity: 1; }
          100% { width: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  )
}

export default function App() {
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
          <Route path="/order-confirm" element={<OrderConfirmPage />} />
          <Route path="/order-success" element={<OrderSuccessPage />} />
          <Route path="/payment" element={<PaymentPage />} />
          <Route path="/admin" element={<AdminGuard><AdminPage /></AdminGuard>} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
