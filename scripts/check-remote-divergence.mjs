#!/usr/bin/env node
// @probe-safe: 骨架实测 rc=2 / 0.1s（既无 GITHUB_REPOSITORY 也无 --fixture 即在门口 bail），git 与 gh 都在其后
/**
 * remote-divergence —— 本地有几笔没到远端，以及**哪条通道还活着**（第七十一轮）。
 *
 * 一手动因：第七十轮的教训是「写完了 ≠ 上线了」，而它中间那一跳（提交 → 推送 → CI → 线上）
 * 此前只有一句散文。本轮更极端：`github.com` 整个不通（代理 127.0.0.1:7897 拒连 + 直连 000），
 * 而 `api.github.com` 通 —— `gh api repos/.../commits/main` 当场取到远端 head。
 * ⇒ 通道断的时候，本仓唯一还能存的证就是"API 那条读得到的数"，可它此前没人取。
 *
 * **不与既有两件抢事实**（三条各答一个问题，重复判同一条只许一处）：
 *   · `scripts/ci-green-contract.mjs`（pre-push）答「基座红没红」，它只在推送那一刻拿到 ref 行，
 *     且通道不通时整条不可用 —— 它也**说不出**"领先几笔"。
 *   · `scripts/check-live-shape.mjs` L3 答「线上跑的是哪一版」（`/_health` ⇄ 本地 HEAD）。
 *   · 本件答「本地几笔没到远端 + 哪条通道还活着」——这是全新事实，不是换个尺量同一件事。
 *
 * 本件**刻意不做闸**（一次正常提交变不了它的绿：推送要凭据与通道），只做 report + 一本台账。
 *
 * 三条判据的机理（都不是"多写点输出"）：
 *   R2 计数前置对账 —— `actions/checkout` 缺省 `fetch-depth: 1` ⇒ CI 里 `HEAD == origin/main` 恒成立，
 *     "领先 0"会被读成"已同步"。所以 `--is-shallow-repository=true` 必须把计数折成 UNVERIFIED，
 *     且 API sha 与本地 remote-tracking ref 不等时**也不许拿旧 ref 算 ahead**（那是拿昨天的图说今天的话）。
 *   R4 台账双向对账 —— 册上记的未推送 sha 若已能从 origin 走到，就必须从册上消失（不消失=幽灵=红）；
 *     册上 localHead 与当前 HEAD 不符 = STALE（红）。与 check-escape-hatch-log 的 S3 同一形状。
 *   R5 诚实面 —— 通道断时**明写**"本轮没有远端 run 回执，因为这 N 笔从未推送，该 run 按构造不存在"，
 *     而不是留一行空白让人读成"忘了填"。
 *
 * 用法：node scripts/check-remote-divergence.mjs [--json] [--update] [--fixture F] [--inject-red]
 * 退出码：0=量到了（含 BLOCKED-TRANSPORT，那是事实不是故障）/ 1=台账说谎（幽灵或 STALE）/ 2=量不到（未验证）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGh } from './lib/gh-cli.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SELF = 'scripts/check-remote-divergence.mjs'
export const LEDGER = join(root, 'docs', 'remote-divergence.json')
const GIT_TIMEOUT_MS = 25_000

/** git 传输通道探测：与 `ci-status.mjs` 同一条纪律 —— 取数器必须带上限，无上限 = 静默挂死。 */
function probeTransport(gitFn, branch) {
  const r = gitFn(['ls-remote', 'origin', `refs/heads/${branch}`])
  if (!r) return { ok: false, rc: null, why: 'ls-remote 无返回' }
  if (r.rc !== 0) return { ok: false, rc: r.rc, why: String(r.stderr || '').split('\n')[0].slice(0, 160) || `rc=${r.rc}` }
  const sha = String(r.stdout || '').trim().split(/\s+/)[0] || ''
  return { ok: true, rc: 0, sha: sha || null, why: sha ? '通' : '通，但分支在远端不存在' }
}

