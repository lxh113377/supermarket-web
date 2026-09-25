// 可选规格（口味）合成层 —— 把管理后台维护的 product.specOptions 变成一条单轴变体组，
// 与 src/data/variants-demo.ts 的演示组共用 utils/variants.ts 的纯函数与 VariantPicker。
//
// 口径：口味只决定「要哪一个」，单价、实拍图、商品名仍是这条商品记录的真实值，不编造。
// enabled=false 的口味由后台开关关掉，这里直接过滤掉，顾客端不渲染。
import type { Product, SpecOption } from '../types'
import type { VariantGroup } from './variants'

export const SPEC_AXIS_ID = 'flavor'

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
        kind: 'spec',
        options: options.map((o) => ({ id: o.label, label: o.label })),
      },
    ],
    combos: Object.fromEntries(options.map((o) => [
      o.label,
      {
        price,
        order,
        productName: product.name,
        specText: spec ? `${spec} · ${o.label}` : o.label,
        available: true,
      },
    ])),
  }
}
