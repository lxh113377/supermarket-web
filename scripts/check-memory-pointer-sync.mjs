#!/usr/bin/env node
/**
 * memory-pointer-sync —— 外层"工作区级记忆指针"是否还跟着轮次走（第三十六轮）。
 *
 * 一手动因（本轮 Step 0 实测，不是猜）：`超市/memory/07-next-steps.md` 里有一串
 * `## <日期> — 对标第N轮（工作区级指针）` 的追加约定，**末次追加止于第二十九轮**，
 * 之后 R30~R34 共 5 轮静默断更，而且没有任何东西守着它（内层 4KB 判据的作用面不含该文件，
 * `handoff.py volume` 又按 shell_max=40,960B 判它 ⇒ 两把尺相差 10 倍，更松的那把量着更旧的那份）。
 *
 * 结论：**约定没有判据 = 约定会在某一轮无声失效**。本判据把它变成会红的东西。
 * 三态（同 check-branch-protection 的口径，绝不把"看不见"记成"通过"）：
 *   PASS        外层最新轮次 == 内层最新轮次（指针跟上了）
 *   FAIL        落后 / 超前 / 两侧都取不到轮次号（取数面坏了）
 *   UNVERIFIED  外层目录不在（CI 只检出代码仓 ⇒ 这是"未观测"，不是"已核对"）
 *
 * 用法：node scripts/check-memory-pointer-sync.mjs [--json]
 * 退出码：0=PASS 或 UNVERIFIED（advisory 不阻断）/ 1=判出漂移 / 2=内层取数失败
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail } from './lib/preflight.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 外层工作区记忆目录：在代码仓的**同级**（工作区根 `超市web/` 下），不在代码仓里。
 * 首版把这里写成 `../../超市/memory` ⇒ 解析到工作区之外 ⇒ existsSync 恒 false，
 * 判据一句话没说就走了 UNVERIFIED 分支，输出看着完全合理（"CI 只检出本仓"）。
 * 教训：一条会返回"未观测"的判据，必须先证明它在**能观测到的环境里观测到了**。
 */
export const OUTER_MEMORY = join(root, '..', '超市', 'memory')
/** 外层归档面：编号报告落这里，它也在代码仓之外 ⇒ 与 OUTER_MEMORY 同规（不在 ⇒ 未观测，不是已核对）。 */
export const DELIVERABLES = join(root, '..', 'deliverables')
/** 外层归档仓根（P5 的 git 取数面）。 */
export const OUTER_REPO = join(root, '..')
/** 生产侧 git 取数：只在归档仓根上跑，禁 -C 到别处；取不到 ⇒ rc!==0，由 P5 折成 UNVERIFIED。 */
export function makeGitRunner (repoRoot, { spawn = spawnSync, timeoutMs = 20_000 } = {}) {
  return (args) => {
    const r = spawn('git', ['-C', repoRoot, ...args], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
    if (!r || typeof r.status !== 'number') return null
    return { rc: r.status, stdout: String(r.stdout || '') }
  }
}
const CN = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** "第三十五轮" → 35；"第三十~三十五轮" → [30, 35]（R35 那次补齐就是区间写法）。
 *  解析不了返回空数组 —— **不得**返回 0，那会把"读不懂"伪装成"第 0 轮"。
 *
 *  第五十九轮改口径（一手失明）："对标"二字原先是**必选**的，于是标题写成
 *  `## 2026-10-01 — 第五十八轮续（…）` 的两轮**整段落在这条闸的取数面之外**：
 *  P1/P2 照样印「内层最新 = 第 57 轮」「外层 == 内层 ⇒ 指针在跟」「已核对 2/2」，
 *  而真实轮次已经往前走了两轮。判据只认一种写法，等于把"下一轮换个写法"变成"永久免检"。
 *  现在前缀可选 —— 语义仍是"轮次标题"，只是不再靠一个字面词撑着。 */
export function roundsOf(text) {
  const out = []
  const re = /(?:对标)?第([零一二三四五六七八九十百]{1,6}(?:\s*[~～\-、]\s*[零一二三四五六七八九十百]{1,6})*)轮/g
  for (const m of text.matchAll(re)) {
    for (const part of m[1].split(/[~～\-、]/)) {
      const r = cnNum(part.trim())
      if (r !== null) out.push(r)
    }
  }
  return out
}

/** 单个中文数词（支持到 九十九）；解析不了返回 null。 */
export function cnNum(s) {
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const ten = s.indexOf('十')
  if (ten >= 0) {
    const hi = ten === 0 ? 1 : CN[s[ten - 1]]
    const lo = ten === s.length - 1 ? 0 : CN[s[ten + 1]]
    if (hi === undefined || lo === undefined) return null
    return hi * 10 + lo
  }
  return CN[s] !== undefined && s.length === 1 ? CN[s] : null
}

/** 一份 07 系文件里最新的轮次号（多份取最大值）+ 一节多号的歧义标题。
 *
 *  `ambiguous` 是第六十五轮一手加进来的：我写第 63 轮的补记时把标题写成
 *  `## … 第六十三轮（… · 第六十五轮补记）`，`roundsOf` 两个号都收 ⇒
 *  `latestRound` 把内层"最新轮次"顶成 65，P2 当场误报"外层断更 1 轮"。
 *  即"谁记录的"与"记录的是哪一轮"共用一个字段。**只把约定写进注释不算修完**——
 *  下一份补记还会这么写，所以这里让它判红。区间写法（`第三十~三十五轮`）是本仓在用的合法补齐形态，不算歧义。
 */
export function latestRound(dir) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => /^07-next-steps(\.part\d+)?\.md$/.test(f))
  let best = null
  const seen = []
  const ambiguous = []
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n')
    for (const line of text.split('\n')) {
      if (!line.startsWith('## ')) continue
      const isRange = /第[零一二三四五六七八九十百]{1,6}\s*[~～\-、]\s*[零一二三四五六七八九十百]{1,6}轮/.test(line)
      const rs = new Set(roundsOf(line))
      if (!isRange && rs.size > 1) ambiguous.push({ file: f, rounds: [...rs].sort((a, b) => a - b), title: line.slice(0, 60) })
      for (const r of rs) { seen.push(r); if (best === null || r > best) best = r }
    }
  }
  return best === null ? { round: null, seen, ambiguous } : { round: best, seen, ambiguous }
}