/**
 * 纯判据。所有外部通道都由调用方注入（生产 = git/gh，夹具 = 表）⇒ 测试不 shell、不联网。
 * @param {{headSha?:string, branchSha?:string, localRefSha?:string, shallow?:boolean,
 *          ahead?:number, behind?:number, unpushed?:{sha:string,subject:string}[],
 *          api?:{ok:boolean,sha?:string,why?:string}, transport?:{ok:boolean,rc:number|null,sha?:string,why:string},
 *          ledger?:{localHead?:string,unpushed?:{sha:string}[]}|null, liveRefSha?:string}} i
 */
export function judge(i) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok, label, detail })
  const api = i.api || { ok: false, why: '没取' }
  const tr = i.transport || { ok: false, rc: null, why: '没探' }

  // R1 通道普查：两条通道各报各的，全哑 ⇒ 未验证（"这台机器量不到"必须是自己说的，不是猜的）
  const channel = `git transport=${tr.ok ? '通' : `断(rc=${tr.rc ?? '-'})`}｜api.github.com=${api.ok ? '通' : '断'}`
  push('R1', tr.ok || api.ok, 'R1 通道普查（两条各报各的，两条全哑一律未验证）',
    `${channel}｜transport 读数=${tr.why}${api.ok ? '' : `｜api 读数=${api.why || '无'}`}`)

  // R2 计数前置对账：先把"我手里的远端图是不是今天的"证掉，再谈领先几笔
  const refKnown = !!i.localRefSha
  const apiMatchesRef = !!(api.ok && api.sha && i.localRefSha && api.sha === i.localRefSha)
  const shallowBlocked = i.shallow === true
  let countable = false
  let r2why = ''
  if (!refKnown) r2why = `本地取不到 origin/${i.branch || '?'} 的 ref ⇒ 没有对账基准`
  else if (shallowBlocked) r2why = `仓库是浅克隆（is-shallow-repository=true）⇒ "领先 0"是 fetch-depth 的产物，不是同步状态`
  else if (api.ok && !apiMatchesRef) r2why = `API 给的 head(${String(api.sha).slice(0, 7)}) 与本地 remote-tracking ref(${String(i.localRefSha).slice(0, 7)}) 不等 ⇒ 我这边的图本身就是旧的，不许拿它算 ahead`
  else { countable = true; r2why = api.ok ? `API head ⇄ 本地 ref 同值（${String(i.localRefSha).slice(0, 7)}）⇒ 计数基准可信` : `API 不可用，退到本地 remote-tracking ref（${String(i.localRefSha).slice(0, 7)}）单边作基准 ⇒ 计数可算，但"远端今天真是这个"只有 API 能证` }
  push('R2', refKnown && !shallowBlocked && (!api.ok || apiMatchesRef), 'R2 计数前置对账（API head ⇄ 本地 remote-tracking ref ⇄ 非浅克隆）', r2why)

  // R3 未推送清单：这些就是"待兑现的回执"，逐笔具名
  const ahead = countable ? Number(i.ahead) : null
  const unpushed = countable && Array.isArray(i.unpushed) ? i.unpushed : []
  const state = !countable ? 'UNVERIFIED'
    : (!tr.ok && !api.ok) ? 'BLOCKED-TRANSPORT'
      : ahead === 0 ? 'IN_SYNC'
        : (Number(i.behind) > 0 ? 'DIVERGED' : `AHEAD ${ahead}`)
  push('R3', countable, 'R3 未推送清单（每一笔都是尚未兑现的回执）',
    `${state}｜ahead=${ahead ?? '未取'} behind=${countable ? (i.behind ?? '?') : '未取'}｜`
    + (unpushed.length ? unpushed.map((u) => `${u.sha} ${String(u.subject).slice(0, 40)}`).join(' ; ') : '无'))

  // R4 台账双向对账：册上有而当次已经能走到 = 幽灵；册上 localHead 与当前 HEAD 不符 = STALE
  const led = i.ledger
  const staleLedger = !!(led && led.localHead && i.headSha && led.localHead !== i.headSha)
  if (!led) {
    push('R4', false, 'R4 台账 ⇄ 当次读数 双向对账', `册不在（${LEDGER}）⇒ 无账可对，跑 \`${SELF} --update\` 建册；缺册不许折算成"没有未推送"`)
  } else if (!countable) {
    // 计数没成立时"幽灵 0"是**没查**，不是**查了没有** —— 失明必须有独立读数，不许借一个 0 蒙过去
    push('R4', false, 'R4 台账 ⇄ 当次读数 双向对账', `册上 ${(led.unpushed || []).length} 笔｜计数未成立（见 R2）⇒ 幽灵面未复核，不折算成"册上没有已推的"`)
  } else if (typeof i.isPushedFn !== 'function') {
    push('R4', false, 'R4 台账 ⇄ 当次读数 双向对账', `册上 ${(led.unpushed || []).length} 笔｜没注入"这笔推出去了没"的探针 ⇒ 幽灵面无从判，不允许按"没有幽灵"放过`)
  } else {
    const ghosts = (led.unpushed || []).filter((e) => e && e.sha && i.isPushedFn(e.sha))
    push('R4', ghosts.length === 0 && !staleLedger, 'R4 台账 ⇄ 当次读数 双向对账',
      `册上 ${(led.unpushed || []).length} 笔｜幽灵 ${ghosts.length}（已能走到却还没摘）｜STALE=${staleLedger ? '是' : '否'}`
      + (ghosts.length ? `：${ghosts.map((g) => g.sha).join(',')}` : '')
      + (staleLedger ? `｜册记 HEAD=${led.localHead} 当前 HEAD=${i.headSha}` : ''))
  }

  // R5 诚实面：把"本轮能存什么证"写在脸上，不留空白
  push('R5', true, 'R5 诚实面（本节不参与判绿，它是给人读的那段话）',
    countable && ahead > 0
      ? `本轮**没有** HEAD=${String(i.headSha).slice(0, 7)} 的远端 run 回执：这 ${ahead} 笔从未推送 ⇒ 该 run 按构造不存在，这不是漏检。`
        + `线上 deploy 是哪一版由 check-live-shape L3 判，本件不重复判。`
      : countable && ahead === 0 ? '本地与远端同值 ⇒ 待兑现清单为空；线上是哪一版仍由 L3 判。'
        : '计数未成立 ⇒ 不产出任何"已同步/未同步"的结论，只产出通道读数。')

  const unver = rows.filter((r) => r.ok === false && ['R1', 'R2', 'R3'].includes(r.id))
  const ledgerBad = rows.find((r) => r.id === 'R4' && r.ok === false)
  // 量不到 = rc=2；台账说谎 = rc=1；其余（含 BLOCKED-TRANSPORT 这个"通道断"的事实）= rc=0
  const rc = unver.length ? 2 : ledgerBad ? 1 : 0
  const matched = rows.filter((r) => r.ok === true).length
  const mismatched = rows.length - matched
  return { rows, state, ahead, countable, matched, mismatched, rc, staleLedger }
}

