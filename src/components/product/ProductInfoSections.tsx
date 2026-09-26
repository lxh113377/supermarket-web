import type { ReactNode } from 'react'
import type { Product, Category } from '../../types'
import type { VariantCombo } from '../../utils/variants'
import { formatYuan } from '../../utils/format'
import { getBusinessHoursText, isBusinessHours } from '../../utils/businessHours'

// 商品参数 / 配送说明 / 售后说明
//
// 真实性分层，一眼可辨：
//   · 「商品参数」全部取自真实目录字段（名称/规格/编号/分类/单价/库存/上下架）。
//   · 「配送说明」里营业时间与营业状态取自 utils/businessHours（应用真实口径）；
//     目录中不存在配送时长与起送金额，故不写具体数字，只说明以群内约定为准。
//   · 「售后说明」商家从未提供，整块标注为演示文案，不作为商家承诺。

interface Props {
  product: Product
  categories: Category[]
  /** 选中变体时传入，参数表按变体对应的真实商品行展示 */
  combo?: VariantCombo
}

function DemoBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[10px] font-semibold align-middle">
      演示文案
    </span>
  )
}

function Section({ id, title, badge, children }: {
  id: string
  title: string
  badge?: boolean
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="bg-white mt-2.5 lg:mt-4 lg:rounded-2xl lg:border lg:border-gray-100/80 p-5">
      <h3 id={id} className="section-title mb-3">
        {title}
        {badge && <span className="ml-2"><DemoBadge /></span>}
      </h3>
      {children}
    </section>
  )
}

/** 子分类 id → 真实分类名（含父分类，如「饮品 · 茶」） */
function categoryLabels(product: Product, categories: Category[]): string[] {
  const subs = product.subcategories ?? []
  if (subs.length === 0) return []
  const out: string[] = []
  for (const cat of categories) {
    for (const sub of cat.subcategories ?? []) {
      if (subs.includes(sub.id)) out.push(`${cat.name} · ${sub.name}`)
    }
  }
  // 目录里有商品挂了不在分类表中的子分类 id，原样兜出来，避免"看起来没有分类"
  const known = new Set(categories.flatMap((c) => (c.subcategories ?? []).map((s) => s.id)))
  for (const s of subs) if (!known.has(s)) out.push(s)
  return out
}

function stockText(product: Product): string {
  if (product.stock === undefined) return '未设置'
  if (product.stock === -1) return '不限'
  return `${product.stock} 件`
}

export default function ProductInfoSections({ product, categories, combo }: Props) {
  const open = isBusinessHours()
  const rows: Array<[string, string]> = [
    ['商品名称', combo ? combo.productName : product.name],
    ['口味', (combo?.specText ?? product.spec) || '未标注'],
    ['目录编号', product.order !== undefined && product.order !== null ? String(product.order) : '未标注'],
    ['所属分类', categoryLabels(product, categories).join('、') || '未归类'],
    ['单价', formatYuan(combo ? combo.price : product.price)],
    ['库存', stockText(product)],
    ['销售状态', product.enabled === false ? '已下架' : '在售'],
  ]
  if (combo) rows.splice(3, 0, ['当前变体', combo.specText || combo.productName])

  return (
    <>
      <Section id="params-heading" title="商品参数">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
              <dt className="text-gray-500 shrink-0">{k}</dt>
              <dd className="text-gray-900 text-right min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          以上字段全部取自商品目录真实记录，未做任何加工。
        </p>
      </Section>

      <Section id="delivery-heading" title="配送说明">
        <ul className="text-sm text-gray-600 space-y-2 leading-relaxed list-disc pl-4 m-0">
          <li>营业时间：{getBusinessHoursText()}</li>
          <li>
            当前状态：
            <span className={open ? 'text-green-700 font-medium' : 'text-amber-700 font-medium'}>
              {open ? '营业时间内，可正常下单' : '非营业时间，需先在群内与商家确认'}
            </span>
          </li>
          <li>收货信息：下单时填写宿舍楼栋（订单字段「楼栋号」），配送范围以学校内宿舍楼为准。</li>
          <li>配送时长与起送金额：目录未提供该数据，实际以商家群内约定为准，此处不给具体数字。</li>
        </ul>
      </Section>

      <Section id="after-sale-heading" title="售后说明" badge>
        <p className="text-[11px] text-gray-400 -mt-1 mb-3 leading-relaxed">
          商家未提供售后条款，以下三条为界面演示文案，不构成任何真实承诺。
        </p>
        <ul className="text-sm text-gray-600 space-y-2 leading-relaxed list-disc pl-4 m-0">
          <li>签收时请当场核对品名与数量，发现错送或漏送可在群内反馈。</li>
          <li>预包装食品请留意包装上的生产日期与保质期，包装破损不建议食用。</li>
          <li>如需退换，请在取货后尽快与商家联系，处理结果以商家确认为准。</li>
        </ul>
      </Section>
    </>
  )
}
