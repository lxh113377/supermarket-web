// 本地后端契约验证：用 node:sqlite 模拟 D1 绑定，直接跑 functions/lib/backend.js 全部 action。
// 不需要 Cloudflare 账号 / wrangler / 网络。D1 即 SQLite，SQL 语法与运行时完全一致。
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createMeteredD1, runInSqlScope } from './lib/metered-d1.mjs'
import { shapeOf } from './lib/response-shape.mjs'
import { requireInputs, requireJson } from './lib/preflight.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
requireInputs('verify-backend', [join(root, 'db', 'schema.sql'), join(root, 'db', 'seed.sql'), join(root, 'functions', 'lib', 'backend.js')])
requireJson('verify-backend', [join(root, 'package.json')])

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'))
db.exec(readFileSync(join(root, 'db', 'seed.sql'), 'utf8'))

// ---- 模拟 D1 绑定：唯一实现见 scripts/lib/metered-d1.mjs（与往返判据共用一份 mock）----
// 此前本文件自带一份只实现 prepare/bind/all/first/run 的 mock，真 D1 的 batch() 在其上不存在 ⇒
// 「后端用了 batch 就测不出来」；改成共用件后 batch 语义（一次往返 + 失败整批回滚）在 CI 里同样可测。
// C1（对标第三轮）：每次 action 调用的 SQL 语句条数归因计数。
// 动机：D1 免费档有每调用查询数上限，循环里逐条 SELECT/UPDATE 的回归（N+1）必须在本门禁变红，
// 而不是等线上配额被打爆。基线 docs/sql-baseline.json 记录"单次调用峰值"，只允许下降；上升须显式改基线。
//
// 第二十七轮改了归因口径（结果集更硬，也更可复现）：原先是"全局计数器在 action 边界做差"，
// 隐含假设"一个 action 的语句都在自己的 await 窗口内跑完"。这个假设不成立 ——
// `createOrder` 的通知是刻意不 await 的（`maybeNotifyNewOrder`），未 await 的那部分会落进
// **下一个开始计数的 action** 的窗口。实测：`A:createProduct` 峰值未固定 Math.random 时 5 次跑出
// 4×2 + 1×3，固定种子后 6/6 恒为 3，而 createProduct 自己只发 1 条 INSERT ⇒ 抖的是归因不是被测代码。
// 现在按 AsyncLocalStorage 上下文归因：语句记在**发起它的那个 action** 头上，与执行顺序无关。
const SQL_PEAK = {}
// 摊销型清理单独立账（口径见 metered-d1 的 classify 注释）：审计保留裁剪以 5% 概率被顺带触发，
// 记在触发它的 action 头上就是测量误差，不是那次调用真的多查了一次它自己的活。
// 注意匹配口径：这条 SQL 里带 datetime('now', '-90 days') 这种"字面量内含空格"，
// 先把空白抹掉再匹配会让分类器永不命中（第二十八轮第一版就这么漏过一次，现象是"收回噪声带后立刻冒回归"）。
// 不用正则：这条 SQL 的 datetime(...) 参数里有空格与引号，正则转义在本仓的写入链路上已是第三次踩坑，
// 改成小写化之后的两个子串判断——'delete from security_events' 与 'datetime(' 同时在，就是那条摊销清理。
const isAmortizedAuditPurge = (sql) => {
  const s = String(sql).toLowerCase()
  return s.includes('delete from security_events') && s.includes('datetime(')
}
const D1 = createMeteredD1(db, {
  classify: (sql) => (isAmortizedAuditPurge(sql) ? 'amortized:audit-retention-purge' : null),
})
function noteSql(name, used) {
  SQL_PEAK[name] = Math.max(SQL_PEAK[name] || 0, used)
}

const backendUrl = pathToFileURL(join(root, 'functions', 'lib', 'backend.js')).href
const _backend = await import(backendUrl)

// ── 响应形状录制（第二十七轮）───────────────────────────────────────────
// 为什么录在这里而不是另写一份驱动脚本：`wrapHandle` 是本仓**唯一**的 action 出口，
// 而 verify-backend 已经带着真实 payload 把 26 个 action 跑过一遍（含失败分支）。
// 另起一份"契约生成器"就是第二份真相源，且必然退化成"我手写我认为会返回的字段"。
// 用法：RESPONSE_CONTRACT_OUT=<路径> node scripts/verify-backend.mjs
const SHAPE_OUT = process.env.RESPONSE_CONTRACT_OUT || null
const SHAPES = new Map()

