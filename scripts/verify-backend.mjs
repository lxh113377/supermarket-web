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
// 基线计数随种子增减浮动（如 2026-08-28 新增 3 商品 49→52），断言用相对基线而非硬编码
const seedProductCount = pub.data?.length ?? 0
ok(pub.code === 0 && seedProductCount > 0, `getPublicProducts 返回全部上架商品 (实际 ${seedProductCount})`)
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

// ---------- 新修复：负数/小数/零数量拒绝 ----------
const negOrder = await handlePublic(env, 'createOrder', { roomNumber: '305', items: [{ productId: 'p001', quantity: -2 }] })
ok(negOrder.code === -1, 'createOrder 负数数量被拒')
const floatOrder = await handlePublic(env, 'createOrder', { roomNumber: '305', items: [{ productId: 'p001', quantity: 1.5 }] })
ok(floatOrder.code === -1, 'createOrder 小数数量被拒')
const zeroOrder = await handlePublic(env, 'createOrder', { roomNumber: '305', items: [{ productId: 'p001', quantity: 0 }] })
ok(zeroOrder.code === -1, 'createOrder 零数量被拒')

// ---------- 新修复：付款截图 scheme 白名单 ----------
const badShot = await handlePublic(env, 'createOrder', {
  roomNumber: '305', items: [{ productId: 'p001', quantity: 1 }], paymentScreenshot: 'javascript:alert(1)',
})
ok(badShot.code === -1, 'createOrder 非白名单付款截图被拒')

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

// ---------- 新修复：评价图片 scheme 白名单 ----------
const badImg = await handlePublic(env, 'addPublicReview', { productOrder: 1, user: 'x', rating: 5, text: 'x', images: ['javascript:alert(1)'] })
ok(badImg.code === -1, 'addPublicReview 非白名单图片被拒')
const goodImg = await handlePublic(env, 'addPublicReview', { productOrder: 1, user: 'x', rating: 5, text: 'x', images: ['data:image/jpeg;base64,/9j/4AAQSkZJRg=='] })
ok(goodImg.code === 0, 'addPublicReview base64 dataURL 图片通过')
const badText = await handlePublic(env, 'addPublicReview', { productOrder: 1, user: 'x', rating: 5, text: '<script>alert(1)</script>' })
ok(badText.code === -1, 'addPublicReview 注入关键词文本被拒')

// ---------- 商品增改删（管理）----------
// 基线取增删前的 getProducts 总数（含下架），断言相对基线而非硬编码
const baseProducts = await handleAdmin(env, 'getProducts', 'test-key-123', {})
const created = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '测试可乐', price: 3.0, enabled: true })
ok(created.code === 0 && created.data?._id, `createProduct 成功 (${created.data?._id})`)
const afterCreate = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterCreate.data.length === baseProducts.data.length + 1, `getProducts 增至基线+1 (实际 ${afterCreate.data.length}, 基线 ${baseProducts.data.length})`)
const upd = await handleAdmin(env, 'updateProduct', 'test-key-123', { productId: created.data._id, price: 3.5 })
ok(upd.code === 0, 'updateProduct 成功')
const afterUpd = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterUpd.data.find((p) => p._id === created.data._id)?.price === 3.5, 'updateProduct 价格已更新为 3.5')

// ---------- 新修复：updateProduct enabled 守卫（未传 enabled 不重上架）----------
const offProd = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '下架测试', price: 1.0, enabled: false })
ok(offProd.code === 0 && offProd.data?._id, 'createProduct 创建下架商品')
const partialUpd = await handleAdmin(env, 'updateProduct', 'test-key-123', { productId: offProd.data._id, price: 2.0 })
ok(partialUpd.code === 0, 'updateProduct 部分更新成功')
const offAfter = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(offAfter.data.find((p) => p._id === offProd.data._id)?.enabled === false, 'updateProduct 未传 enabled 时保持下架（不静默重上架）')
const offDel = await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: offProd.data._id })
ok(offDel.code === 0, 'deleteProduct 删除下架测试商品')
const del = await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: created.data._id })
ok(del.code === 0, 'deleteProduct 成功')
const afterDel = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterDel.data.length === baseProducts.data.length, `deleteProduct 后回归基线 (实际 ${afterDel.data.length}, 基线 ${baseProducts.data.length})`)

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

