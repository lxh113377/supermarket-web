#!/usr/bin/env node
/**
 * 本地"云端模式"验收桩（六轮新增）：静态伺服 dist-stub + 假 /web /pub 接口。
 *
 * 为什么需要它：管理端只有 IS_CLOUD=true 才渲染看板图表，而云端模式的入口要管理密钥。
 * 用生产密钥做浏览器验收 = 密钥进对话/日志（禁止）；只跑演示模式又永远走不到图表分支
 * （六轮实测：demo 模式下 getDashboardStats 无本地实现，直接显示"看板数据加载失败"）。
 * 本桩用**假密钥 + 假响应**把这条浏览器路径打通，专门给"真库渲染"级验证用。
 *
 *   node scripts/local-api-stub.mjs                 # 默认 http://localhost:5182
 *   node scripts/local-api-stub.mjs --dir dist-stub --port 5182
 * 配合：npx vite build --config vite.config.stub.js --outDir dist-stub
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const dir = resolve(root, arg('dir', 'dist-stub'))
const port = Number(arg('port', 5182))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.map': 'application/json' }

// /upload 桩的计数器（只用于生成不重复的假 key，见下方 handler 注释）
let uploadSeq = 0

// 与 functions/lib/actions/stats.js 的返回口径对齐（字段缺一个就是另一回事，别用 any 糊过去）
const STATS = {
  rangeDays: 90,
  rangeData: {
    labels: Array.from({ length: 12 }, (_, i) => `9/${i + 1}`),
    orderCounts: [3, 5, 2, 7, 4, 6, 1, 8, 5, 3, 6, 9],
    revenues: [30.5, 55, 22, 88, 41, 66, 12, 99, 57, 33, 61, 108],
  },
  delta: { ordersDelta: 0.12, revenueDelta: -0.03 },
  reviewTrend: { counts: [1, 0, 3, 2, 4, 1, 2, 0, 5, 3, 1, 2, 0, 4], labels: Array.from({ length: 14 }, (_, i) => `9/${i + 1}`) },
  margin: { drink: { revenue: 420, cost: 300, marginPct: 28.6 }, food: { revenue: 180, cost: 120, marginPct: 33.3 }, daily: { revenue: 60, cost: 40, marginPct: 33.3 }, withCostItems: 12, totalItems: 54 },
  pieSegments: [{ name: '饮品', value: 62 }, { name: '食品', value: 38 }, { name: '日用', value: 8 }],
  topRevenue: [
    { name: '可乐', revenue: 120.6, qty: 40 }, { name: '薯片', revenue: 80.4, qty: 30 },
    { name: '气泡水', revenue: 60.2, qty: 20 }, { name: '辣条', revenue: 30.1, qty: 12 },
    { name: '矿泉水', revenue: 22.4, qty: 10 }, { name: '面包', revenue: 18, qty: 8 },
    { name: '牛奶', revenue: 15.5, qty: 6 }, { name: '饼干', revenue: 12, qty: 5 },
    { name: '果汁', revenue: 9.8, qty: 4 }, { name: '咖啡', revenue: 6.6, qty: 3 },
  ],
  totalOrders: 96,
  orderSum: 96,
  revenueSum: 832.5,
}

/**
 * 后台两个 tab 的假数据（2026-10-24 补）。
 *
 * 为什么必须有：admin-contrast.spec.ts 的头注自己写着「桩没有 getAllReviews /
 * getSubmissions 两个 action」，并据此得出「本件只覆盖看板」。那个推理漏了一格：
 * 它说「商品/订单列表的数据态在视觉套件有真种子数据」，可评价 tab 在 demo 模式下
 * **也永远空** —— 一手核对 db/reviews.ts 的 getAllReviews 第一行是
 * `if (!IS_CLOUD) return []`，非云模式直接返回空数组，所以视觉套件那五条 admin-*
 * 路由扫到的都是空态。（对照：提交 tab 不是这样 —— getSubmissions 在非云模式会
 * safeParse 本地 sm_submissions，理论上能有数据；但 demo 构建里没人往里写，实测
 * 同样是空。）⇒ 两个 tab 的有数据态此前都没被任何判据扫过。
 * 而它们恰好是状态徽章 + 小字元信息最密的地方（text-3xs 徽章压彩色底，是本站出过
 * 缺陷的形态：首页打烊提示实测 4.44:1 差 0.06 不过 AA）。
 *
 * 形状对齐 src/types.ts 的 Review / Submission：评价带 productOrder（要能 join 到下面
 * PRODUCTS 的商品名，否则测不到那层映射）、星级、日期；提交带两种 status（pending/done）
 * 各一枚，因为状态徽章的配色是按 status 分支的，只造一种就等于没扫另一种。
 * 刻意**不**给 images/imageCount：图片按需加载要另打一个 action，且它不是文字对比度面。
 */
