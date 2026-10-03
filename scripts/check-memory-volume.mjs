#!/usr/bin/env node
// 第三十一轮：记忆卷 4KB 上限的**仓库内**闸（对标 `pre-commit/pre-commit-hooks` 的 `check-added-large-files`）
//
// 动因是本轮自己造的麻烦：`handoff.py volume` 是外部工具且是**报告型**（dry-run 不拦），于是我刚写的
// `07-next-steps.part42.md` 超到 4,873B 也能顺利提交 —— 也就是说"4KB 上限"这件事在册但没人守。
// 借的正是它 README 里的三个设计点：① 阈值显式给（`--maxkb`，我们读 06-constraints.md 的「体量预算」行）；
// ② 默认只管**本次要提交的面**（staged），全量核要靠 `--enforce-all` 显式扩面；③ 命中就点名文件。
//
// 与外部工具的分工：`handoff.py volume` 继续做五层普查（产物/备份/缓存/增长率，那些超出本仓职责），
// 本判据只守"记忆卷单文件字节数"这一条**会随每次反哺增长**的量，因此它必须进提交链，不能靠自觉。
//
// 用法：node scripts/check-memory-volume.mjs            # 只判 git 暂存区里的记忆文件（pre-commit 用）
//       node scripts/check-memory-volume.mjs --all      # 判全量（CI 用）
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireInputs, bail } from './lib/preflight.mjs'
import { capped } from './lib/named-list.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MEM = join(root, 'memory')
requireInputs('memory-volume', [MEM])

/** 默认阈值与 handoff.py 的 `memory_md_max` 一致；登记册若写了「体量预算」行就以它为准。 */
function loadBudget() {
  const p = join(MEM, '06-constraints.md')
  const text = existsSync(p) ? readFileSync(p, 'utf8') : ''
  const m = /体量预算\*{0,2}[：:]\s*memory_md_max\s*=\s*(\d+)/.exec(text)
  return { max: m ? Number(m[1]) : 4096, source: m ? 'memory/06-constraints.md 体量预算行' : '代码默认 DEFAULT（与 handoff.py 同值）' }
}

/**
 * 作用面（**结构性枚举** + 明示被排除的类，禁"判零前先声明取数面"那条坑）：
 * `memory/*.md` 里，日报流水（`YYYY-MM-DD.md`）与 sync 生成的快照卷不按分卷口径判 ——
 * 前者是 append-only 流水（`handoff.py` 同一判定：非 4KB 拆卷目标），后者拆卷会打断 sync。
 * 被排除的是**类**（按文件名形态），不是"哪个文件超限"的名单，所以不会随重构过期。
 */
export function classify(name) {
  if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return { inScope: false, why: '日报流水（append-only，非 4KB 拆卷目标）' }
  if (['02-structure.md', '04-file-map.md'].includes(name)) return { inScope: false, why: 'sync 生成的仓库快照（拆卷会打断 sync）' }
  if (!name.endsWith('.md')) return { inScope: false, why: '非 markdown' }
  return { inScope: true, why: '' }
}

/** 暂存区里的记忆文件（`git diff --cached --name-only`）；拿不到 git 就 fail-closed，绝不回退成"全量"。 */
function stagedMemory(dir = root) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    bail('memory-volume', `git diff --cached 取不到暂存清单（${(r.stderr || '').split(/\r?\n/)[0] || `rc=${r.status}`}）⇒ 不猜作用面，也不静默扩成"全量"`)
  }
  return (r.stdout || '').split(/\r?\n/).filter((f) => f.startsWith('memory/') && f.endsWith('.md')).map((f) => f.split('/').pop())
}

