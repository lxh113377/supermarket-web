// CSV 导出公共工具（Excel 兼容：逗号/引号/换行转义 + UTF-8 BOM + CRLF 行结尾）
// DashboardTab.buildCsv 与 OrdersTab.exportCSV 复用同一转义逻辑，避免各实现一份漂移。

// 单元格转义：含逗号/引号/换行的值用双引号包裹，内部 " 翻倍转义
export function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 构建 CSV 文本（自动加 BOM + CRLF），rows 为行数组（每行是已转义的单元格数组）
export function buildCsvText(header: string[], rows: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) => cells.map(csvEscape).join(',')
  return '\uFEFF' + [line(header), ...rows.map(line)].join('\r\n')
}