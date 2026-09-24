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
  margin: { drink: { revenue: 420, cost: 300, marginPct: 28.6 }, food: { revenue: 180, cost: 120, marginPct: 33.3 }, withCostItems: 12, totalItems: 54 },
  pieSegments: [{ name: '饮品', value: 62 }, { name: '食品', value: 38 }],
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

function dispatch(action) {
  switch (action) {
    case 'login': return { code: 0, data: { role: 'admin' } }
    case 'getDashboardStats': return { code: 0, data: STATS }
    case 'getProducts': return { code: 0, data: [] }
    case 'getOrders': return { code: 0, data: [], hasMore: false }
    case 'getPublicCategories': return { code: 0, data: [{ _id: 'c1', name: '饮品', subcategories: [] }] }
    case 'getPublicProducts': return { code: 0, data: [] }
    case 'aiAdvice': return { code: 0, data: { content: '（本地桩）示例建议：关注饮品毛利。', source: 'rule' } }
    default: return { code: -1, message: `stub: 未实现 action ${action}` }
  }
}

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]
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