const PRODUCTS = [
  { _id: 'p_33', name: '乐事薯片', spec: '40g', price: 2.66, order: 33, enabled: true },
  { _id: 'p_46', name: '白象方便面', spec: '桶装', price: 3.66, order: 46, enabled: true },
  // 一条下架的：评价指向它时列表要显示「#order（已下架）」兜底，那也是一种文字态
  { _id: 'p_99', name: '老冰棍', spec: '支', price: 1.5, order: 99, enabled: false },
]

const REVIEWS = [
  { _id: 'rv_1', productOrder: 33, user: '小鱼', rating: 5, text: '第二天送到寝室楼下，很及时。', date: '2026-10-20' },
  { _id: 'rv_2', productOrder: 46, user: '阿哲', rating: 4, text: '味道可以，就是桶有点压瘪。', createdAt: '2026-10-18T09:12:00.000Z' },
  { _id: 'rv_3', productOrder: 99, user: '匿名用户', rating: 2, text: '冰都化了，建议注意保温。', createdAt: '2026-10-15T14:30:00.000Z' },
  // 星级 1 的那条把空星数量拉到最多。核实过：ReviewsTab 的 Stars 是**单一**
  // text-amber-600，空星 ☆ 只是字符不同、颜色相同 ⇒ 低分不会引入另一套灰度
  // （我第一版这里写的是「空星是另一套灰度」，把「新增评价表单里的未选星」混成了
  //  这个展示组件 —— 那是 2026-10-23 openReviewForm 那条路由的对象，不是这里）。
  { _id: 'rv_4', productOrder: 33, user: 'K', rating: 1, text: '包装漏气，退款处理还行。', date: '2026-10-12' },
]

const SUBMISSIONS = [
  {
    _id: 'sub_1', serviceId: 'express', serviceName: '快递代拿', categoryId: 'life', categoryName: '生活',
    formData: { '楼栋房号': '36栋-501', '取件码': '8-3-2210', '备注': '下午两点后都在宿舍' },
    status: 'pending', createdAt: '2026-10-24T01:20:00.000Z',
  },
  {
    _id: 'sub_2', serviceId: 'print', serviceName: '校园打印', categoryId: 'study', categoryName: '学习',
    formData: { '联系电话': '13800000000', '份数': '3' },
    status: 'done', createdAt: '2026-10-22T08:05:00.000Z',
  },
]

