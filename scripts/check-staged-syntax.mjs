#!/usr/bin/env node
/**
 * check-staged-syntax —— 提交边界上的语法闸（第四十八轮 R48-H4，机器型落点）。
 *
 * 为什么必须有它（一手，不是假想）：连续两轮我用 Edit 做"在某处插入"时，`old_string` 取的是
 * **被保留内容的头几行**（注释块 / 下一条目的标题行），于是那几行被替换掉、留下悬空片段：
 * 第四十七轮 1 次（吞掉 G11 文档注释，`node --check` 抓到）、本轮又 3 次（吞注释头两行、
 * 吞 CHANGELOG 一条目的首行、吞报告 `## 8` 标题）。四次的共同点不是"手滑"，而是
 * **这类损伤要等到 4 分钟的全链 verify 或 CI 才现形**，而它本可以在 `git commit` 那一刻被拦住。
 *
 * 三条设计约束（都是户内既有口径）：
 * 1. **判的是暂存区 blob，不是工作树文件** —— `git cat-file blob :<path>`：工作树此刻可能已被
 *    并行会话改成另一份内容（`in-flight 是内容不是状态`），拿工作树当判据会把别人的在途编辑算到我头上。
 * 2. **盲区单独声明，不与"通过"同形** —— TS/TSX/JSX 本闸不判（`node --check` 不认类型语法），
 *    由 `npm run lint`（oxlint）与 `npm run typecheck` 覆盖；这一句必须印出来，
 *    否则下一轮会把"staged-syntax 绿"读成"所有件都验过"。
 * 3. **取不到数 = UNVERIFIED/rc=2，没对象 = 跳过** —— 非 git 目录 / git 不可用一律 rc=2 并印人话，
 *    不许退化成"0 个文件 ⇒ 全绿"（第二十六轮零分母那一族）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JS_EXTS = new Set(['.js', '.cjs', '.mjs'])
const BLIND_EXTS = new Set(['.ts', '.tsx', '.jsx'])
const PY_EXTS = new Set(['.py'])

/** 暂存面：NUL 分隔取路径（文件名可含空格/中文；按行取会截断 —— 实测过的坑）。 */
export function stagedFiles(cwd = process.cwd()) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return { err: `git rc=${r.status} ${(r.stderr || r.stdout || '').trim().split('\n')[0]}` }
  return { list: String(r.stdout || '').split('\0').filter(Boolean) }
}

/** 取暂存区里的**那一份字节**（不是工作树的）。 */
function indexBlob(path, cwd) {
  const r = spawnSync('git', ['cat-file', 'blob', `:${path}`], { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

const firstLine = (s) => String(s || '').trim().split(/\r?\n/).find((l) => l.trim()) || '(无输出)'

export function check({ cwd = process.cwd(), scratch = mkdtempSync(join(tmpdir(), 'staged-syntax-')) } = {}) {
  const face = stagedFiles(cwd)
  if (face.err) return { verdict: 'UNVERIFIED', rc: 2, rows: [], reason: face.err }
  const rows = []
  let blind = 0
  let pySkipped = 0
  for (const p of face.list) {
    const ext = extname(p)
    if (BLIND_EXTS.has(ext)) { blind++; continue }
    if (!JS_EXTS.has(ext) && !PY_EXTS.has(ext)) continue
    const bytes = indexBlob(p, cwd)
    if (bytes === null) {
      rows.push({ path: p, ok: false, why: '暂存区里取不到这个 blob（路径被改过？重跑 `git diff --cached --name-only` 核对）' })
      continue
    }
    const tmp = join(scratch, `${basename(p).replace(/[^A-Za-z0-9._-]/g, '_')}-${rows.length}${ext}`)
    writeFileSync(tmp, bytes)
    let runner
    if (PY_EXTS.has(ext)) {
      runner = spawnSync('python', ['-m', 'py_compile', tmp], { encoding: 'utf8', timeout: 60_000 })
      if (runner.error || runner.status === null) { pySkipped++; continue }
    } else {
      runner = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8', timeout: 60_000 })
    }
    if (runner.status !== 0) {
      const err = `${runner.stderr || ''}${runner.stdout || ''}`
      rows.push({
        path: p,
        ok: false,
        why: `${ext === '.py' ? 'py_compile' : 'node --check'} rc=${runner.status} :: ${firstLine(err)}`,
      })
    }
  }
  rmSync(scratch, { recursive: true, force: true })
  const bad = rows.filter((r) => !r.ok)
  return {
    verdict: bad.length ? 'RED' : 'GREEN',
    rc: bad.length ? 1 : 0,
    rows: bad,
    counts: { staged: face.list.length, checked: face.list.length - blind - pySkipped, blind, pySkipped },
  }
}

export function main() {
  if (!spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stdout.includes('true')) {
    console.log(`[staged-syntax] 环境不满足：当前目录不在 git 工作树内 ⇒ 没有暂存面可判（这是未验证，不是"没有坏文件"）`)
    return 2
  }
  const res = check()
  if (res.verdict === 'UNVERIFIED') {
    console.log(`[staged-syntax] 环境不满足：取暂存面失败（${res.reason}）⇒ 判未验证，不放行也不谎称通过`)
    return 2
  }
  const c = res.counts
  if (!c.staged) { console.log('[staged-syntax] 跳过：暂存面 0 个文件 ⇒ 没有对象可判（这是"跳过"，不是"通过"）'); return 0 }
  for (const r of res.rows) console.log(`FAIL ${r.path} :: ${r.why}`)
  console.log(`${res.verdict === 'GREEN' ? 'GATE-PASS' : 'GATE-FAIL'} staged-syntax :: 暂存 ${c.staged} 个文件｜本闸判 ${c.checked} 个｜盲区 ${c.blind} 个（.ts/.tsx/.jsx 由 oxlint + typecheck 判，**本闸没判过**）${c.pySkipped ? `｜python 不可用跳过 ${c.pySkipped} 个 .py` : ''}`)
  return res.rc
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(main())
