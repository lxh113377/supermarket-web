import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import OrderItem from '../components/OrderItem'
import { getCart, getTotalAmount, clearCart } from '../cart'
import { createOrder } from '../db'
import { isBusinessHours, getClosedMessage } from '../utils/businessHours'
import { formatYuan } from '../utils/format'

// 图片压缩：限制最大边 800px，质量 0.6
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result !== 'string') {
        reject(new Error('图片读取失败'))
        return
      }
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX = 800
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas 不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.6))
      }
      img.onerror = reject
      img.src = result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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
  const open = isBusinessHours()

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5MB')
      return
    }
    try {
      const dataUrl = await compressImage(file)
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
    setSubmitting(true)
    try {
      const result = await createOrder({
        // 楼栋+房间合并写入 roomNumber（服务端以该字段必填校验），如 "36栋-501"
        roomNumber: `${building.trim()}-${room.trim()}`,
        wechat: wechat.trim() || undefined,
        remark: remark.trim() || undefined,
        items: cart.items,
        paymentScreenshot: screenshot || undefined,
      })
      clearCart()
      navigate('/order-success', { state: { building: building.trim(), room: room.trim(), orderId: result.id, localFallback: result.localFallback, totalAmount } })
    } catch (err) {
      setError('提交订单失败：' + (err instanceof Error ? err.message : '网络错误'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-4 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200"
          aria-label="返回"
        >
          ←
        </button>
        <h2 className="text-base font-bold text-gray-900">确认订单</h2>
        <span className="w-9" />
      </div>

      <div className="flex-1 p-5 overflow-hidden flex flex-col w-full max-w-3xl lg:max-w-4xl mx-auto">
        <div className="flex-1 overflow-y-auto space-y-5">
          {/* 营业时间提示 */}
          {!open && (
            <div className="bg-red-50/80 border border-red-200/60 rounded-2xl p-4 animate-slide-down">
              <p className="text-red-700 text-sm font-medium">{getClosedMessage()}</p>
              <p className="text-red-400 text-xs mt-1.5">当前非营业时间，下单后可能无法及时处理</p>
            </div>
          )}

          {/* 已选商品 */}
          <div className="bg-white rounded-2xl p-5 shadow-card border border-gray-100/80 animate-fade-in-up">
            <h3 className="section-title mb-3">已选商品</h3>
            <div className="space-y-2">
              {cart.items.map(item => (
                <OrderItem key={item.productId} item={item} />
              ))}
            </div>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-100">
              <span className="text-sm font-semibold text-gray-700">合计</span>
              <span className="text-xl font-bold text-brand-600">{formatYuan(totalAmount)}</span>
            </div>
          </div>

          {/* 表单 label 与输入框显式关联（htmlFor/id）：
              原实现 label 与 input 是兄弟节点、无关联，读屏只会念「编辑框」不念字段名 */}
          {/* 楼栋号 */}
          <div className="animate-fade-in-up stagger-1">
            <label htmlFor="order-building" className="section-title block mb-2.5">
              楼栋号 <span className="text-red-400" aria-hidden="true">*</span>
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
            <label htmlFor="order-room" className="section-title block mb-2.5">
              房间号 <span className="text-red-400" aria-hidden="true">*</span>
            </label>
            <input
              id="order-room"
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="例如：501"
              required
              aria-required="true"
              aria-invalid={error.includes('房间') || undefined}
              aria-describedby={error.includes('房间') ? 'order-error' : undefined}
              className="input-base"
            />
          </div>

          {/* 微信号（选填） */}
          <div className="animate-fade-in-up stagger-1">
            <label htmlFor="order-wechat" className="section-title block mb-2.5">微信号（选填）</label>
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
            <label htmlFor="order-remark" className="section-title block mb-2.5">备注</label>
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
            <label className="section-title block mb-2.5">转账截图（可选）</label>
            {screenshot ? (
              <div className="relative inline-block animate-scale-in">
                <img src={screenshot} alt="转账截图" className="w-36 h-36 object-cover rounded-2xl border border-gray-200 shadow-soft" />
                <button
                  onClick={() => setScreenshot(null)}
                  aria-label="删除付款截图"
                  className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full text-xs flex items-center justify-center shadow-soft hover:bg-red-600 transition-all duration-200 active:scale-90"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-8 text-sm text-gray-400 hover:border-brand-300 hover:text-brand-500 hover:bg-brand-50/30 transition-all duration-300"
              >
                <span className="block text-2xl mb-2">📷</span>
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

        {/* 底部操作 */}
        <div className="mt-5 space-y-2.5">
          {/* role="alert" + id：读屏会在校验失败时立即播报，并被上方输入框的 aria-describedby 引用 */}
          <div role="alert" aria-live="assertive">
            {error && <p id="order-error" className="text-red-500 text-sm text-center animate-slide-down">{error}</p>}
          </div>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className={`w-full py-4 rounded-2xl font-medium text-base transition-all duration-200 active:scale-[0.98] ${
              submitting
                ? 'bg-gray-200 text-gray-400'
                : open
                  ? 'btn-primary shadow-elevated'
                  : 'bg-amber-500 text-white hover:bg-amber-600 shadow-elevated'
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