/**
 * 后台订单页签的有数据态（2026-10-24 补）。
 *
 * 为什么必须有：上一轮补评价/提交两个 tab 时查明「桩没有某 action ⇒ 该 tab 在
 * 判据里永远空」这一类盲区，订单 tab 是同一形状的**剩余那一块**：getOrders 此前
 * 直接回空数组，而 getAllOrders 在非云模式读本地（demo 里也空）⇒ 订单行、超时未确认
 * 面板、满减档位面板、事件时间线**四块**从未被任何判据扫过。后三块还各有门槛：
 * stale 要 stalePendingReport.count>0 且默认收起、促销要 getPromotions 返回数组且默认
 * 收起、时间线要 getEventLog 且逐单点击展开 ⇒ 光有列表数据也扫不到它们。
 *
 * 形状逐条核对过源码，不是凭印象：
 *   Order        → src/types.ts（_id/roomNumber/items/totalAmount/discountAmount/status/createdAt）
 *   口味徽章     → splitOrderSpec 按 SPEC_FLAVOR_SEP 切，该常量实测是 ' · '（三个字符），
 *                  所以 spec 写 "40g · 黄瓜味" 才会拆出 flavor 并渲染那枚 text-3xs 徽章
 *   StaleReport  → OrdersTab 内联 interface（thresholdMinutes/count/orders[]/stockReserved[]）
 *   PromotionTier→ src/types.ts（含嵌套 hits{orders,totalDiscount}）
 *   OrderEventItem→ src/db/orders.ts（type/at/orderId/status/totalAmount/discountAmount/createdAt）
 *
 * 状态覆盖 pending / paid / delivering / cancelled 各一条：状态 select 的选项由
 * nextOrderStatuses(status) 按状态机派生（cancelled 只能回 pending，completed 无后继），
 * 只造一种就等于没扫其余分支的 option 文案。
 *
 * ⚠️ 一处桩的固有局限（不是数据问题，记下来免得被当成覆盖了）：dispatch 只接 action
 *   名、不接 payload ⇒ getEventLog 无法按 orderId 区分，所有订单展开都看到同一组事件。
 *   本件量的是"时间线渲染出来的文字看不看得见"，不是"事件是否归属正确"（后者由
 *   functions 侧的 action 测试管）。
 */
const ORDERS = [
  {
    _id: 'ord_1', roomNumber: '36栋-501', status: 'pending',
    items: [
      // 带口味分隔符的一条：要触发「口味 X」那枚 text-3xs 品牌色徽章
      { productId: 'p_33', name: '乐事薯片', spec: '40g · 黄瓜味', price: 2.66, quantity: 2 },
      { productId: 'p_46', name: '白象方便面', spec: '桶装', price: 3.66, quantity: 1 },
    ],
    totalAmount: 8.98, discountAmount: 1.0, promotionId: 'promo_1',
    createdAt: '2026-10-24T01:10:00.000Z', updatedAt: '2026-10-24T01:10:00.000Z',
  },
  {
    _id: 'ord_2', roomNumber: '12栋-308', status: 'paid',
    items: [{ productId: 'p_1', name: '农夫山泉', spec: '550ml', price: 1.5, quantity: 6 }],
    totalAmount: 9.0, discountAmount: 0,
    createdAt: '2026-10-23T10:02:00.000Z', updatedAt: '2026-10-23T11:40:00.000Z',
  },
  {
    _id: 'ord_3', roomNumber: '8栋-1202', status: 'delivering',
    items: [{ productId: 'p_22', name: '有糖可乐', spec: '罐装330ml', price: 2.88, quantity: 3 }],
    totalAmount: 8.64, discountAmount: 0,
    createdAt: '2026-10-23T09:15:00.000Z', updatedAt: '2026-10-23T09:50:00.000Z',
  },
  {
    _id: 'ord_4', roomNumber: '21栋-706', status: 'cancelled',
    items: [{ productId: 'p_33', name: '乐事薯片', spec: '40g', price: 2.66, quantity: 1 }],
    totalAmount: 2.66, discountAmount: 0,
    createdAt: '2026-10-21T20:30:00.000Z', updatedAt: '2026-10-22T08:00:00.000Z',
  },
]

const STALE_REPORT = {
  thresholdMinutes: 60,
  count: 2,
  orders: [
    { id: 'ord_1', roomNumber: '36栋-501', totalAmount: 8.98, ageMinutes: 137, hasPaymentProof: true },
    { id: 'ord_4', roomNumber: '21栋-706', totalAmount: 2.66, ageMinutes: 95, hasPaymentProof: false },
  ],
  stockReserved: [
    { productId: 'p_33', name: '乐事薯片', reserved: 2 },
    { productId: 'p_46', name: '白象方便面', reserved: 1 },
  ],
}

const PROMOTIONS = [
  { _id: 'promo_1', name: '满 8 减 1', threshold: 8, discount: 1, enabled: true, hits: { orders: 26, totalDiscount: 26 } },
  { _id: 'promo_2', name: '满 20 减 3（已停用）', threshold: 20, discount: 3, enabled: false, hits: { orders: 0, totalDiscount: 0 } },
]

