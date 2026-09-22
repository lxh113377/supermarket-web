// 数值/金额格式化 —— 全站唯一真相源。
// 此前价格格式化在 13+ 处各自内联 `¥{x.toFixed(2)}`，改一次展示规则要动十几个文件，
// 且曾出现「有的地方四舍五入、有的地方直接拼接」的不一致。统一收口到这里。

/** 价格数字（不含货币符号），固定两位小数：3.5 → "3.50" */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0.00'
  return value.toFixed(2)
}

/** 带 ¥ 前缀的完整价格：3.5 → "¥3.50" */
export function formatYuan(value: number): string {
  return `¥${formatPrice(value)}`
}

/** 整数计数（千分位）：1234 → "1,234" */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('zh-CN')
}

/**
 * 百分比（用于看板环比）：入参为「小数比率」。
 * 0.123 → "12.3%"；null/undefined → "—"（无对比基准时不伪造 0%）
 */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}
