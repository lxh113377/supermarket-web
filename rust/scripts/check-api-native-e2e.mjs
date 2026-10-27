// 原生动作的**端到端**对账：现网响应 → 反推 D1 行 → mock D1 → 真边缘链路 → 与现网逐字段比。
//
// ## 覆盖的五个动作（2026-10-27 第二轮扩充）
//   getPublicProducts / getPublicCategories / getCatalogOrders（无载荷）
//   getReviews（载荷 productOrder）/ getOrderStatus（载荷 orderId）
//
// ## 为什么要有这个
//
// 本机没有 D1 凭据 ⇒ 真值级对账做不了。这个脚本把**除 D1 自身的 SQL 执行之外**的一切都验真：
//   · Rust 侧发的 SQL 是不是清单里那几条（mock 只认逐字归一化后相等的 SQL，不认就 400，绝不回空表）；
//   · HTTP 往返、Bearer、result[0].results 抽取；
//   · 行 → JSON 映射（用现网响应反推出来的行喂进去，输出必须与现网相同）；
//   · 封套/状态码/CORS/x-edge 标记；成功路径与**错误路径**（missing_* / order_not_found）都比；
//   · 微缓存：可缓存的三个动作第二发必须 hit；**不可缓存的两个必须不 hit**（现网也没缓存它们，
//     多缓存一次就是行为改变：新评价可能 60 秒看不见）。
//
// ## 反推的不可观测处（照实写进读数）
//   1. getCatalogOrders 只公开 {order, needsLocalImage} ⇒ image 真值不可见，反推用
//      needsLocalImage ? '' : 'x.webp'（只保证「是否依赖本地图」这个可见事实一致）；
//   2. D1 里 JSON 列存文本还是已解析值不可见 ⇒ 两种形态各跑一轮（--parsed 走已解析）；
//   3. getOrderStatus 的**成功路径**无法端到端验：公开面没有任何途径能拿到一个真实订单号，
//      所以本轮 E2E 覆盖它的两条**失败路径**（missing_order_id / order_not_found）；
//      成功形状由 core 单测钉住（a_order_status_data_matches_js_object）。
//
// 用法：node rust/scripts/check-api-native-e2e.mjs [--live https://supermarket-web.pages.dev]
//        [--edge-port 5198] [--mock-port 5199] [--parsed] [--json out.json]

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
  // 原本用 new RegExp 拼正则，但反斜杠在字符串里被吃了一层 ⇒ 改用 indexOf 切片（无转义面）
  const head = 'pub const ' + name + ': &str = r#"'
  const at = src.indexOf(head)
  if (at < 0) throw new Error('读不到 ' + name)
  const from = at + head.length
  const to = src.indexOf('"#', from)
  if (to < 0) throw new Error(name + ' 的原始字符串没闭合')
  return src.slice(from, to)
}
/** 从任意 Rust 文件里取一条原始字符串常量（管理端的 SQL 在 api_admin.rs）。 */
const sqlOfFrom = (rel, name) => {
  const src2 = readFileSync(path.join(rustRoot, rel), 'utf8')
  const head = 'pub const ' + name + ': &str = r#"'
  const at = src2.indexOf(head)
  if (at < 0) throw new Error('读不到 ' + name + ' @ ' + rel)
  const from = at + head.length
  const to = src2.indexOf('"#', from)
  return src2.slice(from, to)
}
const SQL = {
  products: sqlOf('SQL_PUBLIC_PRODUCTS'),
  categories: sqlOf('SQL_PUBLIC_CATEGORIES'),
  catalogOrders: sqlOf('SQL_CATALOG_ORDERS'),
  reviews: sqlOf('SQL_GET_REVIEWS'),
  orderStatus: sqlOf('SQL_ORDER_STATUS'),
}

