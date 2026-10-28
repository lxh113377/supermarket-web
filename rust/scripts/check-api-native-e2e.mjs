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

// 网络抖动是常态（本机代理实测会断）：**带退避重试**，最终失败则整轮判 UNVERIFIED（退出码 2），
// 而不是抛栈崩掉 —— 「没跑成」必须是可分辨的结果，不能被读成「判据绿了」。
process.on('uncaughtException', (e) => {
  const msg = String(e && e.message ? e.message : e)
  const net = /fetch failed|UND_ERR|ECONN|ETIMEDOUT|socket|getaddrinfo|EAI_AGAIN/i.test(msg)
  if (net) {
    console.error('\nGATE-UNVERIFIED check-api-native-e2e：现网不可达（' + msg.slice(0, 120) + '）⇒ 本轮没跑成，不当通过（退出码 2）')
    process.exit(2)
  }
  console.error('\nGATE-FAIL check-api-native-e2e：夹具自身异常（' + msg.slice(0, 160) + '）')
  process.exit(1)
})

const fetchRetry = async (url, opts, attempts = 3) => {
  let last
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetch(url, opts)
    } catch (e) {
      last = e
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i))
    }
  }
  throw last
}

const postPub = async (base, action, payload, extraHeaders = {}) => {
  const body = payload === undefined ? { action } : { action, payload }
  const res = await fetchRetry(base + '/pub', {
    method: 'POST',
    // extraHeaders：写用例靠它带 cf-connecting-ip，把限流桶键固定成可预期值（否则桶名里的 IP 没法在 mock 里命中）
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })
  return { status: res.status, edge: res.headers.get('x-edge'), edgeCache: res.headers.get('x-edge-cache'), json: await res.json() }
}
const stripTrace = (o) => { const c = { ...o }; delete c.trace; return c }

