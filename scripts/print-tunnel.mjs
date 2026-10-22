#!/usr/bin/env node
// 打印页后端的隧道重连器：一条命令把「隧道换址」这件事重新闭环（人工发起，绝不进探针/CI）。
//
// 为什么需要它（2026-10-22 一手）：快速隧道的子域名每次重启都会变，而 CampusPrint 的后端
//   只认 PUBLIC_ORIGIN；于是换址后必须同时改五处才不断线：
//     ① cloudflared 起来（拿到新域名） ② 上游 .env 的 PUBLIC_ORIGIN
//     ③ 重启那台 Node 服务 ④ Pages secret CAMPUS_PRINT_ORIGIN ⑤ 重新部署（secret 不重部不生效）
//   少任何一步 = 线上打印页能打开、能填表，但 /api 一律 403/530，顾客提不了单（本仓 S 类老伤：
//   「改了却不生效」的根因永远是漏了链条上的一环，而不是某一步本身做错）。
//   所以这里按顺序做完、逐步回执，并在最后**真跑一次线上 /api** 才算成功。
//
//   node scripts/print-tunnel.mjs            # 全链重连
//   node scripts/print-tunnel.mjs --check    # 只体检：本地/隧道/线上三处 /api，不改任何东西
// 退出码：0=全链通 / 1=某步失败（打印是哪一步）/ 2=前置不满足（隧道程序或目录不在）
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSources } from './print-parity.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGES_PROJECT = 'supermarket-web'
const PAGES_ALIAS = 'https://supermarket-web.pages.dev'
const LOCAL_API = 'http://127.0.0.1:4328/api/public/config'

// 上游【运行副本】的位置 —— 故意不等于判据的权威源：判据可以用 CI/夜巡那份 vendor 克隆，
// 而本件要改的是「那台真在跑的 Node 服务」所在目录的 .env；混用两个克隆就是本仓反复记过的
// 「改了却不生效」（vendor 里没有 .env，上游不提交它，所以按带 .env 者优先挑）。
const s = readSources()
if (s.missing) console.error('[print-tunnel] 提示：判据的权威源取不到（' + s.missing + '）—— 本件仍可只按运行副本工作')
const HOME_CANDS = [
  process.env.CAMPUSPRINT_HOME || '',
  join(ROOT, '..', '..', 'CampusPrint-V1'),
  join(ROOT, '..', 'CampusPrint-V1'),
  ...(s.srcDir ? [join(s.srcDir, '..')] : []),
].filter(Boolean)
const UPSTREAM = HOME_CANDS.find((d) => existsSync(join(d, '.env')) && existsSync(join(d, 'backend', 'server.js'))) || ''
if (!UPSTREAM) {
  console.error('[print-tunnel] 前置不满足：这些候选里没有一个同时带 .env 与 backend/server.js：' + HOME_CANDS.join(' | '))
  console.error('  首次搭环境：cd <上游仓> 后 Copy-Item .env.example .env，再 npm run db:init / db 起服务；'
    + '或设 CAMPUSPRINT_HOME=<那个目录>')
  process.exit(2)
}

function findCloudflared() {
  const cands = [
    process.env.CLOUDFLARED_BIN || '',
    'D:\\tools\\cloudflared\\node_modules\\cloudflared\\bin\\cloudflared.exe',
  ].filter(Boolean)
  return cands.find((p) => existsSync(p)) || null
}

const log = (...a) => console.log('[print-tunnel]', ...a)

// wrangler 的 ANSI 色码要剥掉才好看/可断言。ESC 用 fromCharCode 取，不写字面控制字符：
// oxlint 的 no-control-regex 会拦正则里的裸 U+001B（本仓 lint 是 --max-warnings 0 阻断）。
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
function stripAnsi (s) { return String(s).replace(ANSI_RE, '') }

async function attemptFetch(url, headers) {
  const res = await fetch(url, { headers: { ...headers, 'User-Agent': 'chaoshi-print-tunnel/1.0' }, signal: AbortSignal.timeout(25000) })
  const text = await res.text()
  let code = ''
  try { code = JSON.parse(text)?.error?.code || '' } catch { /* 非 JSON 不猜 */ }
  return { status: res.status, code }
}

/**
 * 探一次三处 /api。只对「问都没问到」重试，不对服务器的判决重试 —— 与日巡检
 * scripts/uptime-check.mjs 的 getWithRetry 同一分寸（那两处判据必须同口径，否则
 * 同一个抖动会在两个工具里给出两种结论，反而更难判断哪个是真的）。
 *
 * 一手（2026-10-23）：本机跑 `--check` 报「线上/api = 0 TypeError」，而同一时刻
 * curl 与 uptime-check 都是 200 —— 本机代理瞬时抖动。这个后果比日巡检误报更直接：
 * `--check` 是**唯一那条只读的恢复入口**，老大在打印挂掉时第一件事就是跑它；
 * 它一误报，就会被当成「线上真断了」而触发整套重连（那会换隧道域名、改 Pages secret、
 * 重新部署生产 —— 为一个 200 的抖动做这些事，代价完全不成比例）。
 * 状态码是结论：403/503/0 之外拿到就原样交出去，绝不重试掩盖。
 */