function wrapHandle(raw, prefix) {
  return async (env, action, ...rest) => {
    // 归因走异步上下文（见上面 C1 段）：不 await 的副作用仍记在发起它的那个 action 上
    // 计数必须从 runInSqlScope 的返回值取：作用域一退出，getStore() 就读不到刚才那个 store 了
    const { result, statements, amortized } = await runInSqlScope(prefix + action, () => raw(env, action, ...rest))
    noteSql(prefix + action, statements)
    // 摊销语句按"桶"记（值是**全程累计次数**，不是单次峰值——它本来就不属于任何一次调用）
    for (const b of amortized || []) noteSql(b, (SQL_PEAK[b] || 0) + 1)
    if (SHAPE_OUT && action) {
      const side = prefix === 'A:' ? '/web' : '/pub'
      const key = `${side} ${action}`
      if (!SHAPES.has(key)) SHAPES.set(key, { side, action, ok: [], err: [], calls: 0 })
      const rec = SHAPES.get(key)
      rec.calls += 1
      const sig = shapeOf(result)
      const bucket = result && result.code === 0 ? rec.ok : rec.err
      if (!bucket.some((b) => JSON.stringify(b) === JSON.stringify(sig))) bucket.push(sig)
    }
    return result
  }
}
const handleAdmin = wrapHandle(_backend.handleAdmin, 'A:')
const handlePublic = wrapHandle(_backend.handlePublic, 'P:')
const env = { DB: D1, ADMIN_KEY: 'test-key-123' }

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

// ---------- 订单履约状态机 + 顾客侧进度（2026-09-24 对标补齐）----------
// 独立建单，避免干扰既有断言对该单状态的潜在依赖
const lifeOrder = await handlePublic(env, 'createOrder', { roomNumber: '306', items: [{ productId: 'p001', quantity: 1 }] })
const lid = lifeOrder.data?.id
ok(!!lid, '状态机测试单创建成功')
const sBogus = await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'bogus' })
ok(sBogus.code === -1 && /参数无效/.test(sBogus.message || ''), '非法状态值被拒（参数无效）')
const sSkip = await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'delivering' })
ok(sSkip.code === -1 && /不允许/.test(sSkip.message || ''), '跨态迁移被拒（pending→delivering）')
const sPaid = await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'paid' })
ok(sPaid.code === 0, '合法迁移：pending→paid')
const sSkip2 = await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'completed' })
ok(sSkip2.code === -1, '跨态迁移被拒（paid→completed）')
ok((await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'delivering' })).code === 0, '合法迁移：paid→delivering')
ok((await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'completed' })).code === 0, '合法迁移：delivering→completed')
const sBack = await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: lid, status: 'paid' })
ok(sBack.code === -1 && /不允许/.test(sBack.message || ''), '终态不可回退（completed→paid 被拒）')
const stPub = await handlePublic(env, 'getOrderStatus', { orderId: lid })
ok(stPub.code === 0 && stPub.data?.status === 'completed' && stPub.data?.orderId === lid, '顾客侧 /pub getOrderStatus 返回 completed')
const stNoKey = await handlePublic(env, 'getOrderStatus', {})
ok(stNoKey.code === -1, 'getOrderStatus 缺订单号被拒')
const stMiss = await handlePublic(env, 'getOrderStatus', { orderId: 'o_not_exist' })
ok(stMiss.code === -1 && /不存在/.test(stMiss.message || ''), 'getOrderStatus 订单不存在被拒')
const stAdmin = await handleAdmin(env, 'getOrderStatus', '', { orderId: lid })
ok(stAdmin.code === 0 && stAdmin.data?.status === 'completed', '/web 回退路径 getOrderStatus 免密钥可用（PUBLIC_ACTIONS）')

