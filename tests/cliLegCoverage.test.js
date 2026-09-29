import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SELF = join('scripts', 'check-cli-leg-coverage.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'clilegs-')); tmpDirs.push(d); return d }

const cli = (args) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
  cwd: REPO, encoding: 'utf8', timeout: 120_000,
}), { label: `cli-legs ${args.join(' ')}` })

/**
 * 第五十五轮 R55-H3：CLI 腿欠账判据。
 * 起因是第五十四轮那条 flake 的**类级**修法——`assertCliRan` 交付了却只接了 4 件文件，
 * 于是"把 status=null 的空输出当结论"这条失效路在其余测试里照样会伪装成内容断言失败。
 * 本文件钉三件事：① 判据自证 8/8；② 真面读数与上限册自洽（恒等式 + 两名单互斥）；
 * ③ **上限真的会拦**（把天花板压到 0 ⇒ 必须 rc=1，否则它只是个印字的观察者）。
 */
describe('CLI 腿欠账判据：分母按 AST 取、上限只准降', () => {
  it('判据自证 8/8 双向夹具（含零输入与恒绿守卫）', () => {
    const r = cli(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('[verify:cli-legs] 自证 8/8')
  })

  it('真面：门面行 verdict=GREEN 且恒等式两侧相等', () => {
    const r = cli([])
    expect(r.status, r.stdout.slice(-400)).toBe(0)
    const line = String(r.stdout).split('\n').find((l) => l.startsWith('[verify:cli-legs] verdict='))
    expect(line, '门面行缺失').toBeTruthy()
    expect(line).toContain('verdict=GREEN')
    const m = /spawn 位点 (\d+)（带 timeout (\d+) \/ 不带 (\d+)）/.exec(line)
    expect(m, `门面行取不到位点三元组：${line}`).toBeTruthy()
    expect(Number(m[1]), `恒等式不闭合 ${m[1]} != ${m[2]}+${m[3]}`).toBe(Number(m[2]) + Number(m[3]))
  })

  it('--json：guarded 与 debt 两名单必须互斥，且欠账数等于名册点名的件数', () => {
    const r = cli(['--json'])
    expect(r.status, r.stderr.slice(-300)).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.verdict).toBe('GREEN')
    const overlap = j.guarded.filter((f) => j.debt.includes(f))
    expect(overlap, `同批文件既算已接入又算欠账：${overlap.join(', ')}`).toEqual([])
    expect(j.debt.length).toBe(j.stats.debt)
    expect(j.stats.unparsed, '有测试文件解析失败却被踢出分母 ⇒ 判据取数面坏了，不是没欠账').toBe(0)
  })

  it('变异体：把天花板压到 0 ⇒ 必须判红并给出处置（否则上限只是装饰）', () => {
    const d = tmp()
    const roster = join(d, 'cli-legs.json')
    writeFileSync(roster, JSON.stringify({ unguardedMax: 0, capNote: '夹具' }, null, 2), 'utf8')
    const r = cli(['--roster', roster])
    expect(r.status, '上限压到 0 还放行 ⇒ 这条尺拦不住任何东西').toBe(1)
    expect(r.stdout).toContain('处置＝把接守卫当成本轮的一部分')
  })

  it('零输入：--dir 指到空目录 ⇒ rc=2 且不得印"全接完了"', () => {
    const d = tmp()
    const r = cli(['--dir', d])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('没有对象可判')
  })

  it('上限册缺失 ⇒ rc=2 fail-closed（把"没读到上限"读成"无穷大"是户内 G14 的反面）', () => {
    const r = cli(['--roster', join(tmp(), 'nope.json')])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('UNVERIFIED')
  })
})
