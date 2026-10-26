// wasm 宿主对账 + 微基准工具（Node 侧）。
//
// 为什么要这个脚本（它是本方案里最重要的一件证据）：
//   加速器的唯一风险是「算得和原来不一样」；唯一的价值是「真的更快」。
//   这两件事都不能靠读代码相信 —— 这里把 Rust 产物在 Node 里跑起来，
//   与 JS 侧镜像实现逐条对账（对账不过就判红），并把「谁更快、快多少」量出来。
//   docs/05 的性能表就是本脚本的 stdout，跑一次即可复算。
//
// 用法：
//   node rust/scripts/wasm-host-test.mjs [wasm 路径]
//   默认 rust/target/supermarket_wasm.opt.wasm（wasm-opt 产物），缺失则退回 cargo 产物。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = [
  process.argv[2],
  path.join(here, '..', 'target', 'supermarket_wasm.opt.wasm'),
  path.join(here, '..', 'target', 'wasm32-unknown-unknown', 'release-wasm', 'supermarket_wasm.wasm'),
].filter(Boolean)
const wasmPath = candidates.find((p) => fs.existsSync(p))
if (!wasmPath) {
  console.error('找不到 wasm 产物，先跑：cargo build -p supermarket-wasm --profile release-wasm --target wasm32-unknown-unknown')
  process.exit(1)
}

// Windows 上 pathToFileURL 会给出 file:///C:/... 并对非 ASCII 做百分号编码；
// 直接丢给 fs 会得到 C:\C:\... 这种双重盘符（实测过），所以显式还原。
const toFsPath = (url) => {
  let p = url.startsWith('file://') ? decodeURIComponent(url.slice(7)) : url
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  return p
}
const { loadSupermarketWasm } = await import(
  pathToFileURL(path.join(here, '..', 'web', 'wasm-loader.js')).href
)
const loadStart = process.hrtime.bigint()
const acc = await loadSupermarketWasm(pathToFileURL(wasmPath).href, {
  fetchImpl: async (url) => {
    const p = toFsPath(url)
    const buf = fs.readFileSync(p)
    return { ok: true, status: 200, arrayBuffer: async () => buf, headers: new Map() }
  },
})
if (!acc) {
  console.error('wasm 加载失败')
  process.exit(1)
}
const loadMs = Number(process.hrtime.bigint() - loadStart) / 1e6
const wasmBytes = fs.statSync(wasmPath).size
const zlib = await import('node:zlib')
const source = fs.readFileSync(wasmPath)
console.log('产物：' + wasmPath)
console.log(
  '  体积 raw ' + wasmBytes + ' B / gzip ' + zlib.gzipSync(source, { level: 9 }).length +
    ' B / brotli ' + zlib.brotliCompressSync(source, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length + ' B',
)
console.log('  实例化（含读盘）：' + loadMs.toFixed(2) + ' ms（浏览器侧是下载+编译，见 docs/05 的初始化开销一节）')

// ── JS 侧镜像实现（与仓库源码同口径；改这里必须同步改源码）────────────────────
const jsCsvEscape = (v) => {
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const jsBuildCsvText = (header, rows) => {
  const line = (cells) => cells.map(jsCsvEscape).join(',')
  return '\uFEFF' + [line(header), ...rows.map(line)].join('\r\n')
}
const jsSpecSearchText = (p) => {
  const parts = [(p.spec || '').trim()]
  for (const o of Array.isArray(p.specOptions) ? p.specOptions : []) {
    const label = typeof o?.label === 'string' ? o.label.trim() : ''
    if (!label || o?.enabled === false) continue
    parts.push(label)
  }
  return parts.filter(Boolean).join(' ')
}
// 与 src/pages/CustomerPage.tsx 的 filteredProducts 同一谓词（两个字段各自 lowercase 后各自匹配）
const jsFilterIndices = ({ products, topSubIds, subId, q, sort }) => {
  const top = new Set(topSubIds)
  let list = subId
    ? products.filter((p) => (p.subcategories || []).includes(subId))
    : products.filter((p) => (p.subcategories || []).some((s) => top.has(s)))
  if (q) {
    const needle = String(q).toLowerCase()
    list = list.filter(
      (p) => p.name.toLowerCase().includes(needle) || jsSpecSearchText(p).toLowerCase().includes(needle),
    )
  }
  if (sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price)
  else if (sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price)
  return list.map((p) => products.indexOf(p))
}

let failed = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log('  PASS ' + name)
  } else {
    failed += 1
    console.log('  FAIL ' + name + '\n    wasm: ' + a + '\n    js  : ' + e)
  }
}

