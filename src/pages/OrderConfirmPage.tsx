import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import OrderItem from '../components/OrderItem'
import { getCart, getTotalAmount, clearCart } from '../cart'
import { createOrder } from '../db'
import { OrderRejectedError } from '../api/error-codes'
import { getClosedMessage } from '../utils/businessHours'
import { useBusinessHours } from '../hooks/useBusinessHours'
import { MIN_DELIVERY_AMOUNT, meetsMinDelivery, minDeliveryGap } from '../data/deliveryLimits'
import { formatYuan } from '../utils/format'
import { compressImageFile } from '../utils/imageCompress'

/** 未达起送门槛的统一提示串（本页 setError 与顶部横幅共用一处措辞，避免两个地方各写一个数）。 */
function minDeliveryBlockedText(totalAmount: number): string {
  return `不满 ¥${MIN_DELIVERY_AMOUNT.toFixed(2)} 不配送：当前合计 ¥${totalAmount.toFixed(2)}，请再挑 ¥${minDeliveryGap(totalAmount).toFixed(2)} 的商品后再下单`
}

// 下单幂等键：一次页面挂载（= 一次下单意图）一把键，弱网重试/双击复用同一条。
// "改过内容再提交算不算新单"由服务端按键+载荷指纹判定（functions/lib/actions/orders.js），
// 客户端不自作主张换键，避免两处规则漂移。
function newRequestKey(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}