/** 暂存区里**新增**的记忆文件（V4 用：规则只在"造卷"那一刻可执行，事后无从区分新卷与老卷）。 */
function stagedAdded(dir = root) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=A'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    bail('memory-volume', `git diff --cached --diff-filter=A 取不到新增清单（${(r.stderr || '').split(/\r?\n/)[0] || `rc=${r.status}`}）⇒ 不猜作用面`)
  }
  return new Set((r.stdout || '').split(/\r?\n/).filter((f) => f.startsWith('memory/') && f.endsWith('.md')).map((f) => f.split('/').pop()))
}

/** 新卷出生余量下限：25%（= 3,072B）。取 25% 的实测依据见登记册「体量预算」节与第三十五轮报告。 */
export const NEW_VOLUME_MIN_HEADROOM = 0.25

/** 入口卷的名字 —— 每轮真正往下写的只有它，所以"贴死"只判它。 */
export const MAIN_VOLUME = '07-next-steps.md'

/**
 * 入口卷还能往下写一条的字节下限：**由本仓自己的历史步长量出来**，不是拍的。
 * 实测 @2026-09-28（`git log -20 -- memory/07-next-steps.md` + 对每次提交取 `wc -c` 差）：
 * 最近 12 次改动里的**正增量**为 80 / 254 / 255 / 290 / 343 / 612 B（中位数 ≈ 255），
 * 负增量是"迁卷"（把内容挪去分卷）不是"写得下"。⇒ 取 256B ≈ 中位数：
 * 余量低于它，下一轮**连一条指针行都塞不进**，只能靠压措辞 —— 那正是上一轮发生的事故。
 */
export const V3_MIN_HEADROOM = 256

/** 主卷那行「在册卷号：1–58」的声明区间；解析不到 ⇒ null（V5 据此记未验证，不记通过）。 */
export function readDeclaredRange(memDir) {
  const p = join(memDir, '07-next-steps.md')
  if (!existsSync(p)) return null
  const m = /在册卷号[：:]\s*(\d+)\s*[–\-~〜]\s*(\d+)/.exec(readFileSync(p, 'utf8'))
  return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null
}

