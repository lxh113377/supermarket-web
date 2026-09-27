// CI 全绿契约：把「CI 绿」从口头自觉变成推不动东西的硬闸。
//
// 立这条的实证代价（第二十一轮查到，不是假想风险）：`tests/d1RoundTrips.test.js` 缺
// `@vitest-environment node` 让 CI 从第十四轮起**连红 7 个 commit**，`deploy` job 被 needs
// 掐成 skipped，而期间三份对标报告都写着"CI 全绿 / 本地 82 files 全绿"。本地绿与 CI 绿
// 可以同时不成立（Node 小版本、`npm test` vs `vitest run --coverage` 是不同调用形态），
// 所以唯一凭据必须是**远端回执**。
//
// 四态：GREEN 放行 / RED 拒 / BLOCKED（有 run 但缺必需 job）拒 / UNKNOWN（取不到 run、
// gh 不可用、网络失败）拒 —— **裸静音判红**，绝不把"没查到"读成"没问题"。
// 逃生门：CI_GREEN_SKIP=1 才可绕过，且必须同时给 CI_GREEN_REASON，输出面 loudly 留痕。
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
export const CONTRACT_FILE = '.ci/contract.json'

export function loadContract(dir = root) {
  const p = join(dir, CONTRACT_FILE)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return 'PARSE_ERROR' }
}

/** 纯判据：喂远端回执，出四态。可被夹具喂合成输入（判据拆纯函数的既有口径）。 */
export function verdictOf({ sha, runs, contract }) {
  const need = contract?.requiredJobs || []
  if (!contract) return { state: 'UNKNOWN', reason: `缺 ${CONTRACT_FILE} 或 JSON 不可解析 ⇒ 无法判定，按红处理` }
  if (contract === 'PARSE_ERROR') return { state: 'UNKNOWN', reason: `${CONTRACT_FILE} JSON 解析失败` }
  const mine = (runs || []).filter((r) => r.headSha === sha)
  if (!mine.length) return { state: 'UNKNOWN', reason: `远端查不到 sha=${sha} 的 ${contract.workflow} run ⇒ 可能是首次推送或 gh 鉴权/网络失效，不读成通过` }
  const best = mine.sort((a, b) => (b.databaseId || 0) - (a.databaseId || 0))[0]
  if (best.status !== 'completed') return { state: 'BLOCKED', reason: `run ${best.databaseId} 仍在跑（status=${best.status}）⇒ 无结论，不放行` }
  const jobs = best.jobs || []
  const have = new Set(jobs.map((j) => j.name))
  const missing = need.filter((j) => !have.has(j))
  if (missing.length) return { state: 'BLOCKED', reason: `run ${best.databaseId} 缺少必需 job: ${missing.join(', ')}（needs 断了就是没发出去）` }
  const red = jobs.filter((j) => need.includes(j.name) && j.conclusion !== 'success').map((j) => `${j.name}=${j.conclusion}`)
  if (best.conclusion !== 'success' || red.length) {
    return { state: 'RED', reason: `run ${best.databaseId} conclusion=${best.conclusion}${red.length ? '；失败 job: ' + red.join(', ') : ''}` }
  }
  return { state: 'GREEN', reason: `run ${best.databaseId} 全绿，必需 job 齐备：${need.join(', ')}` }
}

function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(out || '[]')
}

export function main({ pushRef = null, remoteSha = null } = {}) {
  const contract = loadContract()
  if (!contract || contract === 'PARSE_ERROR') {
    console.error(`[ci-green] FAIL-CLOSED 读不到合法的 ${CONTRACT_FILE}`)
    return 1
  }
  const skip = process.env[contract.escapeHatch || 'CI_GREEN_SKIP']
  if (skip) {
    const reason = (process.env.CI_GREEN_REASON || '').trim()
    if (!reason) { console.error(`[ci-green] ${contract.escapeHatch} 已设但 CI_GREEN_REASON 为空 ⇒ 仍拒（逃生门要留可审计的理由）`); return 1 }
    console.error(`[ci-green] !! 绕过契约 !! 理由="${reason}" —— 这笔账会留在 CI 与台账里，请自行确保远端为绿`)
    return 0
  }
  let sha, refName
  if (pushRef) {
    const m = /^(?:refs\/(?:heads|tags)\/)?(.+)$/.exec(pushRef.trim())
    refName = m[1]
    sha = pushRef.split(/\s+/)[1] || null
  }
  const branch = refName || contract.branch
  // 判据基点 = **远端当前 SHA**，不是本次 HEAD。新提交天生还没有 run，拿 HEAD 当判据
  // 会让任何首次推送都不可通过（第二十三轮接线时，这条闸真的把我自己的推送拦下过一次）。
  // 契约语义是"别在红基座上继续叠加"—— 第十四~二十一轮那 7 个 commit 正是红基座上叠出来的。
  let base = remoteSha && /^[0-9a-f]{40}$/.test(remoteSha) ? remoteSha : null
  if (!base || /^0+$/.test(base)) {
    try {
      base = (execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { encoding: 'utf8' }).trim().split(/\s+/)[0] || null)
    } catch { base = null }
  }
  if (!base) { console.error(`[ci-green] FAIL-CLOSED 取不到远端 ${branch} 当前 SHA ⇒ 基线无法判定，不放行`); return 1 }
  sha = base
  let runs
  try {
    const listed = ghJson(['run', 'list', '--workflow', contract.workflow, '--limit', '15',
      '--json', 'databaseId,headSha,conclusion,status,name'])
    const bySha = [...new Set(listed.map((r) => r.headSha))]
    runs = []
    for (const s of bySha) {
      const hit = listed.filter((r) => r.headSha === s)
      runs.push({ headSha: s, databaseId: hit[0].databaseId, conclusion: hit[0].conclusion, status: hit[0].status, jobs: [] })
    }
  } catch (e) {
    console.error(`[ci-green] FAIL-CLOSED gh 不可用/未鉴权/网络失败：${String(e.message).split('\n')[0]}`)
    console.error('  ⇒ 取不到远端回执不等于没事。要么修 gh，要么显式 CI_GREEN_SKIP=1 CI_GREEN_REASON="..." 并自行担责。')
    return 1
  }
  const run = runs.find((r) => r.headSha === sha)
  if (!run) { console.error(`[ci-green] FAIL-CLOSED 远端查不到 HEAD(${sha.slice(0, 7)}) 的 ${contract.workflow} run ⇒ 不判通过`); return 1 }
  let jobs = []
  try { jobs = ghJson(['run', 'view', String(run.databaseId), '--json', 'jobs']).jobs || [] } catch { /* 交给下面的 BLOCKED：拿不到 job 就当缺 */ }
  const v = verdictOf({ sha, runs: [{ ...run, jobs }], contract })
  const line = `[ci-green] ${v.state} branch=${branch} sha=${sha.slice(0, 7)} :: ${v.reason}`
  if (v.state === 'GREEN') { console.log(line); return 0 }
  console.error(line)
  return 1
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) {
  // pre-push 的 ref 行走 **stdin**（local_ref local_sha remote_ref remote_sha），
  // argv 只有 remote 名与 URL —— 上一版从 argv 取 SHA 是取不到的。
  let line = ''
  if (!process.stdin.isTTY) {
    try { line = fs.readFileSync(0, 'utf8').split(/\r?\n/).find((l) => l.trim()) || '' } catch { line = '' }
  }
  process.exit(main({ pushRef: line || null, remoteSha: process.env.CI_GREEN_BASE || null }))
}
