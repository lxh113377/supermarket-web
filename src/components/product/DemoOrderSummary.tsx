import Overlay from '../Overlay'
import { formatYuan } from '../../utils/format'
import { getBusinessHoursText, isBusinessHours } from '../../utils/businessHours'
import type { VariantCombo } from '../../utils/variants'

// 演示订单摘要 —— 「立即购买」只弹这个，不建单、不跳转 /order-confirm、不发起支付。
// 需求明确：购买按钮仅展示演示订单摘要，不进行真实支付。
// 真实下单链路（购物车 → 确认订单 → 支付）仍由既有页面承担，本组件一律不触碰。

interface Props {
  open: boolean
  onClose: () => void
  /** 真实商品名（选中变体时用变体对应的真实商品名） */
  productName: string
  /** 规格文案：变体的 specText 优先，否则用商品自身 spec */
  specText?: string
  /** 单价：变体解析后的真实价格 */
  unitPrice: number
  quantity: number
  /** 选中变体时带上，用于如实展示这单买的是哪个真实商品行 */
  combo?: VariantCombo
}

export default function DemoOrderSummary({
  open, onClose, productName, specText, unitPrice, quantity, combo,
}: Props) {
  const total = unitPrice * quantity
  const open_ = isBusinessHours()

  return (
    <Overlay open={open} onClose={onClose} label="演示订单摘要" className="max-w-md">
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">演示订单摘要</h2>
          <p className="text-xs text-gray-500 mt-1">
            本页为演示环境，以下摘要<strong className="text-gray-700">不产生真实订单、不发起任何支付</strong>。
          </p>
        </div>

        <div className="bg-amber-50/70 border border-amber-200/70 rounded-xl px-3 py-2">
          <p className="text-[11px] leading-relaxed text-amber-800">
            演示内容：金额、数量与配送说明仅用于展示交互，未接入支付渠道，也未写入订单库。
          </p>
        </div>

        <dl className="border-t border-b border-gray-100 py-3 space-y-2 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-gray-500 shrink-0">商品</dt>
            <dd className="text-gray-900 text-right font-medium min-w-0">
              {productName}
              {specText && <span className="block text-xs text-gray-500 font-normal mt-0.5">{specText}</span>}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-500">单价</dt>
            <dd className="text-gray-900 tabular-nums">{formatYuan(unitPrice)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-500">数量</dt>
            <dd className="text-gray-900 tabular-nums">× {quantity}</dd>
          </div>
          {combo && (
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500 shrink-0">对应目录商品</dt>
              <dd className="text-gray-500 text-right text-xs">
                编号 {combo.order} · {combo.productName}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
            <dt className="text-gray-900 font-semibold">合计</dt>
            <dd className="text-brand-600 font-bold text-lg tabular-nums">{formatYuan(total)}</dd>
          </div>
        </dl>

        <div className="text-xs text-gray-500 space-y-1">
          <p className="font-semibold text-gray-700 text-sm">配送说明</p>
          <p>营业时间：{getBusinessHoursText()}</p>
          <p>
            {open_
              ? '当前在营业时间内，演示下单可继续（真实下单需填写宿舍楼栋）。'
              : '当前非营业时间，真实下单前需先在群内与商家确认。'}
          </p>
          <p>配送范围与取货点为演示文案，实际以商家群内约定为准。</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          data-autofocus
          className="w-full btn-secondary py-3 text-sm"
        >
          我知道了（返回商品页）
        </button>
      </div>
    </Overlay>
  )
}