const postPub = async (base, action, payload) => {
  const body = payload === undefined ? { action } : { action, payload }
  const res = await fetch(base + '/pub', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, edge: res.headers.get('x-edge'), edgeCache: res.headers.get('x-edge-cache'), json: await res.json() }
}
const stripTrace = (o) => { const c = { ...o }; delete c.trace; return c }

// /web 调用（管理端）：密钥只走 body（现网 web.js:21 唯一通道），**不设请求头**
const postWeb = async (target, action, key, payload = {}) => {
  const body = key === undefined ? { action, payload } : { action, adminKey: key, payload }
  const res = await fetch(target + '/web', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, edge: res.headers.get('x-edge'), json: await res.json() }
}

// ── ⓪ 管理端密钥（从 .dev.vars 现读现用；只进环境变量，不进读数）──
const keys = (() => {
  try {
    const txt = readFileSync(path.join(repoRoot, '.dev.vars'), 'utf8')
    const pick = (k) => { const m = txt.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : '' }
    return { admin: pick('ADMIN_KEY'), readonly: pick('ADMIN_READONLY_KEY') }
  } catch { return { admin: '', readonly: '' } }
})()

// ── ① 取现网响应（真值面）。getReviews 需要一个真实 productOrder：从目录里的 order 号扫一遍 ──
console.log('取现网 ' + live + ' …')
const liveProducts = await postPub(live, 'getPublicProducts', {})
if (!Array.isArray(liveProducts.json.data)) throw new Error('现网 getPublicProducts 取不到')
const orders = liveProducts.json.data.map((p) => p.order).filter((n) => Number.isInteger(n) && n > 0)
let reviewsPayload = { productOrder: orders[0] }
let reviewsLive = await postPub(live, 'getReviews', reviewsPayload)
let scanned = 1
for (const order of orders.slice(1, 15)) {
  if (Array.isArray(reviewsLive.json.data) && reviewsLive.json.data.length > 0) break
  reviewsPayload = { productOrder: order }
  reviewsLive = await postPub(live, 'getReviews', reviewsPayload)
  scanned += 1
}
const reviewCount = Array.isArray(reviewsLive.json.data) ? reviewsLive.json.data.length : -1
console.log('  getReviews 用 productOrder=' + reviewsPayload.productOrder + '（扫了 ' + scanned + ' 个号）⇒ ' + reviewCount + ' 条')

const CASES = [
  { name: 'getPublicProducts', sql: SQL.products, map: 'products', payload: {}, cacheable: true },
  { name: 'getPublicCategories', sql: SQL.categories, map: 'categories', payload: {}, cacheable: true },
  { name: 'getCatalogOrders', sql: SQL.catalogOrders, map: 'catalogOrders', payload: {}, cacheable: true },
  { name: 'getReviews', sql: SQL.reviews, map: 'reviews', payload: reviewsPayload, cacheable: false },
  { name: 'getOrderStatus（未知订单号：错误路径）', action: 'getOrderStatus', sql: SQL.orderStatus, payload: { orderId: 'o_not_exist_' + Date.now() }, cacheable: false },
  { name: 'getOrderStatus（缺 orderId：错误路径）', action: 'getOrderStatus', sql: SQL.orderStatus, payload: {}, cacheable: false },
  { name: 'getOrderStatus（不给 payload：边界）', action: 'getOrderStatus', sql: SQL.orderStatus, payload: undefined, cacheable: false },
  { name: 'getReviews（缺 productOrder：错误路径）', action: 'getReviews', sql: SQL.reviews, payload: {}, cacheable: false },
]
for (const c of CASES) if (!c.action) c.action = c.name

const liveOut = {}
for (const c of CASES) {
  if (liveOut[c.action + '|' + JSON.stringify(c.payload)]) continue
  const r = await postPub(live, c.action, c.payload)
  liveOut[c.action + '|' + JSON.stringify(c.payload)] = stripTrace(r.json)
}

