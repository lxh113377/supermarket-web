#!/usr/bin/env node
// CI 状态自查（防线轮收尾新增，2026-09-25 实测反哺）
//
// 为什么独立成脚本：2026-09-25 那次 push 后 CI 三个 job 全红，但**一个 step 都没有**。
// 当时是临时写 node 内联去查 API，连着踩了三个坑（fetch 不走代理 → 全 NaN；
// `cmd | tail` 吃退出码；Git Bash 吞反斜杠）。这套判断每次手写都会错，所以固化成脚本。
//
// 核心判据（本脚本自动做的分类，别再靠人读日志猜）：
//   失败 job 且 steps=0 且耗时 ≤12s  ⇒ **没拿到 runner = 账号/平台级**，与本次改动无关
//   失败 job 且 steps>0             ⇒ **真判据红**，去看 step 日志
//   deploy 因 needs 被 skipped      ⇒ 上游红，属预期，不是部署故障
//
// 用法：
//   node scripts/ci-status.mjs                     # 最近一次 run（默认 5 条）
//   node scripts/ci-status.mjs --limit=10          # 多看几条
//   node scripts/ci-status.mjs --run=36110097808   # 指定 run（可含 /attempts/N）
//   node scripts/ci-status.mjs --attempts=2
//   node scripts/ci-status.mjs --json              # 机器可读输出
//
// 退出码：0 全绿 / 1 存在真判据红（需修代码）/ 3 存在账号级 0-step 红（**不要改代码绕它**）
//        / 4 取不到数据（无 token、代理不通、API 不可达）—— 一律显式报错，禁静默 PASS
//
// 通道说明：**首选 gh CLI，次选 curl + GCM token**。两条腿的理由与先后都是一手实测（第六十七轮）：
//   ① 原实现把 curl 当唯一通道，而本机 curl 打不到 api.github.com —— 直连 rc=56（10.6s）、
//      经 127.0.0.1:7897 代理 rc=35（5.1s，CONNECT 隧道建成但 schannel 握手失败）⇒ 本脚本必然 rc=4。
//      同期 `gh.exe` 取同一接口 rc=0。⇒ 通道选错时，工具对"CI 到底红不红"这件事零信息量。
//   ② 取 token 那一步用的是 `bash`；本机 PATH 上 `bash` = `C:/Windows/System32/bash.exe`（**WSL 那份**），
//      它的 `git credential fill` 实测 45s 不返回。原实现既没有 timeout、又把 stderr 丢进 ignore
//      ⇒ 表现为**零输出挂死 150s+**（第六十七轮实测复现两次），而本脚本是 AGENTS.md 钦点的
//      「CI 红怎么办」入口 —— 最该响的地方最哑。
//   ③ `gh` 自带鉴权，走它时 token 压根不进本进程，与 curl 腿的 argv 泄漏面无关（见下）。
// 令牌只进变量，不回显、不落盘、不写日志。
import { execFileSync, spawnSync } from 'node:child_process'
import { runGh } from './lib/gh-cli.mjs'

