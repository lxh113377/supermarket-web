// 原生动作的**端到端**对账：现网响应 → 反推 D1 行 → mock D1 → 真边缘链路 → 与现网逐字段比。
//
// ## 为什么要有这个（上一轮的 UNVERIFIED 缺口）
//
// 上一轮只说清了「键集/键序一致」，因为本机没有 D1 凭据 ⇒ 值级对账验不了。这个脚本把
// **除 D1 自身的 SQL 执行之外**的一切都验真：
//   · Rust 侧发的 SQL 是不是那三条（mock 只认逐字归一化后相等的 SQL，不认就 400）；
//   · HTTP 往返、Bearer、result[0].results 抽取；
//   · 行 → JSON 映射（用**现网响应反推出来的行**喂进去，输出必须与现网逐字段相同）；
//   · 封套 code、状态码、CORS、x-edge 标记、以及 60s 微缓存的第二次命中。
//
// 反推的两处**不可观测**（照实写进读数）：
//   1. catalogOrders 只公开 {order, needsLocalImage}，image 的真值不可见 ⇒ 反推用
//      needsLocalImage ? '' : 'x.webp'（只保证「是否依赖本地图」这个可见事实一致）；
//   2. D1 里 JSON 列存的是文本还是已解析值不可见 ⇒ 反推按**文本**给（更严：走 jparse 解析路径），
//      并另跑一轮「已解析值」形态（另一个用例，见 --parsed）。
//
// 用法：node rust/scripts/check-api-native-e2e.mjs [--live https://supermarket-web.pages.dev]
//        [--edge-port 5198] [--mock-port 5199] [--json out.json]

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const repoRoot = path.resolve(rustRoot, '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const live = argOf('--live', 'https://supermarket-web.pages.dev')
const edgePort = Number(argOf('--edge-port', '5198'))
const mockPort = Number(argOf('--mock-port', '5199'))
const jsonOut = argOf('--json', path.join(rustRoot, 'docs', 'api-native-e2e.json'))
const token = 'mock-token'
const parsedMode = args.includes('--parsed')

// ── SQL 从 Rust 源码读（确保 mock 认的就是 Rust 真正会发的语句）──
const src = readFileSync(path.join(rustRoot, 'crates', 'edge', 'src', 'api_native.rs'), 'utf8')
const sqlOf = (name) => {
  const m = src.match(new RegExp('pub const ' + name + ': &str = r#"([\\s\\S]*?)"#'))
  if (!m) throw new Error('读不到 ' + name)
  return m[1]
}
const SQL = {
  products: sqlOf('SQL_PUBLIC_PRODUCTS'),
  categories: sqlOf('SQL_PUBLIC_CATEGORIES'),
  catalogOrders: sqlOf('SQL_CATALOG_ORDERS'),
}

const postPub = async (base, action) => {
  const res = await fetch(base + '/pub', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload: {} }),
  })
  return { status: res.status, edge: res.headers.get('x-edge'), edgeCache: res.headers.get('x-edge-cache'), json: await res.json() }
}

const ACTIONS = [
  { name: 'getPublicProducts', sql: SQL.products, map: 'products' },
  { name: 'getPublicCategories', sql: SQL.categories, map: 'categories' },
  { name: 'getCatalogOrders', sql: SQL.catalogOrders, map: 'catalogOrders' },
]

// ── ① 取现网响应（真值面）──
console.log('取现网 ' + live + ' …')
const liveOut = {}
for (const a of ACTIONS) {
  const r = await postPub(live, a.name)
  if (r.status !== 200 || !Array.isArray(r.json.data)) throw new Error(a.name + ' 现网取不到（status=' + r.status + '）')
  liveOut[a.name] = r.json
  console.log('  ' + a.name + '：' + r.json.data.length + ' 件')
}

// ── ② 反推 D1 行（只覆盖 SQL 真正 SELECT 的列，且模拟 D1 的存储形态）──
const asText = (v) => (parsedMode ? v : JSON.stringify(v))       // JSON 列：文本 / 已解析 两种形态
const toRow = {
  products: (p) => ({
    _id: p._id, name: p.name, spec: p.spec && p.spec.length ? p.spec : null,
    price: p.price, image: p.image && p.image.length ? p.image : null,
    order: p.order, subcategories: asText(p.subcategories), enabled: p.enabled ? 1 : 0,
    description: p.description && p.description.length ? p.description : null,
    stock: p.stock, specOptions: asText(p.specOptions),
  }),
  categories: (c) => ({ _id: c._id, name: c.name, type: c.type && c.type.length ? c.type : null, order: c.order, subcategories: asText(c.subcategories) }),
  catalogOrders: (o) => ({ order: o.order, image: o.needsLocalImage ? '' : 'x.webp' }),
}
const rows = {
  products: liveOut.getPublicProducts.data.map(toRow.products),
  categories: liveOut.getPublicCategories.data.map(toRow.categories),
  catalogOrders: liveOut.getCatalogOrders.data.map(toRow.catalogOrders),
}
// 额外塞两条重复 + 一条非法 order：**输出仍须与现网相同**（去重/id 过滤的活证据；
// 现网面已去重，若 Rust 侧漏了去重，这两条就会让结果多出来 ⇒ 差异暴露）
rows.catalogOrders.push({ order: rows.catalogOrders[0].order, image: 'dup.webp' })
rows.catalogOrders.push({ order: 0, image: '' })
rows.catalogOrders.push({ order: -5, image: '' })