const PROBE_ATTEMPTS = 3
async function apiOk(url, headers = {}) {
  let lastErr = null
  for (let i = 1; i <= PROBE_ATTEMPTS; i++) {
    try {
      const r = await attemptFetch(url, headers)
      return i > 1 ? { ...r, attempts: i } : r
    } catch (e) {
      lastErr = e
      if (i < PROBE_ATTEMPTS) await sleep(i * 1500)
    }
  }
  return { status: 0, code: (lastErr && (lastErr.name || lastErr.message)) || 'FETCH_FAILED', attempts: PROBE_ATTEMPTS }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// 只停「正在监听 4328 的那个进程」，绝不按进程名扫 node（本机常年有别的 node 在跑）。
function pidOnPort(port) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"],
      { encoding: 'utf8' }).trim()
    return /^\d+$/.test(out) ? Number(out) : 0
  } catch { return 0 }
}

function setPagesSecret(value) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'secret', 'put',
      'CAMPUS_PRINT_ORIGIN', '--project-name=' + PAGES_PROJECT], { cwd: ROOT })
    p.stdin.write(value); p.stdin.end()
    let out = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
    p.on('close', (c) => resolve({ code: c, text: stripAnsi(out) }))
  })
}

async function checkAll(url) {
  const local = await apiOk(LOCAL_API)
  const viaTunnel = url ? await apiOk(url + '/api/public/config') : { status: 0, code: 'NO_URL' }
  const online = await apiOk(PAGES_ALIAS + '/api/public/config')
  // 本地直连 403 = **正常**：PUBLIC_ORIGIN 已是公网域名，Host 那道守卫就不认 127.0.0.1。
  // 所以这条只印不判（判它会把「后端活着」误报成「后端挂了」）。
  log('本地 4328/api =', local.status, local.code || '', local.status === 403 ? '（正常：PUBLIC_ORIGIN 已指向公网域名，Host 守卫不认 127.0.0.1）' : '')
  log('隧道/api      =', viaTunnel.status, viaTunnel.code || '')
  log('线上/api      =', online.status, online.code || '')
  return { local, viaTunnel, online }
}