// ---------- 库存与防超卖（2026-09-24 用户裁决 C1）----------
const sp = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '库存测试汽水', price: 3.0, stock: 2 })
ok(sp.code === 0 && sp.data?.stock === 2, `createProduct 带 stock=2 生效 (实际 ${sp.data?.stock})`)
const sid = sp.data._id
const stockOf = async () => (await handleAdmin(env, 'getProducts', 'test-key-123', {})).data.find((p) => p._id === sid)?.stock
const overOrder = await handlePublic(env, 'createOrder', { roomNumber: '307', items: [{ productId: sid, quantity: 3 }] })
ok(overOrder.code === -1 && /库存不足/.test(overOrder.message || ''), 'stock=2 下单数量3 被拒')
ok(await stockOf() === 2, '被拒订单未扣减库存（补偿路径干净）')
const okOrder = await handlePublic(env, 'createOrder', { roomNumber: '307', items: [{ productId: sid, quantity: 2 }] })
ok(okOrder.code === 0, 'stock=2 下单数量2 成功（占用全部库存）')
ok(await stockOf() === 0, `下单后库存扣至 0 (实际 ${await stockOf()})`)
const soldOutOrder = await handlePublic(env, 'createOrder', { roomNumber: '307', items: [{ productId: sid, quantity: 1 }] })
ok(soldOutOrder.code === -1, '库存 0 再下单被拒')
ok((await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: okOrder.data.id, status: 'cancelled' })).code === 0, '取消占用订单')
ok(await stockOf() === 2, '取消回补库存至 2')
ok((await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: okOrder.data.id, status: 'pending' })).code === 0, '误取消恢复 pending → 重新占用')
ok(await stockOf() === 0, '重占用后库存回到 0')
ok((await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: okOrder.data.id, status: 'cancelled' })).code === 0, '再次取消回补')
const hog = await handlePublic(env, 'createOrder', { roomNumber: '308', items: [{ productId: sid, quantity: 2 }] })
ok(hog.code === 0, '他单占满库存')
const denyRestore = await handleAdmin(env, 'updateOrderStatus', 'test-key-123', { orderId: okOrder.data.id, status: 'pending' })
ok(denyRestore.code === -1 && /库存不足/.test(denyRestore.message || ''), '恢复时库存已被占用 → 拒绝且状态不动')
ok((await handleAdmin(env, 'getOrderStatus', '', { orderId: okOrder.data.id })).data?.status === 'cancelled', '被拒恢复后订单仍为 cancelled')
// 删除进行中单（hog=pending）= 占用作废回补
await handleAdmin(env, 'deleteOrder', 'test-key-123', { orderId: hog.data.id })
ok(await stockOf() === 2, `删除 pending 单回补库存 (实际 ${await stockOf()})`)
await handleAdmin(env, 'deleteOrder', 'test-key-123', { orderId: okOrder.data.id })
await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: sid })
const updStock = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '库存测试水', price: 1, stock: 100000 })
ok(updStock.data?.stock === 100000, 'createProduct 大库存透传')
const badStock = await handleAdmin(env, 'updateProduct', 'test-key-123', { productId: updStock.data._id, stock: 'abc' })
ok(badStock.code === 0 && (await (async () => (await handleAdmin(env, 'getProducts', 'test-key-123', {})).data.find((p) => p._id === updStock.data._id)?.stock)()) === -1, '非法库存值归一为 -1 不限售')
await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: updStock.data._id })
// ---------- 下单幂等（2026-09-24 对标第二轮 A1，对标 Medusa/Saleor/Vendure 三重防线）----------
// 前序断言已消耗 rate:write 配额；幂等与限流是两件事，本组从干净桶开始，互不污染
db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'rate:write:%'").run()
const countRoom = (room) => Number(db.prepare('SELECT COUNT(*) AS c FROM orders WHERE roomNumber = ?').get(room).c)
const stockProd = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '幂等测试可乐', price: 3, stock: 5 })
const spid = stockProd.data._id
const stockNow = async () => (await handleAdmin(env, 'getProducts', 'test-key-123', {})).data.find((p) => p._id === spid)?.stock
const iBody = (extra = {}) => ({ roomNumber: '309', items: [{ productId: spid, quantity: 2 }], requestId: 'verify-idem-1', ...extra })

const iFirst = await handlePublic(env, 'createOrder', iBody())
const iRetry = await handlePublic(env, 'createOrder', iBody())
ok(iFirst.code === 0 && iRetry.code === 0 && iRetry.data.id === iFirst.data.id,
  `同一 requestId 重复提交返回同一单号 (${iFirst.data?.id})`)
ok(iRetry.data.deduplicated === true, '重复提交响应带 deduplicated 标记（调用方可区分新单/复用）')
ok(countRoom('309') === 1, `重复提交库内只有 1 张单 (实际 ${countRoom('309')})`)
ok(await stockNow() === 3, `去重路径未双扣库存：5-2=3 (实际 ${await stockNow()})`)

const iEdited = await handlePublic(env, 'createOrder', iBody({ remark: '要冰的' }))
ok(iEdited.code === 0 && iEdited.data.id !== iFirst.data.id, '同键但载荷指纹变了 → 视为新单（不静默丢编辑）')

const legacy = () => handlePublic(env, 'createOrder', { roomNumber: '310', items: [{ productId: 'p001', quantity: 1 }] })
const lFirst = await legacy()
const lRetry = await legacy()
ok(lFirst.code === 0 && lRetry.data.id === lFirst.data.id && lRetry.data.deduplicated === true,
  '无 requestId 的旧客户端（SW 长缓存）内容重发命中 90s 指纹兜底')