/**
 * 一份文件里所有"轮次标题"的轮号**集合**（区别于 latestRound 只取最大值）。
 *
 * 为什么必须要集合形态（第六十五轮 P3 的直接动因）：`latestRound()` 取 max，
 * 于是"第 63 轮在 CHANGELOG 被宣称、内层记忆里根本不存在"这件事在 max 口径下**不可见**——
 * 64 存在就把 63 的缺失盖住了。缺号只有按集合做差集才现形。
 *
 * `headingOnly` 决定前缀：07 系是 `## `，CHANGELOG 是 `### `。
 * 只吃标题行，不吃正文里的"第N轮"提法 —— 否则"接管第六十二轮 §8 那条 P0"这种
 * 叙述会被当成一次轮号宣称（第六十五轮实测：正文口径会让 CHANGELOG 从 2 个宣称涨到 9 个，
 * 全是转述，不是账）。
 */
export function roundSetOf(dir, { file = null, heading = '## ', recursive = true } = {}) {
  const seen = new Set()
  const bump = (text, name) => {
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      if (!line.startsWith(heading)) continue
      for (const r of roundsOf(line)) seen.add(r)
    }
    void name
  }
  if (file) {
    if (!existsSync(file)) return null
    bump(readFileSync(file, 'utf8'), file)
    return [...seen].sort((a, b) => a - b)
  }
  if (!existsSync(dir)) return null
  const walk = recursive
    ? readdirSync(dir).filter((f) => /^07-next-steps(\.part\d+)?\.md$/.test(f))
    : []
  if (!walk.length) return []
  for (const f of walk) bump(readFileSync(join(dir, f), 'utf8'), f)
  return [...seen].sort((a, b) => a - b)
}

/** CHANGELOG 的轮号声明面：`### <日期> …（第N轮）` 标题。文件不在 ⇒ null（未观测，不是零）。 */
export function changelogRounds(changelogPath) {
  return roundSetOf(null, { file: changelogPath, heading: '### ' })
}

