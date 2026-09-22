import {  useEffect, useState  } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getOrderById } from '../db'
import { IS_CLOUD } from '../cloudbase'
import Overlay from '../components/Overlay'
import { formatYuan } from '../utils/format'

export default function PaymentPage() {
  const [method, setMethod] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const [showTip, setShowTip] = useState(false)
  const { state } = useLocation()
  const navigate = useNavigate()

  const orderId = state?.orderId || sessionStorage.getItem('sm_payment_order') || ''
  const totalAmount = state?.totalAmount || parseFloat(sessionStorage.getItem('sm_payment_amount') || '0')
  useEffect(() => {
    if (orderId) sessionStorage.setItem('sm_payment_order', orderId)
    if (totalAmount) sessionStorage.setItem('sm_payment_amount', String(totalAmount))
  }, [orderId, totalAmount])

  useEffect(() => {
    if (!orderId) navigate('/', { replace: true })
  }, [orderId, navigate])

  useEffect(() => {
    if (!orderId || !IS_CLOUD || paid) return
    let cancelled = false
    const check = async () => {
      try {
        const order = await getOrderById(orderId)
        // P0-7：卸载后不再 setState
        if (!cancelled && order?.status === 'paid') setPaid(true)
      } catch {}
    }
    const timer = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [orderId, paid])

  const qrSrc = method === 'wechat' ? './wechat-pay.png' : './alipay.jpg'

  if (!orderId) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      {/* 顶栏 */}
      <div className="px-5 py-4 bg-white/95 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between">
        <button
          onClick={() => navigate('/order-success', { state: { orderId } })}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
          aria-label="返回"
        >
          ←
        </button>
        <h2 className="text-base font-bold text-gray-900">选择支付方式</h2>
        <span className="w-9" />
      </div>

      {!method ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 w-full max-w-lg mx-auto">
          <p className="text-sm text-gray-400 mb-2">请选择支付方式完成付款</p>
          <button
            onClick={() => setMethod('wechat')}
            className="w-full max-w-sm bg-green-500 text-white py-4 rounded-2xl text-base font-medium shadow-elevated hover:bg-green-600 transition-all duration-200 active:scale-[0.98] animate-fade-in-up stagger-1"
          >
            微信支付
          </button>
          <button
            onClick={() => { setMethod('alipay'); setShowTip(true) }}
            className="w-full max-w-sm bg-blue-500 text-white py-4 rounded-2xl text-base font-medium shadow-elevated hover:bg-blue-600 transition-all duration-200 active:scale-[0.98] animate-fade-in-up stagger-2"
          >
            支付宝付款
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-5 py-3">
          {/* 支付状态变更（轮询到已付款）需播报：原实现是纯视觉变化，读屏用户完全无感知 */}
          <div className="w-full flex flex-col items-center" role="status" aria-live="polite">
          {paid ? (
            <div className="text-center animate-scale-in">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
                <span className="text-4xl" aria-hidden="true">✅</span>
              </div>
              <p className="text-lg font-bold text-green-600">付款已确认</p>
              <p className="text-sm text-gray-400 mt-2">客服将尽快处理你的订单</p>
            </div>
          ) : (
            <div className="text-center w-full max-w-sm animate-fade-in-up flex flex-col items-center">
              {totalAmount > 0 && (
                <p className="text-xl font-bold text-gray-900 mb-1.5">{formatYuan(totalAmount)}</p>
              )}
              <div className="w-full bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2 mb-2">
                <p className="text-amber-700 text-xs font-medium">
                  <span aria-hidden="true">⚠️</span> 请截图扫码付款，付款后联系商家进行配送
                </p>
              </div>
              <div className="bg-white p-2 rounded-2xl shadow-card border border-gray-100/80 inline-block mb-3">
                <img
                  src={qrSrc}
                  alt={method === 'wechat' ? '微信支付二维码' : '支付宝二维码'}
                  width={240}
                  height={240}
                  loading="lazy"
                  decoding="async"
                  className="max-w-full max-h-[20vh] object-contain rounded-xl"
                />
              </div>
              <button
                onClick={() => setMethod(null)}
                className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors duration-200"
              >
                返回重新选择
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* 支付宝温馨提示弹窗：改用统一 Overlay
          （补齐原实现缺失的焦点陷阱、焦点归还、背景滚动锁） */}
      <Overlay open={showTip} onClose={() => setShowTip(false)} label="温馨提示" className="rounded-3xl p-7">
        <div className="text-center">
          <span className="text-4xl block mb-3" aria-hidden="true">💡</span>
          <h3 className="font-bold text-gray-900">温馨提示</h3>
          <p className="text-gray-500 text-sm mt-2.5 leading-relaxed">商家无支付宝消息提示，支付宝付款请告知商家</p>
        </div>
        <button
          onClick={() => setShowTip(false)}
          data-autofocus
          className="mt-6 btn-primary w-full py-3.5"
        >
          我知道了
        </button>
      </Overlay>
    </div>
  )
}