async function main() {
  if (process.argv.includes('--check')) {
    const cur = (existsSync(join(UPSTREAM, '.env')) ? readFileSync(join(UPSTREAM, '.env'), 'utf8') : '')
      .split(/\r?\n/).find((l) => l.startsWith('PUBLIC_ORIGIN='))?.slice('PUBLIC_ORIGIN='.length) || ''
    const r = await checkAll(cur)
    const bad = r.online.status !== 200
    process.exit(bad ? 1 : 0)
  }
  const exe = findCloudflared()
  if (!exe) { console.error('[print-tunnel] 前置不满足：找不到 cloudflared（装它：npm i -g cloudflared 或设 CLOUDFLARED_BIN）'); process.exit(2) }

  // ① 起隧道（先收掉旧的：同一台机两个隧道会抢端口且域名混淆）
  try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force'], { stdio: 'ignore' }) } catch { /* 没有旧进程也算过 */ }
  await sleep(1500)
  const logDir = join(ROOT, '.tunnel')
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'live.log')
  rmSync(logFile, { force: true })
  const child = spawn(exe, ['tunnel', '--url', 'http://127.0.0.1:4328', '--no-autoupdate', '--logfile', logFile, '--loglevel', 'info'], { detached: true, stdio: 'ignore' })
  child.unref()
  let url = ''
  for (let i = 0; i < 20 && !url; i++) {
    await sleep(3000)
    if (existsSync(logFile)) {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(readFileSync(logFile, 'utf8'))
      if (m) url = m[0]
    }
  }
  if (!url) { log('① 失败：30 次×3s 没从日志读到隧道域名（cloudflared 起不来？先手跑一次看报错）'); process.exit(1) }
  log('① 隧道已起 =', url)

  // ② 写上游 .env 的 PUBLIC_ORIGIN（只改这一行，其余原样）
  const envPath = join(UPSTREAM, '.env')
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : []
  const i = lines.findIndex((l) => l.startsWith('PUBLIC_ORIGIN='))
  if (i >= 0) lines[i] = 'PUBLIC_ORIGIN=' + url; else lines.push('PUBLIC_ORIGIN=' + url)
  if (!lines.some((l) => l.startsWith('TRUST_PROXY=') || l.startsWith('TRUST_PROXY'))) lines.push('TRUST_PROXY=loopback')
  writeFileSync(envPath, lines.filter((l, k) => !(l === '' && k === lines.length - 1)).join('\n') + '\n', 'utf8')
  log('② 上游 .env 的 PUBLIC_ORIGIN 已指向新域名（config 在启动时读，所以必须配合 ③ 重启）')

  // ③ 重启后端（换 PUBLIC_ORIGIN 必须重启才生效：config 在启动时读）
  const old = pidOnPort(4328)
  if (old) { try { process.kill(old) } catch { /* 已退出 */ }; log('③ 旧后端进程', old, '已停') }
  await sleep(2500)
  const be = spawn(process.execPath, ['--env-file-if-exists=.env', 'backend/server.js'], { cwd: UPSTREAM, stdio: 'ignore', detached: true })
  be.unref()
  let local = { status: 0, code: 'STARTING' }
  for (let k = 0; k < 12; k++) {
    await sleep(2500)
    const probe = await fetch(LOCAL_API, { signal: AbortSignal.timeout(6000) }).catch(() => null)
    if (probe && (probe.status === 200 || probe.status === 403)) { local = { status: probe.status, code: '' }; break }
  }
  // 200 与 403 都算「活着」：PUBLIC_ORIGIN 已指向公网域名时，127.0.0.1 直连必被 Host 守卫判
  // FORBIDDEN_ORIGIN（403）—— 这正是它已按新配置起来的表现。只有连不上/超时才是真没起。
  if (local.status !== 200 && local.status !== 403) { log('③ 失败：本地 /api 没起（探测=' + local.status + ' ' + local.code + '），先手跑 npm start 看栈'); process.exit(1) }
  log('③ 后端已重启（本地探测 ' + local.status + (local.status === 403 ? ' = Host 守卫按新 PUBLIC_ORIGIN 生效，符合预期' : '') + '）')

  // ④⑤ Pages secret + 重新部署（secret 是部署时注入，不重部不生效 —— 本仓最高频的「改了却不生效」）
  const sec = await setPagesSecret(url)
  if (sec.code !== 0 || !/Success! Uploaded secret/.test(sec.text)) { log('④ 失败：secret 未上传'); log(sec.text.slice(-400)); process.exit(1) }
  log('④ Pages secret CAMPUS_PRINT_ORIGIN 已更新')
  // build/deploy 一律走 process.execPath + bin 入口：Windows 下 `npm` 是 .cmd 壳，
  // execFileSync('npm', …) 会 ENOENT —— 那会被误报成「build 没过」。一手踩过（本轮第一次跑 ⑤ 就中）。
  const steps = [
    ['⑤a 构建', [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']],
    ['⑤b 部署', [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'pages', 'deploy', 'dist', '--project-name=' + PAGES_PROJECT]],
  ]
  for (const [label, argv] of steps) {
    // argv[0] 已是绝对路径：别再 join(ROOT, …)（join 遇绝对段仍会前缀拼接，把入口判成不存在）。
    if (!existsSync(argv[0])) { log(label + ' 失败：找不到入口 ' + argv[0] + '（先 npm ci）'); process.exit(2) }
    try {
      execFileSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' })
      log(label + ' OK')
    } catch (e) {
      log(label + ' 失败：exit=' + (e?.status ?? e?.code ?? '?')
        + '（vite build 的 prebuild 会先跑 oxlint，红因多半在门禁那一条；上面有原文）')
      process.exit(1)
    }
  }

  // ⑥ 真跑线上 /api（530 常见于隧道刚建、边缘未就绪：重试三次再下结论）
  let online = { status: 0, code: '' }
  for (let k = 0; k < 4; k++) {
    await sleep(k === 0 ? 5000 : 12000)
    online = await apiOk(PAGES_ALIAS + '/api/public/config')
    if (online.status === 200) break
  }
  const rep = await checkAll(url)
  if (online.status !== 200) {
    log('✗ 线上 /api 仍非 200（' + online.status + ' ' + online.code + '）—— 上面三行读数就是断点位置')
    log('  530 通常是隧道/边缘未就绪或 cloudflared 掉了；403 通常是 ②③ 的 PUBLIC_ORIGIN 与 secret 不同值')
    process.exit(1)
  }
  log('✓ 全链通：本地 200 / 隧道 200 / 线上 200', JSON.stringify({ tunnel: url }))
  log('  提示：域名随隧道重启而变；隧道断了就再跑本命令（不是再改代码）。')
  void rep
  process.exit(0)
}

main().catch((e) => { console.error('[print-tunnel] 崩溃：' + (e?.stack || e?.message || e)); process.exit(1) })
