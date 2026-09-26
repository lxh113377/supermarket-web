#!/usr/bin/env node
/**
 * 文件名大小写冲突自查（第八轮 M2，收第七轮 K7）
 *
 * 起因是第七轮我自己撞的实事故：新建 `tests/productsTab.test.tsx` 与已跟踪的
 * `tests/ProductsTab.test.tsx` 在 Windows 大小写不敏感文件系统上是**同一个 inode**，
 * `Write` 静默覆盖了 4 条在制用例，而 `git status` 只显示一个 `M`——
 * 没有新增文件、没有删除、没有冲突提示。Linux CI 上它俩会是两个文件，
 * 于是本地全绿、CI 收集到两套用例。**这类事故目前没有任何东西守着。**
 *
 * 判据两条：
 * A 索引内互撞：git 跟踪的路径里存在两条只在大小写上不同的路径
 * B 工作区撞索引：未跟踪文件（含新写的测试）大小写不敏感地撞上某个已跟踪路径，
 *   且大小写并不完全相同 —— 这就是"我新建的其实是别人的文件"
 *
 * 退出码：0=通过 / 1=有冲突 / 2=环境不满足（git 不可用或仓库根异常，不静默记 PASS）
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`)
  return (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
}

let tracked
let untracked
try {
  const top = git(['rev-parse', '--show-toplevel'])[0]
  if (!top) throw new Error('仓库根为空')
  // -z 才能安全承载含空格/中文的路径；逐行切分会把一个路径拆成多条
  const splitZ = (out) => out.split('\0').map((s) => s.replace(/\\/g, '/')).filter(Boolean)
  const t = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  const u = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' })
  if (t.status !== 0 || u.status !== 0) throw new Error(`git ls-files 失败：${t.stderr || u.stderr}`)
  tracked = splitZ(t.stdout || '')
  untracked = splitZ(u.stdout || '')
} catch (e) {
  console.error(`[case-collision] 环境不满足：${e.message}`)
  process.exit(2)
}

const byLower = new Map()
for (const p of tracked) {
  const k = p.toLowerCase()
  if (!byLower.has(k)) byLower.set(k, [])
  byLower.get(k).push(p)
}

const problems = []

// A：索引内互撞
for (const [k, list] of byLower) {
  if (list.length > 1) problems.push(`索引内大小写互撞（Linux 上会是两个文件，Windows/macOS 上只有一个）：${list.join(' ⇄ ')} [${k}]`)
}

// B：未跟踪文件撞已跟踪路径且大小写不同
for (const p of untracked) {
  const hits = byLower.get(p.toLowerCase()) || []
  for (const t of hits) {
    if (t !== p) {
      problems.push(`新建文件与已跟踪路径仅大小写不同 → 在 Windows/macOS 上会**静默覆盖**对方：新 "${p}" ⇄ 已跟踪 "${t}"`)
    }
  }
}

if (problems.length) {
  console.error(`[case-collision] FAIL ${problems.length} 项：`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  修法：把两者改成不同名（保留在制的那份内容），或先 git rm 旧名再建新名；禁止直接改文件内容覆盖。')
  process.exit(1)
}
console.log(`[case-collision] OK 无大小写冲突（已跟踪 ${tracked.length}，未跟踪 ${untracked.length}，含 ${sep} 路径已归一）`)
