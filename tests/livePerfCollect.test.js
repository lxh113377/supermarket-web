import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SELF = join('scripts', 'collect-live-perf.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

/**
 * 合成环境：浏览器与 lighthouse 执行器都用临时目录里的假件驱动。
 * 为什么不能图省事用本机真件 —— 户内「夹具不得读本机状态」：本机装了 Edge/lighthouse 的那条腿
 * 在 CI 上是另一个答案，写死期望就会让 CI 变红或让测试静默失去判据力。
 * 真面另有一轮活体取证（报告 §7：批次 d3 由本件真跑产出 3 份 + 预飞状态码回执）。
 */
function sandbox({ lhName = 'lighthouse' } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'lhcs-'))
  tmpDirs.push(d)
  const browser = join(d, 'fake-browser.exe')
  writeFileSync(browser, 'x', 'utf8')
  const pkgDir = join(d, 'node_modules', lhName)
  mkdirSync(join(pkgDir, 'cli'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: lhName, version: '9.9.9' }), 'utf8')
  const lhCli = join(pkgDir, 'cli', 'index.js')
  writeFileSync(lhCli, '// fake\n', 'utf8')
  const dir = join(d, 'samples')
  mkdirSync(dir, { recursive: true })
  const roster = join(d, 'roster.json')
  writeFileSync(roster, JSON.stringify({
    pages: [{ tag: 'admin', url: 'https://supermarket-web.pages.dev/', expectUrlIncludes: 'pages.dev', minSamples: 2 }],
  }), 'utf8')
  return { d, browser, lhCli, dir, roster }
}

const cli = (args, env = {}) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
  cwd: REPO, encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...env },
}), { label: `collect-live-perf ${args.join(' ')}` })

describe('现网性能取数器：预飞取状态码、批次防覆写、缺件即不开枪', () => {
  it('自证 13/13（含批次名歧义拒收、产物三态、执行器解析成对正反例）', () => {
    const r = cli(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('[collect:live-perf] 自证 13/13')
  })

  it('合成面：假浏览器 + 假执行器 + 合成名册 ⇒ DRY 计划由名册派生（样本数与文件名不写死在测试里）', () => {
    const s = sandbox()
    const r = cli(['--batch', 'd9', '--dir', s.dir, '--roster', s.roster],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: s.lhCli })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('lighthouse=9.9.9')
    expect(r.stdout).toContain('admin-d9-s1.json')
    expect(r.stdout).toContain('admin-d9-s2.json')
  })

  it('反例（户内「降级测量不得覆写基线」）：批次已有产物时不加 --force 必须拒，且给出出路', () => {
    const s = sandbox()
    writeFileSync(join(s.dir, 'admin-d9-s1.json'), '{}', 'utf8')
    const r = cli(['--batch', 'd9', '--dir', s.dir, '--roster', s.roster],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: s.lhCli })
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('不得盖掉既有基线')
    expect(r.stdout).toContain('--force')
  })

  it('反例：--only 点了名册里没有的页 ⇒ rc=2 并印在册清单（不许自动并入，也不许悄悄改成全量）', () => {
    const s = sandbox()
    const r = cli(['--batch', 'd9', '--only', 'nope', '--dir', s.dir, '--roster', s.roster],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: s.lhCli })
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('不在名册')
    expect(r.stdout).toContain('admin')
  })

  it('反例：批次名含 "-s<数字>" ⇒ 拒（判据按最后一个 -s<n> 切分，这种名字会让页名认错）', () => {
    const s = sandbox()
    const r = cli(['--batch', 'spring-3-s1', '--dir', s.dir, '--roster', s.roster],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: s.lhCli })
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('不得含')
  })

  it('零输入：名册读不到 ⇒ rc=2 且一枪都不开（不知道"该量哪些页"时不得凭记忆跑）', () => {
    const s = sandbox()
    const r = cli(['--batch', 'd9', '--dir', s.dir, '--roster', join(s.d, 'none.json')],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: s.lhCli })
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('BLOCKED')
  })

  it('反例（户内「探针参数不得写盘」）：**裸调用**走完解析链后，样本目录必须还是空的（默认只出计划；本条是改前实测 rc=1/219s 真打了 6 份之后加的门）', () => {
    const s = sandbox()
    const r = cli(['--batch', 'd9', '--dir', s.dir, '--roster', s.roster],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: s.lhCli })
    expect(r.status, r.stdout).toBe(0)
    expect(r.stdout).toContain('未联网、未起浏览器、未写盘')
    expect(readdirSampleCount(s.dir), '默认调用却落了产物 ⇒ 探针参数变成全量采集').toBe(0)
    expect(existsSync(join(s.dir, 'receipt-d9.json')), '默认调用也不得写回执').toBe(false)
    expect(existsSync(s.dir), '连样本目录都不该被创建').toBe(true)
  })

  it('反例：执行器解析到同名但包名不是 lighthouse 的假件 ⇒ 不得当成执行器（点名"没解析到"）', () => {
    const s = sandbox({ lhName: 'not-lighthouse' })
    const r = cli(['--batch', 'd9', '--dir', s.dir, '--roster', s.roster],
      { CHROME_PATH: s.browser, LIGHTHOUSE_CLI: join(s.d, 'node_modules', 'not-lighthouse', 'cli', 'index.js') })
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('没解析到 lighthouse CLI')
  })
})

function readdirSampleCount(dir) {
  try { return readdirSync(dir).filter((f) => f.endsWith('.json')).length } catch { return -1 }
}