console.log('\n[1] 购物袋汇总对账')
const cartItems = [
  { price: 3.5, quantity: 3 },
  { price: 0.09, quantity: 1 },
  { price: 0.1, quantity: 1 },
]
{
  const got = acc.cartSummary(cartItems)
  const total = 3.5 * 3 + 0.09 + 0.1
  check('totalAmount（与 JS 同一求和方向）', got.totalAmount, total)
  check('totalCount', got.totalCount, 5)
  check('meetsMinDelivery', got.meetsMinDelivery, Math.round(total * 100) >= 600)
  check('minDeliveryGap', got.minDeliveryGap, Math.max(0, Math.round((6 - total) * 100) / 100))
  const low = acc.cartSummary([{ price: 1, quantity: 1 }])
  check('低于起送门槛（1 元）', low.meetsMinDelivery, false)
  check('差额 = 5', low.minDeliveryGap, 5)
}

console.log('\n[2] 目录筛选对账（一次性 + 常驻索引两条路径）')
const products = [
  { _id: 'p_1', name: '软糖', spec: '袋装', price: 0.49, subcategories: ['snack', 'candy'], specOptions: [{ label: '黄瓜味', enabled: true }, { label: '烤虾味', enabled: false }] },
  { _id: 'p_2', name: '话梅糖', price: 0.09, subcategories: ['snack', 'candy'] },
  { _id: 'p_3', name: '笔记本', price: 6, subcategories: ['study'] },
  { _id: 'p_4', name: '苏打水', spec: '无糖', price: 2.5, subcategories: ['drink'], specOptions: [{ label: '柠檬味', enabled: true }] },
]
const topSubIds = ['snack', 'candy', 'drink']
const cases = [
  { topSubIds, subId: null, q: null, sort: 'default' },
  { topSubIds, subId: 'candy', q: null, sort: 'default' },
  { topSubIds, subId: null, q: '糖', sort: 'default' },
  { topSubIds, subId: null, q: '黄瓜', sort: 'default' },
  { topSubIds, subId: null, q: '烤虾', sort: 'default' },
  { topSubIds, subId: null, q: null, sort: 'price-asc' },
  { topSubIds, subId: null, q: null, sort: 'price-desc' },
  { topSubIds, subId: 'drink', q: '柠檬', sort: 'price-asc' },
]
const loaded = acc.catalogLoad(products)
check('catalogLoad 返回件数', loaded, products.length)
for (const c of cases) {
  const label = 'sort=' + c.sort + ' sub=' + (c.subId || '全部') + ' q=' + (c.q || '空')
  const expected = jsFilterIndices({ products, ...c })
  check('一次性  ' + label, acc.filterIndices({ products, ...c }), expected)
  check('常驻索引 ' + label, acc.catalogQuery(c), expected)
}

console.log('\n[3] CSV 导出对账')
const csvHeader = ['订单号', '金额,含税', '备注']
const csvRows = [
  ['SM-1', 3.5, '带"引号"'],
  ['SM-2', 123, '多行\n备注'],
  ['SM-3', 0, ''],
]
check('BOM + CRLF + 转义', acc.csvExport(csvHeader, csvRows), jsBuildCsvText(csvHeader, csvRows))
{
  const bigRows = []
  for (let i = 0; i < 2000; i += 1) {
    bigRows.push(['SM-' + i, i * 1.5, '商品 ' + i, i % 7, i % 3 === 0 ? '含,逗号' : '普通', i % 5 === 0 ? '带"引号"' : '-', i, '备注'])
  }
  const bigHeader = ['订单号', '金额', '商品', '数量', '备注A', '备注B', '序号', '备注C']
  const wasmOut = acc.csvExport(bigHeader, bigRows)
  const jsOut = jsBuildCsvText(bigHeader, bigRows)
  check('2000 行 × 8 列 逐字节一致', wasmOut === jsOut, true)
  check('2000 行 × 8 列 长度一致', wasmOut.length, jsOut.length)
}

