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

export function evaluate({ files, max, all = true }) {
  const rows = []
  const overs = files.filter((f) => f.size > max)
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
  rows.push({ id: 'V2', pass: overs.length === 0, detail: overs.length
    ? `超限 ${overs.length} 个（阈值 ${max}B）：${overs.map((f) => `${f.name} ${f.size}B(+${f.size - max})`).join(' , ')}`
    : `${files.length} 个全部 ≤ ${max}B` })
  const biggest = files.reduce((a, b) => (b.size > (a?.size || 0) ? b : a), null)
  rows.push({ id: 'V3', pass: files.length === 0 || !!biggest, detail: biggest ? `最大卷 ${biggest.name} ${biggest.size}B（阈值余量 ${max - biggest.size}B）` : '无对象' })
  return { rows, summary: { matched: rows.filter((r) => r.pass).length, mismatched: rows.filter((r) => !r.pass).length, declared: rows.length, over: overs.length, n: files.length } }
}

export function main({ dir = root, all = false } = {}) {
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
  const res = evaluate({ files: scope, max, all })
  // "每个卷都是 0 字节"不是"都在预算内"，而是**没有对象可判**（第二十六轮零分母那一族）。
  // 本仓 53 个记忆卷同时为 0B 只能是坏检出/镜像骨架 ⇒ 在这里 fail-closed，好过印一句 GATE-PASS。
  if (scope.length && scope.every((f) => f.size === 0)) {
    bail('memory-volume', `${scope.length} 个记忆文件全部 0 字节 ⇒ 没有内容可判预算（这不是"都在阈值内"）`)
  }
  console.log(`[memory-volume] 阈值 ${max}B｜来源：${source}｜模式 ${all ? '--all 全量' : '仅暂存面'}`)
  if (excluded.length) console.log(`[memory-volume] 命中但按类排除（不判）：${excluded.join(' , ')}`)
  for (const r of res.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} :: ${r.detail}`)
  console.log(`${res.summary.mismatched === 0 ? 'GATE-PASS' : 'GATE-FAIL'} memory-volume :: 判 ${res.summary.n} 卷｜超限 ${res.summary.over}｜检查 ${res.summary.matched}/${res.summary.declared}`)
  return res.summary.mismatched === 0 ? 0 : 1
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(main({ dir: root, all: process.argv.includes('--all') }))
