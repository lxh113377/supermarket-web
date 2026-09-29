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
 * ③ **上限真的会拦**（植入一条裸腿去撞天花板 ⇒ 必须 rc=1，否则它只是个印字的观察者；
 *    第五十六轮欠账降到 0 之后，"把天花板压到 0"这个动作本身不再构成干预，反例的对象必须由被测量给出）。
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

  it('变异体：植入一条裸腿（带 timeout 的 spawn 未接守卫）+ 天花板 0 ⇒ 必须判红并给出处置', () => {
    // 形态换了才是正解。第五十五轮这条腿写的是"把 unguardedMax 压到 0 ⇒ 拿真面 11 件欠账去撞它"；
    // 第五十六轮 R56-H2 把 11 件**逐件清偿**后欠账归 0，同一个动作当场失去牙齿（实测 rc=0，
    // 断言 expected +0 to be 1）—— 不是判据坏了，是这条反例的对象消失了。
    // 户内教训：零余量地板一旦落到 0，"压到 0"就不再是干预。牙齿必须由**被测量**提供，
    // 所以改成在临时 --dir 里植一条真裸腿：欠账 0→1，天花板 0 ⇒ 判红。这样无论真面欠账降到几都有效。
    const d = tmp()
    writeFileSync(join(d, 'planted-bare-leg.test.js'), [
      "import { spawnSync } from 'node:child_process'",
      "const r = spawnSync(process.execPath, ['nope.mjs'], { encoding: 'utf8', timeout: 1000 })",
      "if (!String(r.stdout).includes('ok')) throw new Error('把空输出当结论了')",
      '',
    ].join('\n'), 'utf8')
    const roster = join(d, 'cli-legs.json')
    writeFileSync(roster, JSON.stringify({ unguardedMax: 0, capNote: '夹具' }, null, 2), 'utf8')
    const r = cli(['--dir', d, '--roster', roster])
    expect(r.stdout, '植入的裸腿没进欠账面 ⇒ 分母取数面坏了，红因也就没有对象').toContain('planted-bare-leg.test.js')
    expect(r.status, '欠账 1 而天花板 0 还放行 ⇒ 这条尺拦不住任何东西').toBe(1)
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