export default function OrderConfirmPage() {
  const navigate = useNavigate()
  const cart = getCart()
  const [building, setBuilding] = useState('')
  const [room, setRoom] = useState('')
  const [wechat, setWechat] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const totalAmount = getTotalAmount(cart)
  const open = useBusinessHours()

  /* 一次挂载 = 一个下单意图。这串令牌同时是两样东西的身份（同源，不各写一遍）：
     ① 幂等键 —— requestKey 持有它，提交时用；弱网重试/双击复用同一条；
     ② 右栏底稿的草稿号 —— 渲染期读 **state** 而不是 ref.current。
        「要画到屏幕上的值」本来就该是 state：refs 不参与渲染，在渲染期取 current
        是 oxlint react(refs) 判红的形态（本仓 --max-warnings 0，warning 即红）。 */
  const [intent] = useState(newRequestKey)
  const requestKey = useRef(intent)

  /* 右栏那张票的两个派生量（纯展示，不参与提交）：
     - railPct：起送线进度，按**折前小计**口径（与 meetsMinDelivery 同一个数，不另立口径）；
     - draftNo：草稿号，由意图令牌派生，同一次下单意图内稳定、刷新换新。
       它是「这张底稿」的身份，不是订单号（订单号在成功页才存在）。 */
  const railPct = Math.min(100, Math.round((totalAmount / MIN_DELIVERY_AMOUNT) * 100))
  const draftNo = 'DRAFT·' + intent.slice(1, 9).toUpperCase()

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5MB')
      return
    }
    try {
      const { dataUrl } = await compressImageFile(file, { maxSize: 800, quality: 0.6 })
      setScreenshot(dataUrl)
      setError('')
    } catch {
      setError('图片处理失败')
    }
  }

  const handleConfirm = async () => {
    setError('')
    if (!building.trim()) {
      setError('请填写楼栋号')
      return
    }
    if (!room.trim()) {
      setError('请填写房间号')
      return
    }
    if (cart.items.length === 0) {
      setError('购物车为空')
      return
    }
    // 起送门槛（2026-10-22 老大立规「总价低于六元不配送」）。购物车那一站已把结算 CTA 换成「去凑单」，
    // 这里兜的是**深链 / Service Worker 旧包直接进本页**的人；服务端 below_min_delivery 是第三道
    // （防直接 POST /pub）。三处数字同值、措辞同源，等值由 tests/minDeliveryParity.test.ts 钉。
    if (!meetsMinDelivery(totalAmount)) {
      setError(minDeliveryBlockedText(totalAmount))
      return
    }
    setSubmitting(true)
    try {
      const result = await createOrder({
        // 楼栋+房间合并写入 roomNumber（服务端以该字段必填校验），如 "36栋-501"
        roomNumber: `${building.trim()}-${room.trim()}`,
        wechat: wechat.trim() || undefined,
        remark: remark.trim() || undefined,
        items: cart.items,
        paymentScreenshot: screenshot || undefined,
        requestId: requestKey.current,
      })
      clearCart()
      // 实付价以服务端为准（满减后）；演示/兜底无服务端计价时回落本地小计
      const payable = typeof result.totalAmount === 'number' ? result.totalAmount : totalAmount
      const discount = typeof result.discountAmount === 'number' ? result.discountAmount : 0
      navigate('/order-success', { state: { building: building.trim(), room: room.trim(), orderId: result.id, localFallback: result.localFallback, demo: result.demo, totalAmount: payable, discountAmount: discount } })
    } catch (err) {
      // 业务拒绝（服务端活着且明确不收这单）与传输故障的文案必须分开：
      // 前者的正确动作是"改数量/换商品/稍后再试"，后者才是"稍后重试"。
      // 判据 src/api/error-codes.ts 的 kind，不判 message 字符串。
      if (err instanceof OrderRejectedError) setError(`下单未成功：${err.message}`)
      else setError('提交订单失败：' + (err instanceof Error ? err.message : '网络错误'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-4 bg-panel/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-stone-500 hover:text-stone-700 hover:bg-gray-100 transition duration-200 active:scale-90"
          aria-label="返回"
        >
          ←
        </button>
        <h1 className="text-base font-bold text-ink">确认订单</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 p-5 overflow-hidden flex flex-col w-full max-w-3xl lg:max-w-6xl mx-auto">
        <div role="main" id="main-content" tabIndex={-1} className="confirm-desk flex-1 overflow-y-auto">
          {/* ── 左：底稿（要填的）── */}
          <div className="confirm-desk-form space-y-5">
            {/* 营业时间提示 */}
            {!open && (
              <div className="bg-red-50/80 border border-red-200/60 rounded-2xl p-4 animate-slide-down">
                <p className="text-red-700 text-sm font-medium leading-relaxed">{getClosedMessage()}</p>
                <p className="text-red-700 text-xs mt-1.5">当前非营业时间，下单后可能无法及时处理</p>
              </div>
            )}

            {/* 起送门槛横幅：不等人点提交才报错（同一句话在提交拦截里复用，措辞单源于 minDeliveryBlockedText） */}
            {!meetsMinDelivery(totalAmount) && (
              <div className="bg-amber-50/90 border border-amber-200/70 rounded-2xl p-4 animate-slide-down" role="status">
                <p className="text-amber-800 text-sm font-semibold flex items-center gap-2">
                  <span aria-hidden="true">🛵</span>不满 {formatYuan(MIN_DELIVERY_AMOUNT)} 不配送
                </p>
                <p className="text-amber-800 text-xs mt-1.5 leading-relaxed">
                  当前商品合计 {formatYuan(totalAmount)}，还差 {formatYuan(minDeliveryGap(totalAmount))} 起送。
                  返回购物车加几件即可下单。
                </p>
              </div>
            )}

            {/* 表单 label 与输入框显式关联（htmlFor/id）：
                原实现 label 与 input 是兄弟节点、无关联，读屏只会念「编辑框」不念字段名 */}
            {/* 楼栋号 */}
            <div className="animate-fade-in-up stagger-1">
              <label htmlFor="order-building" className="intake-label block mb-2.5">
                楼栋号 <span className="text-red-700" aria-hidden="true">*</span>
              </label>
              <input
                id="order-building"
                type="text"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="例如：36栋"
                required
                aria-required="true"
                aria-invalid={error.includes('楼栋') || undefined}
                aria-describedby={error.includes('楼栋') ? 'order-error' : undefined}
                className="input-base"
              />
            </div>

            {/* 房间号 */}
            <div className="animate-fade-in-up stagger-1">
              <label htmlFor="order-room" className="intake-label block mb-2.5">
                房间号 <span className="text-red-700" aria-hidden="true">*</span>
              </label>
              <input
                id="order-room"
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="例如：501"
                required
                aria-required="true"
                aria-describedby={error.includes('房间') ? 'order-error' : undefined}
                className="input-base"
              />
            </div>

            {/* 微信号（选填） */}
            <div className="animate-fade-in-up stagger-1">
              <label htmlFor="order-wechat" className="intake-label block mb-2.5">微信号（选填）</label>
              <input
                id="order-wechat"
                type="text"
                value={wechat}
                onChange={(e) => setWechat(e.target.value)}
                placeholder="请输入你的微信号"
                className="input-base"
              />
            </div>

            {/* 备注 */}
            <div className="animate-fade-in-up stagger-2">
              <label htmlFor="order-remark" className="intake-label block mb-2.5">备注</label>
              <input
                id="order-remark"
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="选填，有其他需求可以写在这里"
                className="input-base"
              />
            </div>

            {/* 转账截图上传 */}
            <div className="animate-fade-in-up stagger-3">
              <label className="intake-label block mb-2.5">转账截图（可选）</label>
              {screenshot ? (
                <div className="relative inline-block animate-scale-in">
                  <img src={screenshot} alt="转账截图" className="w-36 h-36 object-cover rounded-2xl border border-gray-200 shadow-soft" />
                  <button
                    onClick={() => setScreenshot(null)}
                    aria-label="删除付款截图"
                    className="absolute -top-2 -right-2 w-7 h-7 bg-red-700 text-cream rounded-full text-xs flex items-center justify-center shadow-soft hover:bg-red-800 transition duration-200 active:scale-90"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="paste-zone py-8 text-center text-sm text-stone-500 hover:text-brand-300 transition duration-300 active:scale-[0.99]"
                >
                  <span className="block text-2xl mb-2" aria-hidden="true">📷</span>
                  点击上传付款截图
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="选择付款截图"
                onChange={handleScreenshot}
              />
            </div>
          </div>

          {/* ── 右：实时票据（正在被填出来的那张单）──
              2026-10-26 第 91 轮：确认页此前是一列通用表单（五个 label + 五个输入框），
              与站内「出票」语言完全脱节 —— 而它恰恰是出票前最后一屏。现在左填右印：
              每填一项，右栏那张票就多出一行；商品与金额当场结算，起送线做成一根铜轨。
              数据源全部现成（cart.items / getTotalAmount / deliveryLimits），零新接口、零新色。 */}
          <aside className="confirm-desk-ticket" aria-label="票据预览">
            {/* data-ready 只承载「够不够一趟配送」这一个状态：铜轨达标转绿靠它，不是装饰。
                轨与章是纯图形（aria-hidden），同样的事实由下方那行文字承载给读屏。 */}
            <div className="receipt-paper receipt-enter confirm-ticket" data-ready={meetsMinDelivery(totalAmount) ? 'true' : 'false'}>
              <div className="receipt-brand">
                <strong>超柿收据</strong>
                <span>Live Ticket</span>
              </div>
              <div className="receipt-headline">
                <p className="receipt-kicker">{open ? 'READY TO PRINT' : 'AFTER HOURS'}</p>
                <h2 className="confirm-ticket-title">{open ? '填一项，印一行' : '打烊时段，先记着'}</h2>
                <p>{open ? '下面这栏会随你填写当场长出来。' : '这栏会随你填写当场长出来。'}</p>
              </div>
              <div className="receipt-perf" aria-hidden="true" />

              <h2 className="ticket-section">已选商品</h2>
              {cart.items.length === 0 ? (
                <p className="ticket-empty">还没挑东西 —— 回商城拿几件，这里就印得出来。</p>
              ) : (
                <div className="receipt-meta">
                  {/* 行身份 = (productId, spec)：同商品两口味是两行，key 只用 productId 会撞 key */}
                  {cart.items.map((item) => (
                    <OrderItem key={`${item.productId}::${item.spec || ''}`} item={item} />
                  ))}
                </div>
              )}

              <div className="receipt-amount">
                <span>本次应付</span>
                <strong>{formatYuan(totalAmount)}</strong>
              </div>

              {/* 起送线做成一根铜轨：刻度 = 门槛，填充 = 已选金额。
                  文字只说「起送线/已选」，不复用横幅那两句（避免同一事实两处措辞）。 */}
              <div className="ticket-rail" aria-hidden="true" data-decorative="true">
                <span className="ticket-rail-ticks" />
                <span className="ticket-rail-fill" style={{ width: `${railPct}%` }} />
                <span className="ticket-rail-knot" style={{ left: `${railPct}%` }} />
              </div>
              <p className="ticket-note">
                起送线 {formatYuan(MIN_DELIVERY_AMOUNT)} · 已选 {formatYuan(totalAmount)}
                {meetsMinDelivery(totalAmount) ? ' · 够一趟配送' : ' · 还差一点'}
              </p>

              <div className="receipt-perf" aria-hidden="true" />

              <h2 className="ticket-section">送到哪儿</h2>
              <div className="receipt-meta">
                <div className="receipt-row">
                  <span>楼栋</span>
                  <strong>{building.trim() || <em className="ticket-blank">待填</em>}</strong>
                </div>
                <div className="receipt-row">
                  <span>房间</span>
                  <strong>{room.trim() || <em className="ticket-blank">待填</em>}</strong>
                </div>
                <div className="receipt-row">
                  <span>微信</span>
                  <strong>{wechat.trim() || <em className="ticket-blank">未填</em>}</strong>
                </div>
                <div className="receipt-row">
                  <span>备注</span>
                  <strong>{remark.trim() || <em className="ticket-blank">未填</em>}</strong>
                </div>
                <div className="receipt-row">
                  <span>转账凭证</span>
                  <strong>{screenshot ? '已贴 1 张' : <em className="ticket-blank">未贴</em>}</strong>
                </div>
              </div>

              <div className="receipt-foot confirm-ticket-foot">
                <div className="receipt-serial">
                  <p className="receipt-serial-label">Ticket draft</p>
                  <p className="receipt-serial-id price-num">{draftNo}</p>
                </div>
                <span className="confirm-ticket-stamp" aria-hidden="true">{open ? '待<br />出票' : '打烊<br />挂单'}</span>
              </div>
            </div>
          </aside>
        </div>

        {/* 底部操作 */}
        <div className="mt-5 space-y-2.5">
          {/* role="alert" + id：读屏会在校验失败时立即播报，并被上方输入框的 aria-describedby 引用 */}
          <div role="alert" aria-live="assertive">
            {error && <p id="order-error" className="text-red-700 text-sm text-center animate-slide-down">{error}</p>}
          </div>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className={`w-full py-4 rounded-2xl font-medium text-base transition duration-200 active:scale-[0.98] ${
              submitting
                ? 'bg-gray-200 text-stone-600'
                : open
                  ? 'btn-primary shadow-elevated'
                  // v4 暗盘上「铜底配米白字」实测 2.2:1 不过 AA（CI 打烊时段抓到的真缺陷，
                  // 本地营业时段这按钮不渲染 ⇒ 判据看运气）。铜底一律配深褐字：amber-600 上 6.7:1。
                  : 'bg-amber-600 text-espresso hover:bg-amber-500 shadow-elevated'
            }`}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                提交中...
              </span>
            ) : open ? '确认支付' : '非营业时间 - 仍要下单'}
          </button>
        </div>
      </div>
    </div>
  )
}
