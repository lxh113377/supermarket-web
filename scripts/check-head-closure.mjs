#!/usr/bin/env node
// 缺输入面：骨架里实测 rc=2 / 0s 停在门口（requireInputs 先看 package.json 与 .githooks），仓库读取都在其后
/**
 * head-closure —— 「**提交面必须自足**」判据（第三十九轮 R39-H1）。
 *
 * 一手事实（本轮 Step 0，@2026-09-28 00:42–00:57 +08:00 本机实测）：
 *   上一轮会话写完第三十八轮的 10 件（6 改 + 4 全新未跟踪）就中止了，HEAD 停在 a19cc0e，
 *   在途工作静置 3.5 小时无人察觉。其中 package.json 与 ci.yml 已经把
 *   verify:restore-drill / check:live-shape 接进了链路，而它们指向的
 *   scripts/restore-drill.mjs、scripts/check-live-shape.mjs **一件都没入库** ⇒
 *   那种状态下只要有人把这两个文件单独提交，CI 立刻 MODULE_NOT_FOUND；
 *   而本地 43 个判据全绿——因为本地磁盘上有那两个文件。
 *   同型事故在册可查：第三十六轮提交说明「git add -u 漏新文件 ⇒ 本地全绿 CI 缺件红」。
 *   没有任何一道判据守这件事：CI 只看提交面，本地链只看磁盘面，两者从不互相比对。
 *
 * 对标（owner/name 全名；引文均于 @2026-09-27T17:00:56Z 由本机 gh api contents 现取现验，非转述）：
 *   - kubernetes/kubernetes  hack/lib/verify-generated.sh:35,41,49
 *       「kube::util::ensure_clean_working_dir」/「git worktree add -f -q "${_tmpdir}" HEAD」/
 *       「diffs=$(git status --porcelain | wc -l)」⇒ 在 HEAD 的干净副本里重跑生产者，再按 porcelain
 *        行数判红。本判据借的是「判定对象=提交态」这一点；产物闭包不在这儿重复判（已有
 *        verify:contract / verify:registry / verify:changelog 各守一面），这里只判引用闭包——
 *        整链重跑要 npm ci，代价不成比例（实测 verify 全链 4–6 分钟，pre-push 里跑不起）。
 *   - rust-lang/rust  src/tools/tidy/src/mir_opt_tests.rs:11,42
 *       「fn check_unused_files」/「the following output file is not associated with any mir-opt test,
 *        you can remove it: {}」⇒ 盘上有文件而没被任何东西登记 ⇒ 红（H3）。
 *       同仓 src/tools/tidy/src/deps.rs:967,979-983
 *       「could not find allowed package ... Remove from PERMITTED_DEPENDENCIES list if it is no longer used.」
 *       ⇒ 例外册自身也要反向对账（H4），否则例外册会变成第二个没人核对的登记表。
 *   - prettier/prettier  scripts/ensure-no-files-changed.js:5-8,25
 *       「git diff --name-only」+「git diff --exit-code」⇒ 反向参照：这条 52,314★ 的链只看已跟踪文件，
 *        未跟踪件永远不进它的视野——与本轮事故同型的盲区。所以 H2 特意取
 *        git ls-files（含"未跟踪"判别）而不是照抄 prettier 的口径。
 *
 * 接线落点：.githooks/pre-push。为什么不是 CI 也不是 npm run verify ——
 *   「未跟踪文件」这个对象在 CI 的检出里**根本不存在**，CI 永远看不到 H2 那一半；
 *   而 verify 链在本地跑时，缺件的人往往已经跑完并提交了。只有 push 那一刻两件事同时成立。
 *
 * 用法：node scripts/check-head-closure.mjs [--json] [--drill]
 * 退出码：0=通过 / 1=判出违规（或 --drill 没能翻红）/ 2=输入面不满足（无 git、无 HEAD、链文件缺失）
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireInputs, bail } from './lib/preflight.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SELF = 'scripts/check-head-closure.mjs'

/** 链面：谁声明"这条链要跑哪些脚本"。新增链面只改这一处，H5 会反向盯它。 */
export const CHAIN_JSON = ['package.json']
export const CHAIN_DIR_PREFIXES = ['.github/workflows/', '.githooks/']
/** 入口目录：H3 只在这里找孤儿；lib/ 与 archive/ 结构上不是可执行入口。 */
export const EXEC_DIRS = ['scripts/']
export const EXEC_EXT = /\.(mjs|js|py|ps1|sh)$/
/** 孤儿豁免册：路径 → 为什么它不该被链引用。取值来自本轮实测（HEAD 的 scripts/ 里
 *  未被任何链面引用的恰是这两件人工发起的破坏性脚本）。 */