const lChanged = await handlePublic(env, 'createOrder', { roomNumber: '310', items: [{ productId: 'p001', quantity: 1 }], remark: '加急' })
ok(lChanged.data.id !== lFirst.data.id, '无 requestId 时内容不同 → 正常下新单')
const keyRow = db.prepare('SELECT idempotencyKey FROM orders WHERE _id = ?').get(iFirst.data.id)
ok(/^309@verify-idem-1#[0-9a-f]{8}$/.test(keyRow?.idempotencyKey || ''), `幂等键入库可追溯 (实际 ${keyRow?.idempotencyKey})`)
const nullKeyRow = db.prepare('SELECT idempotencyKey FROM orders WHERE _id = ?').get(lFirst.data.id)
ok(nullKeyRow?.idempotencyKey == null, '无 requestId 的订单幂等键为 NULL（部分唯一索引不误伤）')

// ---------- 状态流转乐观锁（对标 litemall updateWithOptimisticLocker）----------
// 必须用**真实并发**测：handler 每次都重读 status，先改库再迁移只是"读到最新值"，不构成竞争。
// 两个迁移同时进来 → 双双读到 pending → UPDATE 带 `AND status = ?`，只有一个是 1 变更。
const { updateOrderStatus } = await import(pathToFileURL(join(root, 'functions', 'lib', 'actions', 'orders.js')).href)
const oLive = await handlePublic(env, 'createOrder', { roomNumber: '311', items: [{ productId: 'p001', quantity: 1 }] })
const race = await Promise.all([
  updateOrderStatus(env.DB, { orderId: oLive.data.id, status: 'paid' }),
  updateOrderStatus(env.DB, { orderId: oLive.data.id, status: 'cancelled' }),
])
const winners = race.filter((r) => r.code === 0).length
ok(winners === 1, `并发迁移只有一个胜出（乐观锁生效，实际成功 ${winners}/2）`)
const afterRace = await handleAdmin(env, 'getOrder', 'test-key-123', { orderId: oLive.data.id })
const loser = race.find((r) => r.code === -1)
ok(loser && /他人更新|刷新/.test(loser.message || ''), `落败方收到可重试提示: ${loser?.message}`)
ok(afterRace.data?.status === 'paid' || afterRace.data?.status === 'cancelled',
  `落库状态与胜者一致、无第三种脏值 (实际 ${afterRace.data?.status})`)

// ---------- 超时未支付单盘点（对标 litemall OrderUnpaidTask，只盘不砍）----------
const stale = await handlePublic(env, 'createOrder', { roomNumber: '312', items: [{ productId: spid, quantity: 1 }] })
db.prepare('UPDATE orders SET createdAt = ? WHERE _id = ?').run(new Date(Date.now() - 90 * 60_000).toISOString(), stale.data.id)
const rp = await handleAdmin(env, 'stalePendingReport', 'test-key-123', { minutes: 60 })
ok(rp.code === 0 && rp.data.count >= 1, `stalePendingReport 盘出超时 pending 单 (实际 ${rp.data?.count})`)
const rpRow = (rp.data.orders || []).find((o) => o.id === stale.data.id)
ok(rpRow && rpRow.ageMinutes >= 89 && rpRow.hasPaymentProof === false,
  `盘点项含账龄与支付凭证标记 (age=${rpRow?.ageMinutes}min proof=${rpRow?.hasPaymentProof})`)
const rpTie = (rp.data.stockReserved || []).find((s) => s.productId === spid)
ok(rpTie && rpTie.reserved >= 1, `超时单占用有限库存被统计 (${spid} reserved=${rpTie?.reserved})`)
ok((await handleAdmin(env, 'getOrderStatus', '', { orderId: stale.data.id })).data?.status === 'pending',
  '盘点是只读的：超时单状态未被自动改动（线下确认制下不自动砍单）')
const rpPub = await handlePublic(env, 'stalePendingReport', { minutes: 60 })
ok(rpPub.code === -1, 'stalePendingReport 未泄漏到公开端点（/pub 白名单外）')

// 清理本组测试数据（回归基线，防后续计数断言漂移）
for (const id of [iFirst.data.id, iEdited.data.id, lFirst.data.id, lChanged.data.id, oLive.data.id, stale.data.id]) {
  await handleAdmin(env, 'deleteOrder', 'test-key-123', { orderId: id })
}
await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: spid })

const pubWithStock = await handlePublic(env, 'getPublicProducts', {})
ok(pubWithStock.data.every((p) => typeof p.stock === 'number'), 'getPublicProducts 均带数值 stock（顾客端可售判断依据）')

