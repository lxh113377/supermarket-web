// 第七十轮 I-70-4：perf「未采到」样本隔离器的夹具。
// @vitest-environment node
//
// 立它的实测：`report:live-perf` 连续五轮 verdict=RED，而红的**唯一**来源是 customer 侧 7 份
// `runtimeError=NO_FCP` + `finalDisplayedUrl=about:blank`。判据已正确剔出统计，但它们仍躺在
// `.lighthouse/` 里，每轮都要重解释一遍为什么剔 —— 「这是网络类不是站点退化」只活在读报告的人的脑子里。
//
// 四块，缺一块这个隔离器就可能变成"把红藏起来"的工具：
//   ① classify：网络类 ⇒ 搬；非网络类 / JSON 坏 / 有 FCP / 非样本命名 ⇒ **不搬**（不许顺便带进来）；
//   ② 端到端：隔离后取数面 runtimeError 归零 + 索引留痕 + 复原后逐件字节相同（只搬不删）；
//   ③ 幂等：已隔离的不重复搬；隔离区空了撤索引（否则判据会继续印「已隔离 N 件」而实际 0 件）；
//   ④ 判据可见性：隔离后 `report:live-perf` 那行**必须自带隔离读数** —— 否则 GREEN 是新的绿色沉默。
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify } from '../scripts/quarantine-unreached-perf.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SELF = join('scripts', 'quarantine-unreached-perf.mjs')
const REPORT = join('scripts', 'report-live-perf.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lhquar-')); tmpDirs.push(d); return d }

const cli = (args, dir) => assertCliRan(spawnSync(process.execPath, [SELF, ...args, '--dir', dir], {
  cwd: REPO, encoding: 'utf8', timeout: 120_000,
}), { label: `quarantine-perf ${args.join(' ')}` })

/** 造一份样本；`net` 为真时是网络类未采到那份（有 runtimeError、无 FCP、URL=about:blank）。 */
const sample = (net) => JSON.stringify(net ? {
  finalDisplayedUrl: 'about:blank',
  runtimeError: { code: 'NO_FCP' },
  audits: {},
} : {
  finalDisplayedUrl: 'https://supermarket-web.pages.dev/',
  fetchTime: '2026-09-29T06:49:23.204Z',
  runtimeError: undefined,
  audits: {
    'first-contentful-paint': { numericValue: 1500 },
    'largest-contentful-paint': { numericValue: 1900 },
    'cumulative-layout-shift': { numericValue: 0 },
    'total-blocking-time': { numericValue: 200 },
    'speed-index': { numericValue: 4500 },
    'server-response-time': { numericValue: 220 },
  },
})

describe('classify：谁该进隔离区、谁必须留在原地', () => {
  it('网络类未采到 ⇒ 搬，且带上 code / URL 供索引留痕', () => {
    const c = classify('customer-d2-s1.json', sample(true))
    expect(c.move).toBe(true)
    expect(c.code).toBe('NO_FCP')
    expect(c.url).toBe('about:blank')
  })
  it('有 FCP 的真样本 ⇒ 一律不碰（隔离器不得动分布面）', () => {
    expect(classify('admin-s1.json', sample(false)).move).toBe(false)
  })
  it('非网络类 runtimeError ⇒ 不搬（留在原地让判据红）', () => {
    const bad = JSON.stringify({ runtimeError: { code: 'SOMETHING_ELSE' }, audits: {} })
    const c = classify('admin-s1.json', bad)
    expect(c.move).toBe(false)
    expect(c.why).toMatch(/不在网络类码表/)
  })
  it('JSON 不可解析 ⇒ 不搬（搬了就等于把"产物坏掉"藏起来）', () => {
    const c = classify('admin-s1.json', '{ not json')
    expect(c.move).toBe(false)
    expect(c.why).toMatch(/不可解析/)
  })
  it('非样本命名 ⇒ 不搬（roster 之类不许被卷进隔离区）', () => {
    expect(classify('roster.json', sample(true)).move).toBe(false)
  })
})

