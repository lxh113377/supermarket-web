// 第三十一轮：记忆卷 4KB 上限的**仓库内**闸（对标 `pre-commit/pre-commit-hooks` 的
// `check-added-large-files`：阈值显式给、默认只管要提交的面、全量要显式扩面）。
//
// 为什么必须常驻夹具：`handoff.py volume` 是外部工具且是报告型（dry-run 不拦），结果是
// 我本轮写的 `07-next-steps.part42.md` 超到 4,873B 也能一路提交成功 —— "4KB 上限"在册但没人守。
// 本文件把它变成会红的事情，且两种"零对象"必须分得开：全量面为空＝取数面坏了（红）、
// 暂存面为空＝本次没动记忆（跳过，绿），两者不得同形。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { evaluate, classify } from '../scripts/check-memory-volume.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-memory-volume.mjs')
const GATE = 'check-memory-volume.mjs'
const tmpDirs = []

/** 造一个只有 memory/ + package.json + scripts/<gate> 的最小仓（脚本自带依赖拷贝器） */
function repo(files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smvol-'))
  tmpDirs.push(dir)
  mkdirSync(join(dir, 'memory'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'vol-fix' }))
  for (const [n, body] of Object.entries(files)) writeFileSync(join(dir, 'memory', n), body)
  copyGateScripts(REPO, dir, GATE)
  if (git) spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', timeout: 30_000 })
  return dir
}
const runIn = (dir, args = []) => {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', GATE), ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
const pad = (n, head = 'x') => `${head}\n` + 'a'.repeat(n)

describe('memory-volume：超限必须点名 + 两种"零对象"不得同形', () => {
  it('真仓 --all：GATE-PASS 且超限为 0（本轮初跑时它就是红的，随后把两卷拆到 4KB 内）', () => {
    const r = spawnSync(process.execPath, [SELF, '--all'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 })
    const out = `${r.stdout}${r.stderr}`
    expect(out, out.slice(-400)).toContain('GATE-PASS memory-volume')
    expect(out).toMatch(/超限 0/)
    expect(Number((/判 (\d+) 卷/.exec(out) || [])[1] || 0), '作用面卷数应由枚举得出').toBeGreaterThan(40)
    expect(r.status).toBe(0)
  }, 90_000)

  it('反例：5KB 的分卷 ⇒ 判红，且点名文件、字节数与超出量（数字由输出算，不在夹具里硬写）', () => {
    const dir = repo({ '07-next-steps.part99.md': pad(5000, '# 卷 99') })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out).toBe(1)
    const m = /07-next-steps\.part99\.md (\d+)B\(\+(\d+)\)/.exec(out)
    expect(m, `detail 里该有"文件名 字节数(+超出量)"，实际：${out.split('\n').find((l) => l.includes('V2'))}`).not.toBe(null)
    const [size, over] = [+m[1], +m[2]]
    const actual = Buffer.byteLength(readFileSync(join(dir, 'memory', '07-next-steps.part99.md')))
    expect(size, '报告的字节数必须等于盘上真实字节数').toBe(actual)
    expect(over, '超出量必须等于 size - 阈值').toBe(size - 4096)
    expect(out).toContain('GATE-FAIL')
  })

  it('对偶：同一个仓把卷裁到 4KB 内 ⇒ 必须转绿（证明上一条的红是因为体积，不是夹具坏了）', () => {
    const dir = repo({ '07-next-steps.part99.md': pad(100, '# 卷 99') })
    const r = runIn(dir, ['--all'])
    expect(r.rc, r.out).toBe(0)
    expect(r.out).toContain('GATE-PASS')
  })

  it('全量面为空（一个 .md 都不判）⇒ 判红"取数面本身坏了"，不许返回"0 个全部 ≤ 4KB"式的绿', () => {
    const dir = repo({})
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out).toBe(1)
    expect(out).toMatch(/取数面本身坏了/)
  })

  it('每个卷都是 0 字节 ⇒ rc=2 环境不满足（"都在预算内"是给有内容的仓说的；第二十六轮零分母同族）', () => {
    const dir = repo({ '07-next-steps.md': '', '07-next-steps.part99.md': '' })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out).toBe(2)
    expect(out).toContain('环境不满足')
    expect(out).not.toContain('GATE-PASS')
    // 首行必须是自家诊断，不能是裸栈
    expect(out.trim().split(/\r?\n/)[0]).toMatch(/^\[memory-volume\]/)
  })

  it('暂存面为空 ⇒ rc=0 但必须说"跳过"（一次纯代码提交不该被这道闸拦住）', () => {
    const dir = repo({ '07-next-steps.part99.md': pad(100, '# 卷 99') })
    const { rc, out } = runIn(dir, [])
    expect(rc, out).toBe(0)
    expect(out).toContain('跳过')
    expect(out).toContain('判 0 卷')
  })

  it('非 git 目录 + 默认模式 ⇒ rc=2 环境不满足（"取不到清单"绝不许当成"没有文件"然后判通过）', () => {
    const dir = repo({ '07-next-steps.part99.md': pad(100, '# 卷 99') }, { git: false })
    const { rc, out } = runIn(dir, [])
    expect(out, `这一条要求 git 在临时目录里确实不可用；实际输出：${out.slice(0, 200)}`).toMatch(/环境不满足|跳过/)
    if (out.includes('环境不满足')) expect(rc).toBe(2)
    else expect(rc, '没有 .git 父目录时才允许走跳过分支').toBe(0)
  })

  it('按类排除必须**说出来**：日报与 sync 快照超限不判，但要印在输出里（静默豁免＝没有豁免口径）', () => {
    const dir = repo({
      '2026-09-27.md': pad(9000, '# 日报'),
      '02-structure.md': pad(9000, '# 快照'),
      '07-next-steps.md': pad(100, '# 主卷'),
    })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out).toBe(0)
    expect(out).toContain('按类排除')
    expect(out).toContain('2026-09-27.md')
    expect(out).toContain('02-structure.md')
  })

  it('阈值来自登记册：06-constraints.md 写了 memory_md_max ⇒ 必须吃它，并在首行标出来源', () => {
    const dir = repo({
      '06-constraints.md': '# 约束\n\n- 体量预算：memory_md_max = 300\n',
      '07-next-steps.md': pad(400, '# 主卷'),
    })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out).toBe(1)
    expect(out).toContain('阈值 300B')
    expect(out).toContain('06-constraints.md 体量预算行')
  })

  it('classify 纯函数侧：归属判据与"面外理由必须非空"（空理由就是在悄悄缩面）', () => {
    expect(classify('2026-09-27.md').inScope).toBe(false)
    expect(classify('02-structure.md').inScope).toBe(false)
    expect(classify('07-next-steps.part43.md').inScope).toBe(true)
    for (const n of ['2026-09-27.md', '04-file-map.md']) expect(classify(n).why.length, n).toBeGreaterThan(6)
  })

  it('evaluate 纯函数侧：files=[] 在 --all 下红、在暂存模式下绿但 V3 记"无对象"', () => {
    expect(evaluate({ files: [], max: 4096, all: true }).rows.find((r) => r.id === 'V1').pass).toBe(false)
    const staged = evaluate({ files: [], max: 4096, all: false }).rows
    expect(staged.find((r) => r.id === 'V1').pass).toBe(true)
    expect(staged.find((r) => r.id === 'V3').detail).toContain('无对象')
  })

  it('探针有牙齿：植入"超限却判绿"的假闸 ⇒ 同一份 5KB 输入必须被抓住（防判据自己变瞎）', () => {
    const dir = repo({ '07-next-steps.part99.md': pad(5000, '# 卷 99') })
    const target = join(dir, 'scripts', GATE)
    const src = readFileSync(target, 'utf8')
    const mutated = src.replace('const overs = files.filter((f) => f.size > max)', 'const overs = []')
    expect(mutated, '变异锚点已失效（判据改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated)
    try {
      const { rc, out } = runIn(dir, ['--all'])
      expect(rc, '摘掉超限识别后仍判红 ⇒ 这条探针没在看这件事').toBe(0)
      expect(out).toContain('全部 ≤ 4096B')
    } finally {
      writeFileSync(target, src)
    }
    expect(runIn(dir, ['--all']).rc, '还原后必须重新判红').toBe(1)
  })
})