// ---------- 可选口味 specOptions（后台开关的数据面，顾客端口味选择器靠它）----------
const flavorBad = Array.from({ length: 21 }, (_, i) => ({ label: `口味${i}` }))
const flavorProd = await handleAdmin(env, 'createProduct', 'test-key-123', {
  name: '口味测试薯片', price: 2.66,
  specOptions: [{ label: ' 黄瓜味 ' }, { label: '黄瓜味' }, { label: '   ' }, '垃圾字符串',
    { label: '烤虾味', enabled: false }, ...flavorBad],
})
const flavorOf = async () => (await handleAdmin(env, 'getProducts', 'test-key-123', {})).data.find((p) => p._id === flavorProd.data?._id)?.specOptions
ok(flavorProd.code === 0 && Array.isArray(await flavorOf()), `createProduct 透传 specOptions 并可回读 (实际 ${JSON.stringify(await flavorOf())?.slice(0, 40)})`)
const flavorSaved = await flavorOf()
ok(flavorSaved.length === 20, `口味去重去空截断到 20 项上限 (实际 ${flavorSaved?.length})`)
ok(flavorSaved[0].label === '黄瓜味' && flavorSaved[0].enabled === true, 'label 去首尾空白、缺省 enabled 视为显示')
ok(flavorSaved.some((o) => o.label === '烤虾味' && o.enabled === false), 'enabled:false 原样落库（后台关掉即顾客端不显示）')
ok(flavorSaved.every((o) => o && typeof o.label === 'string'), '任意非对象项被丢弃，不让脏 JSON 流到前端渲染')
const flavorPub = (await handlePublic(env, 'getPublicProducts', {})).data.find((p) => p.name === '口味测试薯片')?.specOptions
ok(Array.isArray(flavorPub) && flavorPub.length === 20, 'getPublicProducts 下发 specOptions（顾客端口味来源，不需管理密钥）')
const flavorClear = await handleAdmin(env, 'updateProduct', 'test-key-123', { productId: flavorProd.data._id, specOptions: 'not-an-array' })
ok(flavorClear.code === 0 && (await flavorOf()).length === 0, '非数组入参归零为空清单')
await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: flavorProd.data._id })

// ---------- 顾客所选口味必须落到订单（后台要知道这次要哪一包）----------
// 这段补的是「加购 → 下单落库」之间的判据盲区：口味在加购层被测过
// （tests/productDetailVariants.test.tsx 断 add 收到 '40g · 黄瓜味'），渲染层用自造夹具也测过
// （tests/ordersTab.test.tsx 直接塞 items），中间 createOrder 用目录静态 spec 覆盖掉顾客选择
// 这件事没有任何一道判据，所以线上表现为「后台看不到口味」而全绿。
const itemsOf = (id) => JSON.parse(db.prepare('SELECT items FROM orders WHERE _id = ?').get(id).items)
const flavorOrder = await handlePublic(env, 'createOrder', {
  roomNumber: '311', items: [{ productId: 'p033', quantity: 1, spec: '40g · 黄瓜味' }],
})
ok(itemsOf(flavorOrder.data.id)[0].spec === '40g · 黄瓜味',
  `顾客所选口味原样落库 (实际 ${JSON.stringify(itemsOf(flavorOrder.data.id)[0].spec)})`)
const adminRead = await handleAdmin(env, 'getOrders', 'test-key-123', { page: 1, pageSize: 100 })
ok(adminRead.data.find((o) => o._id === flavorOrder.data.id)?.items[0].spec === '40g · 黄瓜味',
  '管理端 getOrders 能读回该口味（用户报障的就是这一环看不到）')

// 口味只认商家在后台维护的清单：清单外的串、脏串、无口味商品一律回落商品真值，不原样入库
const spoofOrder = await handlePublic(env, 'createOrder', {
  roomNumber: '312',
  items: [
    { productId: 'p033', quantity: 1, spec: '40g · 鹤顶红味' },
    { productId: 'p033', quantity: 1, spec: '<script>alert(1)</script>' },
    { productId: 'p001', quantity: 1, spec: '随便编的规格' },
  ],
})
const spoofSpecs = itemsOf(spoofOrder.data.id).map((i) => i.spec)
ok(spoofSpecs[0] === '40g' && spoofSpecs[1] === '40g' && spoofSpecs[2] === '1L',
  `清单外/脏 spec 回落商品真值，不原样入库 (实际 ${JSON.stringify(spoofSpecs)})`)
const noSpecOrder = await handlePublic(env, 'createOrder', {
  roomNumber: '313', items: [{ productId: 'p033', quantity: 1 }],
})
ok(itemsOf(noSpecOrder.data.id)[0].spec === '40g', '旧客户端（SW 长缓存）不传 spec 时仍取目录 spec')
const flavorOffProd = await handleAdmin(env, 'createProduct', 'test-key-123', {
  name: '口味开关测试薯片', price: 2.66, spec: '40g',
  specOptions: [{ label: '毛血旺味' }, { label: '臭豆腐味', enabled: false }],
})
const offOrder = await handlePublic(env, 'createOrder', {
  roomNumber: '314',
  items: [
    { productId: flavorOffProd.data._id, quantity: 1, spec: '40g · 毛血旺味' },
    { productId: flavorOffProd.data._id, quantity: 1, spec: '40g · 臭豆腐味' },
  ],
})
const offSpecs = itemsOf(offOrder.data.id).map((i) => i.spec)
ok(offSpecs[0] === '40g · 毛血旺味' && offSpecs[1] === '40g',
  `后台关掉的口味(enabled:false)拒收、开着的接受 (实际 ${JSON.stringify(offSpecs)})`)
await handleAdmin(env, 'deleteProduct', 'test-key-123', { productId: flavorOffProd.data._id })

