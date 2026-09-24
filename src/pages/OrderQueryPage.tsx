import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getOrderStatus } from '../db'
import { orderStatusLabel, ORDER_FLOW } from '../utils/orderStatus'

/**
 * 顾客侧订单进度查询（2026-09-24 对标 litemall 订单跟踪）。
 * 匿名设计：订单号即凭证（genId 时间戳+随机，不可枚举），后端 getOrderStatus 只回 status/updatedAt。
 */
export default function OrderQueryPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [input, setInput] = useState(() => state?.orderId || sessionStorage.getItem('sm_query_order') || sessionStorage.getItem('sm_payment_order') || '')
  const [status, setStatus] = useState<{ status: string; updatedAt?: string } | null>(null)
  const [queried, setQueried] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const autoRef = useRef(false)

  const lookup = async (id: string) => {
    const oid = id.trim()
    if (!oid) { setNotice('请输入订单号'); return }
    setLoading(true)
    setNotice('')
    const s = await getOrderStatus(oid)
    setLoading(false)
    if (s) { setStatus(s); setQueried(oid) }
    else { setStatus(null); setQueried(oid); setNotice('未查到该订单，请核对订单号（注意不要带空格）') }
  }

  // 从支付/成功流程进来时带了单号 → 自动查一次，顾客零输入
  useEffect(() => {
    if (!autoRef.current && input) {
      autoRef.current = true
      void lookup(input)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentIndex = status ? ORDER_FLOW.indexOf(status.status) : -1

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      <div className="px-5 py-4 bg-white/95 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
          aria-label="返回"
        >
          ←
        </button>
        <h2 className="text-base font-bold text-gray-900">订单查询</h2>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto p-5 w-full max-w-lg mx-auto">
        <div className="flex gap-2">
          <input
            aria-label="订单号"
            type="search"
            placeholder="输入订单号（o_ 开头）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void lookup(input) }}
            className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
          />
          <button
            onClick={() => void lookup(input)}
            disabled={loading}
            className="px-4 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {loading ? '查询中' : '查询'}
          </button>
        </div>
        <div role="status" aria-live="polite">
          {notice && <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2">{notice}</p>}

          {status && (
            <div className="mt-4 bg-white rounded-2xl p-5 shadow-card border border-gray-100/80">
              <p className="text-xs text-gray-400 mb-1">订单号</p>
              <p className="text-sm font-mono text-gray-700 break-all mb-4">{queried}</p>
              {status.status === 'cancelled' ? (
                <p className="text-base font-bold text-red-500">该订单已取消</p>
              ) : (
                <ol className="space-y-3">
                  {ORDER_FLOW.map((s, i) => {
                    const done = i < currentIndex
                    const current = i === currentIndex
                    return (
                      <li key={s} className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                            done ? 'bg-green-500 text-white' : current ? 'bg-brand-500 text-white ring-4 ring-brand-100' : 'bg-gray-100 text-gray-300'
                          }`}
                        >
                          {done ? '✓' : i + 1}
                        </span>
                        <span className={`text-sm ${current ? 'font-bold text-gray-900' : done ? 'text-gray-600' : 'text-gray-300'}`}>
                          {orderStatusLabel(s)}
                          {current && status.updatedAt && (
                            <span className="ml-2 text-xs font-normal text-gray-400">{new Date(status.updatedAt).toLocaleString()}</span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
              {status.status === 'pending' && (
                <button
                  onClick={() => navigate('/payment', { state: { orderId: queried, totalAmount: 0 } })}
                  className="mt-4 w-full py-3 bg-brand-500 text-white rounded-xl text-sm font-medium active:scale-[0.98] transition-all"
                >
                  去支付
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-5 text-xs text-gray-400 leading-relaxed">
          订单号在下单成功页可复制；如订单显示长期「待支付」请先确认已完成扫码付款并联系商家。
        </p>
      </div>
    </div>
  )
}
