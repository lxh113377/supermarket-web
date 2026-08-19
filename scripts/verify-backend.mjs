// 本地后端契约验证：用 node:sqlite 模拟 D1 绑定，直接跑 functions/lib/backend.js 全部 action。
// 不需要 Cloudflare 账号 / wrangler / 网络。D1 即 SQLite，SQL 语法与运行时完全一致。
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'))
db.exec(readFileSync(join(root, 'db', 'seed.sql'), 'utf8'))

// ---- 模拟 D1 绑定（对齐 D1 的 prepare/bind/all/first/run 异步接口）----
function makeD1(db) {
  // D1 接受 boolean 并自动存为 0/1、undefined 视为 null；node:sqlite 不接受 boolean，这里模拟 D1 的类型转换。
  const coerce = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)
  return {
    prepare(sql) {
      const stmt = db.prepare(sql)
      let bound = []
      return {
        bind(...params) {
          bound = params
          return this
        },
        async all() {
          return { results: stmt.all(...bound.map(coerce)) }
        },
        async first() {
          const row = stmt.get(...bound.map(coerce))
          return row === undefined ? null : row
        },
        async run() {
          const info = stmt.run(...bound.map(coerce))
          return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } }
        },
      }
    },
  }
}

const backendUrl = pathToFileURL(join(root, 'functions', 'lib', 'backend.js')).href
const { handleAdmin, handlePublic } = await import(backendUrl)
const env = { DB: makeD1(db), ADMIN_KEY: 'test-key-123' }

let pass = 0, fail = 0
const fails = []
function ok(cond, msg) {
  if (cond) { pass++ } else { fail++; fails.push(msg) }
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

// ---------- 公开读取 ----------
const cats = await handlePublic(env, 'getPublicCategories', {})
ok(cats.code === 0 && cats.data.length === 2, `getPublicCategories 返回 2 个分类 (实际 ${cats.data?.length})`)

const pub = await handlePublic(env, 'getPublicProducts', {})
ok(pub.code === 0 && pub.data.length === 49, `getPublicProducts 返回 49 个上架商品 (实际 ${pub.data?.length})`)
ok(pub.data.every((p) => Array.isArray(p.subcategories)), 'getPublicProducts 的 subcategories 已解析为数组')
ok(pub.data.every((p) => typeof p.price === 'number'), 'getPublicProducts 的 price 为 number')

// ---------- 下单 ----------
const order = await handlePublic(env, 'createOrder', {
  roomNumber: '305', items: [{ productId: 'p001', quantity: 2 }, { productId: 'p022', quantity: 1 }], wechat: 'wx_abc',
})
ok(order.code === 0 && order.data?.id, `createOrder 成功返回 id (${order.data?.id})`)
ok(Math.abs(order.data.totalAmount - 7.98) < 0.001, `createOrder 金额计算正确 2.66*2+2.66 = 7.98 (实际 ${order.data?.totalAmount})`)

const badOrder = await handlePublic(env, 'createOrder', { roomNumber: '305', items: [{ productId: 'p999', quantity: 1 }] })
ok(badOrder.code === -1, 'createOrder 遇到不存在商品返回 -1')

// ---------- 管理读单/读列表 ----------
const getOrder = await handleAdmin(env, 'getOrder', 'test-key-123', { orderId: order.data.id })
ok(getOrder.code === 0 && Array.isArray(getOrder.data.items) && getOrder.data.items.length === 2, 'getOrder 返回且 items 已解析为数组')

const orders = await handleAdmin(env, 'getOrders', 'test-key-123', { page: 1, pageSize: 50 })
ok(orders.code === 0 && orders.data.some((o) => o._id === order.data.id), 'getOrders 包含刚下的单')

// ---------- 种子评价（需在写评价前，验证幂等）----------
const seed = await handleAdmin(env, 'seedReviews', 'test-key-123', {})
ok(seed.code === 0 && seed.data.added === 20, `seedReviews 写入 20 条 (实际 ${seed.data?.added})`)
const allRev = await handleAdmin(env, 'getAllReviews', 'test-key-123', {})
ok(allRev.code === 0 && allRev.data.length === 20, `getAllReviews 合计 20 条 (实际 ${allRev.data?.length})`)
const seedAgain = await handleAdmin(env, 'seedReviews', 'test-key-123', {})
ok(seedAgain.code === 0 && seedAgain.data.skipped === true, 'seedReviews 幂等：已有数据则跳过')

// ---------- 评价（公开写 + 读）----------
const rev = await handlePublic(env, 'addPublicReview', { productOrder: 1, user: '测试', rating: 5, text: '好喝' })
ok(rev.code === 0 && rev.data?._id, `addPublicReview 成功 (${rev.data?._id})`)
const reviews = await handlePublic(env, 'getReviews', { productOrder: 1 })
ok(reviews.code === 0 && reviews.data.some((r) => r._id === rev.data._id), 'getReviews 能查到刚写的评价')
const allRev2 = await handleAdmin(env, 'getAllReviews', 'test-key-123', {})
ok(allRev2.code === 0 && allRev2.data.length === 21, `getAllReviews 合计 21 条 (实际 ${allRev2.data?.length})`)

// ---------- 商品增改删（管理）----------
const created = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '测试可乐', price: 3.0, enabled: true })
ok(created.code === 0 && created.data?._id, `createProduct 成功 (${created.data?._id})`)
const afterCreate = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterCreate.data.length === 50, `getProducts 变为 50 (实际 ${afterCreate.data.length})`)
const upd = await handleAdmin(env, 'updateProduct', 'test-key-123', { productId: created.data._id, price: 3.5 })
ok(upd.code === 0, 'updateProduct 成功')
const afterUpd = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterUpd.data.find((p) => p._id === created.data._id)?.price === 3.5, 'updateProduct 价格已更新为 3.5')
const del = await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: created.data._id })
ok(del.code === 0, 'deleteProduct 成功')
const afterDel = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterDel.data.length === 49, `deleteProduct 后回归 49 (实际 ${afterDel.data.length})`)