describe('端到端：隔离 ⇒ 复原（只搬不删）', () => {
  it('隔离后取数面 runtimeError 归零 + 索引留痕；复原后逐件字节相同', () => {
    const dir = tmp()
    // 两真一假：假件必须进隔离区，真件必须原封不动留在取数面
    writeFileSync(join(dir, 'admin-s1.json'), sample(false), 'utf8')
    const netBytes = sample(true)
    writeFileSync(join(dir, 'customer-d2-s1.json'), netBytes, 'utf8')
    const before = readFileSync(join(dir, 'customer-d2-s1.json'))

    const iso = cli([], dir)
    expect(iso.status, iso.stdout + iso.stderr).toBe(0)
    expect(iso.stdout).toContain('已隔离 1 件')
    expect(existsSync(join(dir, 'customer-d2-s1.json')), '隔离件必须离开取数面').toBe(false)
    expect(existsSync(join(dir, 'admin-s1.json')), '真样本必须留在取数面').toBe(true)
    const idx = JSON.parse(readFileSync(join(dir, 'quarantine', 'INDEX.json'), 'utf8'))
    expect(idx.items).toHaveLength(1)
    expect(idx.items[0].code).toBe('NO_FCP')
    expect(idx.rule, '索引必须说清隔离判据（哪类搬、哪类留）').toMatch(/NETWORK_ERROR_CODES|留在取数面/)
    expect(idx.$comment, '索引必须说清"不得折进基线、不得折算成慢"这条口径').toMatch(/不得折进基线|不得折算成/)

    // 复原：字节必须与隔离前逐件相同（只搬不删）
    const back = cli(['--restore'], dir)
    expect(back.status, back.stdout + back.stderr).toBe(0)
    expect(back.stdout).toMatch(/隔离区余 0 件/)
    expect(readFileSync(join(dir, 'customer-d2-s1.json')).equals(before), '复原后字节必须与隔离前相同').toBe(true)
    expect(existsSync(join(dir, 'quarantine', 'INDEX.json')), '隔离区空了必须撤索引，否则判据会继续印「已隔离 N 件」').toBe(false)
  })

  it('幂等：已在隔离区的不重复搬；第二跑无事可隔离且 rc=0', () => {
    const dir = tmp()
    // 造一件真样本垫底：只有当取数面**仍有样本命名件**时，"无事可隔离"才是"扫过且清白"；
    // 若取数面被搬空了，那句"无事可隔离"就分不清是幂等复查还是"没对象可扫" ⇒ 判据应当 fail-closed。
    writeFileSync(join(dir, 'admin-s1.json'), sample(false), 'utf8')
    writeFileSync(join(dir, 'customer-d2-s1.json'), sample(true), 'utf8')
    expect(cli([], dir).status).toBe(0)
    const again = cli([], dir)
    expect(again.status, again.stdout + again.stderr).toBe(0)
    expect(again.stdout).toMatch(/无事可隔离/)
    expect(again.stdout, '幂等复查必须说明它是幂等，不是"没对象"').toMatch(/幂等复查/)
  })
  it('零分母 fail-closed：取数面一件样本都没有 ⇒ rc=2 且点名（不得读成"没发现问题"）', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'roster.json'), sample(false), 'utf8') // 非样本命名
    const r = cli([], dir)
    expect(r.status, r.stdout + r.stderr).toBe(2)
    expect(r.stdout + r.stderr).toMatch(/没有对象就不记绿|fail-closed/)
    expect(r.stdout + r.stderr, '必须点名取证命令').toMatch(/collect:live-perf/)
  })
  it('内容零分母 fail-closed：文件在但全 0 字节 ⇒ rc=2（"一件没搬"不等于"没对象可判"）', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'admin-s1.json'), '', 'utf8') // 0 字节
    writeFileSync(join(dir, 'customer-s1.json'), '{ not json', 'utf8') // 坏 JSON
    const r = cli([], dir)
    expect(r.status, '文件在、内容空时返回 0 = 把"扫到 0 个对象"读成"扫过且清白"').toBe(2)
    expect(r.stdout + r.stderr).toMatch(/没有对象就不记绿/)
    expect(r.stdout + r.stderr, '必须说清是"文件在但内容空"而不是"没有文件"').toMatch(/没有一件能解析出内容/)
  })
})

describe('判据可见性：隔离后的 GREEN 不许是沉默的 GREEN', () => {
  it('隔离后 report:live-perf 必须自带隔离读数（否则 GREEN 会被读成"全采到了"）', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'admin-s1.json'), sample(false), 'utf8')
    writeFileSync(join(dir, 'customer-d2-s1.json'), sample(true), 'utf8')
    // 名册只要 admin 一页；customer 那页没有完整批次组，但隔离读数这行不受它影响
    const roster = join(dir, 'roster.json')
    writeFileSync(roster, JSON.stringify({
      pages: [{ tag: 'admin', url: 'https://supermarket-web.pages.dev/', expectUrlIncludes: 'supermarket-web.pages.dev', minSamples: 1 }],
      thresholds: { 'first-contentful-paint': { max: 3000 } },
      cadence: { maxBatchAgeDays: 7 },
    }), 'utf8')

    const rep = (extra) => assertCliRan(spawnSync(process.execPath, [REPORT, '--dir', dir, '--roster', roster, ...extra], {
      cwd: REPO, encoding: 'utf8', timeout: 120_000,
    }), { label: 'report-live-perf 隔离可见性' })

    // 先隔离，再读判据：那行必须点名"已隔离 1 件"
    expect(cli([], dir).status).toBe(0)
    const after = rep([])
    const line = after.stdout.split('\n').find((l) => l.includes('[report:live-perf]')) || ''
    expect(line, '隔离后判据那行必须印隔离读数').toMatch(/已隔离 1 件/)
    expect(line, '隔离读数必须说清"不等于全部采到"').toMatch(/不等于.*采到|为零不等于/)
    expect(line, '总恒等式必须仍然闭合').toMatch(/总恒等式 ✓/)
  })
})