// ── 微基准（同机、同进程、JIT 预热后）────────────────────────────────────────
const bench = (name, size, wasmFn, jsFn, iterations) => {
  // 预热：两侧各跑几轮，避开 JIT 编译与首次 wasm 调用
  for (let i = 0; i < 3; i += 1) { wasmFn(); jsFn() }
  let sink = 0
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < iterations; i += 1) sink += wasmFn() ? 1 : 0
  const t1 = process.hrtime.bigint()
  for (let i = 0; i < iterations; i += 1) sink += jsFn() ? 1 : 0
  const t2 = process.hrtime.bigint()
  const wasmMs = Number(t1 - t0) / 1e6
  const jsMs = Number(t2 - t1) / 1e6
  const ratio = jsMs / wasmMs
  console.log(
    '| ' + name + ' | ' + size + ' | ' + iterations + ' | ' + wasmMs.toFixed(2) + ' | ' + jsMs.toFixed(2) + ' | ' +
      (ratio >= 1 ? ratio.toFixed(2) + '× 快' : (1 / ratio).toFixed(2) + '× 慢') + ' |',
  )
  if (!sink) console.log('（sink=' + sink + '，基准可能被优化掉了）')
}

console.log('\n[4] 微基准（越小越好；比率 = JS 用时 / wasm 用时）')
console.log('| 算子 | 规模 | 迭代 | wasm(ms) | JS(ms) | 比率 |')
console.log('|---|---|---|---|---|---|')
{
  const items20 = Array.from({ length: 20 }, (_, i) => ({ price: 0.99 + i * 0.37, quantity: (i % 4) + 1 }))
  const jsTotal = (rows) => rows.reduce((sum, item) => sum + item.price * item.quantity, 0)
  bench('cart_summary（纯数字）', '20 行', () => acc.cartSummary(items20).totalAmount, () => jsTotal(items20), 20000)
}
{
  const catalog65 = Array.from({ length: 65 }, (_, i) => ({
    _id: 'p_' + i,
    name: '商品' + i + (i % 5 === 0 ? ' 苏打水' : ''),
    spec: i % 3 === 0 ? '袋装' : '',
    price: Number((0.09 + i * 0.5).toFixed(2)),
    subcategories: i % 2 === 0 ? ['snack', 'candy'] : ['drink'],
    specOptions: i % 4 === 0 ? [{ label: '柠檬味', enabled: true }, { label: '黄瓜味', enabled: true }] : [],
  }))
  const top65 = ['snack', 'candy', 'drink']
  // 关键字必须能命中，否则基准量的是「空结果」而不是筛选本身（第一版就踩了这个坑：
  // q='糖' 在这份 65 件数据里 0 命中，两侧都提前退出，读数全是噪声）。
  const oneShot = { products: catalog65, topSubIds: top65, subId: null, q: '苏打水', sort: 'default' }
  acc.catalogLoad(catalog65)
  bench('filter 一次性（每次重传全表）', '65 件', () => acc.filterIndices(oneShot).length, () => jsFilterIndices(oneShot).length, 2000)
  bench('catalog_query（常驻索引）', '65 件', () => acc.catalogQuery({ topSubIds: top65, subId: null, q: '苏打水', sort: 'default' }).length, () => jsFilterIndices(oneShot).length, 20000)
}
{
  const rows2000 = []
  for (let i = 0; i < 2000; i += 1) rows2000.push(['SM-' + i, i * 1.5, '商品 ' + i, i % 7, i % 3 === 0 ? '含,逗号' : '普通', i % 5 === 0 ? '带"引号"' : '-', i, '备注'])
  const header = ['订单号', '金额', '商品', '数量', '备注A', '备注B', '序号', '备注C']
  bench('csv_export', '2000 行 × 8 列', () => acc.csvExport(header, rows2000).length, () => jsBuildCsvText(header, rows2000).length, 30)
  const rows20000 = []
  for (let i = 0; i < 20000; i += 1) rows20000.push(['SM-' + i, i * 1.5, '商品 ' + i, i % 7, i % 3 === 0 ? '含,逗号' : '普通', i % 5 === 0 ? '带"引号"' : '-', i, '备注'])
  bench('csv_export', '20000 行 × 8 列', () => acc.csvExport(header, rows20000).length, () => jsBuildCsvText(header, rows20000).length, 5)
}

console.log(failed === 0 ? '\n对账全部通过' : '\n有 ' + failed + ' 条不一致')
process.exit(failed === 0 ? 0 : 1)