const EVENT_LOG = [
  { type: 'create', status: 'pending', orderId: 'ord_1', at: '2026-10-24T01:10:00.000Z', totalAmount: 8.98, discountAmount: 1, createdAt: '2026-10-24T01:10:00.000Z' },
  { type: 'proof', status: 'pending', orderId: 'ord_1', at: '2026-10-24T01:31:00.000Z', totalAmount: 8.98, discountAmount: 1, createdAt: '2026-10-24T01:10:00.000Z' },
  { type: 'status', status: 'paid', orderId: 'ord_1', at: '2026-10-24T02:05:00.000Z', totalAmount: 8.98, discountAmount: 1, createdAt: '2026-10-24T01:10:00.000Z' },
]

function dispatch(action) {
  switch (action) {
    case 'login': return { code: 0, data: { role: 'admin' } }
    // verifyKey 必须有：AdminGuard 挂载时若 sessionStorage 里有密钥就会校验它。
    // 缺这个 case 会落到 default 的 code:-1，浏览器用例里任何 reload/二次进入都被弹回密钥框。
    case 'verifyKey': return { code: 0, data: { role: 'admin' } }
    case 'getDashboardStats': return { code: 0, data: STATS }
    case 'getProducts': return { code: 0, data: PRODUCTS }
    case 'getOrders': return { code: 0, data: ORDERS, hasMore: false }
    case 'getAllReviews': return { code: 0, data: REVIEWS }
    case 'getSubmissions': return { code: 0, data: SUBMISSIONS }
    case 'stalePendingReport': return { code: 0, data: STALE_REPORT }
    case 'getPromotions': return { code: 0, data: PROMOTIONS }
    case 'getEventLog': return { code: 0, data: { orderId: 'ord_1', events: EVENT_LOG } }
    case 'getPublicCategories': return { code: 0, data: [{ _id: 'c1', name: '饮品', subcategories: [] }] }
    case 'getPublicProducts': return { code: 0, data: [] }
    case 'aiAdvice': return { code: 0, data: { content: '（本地桩）示例建议：关注饮品毛利。', source: 'rule' } }
    default: return { code: -1, message: `stub: 未实现 action ${action}` }
  }
}

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]
  // 打印文件直传桩（2026-10-07）：生产实现是 Pages Functions 的 /upload（multipart → R2）。
  // 本桩不落盘、只回一个假 key —— 让 `serve:stub` 模式下打印页能走**直传路径**（而不是
  // 前端降级到内联），从而把"上传成功 → 提交带 r2: 引用 → 后台显示下载入口"整条链在本地演完。
  // 假 key 形如 stub-<n>.pdf：后台 resolvePrintFileUrl 因 VITE_R2_PUBLIC_BASE 未配而显示"未配置下载基址"，
  // 这正是预期的降级形态，不算 bug。
  if (req.method === 'POST' && url === '/upload') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const n = ++uploadSeq
    const payload = JSON.stringify({ code: 0, data: { key: `stub/2026-10/local-${n}.bin`, size: chunks.reduce((s, c) => s + c.length, 0) } })
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end(payload)
    console.log(`[stub] /upload -> ${payload.length}B (${chunks.reduce((s, c) => s + c.length, 0)}B body)`)
    return
  }
  if (req.method === 'POST' && (url === '/web' || url === '/pub')) {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let action = ''
      try { action = JSON.parse(body || '{}').action || '' } catch { /* 保持空 action 走默认分支 */ }
      const payload = JSON.stringify(dispatch(action))
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(payload)
      console.log(`[stub] ${url} ${action} -> ${payload.length}B`)
    })
    return
  }
  const rel = normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[/\\])+/, '')
  const file = join(dir, rel)
  try {
    const info = await stat(file)
    if (info.isDirectory()) throw new Error('dir')
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(await readFile(file))
  } catch {
    // SPA 用 HashRouter，非资源路径一律回 index.html
    try {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
      res.end(await readFile(join(dir, 'index.html')))
    } catch {
      res.writeHead(404).end('not found')
    }
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[stub] http://localhost:${port}  目录=${dir}  （/web /pub 走假响应）`)
})
