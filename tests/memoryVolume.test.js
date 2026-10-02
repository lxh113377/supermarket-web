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
import { assertCliRan } from './helpers/cliLeg.js'
import { evaluate, classify, V3_MIN_HEADROOM, outerFaceReport, readShellMax, SHELL_MAX_DEFAULT } from '../scripts/check-memory-volume.mjs'

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
  const r = assertCliRan(spawnSync(process.execPath, [join(dir, 'scripts', GATE), ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 }), { label: `memory-volume 合成仓 ${GATE}` })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
const pad = (n, head = 'x') => `${head}\n` + 'a'.repeat(n)

describe('memory-volume：超限必须点名 + 两种"零对象"不得同形', () => {
  it('真仓 --all：GATE-PASS 且超限为 0（本轮初跑时它就是红的，随后把两卷拆到 4KB 内）', () => {
    const r = assertCliRan(spawnSync(process.execPath, [SELF, '--all'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-volume --all 真仓' })
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
    // 变异锚点 v2（第四十六轮同步）：V2 加了"超限件二次确认"之后，原锚 `const overs = files.filter(...)`
    // 被拆成 overs0 + 复核 filter ⇒ 锚点失效，本夹具当场判红（这正是它该有的行为）。改指新的取数行。
    const mutated = src.replace('const overs0 = files.filter((f) => f.size > max)', 'const overs0 = []')
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
    const unv = res.rows.filter((r) => r.status === 'UNVERIFIED').length
    expect(unv, '这张面没有入口卷 ⇒ V3/V4 都该记未验证，不得记通过').toBeGreaterThanOrEqual(1)
    expect(res.summary.declared).toBe(res.summary.matched + res.summary.mismatched + unv)
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

describe('V5：主卷「在册卷号」声明 ⇄ 磁盘分卷双向对账（第三十六轮收尾，把又一条措辞变成闸）', () => {
  const v5 = (over) => evaluate({ files: [{ name: '07-next-steps.md', size: 100 }], max: 4096, ...over }).rows.find((r) => r.id === 'V5')
  it('opt-in：调用方没交出取数面 ⇒ 不出这一行（旧用例不该凭空多一行）', () => {
    const rows = evaluate({ files: [{ name: 'x.md', size: 10 }], max: 4096, all: true }).rows
    expect(rows.some((r) => r.id === 'V5')).toBe(false)
  })
  it('双向对得上 ⇒ PASS，并把"无跳号、无未并号"写在结论里', () => {
    const r = v5({ partNumbers: [1, 2, 3], declaredRange: { lo: 1, hi: 3 } })
    expect(r.pass).toBe(true)
    expect(r.detail).toContain('双向对得上')
  })
  it('建卷不并号 ⇒ FAIL 且点名漏了哪几个号、给出改法（本轮真实形态：声明 1–56、磁盘到 58）', () => {
    const r = v5({ partNumbers: [1, 2, 3], declaredRange: { lo: 1, hi: 2 } })
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('未并号 = 3')
    expect(r.detail).toContain('改成 3')
  })
  it('声明里有、磁盘上没有（跳号/误删卷）⇒ 同样 FAIL，且方向与上一例不同', () => {
    const r = v5({ partNumbers: [1, 3], declaredRange: { lo: 1, hi: 3 } })
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('声明有、磁盘无')
    expect(r.detail).toContain('= 2')
  })
  it('主卷那行读不到 ⇒ UNVERIFIED（"没声明可对"不是"对上了"）', () => {
    const r = v5({ partNumbers: [1], declaredRange: null })
    expect(r.status).toBe('UNVERIFIED')
    expect(r.pass).toBe(true)
    expect(r.detail).toContain('不是通过')
  })
  it('声明存在但磁盘一本都没扫到 ⇒ FAIL（取数面坏了，不是没得对）', () => {
    expect(v5({ partNumbers: [], declaredRange: { lo: 1, hi: 9 } }).pass).toBe(false)
  })
  it('真入口：假仓声明 1–1、磁盘两本 ⇒ 子进程 rc=1 并点名卷号 2', () => {
    const dir = repo({
      '07-next-steps.md': '## 分卷目录\n\n- 在册卷号：1–1。文件名一律 `07-next-steps.part<N>.md`。\n',
      '07-next-steps.part1.md': pad(200, '# 卷 1'),
      '07-next-steps.part2.md': pad(200, '# 卷 2'),
    })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out.slice(-400)).toBe(1)
    expect(out).toContain('未并号 = 2')
  })
  it('真入口对偶腿：把声明并成 1–2 ⇒ rc=0（拦的是"不并号"，不是"有多卷"）', () => {
    const dir = repo({
      '07-next-steps.md': '## 分卷目录\n\n- 在册卷号：1–2。文件名一律 `07-next-steps.part<N>.md`。\n',
      '07-next-steps.part1.md': pad(200, '# 卷 1'),
      '07-next-steps.part2.md': pad(200, '# 卷 2'),
    })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out.slice(-400)).toBe(0)
    expect(out).toMatch(/PASS V5 :: 声明 1–2 ⇄ 磁盘 2 本/)
  })
})

// 第四十六轮 R45-H3：共享工作树里"读到的字节数"可能是别人写到一半的形态。
// 一手两例（都记在 memory/07-next-steps.part74/76）：第四十四轮 verify:volume 判 part72 4333B，
// 20 秒后实测 2637B 且 `git diff HEAD` 为空；第四十五轮同一秒 status 报 4333B、`git cat-file -s` 报 3020B。
// ⇒ 超限这件事改成**二次确认**：两次一致才判违规；不一致记 UNVERIFIED（既不是违规也不是通过）。
describe('V2 二次确认（撕裂读不得冒充违规，也不得冒充通过）', () => {
  const f = (name, size) => ({ name, size })
  const big = [f('07-next-steps.part9.md', 5200)]
  const rows = (over) => evaluate({ files: big, max: 4096, all: true, ...over }).rows
  const find = (rs, id) => rs.find((r) => r.id === id)

  it('两次读数一致 ⇒ 照常判违规（新腿不许把真超限洗成"未验证"）', () => {
    const rs = rows({ remeasure: () => 5200 })
    expect(find(rs, 'V2').pass).toBe(false)
    expect(find(rs, 'V2').detail).toContain('part9.md 5200B')
    expect(find(rs, 'V2b').status).toBe('OK')
  })
  it('两次不一致 ⇒ 记 UNVERIFIED，并把两个数都印出来（不是"通过"，也不是"违规"）', () => {
    const rs = rows({ remeasure: () => 2637 })
    expect(find(rs, 'V2').pass).toBe(true)
    expect(find(rs, 'V2').status).toBe('UNVERIFIED')
    expect(find(rs, 'V2b').status).toBe('UNVERIFIED')
    expect(find(rs, 'V2b').detail).toContain('5200B→2637B')
  })
  it('没有超限件时一次都不重读（成本只在要判红的路径上付）', () => {
    let calls = 0
    const rs = evaluate({ files: [f('07-next-steps.md', 100)], max: 4096, all: true, remeasure: () => { calls += 1; return 1 } }).rows
    expect(calls).toBe(0)
    expect(find(rs, 'V2').pass).toBe(true)
    expect(find(rs, 'V2b').detail).toContain('未触发')
  })
  it('旧形状（不注入 remeasure）行为不变 ⇒ 二次确认是加法不是替换', () => {
    const rs = rows({})
    expect(find(rs, 'V2').pass).toBe(false)
    expect(find(rs, 'V2b').status).toBe('OK')
  })
  it('真入口对偶腿：5.2KB 的卷仍在 --all 面上判 rc=1（演习证明新腿不会放走真违规）', () => {
    const dir = repo({
      '07-next-steps.md': '## 分卷目录\n\n- 在册卷号：1–1。文件名一律 `07-next-steps.part<N>.md`。\n',
      '07-next-steps.part1.md': pad(5200, '# 超限卷'),
    })
    const { rc, out } = runIn(dir, ['--all'])
    expect(rc, out.slice(-400)).toBe(1)
    expect(out).toMatch(/FAIL V2/)
    expect(out).toMatch(/V2b/)
  })
})

describe('V3 三态（第五十轮 R50-H2②）：够写 / 贴死 / 没量到 —— 旧判据 `pass: files.length===0 || !!biggest` 恒真', () => {
  const v3 = (over) => evaluate({ files: [], max: 4096, all: true, ...over }).rows.find((r) => r.id === 'V3')
  const f = (name, size) => ({ name, size })

  it('贴死：入口卷余量 < 256B ⇒ 判红，且处方是"迁新卷"而不是"写短点"', () => {
    const r = v3({ files: [f('07-next-steps.md', 4096 - 90)] })
    expect(r.pass, '余 90B 与余 900B 同形就是上一轮"压措辞续命"的成因').toBe(false)
    expect(r.detail).toContain('贴死')
    expect(r.detail).toContain('迁去新卷号')
    expect(r.detail).toContain('禁止')
    expect(r.detail).toContain('余 90B')
  })

  it('贴线：余量在 [256, 15%) 之间 ⇒ 仍判过，但读数里要说"还能写一条，先腾地方"', () => {
    const r = v3({ files: [f('07-next-steps.md', 4096 - 300)] })
    expect(r.pass).toBe(true)
    expect(r.detail).toContain('贴线')
    expect(r.detail).not.toContain('贴死')
  })

  it('对偶：主卷余量充足 ⇒ 干净通过，既不贴线也不贴死（证明上面两条不是"逢卷必警"）', () => {
    const r = v3({ files: [f('07-next-steps.md', 3000)] })
    expect(r.pass).toBe(true)
    expect(r.detail).not.toContain('贴线')
    expect(r.detail).not.toContain('贴死')
  })

  it('不连坐：历史分卷贴死而入口卷有余量 ⇒ V3 仍判过，最大卷只作为读数出现（拿存量卷拦人＝逼删事实）', () => {
    const r = v3({ files: [f('07-next-steps.md', 3000), f('07-next-steps.part77.md', 4090)] })
    expect(r.pass).toBe(true)
    expect(r.detail).toContain('07-next-steps.part77.md 4090B')
    expect(r.detail).toContain('终态卷，不判')
  })

  it('没量到：作用面里没有入口卷 ⇒ UNVERIFIED（不得读成"余量够"），空作用面另说', () => {
    const absent = v3({ files: [f('07-next-steps.part9.md', 100)] })
    expect(absent.status).toBe('UNVERIFIED')
    expect(absent.detail).toContain('本条未验证')
    const empty = v3({ files: [] })
    expect(empty.detail).toContain('无对象')
  })

  it('下限可复算：256B 来自本仓自己的历史步长（正增量中位数≈255），不是手拍的魔法数', () => {
    expect(V3_MIN_HEADROOM).toBe(256)
    const justUnder = v3({ files: [f('07-next-steps.md', 4096 - (V3_MIN_HEADROOM - 1))] })
    const justOver = v3({ files: [f('07-next-steps.md', 4096 - V3_MIN_HEADROOM)] })
    expect(justUnder.pass).toBe(false)
    expect(justOver.pass).toBe(true)
  })

  it('变异体：把 `dead` 恒置 false ⇒ 同一个贴死样本必须读成通过（证明红因是那次比较）', () => {
    const dir = repo({
      '07-next-steps.md': pad(4096 - 90, '# 入口卷（贴死）'),
      '07-next-steps.part9.md': pad(100, '# 小卷'),
    })
    const target = join(dir, 'scripts', GATE)
    const src = readFileSync(target, 'utf8')
    const base = runIn(dir, ['--all'])
    expect(base.rc, base.out.slice(-400)).toBe(1)
    expect(base.out).toMatch(/FAIL V3/)
    const mutated = src.replace(/^    const dead = headroom < V3_MIN_HEADROOM$/m, '    const dead = false')
    expect(mutated, '变异锚点已失效（脚本改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated, 'utf8')
    const after = runIn(dir, ['--all'])
    expect(after.out, after.out.slice(-400)).toMatch(/PASS V3/)
    // 摘掉那次比较后**整条闸必须变绿**：若仍判红，说明红因来自别处，这条腿就没打在被告分支上。
    expect(after.rc, '变异后仍判红 ⇒ 红因不是 V3 那次比较（同族：别人的红替它通过了断言）').toBe(0)
  })
})

describe('外层面（M-60-4 · 第六十四轮）：内层那把尺一字不动，外层把读数印进结论通道', () => {
  const mkOuter = (body) => {
    const d = mkdtempSync(join(tmpdir(), 'smout-'))
    tmpDirs.push(d)
    writeFileSync(join(d, '07-next-steps.md'), body)
    return d
  }

  it('三态各有独立形状，unavailable 绝不折成 ok（量不到 ≠ 达标）', () => {
    const over = outerFaceReport({ memDir: '/x', size: 44_794, shellMax: 40_960, source: 's' })
    const ok = outerFaceReport({ memDir: '/x', size: 40_000, shellMax: 40_960, source: 's' })
    const na = outerFaceReport({ memDir: '/x', size: null, shellMax: 40_960, source: 's' })
    expect([over.state, ok.state, na.state], '三态互不相同').toEqual(['over', 'ok', 'unavailable'])
    expect([over.over, ok.over]).toEqual([3834, -960])
    expect(na.text).toContain('不折算成')
    expect(na.state === ok.state, '把 unavailable 读成 ok 就是本条要防的那件事').toBe(false)
  })

  it('shell_max 优先读外层文件头自己的声明，读不到才退代码默认', () => {
    expect(readShellMax(mkOuter('x shell_max=40,960B 口径计量 y'))).toEqual({ max: 40960, source: '07-next-steps.md 文件头 shell_max 声明' })
    expect(readShellMax(mkOuter('体量由 shell_max = 50,000 B 口径')).max).toBe(50000)
    expect(readShellMax(mkOuter('本文件提到 shell_max= 但没有数值')), '写了 shell_max 却没数值 ⇒ null，不许猜一个数当阈值').toBeNull()
    expect(readShellMax(join(tmpdir(), 'smout-does-not-exist-64')), '目录都不存在 ⇒ null').toBeNull()
    expect(SHELL_MAX_DEFAULT).toBe(40_960)
  })

  it('入口真跑：外层越限时 gate 行带上外层状态 + stderr 打 WARN，但 rc 与不传该参数时相同（只报不拦）', () => {
    const base = assertCliRan(spawnSync(process.execPath, [SELF, '--all'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-volume --all 基线' })
    const d = mkOuter(`# 07\n> shell_max=40,960B\n\n${'x'.repeat(45_000)}\n`)
    const r = assertCliRan(spawnSync(process.execPath, [SELF, '--all', `--outer-memory=${d}`], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-volume --all 外层面 over' })
    const out = `${r.stdout || ''}${r.stderr || ''}`
    expect(base.status, base.stdout).toBe(0)
    expect(r.status, `只报不拦：rc 不该被外层带跑\n${out.slice(-500)}`).toBe(base.status)
    expect(out).toMatch(/外层面=over/)
    expect(out).toContain('WARN 外层面越 shell_max')
    expect(out).toContain('两侧分母各报各的')
  })

  it('外层目录取不到 ⇒ 印 unavailable，不印 ok（CI 检出面里没有外层，这是常态而不是故障）', () => {
    const r = assertCliRan(spawnSync(process.execPath,
      [SELF, '--all', `--outer-memory=${join(tmpdir(), 'smout-absent-64')}`], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-volume --all 外层面 unavailable' })
    expect(r.stdout).toMatch(/外层面=unavailable/)
    expect(r.stdout).not.toMatch(/外层面=ok/)
  })

  it('反向自证：内层 V1~V5 的判定不因外层加入而变（同一事实只许一处判）', () => {
    const d = mkOuter('# 07\n> shell_max=40,960B\n\n随便\n')
    const r = assertCliRan(spawnSync(process.execPath, [SELF, '--all', `--outer-memory=${d}`], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-volume --all 内层腿数不变' })
    const ids = (r.stdout.match(/^(?:PASS|FAIL|UNVERIFIED) (V\d+b?) ::/gm) || []).map((s) => /^(\S+) (V\w+)/.exec(s)[2])
    expect(['V1', 'V2', 'V2b', 'V3', 'V4', 'V5'].every((v) => ids.includes(v)), `内层腿缺件：${ids.join(', ')}`).toBe(true)
    expect(ids.filter((v) => /^V/.test(v) && !['V1', 'V2', 'V2b', 'V3', 'V4', 'V5'].includes(v)), '外层不该伪装成一条 V 腿进分母').toEqual([])
  })
})