const OWNER = 'lxh113377'
const REPO = 'supermarket-web'
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const asJson = args.includes('--json')
const limit = Number(flag('limit', '5'))
const wantRun = flag('run', '')
const wantAttempt = flag('attempts', '')
const proxy = flag('proxy', process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7897')
// 通道开关：auto（默认，先 gh 后 curl）/ gh（只用 gh）/ curl（只用 curl+GCM）。
// 为什么要有它：本机 curl 打不到 api.github.com（见文件头 ①），默认顺序必须让 gh 在前；
// 但"curl 腿本身有没有泄漏面"仍要能被单独测到 —— 有了开关，两条腿各测各的，不必靠"把 gh 藏起来"制造条件。
const transport = String(flag('transport', 'auto')).toLowerCase()
if (!['auto', 'gh', 'curl'].includes(transport)) fail(`--transport 只能是 auto|gh|curl（实得 ${transport}）`, 4)

function fail(msg, code) {
  console.error(`[ci-status] FAIL ${msg}`)
  process.exit(code)
}

// 每一个子进程都必须带上限。**无上限的 exec 就是本轮修掉的那个静默挂死**（见文件头 ②）。
const EXEC_TIMEOUT_MS = 25_000

function token() {
  // **直连 git，不经 shell**（第六十七轮改）。原实现是
  //   execFileSync('bash', ['-c', 'printf "protocol=https\nhost=github.com\n\n" | git credential fill'])
  // 一手实测：① 本机 PATH 上的 `bash` 是 `C:/Windows/System32/bash.exe`（WSL 那份），它那条管道实测 45s
  // 不返回（ETIMEDOUT）；② 原实现既没 timeout、又把 stderr 丢进 ignore ⇒ 脚本**零输出挂死 150s+**
  // （复现两次）。而这台机器的 Windows GCM 里**本来就有** github.com 凭据 —— 去掉 bash 外壳后
  // `git credential fill` 直连 0.1s 拿到 40 位 token。⇒ 那条挂死链是被 shell 外壳凭空造出来的，
  // 不是环境缺能力；修法是拿掉外壳，不是给超时压住症状（超时只保留作兜底）。
  // 测试里的 git 垫片照样生效：它认的就是 argv `['credential','fill']`，与有没有 shell 无关。
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS, windowsHide: true,
  })
  if (r.error || r.status !== 0) {
    const why = r.error
      ? (/ETIMEDOUT|timed out/i.test(String(r.error.message)) ? `超过 ${EXEC_TIMEOUT_MS}ms 未返回` : r.error.message)
      : `git credential fill rc=${r.status}${(r.stderr || '').trim() ? '：' + String(r.stderr).trim().split('\n')[0] : ''}`
    fail(`取 token 失败（${why}）；要么 git 凭据管理器里没有 github.com 的条目，要么改用 --transport=auto 走已登录的 gh`, 4)
  }
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('password='))
  if (!line) fail('凭据管理器里没有 github.com 的 token（git 跑一次 push/pull 由 GCM 写入）', 4)
  return line.slice('password='.length).trim()
}

function redact(s, tok) {
  return tok ? String(s).split(tok).join('[REDACTED-PAT]') : String(s)
}

/** 通道一（首选）：已登录的 gh CLI。自带鉴权 ⇒ token 不进本进程，也就不进本进程的 argv。 */
function viaGh(path) {
  const r = runGh(['api', path], { timeoutMs: EXEC_TIMEOUT_MS })
  if (r.exe === null) return { unavailable: 'no-gh-executable' }
  if (r.error || !r.stdout) return { unavailable: `gh-spawn-failed:${(r.error && (r.error.code || r.error.message)) || 'no-stdout'}` }
  let json
  try { json = JSON.parse(r.stdout) } catch { return { unavailable: 'unparsable-json' } }
  const code = Number(json.status) || (r.status === 0 ? 200 : 502)
  // gh 对 4xx/5xx 也会把 JSON 响应体打到 stdout（只是 rc≠0）⇒ 必须按响应归一，
  // 否则 404 会被读成"拿到了数据"，调用方的 `if (!r.json)` 就拦不住了。
  if (r.status !== 0 || code >= 400) return { code, json: null, message: json && json.message, via: 'gh' }
  return { code, json, via: 'gh' }
}

