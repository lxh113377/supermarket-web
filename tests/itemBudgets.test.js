// 第五十二轮 R51-H4（继承项）：分项体积预算 `npm run report:item-budgets` 的常驻夹具。
//
// 为什么要夹具而不是"写完就算交付"：这条判据第一版**不进 `npm run verify`**（advisory 先量误报率），
// 不进链的判据最容易烂在树里没人发现 —— 户内 R48-H1 的教训本体就是"沉默的判据"。
// 入口面按 `verify:entrypoints` 的口径真跑子进程（只 import 纯函数不算覆盖）。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'report-item-budgets.mjs')
const dirs = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

/** 造一个合成产物面：`<dir>/assets/<name>` 内容为 `fill` 个字节（gzip 后大小随内容单调变）。 */
function dist(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ib52-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'assets'), { recursive: true })
  for (const [name, fill] of Object.entries(files)) {
    if (fill === null) continue
    writeFileSync(join(dir, 'assets', name), Buffer.alloc(fill, name.length % 251))
  }
  return dir
}
function roster(items) {
  const dir = mkdtempSync(join(tmpdir(), 'ib52r-'))
  dirs.push(dir)
  const p = join(dir, 'item-budgets.json')
  writeFileSync(p, typeof items === 'string' ? items : JSON.stringify({ items }, null, 2), 'utf8')
  return p
}
const run = (args, env) => spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } })

describe('report:item-budgets（分项预算，第一版 advisory 不进阻断链）', () => {
  it('入口真跑：--selftest 必须被子进程跑起来并印出判别条数（6/6）', () => {
    const r = run(['--selftest'])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('[report:item-budgets] 自证 6/6')
  })

  it('正向：件在预算内 ⇒ rc=0 且**余量可见**（只报"过"不给余量=下一轮无法判断地板还有多少空间）', () => {
    const d = dist({ 'react-vendor-abc.js': 40_000 })
    const r = run(['--dist', d, '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 90_000 }])])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/PASS\s+react-vendor-abc\.js 实测 \d+B ≤ 预算 90000B（余 \d+B）/)
  })

  it('反例（变异体形状）：把预算压到 1B ⇒ 同一产物面必须判红，且两侧数都印出来', () => {
    const d = dist({ 'react-vendor-abc.js': 40_000 })
    const ok = run(['--dist', d, '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 90_000 }])])
    const r = run(['--dist', d, '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 1 }])])
    expect(ok.status, '对照必须先绿，否则这条反例测的是夹具不是判据').toBe(0)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/FAIL\s+react-vendor-abc\.js 实测 (\d+)B > 预算 1B（超 \d+B/)
  })

  it('未登记 ⇒ **不判合格**，但必须点名并给最大件（新 chunk 家族进来时唯一的可见通道）', () => {
    const d = dist({ 'react-vendor-abc.js': 40_000, 'brandnew-xyz.js': 30_000 })
    const r = run(['--dist', d, '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 90_000 }])])
    expect(r.status, '未登记不是缺陷，advisory 期不拦：' + r.stdout.split('\n').slice(-2)).toBe(0)
    expect(r.stdout).toContain('ADVISORY 未登记 1/2 件')
    expect(r.stdout).toContain('brandnew-xyz.js')
    expect(r.stdout).toMatch(/登记 1 条（匹配 1 \/ 死条目 0）｜产物 2 件（判 1 \/ 未登记 1）/)
  })

  it('名册死条目：登记了却 0 命中 ⇒ 判红（死豁免比缺豁免危险：下轮会以为它判过了）', () => {
    const d = dist({ 'react-vendor-abc.js': 40_000 })
    const r = run(['--dist', d, '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 90_000 }, { pattern: 'gone-*.js', budget: 5 }])])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('名册死条目：`gone-*.js`')
    expect(r.stdout).toMatch(/死条目 1/)
  })

  it('零输入三挡：产物目录不存在 / 目录在但空 / 名册非法 JSON ⇒ 一律 rc=2，不得印"全在预算内"', () => {
    const missing = run(['--dist', join(tmpdir(), 'ib52-no-such-dir'), '--roster', roster([{ pattern: 'a-*.js', budget: 5 }])])
    expect(missing.status, missing.stdout).toBe(2)
    expect(missing.stdout).toContain('UNVERIFIED')
    const empty = run(['--dist', dist({}), '--roster', roster([{ pattern: 'a-*.js', budget: 5 }])])
    expect(empty.status, empty.stdout).toBe(2)
    expect(empty.stdout).toMatch(/空集/)
    const badJson = run(['--dist', dist({ 'a-x.js': 10 }), '--roster', roster('{ 这不是 JSON ')])
    expect(badJson.status, badJson.stdout).toBe(2)
    expect(badJson.stdout).toContain('名册读不到或不是合法 JSON')
    expect(badJson.stdout).not.toMatch(/verdict=GREEN/)
  })

  it('真名册自证（只读 git 决定的量，不读构建产物 ⇒ CI 可复算）：规则互不重叠、预算为正、口径行存在', () => {
    const text = readFileSync(join(REPO, 'docs', 'item-budgets.json'), 'utf8')
    const doc = JSON.parse(text)
    expect(doc.unit).toBe('gzipBytes')
    expect(Array.isArray(doc.items) && doc.items.length).toBeGreaterThan(0)
    const toRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    for (const it of doc.items) {
      expect(it.budget, `${it.id} 的预算必须为正数`).toBeGreaterThan(0)
      expect(it.pattern, `${it.id} 缺 pattern`).toBeTruthy()
    }
    // 判据按"第一条命中即停"，两条规则同指一件会让"谁给了这个预算"不可判定 ⇒ 名册侧先钉住。
    // 探针取每条规则**自己会产出的具体文件名**（把 `*` 去掉），拿它去撞别的规则。
    for (const a of doc.items) {
      const probe = a.pattern.replace('*', '')
      for (const b of doc.items) {
        if (a === b) continue
        expect(toRe(b.pattern).test(probe), `${a.pattern} 会产出的 "${probe}" 同时命中 ${b.pattern} ⇒ 预算归属不可判定`).toBe(false)
      }
    }
    // measuredAtBuild 是取证注记，必须写成**字符串**：写成数字就是在台账里埋一台机器的读数
    for (const it of doc.items) expect(typeof it.measuredAtBuild, `${it.id}.measuredAtBuild 必须是字符串`).toBe('string')
    expect(text).toContain('不是判据输入')
  })
})