// ---------- 提交（管理）----------
const sub = await handleAdmin(env, 'createSubmission', 'test-key-123', { serviceId: 's1', serviceName: '打印', formData: { page: 2 } })
ok(sub.code === 0 && sub.data?.id, `createSubmission 成功 (${sub.data?.id})`)
const subs = await handleAdmin(env, 'getSubmissions', 'test-key-123', {})
ok(subs.code === 0 && subs.data.some((s) => s._id === sub.data.id), 'getSubmissions 含刚提交')
const subUpd = await handleAdmin(env, 'updateSubmissionStatus', 'test-key-123', { submissionId: sub.data.id, status: 'done' })
ok(subUpd.code === 0, 'updateSubmissionStatus 成功')
const subDel = await handleAdmin(env, 'deleteSubmission', 'test-key-123', { submissionId: sub.data.id })
ok(subDel.code === 0, 'deleteSubmission 成功')

// ---------- 重新计算金额 ----------
const recalc = await handleAdmin(env, 'recalculateOrders', 'test-key-123', {})
ok(recalc.code === 0 && recalc.data.total >= 1, `recalculateOrders 处理 ${recalc.data.total} 单，修正 ${recalc.data.fixed}`)

// ---------- 鉴权与越权 ----------
const badKey = await handleAdmin(env, 'getProducts', 'wrong-key', {})
ok(badKey.code === -1, '错误 ADMIN_KEY 被拒')
const noKey = await handleAdmin(env, 'getProducts', '', {})
ok(noKey.code === -1, '空 ADMIN_KEY 被拒')
const pubTrespass = await handlePublic(env, 'getProducts', {})
ok(pubTrespass.code === -1, '公开端点无法调用管理 action')
const loginOk = await handleAdmin(env, 'login', 'test-key-123', {})
ok(loginOk.code === 0, 'login 正确密钥通过')
const loginBad = await handleAdmin(env, 'login', 'x', {})
ok(loginBad.code === -1, 'login 错误密钥拒绝')

// ---------- 未知 action ----------
const unknown = await handleAdmin(env, 'noSuchAction', 'test-key-123', {})
ok(unknown.code === -1, '未知 action 返回 -1')

console.log(`\n==== 结果: ${pass} 通过 / ${fail} 失败 ====`)
if (fail) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
console.log('全部通过 ✅')
