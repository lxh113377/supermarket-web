import {  useEffect, useRef, useState  } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getOrderStatus } from '../db'
import { IS_CLOUD } from '../cloudbase'
import Overlay from '../components/Overlay'
import { IconAlert } from '../components/Icons'
import { formatYuan } from '../utils/format'
import { orderStatusLabel } from '../utils/orderStatus'

/** 轮询间隔（秒）—— 与下面 setInterval 同一个数，写在一处防止两处漂移 */
const POLL_SECONDS = 5

export default function PaymentPage() {
  const [method, setMethod] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState<string | null>(null)
  const [showTip, setShowTip] = useState(false)
  /* 「问店心跳」：本站每 POLL_SECONDS 秒真的去问一次店里到账没有（下面的 setInterval），
     但这件事**以前只发生在代码里**，屏幕上看不出来 —— 用户站在二维码前不知道
     这页是在等、还是已经死了。把轮询次数与最近一次问的时间摆出来，
     等待就从「空白」变成「有人在跑」。计数是**真数**（refs 记实际发起的轮次），
     不伪造进度：本站口径是屏上每个数字都要有出处。 */
  const [polls, setPolls] = useState(0)
  const [lastAsk, setLastAsk] = useState<number | null>(null)
  const pollsRef = useRef(0)
  const paid = !!orderStatus && orderStatus !== 'pending' && orderStatus !== 'cancelled'
  const { state } = useLocation()
  const navigate = useNavigate()

  const orderId = state?.orderId || sessionStorage.getItem('sm_payment_order') || ''
  const totalAmount = state?.totalAmount || parseFloat(sessionStorage.getItem('sm_payment_amount') || '0')
  const discountAmount = state?.discountAmount || 0
  useEffect(() => {
    if (orderId) sessionStorage.setItem('sm_payment_order', orderId)
    if (totalAmount) sessionStorage.setItem('sm_payment_amount', String(totalAmount))
  }, [orderId, totalAmount])

  useEffect(() => {
    if (!orderId) navigate('/', { replace: true })
  }, [orderId, navigate])

  /* 「最近 N 秒前」必须有一个自己的秒针：只在轮询回调里 setState 的话，
     这一串数字两次轮询之间是**冻住的**（永远显示 0 秒前），那是个假读数 ——
     本站口径是「屏上每个数字都要有出处」，所以补一条 1s tick 让它真的在走。
     非云端（演示模式）没有轮询可计时 ⇒ 整块不渲染，不摆一个空转的表。 */
  const [sinceAsk, setSinceAsk] = useState(0)
  const polling = IS_CLOUD && !paid && method !== null
  /* 「问了几秒前」由**秒针 effect** 算，不在渲染期调 Date.now()：
     oxlint 的 react/purity 把渲染期取当前时间判为不纯（同一渲染两次可能得两个数，
     且它让「渲染」依赖外部时钟 —— 与 CustomerPage 里 flyDot id 那条同族）。
     所以时间读数走 state：effect 里问一次 Date.now()，之后每秒 +1 推进。 */
  useEffect(() => {
    if (!polling) return
    setSinceAsk(lastAsk === null ? 0 : Math.max(0, Math.round((Date.now() - lastAsk) / 1000)))
    const t = setInterval(() => setSinceAsk((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [polling, lastAsk])

  useEffect(() => {
    if (!orderId || !IS_CLOUD || paid) return
    let cancelled = false
    const check = async () => {
      // 心跳计数在**发起前**记：一次真的请求 = 屏幕上真实发生过的一次问店。
      // 失败也计数（catch 里不扣），因为「问了但没通」与「没问」是两回事，
      // 而这一屏要告诉用户的正是「有人在替你跑」。
      pollsRef.current += 1
      setPolls(pollsRef.current)
      setLastAsk(Date.now())
      try {
        // 对标补齐（2026-09-24）：走 /pub getOrderStatus（顾客免密钥）。
        const s = await getOrderStatus(orderId)
        // P0-7：卸载后不再 setState
        if (!cancelled && s && s.status !== 'pending') setOrderStatus(s.status)
      } catch {}
    }
    const timer = setInterval(check, POLL_SECONDS * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [orderId, paid])

  const qrSrc = method === 'wechat' ? './wechat-pay.png' : './alipay.jpg'

  /**
   * 收银屏金额块：金额是收银台唯一主角（衬线数字压大字），单号以票据等宽小字托底。
   * 提成一个变量而不是在两个分支各写一遍：这两处显示的是同一笔钱，
   * 满减口径哪天改了，两处各写迟早漂开。
   */
  const amountBlock = totalAmount > 0 ? (
    <div className="cashier-board animate-fade-in-up stagger-1">
      <p className="cashier-label">本次应付</p>
      <p className="cashier-amount price-num">{formatYuan(totalAmount)}</p>
      {discountAmount > 0 && (
        <p className="cashier-discount" role="status">满减已优惠 {formatYuan(discountAmount)}</p>
      )}
      <p className="cashier-order">单号 {orderId}</p>
    </div>
  ) : null

  if (!orderId) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in paper-grain">
      {/* 顶栏 */}
      <div className="px-5 py-4 bg-panel/95 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between">
        <button
          onClick={() => navigate('/order-success', { state: { orderId } })}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-gray-100 transition duration-200 active:scale-90"
          aria-label="返回"
        >
          ←
        </button>
        <h1 className="text-base font-bold text-ink">选择支付方式</h1>
        <span className="w-9" />
      </div>

      {!method ? (
        <div role="main" id="main-content" tabIndex={-1} className="flex-1 flex flex-col items-center justify-center gap-4 p-6 w-full max-w-lg mx-auto">
          {/* 金额必须在选方式之前就显示：这一屏是用户决定「要不要现在付」的地方
              （2026-10-24 信息架构缺陷修复，口径沿用）。 */}
          {amountBlock}
          <p className="text-sm text-stone-500">请选择支付方式完成付款</p>
          <button
            onClick={() => setMethod('wechat')}
            className="pay-wechat w-full max-w-sm py-4 rounded-2xl text-base font-medium shadow-elevated animate-fade-in-up stagger-2"
          >
            微信支付
          </button>
          <button
            onClick={() => { setMethod('alipay'); setShowTip(true) }}
            className="pay-alipay w-full max-w-sm py-4 rounded-2xl text-base font-medium shadow-elevated animate-fade-in-up stagger-3"
          >
            支付宝付款
          </button>
        </div>
      ) : (
        <div role="main" id="main-content" tabIndex={-1} className="flex-1 flex flex-col items-center justify-center px-5 py-3">
          {/* 支付状态变更（轮询到已付款）需播报：原实现是纯视觉变化，读屏用户完全无感知 */}
          <div className="w-full flex flex-col items-center" role="status" aria-live="polite">
          {paid ? (
            <div className="text-center animate-scale-in">
              {/* 到账确认章：用本站的「章」语言（与成功页 receipt-stamp 同族），
                  不用 emoji ✅ —— 它是系统图形、颜色由 OS 决定，且「一个绿勾」是
                  通用 AI 完成态的典型形态。这里是一枚盖下来的铜印。 */}
              <div className="paid-seal" aria-hidden="true">已到账</div>
              <p className="text-lg font-bold text-green-700">付款已确认</p>
              <p className="text-sm text-stone-500 mt-2">客服将尽快处理你的订单</p>
              {orderStatus && orderStatus !== 'paid' && (
                <p className="text-sm font-medium text-stone-600 mt-1.5">订单进度：{orderStatusLabel(orderStatus)}</p>
              )}
            </div>
          ) : orderStatus === 'cancelled' ? (
            <div className="text-center animate-fade-in-up">
              <p className="text-lg font-bold text-red-700">该订单已取消</p>
              <p className="text-sm text-stone-500 mt-2">如有问题请联系商家</p>
            </div>
          ) : (
            <div className="text-center w-full max-w-sm animate-fade-in-up flex flex-col items-center">
              {/* 与 chooser 态同一个 amountBlock（同一笔钱不在两处各写一遍） */}
              {amountBlock}
              <div className="bg-amber-50 border border-amber-200/80 rounded-xl px-3 py-2 mb-3 mt-4 w-full">
                <p className="text-amber-800 text-xs font-medium flex items-start gap-2">
                  {/* 警示换本站自绘 SVG（IconAlert）：emoji ⚠️ 是系统色图形，
                      在暗底上由 OS 决定长什么样 —— 与「三色锚点唯一色相来源」冲突，
                      也是模板感最重的一类残留。功能性图形描边由 contrast 闸按 3:1 判。 */}
                  <IconAlert className="w-4 h-4 shrink-0 mt-px" />
                  <span>请截图扫码付款，付款后联系商家进行配送</span>
                </p>
              </div>
              {/* 二维码收进奶油纸票框：码是「票面上的码」，不是悬在暗面板上的一块白 */}
              <div className="pay-qr-frame rounded-sm inline-block mb-3">
                <img
                  src={qrSrc}
                  alt={method === 'wechat' ? '微信支付二维码' : '支付宝二维码'}
                  width={240}
                  height={240}
                  loading="lazy"
                  decoding="async"
                  className="max-w-full max-h-[20vh] object-contain"
                />
              </div>
              {/* 问店心跳：把「每 5 秒真的去问一次店里」这件事摆到屏幕上。
                  旧版只有一句「会自动更新」+ 一个呼吸点 —— 用户分不清这页是在等还是已经死了。
                  数字是真数（refs 记实际发起的轮次），不伪造倒计时或进度百分比。 */}
              <p className="pay-wait">
                <i className="wait-pulse" aria-hidden="true" />
                商家侧确认到账后，订单状态会自动更新
              </p>
              {/* 只在云端模式摆：演示模式根本不轮询，摆一个「0 次」是假读数 */}
              {IS_CLOUD && (
              <p className="pay-heartbeat" role="status" aria-live="off">
                <span className="pay-heartbeat-label">问店心跳</span>
                <span className="pay-heartbeat-num price-num">{polls}</span>
                <span className="pay-heartbeat-unit">次</span>
                <span aria-hidden="true" className="pay-heartbeat-dot">·</span>
                <span className="pay-heartbeat-ago">
                  {lastAsk === null ? '正在问第一次' : `最近 ${sinceAsk} 秒前`}
                </span>
                <span className="sr-only">每 {POLL_SECONDS} 秒向店里问一次到账，已问 {polls} 次。</span>
              </p>
              )}
              <button
                onClick={() => setMethod(null)}
                className="mt-4 text-sm text-stone-500 hover:text-stone-600 transition-colors duration-200"
              >
                返回重新选择
              </button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* 支付宝温馨提示弹窗：统一 Overlay（焦点陷阱、焦点归还、背景滚动锁沿用） */}
      <Overlay open={showTip} onClose={() => setShowTip(false)} label="温馨提示" className="rounded-3xl p-7">
        <div className="text-center">
          <span className="tip-plate mx-auto mb-3" aria-hidden="true"><IconAlert className="w-7 h-7" /></span>
          <h2 className="font-bold text-ink">温馨提示</h2>
          <p className="text-stone-500 text-sm mt-2.5 leading-relaxed">商家无支付宝消息提示，支付宝付款请告知商家</p>
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
