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
// 通道说明：**必须走 curl**。本机 node 的 global fetch 不读系统代理，而直连 api.github.com
// 会被 GFW reset（实测返回空/异常会被兜底伪装成"没有数据"）。代理地址取自 HTTPS_PROXY，
// 默认 127.0.0.1:7897（Clash Verge；未启动时按 --proxy=none 直连，可能失败）。
// 令牌只进变量，不回显、不落盘、不写日志。
import { execFileSync } from 'node:child_process'

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

function fail(msg, code) {
  console.error(`[ci-status] FAIL ${msg}`)
  process.exit(code)
}

function token() {
  // 走 Git 凭据管理器（本机既有通路），绝不打印值
  try {
    const out = execFileSync('bash', ['-c', 'printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    const line = out.split('\n').find((l) => l.startsWith('password='))
    if (!line) fail('凭据管理器里没有 github.com 的 token（git 跑一次 push/pull 由 GCM 写入）', 4)
    return line.slice('password='.length).trim()
  } catch (e) {
    fail('取 token 失败：' + e.message, 4)
  }
}

function gh(path, tok) {
  const args = ['-s', '--max-time', '30', '-w', '\n%{http_code}']
  if (proxy && proxy !== 'none') args.push('--proxy', proxy)
  args.push('-H', `Authorization: Bearer ${tok}`, '-H', 'Accept: application/vnd.github+json',
    `https://api.github.com${path}`)
  const raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const nl = raw.lastIndexOf('\n')
  const body = raw.slice(0, nl)
  const code = Number(raw.slice(nl + 1))
  if (code === 404) return { code, json: null }
  if (code >= 400) return { code, json: null, message: (body.match(/"message"\s*:\s*"([^"]{0,120})/) || [])[1] }
  try { return { code, json: JSON.parse(body) } } catch { return { code, json: null, message: '响应非 JSON' } }
}

const tok = token()
const secs = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 1000)

let runs = []
if (wantRun) {
  const suffix = wantAttempt ? `/attempts/${wantAttempt}` : ''
  const r = gh(`/repos/${OWNER}/${REPO}/actions/runs/${wantRun}${suffix}`, tok)
  if (!r.json) fail(`取 run ${wantRun} 失败 http=${r.code} ${r.message || ''}`.trim(), 4)
  runs = [r.json]
} else {
  const r = gh(`/repos/${OWNER}/${REPO}/actions/runs?per_page=${limit}`, tok)
  if (!r.json || !Array.isArray(r.json.workflow_runs)) fail(`取 run 列表失败 http=${r.code} ${r.message || ''}`.trim(), 4)
  runs = r.json.workflow_runs
}
if (!runs.length) fail('该仓没有任何匹配 run（不是"CI 绿"）', 4)

const report = { repo: `${OWNER}/${REPO}`, runs: [], classes: { green: 0, realRed: 0, infraRed: 0 }, hasStepFailJob: false }
for (const run of runs) {
  const j = gh(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs${wantAttempt ? `?attempt=${wantAttempt}` : ''}`, tok)
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
    if (job.conclusion === 'success') cls = 'green'
    else if (job.conclusion === 'skipped') cls = 'skipped'
    else if (job.conclusion === 'failure' && nSteps === 0 && dur !== null && dur <= 12) cls = 'infra-0step'
    else if (job.conclusion === 'failure') cls = 'real-red'
    entry.jobs.push({ name: job.name, conclusion: job.conclusion, steps: nSteps, secs: dur == null ? null : Math.round(dur), cls })
    if (cls === 'infra-0step') report.classes.infraRed++
    if (cls === 'real-red') { report.classes.realRed++; report.hasStepFailJob = true }
    if (cls === 'green') report.classes.green++
  }
  report.runs.push(entry)
}

if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  for (const r of report.runs) {
    console.log(`run ${r.id}  ${r.name}  head=${r.head}  ${r.conclusion}  attempt=${r.attempt}` + (r.note ? `  (${r.note})` : ''))
    for (const job of r.jobs) {
      const mark = job.cls === 'green' ? 'OK  ' : job.cls === 'skipped' ? '--  ' : job.cls === 'infra-0step' ? 'INFRA' : 'RED '
      console.log(`   [${mark}] ${job.name.padEnd(18)} ${String(job.conclusion).padEnd(9)} steps=${String(job.steps).padStart(3)} secs=${job.secs ?? '?'}`)
    }
  }
  const c = report.classes
  console.log(`\n分类计数：绿=${c.green}  真判据红(有 step)=${c.realRed}  账号级(0 step ≤12s)=${c.infraRed}`)
  if (c.realRed > 0) console.log('→ 有真判据红：去 GitHub 看该 job 的 step 日志，改代码，别改判据。')
  if (c.infraRed > 0) console.log('→ 存在 0-step 秒红：**没拿到 runner**，与本次改动无关。')
  if (c.infraRed > 0 && c.realRed === 0) console.log('  已排除项见 docs/ci-triage-runbook.md；禁止本地绕过 CI 发版（除非用户点名）。')
}

if (report.classes.realRed > 0) process.exit(1)
if (report.classes.infraRed > 0) process.exit(3)
if (report.classes.green === 0) fail('没有任何成功 job，无法判定"绿"（按 R247 不得静默 PASS）', 4)
process.exit(0)