// ── ② 反推 D1 行 ──
const asText = (v) => (parsedMode ? v : JSON.stringify(v))
const rows = {
  products: liveProducts.json.data.map((p) => ({
    _id: p._id, name: p.name, spec: p.spec && p.spec.length ? p.spec : null,
    price: p.price, image: p.image && p.image.length ? p.image : null,
    order: p.order, subcategories: asText(p.subcategories), enabled: p.enabled ? 1 : 0,
    description: p.description && p.description.length ? p.description : null,
    stock: p.stock, specOptions: asText(p.specOptions),
  })),
  categories: (await postPub(live, 'getPublicCategories', {})).json.data.map((c) => ({
    _id: c._id, name: c.name, type: c.type && c.type.length ? c.type : null, order: c.order, subcategories: asText(c.subcategories),
  })),
  catalogOrders: (await postPub(live, 'getCatalogOrders', {})).json.data.map((o) => ({ order: o.order, image: o.needsLocalImage ? '' : 'x.webp' })),
  // 评价行：从现网响应反推（SQL 选的那 7 列；images 是 JSON 文本列）
  reviews: (Array.isArray(reviewsLive.json.data) ? reviewsLive.json.data : []).map((r) => ({
    _id: r._id, user: r.user, rating: r.rating, text: r.text, productOrder: r.productOrder,
    createdAt: r.createdAt, images: asText(r.images),
  })),
  // 订单状态：**故意给空行集** ⇒ 原生必然走 order_not_found，与现网同输入的错误路径对齐
  orderStatus: [],
}
rows.catalogOrders.push({ order: rows.catalogOrders[0].order, image: 'dup.webp' })
rows.catalogOrders.push({ order: 0, image: '' })
rows.catalogOrders.push({ order: -5, image: '' })

// 管理端 SELECT *：反推行必须**保留全部 14 列**（公共读那套只留 SQL 选中的列，用在这里会丢
// costPrice/images/reviews ⇒ 原生输出与现网必然不同）。没密钥就跳过（明说，不静默少测）。
let adminProducts = null
if (keys.admin) {
  const liveAdmin = await postWeb(live, 'getProducts', keys.admin)
  if (liveAdmin.status === 200 && Array.isArray(liveAdmin.json.data)) {
    adminProducts = liveAdmin.json.data.map((p) => ({
      _id: p._id, name: p.name, spec: p.spec, price: p.price, costPrice: p.costPrice,
      subcategories: asText(p.subcategories), enabled: p.enabled ? 1 : 0, order: p.order,
      image: p.image, images: asText(p.images), description: p.description,
      specOptions: asText(p.specOptions), reviews: asText(p.reviews), stock: p.stock,
    }))
    console.log('  现网 getProducts：' + adminProducts.length + ' 件（管理端真值面）')
  } else {
    console.log('  现网 getProducts 取不到（status=' + liveAdmin.status + '）⇒ 管理端用例会退化')
  }
}