/**
 * P3 存量册（第六十五轮）：首跑真面点名 18 个"只在 CHANGELOG 存在"的轮号，逐条读后判为
 * **口径过强而非 18 条欠账** —— `verify:pointers` 是第三十六轮才立的，"每轮在 07 主卷留一节"
 * 这条约定在那之前根本不存在（老轮次的记录形态是 `追加N十N` 的 CHANGELOG 标题与外层指针，
 * 内层 07 系只从 R51 起逐轮留节）。把 17 个存量轮号判红 = 逼下一轮**编 17 份假记忆**，
 * 而"为变绿补造记录"比"轮号漂移"更坏。
 *
 * 所以按本仓既有做法分两半：存量**具名在册**（只报不拦，逐号写死），新增**必红**。
 * 同时带 rust tidy 的"Remove from EXCEPTIONS list"反向腿：册里的号一旦不再缺失
 * （有人真补了那一轮的记忆节），这条基线就必须变短，不短即判红 —— 防它变成第二真相源。
 * 第 63 轮**不在册**：它发生在约定生效之后，是真缺陷，本轮以内层 `part126` 补记关闭。
 */
export const ORPHAN_BASELINE = [12, 16, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 41, 51]

export function evaluate({ inner, outer, outerPath = OUTER_MEMORY, innerRounds = null, clRounds = null, changelogPath = null, deliverablesDir = DELIVERABLES, gitRunner = null }) {
  const rows = []
  const push = (id, state, label, detail) => rows.push({ id, state, ok: state !== 'FAIL', label, detail })
  if (!inner) {
    push('P1', 'FAIL', 'P1 内层最新轮次取到', '内层 07 主卷取不到任何"对标第N轮"标题 ⇒ 取数面坏了，不判通过')
    return rows
  }
  if (outer === null) {
    push('P1', 'PASS', 'P1 内层最新轮次取到', `内层最新 = 第 ${inner.round} 轮（标题命中 ${inner.seen.length} 处）`)
    push('P2', 'UNVERIFIED', 'P2 外层工作区指针是否跟上内层轮次',
      `外层目录不存在（${outerPath} 在代码仓之外，CI 只检出本仓）⇒ 这是未观测，不是已核对`)
  } else if (!outer) {
    push('P1', 'PASS', 'P1 内层最新轮次取到', `内层最新 = 第 ${inner.round} 轮`)
    push('P2', 'FAIL', 'P2 外层工作区指针是否跟上内层轮次',
      '外层 07 系文件里取不到任何"对标第N轮"标题 ⇒ 指针序列被清空或改名，无人知晓就是这类失效的开端')
  } else {
    const gap = inner.round - outer.round
    push('P1', 'PASS', 'P1 内层最新轮次取到', `内层最新 = 第 ${inner.round} 轮（标题命中 ${inner.seen.length} 处）`)
    push('P2', gap === 0 ? 'PASS' : 'FAIL', 'P2 外层工作区指针是否跟上内层轮次',
      gap === 0
        ? `外层最新 = 第 ${outer.round} 轮 == 内层 ⇒ 指针在跟（断更过一次的那 5 轮已补齐）`
        : gap > 0
          ? `外层停在第 ${outer.round} 轮、内层已到第 ${inner.round} 轮 ⇒ 断更 ${gap} 轮：要么补一条指针，要么把"外层不再逐轮追加"写进外层文件头并改本判据口径`
          : `外层第 ${outer.round} 轮 超前内层第 ${inner.round} 轮 ⇒ 两侧轮次取数有一侧不对，先归因再改判据`)
  }

  // ── P3：第三取数面 = CHANGELOG 的轮号宣称 ⇄ 内层记忆（权威源）────────────────
  // 立它的一手事实（第六十四轮）：`CHANGELOG.md:7` 写着「第六十三轮」（商品图+4 件零食，提交
  // c995366..ccebafa），而内层 07 系里**从来没有**第 63 轮这一节，外层也只有本轮才补的补记；
  // P1/P2 当时印「内层 62｜外层 62 ⇒ 指针在跟｜已核对 2/2」PASS —— 因为 P1 取 max，
  // 64 存在就把 63 的缺失盖住了。⇒ 轮号在 CHANGELOG 被宣称、在记忆里不存在，结构上无人知晓。
  // 权威定为内层 07 系（它每轮实测复跑，也是 36 轮立账时写明的"唯一权威源"）。
  if (clRounds === null) {
    push('P3', 'UNVERIFIED', 'P3 CHANGELOG 宣称的轮号是否都有内层记忆节（权威=内层 07 系）',
      `CHANGELOG 取不到（${changelogPath || '未给路径'}）⇒ 未观测，不判通过也不判漂移`)
  } else {
    const innerSet = innerRounds || []
    const orphans = clRounds.filter((r) => !innerSet.includes(r))
    const fresh = orphans.filter((r) => !ORPHAN_BASELINE.includes(r))
    const stale = ORPHAN_BASELINE.filter((r) => !orphans.includes(r))
    const ok = fresh.length === 0 && stale.length === 0
    push('P3', ok ? 'PASS' : 'FAIL', 'P3 CHANGELOG 宣称的轮号是否都有内层记忆节（权威=内层 07 系）',
      `CHANGELOG 宣称 ${clRounds.length} 个轮号 ⇄ 内层 07 系 ${innerSet.length} 个 ⇒ 缺失 ${orphans.length} 个`
      + `（存量在册 ${ORPHAN_BASELINE.length}｜约定立于此判据之前，见 ORPHAN_BASELINE 注）`
      + (fresh.length
        ? `｜**新增缺失 ${fresh.length} 个 [${fresh.join(', ')}]** ⇒ 补一卷真记录（沿 55 轮补记 54 轮的在仓先例），禁加进基线消音`
        : '｜新增缺失 0')
      + (stale.length
        ? `｜基线幽灵 ${stale.length} 个 [${stale.join(', ')}] ⇒ 那一轮已有记忆节，把号从 ORPHAN_BASELINE 删掉（不删＝基线成第二真相源）`
        : '｜基线幽灵 0')
      // 反向那一半**结构性不可能满足**：CHANGELOG 门禁只在触及 src/functions 时才要求条目，
      // 纯记忆/文档轮次本来就没有 CHANGELOG 标题 ⇒ 判红就是逼后来人给每轮编一条假变更。只报不拦。
      + `｜反向外挂 ${innerSet.filter((r) => !clRounds.includes(r)).length} 个（内层有、CHANGELOG 无标题）属预期面，不判`)
  }

  // P4：一节只准一个轮号。与 P1 分判不同事实 —— P1 问"最新轮次取到没有"，P4 问
  // "有没有哪一节的标题往 `latestRound` 里塞了两个号"。合写一条会让 P1 的读数失去可归因性。
  const amb = [...((inner && inner.ambiguous) || []), ...((outer && outer.ambiguous) || [])]
  push('P4', amb.length ? 'FAIL' : 'PASS', 'P4 每个轮次节标题只准声明一个轮号（补记者的编号不得顶高"最新轮次"）',
    amb.length
      ? `${amb.length} 节含多号：${amb.slice(0, 4).map((a) => `${a.file}「${a.title}」=[${a.rounds.join(',')}]`).join(' ; ')}`
        + ' ⇒ 把"由谁补记"挪到正文，标题只留被记录的那一轮；区间写法（第N~M轮）不在此列'
      : `内层 ${(inner && inner.ambiguous && inner.ambiguous.length) || 0} + 外层 ${(outer && outer.ambiguous && outer.ambiguous.length) || 0} 处歧义标题；区间形态已豁免`)

  // P5：外层**归档面**是否真的入库（第七十一轮）。
  // P1/P2 判的是"外层台账文件的**内容**跟没跟上轮次"，第七十轮栽的是另一半：那份报告写在磁盘上、
  // 内容也对，但它在外层 git 里是 `??`（未跟踪），台账改动也一直是 `M`（未提交）——
  // 两面都在磁盘，两面都没进历史。⇒ **P2 绿不等于账已经还了**，这是同一族的第 6 次复发形态。
  // 本条把"产物必须真进归档仓"从一次性补账变成会红的东西；它接在 pre-commit 第 5 条腿上，
  // 所以牙齿在**提交那一步**，不用等下一轮 verify 才现形。
  push(...p5Row({ inner, outer, outerPath, deliverablesDir, gitRunner }))
  return rows
}