/** 磁盘上的 07 分卷卷号（结构性枚举：卷号只由文件名决定，与暂存面无关）。 */
export function partNumbersOf(names) {
  return [...new Set(names.map((n) => /^07-next-steps\.part(\d+)\.md$/.exec(n)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b)
}

export function evaluate({ files, max, all = true, added = null, partNumbers, declaredRange, remeasure = null }) {
  const rows = []
  const overs0 = files.filter((f) => f.size > max)
  // V6（第四十六轮，R45-H3 的落地）：**共享工作树里读到的字节数可能是别人写到一半的形态**。
  // 一手两例：第四十四轮 `verify:volume` 判 `part72 4333B > 3072B`，20 秒后同路径实测 2637B 且 `git diff HEAD` 为空；
  // 第四十五轮同一秒 `git status` 报的 `part74 4333B` 与 `git cat-file -s` 的 3020B 对不上。
  // 所以超限这件事必须**二次确认**：只读两遍（默认 150ms 后重 stat）——
  // 两次一致 ⇒ 照常判违规；不一致 ⇒ 记 UNVERIFIED（既不是"违规"也不是"通过"，是"这一次没量到"）。
  // 成本为零：二次 stat 只在"已经要判红"的路径上发生，正常轮一次都不多读。
  const torn = []
  const overs = overs0.filter((f) => {
    if (!remeasure) return true
    const again = remeasure(f.name)
    if (again === f.size) return true
    torn.push({ name: f.name, first: f.size, second: again })
    return false
  })
  // 两种"零对象"必须长得不一样（同第三十轮 scan-secrets 的口径）：
  // 全量面为零 = 取数面坏了 ⇒ fail-closed；暂存面为零 = 这次提交没动记忆 = **跳过**，不是"通过"。
  // 否则任何一条纯代码提交都会被这道闸拦下 —— 那是"拒真话"的判据缺陷，会逼人绕闸。
  rows.push({
    id: 'V1',
    pass: all ? files.length > 0 : true,
    detail: files.length > 0
      ? `作用面 ${files.length} 个记忆文件（阈值来源见首行）`
      : (all ? '全量作用面为 0 ⇒ 取数面本身坏了（memory/ 里一个 .md 都不判？）' : '暂存面没有记忆文件 ⇒ 无可判对象（这是"跳过"，不是"通过"）'),
  })
  rows.push({
    id: 'V2', pass: overs.length === 0,
    status: (!overs.length && torn.length) ? 'UNVERIFIED' : undefined,
    detail: overs.length
      ? `超限 ${overs.length} 个（阈值 ${max}B）：${overs.map((f) => `${f.name} ${f.size}B(+${f.size - max})`).join(' , ')}`
        + (torn.length ? `；另有 ${torn.length} 个二次读数不一致 ⇒ 记未验证（见 V2b）` : '')
      : (torn.length
        ? `${files.length} 个全部 ≤ ${max}B —— 但 ${torn.length} 个超限件二次读数不一致，本 run 对这些卷记 UNVERIFIED 而非"通过"`
        : `${files.length} 个全部 ≤ ${max}B`),
  })
  rows.push({
    id: 'V2b', pass: true, status: torn.length ? 'UNVERIFIED' : 'OK',
    detail: torn.length
      ? `撕裂读 ${torn.length} 个（第一次 vs 第二次）：${torn.map((t) => `${t.name} ${t.first}B→${t.second}B`).join(' , ')} ⇒ 共享工作树里可能读到别人写到一半的文件；不判违规也不判通过，复跑或按 git 面重测`
      : '二次确认未触发异常（超限件两次读数一致；无超限件时一次都不重读）',
  })
  const biggest = files.reduce((a, b) => (b.size > (a?.size || 0) ? b : a), null)
  // V3（第五十轮改判三态）：旧写法是 `pass: files.length === 0 || !!biggest` ——
  // **只要目录里有卷就恒真**，"余 0B"与"余 900B"在账面上长得一模一样。上一轮主卷被压到 4,096B 整
  // （台账里管这叫"压措辞续命"）就是这条恒真放行的：读数印了，但没人（也没有闸）据它判红。
  // 形状取自 `ai/size-limit`：`packages/size-limit/calc.js:51-56` 只在**显式设了预算**时才给
  // `check.passed` 赋值，`config.failed = checks.some(i => i.passed === false)` 用 `=== false` 而不是真值；
  // `create-reporter.js:115` 再给"没预算"单独一个 `unlimited` 态。⇒ 三态：够写 / 贴死 / 没量到，
  // 缺任一态都会退化成"看起来在自检"。
  // 判的对象只钉**入口卷**（`07-next-steps.md`）：它是每轮真要往下写的东西。历史分卷是终态件，
  // 拿"贴死"连坐整库 = 逼后来人删事实换绿（assertion scope = blast radius）。
  const mainFile = files.find((f) => f.name === MAIN_VOLUME)
  if (!mainFile) {
    rows.push({
      id: 'V3', pass: true, status: 'UNVERIFIED',
      detail: files.length === 0
        ? '无对象（作用面为空 ⇒ 入口卷的余量没量到，不是"余量够"）'
        : `作用面 ${files.length} 卷里没有入口卷 ${MAIN_VOLUME} ⇒ 本条未验证（历史卷的余量不判，见上）`,
    })
  } else {
    const headroom = max - mainFile.size
    const dead = headroom < V3_MIN_HEADROOM
    rows.push({
      id: 'V3', pass: !dead,
      detail: `入口卷 ${mainFile.name} ${mainFile.size}B ⇒ 余 ${headroom}B（阈值 ${max}B，可写下限 ${V3_MIN_HEADROOM}B）`
        + `${biggest && biggest.name !== MAIN_VOLUME ? `；全作用面最大是 ${biggest.name} ${biggest.size}B（终态卷，不判）` : ''}`
        + (dead
          ? ` ⇒ **贴死**：下一轮一条指针行都塞不进去。正解＝把整段轮次摘要迁去新卷号（V4 管出生余量，本条管存量），`
            + '**禁止**用压措辞/删事实换绿 —— 上一轮压到 4,096B 整就是这条恒真放行的'
          : (headroom < max * 0.15 ? '（贴线：还能写一条，但本轮收尾前先腾地方）' : '')),
    })
  }

  // V4（第三十五轮）：**新建**的记忆卷必须带着余量出生。
  // 立它的实测：第三十三轮写了「新卷到 3.5KB 就开新卷号」这条规则，第三十四轮我自己就把卷 50
  // 造到 4,006B 出生（余 90B）—— 规则在案的下一轮被破，说明它是措辞不是闸。
  // 追溯普查（`git log --diff-filter=A` + `git show <首提>:<路径> | wc -c`）：现 7 本贴线卷里
  // **5 本出生即贴线**（part20 3638 / part21 3836 / part22 3985 / part45 4081 / part46 4055），
  // 其中 part46 的首提就是"立规则那一次"提交 8c3e6bf。⇒ 只拦新增件、历史卷不追溯（否则全仓连坐）。
  if (added === null) {
    rows.push({
      id: 'V4', pass: true, status: 'UNVERIFIED',
      detail: `--all（CI）模式没有"本次新增"概念 ⇒ 本条不判（这是未验证，不是通过）；提交前跑不带 --all 即生效`,
    })
  } else {
    const fresh = files.filter((f) => added.has(f.name))
    const born = fresh.filter((f) => f.size > max * (1 - NEW_VOLUME_MIN_HEADROOM))
    rows.push({
      id: 'V4', pass: born.length === 0,
      detail: fresh.length === 0
        ? `本次无新增记忆卷（暂存面 ${files.length} 件）⇒ 无可判对象`
        : (born.length
          ? `出生即贴线 ${born.length}/${fresh.length} 本（新卷须 ≤${Math.floor(max * (1 - NEW_VOLUME_MIN_HEADROOM))}B，留足 ${(NEW_VOLUME_MIN_HEADROOM * 100).toFixed(0)}% 余量）：${born.map((f) => `${f.name} ${f.size}B(余 ${max - f.size}B)`).join(' , ')} ⇒ 现在就拆成两卷，别等提交前压字节`
          : `新增 ${fresh.length} 本，最大的 ${Math.max(...fresh.map((f) => f.size))}B ≤ ${Math.floor(max * (1 - NEW_VOLUME_MIN_HEADROOM))}B（余量下限 ${(NEW_VOLUME_MIN_HEADROOM * 100).toFixed(0)}%）`),
    })
  }
  // V5（第三十六轮收尾）：主卷那行「在册卷号：A–B」是**手工措辞**，本轮实测它已经落后磁盘一格
  // —— 建卷 57 时没并号（声明 1–56、磁盘 1..57），与本轮主题同一族：约定没有判据就会无声失效。
  // opt-in：只有调用方交出取数面时才出这一行（单元测试直接喂 files 的旧用例不该凭空多一行）。
  if (Array.isArray(partNumbers) || declaredRange) {
    const nums = [...new Set(partNumbers || [])].sort((a, b) => a - b)
    if (!declaredRange) {
      rows.push({ id: 'V5', pass: true, status: 'UNVERIFIED',
        detail: `主卷取不到「在册卷号：A–B」声明（磁盘扫到 ${nums.length} 本分卷）⇒ 无声明可对，这是未验证不是通过` })
    } else if (!nums.length) {
      rows.push({ id: 'V5', pass: false,
        detail: `声明 ${declaredRange.lo}–${declaredRange.hi}，但磁盘上一本 07 分卷都没扫到 ⇒ 取数面坏了，不是"没得对"` })
    } else {
      const have = new Set(nums)
      const missing = []
      for (let n = declaredRange.lo; n <= declaredRange.hi; n++) if (!have.has(n)) missing.push(n)
      const extra = nums.filter((n) => n < declaredRange.lo || n > declaredRange.hi)
      rows.push({ id: 'V5', pass: !missing.length && !extra.length,
        detail: missing.length || extra.length
          ? `声明 ${declaredRange.lo}–${declaredRange.hi} ⇄ 磁盘 ${nums.length} 本对不上：` +
            [missing.length ? `声明有、磁盘无（跳号或被删）= ${capped(missing, 6)}` : '',
              extra.length ? `磁盘有、声明未并号 = ${capped(extra, 6)} ⇒ 把主卷那行上界改成 ${Math.max(...nums)}` : '']
              .filter(Boolean).join(' ｜ ')
          : `声明 ${declaredRange.lo}–${declaredRange.hi} ⇄ 磁盘 ${nums.length} 本双向对得上（无跳号、无未并号）` })
    }
  }
  return {
    rows,
    summary: {
      matched: rows.filter((r) => r.pass && r.status !== 'UNVERIFIED').length,
      mismatched: rows.filter((r) => !r.pass).length,
      declared: rows.length,
      over: overs.length, n: files.length,
    },
  }
}

/**
 * 外层工作区记忆面（M-60-4 · 第六十四轮）。
 * 一手实测：`超市/memory/07-next-steps.md` **44,794 B**，越过它自己文件头声明的
 * `shell_max=40,960 B` 计 **3,834 B**；而本判据此前只扫 `memory/`（root 由脚本自身位置推导
 * = `supermarket-web`）⇒ 同一条治理规矩在内层是闸、在外层是自觉。**尺子量不到的那一半才会烂** ——
 * 外层正是 09-27 那次「5 轮静默断更」的宿主。
 *
 * 为什么是「把两侧分母都印进结论通道 + 不拦」，而不是加一条 V6 判红：
 * 44 KB 该怎么拆（按轮次 vs 按主题）第六十轮明确写了「口径先定再动」，本轮没有定；
 * 判红等于逼下一轮**猜一个拆法**，而猜错的拆比重演一次断更更贵。所以外层走 `report:*` 那一档
 * （同 `docs/item-budgets.json` 第一版不进阻断链）：读数进 stdout 结论通道、越限另打一条 stderr WARN。
 * 内层那把尺（V1~V5）一字未动，两侧各报各的分母，不互相顶替。
 */
export const OUTER_MEM_DEFAULT = join(root, '..', '超市', 'memory')
export const SHELL_MAX_DEFAULT = 40_960

/** 外层文件头自己写着 `shell_max=40,960B` ⇒ 优先读它，读不到才用代码默认（与 loadBudget 同一口径）。 */
export function readShellMax(memDir) {
  if (!memDir) return null
  const p = join(memDir, MAIN_VOLUME)
  if (!existsSync(p)) return null
  const m = /shell_max\s*=\s*([\d][\d,_\s]*)\s*B/i.exec(readFileSync(p, 'utf8'))
  if (!m) return null
  const n = Number(m[1].replace(/[,_\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? { max: n, source: `${MAIN_VOLUME} 文件头 shell_max 声明` } : null
}

/**
 * 三态：`over` / `ok` / `unavailable`。
 * **unavailable 不得折成 ok**（户内：量不到不得折算成达标）。CI 的检出面里永远没有外层目录，
 * 所以这一态在 CI 上是常态而不是故障。
 */
export function outerFaceReport({ memDir, size, shellMax, source }) {
  const label = String(memDir || '(未给)').replace(/\\/g, '/')
  if (size === null || size === undefined) {
    return { state: 'unavailable', over: null, shellMax: null,
      text: `外层面=${label}/${MAIN_VOLUME} 取不到 ⇒ unavailable（本仓检出面外，CI 恒为此态），不折算成"外层很干净"` }
  }
  const over = size - shellMax
  return {
    state: over > 0 ? 'over' : 'ok', over, shellMax, size,
    text: `外层面=${label}/${MAIN_VOLUME} ${size}B / shell_max ${shellMax}B（来源：${source}）`
      + ` ⇒ ${over > 0 ? `越限 ${over}B` : `余 ${-over}B`}`,
  }
}

export function main({ dir = root, all = false, outerMemDir = OUTER_MEM_DEFAULT } = {}) {
  const { max, source } = loadBudget()
  const memDir = join(dir, 'memory')
  if (!existsSync(memDir)) bail('memory-volume', `取不到 ${memDir}`)
  const allNames = readdirSync(memDir).filter((f) => statSync(join(memDir, f)).isFile())
  const wanted = all ? new Set(allNames) : new Set(stagedMemory(dir).filter((n) => allNames.includes(n)))
  const scope = []
  const excluded = []
  for (const name of allNames) {
    if (!wanted.has(name)) continue
    const c = classify(name)
    if (!c.inScope) { excluded.push(`${name}（${c.why}）`); continue }
    scope.push({ name, size: statSync(join(memDir, name)).size })
  }
  const res = evaluate({
    files: scope, max, all, added: all ? null : stagedAdded(dir),
    partNumbers: partNumbersOf(allNames), declaredRange: readDeclaredRange(memDir),
    // 只有"已经要判红"的卷才付这次重读的成本（150ms 自旋后二次 stat）；一致 ⇒ 照常 FAIL。
    remeasure: (name) => {
      const t0 = Date.now()
      while (Date.now() - t0 < 150) { /* 让并发写入方有机会把这半行写完 */ }
      const p = join(memDir, name)
      return existsSync(p) ? statSync(p).size : -1
    },
  })
  // 贴线告警（第三十三轮）：余量 < 15% 只报不拦。为什么不拦：把 3,900B 判红会逼人"为了绿而拆卷"
  // 或删事实；但完全不报，就会连续三轮出现"写卷时踩线、提交前手忙脚乱压字节"（本轮实测三本卷
  // 余量分别只有 15B / 41B / 95B）。⇒ 告警走 **stderr**（stdout 是结论通道，不能被污染），
  // 并且下一轮反哺前就该照它腾地方。
  const tight = scope.filter((f) => f.size > max * 0.85).sort((a, b) => b.size - a.size)
  // 只列最紧的 3 本 + 总数：第三十三轮首次跑出的真实画面是"9 本贴线、4 本余量 <100B"，
  // 那说明整库是被压到天花板用的 ⇒ 结论不是"下次写短点"，而是**新卷过 3.5KB 就开新卷号**（见登记册）。
  if (tight.length) {
    const top = tight.slice(0, 3).map((f) => `${f.name} ${f.size}B(余 ${max - f.size}B)`).join(' , ')
    console.error(`[memory-volume] WARN 贴线卷 ${tight.length} 本（余量 < ${Math.round(max * 0.15)}B）：${top}${tight.length > 3 ? ' …' : ''} ⇒ 新卷写满 3.5KB 就开下一个卷号，别压措辞`)
  }
  // "每个卷都是 0 字节"不是"都在预算内"，而是**没有对象可判**（第二十六轮零分母那一族）。
  // 本仓 53 个记忆卷同时为 0B 只能是坏检出/镜像骨架 ⇒ 在这里 fail-closed，好过印一句 GATE-PASS。
  if (scope.length && scope.every((f) => f.size === 0)) {
    bail('memory-volume', `${scope.length} 个记忆文件全部 0 字节 ⇒ 没有内容可判预算（这不是"都在阈值内"）`)
  }
  console.log(`[memory-volume] 阈值 ${max}B｜来源：${source}｜模式 ${all ? '--all 全量' : '仅暂存面'}`)
  if (excluded.length) console.log(`[memory-volume] 命中但按类排除（不判）：${excluded.join(' , ')}`)
  const sm = readShellMax(outerMemDir)
  const outerMainPath = join(outerMemDir || '', MAIN_VOLUME)
  const outerSize = outerMemDir && existsSync(outerMainPath) ? statSync(outerMainPath).size : null
  const outer = outerFaceReport({
    memDir: outerMemDir, size: outerSize,
    shellMax: sm ? sm.max : SHELL_MAX_DEFAULT,
    source: sm ? sm.source : '代码默认 SHELL_MAX_DEFAULT（与 handoff.py DEFAULT_BUDGET.shell_max 同值）',
  })
  console.log(`[memory-volume] ${outer.text}`)
  if (outer.state === 'over') {
    console.error(`[memory-volume] 外层面越 shell_max ${outer.over}B ⇒ 由 V7 判红（第六十五轮 M-64-3 起入分母）。`
      + `口径已定：外层主壳按**轮次整段迁卷**（一节不拆、逐字迁，同内层「主卷只留当轮与上一轮」的纪律）。`
      + `复算：wc -c < "${outerMainPath.replace(/\\/g, '/')}"`)
  }
  // V7（第六十五轮 M-64-3）：外层腿从"只报不拦"升档为入分母。
  // 升档的三个硬前提本轮才同时成立，缺任何一个都不该升（户内：默认档必须等于现状那档）：
  //   ① 口径定死并写进本轮报告与本行注释（按轮次 vs 按主题 的悬案在 60 轮挂着、64 轮挂着、本轮结掉）；
  //   ② 有实测余量：外层主壳 45,980B → 17,687B（限 40,960，余 23,273B ≈ 每轮 +875B 可写 26 轮）；
  //   ③ 三态不折叠：外层目录在 CI 检出面之外 ⇒ 取不到就是 UNVERIFIED，既不算过也不算红。
  // 上一版这段的理由（"判红等于逼下一轮猜一个拆法"）依然成立 —— 所以它是在**拆完之后**才升的档。
  res.rows.push(outer.state === 'unavailable'
    ? { id: 'V7', pass: true, status: 'UNVERIFIED', detail: 'V7 外层主壳体量 —— 外层目录不在本仓检出面（CI 恒此态）⇒ 未验证，不是通过' }
    : { id: 'V7', pass: outer.state === 'ok', status: outer.state === 'ok' ? 'PASS' : 'FAIL',
      detail: `V7 外层主壳体量（口径=按轮次整段迁卷） —— ${outer.text}` })
  res.summary.declared += 1
  if (outer.state !== 'unavailable') {
    if (outer.state === 'ok') res.summary.matched += 1
    else res.summary.mismatched += 1
  }
  // 未验证态不得印成 PASS：V4 在 --all 模式下"不判"，若复用 PASS 就会被读成"新卷余量已核过"。
  const unver = res.rows.filter((r) => r.status === 'UNVERIFIED').map((r) => r.id)
  for (const r of res.rows) console.log(`${r.status === 'UNVERIFIED' ? 'UNVERIFIED' : (r.pass ? 'PASS' : 'FAIL')} ${r.id} :: ${r.detail}`)
  console.log(`${res.summary.mismatched === 0 ? 'GATE-PASS' : 'GATE-FAIL'} memory-volume :: 判 ${res.summary.n} 卷｜超限 ${res.summary.over}｜检查 ${res.summary.matched}/${res.summary.declared}${unver.length ? `｜未验证 ${unver.join(',')}` : ''}｜外层面=${outer.state}（${outer.state === 'over' ? `越 ${outer.over}B` : outer.state === 'ok' ? `余 ${-outer.over}B` : '取不到'}）｜两侧分母各报各的`)
  return res.summary.mismatched === 0 ? 0 : 1
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
const outerArg = (process.argv.find((a) => a.startsWith('--outer-memory=')) || '').split('=').slice(1).join('=')
if (isCli) process.exit(main({
  dir: root,
  all: process.argv.includes('--all'),
  ...(outerArg ? { outerMemDir: resolve(outerArg) } : {}),
}))