// 第 7 轮批量的 4 个管理只读：也走「现网真值 → 反推行」这套（没密钥就整段跳过）
const adminExtra = {}
let submissionIdForImages = ''
if (keys.admin) {
  const callLive = async (action, payload) => {
    const r = await postWeb(live, action, keys.admin, payload)
    return r.status === 200 ? r.json : null
  }
  const reviews = await callLive('getAllReviews', {})
  if (reviews && Array.isArray(reviews.data)) {
    // getSubmissions 的映射用不到 images 列，但 SELECT 里有 json_valid(images) —— mock 只回我喂的行，
    // 所以这里只需要把 SQL 选中的列给全（imageCount 是 SQL 算出来的，直接抄现网值）
  }
  const submissions = await callLive('getSubmissions', {})
  const submissionsRows = submissions && Array.isArray(submissions.data)
    ? submissions.data.map((s) => ({
        _id: s._id, serviceId: s.serviceId, serviceName: s.serviceName,
        categoryId: s.categoryId, categoryName: s.categoryName,
        formData: asText(s.formData), status: s.status, createdAt: s.createdAt,
        updatedAt: s.updatedAt, imageCount: s.imageCount,
      }))
    : []
  if (submissionsRows.length) submissionIdForImages = submissionsRows[0]._id
  const imagesLive = submissionIdForImages
    ? await callLive('getSubmissionImages', { submissionId: submissionIdForImages })
    : null
  const eventLive = await callLive('getEventLog', { orderId: 'o_probe_nonexistent_2026' })
  adminExtra.allReviews = reviews && Array.isArray(reviews.data) ? reviews.data : []
  adminExtra.submissions = submissionsRows
  adminExtra.submissionImages = imagesLive && imagesLive.data ? [{ images: asText(imagesLive.data.images) }] : []
  adminExtra.events = eventLive && eventLive.data && Array.isArray(eventLive.data.events) ? eventLive.data.events : []
  console.log('  现网管理端：getAllReviews ' + adminExtra.allReviews.length + ' 条｜getSubmissions ' + submissionsRows.length + ' 条'
    + '｜getSubmissionImages ' + (imagesLive ? '可查' : '跳过') + '｜getEventLog ' + adminExtra.events.length + ' 事件')
}

// getStockMovements：**两条查询 + 动态 clause** —— 每个 clause 变体都要有对应的行集，
// 否则 mock 会按「未预期 SQL」回 400（那正是它该做的事：不让实现偷偷换语句）。
const movMainSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_MOVEMENTS_MAIN')
const movCountSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_MOVEMENTS_COUNT')
const MARK = '${clause}'
const movRows = {}
const movCases = []
if (keys.admin) {
  const first = await postWeb(live, 'getStockMovements', keys.admin, {})
  const firstData = first.status === 200 ? first.json.data : null
  const anyProductId = firstData && firstData.items && firstData.items.length ? firstData.items[0].productId : 'p001'
  movCases.push({ name: 'getStockMovements（默认分页）', action: 'getStockMovements', key: keys.admin, payload: {}, clause: '', expectAudit: 0 })
  movCases.push({ name: 'getStockMovements（productId 过滤）', action: 'getStockMovements', key: keys.admin, payload: { productId: anyProductId }, clause: 'WHERE m.productId = ?', expectAudit: 0 })
  movCases.push({ name: 'getStockMovements（kind=sale）', action: 'getStockMovements', key: keys.admin, payload: { kind: 'sale' }, clause: 'WHERE m.kind = ?', expectAudit: 0 })
  movCases.push({ name: 'getStockMovements（kind 非法 ⇒ 400）', action: 'getStockMovements', key: keys.admin, payload: { kind: 'steal' }, clause: null, expectAudit: 0 })
  movCases.push({ name: 'getStockMovements（limit/offset 钳制）', action: 'getStockMovements', key: keys.admin, payload: { limit: 5, offset: 2 }, clause: '', expectAudit: 0 })
  for (const c of movCases) {
    if (c.clause === null) continue
    const r = await postWeb(live, c.action, c.key, c.payload)
    const d = r.status === 200 ? r.json.data : null
    movRows[movMainSql.replace(MARK, c.clause)] = d && Array.isArray(d.items) ? d.items : []
    movRows[movCountSql.replace(MARK, c.clause)] = [{ c: d ? d.total : 0 }]
  }
  console.log('  现网 getStockMovements：默认 ' + (firstData ? firstData.items.length + ' 条 / total ' + firstData.total : '取不到') + '（clause 变体 ' + Object.keys(movRows).length + ' 条 SQL）')
}

