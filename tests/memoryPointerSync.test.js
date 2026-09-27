// 第三十六轮夹具：外层"工作区级记忆指针"看守判据（P1/P2 三态）。
// 立它的实测：外层指针序列止于第二十九轮、内层已到第三十五轮，5 轮断更无人在意。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { evaluate, latestRound, roundsOf, cnNum, OUTER_MEMORY } from '../scripts/check-memory-pointer-sync.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-memory-pointer-sync.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const row = (rows, id) => rows.find((r) => r.id === id)

describe('中文轮次解析（读不懂必须返回空，不得当 0）', () => {
  it('单值与边界', () => {
    expect(cnNum('三十五')).toBe(35)
    expect(cnNum('十')).toBe(10)
    expect(cnNum('二十')).toBe(20)
    expect(cnNum('九十九')).toBe(99)
    expect(cnNum('七')).toBe(7)
  })
  it('区间写法（R35 那次补齐就是"第三十~三十五轮"）⇒ 两个端点都要收到', () => {
    expect(roundsOf('## 2026-09-27 — 对标第三十~三十五轮（工作区级指针）')).toEqual([30, 35])
    expect(roundsOf('## 对标第三十二轮')).toEqual([32])
  })
  it('解析不了 ⇒ 空数组，不是 [0]', () => {
    expect(roundsOf('## 随便一行没有轮次')).toEqual([])
    expect(roundsOf('## 对标第X轮')).toEqual([])
    expect(cnNum('三百')).toBe(null)
  })
})

describe('P1/P2 三态', () => {
  const inner = { round: 36, seen: [36] }
  it('跟上 ⇒ 两条都 PASS', () => {
    const v = evaluate({ inner, outer: { round: 36, seen: [36] } })
    expect(v.map((r) => r.state)).toEqual(['PASS', 'PASS'])
  })
  it('断更 ⇒ P2 红，并把"补指针或改口径"两条出路写进结论', () => {
    const v = row(evaluate({ inner, outer: { round: 29, seen: [29] } }), 'P2')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('断更 7 轮')
    expect(v.detail).toContain('补一条指针')
  })
  it('外层超前 ⇒ 也判红并指向"取数有一侧不对"（不许把它当"外层更勤快"）', () => {
    const v = row(evaluate({ inner, outer: { round: 40, seen: [40] } }), 'P2')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('超前')
  })
  it('外层目录不存在 ⇒ UNVERIFIED，且 ok 不为 FAIL（CI 只检出代码仓）', () => {
    const v = row(evaluate({ inner, outer: null }), 'P2')
    expect(v.state).toBe('UNVERIFIED')
    expect(v.detail).toContain('不是已核对')
  })
  it('内层取不到轮次 ⇒ FAIL（取数面坏了不判通过）', () => {
    expect(row(evaluate({ inner: null, outer: { round: 1, seen: [1] } }), 'P1').state).toBe('FAIL')
  })
})

describe('真面与入口', () => {
  it('路径自证：外层目录必须是代码仓的**同级**（首版写成上两级 ⇒ 恒 UNVERIFIED 且输出看着合理）', () => {
    const parent = resolve(REPO, '..')
    expect(resolve(OUTER_MEMORY)).toBe(join(parent, '超市', 'memory'))
  })
  it('真跑本仓：内层能取到轮次，外层要么跟上(PASS)要么判红，不得是"沉默的未验证"', () => {
    const inner = latestRound(join(REPO, 'memory'))
    expect(inner.round, '内层 07 系里应能取到"对标第N轮"标题').not.toBeNull()
    const outer = latestRound(OUTER_MEMORY)
    expect(outer, '本机应能找到外层目录（找不到说明路径又写错了）').not.toBeNull()
    const v = evaluate({ inner, outer })
    expect(v.some((r) => r.state === 'UNVERIFIED'), `外层在本地可见却报未验证：${JSON.stringify(v)}`).toBe(false)
  })
  it('子进程：GATE 行 + rc（红=1 / 绿=0），--json 出结构', () => {
    const r = spawnSync(process.execPath, [SELF], { cwd: REPO, encoding: 'utf8', timeout: 60_000 })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GATE-PASS memory-pointer-sync')
    const j = JSON.parse(spawnSync(process.execPath, [SELF, '--json'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }).stdout)
    expect(j.rows.map((x) => x.id)).toEqual(['P1', 'P2'])
  })
  it('缺输入面：只有脚本、没有 memory/ 的假仓 ⇒ rc=2 且点名取不到（不得静默 0）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smptr-'))
    tmpDirs.push(dir)
    copyGateScripts(REPO, dir, 'check-memory-pointer-sync.mjs')
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-memory-pointer-sync.mjs')], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    expect(r.status, r.stdout + r.stderr).toBe(2)
    expect(`${r.stderr}${r.stdout}`).toMatch(/memory/)
  })
})
