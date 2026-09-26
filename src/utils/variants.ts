// 商品变体（口味 / 包装 / 容量）解析层 —— 纯函数，无副作用、无 IO，便于单测。
//
// 数据来自 src/data/variants-demo.ts（本地演示层，不接后端、不进 D1）。
// 设计约束：
//   ① 一个变体组覆盖多个真实商品行（memberOrders），进任一行的详情页都命中同一组，
//      并把该行作为初始选中项 —— 避免「同一商品的三个规格在目录里是三条独立记录」时
//      详情页各说各话。
//   ② 组合可以「不存在」（如盒装没有 500ml）。不存在的组合不编造价格，
//      由 pickCombo 自动回落到最近的可售组合，页面据此给出真实反馈。

export interface VariantOption {
  id: string
  /** 真实属性文案（口味名 / 包装名 / 容量），是权威口径 */
  label: string
}

export interface VariantAxis {
  id: string
  /** 轴名按真实属性写（口味 / 包装 / 容量），不硬套「颜色」字样 */
  name: string
  options: VariantOption[]
}

export interface VariantCombo {
  /** 真实售价，逐行取自 products-seed.ts */
  price: number
  /** 真实商品 order，图片走 utils/images.ts 的 /images/{order}.webp */
  order: number
  /** 该组合对应的真实商品名（选中后页面据实展示，不藏在变体背后） */
  productName: string
  /** 该组合的真实规格文案 */
  specText?: string
  available: boolean
}

export interface VariantGroup {
  id: string
  /** 组标题，如「东鹏特饮 · 包装与容量」 */
  title: string
  /** 命中该组的真实商品 order 集合 */
  memberOrders: number[]
  /**
   * 真实性声明：说清哪些是真实值、哪些是演示聚合。
   * 目录里同一商品的多个规格本是多条独立记录，聚成一个变体组属演示交互，
   * 必须如实标注，不能让人误读成后端下发的真实 SKU 关系。
   */
  disclosure?: string
  axes: VariantAxis[]
  /** key = 各轴选项 id 按 axes 顺序用 COMBO_SEP 连接；轴不取值时该段为空串 */
  combos: Record<string, VariantCombo>
}

export type Selection = Record<string, string>

export const COMBO_SEP = '|'

/** 按 axes 声明顺序拼 key，保证同一选择恒得同一字符串（不依赖对象键序） */
export function comboKey(group: VariantGroup, selection: Selection): string {
  return group.axes.map((axis) => selection[axis.id] ?? '').join(COMBO_SEP)
}

/** key 反解回选择对象 */
export function parseComboKey(group: VariantGroup, key: string): Selection {
  const parts = key.split(COMBO_SEP)
  const out: Selection = {}
  group.axes.forEach((axis, i) => { out[axis.id] = parts[i] ?? '' })
  return out
}

function normalizeOrder(order?: number | string | null): number | null {
  if (order === undefined || order === null) return null
  const n = Number(String(order).trim())
  return Number.isFinite(n) ? n : null
}

/** 按真实商品 order 找变体组；不在演示数据里的商品返回 undefined（页面据此不渲染选择器） */
export function getVariantGroup(
  groups: VariantGroup[],
  order?: number | string | null,
): VariantGroup | undefined {
  const o = normalizeOrder(order)
  if (o === null) return undefined
  return groups.find((g) => g.memberOrders.includes(o))
}

/** 精确取组合；不存在或不可售都返回 undefined，调用方据此判断能否加购 */
export function resolveCombo(group: VariantGroup, selection: Selection): VariantCombo | undefined {
  const combo = group.combos[comboKey(group, selection)]
  return combo && combo.available ? combo : undefined
}

/** 该轴该选项在全组内是否存在任一可售组合（用于灰掉真正的死选项） */
export function hasAvailableCombo(
  group: VariantGroup,
  axisId: string,
  optionId: string,
): boolean {
  const idx = group.axes.findIndex((a) => a.id === axisId)
  if (idx < 0) return false
  return Object.keys(group.combos).some((key) => {
    const combo = group.combos[key]
    if (!combo.available) return false
    return key.split(COMBO_SEP)[idx] === optionId
  })
}

/** 组内全部可售组合涉及的真实 order（去重、按声明序）——详情页图集与缩略图列的真实图源 */
export function groupImageOrders(group: VariantGroup): number[] {
  const seen: number[] = []
  for (const key of Object.keys(group.combos)) {
    const combo = group.combos[key]
    if (combo.available && !seen.includes(combo.order)) seen.push(combo.order)
  }
  return seen
}

/** 组内可售价格区间（列表页展示「¥1.66 起」用；单价商品不显示「起」） */
export function groupPriceRange(group: VariantGroup): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const key of Object.keys(group.combos)) {
    const combo = group.combos[key]
    if (!combo.available) continue
    if (combo.price < min) min = combo.price
    if (combo.price > max) max = combo.price
  }
  if (min === Number.POSITIVE_INFINITY) return { min: 0, max: 0 }
  return { min, max }
}

/**
 * 在可售组合里挑一个，返回它对应的选择与组合。
 *
 * hardAxisId = 用户刚改动的那一轴，**硬钉**：不匹配该轴取值的组合直接出局。
 * 少了这一步会出真实缺陷 —— 白象方便面从「帮泡装 + 十三香」点「零售装」时，
 * 零售装的组合口味段为空（score 0），而「帮泡装 + 十三香」恰好 score 1，
 * 按分数选会把用户刚点的「零售装」吃掉、悄悄改回帮泡装。
 *
 * 其余轴按匹配数打分，并列取 combos 声明顺序靠前者。于是选到「盒装 + 500ml」
 * 这种不存在的组合时，容量自动跳回 250ml（真实电商行为），而不是把按钮一灰了之。
 */
export function pickCombo(
  group: VariantGroup,
  pinned: Selection,
  hardAxisId?: string,
): { selection: Selection; combo: VariantCombo } | null {
  const hardIdx = hardAxisId ? group.axes.findIndex((a) => a.id === hardAxisId) : -1
  const hardValue = hardIdx >= 0 ? pinned[group.axes[hardIdx].id] : undefined
  let best: { selection: Selection; combo: VariantCombo } | null = null
  let bestScore = -1
  for (const key of Object.keys(group.combos)) {
    const combo = group.combos[key]
    if (!combo.available) continue
    const parts = key.split(COMBO_SEP)
    if (hardIdx >= 0 && hardValue && parts[hardIdx] !== hardValue) continue
    let score = 0
    let mismatch = false
    group.axes.forEach((axis, i) => {
      if (i === hardIdx) return
      const want = pinned[axis.id]
      if (want === undefined || want === '') return
      if (parts[i] === want) score += 1
      else mismatch = true
    })
    // 未指定硬钉轴时，全轴都对不上的组合不出局会被选中，等于凭空换商品
    if (hardIdx < 0 && mismatch && score === 0) continue
    if (score > bestScore) {
      bestScore = score
      best = { selection: parseComboKey(group, key), combo }
    }
  }
  return best
}

/**
 * 初始选择：进详情页时用当前商品的真实 order 反查它对应哪个组合。
 * 反查不到（该 order 不在任何可售组合里）则回落到 pickCombo 的第一个可售组合。
 */
export function initialSelection(group: VariantGroup, order?: number | string | null): Selection {
  const o = normalizeOrder(order)
  if (o !== null) {
    for (const key of Object.keys(group.combos)) {
      const combo = group.combos[key]
      if (combo.available && combo.order === o) return parseComboKey(group, key)
    }
  }
  const fallback = pickCombo(group, {})
  return fallback ? fallback.selection : {}
}
