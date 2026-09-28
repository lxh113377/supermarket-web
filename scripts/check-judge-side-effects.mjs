// 对标第四十三轮（2026-09-28）R43-P0：**静态推不出的"这判据会不会改写产物"，用真跑一遍来判**
//
// 一手缺口：R42-H2 把 `writeFileSync(WRITE_QUOTA_FILE, …)` 这类同文件常量/表达式目标认出来了，
// 但还剩 3 件推不出（本轮实测：`scripts/` 里 10 个含 `writeFileSync(` 的 .mjs 有 3 个只剩 unbound）：
//   - `check-d1-roundtrips.mjs` 的目标常量是 **import** 进来的（`lib/d1-quota.mjs`）；
//   - `backup-crypto.mjs` / `restore-drill.mjs` 的目标来自**形参与 argv**。
// 继续叠正则去解 import 会把误判面扩大（第四十二轮实测：把形参并进危险集会**削掉**探针分母）。
// 正解换方向：**别推了，跑一次看盘**。
//
// 同行做法（本轮取证）：`sphinx-doc/sphinx :: sphinx/ext/doctest.py:656-664` 用**结构**判"这块可不可测"；
// `dtolnay/trybuild :: src/run.rs:168-211` 每次造一个一次性工程、产物绝不落回源码树；
// `kubernetes/website :: scripts/test_examples.sh:11,46` 把文档里的 YAML **真交给 go test 跑**。
// ⇒ 共同点：能力不靠自述，靠"造隔离现场跑一遍再比"。
//
// 本件做法：
//   1) `git archive HEAD | tar -x` 解一份**只读快照**到临时目录（共享工作树里的人看不见这次改动）；
//      再把 `node_modules` 以 **junction** 接进去 —— 一手实测：裸快照里 `check-d1-roundtrips --update-write-quota`
//      因取不到 `node_modules/@babel/parser` 直接 rc=2，那是**探针自己**跑不动，不是"它不写产物"；
//   2) 每个候选跑两趟：默认 args（探针/CI 用的那条）与显式写盘 args；
//   3) 逐文件比 **sha256 与 mtime 两把尺**：幂等生成器"写了同样的字节"仍算写过 ⇒ 登记/差集看 touched，
//      只有 S2"内容真被改动"才看 changed（本轮实测 `verify-backend --update` rc=0 且 sha 零差异）；
//   4) 结果写 `docs/judge-side-effects.json`，与登记册、与静态推导**双向**对账；
//   5) S5 的"漏登"只有在**还没并进风险表**时才算缺陷 ⇒ 本件可自愈（补标签再跑就绿），不是永红闸；
//   6) S6 判**证据新鲜度**（第四十五轮加）：册上 `observed_utc` 距今超过 `--max-age-days`（默认 14 天）
//      ⇒ 记 UNVERIFIED/rc=2。理由是本轮把标签改成"静态 ∪ 实测"合成之后，**没有任何判据读过那个时刻**
//      ⇒ 改了写盘代码而不重跑探针，`writes-artifacts` 就悄悄失真（"在册"被当成"仍成立"，同族病）。
//      并且 `--blind-only` 拒绝 `--update`：缩面人口不全，重写册子等于用偏样冒充全量、还会把时刻刷新。
//
// 退出码分档（A-get-memory ⑧-b）：候选 rc 落在 126/127/128/129/被信号杀 ⇒ 该候选 UNVERIFIED，
// 绝不折算成"没改动产物"。零候选/零回执一律 S1 判红。
//
// 用法：node scripts/check-judge-side-effects.mjs             真跑全量候选（需 git + tar + node）
//       node scripts/check-judge-side-effects.mjs --blind-only 只测"静态推不出"的那一类（CI 档位，禁 --update）
//       node scripts/check-judge-side-effects.mjs --update    把实测结果写进登记册（人填字段保留；仅全量面）
//       node scripts/check-judge-side-effects.mjs --max-age-days N  改 S6 的证据期限（默认 14 天，本轮实测值）
//       node scripts/check-judge-side-effects.mjs --fixture F 喂合成回执（夹具/演练，不起子进程）
//       node scripts/check-judge-side-effects.mjs --inject-red 演习：注入"实测有写、静态说没有"，S5 必须判红
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { scanArtifactWrites } from './lib/preflight.mjs'
import { reasonDefects } from './lib/registry-reason.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(__dirname, '..')
export const SELF = 'check-judge-side-effects.mjs'
export const REGISTRY = 'docs/judge-side-effects.json'
export const ENTRY_REG = 'docs/cli-entrypoints.md'
const USAGE_RCS = [null, 126, 127, 128, 129]
export const WRITE_FLAGS = ['--write', '--update-write-quota', '--update', '--apply', '--fix']
const fwd = (p) => String(p).split('\\').join('/')
const base = (f) => String(f).replace(/^scripts\//, '')
/**
 * 写开关按**整词**认，不按子串：`--update-write-quota` 里含 `--update`，子串法会给同一件虚增出一条
 * 它根本不接的通道（第四十四轮夹具一手：`expect(['--update-write-quota'])` 实测拿到两条）。
 * 探针取 `writeFlags[0]` 恰好还是对的那条 ⇒ 缺陷只污染登记册与"通道存在性"声明，不污染结论，故易漏。
 */
const FLAG_CACHE = new Map()
function hasFlag(src, flag) {
  let re = FLAG_CACHE.get(flag)
  if (!re) {
    const esc = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`)
    FLAG_CACHE.set(flag, re)
  }
  return re.test(src)
}

/** 候选面：scripts 下含 writeFileSync 的 .mjs。本件不测自己（它会在临时树里再 archive 一次，属递归）。 */
export function enumerateCandidates(sources) {
  return sources.filter((s) => /\bwriteFileSync\(/.test(s.src) && s.file !== SELF).map((s) => {
    const aw = scanArtifactWrites(s.src)
    return {
      file: s.file, staticResolved: aw.resolved.length, staticUnbound: aw.unbound.length,
      blind: aw.resolved.length === 0 && aw.unbound.length > 0,
      writeFlags: WRITE_FLAGS.filter((f) => hasFlag(s.src, f)),
    }
  }).sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * 「这条静态漏登有没有已经被并进风险面」的唯一问法：风险分类表里该脚本那行是否带 writes-artifacts。
 * 只在表内那一段找（按节切，防别的表里的同名行喂绿）。
 */
export function riskFaceHasWrites(mdSrc, scriptBase) {
  const sec = String(mdSrc || '').split(/^##\s+/m).slice(1).find((x) => x.trimStart().startsWith('风险分类')) || ''
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length >= 3 && cells[1] === scriptBase) return /writes-artifacts/.test(cells[2])
  }
  return false
}

/** 临时树逐文件**双读数**（内容 sha + mtime）；跳过 .git。 */
export function treeHashes(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === '.git') continue
      const full = join(d, e)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      out[relative(dir, full).replace(/\\/g, '/')] = {
        sha: createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16),
        mt: Math.round(st.mtimeMs),
      }
    }
  }
  walk(dir)
  return out
}

/** changed = 内容真变；touched = 被写过（含"写了同样的字节"）。两把尺分开交，不许合并。 */
export function diffHashes(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed = []
  const touched = []
  for (const k of [...keys].sort()) {
    const b = before[k]
    const a = after[k]
    if (!b || !a || b.sha !== a.sha) changed.push({ path: k, from: b ? b.sha : '(新增)', to: a ? a.sha : '(消失)' })
    if (!b || !a || b.mt !== a.mt || b.sha !== a.sha) touched.push({ path: k, identical: !!b && !!a && b.sha === a.sha })
  }
  return { changed, touched }
}

export function evaluate({ candidates, results, registry, injected = null, entryMd = '', now = Date.now(), maxAgeDays = 14 }) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok, label, detail })
  const res = (results || []).concat(injected || [])
  const byFile = new Map(res.map((r) => [r.file, r]))
  const blind = candidates.filter((c) => c.blind)
  const okReason = (u) => !reasonDefects(u.file, u.reason).length
  const named = (key) => new Set((((registry && registry[key]) || []).filter(okReason)).map((u) => base(u.file)))

  push('S1', candidates.length > 0 && blind.every((c) => byFile.has(c.file)),
    'S1 候选面非空且每个"静态推不出"的候选都有实测回执（零回执不得 PASS）',
    `候选 ${candidates.length} 件（本件不测自己，见文件头），其中静态推不出 ${blind.length} 件：`
    + `${blind.map((c) => `${c.file}(${byFile.has(c.file) ? (byFile.get(c.file).unverified ? '回执=未验证' : '有回执') : '**无回执**'})`).join(' / ') || '（没有盲件）'}`)
  // 盲件的回执若是"未验证"，S1 也算不成立（有回执 ≠ 取到了读数）
  const blindNoReading = blind.filter((c) => !byFile.has(c.file) || byFile.get(c.file).unverified)
  rows[rows.length - 1].ok = candidates.length > 0 && blindNoReading.length === 0

  const dirtyDefault = res.filter((r) => r.defaultRun && r.defaultRun.changed.length)
  // 「默认即写盘」的生成器（gen-api-doc 那一类）是本仓已声明的正当形态 —— 不能逼代码为让本件变绿而改行为；
  // 但它必须在册具名，否则 S2 就是一条拒真话的门禁形状（Gate shape must admit the honest value）。
  const generators = named('generators')
  const undeclaredDirty = dirtyDefault.filter((d) => !generators.has(base(d.file)))
  push('S2', undeclaredDirty.length === 0,
    'S2 默认 args 不得改写产物内容，除非在册声明为"生成器通道"（具名 + 可证伪理由）',
    undeclaredDirty.length ? `未声明就默认改写受控产物的: ${undeclaredDirty.map((d) => `${d.file} -> ${d.defaultRun.changed.map((c) => c.path).join(', ')}`).join(' ｜ ')}`
      : `${res.filter((r) => r.defaultRun).length} 件按默认 args 各跑一趟：内容真变 ${dirtyDefault.length} 件`
      // 措辞必须跟着读数走：旧写法在无缺陷时也印"全部在册声明为生成器（gen-api-doc…）"，
      // 把没参与本轮的具名例外说成本轮的免责依据（判据匹配描述而不匹配行为，同族）。
      + (dirtyDefault.length ? `（${dirtyDefault.map((d) => d.file).join(' / ')}）全部在册声明为生成器 ⇒ 这类永不进自动探针面`
        : `；在册生成器 ${generators.size} 件（${[...generators].join(' / ') || '无'}），本轮没有一件在默认 args 下改写过产物`))

  // 「写了同样的字节」也算写过 ⇒ 登记与差集用 touched；只有 S2 那种"内容真被改动"才用 changed
  const observed = new Map(res.map((r) => [r.file, r.writeRun ? r.writeRun.touched.map((c) => c.path) : []]))
  const allObserved = new Set([...observed.values()].flatMap((v) => v))
  const declared = new Set(((registry && registry.entries) || []).flatMap((e) => e.writes || []))
  const undeclared = [...allObserved].filter((p) => !declared.has(p))
  // 幽灵腿只能指控"这一轮真的去敲过那扇门、门后却是空的"的登记项：册里的产物按**生产者**归位，
  // 生产者本轮没被跑起来（不可探针）或写通道没触达（rc≠0 / 无写开关 / 环境不满足）⇒ 记"未复核"，
  // 不记幽灵。一手形态：CI 里没有 CF 凭据，`check-d1-remote-usage --write` 拿 rc=1 ⇒ 它的产物
  // `docs/d1-remote-usage.json` 会被误判成"登记的没跑出来"——那是**没测到**，不是册子说谎（同 ②-b、同 blindness-is-not-zero）。
  const blindProducers = new Set(res.filter((r) => r.unverified
    || !r.writeRun || r.writeRun.rc !== 0 || (r.skippedWrite && !(r.writeRun && r.writeRun.touched.length))).map((r) => r.file)
    // `--blind-only`（CI 档位）下，非盲件根本不进 results ⇒ 它们同样算"本轮没敲那扇门"。
    // 少了这一半，缩小面就会把册里所有别人产的产物报成幽灵 —— 一条由**模式**造成的假红。
    .concat(candidates.filter((c) => !byFile.has(c.file)).map((c) => c.file)))
  const excused = new Set(((registry && registry.entries) || [])
    .filter((e) => blindProducers.has(base(String(e.file || '')))).flatMap((e) => e.writes || []))
  const ghostsReg = [...declared].filter((p) => !allObserved.has(p) && !p.includes('*')
    && !((registry && registry.allow_stale) || []).includes(p) && !excused.has(p))
  push('S3', undeclared.length === 0 && ghostsReg.length === 0,
    'S3 实测改写面 ⇄ 登记册 双向对账（跑出来的没登记=漏登；登记的没跑出来=幽灵或通道改名）',
    `实测被碰过的产物 ${allObserved.size} 个 ⇄ 册里登记 ${declared.size} 个`
    + (undeclared.length ? `；漏登: ${undeclared.join(', ')}` : '')
    + (ghostsReg.length ? `；幽灵: ${ghostsReg.join(', ')}` : '')
    + (excused.size ? `；生产者本轮未触达、不计幽灵 ${excused.size} 个（${[...excused].join(' / ')}）` : ''))

  const unverRaw = res.filter((r) => r.unverified)
  const okUnprobeable = named('unprobeable')
  const unexplained = unverRaw.filter((r) => !okUnprobeable.has(base(r.file)))
  push('S4', unexplained.length === 0,
    'S4 取不到回执的必须逐条具名理由（rc 126/127/128/129/信号 ⇒ 未验证，不折算成"没改写产物"）',
    unexplained.length ? `未验证且没在册理由 ${unexplained.length} 件: ${unexplained.map((u) => `${u.file}(${u.unverified})`).join(' / ')}`
      : `${res.length} 件里 ${res.filter((r) => !r.unverified).length} 件取到读数；其余 ${unverRaw.length} 件在册具名为不可探针（理由含实测数字或可复跑命令）`)

  const condW = named('conditional_writers')
  const staticSays = new Set(candidates.filter((c) => c.staticResolved > 0).map((c) => c.file))
  const ranSays = new Set([...observed.entries()].filter(([, v]) => v.length).map(([f]) => f))
  const unreached = new Set(res.filter((r) => r.skippedWrite && !r.unverified).map((r) => r.file)
    .concat(res.filter((r) => r.writeRun && r.writeRun.rc !== 0 && !r.writeRun.touched.length).map((r) => r.file))
    .concat(res.filter((r) => !r.writeRun && !r.skippedWrite && !r.unverified).map((r) => r.file))
    // 同 S3 那一半：`--blind-only` 缩面后，没进本轮 results 的候选一个都没被跑过 —— 把它们算成
    // "静态说有写通道却没碰产物"的幽灵，等于让**模式**造出 5 条假红（本机实测 @2026-09-28）。
    .concat(candidates.filter((c) => !byFile.has(c.file)).map((c) => c.file)))
  const missedAll = [...ranSays].filter((f) => !staticSays.has(f))
  const merged = missedAll.filter((f) => riskFaceHasWrites(entryMd, f))
  const missed = missedAll.filter((f) => !merged.includes(f))
  // 幽灵腿只能指控"跑过、且确实没碰产物"的对象：本轮一手 —— 新增件还没入库时 HEAD 快照里根本没有它，
  // `probe()` 返回 unverified ⇒ 它永远进不了 ranSays，于是被误判成"静态说有写通道却没碰任何产物"。
  // 那不是幽灵，是**没测**（第四十四轮真跑实测：S4 已具名不可探针，S5 却又把它当缺陷 ⇒ 同一事实两种口径）。
  const notRan = new Set(res.filter((r) => r.unverified).map((r) => r.file))
  const ghosts = [...staticSays].filter((f) => !ranSays.has(f) && !unreached.has(f) && !notRan.has(f) && !condW.has(f))
  push('S5', ghosts.length === 0 && missed.length === 0,
    'S5 静态推导 ⇄ 实测行为 差集（本件存在的理由：静态说不写而实测写了 = 漏登；并入风险表即自愈）',
    `静态判"会写" ${staticSays.size} 件 ⇄ 实测"确实写过" ${ranSays.size} 件`
    + (missed.length ? `；**静态漏登且尚未并入风险表**: ${missed.join(', ')}` : '')
    + (merged.length ? `；已由实测并入风险表: ${merged.join(', ')}` : '')
    + (condW.size ? `；条件性写入具名在册 ${condW.size} 件` : '')
    + (unreached.size ? `；写通道未触达 ${unreached.size} 件（不计幽灵也不计已证）` : '')
    + (ghosts.length ? `；静态幽灵（写通道触达却没碰任何产物）: ${ghosts.join(', ')}` : ''))

  const MAX_AGE_DAYS = maxAgeDays
  // S6：风险标签的证据有没有过期。第四十四轮把标签改成"静态 ∪ 实测"合成，但**没有任何判据读过
  // `observed_utc`** ⇒ 改了写盘代码而不重跑探针，`writes-artifacts` 就悄悄失真（同 R44 那批"在册即已验"的病）。
  // 阈值是**拍的**，所以同时印出复算命令与当前年龄，让下一轮能证伪它而不是继承它。
  // 语义取 UNVERIFIED（rc=2）而不是"违规"：过期不是罪，是**证据失效**——但它照样拦 CI，
  // 因为"没人重跑"不该被读成"标签仍然成立"。
  const stamp = registry && registry.observed_utc
  const ageDays = stamp && Number.isFinite(Date.parse(stamp)) ? (now - Date.parse(stamp)) / 86400000 : null
  push('S6', ageDays !== null && ageDays <= MAX_AGE_DAYS,
    `S6 登记册实测读数必须够新（≤${MAX_AGE_DAYS} 天，可用 --max-age-days 覆写）—— 否则风险表里的 writes-artifacts 是旧证据`,
    ageDays === null
      ? `册上没有 observed_utc 或读不出时刻 ⇒ 无法判新鲜度，不折算成"证据仍成立"；重跑 \`node scripts/check-judge-side-effects.mjs --update\`（全量面）`
      : `读数距今 ${ageDays.toFixed(1)} 天（observed_utc=${stamp}，阈值 ${MAX_AGE_DAYS} 天）`
      + (ageDays <= MAX_AGE_DAYS ? ' ⇒ 在期限内' : ' ⇒ **证据已过期**：静态标签与实测行为可能已分叉，重跑全量面 --update；`--blind-only` 不刷册（缩面不得冒充全量）'))

  return { rows, counts: { candidates: candidates.length, blind: blind.length, receipts: byFile.size, observedWrites: allObserved.size } }
}

export function verdictOf(rows) {
  const failed = rows.filter((r) => r.ok === false)
  if (!failed.length) return { verdict: 'GREEN', rc: 0 }
  // S4（取不到读数）与 S6（读数过期）都是**证据失效**，不是"判出违规" ⇒ 记 UNVERIFIED / rc=2；
  // 两者照样拦 CI（非零），但台账上不许把"证据旧了"抄成"标签错了"，也不许抄成"通过"。
  return failed.some((r) => r.id === 'S4' || r.id === 'S6') ? { verdict: 'UNVERIFIED', rc: 2 } : { verdict: 'RED', rc: 1 }
}

function extractTo(dest) {
  mkdirSync(dest, { recursive: true })
  const a = spawnSync('git', ['archive', 'HEAD'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
  if (a.status !== 0) return { ok: false, reason: `git archive rc=${a.status}` }
  // Windows 上 bsdtar/GNU tar 把反斜杠当转义符（实测 `tar: C\:\\Users\\...: Cannot open`）⇒ 一律给正斜杠形态。
  const t = spawnSync('tar', ['-x', '-C', fwd(dest)], { input: a.stdout, encoding: 'utf8' })
  if (t.status !== 0) return { ok: false, reason: `tar rc=${t.status} ${String(t.stderr || '').split('\n')[0]}` }
  let linked = false
  try { symlinkSync(join(ROOT, 'node_modules'), join(fwd(dest), 'node_modules'), 'junction'); linked = true } catch { linked = false }
  return { ok: true, linked }
}

function runOne(dest, file, extraArgs) {
  if (!existsSync(join(dest, 'scripts', file))) return { ran: false, reason: 'HEAD 快照里没有这个文件（本轮新增件，入库后自动可探）' }
  const r = spawnSync(process.execPath, ['scripts/' + file, ...extraArgs], {
    cwd: fwd(dest), encoding: 'utf8', timeout: 240_000, env: { ...process.env, CI: 'true' },
  })
  if (r.error) return { ran: false, reason: `spawn 失败 ${r.error.code || r.error.name}` }
  if (USAGE_RCS.includes(r.status)) return { ran: false, rc: r.status, reason: `rc=${r.status} 属用法/权限/信号档 ⇒ 不采纳` }
  return { ran: true, rc: r.status }
}

function mkdtempSafe(prefix) {
  const p = join(tmpdir(), prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
  mkdirSync(p, { recursive: true })
  return p
}

function probe(file, writeFlags) {
  const dest = mkdtempSafe('r43se-')
  const ex = extractTo(dest)
  if (!ex.ok) { rmSync(dest, { recursive: true, force: true }); return { file, unverified: ex.reason, defaultRun: null, writeRun: null } }
  try {
    const base0 = treeHashes(dest)
    const d = runOne(dest, file, [])
    const dd = diffHashes(base0, treeHashes(dest))
    const defaultRun = d.ran ? { rc: d.rc, changed: dd.changed, touched: dd.touched } : null
    let writeRun = null
    if (writeFlags.length) {
      const dest2 = mkdtempSafe('r43sew-')
      const ex2 = extractTo(dest2)
      if (ex2.ok) {
        const base2 = treeHashes(dest2)
        const w = runOne(dest2, file, [writeFlags[0]])
        if (w.ran) {
          const dw = diffHashes(base2, treeHashes(dest2))
          writeRun = { rc: w.rc, flag: writeFlags[0], changed: dw.changed, touched: dw.touched }
        }
      }
      rmSync(dest2, { recursive: true, force: true })
    }
    const unverified = (!defaultRun && !writeRun) ? (d.reason || '两侧都没跑起来') : null
    return { file, defaultRun, writeRun, unverified, depsLinked: ex.linked, skippedWrite: !writeFlags.length }
  } finally { rmSync(dest, { recursive: true, force: true }) }
}

function readSources() {
  const dir = join(ROOT, 'scripts')
  return readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => ({ file: f, src: readFileSync(join(dir, f), 'utf8') }))
}

function main() {
  const argv = process.argv.slice(2)
  const update = argv.includes('--update')
  const inj = argv.includes('--inject-red')
  const blindOnly = argv.includes('--blind-only')
  const fxIdx = argv.indexOf('--fixture')
  const ageIdx = argv.indexOf('--max-age-days')
  const ageArg = ageIdx === -1 ? null : argv[ageIdx + 1]
  const maxAgeDays = ageArg === null ? 14 : Number(ageArg)
  // 参数校验必须在**任何探测之前**：本仓全量面要跑 ≈300s，把校验放在后面等于"非法用法先烧五分钟"
  // （本轮这条就是这么被 120s 超时抓出来的）。
  if (ageArg !== null && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)) {
    console.error(`[judge-side-effects] --max-age-days 需要一个非负数字，实测拿到 ${JSON.stringify(ageArg)} ⇒ rc=2（不静默退回默认 14）`)
    process.exit(2)
  }
  if (update && blindOnly) {
    console.error('[judge-side-effects] 拒绝执行：--update 只允许配全量面（`--blind-only` 是缩面，重写册子等于用偏样冒充全量，且会刷新 observed_utc）⇒ rc=2')
    process.exit(2)
  }
  let candidates, results
  if (fxIdx !== -1) {
    const f = JSON.parse(readFileSync(argv[fxIdx + 1], 'utf8'))
    candidates = f.candidates || []; results = f.results || []
  } else {
    candidates = enumerateCandidates(readSources())
    // CI 档位：只测"静态推不出"的那一类 —— 本件存在的全部理由就是它们，非盲件由 `classifyRisk` 覆盖。
    // 本机第四十四轮实测全量面 9 件 ≈300s（每件解一份 git archive 快照、再跑两趟），缩面后 3 件。
    // 两种模式的取数面都印在门面行上，不许拿缩面的读数冒充"全量核过"。
    results = (blindOnly ? candidates.filter((c) => c.blind) : candidates).map((c) => probe(c.file, c.writeFlags))
  }
  if (inj) {
    candidates = candidates.concat([{ file: 'INJECTED-writer.mjs', staticResolved: 0, staticUnbound: 2, blind: true, writeFlags: ['--write'] }])
    results = results.concat([{
      file: 'INJECTED-writer.mjs', defaultRun: { rc: 0, changed: [], touched: [] },
      writeRun: { rc: 0, flag: '--write', changed: [], touched: [{ path: 'docs/INJECTED-artifact.json', identical: true }] },
    }])
  }
  const regPath = join(ROOT, REGISTRY)
  const EMPTY = { entries: [], generators: [], unprobeable: [], conditional_writers: [], allow_stale: [] }
  const registry = fxIdx !== -1 ? (JSON.parse(readFileSync(argv[fxIdx + 1], 'utf8')).registry || EMPTY)
    : (existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : EMPTY)
  const entryPath = join(ROOT, ENTRY_REG)
  // 夹具可以自带风险表面（否则测的是"真表当前长什么样"，那是集成检查不是单元夹具）；
  // 真面跑时读 docs/cli-entrypoints.md——S5 的"已并入"必须有实体表格行背书，不许凭记忆。
  const fxEntry = fxIdx !== -1 ? JSON.parse(readFileSync(argv[fxIdx + 1], 'utf8')).entryMd : undefined
  const entryMd = fxEntry !== undefined ? fxEntry : (existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : '')
  if (entryMd === '' && !update) console.error(`[judge-side-effects] BLOCKED 读不到 ${ENTRY_REG} ⇒ 无法判"漏登是否已并入风险表"，本 run 不宣称绿`)
  const { rows, counts } = evaluate({
    candidates, results, registry, entryMd,
    now: Date.now(),
    maxAgeDays,
  })
  for (const r of rows) console.log(`${r.ok === true ? 'PASS' : 'FAIL'} ${r.id} ${r.label} (${r.detail})`)
  if (!update) {
    for (const r of results) console.log(`  - ${r.file} blind=${(candidates.find((c) => c.file === r.file) || {}).blind}`
      + ` 默认args: rc=${r.defaultRun ? r.defaultRun.rc : '未跑'} 内容变 ${r.defaultRun ? r.defaultRun.changed.length : '-'} / 碰过 ${r.defaultRun ? r.defaultRun.touched.length : '-'} 个`
      + ` 写盘args: ${r.writeRun ? `${r.writeRun.flag} rc=${r.writeRun.rc} 碰过 ${r.writeRun.touched.map((t) => t.path + (t.identical ? '(同字节)' : '')).join(',') || '（零）'}` : '未跑/无通道'}`
      + (r.depsLinked === false ? ' ⇒ 依赖没接上(junction 失败)' : '') + (r.unverified ? ` ⇒ UNVERIFIED(${r.unverified})` : ''))
  }
  if (update) {
    const body = {
      schema: 'chaoshi-judge-side-effects-v1',
      note: '由 `node scripts/check-judge-side-effects.mjs --update` 生成——**跑出来的**，不是推出来的。'
        + 'entries[].writes = 显式写盘开关实测碰过的受控路径（含"写了同样字节"，幂等生成器也算写过）；'
        + 'generators = 默认 args 即改写产物的正当生成器通道（永不进自动探针面）；'
        + 'unprobeable / conditional_writers / allow_stale 是人填的具名例外，理由须含实测数字或可复跑命令。',
      observed_utc: new Date().toISOString(), counts,
      entries: candidates.map((c) => {
        const r = results.find((x) => x.file === c.file) || {}
        return {
          file: 'scripts/' + c.file, blind: c.blind, write_flags: c.writeFlags,
          default_rc: r.defaultRun ? r.defaultRun.rc : null,
          default_dirty: r.defaultRun ? r.defaultRun.changed.map((x) => x.path) : [],
          write_rc: r.writeRun ? r.writeRun.rc : null, write_flag: r.writeRun ? r.writeRun.flag : null,
          writes: r.writeRun ? r.writeRun.touched.map((x) => x.path) : [],
          writes_identical: r.writeRun ? r.writeRun.touched.filter((x) => x.identical).map((x) => x.path) : [],
          unverified: r.unverified || null,
        }
      }),
      generators: registry.generators || [], unprobeable: registry.unprobeable || [],
      conditional_writers: registry.conditional_writers || [], allow_stale: registry.allow_stale || [],
    }
    writeFileSync(join(ROOT, REGISTRY), JSON.stringify(body, null, 2) + '\n', 'utf8')
    console.log(`[judge-side-effects] 已重写 ${REGISTRY}（候选 ${counts.candidates}、盲件 ${counts.blind}、实测产物 ${counts.observedWrites}）`)
  }
  const v = verdictOf(rows)
  const matched = rows.filter((r) => r.ok === true).length
  console.log(`==== 结果: ${matched}/${rows.length} 通过 ｜ verdict=${v.verdict} ｜ 候选 ${counts.candidates}（盲 ${counts.blind}）====`)
  console.log(`${v.rc === 0 ? 'GATE-PASS' : 'GATE-FAIL'} judge-side-effects :: 回执 ${counts.receipts} 份｜实测改写面 ${counts.observedWrites} 个｜取数面=${fxIdx !== -1 ? '合成夹具' : blindOnly ? '只测静态推不出的盲件（--blind-only）' : '全量候选'}`)
  process.exit(v.rc)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(join(ROOT, 'scripts', SELF))) {
  try { main() } catch (e) { console.error(`[judge-side-effects] 未预期异常：${e && e.stack ? e.stack : e}`); process.exit(2) }
}