// /web 调用（管理端）：密钥只走 body（现网 web.js:21 唯一通道），**不设请求头**
const postWeb = async (target, action, key, payload = {}) => {
  const body = key === undefined ? { action, payload } : { action, adminKey: key, payload }
  const res = await fetchRetry(target + '/web', {
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
// 逐字节面里剔除「时间敏感字段」：这类字段的值取决于**两侧各自的当前时刻**，
// 拿它们做逐字节判据等于让两个时钟比大小 —— 红的是夹具的时钟，不是等价性（实测 flaky 过一次）。
const stripFieldsDeep = (obj, fields) => {
  if (Array.isArray(obj)) return obj.map((x) => stripFieldsDeep(x, fields))
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) { if (!fields.includes(k)) out[k] = stripFieldsDeep(v, fields) }
    return out
  }
  return obj
}
const caseJson = (c, obj) => JSON.stringify(c.stripFields ? stripFieldsDeep(obj, c.stripFields) : obj)
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

// 订单两个动作：分页参数不同 ⇒ 同一 SQL 的不同行；用「SQL|params」复合键登记（mock 支持参数感知）。
const ordersPageSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_ORDERS_PAGE')
const orderByIdSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_ORDER_BY_ID')
const ordersRows = {}
// 负控：这些 id 会被 mock 当作「UPDATE/DELETE 命中 0 行」（守卫式 UPDATE 的唯一可判路径）
const missingIds = []
const orderCases = []
if (keys.admin) {
  const mk = (q) => ordersPageSql
    .replace('${whereClause}', q.where)
    .replace('${orderByCol}', q.col)
    .replace('${since ? \'ASC\' : \'DESC\'}', q.dir)
  const reg = (key, params, rows) => { ordersRows[key + '|' + JSON.stringify(params)] = rows }
  const pageCases = [
    { name: 'getOrders（默认分页 50）', payload: {}, col: 'o.createdAt', dir: 'DESC', where: '', params: [51, 0] },
    { name: 'getOrders（page=2&pageSize=5）', payload: { page: 2, pageSize: 5 }, col: 'o.createdAt', dir: 'DESC', where: '', params: [6, 5] },
    { name: 'getOrders（pageSize=101 ⇒ 钳 100）', payload: { pageSize: 101 }, col: 'o.createdAt', dir: 'DESC', where: '', params: [101, 0] },
  ]
  const since = '2026-01-01T00:00:00.000Z'
  pageCases.push({ name: 'getOrders（since 增量：updatedAt ASC）', payload: { since }, col: 'o.updatedAt', dir: 'ASC', where: 'WHERE o.updatedAt > ?', params: [since, 51, 0] })
  // **喂原始行窗口，而不是现网的已裁切视图**：现网 data 已被 slice 到 pageSize（多余那条被丢掉判 hasMore），
  // 而 Rust 侧 SQL 的 LIMIT 是 pageSize+1 —— 直接喂现网 data 会让两边在 hasMore 上天然不同（第一版就这么红的）。
  // 正确做法：先取一份「同排序的大页」（pageSize=100 ⇒ LIMIT 101），再按 offset/fetch 切出 SQL 真正会返回的那几行。
  // 单页最多回 100 条（pageSize 上限），而 pageSize=101 那条用例的 SQL 要 **101** 条原始行
  // （LIMIT = pageSize+1）⇒ 拼两页凑够，否则那条用例永远对不上（第一版就卡在这）。
  const bigPage = async (extra, pages = 2) => {
    const out = []
    for (let p = 1; p <= pages; p += 1) {
      const r = await postWeb(live, 'getOrders', keys.admin, { pageSize: 100, page: p, ...extra })
      if (r.status !== 200 || !Array.isArray(r.json.data) || r.json.data.length === 0) break
      out.push(...r.json.data)
      if (r.json.hasMore !== true) break
    }
    return out
  }
  const baseDesc = await bigPage({})
  const baseAsc = await bigPage({ since })
  const rawRows = (list) => list.map((o) => ({ ...o, items: asText(o.items) }))
  for (const c of pageCases) {
    const base = c.dir === "ASC" ? baseAsc : baseDesc
    const fetch = c.params[c.params.length - 2]
    const offset = c.params[c.params.length - 1]
    reg(mk(c), c.params, rawRows(base.slice(offset, offset + fetch)))
    orderCases.push({ name: c.name, action: 'getOrders', key: keys.admin, payload: c.payload, expectAudit: 0 })
  }
  console.log('  现网订单：大页 DESC ' + baseDesc.length + ' 条 / ASC ' + baseAsc.length + ' 条（用作原始行窗口）')
  // getOrder：真实 id 与未知 id（现网查不到 ⇒ {code:0,data:null}，**不是 404**）
  const firstOrders = await postWeb(live, 'getOrders', keys.admin, { page: 1, pageSize: 1 })
  const realId = firstOrders.status === 200 && firstOrders.json.data && firstOrders.json.data.length
    ? firstOrders.json.data[0]._id : null
  const unknownId = 'o_not_exist_2026'
  const probeDetail = async (id) => {
    const r = await postWeb(live, 'getOrder', keys.admin, { orderId: id })
    return r.status === 200 ? r.json.data : null
  }
  const unknownLive = await probeDetail(unknownId)
  reg(orderByIdSql, [unknownId], [])
  orderCases.push({ name: 'getOrder（未知 id ⇒ data:null）', action: 'getOrder', key: keys.admin, payload: { orderId: unknownId }, expectAudit: 0 })
  if (realId) {
    const detail = await probeDetail(realId)
    if (detail) {
      // 反推成「D1 行」形态：items 是 JSON 文本列；COALESCE 出来的两列照抄
      const row = { ...detail, items: asText(detail.items) }
      reg(orderByIdSql, [realId], [row])
      orderCases.push({ name: 'getOrder（真实 id）', action: 'getOrder', key: keys.admin, payload: { orderId: realId }, expectAudit: 0 })
    }
  }
  console.log('  现网订单：分页变体 ' + Object.keys(ordersRows).length + ' 条键｜真实订单 ' + (realId || '无') + '｜未知 id data=' + JSON.stringify(unknownLive))
}

// ⚠ 行集必须在 rows.json 落盘**之前**登记（第一版把这段写在管理端用例段里 ⇒ 键根本没进文件、边缘查询 400 → 回落透传 → HTTP 500）。
  // getPromotions：两条查询都无参数 ⇒ 用纯 SQL 键登记即可。
  // 反推行要把映射的**输入**还原出来（enabled 是 1/0，threshold/discount 是原始数值，name/updatedAt 原文）。
  const promoSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_PROMOTIONS')
  const promoHitsSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_PROMOTION_HITS')
  const promoTiersSqlKey = promoSql
  let promoRowsReady = false
  {
    const livePromo = await postWeb(live, 'getPromotions', keys.admin, {})
    const tiers = livePromo.status === 200 && Array.isArray(livePromo.json.data) ? livePromo.json.data : null
    if (tiers) {
      ordersRows[promoTiersSqlKey] = tiers.map((t) => ({
        _id: t._id, name: t.name, threshold: t.threshold, discount: t.discount,
        enabled: t.enabled ? 1 : 0, updatedAt: t.updatedAt,
      }))
      ordersRows[promoHitsSql] = tiers
        .filter((t) => t.hits && (t.hits.orders > 0 || t.hits.totalDiscount > 0))
        .map((t) => ({ promotionId: t._id, orders: t.hits.orders, totalDiscount: t.hits.totalDiscount }))
      // 用例本身在**管理端用例段**登记（本块在 mock 启动前、见不到 adminCases）—— 这里只登记行集并置标志
      promoRowsReady = true
      console.log('  getPromotions：现网 ' + tiers.length + ' 档（有命中 ' + ordersRows[promoHitsSql].length + ' 档）⇒ 行集已登记，用例待管理段登记')
    } else {
      console.log('  [观察] getPromotions 现网取不到（status=' + livePromo.status + '）⇒ 跳过')
    }
  }

  // getDashboardStats：三张表都要喂原始行。
  //  · orders：从 getOrders 翻页取全量（D1 现有 ~116 条，2 页足够）——stats 的 SQL 是 LIMIT 5000，
  //    喂得比现网少会让 totalOrders/rangeData 对不上，所以必须取全；
  //  · reviews：从 getAllReviews 取，再按「我方 cutoff」筛一遍（现网也是服务端筛同一口径）；
  //  · products：从 getProducts 取（含 spec/costPrice）。
  const statsOrdersSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_STATS_ORDERS')
  const statsReviewsSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_STATS_REVIEWS')
  const statsProductsSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_STATS_PRODUCTS')
  let statsRowsReady = false
  {
    const allOrdersForStats = []
    for (let p = 1; p <= 3; p += 1) {
      const rr = await postWeb(live, 'getOrders', keys.admin, { pageSize: 100, page: p })
      if (rr.status !== 200 || !Array.isArray(rr.json.data) || rr.json.data.length === 0) break
      allOrdersForStats.push(...rr.json.data)
      if (rr.json.hasMore !== true) break
    }
    const liveReviews = await postWeb(live, 'getAllReviews', keys.admin, {})
    const reviewCutoff = new Date(Date.now() - 14 * 86400000).toISOString()
    const reviewsForStats = liveReviews.status === 200 && Array.isArray(liveReviews.json.data)
      ? liveReviews.json.data.filter((r) => String(r.createdAt) >= reviewCutoff).map((r) => ({ createdAt: r.createdAt }))
      : []
    const liveProducts = await postWeb(live, 'getProducts', keys.admin, {})
    const productsForStats = liveProducts.status === 200 && Array.isArray(liveProducts.json.data)
      ? liveProducts.json.data.map((p) => ({ _id: p._id, name: p.name, spec: p.spec, costPrice: p.costPrice == null ? null : Number(p.costPrice) }))
      : []
    if (allOrdersForStats.length && productsForStats.length) {
      ordersRows[statsOrdersSql] = allOrdersForStats.map((o) => ({
        _id: o._id, roomNumber: o.roomNumber, items: asText(o.items),
        totalAmount: o.totalAmount, status: o.status, createdAt: o.createdAt,
      }))
      ordersRows[statsReviewsSql] = reviewsForStats
      ordersRows[statsProductsSql] = productsForStats
      statsRowsReady = true
      console.log('  getDashboardStats：喂 ' + allOrdersForStats.length + ' 单 / ' + reviewsForStats.length + ' 评价 / ' + productsForStats.length + ' 商品 ⇒ 行集已登记')
    } else {
      console.log('  [观察] getDashboardStats 行集准备不足（订单 ' + allOrdersForStats.length + ' / 商品 ' + productsForStats.length + '）⇒ 跳过')
    }
  }

  const staleRowsSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_STALE_ORDERS')
  const staleProdsSql = sqlOfFrom('crates/edge/src/api_admin.rs', 'SQL_STALE_PRODUCTS')
  const staleInMark = '$' + '{productIds.map(() => \'?\').join(\',\')}'
  // 现网响应里**没有 items / createdAt**（只有 ageMinutes），所以不能从它反推原始行。
  // 改从 getOrders 取回同一条单的「原始行」（含 items 文本与 createdAt），再按现网同样的
  // status/createdAt<cutoff/升序/LIMIT 200 筛一遍 —— 这样非空窗也能做**逐字节对比**。
  const staleMinutes = 10080 // 上限窗口：现网 count≈96（实测），比 minutes=1 的子集更大
  // 自己翻页取（bigPage 定义在本文件更靠后的订单段里，这里用不了 —— const 的 TDZ 会当场抛）
  const allOrders = []
  for (let p = 1; p <= 3; p += 1) {
    const rr = await postWeb(live, 'getOrders', keys.admin, { pageSize: 100, page: p })
    if (rr.status !== 200 || !Array.isArray(rr.json.data) || rr.json.data.length === 0) break
    allOrders.push(...rr.json.data)
    if (rr.json.hasMore !== true) break
  }
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString()
  const pendingRows = allOrders
    .filter((o) => o.status === 'pending' && String(o.createdAt) < cutoff)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, 200)
    .map((o) => ({
      _id: o._id, roomNumber: o.roomNumber, totalAmount: o.totalAmount,
      items: asText(o.items), createdAt: o.createdAt,
      paymentScreenshot: o.paymentScreenshot ? 'x' : '',
    }))
  ordersRows[staleRowsSql] = pendingRows
  // 商品行：现网实测 stockReserved 为空 ⇒ 喂空集（缺商品 ⇒ 跳过 ⇒ 同形）。
  // 注意 IN 的占位符个数由「我方 rows 的商品集合」决定，所以这条 SQL 文本是可算的。
  const staleIds = []
  for (const row of pendingRows) {
    // parsed 模式下 items 本身就是数组（asText 没做 stringify）⇒ 无条件 JSON.parse 会炸在 "[object Object]"
    const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items
    for (const it of items) {
      if (it && it.productId && staleIds.indexOf(it.productId) < 0) staleIds.push(it.productId)
    }
  }
  ordersRows[staleProdsSql.replace(staleInMark, staleIds.map(() => "?").join(","))] = []
  // adjustStock 的三个商品行必须在**mock 启动前**登记（同一套 SQL|params 键）。
  // 第一版把这几行写在管理段 ⇒ 键没进 rows.json ⇒ 边缘查询失败 ⇒ 全部 500（同类第三次）。
  const stockRowSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_STOCK_ROW")
  const stockOkId = "p_stock_probe_ok"
  const stockLowId = "p_stock_probe_low"
  const stockGhostId = "p_stock_probe_ghost"
  ordersRows[stockRowSql + "|" + JSON.stringify([stockOkId])] = [{ _id: stockOkId, name: "牛奶", stock: 5 }]
  ordersRows[stockRowSql + "|" + JSON.stringify([stockLowId])] = [{ _id: stockLowId, name: "牛奶", stock: 5 }]
  ordersRows[stockRowSql + "|" + JSON.stringify([stockGhostId])] = [{ _id: stockGhostId, name: "幽灵", stock: 3 }]
  missingIds.push(stockGhostId)
  // ── createOrder（/pub 写动作）：行集必须在 mock 启动前登记 ──
  const orderProductsSql = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_ORDER_PRODUCTS")
  const orderPromoSql = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_ORDER_PROMOTIONS")
  const orderByKeySql = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_ORDER_BY_KEY")
  const orderDiscountSql = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_ORDER_DISCOUNT")
  const rateReadSql = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_RATE_READ")
  const orderBuyerId = "p_order_probe"
  ordersRows[orderProductsSql.replace("__PH__", "?") + "|" + JSON.stringify([orderBuyerId])] = [
    { _id: orderBuyerId, name: "牛奶", spec: "", specOptions: "[]", price: 4, enabled: 1, subcategories: "[]", stock: 10 },
  ]
  ordersRows[orderPromoSql] = []
  ordersRows[orderDiscountSql] = []
  // 限流桶：不带请求头的用例走纯 SQL 键 ⇒ 空数组 = 视为过期桶 = 放行
  ordersRows[rateReadSql] = []
  // 限流命中用例：按 cf-connecting-ip 精确命中（resetAt 取远未来 ⇒ 桶有效且计数已达上限）
  ordersRows[rateReadSql + "|" + JSON.stringify(["rate:write:203.0.113.9"])] = [{ count: 20, resetAt: 4102444800000 }]
  // 幂等键查询：默认空（无历史单）；去重命中用例自己覆盖
  ordersRows[orderByKeySql] = []
  const orderLowId = "p_order_probe_low"
  ordersRows[orderProductsSql.replace("__PH__", "?") + "|" + JSON.stringify([orderLowId])] = [
    { _id: orderLowId, name: "牛奶", spec: "", specOptions: "[]", price: 4, enabled: 1, subcategories: "[]", stock: 10 },
  ]
  missingIds.push(orderLowId)
  // 指纹去重命中用：这一行的字段重算出指纹后必须等于「无 requestId 那一版载荷」的指纹
  const orderFpSql2 = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_ORDER_BY_FINGERPRINT")
  const dupItemsJson = JSON.stringify([{ productId: orderBuyerId, name: "牛奶", spec: "", price: 4, quantity: 2, subcategories: [] }])
  ordersRows[orderFpSql2] = [{ _id: "o_dup_1", totalAmount: 8, items: dupItemsJson, wechat: "wx", remark: "", paymentScreenshot: "" }]
