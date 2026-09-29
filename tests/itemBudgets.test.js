// 第五十二轮 R51-H4（继承项）：分项体积预算 `npm run report:item-budgets` 的常驻夹具。
//
// 为什么要夹具而不是"写完就算交付"：这条判据第一版**不进 `npm run verify`**（advisory 先量误报率），
// 不进链的判据最容易烂在树里没人发现 —— 户内 R48-H1 的教训本体就是"沉默的判据"。
// 入口面按 `verify:entrypoints` 的口径真跑子进程（只 import 纯函数不算覆盖）。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
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
// 地板默认给宽值（999）：既有各腿判的是单项预算，不该被地板带崩；地板自己的腿见下面两条专门用例。
function roster(items, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ib52r-'))
  dirs.push(dir)
  const p = join(dir, 'item-budgets.json')
  writeFileSync(p, typeof items === 'string' ? items : JSON.stringify({ items, noBudgetMax: 999, ...extra }, null, 2), 'utf8')
  return p
}
const run = (args, env) => {
  const r = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } })
  return assertCliRan(r, { label: `report:item-budgets ${args.join(' ')}`, budgetMs: 60_000 })
}

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
    for (const x of [missing, empty, badJson]) expect(x.stderr, `零输入时判据不得自己崩：${x.stderr.slice(0, 140)}`).not.toMatch(/Traceback/)
  })

  it('地板 R53-H1：未登记件数超过名册上限 ⇒ rc=1 且点名，**明细照样打印**（先红的那条不许 exit 掉后面的读数）', () => {
    const d = dist({ 'react-vendor-abc.js': 40_000, 'newone-1.js': 500, 'newone-2.js': 500 })
    const r = run(['--dist', d, '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 90_000 }], { noBudgetMax: 1 })])
    expect(r.status, r.stdout + r.stderr).toBe(1)
    expect(r.stdout).toContain('未登记 2 件 > 地板 1')
    expect(r.stdout).toContain('处置＝补登记')
    expect(r.stdout).toMatch(/ADVISORY 未登记 2\/3 件/)   // 明细没被地板那条吃掉
    expect(r.stdout).toMatch(/verdict=RED rc=1.*地板 2\/1/)
    expect(r.stderr, `判据不该抛异常：${r.stderr.slice(0, 140)}`).not.toMatch(/Traceback/)
  })

  it('地板缺失 ⇒ rc=2：没人立过上限不等于上限无穷（第五十二轮那批 no-budget 会被读成"已在治理内"）', () => {
    const d = dist({ 'react-vendor-abc.js': 40_000, 'loose-xyz.js': 500 })
    const noCap = roster('{"items": [{ "pattern": "react-vendor-*.js", "budget": 90000 }]}')
    const r = run(['--dist', d, '--roster', noCap])
    expect(r.status, r.stdout + r.stderr).toBe(2)
    expect(r.stdout).toContain('名册里没有 noBudgetMax')
    expect(r.stdout).not.toMatch(/verdict=GREEN/)
    expect(r.stderr).not.toMatch(/Traceback/)
    // 变异体形状：把地板抬到 0 之外也一样拦不住？不 —— 地板=0 且未登记=0 必须绿（零不是缺陷值）
    const zeroOk = run(['--dist', dist({ 'react-vendor-abc.js': 40_000 }),
      '--roster', roster([{ pattern: 'react-vendor-*.js', budget: 90_000 }], { noBudgetMax: 0 })])
    expect(zeroOk.status, zeroOk.stdout).toBe(0)
    expect(zeroOk.stdout).toMatch(/地板 0\/0/)
  })

  it('接线回归：CI 里确有本判据这一步，且排在 build 之后（两跳核：先解别名→脚本路径，再拿别名去 CI 找）', () => {
    // 户内规「判"门禁是否在 CI 跑"须 grep 脚本路径而非 npm 别名」的正解形态不是"只认路径"，
    // 而是**把别名先解析成路径再对账**：CI 写 `npm run report:item-budgets`，直接 grep 路径会造出假缺口，
    // 直接 grep 别名则会漏掉"别名被改指别处"的那种失效。两跳都过才算接上。
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')
    const cmd = String(pkg.scripts['report:item-budgets'] || '')
    expect(cmd, '别名必须直指本脚本').toBe('node scripts/report-item-budgets.mjs')
    expect(ci, 'ci.yml 必须有一步跑 npm run report:item-budgets（而该别名当跳已解析到真路径）')
      .toContain('npm run report:item-budgets')
    const at = ci.indexOf('npm run report:item-budgets')
    expect(at, '这一步必须排在 npm run build 之后，否则 dist 不存在 ⇒ 每次 UNVERIFIED，接了等于没接')
      .toBeGreaterThan(ci.indexOf('run: npm run build'))
    // 本机 verify 链故意不收它（链里没 build）。这条钉的是「没接错地方」，不是「没接」。
    expect(String(pkg.scripts.verify), 'report:item-budgets 不该出现在没有 build 的 verify 链里')
      .not.toContain('report:item-budgets')
  })

  it('真名册自证（只读 git 决定的量，不读构建产物 ⇒ CI 可复算）：规则互不重叠、预算为正、口径行存在', () => {
    const text = readFileSync(join(REPO, 'docs', 'item-budgets.json'), 'utf8')
    const doc = JSON.parse(text)
    expect(doc.unit).toBe('gzipBytes')
    // 地板必须是名册里的数字（判据读它，代码里不写死 ⇒ 第二真相源为零）
    expect(typeof doc.noBudgetMax, '名册必须有 noBudgetMax（数字）⇒ 未登记面有上限可依').toBe('number')
    expect(doc.noBudgetMax, '地板=0 会让今天的面直接判红，说明它不是随手填的装饰').toBeGreaterThan(0)
    expect(doc.noBudgetMaxNote || '', '地板必须注明只准降不准升，否则下一轮会把它当可调参数').toContain('只准降不准升')
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