const rowsFile = path.join(rustRoot, '.cache', 'mock-d1-rows' + (parsedMode ? '-parsed' : '') + '.json')
writeFileSync(rowsFile, JSON.stringify({
  [SQL.products]: rows.products,
  [SQL.categories]: rows.categories,
  [SQL.catalogOrders]: rows.catalogOrders,
}, null, 1) + '\n')

// ── ③ 起 mock D1 + 真边缘 ──
const mock = spawn(process.execPath, [path.join(here, 'mock-d1-server.mjs'), '--rows', rowsFile, '--port', String(mockPort), '--token', token], { stdio: ['ignore', 'pipe', 'pipe'] })
mock.stderr.on('data', (d) => process.stderr.write('[mock-d1] ' + d))
await new Promise((r) => setTimeout(r, 600))

const bin = path.join(rustRoot, 'target', 'release', 'supermarket-edge' + (process.platform === 'win32' ? '.exe' : ''))
if (!existsSync(bin)) { console.error('缺边缘二进制 ' + bin + '（先 cargo build -p supermarket-edge --release）'); mock.kill(); process.exit(2) }
// 边缘是可执行文件的子命令形态：必须走 `serve`（第一版漏了它，二进制直接打帮助并退出）
const edge = spawn(bin, ['serve', '--dist', path.join(repoRoot, 'dist'), '--port', String(edgePort)], {
  env: {
    ...process.env,
    NATIVE_PUBLIC_ACTIONS: 'all',
    D1_ACCOUNT_ID: 'mock-account',
    D1_DATABASE_ID: 'mock-db',
    D1_API_TOKEN: token,
    D1_API_BASE: 'http://127.0.0.1:' + mockPort,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
edge.stderr.on('data', (d) => process.stderr.write('[edge] ' + d))

const base = 'http://127.0.0.1:' + edgePort
let healthy = false
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(base + '/_health'); if (r.ok) { healthy = true; break } } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!healthy) { console.error('边缘没起来（' + base + '/_health 不可达）'); edge.kill(); mock.kill(); process.exit(2) }

// ── ④ 逐动作对比 ──
const problems = []
const report = { at: new Date().toISOString(), live, edge: base, mode: parsedMode ? 'JSON 列=已解析' : 'JSON 列=文本', actions: {}, rowsFed: { products: rows.products.length, categories: rows.categories.length, catalogOrders: rows.catalogOrders.length } }
for (const a of ACTIONS) {
  const first = await postPub(base, a.name)
  const second = await postPub(base, a.name)      // 第二发：验微缓存命中
  const entry = { status: first.status, edge: first.edge, cacheFirst: first.edgeCache, cacheSecond: second.edgeCache, liveLength: liveOut[a.name].data.length, edgeLength: first.json.data ? first.json.data.length : -1, equal: false }
  if (first.edge !== 'native') problems.push(a.name + '：x-edge=' + first.edge + '（不是原生分支；说明回落了透传 —— 而本机没配 FUNCTIONS_ORIGIN，回落即失败）')
  if (first.status !== 200 || first.json.code !== 0) problems.push(a.name + '：状态/封套不对 status=' + first.status + ' code=' + first.json.code)
  const want = JSON.stringify(liveOut[a.name].data)
  const got = JSON.stringify(first.json.data)
  entry.equal = want === got
  if (!entry.equal) {
    problems.push(a.name + '：**数据与现网不同**（现网 ' + liveOut[a.name].data.length + ' 件 / 边缘 ' + (first.json.data ? first.json.data.length : -1) + ' 件）')
    // 给出首个差异字段，省得下次靠肉眼找
    const A = liveOut[a.name].data
    const B = first.json.data || []
    for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
      if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) {
        entry.firstDiff = { index: i, live: A[i], edge: B[i] }
        break
      }
    }
  }
  if (second.edgeCache !== 'hit') problems.push(a.name + '：第二发没命中微缓存（x-edge-cache=' + second.edgeCache + '）')
  report.actions[a.name] = entry
  console.log(a.name + '：原生=' + (first.edge === 'native') + '｜与现网逐字段相同=' + entry.equal + '｜第二发缓存=' + second.edgeCache + '｜件数 ' + entry.liveLength + '/' + entry.edgeLength)
}

writeFileSync(jsonOut, JSON.stringify({ ...report, problems }, null, 2) + '\n')
console.log('原始读数 ' + jsonOut)
console.log(problems.length ? '\nGATE-FAIL check-api-native-e2e：' + problems.length + ' 项\n  - ' + problems.join('\n  - ') : '\nGATE-PASS check-api-native-e2e：三个动作的原生响应与现网**逐字段相同**（含键序），且第二发命中微缓存')

edge.kill()
mock.kill()
process.exit(problems.length ? 1 : 0)