// ---------- 新修复：登录限流（D1 计数，错误密钥也计数）----------
// loginOk + loginBad 已占 2 次；再连打 4 次错误密钥，第 4 次（总第 6 个请求）应触发限流
let limited = null
for (let i = 0; i < 4; i++) {
  const r = await handleAdmin(env, 'login', `wrong-${i}`, {})
  if (r.message && r.message.includes('操作过于频繁')) limited = r
}
ok(limited !== null, '连续错误登录触发 D1 限流（rate:login:{ip}）')

// ---------- 新修复：审计日志落表 ----------
const evRow = db.prepare('SELECT COUNT(*) AS c FROM security_events').get()
ok(Number(evRow.c) >= 10, `security_events 审计表有记录 (实际 ${evRow.c})`)
const evAuth = db.prepare("SELECT COUNT(*) AS c FROM security_events WHERE result = 'auth_failed'").get()
ok(Number(evAuth.c) >= 1, `认证失败已审计 (实际 ${evAuth.c})`)
const rateRow = db.prepare("SELECT COUNT(*) AS c FROM rate_limits WHERE bucket LIKE 'rate:login:%'").get()
ok(Number(rateRow.c) >= 1, `rate_limits 表有登录限流桶 (实际 ${rateRow.c})`)

// ---------- 新修复：只读密钥写拦截（2026-09-23 第三轮优化）----------
// ADMIN_WRITE_ACTIONS 曾漏掉 batch*/createOrder/recalculateOrders/add*/seedReviews/
// createSubmission，只读密钥可绕过批量改价与种子导入。以下断言锁定收口。
const roEnv = { DB: makeD1(db), ADMIN_KEY: 'test-key-123', ADMIN_READONLY_KEY: 'ro-key-456' }
const roBatchUpd = await handleAdmin(roEnv, 'batchUpdateProducts', 'ro-key-456', { items: [] })
ok(roBatchUpd.code === -1 && /只读/.test(roBatchUpd.message || ''), '只读密钥批量改价被拒')
const roBatchDel = await handleAdmin(roEnv, 'batchDeleteProducts', 'ro-key-456', { productIds: [] })
ok(roBatchDel.code === -1 && /只读/.test(roBatchDel.message || ''), '只读密钥批量删除被拒')
const roSeed = await handleAdmin(roEnv, 'seedReviews', 'ro-key-456', {})
ok(roSeed.code === -1 && /只读/.test(roSeed.message || ''), '只读密钥种子导入被拒')
const roRead = await handleAdmin(roEnv, 'getProducts', 'ro-key-456', {})
ok(roRead.code === 0, '只读密钥读商品列表放行（读权限不受影响）')

// ---------- 新修复：aiAdvice 独立限流（2026-09-23 P2 补齐）----------
// 该 action 触发全量查询 + Dify 推理，原先无独立限流。RATE_AI_ADVICE = 60s / 10 次；
// 第 11 次起应被拒。分桶 rate:aiadv:*，与公开 aiChat 的 rate:ai:* 互不影响。
const aiFirst = await handleAdmin(env, 'aiAdvice', 'test-key-123', {})
ok(aiFirst.code === 0 && aiFirst.data?.source === 'rule', `aiAdvice 正常返回（rule 兜底，source=${aiFirst.data?.source}）`)
let aiLimited = null
for (let i = 0; i < 12; i++) aiLimited = await handleAdmin(env, 'aiAdvice', 'test-key-123', {})
ok(aiLimited !== null && aiLimited.code === -1 && /频繁/.test(aiLimited.message || ''), 'aiAdvice 超过 10 次/分钟被限流')
const aiadvRow = db.prepare("SELECT COUNT(*) AS c FROM rate_limits WHERE bucket LIKE 'rate:aiadv:%'").get()
ok(Number(aiadvRow.c) >= 1, `rate_limits 表有 aiAdvice 限流桶 (实际 ${aiadvRow.c})`)

// ---------- 未知 action ----------
const unknown = await handleAdmin(env, 'noSuchAction', 'test-key-123', {})
ok(unknown.code === -1, '未知 action 返回 -1')

console.log(`\n==== 结果: ${pass} 通过 / ${fail} 失败 ====`)
if (fail) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
console.log('全部通过 ✅')