// 幂等双向：换口味=两张单（否则第二次选口味被吞回旧单，修了落库也看不到）；
// 但完全相同的重发必须照旧去重（防止把兜底改松这种"修一个坏一个"）
const fA = await handlePublic(env, 'createOrder', { roomNumber: '315', items: [{ productId: 'p033', quantity: 1, spec: '40g · 黄瓜味' }] })
const fB = await handlePublic(env, 'createOrder', { roomNumber: '315', items: [{ productId: 'p033', quantity: 1, spec: '40g · 烤虾味' }] })
ok(fA.data.id !== fB.data.id && fB.data.deduplicated !== true && countRoom('315') === 2,
  `同商品换口味再下单不被 90s 幂等吞掉 (库内 ${countRoom('315')} 张)`)
const fDup = await handlePublic(env, 'createOrder', { roomNumber: '315', items: [{ productId: 'p033', quantity: 1, spec: '40g · 黄瓜味' }] })
ok(fDup.data.id === fA.data.id && fDup.data.deduplicated === true && countRoom('315') === 2,
  `同口味原样重发仍命中去重 (实际 ${fDup.data.id === fA.data.id ? '去重' : '新单'}，库内 ${countRoom('315')} 张)`)

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

// ---------- 批量写：成功形状（第二十七轮补）----------
// 此前 batchUpdateProducts / batchDeleteProducts 在整条链里**只以"只读密钥被拒"的形式出现过**
// （见下方 roBatchUpd/roBatchDel），成功分支的形状从未被观测 ⇒ 契约对它们只能记"全是失败"。
// 新判据 verify:response 第一次跑就把这条抓出来（V3 未登记缺口），这里补真实成功路径而不是挂账。
const batchA = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '批量测试A', price: 2.0, stock: 5 })
const batchB = await handleAdmin(env, 'createProduct', 'test-key-123', { name: '批量测试B', price: 4.0, stock: 7 })
const batchUpd = await handleAdmin(env, 'batchUpdateProducts', 'test-key-123', {
  items: [{ productId: batchA.data._id, price: 2.5 }, { productId: batchB.data._id, enabled: false }],
})
ok(batchUpd.code === 0 && batchUpd.data && typeof batchUpd.data.updated === 'number',
  `batchUpdateProducts 成功且回传 updated 计数 (${JSON.stringify(batchUpd.data)})`)
const batchDel = await handleAdmin(env, 'batchDeleteProducts', 'test-key-123', { productIds: [batchA.data._id, batchB.data._id] })
ok(batchDel.code === 0 && batchDel.data && typeof batchDel.data.deleted === 'number',
  `batchDeleteProducts 成功且回传 deleted 计数 (${JSON.stringify(batchDel.data)})`)
const afterBatch = await handleAdmin(env, 'getProducts', 'test-key-123', {})
ok(afterBatch.data.length === baseProducts.data.length, `批量删后回归基线 (实际 ${afterBatch.data.length})`)

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
const roEnv = { DB: D1, ADMIN_KEY: 'test-key-123', ADMIN_READONLY_KEY: 'ro-key-456' }
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

// ---------- 补齐四条从未观测过成功形状的行动（第二十八轮，R27-M2）----------
// 上一轮的 `verify:response` 把"哪些 action 的成功形状从没被真实流量跑过"摊开成 12 条具名缺口，
// 其中 4 条本轮确认只缺 payload、不缺环境 ⇒ 在这里补上，缺口从 12 收到 8。
// 顺序刻意放在最后：这一段会新增/删除 reviews 行，跑在前面那些"评价数量"断言之后才不影响它们。
const vkShapeProbe = await handleAdmin(env, 'verifyKey', 'test-key-123')
ok(vkShapeProbe.code === 0 && typeof vkShapeProbe.role === 'string', `verifyKey 成功返回 role (${vkShapeProbe.role})`)
const revShapeProbe = await handleAdmin(env, 'addReview', 'test-key-123', { productOrder: 9001, rating: 4, text: '契约探针用的评价', user: 'shape-probe' })
ok(revShapeProbe.code === 0 && revShapeProbe.data?._id && revShapeProbe.data.id === revShapeProbe.data._id, `addReview 成功且 _id/id 同值 (${revShapeProbe.data?._id})`)
const revDelShapeProbe = await handleAdmin(env, 'deleteReview', 'test-key-123', { reviewId: revShapeProbe.data?._id })
ok(revDelShapeProbe.code === 0, 'deleteReview 成功（探针评价已回收，不影响后续数量断言）')
const dashShapeProbe = await handleAdmin(env, 'getDashboardStats', 'test-key-123', { rangeDays: 7 })
ok(dashShapeProbe.code === 0 && dashShapeProbe.data?.rangeData && Array.isArray(dashShapeProbe.data.rangeData.labels),
  `getDashboardStats 成功返回看板聚合 (${dashShapeProbe.data?.rangeData?.labels?.length} 天)`)