function gh(path) {
  if (transport !== 'curl') {
    const fast = viaGh(path)
    if (fast.code !== undefined || fast.json !== undefined) return fast
    if (transport === 'gh') {
      fail(`--transport=gh 但 gh 通道不可用：${fast.unavailable}（PATH 与常见安装位都要有**非 0 字节**的可执行 gh，残件会被跳过）`, 4)
    }
  }
  // ↓↓↓ 通道二：curl + GCM token。走到这里说明机器上没有可用的 gh（或它自己失败）。
  // 注意 token 在**这一行**才第一次被取：签名里不收 token，gh 腿因此结构上碰不到它。
  const tok = fetchTok()
  // ⚠️ token 一律**不进 argv**（第五十七轮一手实测的泄漏）：`execFileSync` 失败时 Node 会把整条命令
  //   连同参数写进 `error.message`，于是 `-H "Authorization: Bearer ghp_…"` 的明文 PAT 直接落到
  //   终端 / 日志 / 对话里 —— 一次代理抖动就足够。argv 不只影响日志，同机其他进程也能读到进程参数，
  //   所以"只在打印时脱敏"是不够的，得从**进 argv 这一步**就不放进去。
  //   正解 = 敏感项走 `--config -`（curl 从 stdin 读配置，stdin 不进进程参数），argv 只剩非敏感参数；
  //   再对 error.message 做一次脱敏作为纵深防御（防未来有人把 token 拼回别处）。
  const args = ['-s', '--max-time', '30', '-w', '\n%{http_code}', '--config', '-']
  if (proxy && proxy !== 'none') args.push('--proxy', proxy)
  args.push(`https://api.github.com${path}`)
  const cfg = `header = "Accept: application/vnd.github+json"\nheader = "Authorization: Bearer ${tok}"\n`
  let raw
  try {
    raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, input: cfg, timeout: EXEC_TIMEOUT_MS, windowsHide: true })
  } catch (e) {
    // 走本件自己的四态出口（rc=4 取不到数据），而不是让 Node 把整条 argv 连栈一起甩出来：
    // 未捕获时打印的就是 `Error: Command failed: curl …`，那正是泄漏面。
    fail(`curl 调 GitHub API 失败（代理/网络问题，非结论）：${redact(e && e.message ? e.message : e, tok)}`
      + (e.killed || e.code === 'ETIMEDOUT' ? `（超过 ${EXEC_TIMEOUT_MS}ms 未返回）` : ''), 4)
  }
  const nl = raw.lastIndexOf('\n')
  const body = raw.slice(0, nl)
  const code = Number(raw.slice(nl + 1))
  if (code === 404) return { code, json: null }
  if (code >= 400) return { code, json: null, message: (body.match(/"message"\s*:\s*"([^"]{0,120})/) || [])[1] }
  try { return { code, json: JSON.parse(body) } } catch { return { code, json: null, message: '响应非 JSON' } }
}

// token 必须**惰性**：原实现是模块顶层无条件 `const tok = token()`，于是"gh 腿能不能用"
// 根本轮不到被问一句，脚本就先卡死在取 token 那一步（第六十七轮实测：零输出挂死 150s+）。
// 现在只有真正要落到 curl 腿时才去取，且那次取自带 25s 上限。
let _tokCache = null
const fetchTok = () => (_tokCache || (_tokCache = token()))
const secs = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 1000)

let runs = []
if (wantRun) {
  const suffix = wantAttempt ? `/attempts/${wantAttempt}` : ''
  const r = gh(`/repos/${OWNER}/${REPO}/actions/runs/${wantRun}${suffix}`)
  if (!r.json) fail(`取 run ${wantRun} 失败 http=${r.code} ${r.message || ''}`.trim(), 4)
  runs = [r.json]
} else {
  const r = gh(`/repos/${OWNER}/${REPO}/actions/runs?per_page=${limit}`)
  if (!r.json || !Array.isArray(r.json.workflow_runs)) fail(`取 run 列表失败 http=${r.code} ${r.message || ''}`.trim(), 4)
  runs = r.json.workflow_runs
}
if (!runs.length) fail('该仓没有任何匹配 run（不是"CI 绿"）', 4)

