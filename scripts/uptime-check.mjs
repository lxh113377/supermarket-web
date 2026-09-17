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

if (failures.length) {
  console.error('❌ 探活失败：')
  for (const f of failures) console.error(`   · ${f}`)
  process.exit(1)
}
console.log('✅ 探活通过')