// ---------- 补齐第二批成功形状（第二十九轮，R28-M1）----------
// 这 6 条和上一批不同：它们**不缺环境，只缺"从另一条路由再调一次"**。
// `/web getPublicProducts|getPublicCategories|getReviews|addPublicReview|createOrder` 走的是顾客端 handler
// 的管理端回退路径（client.ts 没配 /pub 时就是这么用的）：同一段代码，但**路由、鉴权与响应信封是两回事**——
// 形状按 (side, action) 立约，所以"另一侧录过"不等于"这一侧被守"。
const webRouteProds = await handleAdmin(env, 'getPublicProducts', 'test-key-123', {})
ok(webRouteProds.code === 0 && Array.isArray(webRouteProds.data), `/web 回退路径 getPublicProducts 返回数组 (${webRouteProds.data?.length} 条)`)
const webRouteCats = await handleAdmin(env, 'getPublicCategories', 'test-key-123', {})
ok(webRouteCats.code === 0 && Array.isArray(webRouteCats.data), '/web 回退路径 getPublicCategories 返回数组')
const webRouteReviews = await handleAdmin(env, 'getReviews', 'test-key-123', { productOrder: 1 })
ok(webRouteReviews.code === 0 && Array.isArray(webRouteReviews.data), '/web 回退路径 getReviews 返回数组')
const webRouteAddRev = await handleAdmin(env, 'addPublicReview', 'test-key-123', { productOrder: 9002, rating: 3, text: '回退路径契约探针', user: 'web-route-probe' })
ok(webRouteAddRev.code === 0 && webRouteAddRev.data?._id, '/web 回退路径 addPublicReview 成功')
await handleAdmin(env, 'deleteReview', 'test-key-123', { reviewId: webRouteAddRev.data?._id })
const webRouteOrder = await handleAdmin(env, 'createOrder', 'test-key-123', {
  roomNumber: '305', items: [{ productId: 'p001', name: '测试可乐', price: 3, quantity: 1, subcategories: ['soda'] }],
})
ok(webRouteOrder.code === 0 && webRouteOrder.data?.id, `/web 管理端下单成功 (${webRouteOrder.data?.id})`)
await handleAdmin(env, 'deleteOrder', 'test-key-123', { orderId: webRouteOrder.data?.id })

// 提交侧两条：一条补 /pub 的成功形状（图片是可选的，之前挂"要带图"其实挂错了），
// 一条用刚建出来的提交去取 getSubmissionImages（它要求提交存在，不需要真带图）
const pubSub = await handlePublic(env, 'createSubmission', { serviceId: 's9', serviceName: '打印服务', formData: { 份数: '3' } })
ok(pubSub.code === 0 && (pubSub.data?.id || pubSub.data?._id), `/pub createSubmission 成功 (${JSON.stringify(pubSub.data)})`)
const imgsViaWeb = await handleAdmin(env, 'getSubmissionImages', 'test-key-123', { submissionId: pubSub.data?.id || pubSub.data?._id })
ok(imgsViaWeb.code === 0 && Array.isArray(imgsViaWeb.data?.images), `getSubmissionImages 返回 images 数组 (${JSON.stringify(imgsViaWeb.data?.images)})`)
await handleAdmin(env, 'deleteSubmission', 'test-key-123', { submissionId: pubSub.data?.id || pubSub.data?._id })

// ---------- C1：单次调用 SQL 语句数基线（只降不升）----------
const SQL_BASELINE_PATH = join(root, 'docs', 'sql-baseline.json')
const UPDATE_BASELINE = process.argv.includes('--update-sql-baseline')
// 峰值抖动采样（第二十七轮）：同一段代码下 `A:createProduct` 峰值会跑出 2 或 3（未固定 Math.random 时
// 5 次里 2 次为 3；固定种子后恒为 3）。机制本轮**未归因到底**，但结论与机制无关：
// 只要"基线"和"本轮实测"都各自是一次随机采样，这条配额闸就会随机变红 ⇒ 人很快学会无视它。
// 正解是把两边都变成**同口径的 N 次采样上界**：基线是 5 次取最大，本轮也是 5 次取最大。
const EMIT_PEAKS = (() => { const i = process.argv.indexOf('--emit-peaks'); return i >= 0 ? process.argv[i + 1] : null })()
// 采样次数默认 1：第二十八轮把抖动归因到那条 5% 采样的摊销清理并单独立账后，实测 12 轮单采样下
// 30 个 action 峰值全等（只有摊销桶自己在变）。采样能力留着 —— 未来再出现随机路径时把它调回去即可，
// 不必回头改判据逻辑。
const PEAK_SAMPLES = Math.max(1, Number(process.env.SQL_PEAK_SAMPLES || 1))