/** 从报告**文件名**取轮号：`GitHub开源项目对标分析报告-第七十轮-2026-10-07.md` → 70。
 *  与 P1/P2 复用同一个 `roundsOf` ⇒ "第 R 轮"在全判据里只有一套读法（行名单源；两套读法必分叉）。
 *  取不到轮号的（`对标报告-2026-09-30.md`、`…交付记录-….md`）一律不参与，且在计数里具名。 */
export function reportRoundOf(fileName) {
  const rs = roundsOf(String(fileName).replace(/\.[mM][dD]$/, ''))
  return rs.length ? Math.max(...rs) : null
}

/** `git status --porcelain -z` 的行解析：NUL 分隔，前 2 字符是 XY 状态位，第 3 字符是空格。
 *  只取路径；重命名的第二段（旧路径）会被当成一条"路径"读进来 —— 它同样表示在途，判 dirty 不影响。 */
export function parsePorcelainZ(out) {
  return String(out || '').split('\0').filter((s) => s.length >= 4).map((rec) => ({
    xy: rec.slice(0, 2), path: rec.slice(3),
  }))
}

const P5_PATHS = ['deliverables', '超市/memory']

function p5Row({ inner, outer, outerPath, deliverablesDir, gitRunner }) {
  const id = 'P5'
  const label = 'P5 外层归档面：上一轮的编号报告是否真进了归档仓、归档面有没有未提交件'
  const R = inner && inner.round !== null ? inner.round : null
  if (R === null) return [id, 'UNVERIFIED', label, '内层轮次取不到 ⇒ 归档面无从对齐，不判通过（也不判红，这是"没量到"）']
  if (!outer || outerPath == null || !existsSync(outerPath)) {
    return [id, 'UNVERIFIED', label, `外层目录不在（${outerPath || '?'} 在代码仓之外，CI 只检出本仓）⇒ 未观测，不是已核对`]
  }
  if (typeof gitRunner !== 'function') {
    return [id, 'UNVERIFIED', label, 'git 取数通道没注入 ⇒ 两面（跟踪册 / 工作树）都读不到，禁止按"都干净"放过']
  }
  const tracked = gitRunner(['ls-files', '-z', '--', ...P5_PATHS])
  const dirty = gitRunner(['status', '--porcelain', '-z', '--', ...P5_PATHS])
  if (!tracked || tracked.rc !== 0 || !dirty || dirty.rc !== 0) {
    const why = [tracked ? `ls-files rc=${tracked.rc}` : 'ls-files 无返回', dirty ? `status rc=${dirty.rc}` : 'status 无返回'].join(' / ')
    return [id, 'UNVERIFIED', label, `外层 git 取数失败（${why}）⇒ 读不到不等于干净，本条按未观测处理`]
  }
  const trackedList = String(tracked.stdout || '').split('\0').filter(Boolean)
  const trackedByRound = new Map()
  const unnumbered = []
  for (const p of trackedList) {
    const r = reportRoundOf(p.split('/').pop())
    if (r === null) unnumbered.push(p)
    else trackedByRound.set(r, p)
  }
  // 磁盘上的编号报告（跟踪与否都算"存在"）
  let onDisk = []
  try {
    onDisk = readdirSync(deliverablesDir).filter((f) => f.endsWith('.md'))
  } catch (e) {
    return [id, 'UNVERIFIED', label, `取数面 ${deliverablesDir} 读不出目录（${String(e.message || e).split('\n')[0]}）⇒ 未观测`]
  }
  const diskRounds = new Set()
  for (const f of onDisk) { const r = reportRoundOf(f); if (r !== null) diskRounds.add(r) }
  const prev = R - 1
  const missingTracked = diskRounds.has(prev) && !trackedByRound.has(prev)
  const graceOk = diskRounds.has(R) || trackedByRound.has(R)
  const dirtyRows = parsePorcelainZ(dirty.stdout)
  // 宽限一轮：本轮（R）那份报告在循环的真实次序里**就是**在途件（报告 → 内层提交 → 外层提交），
  // 所以它 dirty 不拦；除它以外的归档面 dirty 一律拦。
  const curReportBase = onDisk.filter((f) => reportRoundOf(f) === R)
  const dirtyRelevant = dirtyRows.filter((d) => !curReportBase.some((b) => d.path === `deliverables/${b}` || d.path.endsWith(`/${b}`)))
  const counts = `R=${R}｜上一轮 ${prev} 已跟踪 ${trackedByRound.has(prev) ? '是' : '否'}｜本轮报告在场 ${graceOk ? '是' : '否'}（宽限一轮）`
  if (!graceOk) {
    return [id, 'FAIL', label, `本轮（第 ${R} 轮）的编号报告在磁盘与归档册上都找不到 ⇒ 产物没落笔，不是宽限问题。${counts}`]
  }
  if (missingTracked) {
    return [id, 'FAIL', label, `第 ${prev} 轮的编号报告在磁盘上存在，却不在外层 git 跟踪册里（` +
      `${onDisk.filter((f) => reportRoundOf(f) === prev).join(', ')}）⇒ 产物写了但没入库。` +
      `处置=在外层跑 \`git add -- deliverables/<该文件>\` 并随本轮一起提交；禁把 P5 改成"只查存在性"求绿`]
  }
  if (dirtyRelevant.length) {
    return [id, 'FAIL', label, `外层归档面有 ${dirtyRelevant.length} 件未提交（${dirtyRelevant.slice(0, 5).map((d) => `${d.xy} ${d.path}`).join(' ; ')}` +
      `${dirtyRelevant.length > 5 ? ' …' : ''}）⇒ 台账改了但没落历史，下一轮读的是文件不是提交。` +
      `处置=在外层跑 \`git add -- ${dirtyRelevant[0].path}\` 并提交`]
  }
  return [id, 'PASS', label, `${counts}｜归档面 dirty ${dirtyRows.length} 件（都与本面无关）｜无编号文件 ${unnumbered.length} 份不参与`]
}