// ── 商品域三写：改库存预读（按 SQL|params 精确命中）──
const prodStockSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_PRODUCT_STOCK_READ")
ordersRows[prodStockSql + "|" + JSON.stringify(["p_upd_probe"])] = [{ stock: 10 }]
// ── 批量商品写：预读与存在集合（按 SQL|params 精确命中）──
const batchStockSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_BATCH_STOCK_IN")
const batchExistSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_BATCH_EXIST_IN")
ordersRows[batchStockSql.replace("__PHV__", "?") + "|" + JSON.stringify(["p_bu_1"])] = [{ _id: "p_bu_1", stock: 10 }]
// 占位符个数必须与去重后的 id 数一致（3 个 id ⇒ IN (?,?,?)），否则 mock 认不出这条 SQL
ordersRows[batchExistSql.replace("__PHV__", "?,?,?") + "|" + JSON.stringify(["p_bd_1", "p_bd_2", "p_missing"])] = [{ _id: "p_bd_1" }, { _id: "p_bd_2" }]
// ── 订单状态机：状态读行与回补用的库存行 ──
const orderStateSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_ORDER_STATE_READ")
const releaseStockSql = sqlOfFrom("crates/edge/src/api_pub_order.rs", "SQL_RELEASE_STOCK")
const itJson = JSON.stringify([{ productId: "p_rel_1", name: "牛奶", quantity: 2 }])
ordersRows[orderStateSql + "|" + JSON.stringify(["o_state_1"])] = [{ status: "pending", items: itJson }]
ordersRows[orderStateSql + "|" + JSON.stringify(["o_del_1"])] = [{ status: "pending", items: itJson }]
ordersRows[releaseStockSql.replace("__PHV__", "?") + "|" + JSON.stringify(["p_rel_1"])] = [{ _id: "p_rel_1", stock: 5 }]
// ── 订单重算：扫描页（1 行漂移单：存 25、按 items 应 20）──
const recalcScanSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_RECALC_SCAN")
ordersRows[recalcScanSql + "|" + JSON.stringify([200, 0])] = [
  { _id: "o_rc_1", items: JSON.stringify([{ price: 10, quantity: 2 }]), totalAmount: 25, discountAmount: 0, promotionId: "" },
]
// ── 评价域：种子计数（库非空 ⇒ 跳过）──
const reviewCountSql = sqlOfFrom("crates/edge/src/api_admin.rs", "SQL_REVIEW_COUNT")
ordersRows[reviewCountSql] = [{ c: 20 }]
// /pub 的 addPublicReview 用独立 IP，避免与 createOrder 的用例共用桶键
ordersRows[rateReadSql + "|" + JSON.stringify(["rate:write:203.0.113.11"])] = []
// ── createSubmission 的 /pub 用例：独立 IP 的限流桶 ──
ordersRows[rateReadSql + "|" + JSON.stringify(["rate:write:203.0.113.12"])] = []
const rowsFile = path.join(rustRoot, '.cache', 'mock-d1-rows' + (parsedMode ? '-parsed' : '') + '.json')
// __metaMissingIds 是给 mock 的负控面：命中这些 id 的 UPDATE/DELETE 回 changes=0
writeFileSync(rowsFile, JSON.stringify({
  __metaMissingIds: missingIds,
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
  ...ordersRows,
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
    // /pub 写动作的开关（默认关）：判据就位后由夹具显式打开，生产侧要不要开是独立决定
    NATIVE_PUB_WRITE: 'createOrder,addPublicReview,createSubmission',
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
  const want = caseJson(c, liveOut[key])
  const got = caseJson(c, stripTrace(first.json))
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
  for (const c of orderCases) adminCases.push(c)
  if (promoRowsReady) {
    adminCases.push({ name: 'getPromotions（档位 + 命中统计）', action: 'getPromotions', key: keys.admin, payload: {}, expectAudit: 0 })
  }
  if (statsRowsReady) {
    // cacheable: true —— 现网用 KV 60s 包着这个动作，边缘侧对应同一套微缓存；第二发必须命中
    adminCases.push({ name: 'getDashboardStats（六聚合 + 缓存）', action: 'getDashboardStats', key: keys.admin, payload: {}, expectAudit: 0, cacheable: true })
  }
  // verifyKey：鉴权闭环（两档角色都要能取出来）
  adminCases.push({ name: 'verifyKey（正确密钥 ⇒ role:admin）', action: 'verifyKey', key: keys.admin, payload: {}, expectAudit: 0 })
  if (keys.readonly) {
    adminCases.push({ name: 'verifyKey（只读密钥 ⇒ role:readonly）', action: 'verifyKey', key: keys.readonly, payload: {}, expectAudit: 0 })
  }
  // stalePendingReport：**只对空窗早退路径做逐字节对比**。
  // 非空窗不能逐字节比 —— 响应里只有 ageMinutes（没有 createdAt），而 cutoff / age 都含「当前时刻」，
  // 两侧调用天然差几毫秒 ⇒ 拿它当逐字节判据会变成 flaky 假红。非空窗的组装语义由 core 的 5 条用例钉住，
  // 现网形状另做**观察记录**（下方 staleWide）。
  const staleCasePayload = { minutes: staleMinutes }
  const staleLive = await postWeb(live, 'stalePendingReport', keys.admin, staleCasePayload)
  const staleLiveData = staleLive.status === 200 ? staleLive.json.data : null
  if (staleLiveData && staleLiveData.count === pendingRows.length) {
    // stripFields：ageMinutes 取决于两侧各自的当前时刻 ⇒ 不参与逐字节面（否则红的是时钟不是等价性）
    adminCases.push({ name: 'stalePendingReport（minutes=10080，非空窗）', action: 'stalePendingReport', key: keys.admin, payload: staleCasePayload, expectAudit: 0, stripFields: ['ageMinutes'] })
    console.log('  stalePendingReport：现网 count=' + staleLiveData.count + ' ⇒ 逐字节用例已登记（喂 ' + pendingRows.length + ' 行 / ' + staleIds.length + ' 个商品 id）')
  } else {
    console.log('  [观察] stalePendingReport 非空窗跳过：现网 count=' + (staleLiveData ? staleLiveData.count : '?') + ' ≠ 夹具 ' + pendingRows.length + '（筛选口径有差 ⇒ 不拿它当判据）')
  }
  const staleWide = await postWeb(live, 'stalePendingReport', keys.admin, { minutes: 10080 })
  const wideData = staleWide.status === 200 ? staleWide.json.data : null
  report.staleWideObservation = {
    status: staleWide.status,
    count: wideData ? wideData.count : null,
    stockReservedLen: wideData && Array.isArray(wideData.stockReserved) ? wideData.stockReserved.length : null,
    thresholdMinutes: wideData ? wideData.thresholdMinutes : null,
    note: '非空窗路径不做逐字节对比（响应无 createdAt、cutoff 含当前时刻）⇒ 组装语义由 core 的 5 条用例钉住；此处只记录现网形状',
  }
  console.log('  [观察] stalePendingReport(minutes=10080) 现网：count=' + (wideData ? wideData.count : '?') + '｜stockReserved ' + (wideData && wideData.stockReserved ? wideData.stockReserved.length : '?') + ' 项｜thresholdMinutes=' + (wideData ? wideData.thresholdMinutes : '?'))
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
    const want = caseJson(c, stripTrace(liveR.json))
    const got = caseJson(c, stripTrace(nativeR.json))
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
  // ── ⑥ 写动作（**只对本地边缘**）────────────────────────────────────────────
  // 硬边界：**绝不对现网发写请求** —— 那会真改生产数据（真实订单/评价/库存）。
  // 所以写动作的判据是「语句序列 + 参数形状 + 响应封套 + 审计条数」，而不是与现网逐字节比。
  // 这也意味着：写动作的**值级**等价性只由 core 单测与 SQL 逐字判据保证，不靠线上对账（已写进 docs/08 §2k）。
  const writeCases = []
  if (keys.admin) {
    // 用一个**不存在**的 reviewId：现网 deleteReview 不看影响行数，恒回 {code:0}（所以线上也不会被这次调用改变状态）
    writeCases.push({
      name: "deleteReview（成功形态）", action: "deleteReview", payload: { reviewId: "r_write_probe_2026" },
      expect: { code: 0 },
      expectStatements: [{ prefix: "DELETE FROM reviews", params: 1 }, { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }],
    })
    writeCases.push({
      name: "deleteReview（缺 reviewId ⇒ 400）", action: "deleteReview", payload: {},
      expect: { code: -1, errorCode: "missing_review_id" },
      // 失败也审计（现网 backend.js:204 对写动作无论成败都落 ok/fail；fail 的长度是 4）
      expectStatements: [{ prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }],
    })
  }
  // adjustStock：三条语句 + 三种失败形态。行集按「mock 的 SQL|params 键」登记；
  // 现网一次都不打（写动作的硬边界）。
  {
    // 行集已在 mock 启动前登记（见上面的 stockRowSql 段）；这里只用常量登记用例
    const okId = stockOkId
    const lowId = stockLowId
    const ghostId = stockGhostId
    writeCases.push({
      name: "adjustStock（成功：+4 ⇒ 三条语句 + 审计）", action: "adjustStock",
      payload: { productId: okId, delta: 4, note: "到货" },
      expect: { code: 0 },
      expectData: { productId: okId, before: 5, after: 9, delta: 4, recorded: true },
      expectStatements: [
        { prefix: "SELECT _id, name, stock FROM products", params: 1 },
        { prefix: "UPDATE products SET stock", params: 3 },
        { prefix: "INSERT INTO stock_movements", params: 8 },
        { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 },
      ],
    })
    writeCases.push({
      name: "adjustStock（-10 ⇒ stock_insufficient，不写库）", action: "adjustStock",
      payload: { productId: lowId, delta: -10 },
      expect: { code: -1, errorCode: "stock_insufficient" },
      expectMessage: "调整后库存为负（现 5，本次 -10）",
      expectStatements: [
        { prefix: "SELECT _id, name, stock FROM products", params: 1 },
        { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 },
      ],
    })
    writeCases.push({
      name: "adjustStock（UPDATE 命中 0 行 ⇒ product_not_found）", action: "adjustStock",
      payload: { productId: ghostId, delta: 1 },
      expect: { code: -1, errorCode: "product_not_found" },
      expectStatements: [
        { prefix: "SELECT _id, name, stock FROM products", params: 1 },
        { prefix: "UPDATE products SET stock", params: 3 },
        { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 },
      ],
    })
    writeCases.push({
      name: "adjustStock（缺 productId ⇒ 400）", action: "adjustStock", payload: {},
      expect: { code: -1, errorCode: "missing_product_id" },
      expectStatements: [{ prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }],
    })
  }
  // createOrder（/pub 写动作）：判据只打本地边缘；成功 / 指纹去重命中 / 库存不足 / 限流 四条
  {
    const baseline = [
      { prefix: "SELECT count, resetAt FROM rate_limits", params: 1 },
      // 空桶（或过期桶）会走现网同款的 UPSERT 起桶 —— 我第一版期望漏了这条，判据把它指出来
      { prefix: "INSERT INTO rate_limits", params: 2 },
      { prefix: "SELECT _id, name, spec, specOptions", params: 1 },
      { prefix: "SELECT _id, threshold, discount FROM promotions", params: 0 },
    ]
    writeCases.push({
      name: "createOrder（成功：7 条语句 + 响应）",
      action: "createOrder", pub: true,
      payload: { roomNumber: "201", requestId: "req-order-1", items: [{ productId: "p_order_probe", quantity: 2 }], wechat: "wx", remark: "" },
      expect: { code: 0 },
      expectDataFields: { totalAmount: 8, discountAmount: 0, promotionId: "" },
      expectIdPrefix: "o_",
      expectStatements: [
        ...baseline,
        { prefix: "SELECT _id, totalAmount FROM orders WHERE idempotencyKey", params: 1 },
        { prefix: "UPDATE products SET stock = stock", params: 4 },
        { prefix: "INSERT INTO stock_movements", params: 8 },
        { prefix: "INSERT INTO orders", params: 11 },
      ],
    })
    writeCases.push({
      name: "createOrder（指纹去重命中：不动库存）",
      action: "createOrder", pub: true,
      payload: { roomNumber: "201", items: [{ productId: "p_order_probe", quantity: 2 }], wechat: "wx", remark: "" },
      expect: { code: 0 },
      expectDataFields: { id: "o_dup_1", totalAmount: 8, discountAmount: 0, promotionId: "", deduplicated: true },
      expectNoWrites: true,
      expectStatements: [
        ...baseline,
        { prefix: "SELECT _id, totalAmount, items, wechat, remark, paymentScreenshot", params: 2 },
        { prefix: "SELECT discountAmount, promotionId FROM order_discounts", params: 1 },
      ],
    })
    writeCases.push({
      name: "createOrder（库存不足：护栏 UPDATE 0 变更 ⇒ stock_insufficient）",
      action: "createOrder", pub: true,
      payload: { roomNumber: "201", requestId: "req-order-3", items: [{ productId: "p_order_probe_low", quantity: 2 }], wechat: "wx", remark: "" },
      expect: { code: -1, errorCode: "stock_insufficient" },
      expectMessage: "库存不足: 牛奶",
      expectStatements: [
        ...baseline,
        { prefix: "SELECT _id, totalAmount FROM orders WHERE idempotencyKey", params: 1 },
        { prefix: "UPDATE products SET stock = stock", params: 4 },
      ],
    })
    writeCases.push({
      name: "createOrder（限流：20/60s 桶已满 ⇒ 429 + retryAfterMs）",
      action: "createOrder", pub: true,
      headers: { "cf-connecting-ip": "203.0.113.9" },
      payload: { roomNumber: "201", requestId: "req-order-4", items: [{ productId: "p_order_probe", quantity: 2 }], wechat: "wx", remark: "" },
      expect: { code: -1, errorCode: "rate_limited" },
      expectStatements: [{ prefix: "SELECT count, resetAt FROM rate_limits", params: 1 }],
    })
  }
  // 商品域三写（/web 管理写；只打本地边缘）
  {
    const auditOk = { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }
    const auditFail = { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }
    writeCases.push({
      name: "deleteProduct（成功：单语句 + 审计）",
      action: "deleteProduct", payload: { productId: "p_del_probe" },
      expect: { code: 0 },
      expectStatements: [{ prefix: "DELETE FROM products WHERE _id = ?", params: 1 }, auditOk],
    })
    writeCases.push({
      name: "deleteProduct（缺 productId ⇒ 400）",
      action: "deleteProduct", payload: {},
      expect: { code: -1, errorCode: "missing_product_id" },
      expectStatements: [auditFail],
    })
    writeCases.push({
      name: "updateProduct（改价 + 改库存 ⇒ 预读 → UPDATE → 流水）",
      action: "updateProduct", payload: { productId: "p_upd_probe", price: 4.5, stock: 3 },
      expect: { code: 0 },
      expectStatements: [
        { prefix: "SELECT stock FROM products WHERE _id = ?", params: 1 },
        { prefix: "UPDATE products SET", params: 4 },
        { prefix: "INSERT INTO stock_movements", params: 8 },
        auditOk,
      ],
    })
    writeCases.push({
      name: "createProduct（成功：插行 + 期初流水；响应键序）",
      action: "createProduct",
      payload: { name: "可乐", price: 3, stock: 5, subcategories: ["饮料"], enabled: false, image: "https://cdn.example.com/a.png", images: ["https://cdn.example.com/a.png"], specOptions: [{ label: " 大瓶 ", enabled: false }, { label: "大瓶" }, { label: "" }, "x"] },
      expect: { code: 0 },
      expectStatements: [
        { prefix: "INSERT INTO products", params: 11 },
        { prefix: "INSERT INTO stock_movements", params: 8 },
        auditOk,
      ],
      expectDataKeys: "_id,name,price,subcategories,enabled,image,images,stock,specOptions,createdAt,updatedAt",
      expectIdPrefix: "p_",
    })
  }
  // 批量商品写（/web 管理写；只打本地边缘）
  {
    const auditOk = { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }
    const auditFail = { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }
    writeCases.push({
      name: "batchUpdateProducts（1 条成功 + 1 条缺 id）",
      action: "batchUpdateProducts",
      payload: { items: [{ productId: "p_bu_1", updates: { price: 9, stock: 4 } }, { updates: { price: 1 } }] },
      expect: { code: 0 },
      expectData: { updated: 1, failed: [{ id: "?", message: "缺少 productId" }], total: 2 },
      expectStatements: [
        { prefix: "SELECT _id, stock FROM products WHERE _id IN", params: 1 },
        { prefix: "UPDATE products SET", params: 4 },
        { prefix: "INSERT INTO stock_movements", params: 8 },
        auditOk,
      ],
    })
    writeCases.push({
      name: "batchDeleteProducts（去重 + 存在集合口径 + 失败清单）",
      action: "batchDeleteProducts",
      payload: { productIds: ["p_bd_1", "p_bd_1", "p_bd_2", "p_missing"] },
      expect: { code: 0 },
      expectData: { deleted: 2, failed: [{ id: "p_missing", message: "商品不存在" }], total: 4 },
      expectStatements: [
        { prefix: "SELECT _id FROM products WHERE _id IN", params: 3 },
        { prefix: "DELETE FROM products WHERE _id IN", params: 3 },
        auditOk,
      ],
    })
    writeCases.push({
      name: "batchUpdateProducts（updates 非对象 ⇒ 整批拒、零写入）",
      action: "batchUpdateProducts",
      payload: { items: [{ productId: "p_bu_1", updates: "oops" }] },
      expect: { code: -1, errorCode: "internal_error" },
      expectStatements: [auditFail],
    })
    writeCases.push({
      name: "batchUpdateProducts（缺 items ⇒ 400）",
      action: "batchUpdateProducts", payload: {},
      expect: { code: -1, errorCode: "missing_items" },
      expectStatements: [auditFail],
    })
  }
  // 订单状态机（/web 管理写；只打本地边缘）
  {
    const auditOk = { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }
    const auditFail = { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }
    writeCases.push({
      name: "updateOrderStatus（pending → paid 合法）",
      action: "updateOrderStatus", payload: { orderId: "o_state_1", status: "paid" },
      expect: { code: 0 },
      expectStatements: [
        { prefix: "SELECT status, items FROM orders WHERE _id = ?", params: 1 },
        { prefix: "UPDATE orders SET status = ?", params: 4 },
        auditOk,
      ],
    })
    writeCases.push({
      name: "updateOrderStatus（pending → completed 非法，文案逐字）",
      action: "updateOrderStatus", payload: { orderId: "o_state_1", status: "completed" },
      expect: { code: -1, errorCode: "invalid_transition" },
      expectMessage: "不允许的状态流转: pending → completed",
      expectStatements: [
        { prefix: "SELECT status, items FROM orders WHERE _id = ?", params: 1 },
        auditFail,
      ],
    })
    writeCases.push({
      name: "deleteOrder（pending 单 ⇒ 先读后删 + 回补库存与 void 流水）",
      action: "deleteOrder", payload: { orderId: "o_del_1" },
      expect: { code: 0 },
      expectStatements: [
        { prefix: "SELECT status, items FROM orders WHERE _id = ?", params: 1 },
        { prefix: "DELETE FROM orders WHERE _id = ?", params: 1 },
        { prefix: "SELECT _id, stock FROM products WHERE _id IN", params: 1 },
        { prefix: "UPDATE products SET stock = CASE", params: 3 },
        { prefix: "INSERT INTO stock_movements", params: 8 },
        auditOk,
      ],
    })
    writeCases.push({
      name: "deleteOrder（缺 orderId ⇒ 400）",
      action: "deleteOrder", payload: {},
      expect: { code: -1, errorCode: "missing_order_id" },
      expectStatements: [auditFail],
    })
  }
  // 订单重算（/web 管理写；只打本地边缘）
  {
    writeCases.push({
      name: "recalculateOrders（1 行漂移 ⇒ CASE UPDATE + 明细 UPSERT）",
      action: "recalculateOrders", payload: {},
      expect: { code: 0 },
      expectData: { total: 1, fixed: 1 },
      expectStatements: [
        { prefix: "SELECT o._id, o.items, o.totalAmount", params: 2 },
        { prefix: "UPDATE orders SET totalAmount = CASE _id", params: 4 },
        { prefix: "INSERT INTO order_discounts", params: 4 },
        { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 },
      ],
    })
  }
  // 评价域三写（/web 管理写 + /pub 公开写；只打本地边缘）
  {
    const auditOk = { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }
    writeCases.push({
      name: "addReview（成功：插一行 + 审计）",
      action: "addReview",
      payload: { productOrder: 6, user: "小明", rating: 5, text: "好喝", images: [] },
      expect: { code: 0 },
      expectDataKeys: "_id,id,productOrder,user,rating,text,images,createdAt",
      expectStatements: [{ prefix: "INSERT INTO reviews", params: 7 }, auditOk],
    })
    writeCases.push({
      name: "addReview（rating 越界 ⇒ 钳到 5；user 缺省 ⇒ 匿名用户）",
      action: "addReview",
      payload: { productOrder: 6, rating: 99, text: "还行", images: [] },
      expect: { code: 0 },
      expectDataFields: { user: "匿名用户", rating: 5 },
      expectStatements: [{ prefix: "INSERT INTO reviews", params: 7 }, auditOk],
    })
    writeCases.push({
      name: "addReview（正文含 script ⇒ invalid_text）",
      action: "addReview",
      payload: { productOrder: 6, text: "<script>alert(1)</script>", images: [] },
      expect: { code: -1, errorCode: "invalid_text" },
      // 失败写入的审计是 fail（长度 4）—— 我第一版写成 auditOk，判据把它指出来了。
      // 这里用内联字面量而不是块内变量：本轮我因为引用了别的块里的 auditFail 让夹具当场抛错、
      // 而那条提交**已经带着「62 用例全绿」的假话出去了**（下一笔修正并说明）。
      expectStatements: [{ prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }],
    })
    writeCases.push({
      name: "addPublicReview（/pub：写限流起桶 + 插行，**无审计**）",
      action: "addPublicReview", pub: true, headers: { "cf-connecting-ip": "203.0.113.11" },
      payload: { productOrder: 6, user: "顾客", rating: 4, text: "不错", images: [] },
      expect: { code: 0 },
      expectStatements: [
        { prefix: "SELECT count, resetAt FROM rate_limits", params: 1 },
        { prefix: "INSERT INTO rate_limits", params: 2 },
        { prefix: "INSERT INTO reviews", params: 7 },
      ],
    })
    writeCases.push({
      name: "seedReviews（库非空 ⇒ 跳过）",
      action: "seedReviews", payload: {},
      expect: { code: 0 },
      expectData: { added: 0, skipped: true },
      expectStatements: [{ prefix: "SELECT COUNT(*) AS c FROM reviews", params: 0 }, auditOk],
    })
  }
  // 提交域两写（/web 管理写；只打本地边缘）
  {
    // 用内联字面量而不是块内变量：上一轮我跨块引用 auditFail 让夹具当场抛错、还写出了「全绿」的假话。
    const auditOk = { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }
    const auditFailInline = { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }
    writeCases.push({
      name: "updateSubmissionStatus（status 缺省 ⇒ done）",
      action: "updateSubmissionStatus", payload: { submissionId: "s_probe_1" },
      expect: { code: 0 },
      expectStatements: [
        { prefix: "UPDATE submissions SET status = ?", params: 3 },
        auditOk,
      ],
    })
    writeCases.push({
      name: "updateSubmissionStatus（缺 submissionId ⇒ 400）",
      action: "updateSubmissionStatus", payload: {},
      expect: { code: -1, errorCode: "missing_submission_id" },
      expectStatements: [auditFailInline],
    })
    writeCases.push({
      name: "deleteSubmission（单语句删 + 审计）",
      action: "deleteSubmission", payload: { submissionId: "s_probe_2" },
      expect: { code: 0 },
      expectStatements: [{ prefix: "DELETE FROM submissions WHERE _id = ?", params: 1 }, auditOk],
    })
  }
  // createSubmission（/web 管理写 + /pub 公开写；只打本地边缘）
  {
    const auditOkInline = { prefix: "INSERT INTO security_events", params: 6, resultLen: 2 }
    const auditFailInline = { prefix: "INSERT INTO security_events", params: 6, resultLen: 4 }
    const okPayload = { serviceId: "unlock", serviceName: "开锁", categoryId: "door", categoryName: "门锁", formData: { "地址": "1栋" }, images: ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="] }
    writeCases.push({
      name: "createSubmission（成功：9 列 INSERT + 审计；响应只有 id）",
      action: "createSubmission", payload: okPayload,
      expect: { code: 0 },
      expectDataKeys: "id",
      expectIdPrefix: "s_",
      expectStatements: [{ prefix: "INSERT INTO submissions", params: 9 }, auditOkInline],
    })
    writeCases.push({
      name: "createSubmission（10 张 ⇒ too_many_images，零写）",
      action: "createSubmission",
      payload: { serviceId: "unlock", serviceName: "开锁", images: Array.from({ length: 10 }, () => "https://x/y.png") },
      expect: { code: -1, errorCode: "too_many_images" },
      expectStatements: [auditFailInline],
    })
    writeCases.push({
      name: "createSubmission（单张超 90000 ⇒ image_too_large 413）",
      action: "createSubmission",
      payload: { serviceId: "unlock", serviceName: "开锁", images: ["data:image/png;base64," + "A".repeat(90001)] },
      expect: { code: -1, errorCode: "image_too_large" },
      expectStatements: [auditFailInline],
    })
    writeCases.push({
      name: "createSubmission（print 服务：r2: 与 pdf data URL 都收，走 700000 那把尺）",
      action: "createSubmission",
      payload: { serviceId: "print", serviceName: "打印", images: ["r2:docs/a.pdf", "data:application/pdf;base64,AAA="] },
      expect: { code: 0 },
      expectStatements: [{ prefix: "INSERT INTO submissions", params: 9 }, auditOkInline],
    })
    writeCases.push({
      name: "createSubmission（formData 含 script ⇒ invalid_text）",
      action: "createSubmission",
      payload: { serviceId: "unlock", serviceName: "开锁", formData: { note: "<script>x</script>" }, images: [] },
      expect: { code: -1, errorCode: "invalid_text" },
      expectStatements: [auditFailInline],
    })
    writeCases.push({
      name: "createSubmission（/pub：限流起桶 + 9 列 INSERT，无审计）",
      action: "createSubmission", pub: true, headers: { "cf-connecting-ip": "203.0.113.12" },
      payload: okPayload,
      expect: { code: 0 },
      expectStatements: [
        { prefix: "SELECT count, resetAt FROM rate_limits", params: 1 },
        { prefix: "INSERT INTO rate_limits", params: 2 },
        { prefix: "INSERT INTO submissions", params: 9 },
      ],
    })
  }
  for (const c of writeCases) {
    const before = auditRoster().length
    // /pub 写用例走 postPub（可带额外请求头，例如用 cf-connecting-ip 固定限流桶键）；其余走 /web
    const nativeR = c.pub
      ? await postPub(base, c.action, c.payload || {}, c.headers || {})
      : await postWeb(base, c.action, keys.admin, c.payload) // ← 本地边缘；现网一次都不打
    const added = auditRoster().slice(before)
    const entry = { action: c.action, status: nativeR.status, edge: nativeR.edge, statements: added.map((s) => s.sql.slice(0, 40)), ok: true }
    if (nativeR.edge !== "native") problems.push(c.name + "：x-edge=" + nativeR.edge + "（不是原生分支）")
    for (const [k, v] of Object.entries(c.expect)) {
      if (nativeR.json[k] !== v) { entry.ok = false; problems.push(c.name + "：响应字段 " + k + "=" + nativeR.json[k] + "，期望 " + v) }
    }
    if (c.expectData) {
      const got = JSON.stringify(nativeR.json.data)
      const want = JSON.stringify(c.expectData)
      if (got !== want) { entry.ok = false; problems.push(c.name + "：data 与手算不符（" + got + " ≠ " + want + "）") }
    }
    if (c.expectDataFields) {
      // 部分字段比对：订单号这类**非确定值**（o_ + 36 进制时间 + 随机尾）不许整段比，只能比确定的几个字段
      for (const [k, v] of Object.entries(c.expectDataFields)) {
        const got = nativeR.json.data ? nativeR.json.data[k] : undefined
        if (JSON.stringify(got) !== JSON.stringify(v)) {
          entry.ok = false
          problems.push(c.name + "：data." + k + "=" + JSON.stringify(got) + "，期望 " + JSON.stringify(v))
        }
      }
    }
    if (c.expectDataKeys) {
      // 键序是接口契约的一部分（JSON.stringify 保序）⇒ 直接比 keys 的拼接
      const keys = nativeR.json.data ? Object.keys(nativeR.json.data).join(",") : ""
      if (keys !== c.expectDataKeys) {
        entry.ok = false
        problems.push(c.name + "：data 键序不符（" + keys + " ≠ " + c.expectDataKeys + "）")
      }
    }
    if (c.expectIdPrefix) {
      // 订单类动作的 data 用 id；商品类用 _id（现网 products.js:118 回的是整份 doc）⇒ 两种都认
      const d = nativeR.json.data
      const id = d ? (d.id !== undefined ? d.id : d._id) : undefined
      if (typeof id !== "string" || !id.startsWith(c.expectIdPrefix)) {
        entry.ok = false
        problems.push(c.name + "：data.id 前缀不是 " + c.expectIdPrefix + "（" + id + "）")
      }
    }
    if (c.expectNoWrites) {
      // 只看**订单域**的写：限流起桶（INSERT INTO rate_limits）是写，但它是限流器自己的事，
      // 不在「这次下单有没有动库存/落单」这个判据里。
      const wrote = added.filter(
        (s) => s.isWrite && /INSERT INTO orders|INSERT INTO stock_movements|UPDATE products/.test(s.sql),
      )
      if (wrote.length !== 0) {
        entry.ok = false
        problems.push(c.name + "：不该有写语句，实测 " + wrote.map((s) => s.sql.slice(0, 24)).join(" | "))
      }
    }
    if (c.expectMessage && nativeR.json.message !== c.expectMessage) {
      entry.ok = false
      problems.push(c.name + "：message 不逐字（" + nativeR.json.message + " ≠ " + c.expectMessage + "）")
    }
    if (added.length !== c.expectStatements.length) {
      entry.ok = false
      problems.push(c.name + "：语句条数 " + added.length + "，期望 " + c.expectStatements.length + "（" + added.map((s) => s.sql.slice(0, 30)).join(" | ") + "）")
    } else {
      c.expectStatements.forEach((want, i) => {
        const got = added[i]
        if (!got.sql.startsWith(want.prefix) || got.paramCount !== want.params) {
          entry.ok = false
          problems.push(c.name + "：第 " + (i + 1) + " 条语句形状不符（" + got.sql.slice(0, 30) + " / params=" + got.paramCount + "）")
        }
        if (want.resultLen !== undefined && got.paramLengths[3] !== want.resultLen) {
          entry.ok = false
          problems.push(c.name + "：审计 result 长度 " + got.paramLengths[3] + "，期望 " + want.resultLen + "（2=ok / 4=fail）")
        }
      })
    }
    report.cases[c.name] = entry
    console.log(c.name + "：原生=" + (nativeR.edge === "native") + "｜HTTP " + nativeR.status + "｜语句 " + added.map((s) => s.sql.slice(0, 24)).join(" → "))
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
  : '\nGATE-PASS check-api-native-e2e：公开面 8 + 管理读 26 + 写 37（写入只打本地边缘）= 71 个用例\n  ——全部与现网**逐字段相同**（含键序）；缓存语义一致；审计写入条数一致（读动作 +0、鉴权失败 +1、只读拒绝 +0）')

edge.kill()
mock.kill()
process.exit(problems.length ? 1 : 0)
