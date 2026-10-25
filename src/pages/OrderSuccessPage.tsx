import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatYuan } from '../utils/format'

/** 收据条码：纯装饰（aria-hidden + data-decorative）。同一单号恒生成同一条纹 ——
 *  顾客扫两眼就能认出「这张票我见过」，它是票据的身份特征，不是随机噪点。
 *  djb2 × LCG，非密码学，只求「稳定 + 视觉上疏密有致」。 */
function barcodeBars(orderId: string): number[] {
  let h = 5381
  for (let i = 0; i < orderId.length; i++) h = ((h * 33) ^ orderId.charCodeAt(i)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < 30; i++) {
    h = ((h * 1103515245) + 12345) >>> 0
    bars.push(1 + ((h >>> 16) % 4))
  }
  return bars
}

export default function OrderSuccessPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const building = state?.building || ''
  const room = state?.room || ''
  /**
   * 订单号：state 优先，其次回读 sessionStorage —— 与 OrderQueryPage 的兜底口径一致
   * （2026-10-24「只写不读」缺陷已修，口径沿用）。
   */
  const orderId = state?.orderId || sessionStorage.getItem('sm_query_order') || sessionStorage.getItem('sm_payment_order') || ''
  const totalAmount = state?.totalAmount || 0
  const discountAmount = state?.discountAmount || 0
  // 第十八轮口径沿用：暂存本机要明说，不隐瞒。
  const localFallback = Boolean(state?.localFallback)
  const [copied, setCopied] = useState(false)
  const hasReceipt = Boolean(orderId)
  const hasCardInfo = Boolean(building || room || orderId) || totalAmount > 0 || discountAmount > 0
  useEffect(() => {
    if (orderId) sessionStorage.setItem('sm_query_order', orderId)
  }, [orderId])

  const bars = barcodeBars(orderId || 'sm')

  return (
    <div role="main" id="main-content" tabIndex={-1} className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto p-6 animate-fade-in paper-grain">
      <div className="w-full" role="status" aria-live="polite">
        {/* 出票印章：屏幕面用黄铜材质（纸票盖绿墨章、屏幕挂铜牌 —— 同一个「出票」隐喻，
            不把绿墨章硬搬进屏幕）。动画 = 章压下来那一记。 */}
        {hasReceipt && (
          <div className="mb-5 flex justify-center animate-fade-in-up stagger-1">
            <span className="receipt-stamp receipt-stamp-on-dark" aria-hidden="true">已出票<br />超柿收银</span>
          </div>
        )}

        <div className="receipt-paper receipt-enter">
          <div className="receipt-brand">
            <strong>超柿收据</strong>
            <span>Supermarket Receipt</span>
          </div>

          {/* 三态标题按事实分档：无凭据不说「下单成功」—— 对一笔不存在的订单下断言 */}
          <div className="receipt-headline">
            <p className="receipt-kicker">{localFallback ? 'HELD LOCALLY' : hasReceipt ? 'ORDER PRINTED' : 'NOT FOUND'}</p>
            <h1 className="font-display-cn">
              {localFallback ? '订单已暂存本机' : hasReceipt ? '下单成功！' : '没有找到这张订单'}
            </h1>
            <p>
              {localFallback ? '网络未连通，暂时提交失败'
                : hasReceipt ? '订单已提交，请完成支付'
                : '这台设备上没留下订单号，所以无法确认下过单。请重新下单，或按订单号查询。'}
            </p>
          </div>

          <div className="receipt-perf" aria-hidden="true" />

          {localFallback && (
            <div className="receipt-hold receipt-hold-warn" role="alert">
              <p className="receipt-hold-title">这张单商家还收不到</p>
              <p className="receipt-hold-body">
                它只保存在你这台手机上，没有发到店里。请先在下方复制订单号，
                等网络恢复后重新提交一次；直接付款有对不上账的风险。
              </p>
            </div>
          )}

          {/* 五项全空时不渲染空壳（深链直达实测 42px 白框，口径沿用） */}
          {hasCardInfo && (
            <div className="receipt-meta">
              {building && (
                <div className="receipt-row">
                  <span>楼栋</span>
                  <strong>{building}</strong>
                </div>
              )}
              {room && (
                <div className="receipt-row">
                  <span>房间</span>
                  <strong>{room}</strong>
                </div>
              )}
              {totalAmount > 0 && (
                <>
                  <div className="receipt-amount">
                    <span>本次应付</span>
                    <strong>{formatYuan(totalAmount)}</strong>
                  </div>
                  {discountAmount > 0 && (
                    <p className="receipt-discount" role="status">满减已优惠 {formatYuan(discountAmount)}</p>
                  )}
                </>
              )}
              <div className="receipt-foot">
                <div className="receipt-serial">
                  {/* 锚点口径：单号与「订单号：」前缀必须同文本节点（tests/successAndNotFound 断言 /订单号：o_xxx/） */}
                  <p className="receipt-serial-id price-num">订单号：{orderId}</p>
                  <p className="receipt-serial-time">打印时间 {new Date().toLocaleString('zh-CN')}</p>
                </div>
                <div className="receipt-barcode" aria-hidden="true" data-decorative="true">
                  {bars.map((w, i) => (
                    <i key={i} style={{ width: `${w}px` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="receipt-actions">
          {/* 没有订单号就不给「去支付」：点了会被 payment 页弹回首页（口径沿用）。
              有单号但无金额时仍给：金额由支付页自己从 sessionStorage 兜底读。 */}
          {hasReceipt && (
            <button
              onClick={() => navigate('/payment', { state: { orderId, totalAmount, discountAmount } })}
              className="btn-primary w-full py-4 rounded-2xl text-base shadow-elevated"
            >
              去支付
            </button>
          )}
          {orderId && (
            <div className="receipt-actions-row">
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