export function main({ dir = root, json = false, outerDir = OUTER_MEMORY, changelogPath = null, deliverablesDir = DELIVERABLES, outerRepo = OUTER_REPO, gitRunner } = {}) {
  const innerDir = join(dir, 'memory')
  if (!existsSync(innerDir)) bail('memory-pointer-sync', `取不到 ${innerDir}`)
  const cl = changelogPath || join(dir, 'CHANGELOG.md')
  const inner = latestRound(innerDir)
  const outer = existsSync(outerDir) ? latestRound(outerDir) : null
  const clSet = changelogRounds(cl)
  const rows = evaluate({
    inner: inner && inner.round !== null ? inner : null,
    outer: outer && outer.round !== null ? outer : (outer === null ? null : outer),
    outerPath: outerDir,
    deliverablesDir,
    gitRunner: gitRunner === undefined ? makeGitRunner(outerRepo) : gitRunner,
    innerRounds: roundSetOf(innerDir),
    clRounds: clSet,
    changelogPath: cl,
  })
  const bad = rows.filter((r) => r.state === 'FAIL')
  const unver = rows.filter((r) => r.state === 'UNVERIFIED').map((r) => r.id)
  // `检查 N/N` 是恒真分母（第三十六轮自查）：P2 未观测时它仍印 2/2，等于把"没比"记成"比过"。
  // 口径与 memory-volume 的 matched/mismatched 一致：已核对数只计真比过的那几条。
  const checked = rows.length - unver.length
  if (json) {
    process.stdout.write(JSON.stringify({ rows, outerPresent: outer !== null, checked, declared: rows.length }, null, 2) + '\n')
  } else {
    for (const r of rows) console.log(`${r.state} ${r.id} :: ${r.label} —— ${r.detail}`)
    const p5 = rows.find((r) => r.id === 'P5')
    console.log(`${bad.length ? 'GATE-FAIL' : 'GATE-PASS'} memory-pointer-sync :: 四面 inner ${(inner && inner.round) || '?'}｜outer ${(outer && outer.round) || '不在'}｜changelog ${clSet === null ? '取不到' : clSet.length + ' 个轮号'}｜归档面 ${(p5 && p5.state) || '缺'}｜已核对 ${checked}/${rows.length}${unver.length ? `｜未验证 ${unver.join(',')}` : ''}`)
  }
  return bad.length ? 1 : 0
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) {
  // --outer 只为"让 CI 也能驱动外层通道"：外层目录在代码仓之外，CI 检出面里永远没有它，
  // 于是"外层存在时必须观测得到"这条性质在 CI 上不可证。给一个显式注入点，夹具就能拿合成外层跑它。
  const oi = process.argv.indexOf('--outer')
  const outerDir = oi >= 0 ? resolve(process.argv[oi + 1] || '') : OUTER_MEMORY
  const ci = process.argv.indexOf('--changelog')
  const changelogPath = ci >= 0 ? resolve(process.argv[ci + 1] || '') : null
  const ai = process.argv.indexOf('--archive')
  const deliverablesDir = ai >= 0 ? resolve(process.argv[ai + 1] || '') : DELIVERABLES
  const ri = process.argv.indexOf('--outer-repo')
  const outerRepo = ri >= 0 ? resolve(process.argv[ri + 1] || '') : OUTER_REPO
  // 夹具注了合成外层目录却没注归档仓 ⇒ 绝不允许 P5 悄悄去读**真**归档仓：
  // 那会让"P2 判夹具、P5 判本机"两套事实挤进同一行读数，红了也不知道是谁红的。
  const fixtureFace = oi >= 0 || ci >= 0 || ai >= 0
  const gitRunner = ri >= 0 ? makeGitRunner(outerRepo) : (fixtureFace ? null : makeGitRunner(OUTER_REPO))
  process.exit(main({ json: process.argv.includes('--json'), outerDir, changelogPath, deliverablesDir, outerRepo, gitRunner }))
}