/** 生产侧取数：git 走注入的 gitFn，api 走 lib/gh-cli（禁裸 spawn `gh`，见该文件头）。 */
export function collect({ repo, branch = 'main', gitFn, ghFn = runGh, timeoutMs = GIT_TIMEOUT_MS }) {
  const g = (args) => {
    const r = gitFn(args, { timeoutMs })
    return r ? { rc: r.rc, stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || '') } : null
  }
  const head = g(['rev-parse', 'HEAD'])
  const branchSha = head && head.rc === 0 ? head.stdout : null
  const localRef = g(['rev-parse', '--verify', `refs/remotes/origin/${branch}`])
  const shallowRaw = g(['rev-parse', '--is-shallow-repository'])
  const counts = g(['rev-list', '--left-right', '--count', `refs/remotes/origin/${branch}...HEAD`])
  const list = g(['log', '--format=%h\t%s', `refs/remotes/origin/${branch}..HEAD`])
  const apiRaw = ghFn(['api', `repos/${repo}/commits/${branch}`, '--jq', '.sha'], { timeoutMs })
  const api = apiRaw && apiRaw.status === 0 && String(apiRaw.stdout || '').trim()
    ? { ok: true, sha: String(apiRaw.stdout).trim() }
    : { ok: false, why: apiRaw ? (apiRaw.status === null ? `gh 跑不起来(status=${apiRaw.status})` : `status=${apiRaw.status} ${(apiRaw.stderr || '').split('\n')[0]}`.slice(0, 140)) : 'gh 不可用(exe=null)' }
  const isPushedFn = (sha) => {
    const r = g(['merge-base', '--is-ancestor', `${sha}^{commit}`, `refs/remotes/origin/${branch}`])
    return !!r && r.rc === 0
  }
  return {
    headSha: branchSha, branchSha, branch,
    localRefSha: localRef && localRef.rc === 0 ? localRef.stdout : null,
    shallow: shallowRaw ? shallowRaw.stdout === 'true' : false,
    // `rev-list --left-right --count origin...HEAD` 印的是 "<左> <右>"：左=只在远端的(behind)，右=只在本地的(ahead)
    ahead: counts ? Number(counts.stdout.split(/\s+/)[1]) : null,
    behind: counts ? Number(counts.stdout.split(/\s+/)[0]) : null,
    unpushed: list && list.stdout ? list.stdout.split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\t'); return { sha, subject: subject || '' } }) : [],
    api,
    isPushedFn,
    transport: probeTransport((args) => g(args), branch),
  }
}