/** 采样 N 次（本进程算 1 次，其余用子进程），返回逐 action 的语句峰值上界。 */
function samplePeaks() {
  const merged = { ...SQL_PEAK }
  if (EMIT_PEAKS || PEAK_SAMPLES <= 1) return merged
  const self = fileURLToPath(import.meta.url)
  for (let i = 1; i < PEAK_SAMPLES; i++) {
    const tmpFile = join(tmpdir(), `sql-peak-sample-${process.pid}-${i}.json`)
    spawnSync(process.execPath, [self, '--emit-peaks', tmpFile], { cwd: root, encoding: 'utf8', timeout: 120_000 })
    try {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(tmpFile, 'utf8')))) merged[k] = Math.max(merged[k] || 0, v)
    } catch { console.error(`[sql-baseline] 第 ${i + 1} 次采样没写出峰值文件 ⇒ 本次上界少一个样本（不静默当"够"）`) }
    rmSync(tmpFile, { force: true })
  }
  return merged
}

const EMIT_LOG = (() => { const i = process.argv.indexOf('--emit-log'); return i >= 0 ? process.argv[i + 1] : null })()
if (EMIT_PEAKS) {
  writeFileSync(EMIT_PEAKS, JSON.stringify(SQL_PEAK, null, 2) + '\n')
  if (EMIT_LOG) {
    writeFileSync(EMIT_LOG, JSON.stringify(D1.__log.map((e) => ({
      scope: e.scope, kind: e.kind, sql: String(e.sql).replace(/\s+/g, ' ').slice(0, 88),
    })), null, 2) + '\n')
  }
} else if (UPDATE_BASELINE) {
  const merged = samplePeaks()
  writeFileSync(SQL_BASELINE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), peakStatements: merged, samples: PEAK_SAMPLES }, null, 2) + '\n')
  console.log(`[sql-baseline] 已按 ${PEAK_SAMPLES} 次采样取上界写入 ${Object.keys(merged).length} 个 action → docs/sql-baseline.json`)
} else {
  const measured = samplePeaks()
  let baseline = null
  try { baseline = JSON.parse(readFileSync(SQL_BASELINE_PATH, 'utf8')).peakStatements } catch { /* 缺文件按失败处理 */ }
  if (!baseline) {
    ok(false, 'sql-baseline.json 缺失/损坏（跑 node scripts/verify-backend.mjs --update-sql-baseline 生成）')
  } else {
    const keys = new Set([...Object.keys(baseline), ...Object.keys(measured)])
    // 第二十八轮：抖动归因到具体一条语句后，噪声带撤了。
    // 归因结论（可复跑）：functions/lib/security.js 的审计保留裁剪以 **5% 概率**顺带执行
    //   DELETE FROM security_events WHERE ts < datetime('now','-90 days')
    // 它记在"恰好触发它的那个 action"头上 ⇒ 上一版实测 11/30 个 action 峰值随机 +1、每轮换受害者，
    // 而全链总语句数几乎不变。现在这类语句按 classify 单独立到 amortized:* 桶（见 metered-d1），
    // **不参与逐 action 的峰值回归比较**（它是"全程发生了几次"的计数，不是某一次调用的开销），
    // 只在本轮信息行里报出来。归因修好后 12 轮单采样：31 个键里只有摊销桶自己在变。
    const amortized = [...keys].filter((k) => k.startsWith('amortized:'))
    for (const k of amortized) console.log(`INFO  摊销型后台清理 ${k}：本轮累计 ${measured[k] || 0} 次（不计入逐 action 峰值回归）`)
    for (const k of keys) {
      if (k.startsWith('amortized:')) continue
      const b = baseline[k], actual = measured[k] || 0
      if (b === undefined) { ok(false, `SQL 基线缺 action ${k}（新增调用路径？--update-sql-baseline 确认后入册）`); continue }
      if (actual > b) { ok(false, `SQL 语句数回归 ${k}: 峰值 ${actual} > 基线 ${b}`) }
    }
    ok(Object.keys(baseline).filter((k) => !k.startsWith('amortized:')).every((k) => measured[k] !== undefined),
      '基线内全部 action 本轮均有执行')
  }
}

// 录制结果落盘（哪怕本轮有断言失败也要落：形状是观测事实，不该被结论好坏决定写不写）
if (SHAPE_OUT) {
  const out = { version: 1, source: 'scripts/verify-backend.mjs 实测流量（wrapHandle 单点录制）', actions: {} }
  for (const [key, rec] of [...SHAPES.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.actions[key] = { side: rec.side, action: rec.action, calls: rec.calls, ok: rec.ok, err: rec.err }
  }
  writeFileSync(SHAPE_OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(`[response-shapes] 录制 ${Object.keys(out.actions).length} 个 (side,action) → ${SHAPE_OUT}`)
}

console.log(`\n==== 结果: ${pass} 通过 / ${fail} 失败 ====`)
if (fail) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
console.log('全部通过 ✅')
