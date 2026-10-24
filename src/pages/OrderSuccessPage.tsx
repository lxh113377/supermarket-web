import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatYuan } from '../utils/format'

export default function OrderSuccessPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const building = state?.building || ''
  const room = state?.room || ''
  /**
   * 订单号：state 优先，其次回读 sessionStorage —— 与 OrderQueryPage 的兜底口径一致。
   * 2026-10-24 一手：本页下面只**写** sm_query_order 却不读它，而写它的那行注释自己写明
   * 这兜底是给「微信内被刷掉 location.state」准备的 ⇒ 写的人想到了这个场景、读的人没实现。
   * 实测深链直达 /#/order-success（无 state）时卡片全空（textContent 为空、高 42px），
   * 而页面照样宣称「下单成功！订单已提交，请完成支付」，点「去支付」还会被 payment 页的
   * 无 orderId 分支弹回首页 ⇒ 顾客既看不到订单、又被一个点了会消失的按钮戏耍。
   */
  const orderId = state?.orderId || sessionStorage.getItem('sm_query_order') || sessionStorage.getItem('sm_payment_order') || ''
  const totalAmount = state?.totalAmount || 0
  const discountAmount = state?.discountAmount || 0
  // 第十八轮：`localFallback` 这个字段自写下起从未被本组件读过 ——
  // 顾客在"后端不服务"时拿到的仍是这张「下单成功！请完成支付」，
  // 而这张单只存在于他自己浏览器的 localStorage 里，商家侧查不到。
  // 暂住本地是刻意设计（不丢用户意图），但**不告诉他**就不是设计、是隐瞒。
  const localFallback = Boolean(state?.localFallback)
  const [copied, setCopied] = useState(false)
  /**
   * hasReceipt：有没有这张回执的凭据。连订单号都没有时，本页不该说「下单成功」——
   * 那是一句关于一笔不存在的订单的断言。刻意不猜「也许下过单只是记录丢了」：那种情况下
   * 顾客真正需要的是重新下单或按单号查询，而不是一个空壳加一句安慰。
   */
  const hasReceipt = Boolean(orderId)
  // 卡片有没有东西可显示：五项全空时不渲染空壳（实测深链直达就是一张 42px 的白框）
  const hasCardInfo = Boolean(building || room || orderId) || totalAmount > 0 || discountAmount > 0
  // 供「订单查询」页跨导航找回单号（微信内被刷掉 location.state 的兜底）
  useEffect(() => {
    if (orderId) sessionStorage.setItem('sm_query_order', orderId)
  }, [orderId])

  return (
    <div role="main" id="main-content" tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-surface items-center justify-center p-6 animate-fade-in">
      <div className="text-center max-w-sm w-full" role="status" aria-live="polite">
        {/* 成功动画 */}
        <div className="relative mx-auto w-20 h-20 mb-6">
          <div className="absolute inset-0 rounded-full bg-green-100 animate-scale-in" />
          <div className="absolute inset-2 rounded-full bg-green-50 flex items-center justify-center animate-scale-in stagger-1">
            <span className="text-3xl" aria-hidden="true">✅</span>
          </div>
        </div>
        {/* 三态文案，按事实分档：无凭据时不能说「下单成功」—— 那是对一笔不存在的订单
            下断言。三元的顺序是 localFallback 先于 hasReceipt：暂存本机那条本身就有
            订单号（走的是本地建单），不会被无凭据分支吃掉。 */}
        <h1 className="text-xl font-bold text-ink mb-2 animate-fade-in-up stagger-1">
          {localFallback ? '订单已暂存本机' : hasReceipt ? '下单成功！' : '没有找到这张订单'}
        </h1>
        <p className="text-sm text-stone-500 mb-6 animate-fade-in-up stagger-2">
          {localFallback ? '网络未连通，暂时提交失败'
            : hasReceipt ? '订单已提交，请完成支付'
            : '这台设备上没留下订单号，所以无法确认下过单。请重新下单，或按订单号查询。'}
        </p>

        {localFallback && (
          <div
            className="w-full max-w-sm mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left animate-fade-in-up stagger-2"
            role="alert"
          >
            <p className="text-sm font-bold text-amber-900 mb-1">这张单商家还收不到</p>
            <p className="text-xs leading-relaxed text-amber-800">
              它只保存在你这台手机上，没有发到店里。请先在下方复制订单号，
              等网络恢复后重新提交一次；直接付款有对不上账的风险。
            </p>
          </div>
        )}

        {/* 五项全空时整张卡不渲染：实测深链直达留下的就是一张 42px 高的空白框，
            它不报错、只是让页面看起来坏了。 */}
        {hasCardInfo && (
        <div className="bg-panel rounded-2xl p-5 mb-6 shadow-card border border-gray-100/80 animate-fade-in-up stagger-2">
          {building && (
            <>
              <p className="text-xs text-stone-500 mb-1.5">楼栋号</p>
              <p className="text-2xl font-bold text-ink">{building}</p>
            </>
          )}
          {room && (
            <>
              <p className="text-xs text-stone-500 mb-1.5 mt-3">房间号</p>
              <p className="text-2xl font-bold text-ink">{room}</p>
            </>
          )}
          {totalAmount > 0 && (
            <p className={`price-num text-lg font-bold text-brand-300 ${building || room ? 'mt-2' : ''}`}>{formatYuan(totalAmount)}</p>
          )}
          {discountAmount > 0 && (
            <p className="text-xs text-green-700 mt-1" role="status">满减已优惠 {formatYuan(discountAmount)}</p>
          )}
          {orderId && (
            <p className="text-xs text-stone-500 mt-3 font-mono break-all">订单号：{orderId}</p>
          )}
        </div>
        )}

        <div className="space-y-3 animate-fade-in-up stagger-3">
          {/* 没有订单号就不给「去支付」：实测那样点下去会被 PaymentPage 的无 orderId
              分支 navigate('/') 弹回首页 —— 一个点了会让自己消失的主按钮，比不给更糟。
              有单号但无金额时仍给（金额由支付页自己从 sessionStorage 兜底读）。 */}
          {hasReceipt && (
          <button
            onClick={() => navigate('/payment', { state: { orderId, totalAmount, discountAmount } })}
            className="btn-primary w-full py-4 rounded-2xl text-base shadow-elevated"
          >
            去支付
          </button>
          )}
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