export function ledgerFrom(snap) {
  return {
    schema: 'chaoshi-remote-divergence-v1',
    note: `本件由 \`node ${SELF} --update\` 生成；R4 拿它与当次读数做双向对账（册上 sha 已能走到却还没摘 = 幽灵；册记 HEAD 与当前不符 = STALE），手改即红。它记的是**待兑现的回执**，不是凭据。`,
    observed_utc: new Date().toISOString(),
    localHead: snap.headSha || null,
    branch: snap.branch || 'main',
    remoteRef: snap.localRefSha || null,
    apiHead: snap.api && snap.api.ok ? snap.api.sha : null,
    channel: { transport: snap.transport && snap.transport.ok ? 'ok' : 'down', api: snap.api && snap.api.ok ? 'ok' : 'down' },
    unpushed: snap.unpushed || [],
  }
}

/** 台账读取：文件在但读不出/解不出 ⇒ 一律具名失败，**禁把崩栈交给调用方**。
 *  一手（第七十一轮 CI 实测）：零分母探针把 `docs/remote-divergence.json` 造成 0 字节，
 *  `JSON.parse('')` 直接抛 SyntaxError，探针首行拿到 `<anonymous_script>:1` ⇒ 失败路径自己也会失败。 */
function readLedger(p) {
  if (!existsSync(p)) return { ledger: null, error: null }
  let raw
  try { raw = readFileSync(p, 'utf8') } catch (e) { return { ledger: null, error: `读不出 ${p}（${String(e && e.message || e).split('\n')[0]}）` } }
  if (!raw.trim()) return { ledger: null, error: `${p} 是 0 字节 ⇒ 读不出结构，不按"没有未推送"处理` }
  try {
    const j = JSON.parse(raw)
    if (!j || typeof j !== 'object') return { ledger: null, error: `${p} 解出来不是对象` }
    return { ledger: j, error: null }
  } catch (e) {
    return { ledger: null, error: `${p} 解析失败（${String(e && e.message || e).split('\n')[0]}）` }
  }
}