afterAll(() => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 临时目录清理失败不改结论 */ } }
})

describe('V4：新卷必须带着余量出生（第三十五轮，把上一轮立的措辞变成闸）', () => {
  const row = (over) => evaluate({ files: [], max: 4096, ...over }).rows.find((r) => r.id === 'V4')
  const f = (name, size) => ({ name, size })

  it('反例：新增卷 3,900B（余 106B）⇒ 判红并点名，且给出该怎么做', () => {
    const r = row({ files: [f('07-next-steps.part77.md', 3900)], all: false, added: new Set(['07-next-steps.part77.md']) })
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('出生即贴线')
    expect(r.detail).toContain('07-next-steps.part77.md 3900B(余 196B)')
    expect(r.detail).toContain('拆成两卷')
  })

  it('正向：新增卷 2,400B ⇒ 判绿（门禁必须收得下合规做法）', () => {
    const r = row({ files: [f('07-next-steps.part78.md', 2400)], all: false, added: new Set(['07-next-steps.part78.md']) })
    expect(r.pass).toBe(true)
    expect(r.detail).toContain('新增 1 本')
  })

  it('两种"没判"不得同形：无新增对象 ≠ 未验证态 ≠ 通过', () => {
    const none = row({ files: [f('07-next-steps.md', 2400)], all: false, added: new Set() })
    expect(none.pass).toBe(true)
    expect(none.detail).toContain('无可判对象')
    const un = row({ files: [f('07-next-steps.part79.md', 3900)], all: true, added: null })
    expect(un.status).toBe('UNVERIFIED')
    expect(un.detail).toContain('不是通过')
  })

  it('summary 对账：未验证行不得计入 matched（否则"检查 4/4"是假的）', () => {
    const res = evaluate({ files: [f('07-next-steps.part80.md', 3900)], max: 4096, all: true, added: null })
    expect(res.summary.declared).toBe(res.summary.matched + res.summary.mismatched + 1)
    expect(res.summary.matched).toBeLessThan(res.summary.declared)
  })

  it('真入口腿：假仓 git add 一个 3.9KB 新卷 ⇒ 子进程 rc=1 并点名（证明 stagedAdded 接线通）', () => {
    const dir = repo({ '07-next-steps.part81.md': pad(3900, '# 卷 81') })
    spawnSync('git', ['add', 'memory/07-next-steps.part81.md'], { cwd: dir, encoding: 'utf8', timeout: 30_000 })
    const { rc, out } = runIn(dir, [])
    expect(rc, out.slice(-400)).toBe(1)
    expect(out).toContain('出生即贴线')
  })

  it('真入口对偶腿：同一步骤但新卷 2.4KB ⇒ rc=0（不是"只要新增就拦"）', () => {
    const dir = repo({ '07-next-steps.part82.md': pad(2400, '# 卷 82') })
    spawnSync('git', ['add', 'memory/07-next-steps.part82.md'], { cwd: dir, encoding: 'utf8', timeout: 30_000 })
    const { rc, out } = runIn(dir, [])
    expect(rc, out.slice(-400)).toBe(0)
    expect(out).toMatch(/V4 :: 新增 1 本/)
  })
})