const report = {
  repo: `${OWNER}/${REPO}`, runs: [],
  // 分类桶必须**穷尽 GitHub Actions 的全部 conclusion 取值**，且总数要能对上（unclassified 兜底并点名）。
  // 第七十三轮实测：旧版只有 green/realRed/infraRed 三个桶，skipped 有类无账、cancelled 连类都没有。
  classes: { green: 0, realRed: 0, infraRed: 0, cancelled: 0, timedOut: 0, skipped: 0, running: 0, other: 0, total: 0 },
  deploy: [], hasStepFailJob: false, blockedBy: null,
}
const KNOWN_CONCLUSIONS = ['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale']
// 0-step 秒红的"为什么"不在 jobs 里，在 check-run annotations 里（2026-09-25 实测：
// 本仓拿不到 runner 的原文就是这么取到的，不必再靠人工开已登录浏览器看红条）。
// 只取第一条 failure annotation，取不到不影响判类（看守判据默认 fail-open + 记 UNVERIFIED）。
let bannerProbed = false
function probeBanner(url) {
  if (bannerProbed || !url) return
  bannerProbed = true
  try {
    const a = gh(new URL(url).pathname + '/annotations')
    const msgs = ((a.json || []).filter((x) => x.annotation_level === 'failure').map((x) => x.message)).filter(Boolean)
    report.blockedBy = msgs.length ? msgs[0] : `annotations 为空 http=${a.code}（未取到原文）`
  } catch (e) {
    report.blockedBy = `annotations 请求异常：${e instanceof Error ? e.message : String(e)}`
  }
}
for (const run of runs) {
  const j = gh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs${wantAttempt ? `?attempt=${wantAttempt}` : ''}`)
  const jobs = (j.json && j.json.jobs) || []
  const entry = {
    id: run.id, name: run.name, head: (run.head_sha || '').slice(0, 7),
    conclusion: run.conclusion, attempt: run.run_attempt, created: run.created_at, jobs: [],
  }
  if (!jobs.length) entry.note = `jobs 取不到 http=${j.code}${j.message ? ' ' + j.message : ''}`
  for (const job of jobs) {
    const nSteps = (job.steps || []).length
    const dur = job.started_at && job.completed_at ? secs(job.started_at, job.completed_at) : null
    let cls = 'other'
    // conclusion 为 null 而 status 未 completed ＝ **正在跑**，不是"取数面出现了未知终态"。
    // 不认这一格就会把一次正常在途的推送报成"枚举需要扩"⇒ 自己造的桶反过来产生假警报（第七十三轮实测）。
    if (job.status && job.status !== 'completed' && !job.conclusion) cls = 'running'
    else if (job.conclusion === 'success') cls = 'green'
    else if (job.conclusion === 'skipped') cls = 'skipped'
    // **cancelled 必须有自己的桶**（第七十三轮一手）：run 37747723889 的 e2e-cloud-stub
    // 是 0 步、1 秒、cancelled，而当时的分类只认 failure 系 ⇒ 它既不进绿也不进红，
    // 总账行印出「绿=7 真判据红=0 账号级=0」，9 个 job 只数到 7 —— 少的那两个正是
    // "被挤掉的那个" 与 "因此没跑成的 deploy"。**"没算进任何桶"不是"没事"**，
    // 它把一次交付面锁死读成了"没有红灯"。deploy 因 needs 被 skipped 也落在同一个盲区里。
    else if (job.conclusion === 'cancelled') cls = 'cancelled'
    else if (job.conclusion === 'timed_out') cls = 'timedOut'
    else if (job.conclusion === 'failure' && nSteps === 0 && dur !== null && dur <= 12) cls = 'infra-0step'
    else if (job.conclusion === 'failure') cls = 'real-red'
    entry.jobs.push({ name: job.name, conclusion: job.conclusion, steps: nSteps, secs: dur == null ? null : Math.round(dur), cls })
    report.classes.total++
    if (cls === 'infra-0step') { report.classes.infraRed++; probeBanner(job.check_run_url) }
    else if (cls === 'real-red') { report.classes.realRed++; report.hasStepFailJob = true }
    else if (cls === 'green') report.classes.green++
    else if (cls === 'cancelled') { report.classes.cancelled++; probeBanner(job.check_run_url) }
    else if (cls === 'timedOut') report.classes.timedOut++
    else if (cls === 'skipped') report.classes.skipped++
    else if (cls === 'running') report.classes.running++
    else report.classes.other++
    if (!KNOWN_CONCLUSIONS.includes(String(job.conclusion))) {
      entry.unknownConclusions = (entry.unknownConclusions || []).concat([`${job.name}=${job.conclusion}`])
    }
  }
  const dj = jobs.find((j) => j.name === 'deploy')
  entry.deploy = dj ? dj.conclusion : null
  entry.hasDeployJob = !!dj
  report.runs.push(entry)
}

if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  for (const r of report.runs) {
    console.log(`run ${r.id}  ${r.name}  head=${r.head}  ${r.conclusion}  attempt=${r.attempt}` + (r.note ? `  (${r.note})` : ''))
    for (const job of r.jobs) {
      const mark = job.cls === 'green' ? 'OK  ' : job.cls === 'skipped' ? '--  '
        : job.cls === 'infra-0step' ? 'INFRA' : job.cls === 'cancelled' ? 'CNCL' : job.cls === 'timedOut' ? 'TL90' : job.cls === 'running' ? 'RUN ' : 'RED '
      console.log(`   [${mark}] ${job.name.padEnd(18)} ${String(job.conclusion).padEnd(9)} steps=${String(job.steps).padStart(3)} secs=${job.secs ?? '?'}`)
    }
  }
  const c = report.classes
  console.log(`\n分类计数：绿=${c.green}  真判据红(有 step)=${c.realRed}  账号级(0 step ≤12s)=${c.infraRed}`
    + `  cancelled=${c.cancelled}  timed_out=${c.timedOut}  skipped=${c.skipped}  在跑=${c.running}  落桶外=${c.other}`
    + `｜总数=${c.total}`)
  // **每个桶都得有人认领**：旧版这里只印三个数，cancelled/skipped 有类无账，
  // 于是"绿=7 真判据红=0"这句话在 9 个 job 的面上既没撒谎也没说全（第七十三轮一手）。
  if (c.cancelled > 0) console.log('→ 存在 cancelled：被取消的 job **没有结论**（既不是绿也不是判据红），它下游 needs 到的 job 全部被掐成 skipped ⇒ 交付面可能整段没跑。'
    + '取消原因不在 job 明细里，在 check-run annotations（见下方"平台原文"行），别把它读成"没事"。')
  if (c.timedOut > 0) console.log('→ 存在 timed_out：某 job 撞上了本轮 I-73-4 刚补的 timeout-minutes 上界 ⇒ 是真慢，不是没配完。')
  if (c.running > 0) console.log('→ 在跑：这些 job 还没有 conclusion（不是异常，也不是结论）⇒ 想要终态请复跑本命令或加 --run <id>。')
  if (c.other > 0) console.log(`→ 落桶外 ${c.other} 个：conclusion 取值超出已知枚举 ${KNOWN_CONCLUSIONS.join('/')} ⇒ 本判据的取数面需要扩，不许按"没有"处理。`)
  // 「部署到底有没有发生」是这条链上唯一的问题句，而它此前只能靠人自己去看 deploy 那一行。
  const deploys = report.runs.filter((r) => r.hasDeployJob)
  const awaiting = report.runs.filter((r) => !r.hasDeployJob && String(r.conclusion) !== 'success' && String(r.conclusion) !== 'skipped')
  if (!deploys.length) {
    if (awaiting.length) console.log(`→ 部署判定：${awaiting.map((r) => `${r.id}@${r.head}`).join('、')} 还没有 deploy job ⇒ 上游仍在跑（deploy 是 needs 到齐后才创建的），**不读成"没部署也没事"，也不读成"部署坏了"**。`)
    else console.log('→ 部署判定：取回的 run 里**根本没有 deploy job**（workflow 改名或全是旁支链）⇒ 无从判定，不读成"没部署也没事"。')
  }
  for (const r of deploys) {
    const verdict = r.deploy === 'success' ? '已发生（deploy success）'
      : r.deploy === 'skipped' ? `**未发生**（deploy skipped：上游 ${r.jobs.filter((j) => j.conclusion !== 'success' && j.conclusion !== 'skipped').map((j) => `${j.name}=${j.conclusion}`).join('、') || '无红灯 job'}；skipped 意味着流水线根本没走到发布这一步）`
        : `已尝试但结论 ${r.deploy}`
    console.log(`→ 部署判定 run ${r.id}@${r.head}：${verdict}`)
  }
  console.log('→ 「线上现在是哪一版」不由本件判（one-fact-one-judge）：看 `npm run check:live-shape` 的 L3；「本地几笔没到远端」看 `npm run check:remote-divergence`。三件各答一个问题。')
  if (c.realRed > 0) console.log('→ 有真判据红：去 GitHub 看该 job 的 step 日志，改代码，别改判据。')
  if (c.infraRed > 0) console.log('→ 存在 0-step 秒红：**没拿到 runner**，与本次改动无关。')
  if ((c.infraRed > 0 || c.cancelled > 0) && report.blockedBy) console.log(`  平台原文（check-run annotations）：${report.blockedBy}`)
  if (c.infraRed > 0 && c.realRed === 0) console.log('  已排除项见 docs/ci-triage-runbook.md；禁止本地绕过 CI 发版（除非用户点名）。')
}

if (report.classes.realRed > 0) process.exit(1)
if (report.classes.infraRed > 0) process.exit(3)
// cancelled 单独一档退出码：它不是"判据红"，但它是"交付没发生"，与两者都不同（旧版把它读成无事）。
if (report.classes.cancelled > 0 || report.classes.timedOut > 0) process.exit(5)
if (report.classes.green === 0) fail('没有任何成功 job，无法判定"绿"（按 R247 不得静默 PASS）', 4)
process.exit(0)
