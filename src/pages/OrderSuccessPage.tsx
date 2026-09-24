import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatYuan } from '../utils/format'

export default function OrderSuccessPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const building = state?.building || ''
  const room = state?.room || ''
  const orderId = state?.orderId || ''
  const totalAmount = state?.totalAmount || 0
  const [copied, setCopied] = useState(false)
  // 供「订单查询」页跨导航找回单号（微信内被刷掉 location.state 的兜底）
  useEffect(() => {
    if (orderId) sessionStorage.setItem('sm_query_order', orderId)
  }, [orderId])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface items-center justify-center p-6 animate-fade-in">
      <div className="text-center max-w-sm w-full" role="status" aria-live="polite">
        {/* 成功动画 */}
        <div className="relative mx-auto w-20 h-20 mb-6">
          <div className="absolute inset-0 rounded-full bg-green-100 animate-scale-in" />
          <div className="absolute inset-2 rounded-full bg-green-50 flex items-center justify-center animate-scale-in stagger-1">
            <span className="text-3xl" aria-hidden="true">✅</span>
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2 animate-fade-in-up stagger-1">下单成功！</h2>
        <p className="text-sm text-gray-400 mb-6 animate-fade-in-up stagger-2">订单已提交，请完成支付</p>

        <div className="bg-white rounded-2xl p-5 mb-6 shadow-card border border-gray-100/80 animate-fade-in-up stagger-2">
          {building && (
            <>
              <p className="text-xs text-gray-400 mb-1.5">楼栋号</p>
              <p className="text-2xl font-bold text-gray-900">{building}</p>
            </>
          )}
          {room && (
            <>
              <p className="text-xs text-gray-400 mb-1.5 mt-3">房间号</p>
              <p className="text-2xl font-bold text-gray-900">{room}</p>
            </>
          )}
          {totalAmount > 0 && (
            <p className={`text-sm text-brand-600 font-semibold ${building || room ? 'mt-2' : ''}`}>{formatYuan(totalAmount)}</p>
          )}
          {orderId && (
            <p className="text-xs text-gray-400 mt-3 font-mono break-all">订单号：{orderId}</p>
          )}
        </div>

        <div className="space-y-3 animate-fade-in-up stagger-3">
          <button
            onClick={() => navigate('/payment', { state: { orderId, totalAmount } })}
            className="btn-primary w-full py-4 rounded-2xl text-base shadow-elevated"
          >
            去支付
          </button>
          {orderId && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(orderId).then(() => setCopied(true)).catch(() => setCopied(false))
                }}
                className="btn-secondary flex-1 py-3 rounded-2xl text-sm"
              >
                {copied ? '已复制 ✓' : '复制订单号'}
              </button>
              <button
                onClick={() => navigate('/order-query', { state: { orderId } })}
                className="btn-secondary flex-1 py-3 rounded-2xl text-sm"
              >
                查询订单状态
              </button>
            </div>
          )}
          <button
            onClick={() => navigate('/')}
            className="btn-secondary w-full py-3.5 rounded-2xl text-sm"
          >
            继续选购
          </button>
        </div>
      </div>
    </div>
  )
}
