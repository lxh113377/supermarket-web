// 第四十八轮 R48-H4：提交边界上的语法闸（`scripts/check-staged-syntax.mjs`）的常驻夹具。
//
// 立它的缘由是**同一形态连续四轮犯**：用 Edit 做"在某处插入"时把 `old_string` 取成被保留内容的头几行，
// 于是那几行消失、留下悬空片段（吞掉注释块、吞掉 CHANGELOG 条目首行、吞掉报告 `## 8` 标题）。
// 每一次都是靠 `node --check` 或"写完回读"抓的 —— 也就是说，**拦住它的时机比它发生的时机晚了好几分钟到一整条 CI**。
// 本闸把时机挪到 `git commit` 那一刻，并且判的是**暂存区 blob**（不是工作树），
// 因为在并行会话共用的工作树里，工作树内容可能已经不是本次要提交的那一份了。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCliRan } from './helpers/cliLeg.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'check-staged-syntax.mjs')
const dirs = []

/** 造一个**真的 git 工作树**：本闸的输入面就是暂存区，没有 .git 就没有输入面可判。 */
function gitRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'stagedsyn-'))
  dirs.push(dir)
  const git = (args) => assertCliRan(spawnSync('git', args, { cwd: dir, encoding: 'utf8' }), { label: `staged-syntax git ${args[0]}` })
  expect(git(['init', '-q', '.']).status, '夹具建不起来（git 不可用）').toBe(0)
  git(['config', 'user.email', 'fixture@example.invalid'])
  git(['config', 'user.name', 'fixture'])
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body, 'utf8')
    expect(git(['add', '--', name]).status, `git add ${name} 失败`).toBe(0)
  }
  return dir
}

// 用**绝对路径**起脚本：合成仓里没有 scripts/ 副本（除了变异那条腿自己拷），
// 拿相对路径 spawn 会得到"文件不存在 rc=1"，然后被读成"判据判红了"。
const run = (cwd) => assertCliRan(spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', timeout: 90_000 }), { label: 'staged-syntax 判据子进程' })

describe('check-staged-syntax：暂存区语法闸', () => {
  it('正向：暂存面全是合法 JS ⇒ rc=0，且门面行印出"判了几个/盲区几个"', () => {
    const dir = gitRepo({ 'a.mjs': 'export const a = 1\n', 'b.js': 'const b = 2\n' })
    const r = run(dir)
    expect(r.stdout + r.stderr, r.stdout).toContain('GATE-PASS staged-syntax')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/暂存 2 个文件｜本闸判 2 个｜盲区 0 个/)
  })

  it('反例（本轮真正要拦的那件事）：暂存一个括号失配的件 ⇒ rc=1 且点名是哪个文件', () => {
    const dir = gitRepo({ 'ok.mjs': 'export const ok = 1\n', 'hurt.mjs': 'const a = 1\n))(\n' })
    const r = run(dir)
    expect(r.status, `坏件必须拦下来：${r.stdout}`).toBe(1)
    expect(r.stdout).toContain('FAIL hurt.mjs')
    expect(r.stdout).toContain('GATE-FAIL')
    expect(r.stdout).toContain('node --check rc=1')
  })

  it('口径自证：判的是暂存区 blob，不是工作树 —— 工作树随后被改成坏样子也不该拦（拦了就是把别人的在途编辑算到我头上）', () => {
    const dir = gitRepo({ 'mine.mjs': 'export const mine = 1\n' })
    writeFileSync(join(dir, 'mine.mjs'), 'export const mine = 1\n))(\n', 'utf8')
    const r = run(dir)
    expect(r.status, `暂存的是好版本，工作树的在途改动不该算本次提交的错：${r.stdout}`).toBe(0)
    // 反向半边：把工作树那份也 add 上去 ⇒ 同一文件立刻必须红（证明上面那个 0 不是"根本没读到文件"）
    expect(assertCliRan(spawnSync('git', ['add', '--', 'mine.mjs'], { cwd: dir, encoding: 'utf8' }), { label: 'staged-syntax git add 坏版本' }).status).toBe(0)
    const again = run(dir)
    expect(again.status, '把坏版本加进暂存区后必须翻红').toBe(1)
    expect(again.stdout).toContain('FAIL mine.mjs')
  })

  it('盲区必须说出来：暂存 .ts 时本闸不判，但门面行要印盲区数并声明由谁负责（失明不得与已核同形）', () => {
    const dir = gitRepo({ 'typed.ts': 'const x: number = 1\n))(\n', 'fine.mjs': 'export const f = 1\n' })
    const r = run(dir)
    expect(r.status, 'TS 不在本闸面内 ⇒ 不因它判红（它由 oxlint + typecheck 管）').toBe(0)
    expect(r.stdout).toMatch(/盲区 1 个/)
    expect(r.stdout).toContain('本闸没判过')
  })

  it('边界两则：暂存面为空 = 跳过（不是通过）；不在 git 工作树里 = 环境不满足 rc=2', () => {
    const empty = gitRepo({})
    const e = run(empty)
    expect(e.status).toBe(0)
    expect(e.stdout).toContain('跳过：暂存面 0 个文件')
    expect(e.stdout).not.toContain('GATE-PASS')
    const plain = mkdtempSync(join(tmpdir(), 'nongit-'))
    dirs.push(plain)
    const n = run(plain)
    expect(n.status, `非工作树必须有独立退出码，不能读成"没有坏文件"：${n.stdout}`).toBe(2)
    expect(n.stdout).toContain('环境不满足')
  })

  it('变异体：摘掉"子进程 rc≠0 ⇒ 记一条 FAIL"这道判定 ⇒ 同一坏件必须被读成通过（证明红因就是那一行）', () => {
    const dir = gitRepo({ 'hurt.mjs': 'const a = 1\n))(\n' })
    const inRepo = join(dir, 'scripts', 'check-staged-syntax.mjs')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    const src = readFileSync(SCRIPT, 'utf8')
    const mutated = src.replace('if (runner.status !== 0) {', 'if (false) {')
    expect(mutated, '变异锚点已失效（脚本改形，夹具必须同步）').not.toBe(src)
    writeFileSync(inRepo, mutated, 'utf8')
    try {
      const r = assertCliRan(spawnSync(process.execPath, ['scripts/check-staged-syntax.mjs'], { cwd: dir, encoding: 'utf8', timeout: 90_000 }), { label: 'staged-syntax 变异体(摘判定)' })
      expect(r.status, '摘掉判定之后仍判红 ⇒ 这条腿没打在被告分支上').toBe(0)
      expect(r.stdout).toContain('GATE-PASS')
    } finally {
      writeFileSync(inRepo, src, 'utf8')
      const back = assertCliRan(spawnSync(process.execPath, ['scripts/check-staged-syntax.mjs'], { cwd: dir, encoding: 'utf8', timeout: 90_000 }), { label: 'staged-syntax 还原复跑' })
      expect(back.status, '还原后必须重新判红（证明那个 0 是变异造成的）').toBe(1)
    }
  })
})

// 夹具目录是临时件：挂在 afterAll（写成模块尾部的裸循环会在测试跑之前就把它删光）。
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