export const ORPHAN_EXEMPT = new Map([
  ['scripts/git-push-fallback.ps1', '人工逃生件：推送被代理掐断时在终端手跑，自动链引用它等于让 CI 真推代码'],
  ['scripts/purge-admin-key-history.sh', '历史改写件：跑它=重写已推送历史，必须由人显式发起，禁止进链'],
])

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    bail('head-closure', ['git', ...args].join(' ') + ' 失败：' + String(e.message || e).split('\n')[0])
    return ''
  }
}

/** 剥 YAML 注释：整行注释 + 引号之外的行尾注释。字符串里的 # 不算注释——
 *  一刀切的正则会吃掉 run: 'node a.mjs # keep' 这类真命令（R37 那族"量具把散文当数据"）。 */
export function stripYamlComments(text) {
  return String(text).split('\n').map((line) => {
    if (/^\s*#/.test(line)) return ''
    let out = '', q = null
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c === q) q = null; out += c; continue }
      if (c === '"' || c === "'") { q = c; out += c; continue }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break
      out += c
    }
    return out
  }).join('\n')
}

const TARGET_RE = /(?:^|[\s;&|(])((?:node|python3?|pwsh|powershell|sh|bash)(?:\s+-[\w=.-]+)*)\s+\.{0,2}\/?((?:scripts)\/[A-Za-z0-9_./-]+\.(?:mjs|js|py|ps1|sh))/g

/** 从一段链文本提出"被调用的脚本路径"。json 取 npm scripts 的值，yaml 取剥注释后的行。 */
export function extractTargets(src, kind = 'yaml') {
  const found = new Set()
  let text = ''
  if (kind === 'json') {
    let obj = null
    try { obj = JSON.parse(src) } catch { return { targets: found, parseError: 'not-json' } }
    text = Object.values(obj?.scripts || {}).join('\n')
  } else if (kind === 'sh') {
    text = String(src).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  } else {
    text = stripYamlComments(src)
  }
  let m
  TARGET_RE.lastIndex = 0
  while ((m = TARGET_RE.exec(text))) found.add(posix.normalize(m[2].replace(/^\.\//, '')))
  return { targets: found }
}

/** 纯函数：全部判定都在这里。夹具只喂合成数据——不读真仓、不读本机 git 状态。 */
export function evaluate({ headFiles, trackedFiles, headTargets, workTargets, selfWired }) {
  const rows = []
  const push = (id, state, label, detail) => rows.push({ id, state, ok: state === 'PASS', label, detail })
  const HF = new Set(headFiles || []), TR = new Set(trackedFiles || [])
  const HT = new Set(headTargets || []), WT = new Set(workTargets || [])

  const dangling = [...HT].filter((p) => !HF.has(p)).sort()
  push('H1', dangling.length ? 'FAIL' : 'PASS', 'H1 提交面链引用都能在提交面解出',
    dangling.length
      ? `HEAD 的链引用了 ${dangling.length} 个 HEAD 里不存在的脚本：${dangling.join(', ')} ⇒ 这种提交在 CI 必是 MODULE_NOT_FOUND，而本地磁盘上有这些文件所以本地全绿`
      : `HEAD 链引用 ${HT.size} 个目标全部命中（HEAD 文件面 ${HF.size} 项）`)

  const untracked = [...WT].filter((p) => !TR.has(p)).sort()
  push('H2', untracked.length ? 'FAIL' : 'PASS', 'H2 工作面链引用都已被 git 跟踪',
    untracked.length
      ? `链上引用但 git 不跟踪：${untracked.join(', ')} ⇒ 本地绿是靠这些没入库的文件撑的（漏 git add、或用 git add -u 时新文件不进暂存面，提交面对它们一无所有）`
      : `工作面链引用 ${WT.size} 项全在 git ls-files 内（跟踪面 ${TR.size} 项）`)

  const inExec = [...HF].filter((p) => EXEC_DIRS.some((d) => p.startsWith(d)) && EXEC_EXT.test(p)
    && !p.includes('/lib/') && !p.includes('/archive/'))
  const referenced = new Set([...HT, ...WT])
  const orphans = inExec.filter((p) => !referenced.has(p) && !ORPHAN_EXEMPT.has(p)).sort()
  push('H3', orphans.length ? 'FAIL' : 'PASS', 'H3 提交面可执行入口都被链引用或在具名豁免册（借 rust tidy check_unused_files）',
    orphans.length
      ? `孤儿入口（HEAD 里有、链上没人引用、也不在豁免册）：${orphans.join(', ')}`
      : `入口面 ${inExec.length} 项：链引用 ${inExec.filter((p) => referenced.has(p)).length}／具名豁免 ${ORPHAN_EXEMPT.size}`)

  const stale = [...ORPHAN_EXEMPT.keys()].filter((p) => referenced.has(p)).sort()
  push('H4', stale.length ? 'FAIL' : 'PASS', 'H4 豁免册反向对账（借 rust tidy "Remove from PERMITTED_DEPENDENCIES list"）',
    stale.length ? `豁免已过时、现在已被链引用：${stale.join(', ')} ⇒ 从册里摘掉，别留成第二个黑账`
      : `豁免册 ${ORPHAN_EXEMPT.size} 条逐条仍成立（都确实没被链引用）`)

  push('H5', selfWired ? 'PASS' : 'FAIL', 'H5 本判据自己在阻断链上（没接线的判据=半成品）',
    selfWired ? SELF + ' 被链面引用 ⇒ 每次 push 生效'
      : SELF + ' 不在任何链面上：能跑但不是闸。落点 = .githooks/pre-push（H2 的对象在 CI 检出里不存在，只有本地 push 那一刻两半同时可判）')
  return rows
}

function kindOf(p) {
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.yml') || p.endsWith('.yaml')) return 'yaml'
  return 'sh'
}

/** 未跟踪+已跟踪的链文件全名（含 .githooks / workflows 下的新件——本轮事故的形态之一就是整件没入库）。 */
function chainFilesOnDisk() {
  const out = new Set(CHAIN_JSON)
  const por = git('status --porcelain -uall -- .githooks .github/workflows'.split(' '))
  for (const line of por.split('\n').filter(Boolean)) {
    const p = line.slice(3).split(' -> ').pop().trim()
    if (p && CHAIN_DIR_PREFIXES.some((d) => p.startsWith(d))) out.add(p)
  }
  for (const p of git(['ls-files', '--', '.githooks', '.github/workflows']).split('\n').filter(Boolean)) {
    if (p.endsWith('.sh') || p.endsWith('.ps1') || p.endsWith('.yml') || p.endsWith('.yaml') || p === '.githooks/pre-commit' || p === '.githooks/pre-push') out.add(p)
  }
  return [...out]
}

export function collect() {
  const headList = git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean)
  const headFiles = new Set(headList)
  const tracked = git(['ls-files']).split('\n').filter(Boolean)
  const headTargets = new Set()
  for (const p of headFiles) {
    if (!CHAIN_JSON.includes(p) && !CHAIN_DIR_PREFIXES.some((d) => p.startsWith(d))) continue
    for (const t of extractTargets(git(['show', 'HEAD:' + p]), kindOf(p)).targets) headTargets.add(t)
  }
  const workTargets = new Set()
  for (const p of chainFilesOnDisk()) {
    const fp = join(root, p)
    if (!existsSync(fp)) continue
    for (const t of extractTargets(readFileSync(fp, 'utf8'), kindOf(p)).targets) workTargets.add(t)
  }
  const selfWired = workTargets.has(SELF) || headTargets.has(SELF)
  return { headFiles, trackedFiles: tracked, headTargets, workTargets, selfWired }
}

/** --drill：合成一份"链引用了没入库的脚本"的面，证明 H2 真会翻红（不碰真仓、不改文件）。 */
export function drill() {
  const rows = evaluate({
    headFiles: ['package.json', 'scripts/a.mjs'],
    trackedFiles: ['package.json', 'scripts/a.mjs'],
    headTargets: ['scripts/a.mjs'],
    workTargets: ['scripts/a.mjs', 'scripts/never-committed.mjs'],
    selfWired: true,
  })
  const hit = rows.find((r) => r.id === 'H2')
  return { rows, ok: !!hit && hit.state === 'FAIL' }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  requireInputs('head-closure', [join(root, 'package.json'), join(root, '.githooks')])
  if (process.argv.includes('--drill')) {
    const d = drill()
    for (const r of d.rows) console.log(`${r.state} ${r.id} :: ${r.label}`)
    console.log(`${d.ok ? 'GATE-PASS' : 'GATE-FAIL'} head-closure(drill) :: 演习面 H2 ${d.ok ? '已翻红 ⇒ 判据有判定力' : '没翻红 ⇒ 判据失效，别信它的绿'}`)
    process.exit(d.ok ? 0 : 1)
  }
  git(['rev-parse', '--verify', 'HEAD'])
  const c = collect()
  const rows = evaluate(c)
  for (const r of rows) console.log(`${r.state} ${r.id} :: ${r.label} —— ${r.detail}`)
  const bad = rows.filter((r) => !r.ok)
  const matched = rows.filter((r) => r.state === 'PASS').length
  console.log(`${bad.length ? 'GATE-FAIL' : 'GATE-PASS'} head-closure :: 链引用 提交面 ${c.headTargets.size}／工作面 ${c.workTargets.size}｜已核 ${matched}/${rows.length}｜失败 ${bad.length}`)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ rows, summary: { matched, failed: bad.length, declared: rows.length } }, null, 2) + '\n')
  }
  process.exit(bad.length ? 1 : 0)
}