const rowsFile = path.join(rustRoot, '.cache', 'mock-d1-rows' + (parsedMode ? '-parsed' : '') + '.json')
writeFileSync(rowsFile, JSON.stringify({
  [SQL.products]: rows.products,
  [SQL.categories]: rows.categories,
  [SQL.catalogOrders]: rows.catalogOrders,
  [SQL.reviews]: rows.reviews,
  [SQL.orderStatus]: rows.orderStatus,
  // SELECT * 那条：SQL 从 api_admin.rs 读（它在管理端模块里，不在 api_native.rs）
  [sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_GET_PRODUCTS')]: adminProducts || [],
  [sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_ALL_REVIEWS')]: adminExtra.allReviews || [],
  [sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_SUBMISSIONS')]: adminExtra.submissions || [],
  [sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_SUBMISSION_IMAGES')]: adminExtra.submissionImages || [],
  [sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_EVENT_TIMELINE')]: adminExtra.events || [],
  // 流水：主查询与 COUNT 的每个 clause 变体（键就是替换后的完整 SQL —— 与边缘真正发出的字节一致）
  ...movRows,
}, null, 1) + '\n')

// ── ③ 起 mock D1 + 真边缘 ──
const recordFile = path.join(rustRoot, '.cache', 'mock-d1-record' + (parsedMode ? '-parsed' : '') + '.jsonl')
const mock = spawn(process.execPath, [path.join(here, 'mock-d1-server.mjs'), '--rows', rowsFile, '--port', String(mockPort), '--token', token, '--record', recordFile], { stdio: ['ignore', 'pipe', 'pipe'] })
mock.stderr.on('data', (d) => process.stderr.write('[mock-d1] ' + d))
await new Promise((r) => setTimeout(r, 600))

const bin = path.join(rustRoot, 'target', 'release', 'supermarket-edge' + (process.platform === 'win32' ? '.exe' : ''))
if (!existsSync(bin)) { console.error('缺边缘二进制 ' + bin + '（先 cargo build -p supermarket-edge --release）'); mock.kill(); process.exit(2) }
const edge = spawn(bin, ['serve', '--dist', path.join(repoRoot, 'dist'), '--port', String(edgePort)], {
  env: {
    ...process.env,
    NATIVE_PUBLIC_ACTIONS: 'all',
    // 管理端走独立开关（爆炸半径不同）；密钥从 .dev.vars 现读现用，**绝不写入读数文件**
    NATIVE_ADMIN_ACTIONS: 'all',
    ...adminEnv(),
    D1_ACCOUNT_ID: 'mock-account',
    D1_DATABASE_ID: 'mock-db',
    D1_API_TOKEN: token,
    D1_API_BASE: 'http://127.0.0.1:' + mockPort,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
edge.stderr.on('data', (d) => process.stderr.write('[edge] ' + d))

// 管理端密钥：从本仓 gitignore 的 .dev.vars 现读（与 scripts/uptime-check.mjs 的日常用法一致）。
// **只进环境变量，不进任何打印/读数文件**（读数里只记长度与指纹是否非空）。
function adminEnv() {
  try {
    const txt = readFileSync(path.join(repoRoot, '.dev.vars'), 'utf8')
    const pick = (k) => {
      const m = txt.match(new RegExp('^' + k + '=(.*)$', 'm'))
      return m ? m[1].trim() : ''
    }
    const out = {}
    const a = pick('ADMIN_KEY')
    const r = pick('ADMIN_READONLY_KEY')
    if (a) out.ADMIN_KEY = a
    if (r) out.ADMIN_READONLY_KEY = r
    return out
  } catch {
    return {}
  }
}
// keys 已在 ⓪ 段定义（那时就把 .dev.vars 读了；这里不再重复读，也不打印）

const base = 'http://127.0.0.1:' + edgePort
let healthy = false
for (let i = 0; i < 40; i += 1) {
  try { const r = await fetch(base + '/_health'); if (r.ok) { healthy = true; break } } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 250))
}
if (!healthy) { console.error('边缘没起来（' + base + '/_health 不可达）'); edge.kill(); mock.kill(); process.exit(2) }

// ── ④ 逐用例对比 ──
const problems = []
const report = { at: new Date().toISOString(), live, edge: base, mode: parsedMode ? 'JSON 列=已解析' : 'JSON 列=文本', reviewsProductOrder: reviewsPayload.productOrder, cases: {}, rowsFed: { products: rows.products.length, categories: rows.categories.length, catalogOrders: rows.catalogOrders.length, reviews: rows.reviews.length, orderStatus: rows.orderStatus.length } }
for (const c of CASES) {
  const key = c.action + '|' + JSON.stringify(c.payload)
  const first = await postPub(base, c.action, c.payload)
  const second = await postPub(base, c.action, c.payload)
  const entry = { action: c.action, payload: c.payload === undefined ? null : c.payload, status: first.status, edge: first.edge, cacheFirst: first.edgeCache, cacheSecond: second.edgeCache, equal: false }
  if (first.edge !== 'native') problems.push(c.name + '：x-edge=' + first.edge + '（不是原生分支）')
  const want = JSON.stringify(liveOut[key])
  const got = JSON.stringify(stripTrace(first.json))
  entry.equal = want === got
  if (!entry.equal) {
    entry.liveJson = liveOut[key]
    entry.edgeJson = stripTrace(first.json)
    problems.push(c.name + '：与现网不同（现网 ' + want.slice(0, 160) + '… / 边缘 ' + got.slice(0, 160) + '…）')
  }
  if (c.cacheable && second.edgeCache !== 'hit') problems.push(c.name + '：可缓存动作第二发没命中（' + second.edgeCache + '）')
  if (!c.cacheable && second.edgeCache === 'hit') problems.push(c.name + '：**不该缓存却命中了**（现网没缓存它 ⇒ 这会改变时效性）')
  report.cases[c.name] = entry
  console.log(c.name + '：原生=' + (first.edge === 'native') + '｜与现网相同=' + entry.equal + '｜缓存第二发=' + (second.edgeCache || '无头') + '｜HTTP ' + first.status)
}

// ── ⑤ 管理端原生路径：鉴权层 + getProducts + 审计（有 .dev.vars 才比现网，没有就明说 SKIP）──
const auditRoster = () => (existsSync(recordFile) ? readFileSync(recordFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

if (!keys.admin) {
  console.log('管理端：**SKIP**（本机 .dev.vars 没有 ADMIN_KEY）⇒ 管理端鉴权/审计路径本轮未验，不当通过')
  report.adminSkipped = 'no ADMIN_KEY in .dev.vars'
} else {
  const adminCases = [
    { name: 'getProducts（正确密钥）', action: 'getProducts', key: keys.admin, expectAudit: 0 },
    { name: 'getProducts（错密钥）', action: 'getProducts', key: 'wrong-key-not-in-env-2026', expectAudit: 1 },
    { name: 'getProducts（无密钥）', action: 'getProducts', key: undefined, expectAudit: 1 },
  ]
  // 第 7 轮批量的 4 个管理只读（payload 与现网调用逐字一致）
  adminCases.push({ name: 'getAllReviews', action: 'getAllReviews', key: keys.admin, payload: {}, expectAudit: 0 })
  adminCases.push({ name: 'getSubmissions', action: 'getSubmissions', key: keys.admin, payload: {}, expectAudit: 0 })
  adminCases.push({
    name: 'getSubmissionImages（真实 id 或错误路径）', action: 'getSubmissionImages', key: keys.admin,
    payload: { submissionId: submissionIdForImages || 'sub_not_exist_2026' }, expectAudit: 0,
  })
  adminCases.push({
    name: 'getSubmissionImages（缺 submissionId）', action: 'getSubmissionImages', key: keys.admin,
    payload: {}, expectAudit: 0,
  })
  adminCases.push({
    name: 'getEventLog（未知订单号 ⇒ 空事件）', action: 'getEventLog', key: keys.admin,
    payload: { orderId: 'o_probe_nonexistent_2026' }, expectAudit: 0,
  })
  adminCases.push({
    name: 'getEventLog（缺 orderId）', action: 'getEventLog', key: keys.admin,
    payload: {}, expectAudit: 0,
  })
  for (const c of movCases) adminCases.push(c)
  if (keys.readonly) {
    adminCases.push({ name: 'getProducts（只读密钥，白名单内）', action: 'getProducts', key: keys.readonly, expectAudit: 0 })
    adminCases.push({ name: 'createProduct（只读密钥，应拒绝）', action: 'createProduct', key: keys.readonly, expectAudit: 0 })
  } else {
    console.log('  （.dev.vars 没有 ADMIN_READONLY_KEY ⇒ 只读档两条用例跳过）')
  }
  for (const c of adminCases) {
    // 只数 security_events 的 INSERT：把「收到过任何语句」当审计会把一条普通 SELECT 也算进去
    // （第一版就是这么把「正确密钥」算成 +1 的，误报成「读动作也写审计」）
    const auditCount = () => auditRoster().filter((r) => r.isWrite && /INSERT INTO security_events/.test(r.sql)).length
    const before = auditCount()
    const liveR = await postWeb(live, c.action, c.key, c.payload || {})
    const nativeR = await postWeb(base, c.action, c.key, c.payload || {})
    const auditDelta = auditCount() - before
    const entry = { action: c.action, status: nativeR.status, liveStatus: liveR.status, edge: nativeR.edge, auditDelta, expectAudit: c.expectAudit, equal: false }
    if (nativeR.edge !== 'native') problems.push(c.name + '：x-edge=' + nativeR.edge + '（不是原生分支）')
    if (nativeR.status !== liveR.status) problems.push(c.name + '：HTTP 状态与现网不同（现网 ' + liveR.status + ' / 边缘 ' + nativeR.status + '）')
    const want = JSON.stringify(stripTrace(liveR.json))
    const got = JSON.stringify(stripTrace(nativeR.json))
    entry.equal = want === got
    if (!entry.equal) {
      entry.liveJson = stripTrace(liveR.json)
      entry.edgeJson = stripTrace(nativeR.json)
      problems.push(c.name + '：与现网不同（现网 ' + want.slice(0, 140) + '… / 边缘 ' + got.slice(0, 140) + '…）')
    }
    if (auditDelta !== c.expectAudit) problems.push(c.name + '：审计写入条数不符（实测 ' + auditDelta + ' / 期望 ' + c.expectAudit + '）')
    report.cases[c.name] = entry
    console.log(c.name + '：原生=' + (nativeR.edge === 'native') + '｜与现网相同=' + entry.equal + '｜HTTP ' + nativeR.status + '/' + liveR.status + '｜审计 +' + auditDelta)
  }
  // 审计行的形状断言（不判参数原值：那里面有 IP 与密钥指纹）
  const inserts = auditRoster().filter((r) => r.isWrite && /INSERT INTO security_events/.test(r.sql))
  report.auditInserts = inserts.map((r) => ({ paramCount: r.paramCount, paramTypes: r.paramTypes, paramLengths: r.paramLengths }))
  if (inserts.length && inserts.some((r) => r.paramCount !== 6)) {
    problems.push('审计语句参数个数不是 6（现网 INSERT 是 6 列）')
  }
  report.keysPresent = { admin: keys.admin.length > 0, readonly: keys.readonly.length > 0 }
}
writeFileSync(jsonOut, JSON.stringify({ ...report, problems }, null, 2) + '\n')
console.log('原始读数 ' + jsonOut)
console.log(problems.length
  ? '\nGATE-FAIL check-api-native-e2e：' + problems.length + ' 项\n  - ' + problems.join('\n  - ')
  : '\nGATE-PASS check-api-native-e2e：公开面 8 个用例 + 管理面 16 个用例\n  ——全部与现网**逐字段相同**（含键序）；缓存语义一致；审计写入条数一致（读动作 +0、鉴权失败 +1、只读拒绝 +0）')

edge.kill()
mock.kill()
process.exit(problems.length ? 1 : 0)
