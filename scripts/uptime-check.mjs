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

/**
 * 一次取数（不含重试）。抽出来是为了让重试逻辑可被 --selftest 用假 fetcher 判。
 */
async function attempt(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'chaoshi-uptime/1.0' } })
    return { status: res.status, body: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

export const ATTEMPTS = 3
export const BACKOFF_MS = 1500

/**
 * 取数：只对「问都没问到」重试，不对「服务器的判决」重试。
 *
 * 为什么分这一刀（2026-10-23 一手）：本机跑本件时顾客端那条抛 TypeError，
 * 而同一个 URL 用 curl 与裸 fetch 都是 200 —— 本机代理（127.0.0.1:7897）瞬时抖动。
 * 抛错 = 取数面坏了（网络/代理/DNS），它不是「线上挂了」的证据 ⇒ 重试是有据的；
 * 而 404/503 是活着的服务器给出的真实结论 ⇒ 重试只会拖慢告警，绝不改变结论。
 * 混起来的代价不是吵一次：本仓 backupLiveness.test.js 记着 uptime.yml 曾
 * 「每夜都在跑、全是 failure」—— 误报烧掉的是整条告警链的信用。
 *
 * 措辞也跟着改：报「连续 N 次取不到」而不是裸抛错名，让邮件自己说清这不是单次抖动。
 */
export async function getWithRetry(url, { fetcher = attempt, sleep, attempts = ATTEMPTS, backoff = BACKOFF_MS } = {}) {
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  let lastErr = null
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetcher(url)
      return { status: r.status, body: r.body, attempts: i }
    } catch (e) {
      lastErr = e
      if (i < attempts) await nap(backoff * i)
    }
  }
  const name = lastErr && (lastErr.name || lastErr.message) ? (lastErr.name || lastErr.message) : String(lastErr)
  throw new Error(name + '（连续 ' + attempts + ' 次取不到，非单次抖动）')
}

const get = (url) => getWithRetry(url)

/**
 * 判据自证（`node scripts/uptime-check.mjs --selftest`）：只判重试的分寸，不触网。
 * 三条腿各自只断言一件事，且都是「反着来就会红」的形状：
 *  腿1 前两次抛错、第三次成功 ⇒ 必须成功且恰好试 3 次（证明真在重试，不是恒绿）；
 *  腿2 第一次就回 503 ⇒ 必须**只试 1 次**就把 503 如实交出去（证明不对结论重试 ——
 *     这条是牙齿：一旦有人把它改成「非 200 就重试」，本腿当场红）；
 *  腿3 三次全抛 ⇒ 必须红，且措辞含「连续 3 次」（证明误报烧完就响亮认，不伪装成单次抖动）。
 */
function selftest() {
  const results = []
  const t = async (label, fn) => {
    try {
      const detail = await fn()
      results.push([true, label, detail])
    } catch (e) {
      results.push([false, label, String(e && e.message ? e.message : e)])
    }
  }
  const noSleep = () => Promise.resolve()
  return (async () => {
    await t('腿1 抛错两次后成功 ⇒ 重试确实发生', async () => {
      let calls = 0
      const r = await getWithRetry('https://example.invalid/x', {
        fetcher: async () => { calls++; if (calls < 3) throw new Error('proxy blip'); return { status: 200, body: 'ok' } },
        sleep: noSleep,
      })
      if (r.status !== 200) throw new Error('最终状态 ' + r.status)
      if (calls !== 3) throw new Error('调用次数 ' + calls + '（期望 3）')
      return '第 3 次拿到 200，共试 ' + calls + ' 次'
    })
    await t('腿2 服务器回 503 ⇒ 只试 1 次且如实交出结论', async () => {
      let calls = 0
      const r = await getWithRetry('https://example.invalid/y', {
        fetcher: async () => { calls++; return { status: 503, body: 'down' } },
        sleep: noSleep,
      })
      if (r.status !== 503) throw new Error('状态被改写为 ' + r.status)
      if (calls !== 1) throw new Error('对结论重试了：调用 ' + calls + ' 次（期望 1）')
      return '503 原样上报，未重试'
    })
    await t('腿3 连续取不到 ⇒ 判红且措辞点明非单次', async () => {
      let calls = 0
      let msg = ''
      try {
        await getWithRetry('https://example.invalid/z', {
          fetcher: async () => { calls++; throw new TypeError('TypeError') },
          sleep: noSleep,
        })
      } catch (e) { msg = String(e.message) }
      if (calls !== ATTEMPTS) throw new Error('调用 ' + calls + ' 次（期望 ' + ATTEMPTS + '）')
      if (!/连续 3 次/.test(msg)) throw new Error('措辞未点明重试次数：' + msg)
      return msg
    })
    const bad = results.filter(([ok]) => !ok)
    for (const [ok, label, detail] of results) console.log((ok ? 'PASS  ' : 'FAIL  ') + label + ' :: ' + detail)
    console.log('[uptime-check] selftest ' + (results.length - bad.length) + '/' + results.length)
    return bad.length ? 1 : 0
  })()
}

if (args.includes('--selftest')) {
  process.exit(await selftest())
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
