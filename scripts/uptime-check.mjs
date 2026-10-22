// 生产探活（2026-09-18 双向迭代 R5 收尾）
// 用途：定时检查 管理端/API 与 微信顾客端 是否可用；失败以非零退出码上报（由 CI 定时任务转为邮件告警）。
// 设计：逻辑独立成脚本（而非塞在 YAML 里），因此可本地直接运行验证：
//   node scripts/uptime-check.mjs            # 默认探测线上
//   node scripts/uptime-check.mjs --base=... # 指向其他环境
const TIMEOUT_MS = 12000

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const API_BASE = getArg('base', 'https://supermarket-web.pages.dev')
const WEB_BASE = getArg('web', 'https://lxh113377.github.io')

async function get(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'chaoshi-uptime/1.0' } })
    return { status: res.status, body: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

const failures = []

// ① 后端探活：结构 + db 连通 + AI 配置态可读（不校验具体值，避免 Dify 未配置时误报）
try {
  const { status, body } = await get(`${API_BASE}/_health`)
  if (status !== 200) {
    failures.push(`/_health HTTP ${status}`)
  } else {
    const data = JSON.parse(body)
    if (data.status !== 'ok') failures.push(`/_health status=${data.status}`)
    if (data.db !== 'ok') failures.push(`/_health db=${data.db}（D1 不可用）`)
    console.log(`  /_health → ${body.trim()}`)
  }
} catch (e) {
  failures.push(`/_health 请求异常：${e?.name || e?.message}`)
}

// ② 管理端静态站可达
try {
  const { status } = await get(`${API_BASE}/`)
  if (status !== 200) failures.push(`管理端首页 HTTP ${status}`)
  else console.log('  管理端首页 → 200')
} catch (e) {
  failures.push(`管理端首页请求异常：${e?.name || e?.message}`)
}

// ③ 微信顾客端可达（微信入口，挂了影响下单）
try {
  const { status } = await get(`${WEB_BASE}/`)
  if (status !== 200) failures.push(`顾客端首页 HTTP ${status}`)
  else console.log('  微信顾客端 → 200')
} catch (e) {
  failures.push(`顾客端请求异常：${e?.name || e?.message}`)
}

// ④ 打印页（= 外站校园打印应用的本机静态面）可达，且**页面本体仍是那个应用**。
// 判据：标题含「校园打印」—— 静态面若被回退成旧页/构建产物缺失，这里就红。
async function printPage(base, label) {
  try {
    const { status, body } = await get(`${base}/print/`)
    if (status !== 200) { failures.push(`${label} 打印页 HTTP ${status}`); return }
    if (!/校园打印/.test(body)) { failures.push(`${label} 打印页标题不含「校园打印」⇒ 静态面已不是 CampusPrint-V1 的内容`); return }
    console.log(`  ${label} 打印页 → 200（校园打印静态面在册）`)
  } catch (e) {
    failures.push(`${label} 打印页请求异常：${e?.name || e?.message}`)
  }
}
await printPage(API_BASE, '管理端')
await printPage(WEB_BASE, '顾客端')

// ⑤ 打印后端的同源反代可达（= 顾客真能上传/出价）。
// 为什么单独一条：④ 只判静态面在不在；后端（本机 Node 服务 + 隧道 / 或未来的服务器）挂掉时
// 页面照样 200、照样能填表，但 /api 一律 503 ⇒ 顾客点了「我已付款」也提不了单。
// 这一条红 = 打印下单链路断，不是页面红 —— 措辞分开写，免得半夜邮件把人引到错的方向。
try {
  const { status, body } = await get(`${API_BASE}/api/public/config`)
  if (status !== 200) {
    let code = ''
    try { code = JSON.parse(body)?.error?.code || '' } catch { /* 非 JSON 就不猜 */ }
    failures.push(`打印后端反代 HTTP ${status}${code ? ' code=' + code : ''}`
      + '（静态面可看但下单链路断：查 CAMPUS_PRINT_ORIGIN 与那台 CampusPrint 服务是否在线）')
  } else console.log('  打印后端反代 /api/public/config → 200')
} catch (e) {
  failures.push(`打印后端反代请求异常：${e?.name || e?.message}`)
}

if (failures.length) {
  console.error('❌ 探活失败：')
  for (const f of failures) console.error(`   · ${f}`)
  process.exit(1)
}
console.log('✅ 探活通过')
