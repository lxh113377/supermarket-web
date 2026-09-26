// 可选规格（口味）合成层 —— 把管理后台维护的 product.specOptions 变成一条单轴变体组，
// 与 src/data/variants-demo.ts 的演示组共用 utils/variants.ts 的纯函数与 VariantPicker。
//
// 口径：口味只决定「要哪一个」，单价、实拍图、商品名仍是这条商品记录的真实值，不编造。
// enabled=false 的口味由后台开关关掉，这里直接过滤掉，顾客端不渲染。
import type { Product, SpecOption } from '../types'
import type { VariantGroup } from './variants'

export const SPEC_AXIS_ID = 'flavor'

/**
 * 订单快照里「静态规格」与「所选口味」的分隔符。
 * 唯一权威：合成端（本文件 specText 与 functions/lib/actions/orders.js 的 allowedOrderSpecs）
 * 与解析端（splitOrderSpec）都必须引用它，任一侧改字面量就会让后台口味标签静默失灵。
 */
export const SPEC_FLAVOR_SEP = ' · '

/** 只保留有名字、且未被后台关掉的口味；同名只取第一条（后台手滑重复不会渲染出两个按钮） */
export function enabledSpecOptions(product?: { specOptions?: SpecOption[] } | null): SpecOption[] {
  const raw = Array.isArray(product?.specOptions) ? product!.specOptions! : []
  const seen = new Set<string>()
  const out: SpecOption[] = []
  for (const item of raw) {
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    if (!label || item?.enabled === false || seen.has(label)) continue
    seen.add(label)
    out.push({ label, enabled: true })
  }
  return out
}

/** 合成单轴「口味」变体组；没有可用口味（或该记录没有 order）时返回 undefined，页面据此不渲染选择器 */
export function specOptionGroupOf(product?: Product | null): VariantGroup | undefined {
  if (!product) return undefined
  if (product.order === undefined || product.order === null || product.order === '') return undefined
  const order = Number(product.order)
  if (!Number.isFinite(order)) return undefined
  const options = enabledSpecOptions(product)
  if (!options.length) return undefined
  const price = Number(product.price) || 0
  const spec = (product.spec || '').trim()
  return {
    id: `spec-${order}`,
    title: `${product.name} · 口味`,
    memberOrders: [order],
    disclosure: '口味清单由商家在管理后台维护，后台关掉口味本页即不再显示；同一商品各口味共用同一单价与同一实拍图，选口味不改价。',
    axes: [
      {
        id: SPEC_AXIS_ID,
        name: '口味',
        options: options.map((o) => ({ id: o.label, label: o.label })),
      },
    ],
    combos: Object.fromEntries(options.map((o) => [
      o.label,
      {
        price,
        order,
        productName: product.name,
        specText: spec ? `${spec}${SPEC_FLAVOR_SEP}${o.label}` : o.label,
        available: true,
      },
    ])),
  }
}

/**
 * 解析订单快照里的 items.spec，拆出「静态规格」与「顾客所选口味」。
 *
 * 只按第一个分隔符划一次：口味名本身可能带「·」，全量 split 会把口味切碎。
 * 历史订单（2026-09-26 修复前下的单）不含分隔符 —— 那时顾客选的口味被目录静态 spec
 * 覆盖掉了，flavor 返回空串；调用方据此不显示标签，不得替老单猜测口味。
 */
export function splitOrderSpec(spec?: string | null): { base: string; flavor: string } {
  const raw = typeof spec === 'string' ? spec : ''
  const at = raw.indexOf(SPEC_FLAVOR_SEP)
  if (at < 0) return { base: raw.trim(), flavor: '' }
  return { base: raw.slice(0, at).trim(), flavor: raw.slice(at + SPEC_FLAVOR_SEP.length).trim() }
}

/**
 * 搜索用文本 = 静态规格 + 顾客可见的口味名。
 * 后台关掉的口味不参与匹配：搜出一个点不到的结果，比搜不到更糟。
 * 搜索框文案已写成「名称或口味」，这个函数就是那句文案的实现，二者必须一起改。
 */
export function specSearchText(product?: { spec?: string; specOptions?: SpecOption[] } | null): string {
  const parts = [(product?.spec || '').trim()]
  for (const o of enabledSpecOptions(product)) parts.push(o.label)
  return parts.filter(Boolean).join(' ')
}