function main() {
  const argv = process.argv.slice(2)
  const update = argv.includes('--update')
  const asJson = argv.includes('--json')
  const inj = argv.includes('--inject-red')
  const fxIdx = argv.indexOf('--fixture')
  const repo = process.env.GITHUB_REPOSITORY || process.env.DIVERGENCE_REPO || ''

  let snap, ledger
  if (fxIdx !== -1) {
    let f
    try { f = JSON.parse(readFileSync(argv[fxIdx + 1], 'utf8')) } catch (e) {
      console.error(`[remote-divergence] BLOCKED --fixture 读不出/解不出（${String(e && e.message || e).split('\n')[0]}）⇒ 没有输入就不判`); process.exit(2)
    }
    snap = f.snapshot
    // 夹具把"这笔推出去了没"做成一张表：`isPushed: [sha...]`。没有这张表时 judge 的 R4 走未验证分支。
    if (Array.isArray(f.isPushed)) snap = { ...snap, isPushedFn: (s) => f.isPushed.includes(s) }
    ledger = f.ledger === undefined ? (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : null) : f.ledger
  } else {
    if (!repo) { console.error('[remote-divergence] BLOCKED 需要 GITHUB_REPOSITORY 或 --fixture ⇒ 取不到不判绿'); process.exit(2) }
    const gitFn = (args, { timeoutMs } = {}) => {
      const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: timeoutMs || GIT_TIMEOUT_MS, windowsHide: true })
      return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
    }
    snap = collect({ repo, branch: process.env.DIVERGENCE_BRANCH || 'main', gitFn })
    const rl = readLedger(LEDGER)
    if (rl.error) { console.error(`[remote-divergence] BLOCKED 台账不可用：${rl.error}`); process.exit(2) }
    ledger = rl.ledger
  }
  if (inj) {
    // 演习注入的是 R4 的幽灵分支：往册前塞一枚**当次已能走到**的 sha。用真孤儿 `f5b22d2` 不行 ——
    // 它"不在 HEAD 链上"，而 R4 要的是反方向（已推出去却还没从册上摘掉），语义正好相反。
    const GHOST = 'injected0'
    const prevFn = snap.isPushedFn
    snap = { ...snap, isPushedFn: (s) => s === GHOST || (typeof prevFn === 'function' ? prevFn(s) : false) }
    ledger = ledger
      ? { ...ledger, unpushed: [{ sha: GHOST, subject: 'INJECTED 演习笔（已从远端能走到，册上还没摘）' }, ...(ledger.unpushed || [])] }
      : { localHead: snap.headSha, unpushed: [{ sha: GHOST, subject: 'INJECTED 演习笔' } ] }
  }
  const r = judge({ ...snap, ledger })
  if (update) {
    if (!r.countable) { console.error(`[remote-divergence] BLOCKED 计数未成立（R2 没过）⇒ 不许把一份不可信的快照写进台账`); process.exit(2) }
    writeFileSync(LEDGER, `${JSON.stringify(ledgerFrom(snap), null, 2)}\n`, 'utf8')
    console.log(`[remote-divergence] 台账已写入 ${LEDGER}｜未推送 ${snap.unpushed.length} 笔｜channel transport=${snap.transport && snap.transport.ok ? 'ok' : 'down'} api=${snap.api && snap.api.ok ? 'ok' : 'down'}`)
  }
  if (asJson) console.log(JSON.stringify({ state: r.state, rc: r.rc, matched: r.matched, mismatched: r.mismatched, rows: r.rows, snapshot: snap, injected: inj }, null, 2))
  else {
    for (const row of r.rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.id} :: ${row.label} —— ${row.detail}`)
    console.log(`${r.rc === 0 ? 'GATE-PASS' : r.rc === 1 ? 'GATE-FAIL' : 'GATE-UNVERIFIED'} remote-divergence :: ${r.state}｜matched ${r.matched}／mismatched ${r.mismatched}｜本件是 report 档，不进 verify 链也不进钩子（推送要凭据与通道，一次正常提交变不了它的绿）`)
  }
  process.exit(r.rc)
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main()
