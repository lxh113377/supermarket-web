import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SELF = join('scripts', 'report-live-perf.mjs')
const SAMPLES = join(REPO, '.lighthouse')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lhper-')); tmpDirs.push(d); return d }

const cli = (args, cwd = REPO) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
  cwd, encoding: 'utf8', timeout: 120_000,
}), { label: `live-perf ${args.join(' ')}` })

const lh = (over = {}) => JSON.stringify({
  finalDisplayedUrl: 'https://supermarket-web.pages.dev/',
  fetchTime: '2026-09-29T06:49:23.204Z',
  configSettings: { formFactor: 'mobile' },
  audits: {
    'first-contentful-paint': { numericValue: 1500 },
    'largest-contentful-paint': { numericValue: 1900 },
    'cumulative-layout-shift': { numericValue: 0 },
    'total-blocking-time': { numericValue: 200 },
    'speed-index': { numericValue: 4500 },
    'server-response-time': { numericValue: 230 },
  },
  ...over,
})
const roster = (pages) => JSON.stringify({ pages })

/**
 * 第五十五轮 R55-H1 立腿，第五十六轮 R56-H1 加「批次」与「立线条件」两层。
 *
 * 本文件钉的是**判据自己**，不是线上快不快：
 * ① 合成面驱动每条腿（缺 FCP / runtimeError / 样本不足 / 混视口 / 野标签 / 下界为 0）；
 * ② 真面两态都必须"说真话"：本机有样本 ⇒ 印分布；CI 干净检出没有 `.lighthouse/` ⇒ **必须 rc=2**
 *    而不是印一句"没数据"就走绿。断言按磁盘实况选期望档，两档都不许落进"沉默的 0"。
 * ③ 这一维**没有阈值**（docs/live-perf.json 的 `thresholds: null`），所以本文件也断言它没有：
 *    判据不许输出「达标/不达标」字样——那是把没立过的线当成测量结果。
 * ④ R56 新增的两条都必须**成对**测：「同日两批不许当跨日」与「把日期挪开就得翻成条件成立」。
 *    只测拒侧的判据会让"立线"这件事对唯一受众永久不可达而全绿（户内「判据要双向」）。
 */
describe('现网性能读数腿：按 页面×批次 分组，判产物面与立线条件，不判达标线', () => {
  it('判据自证 21/21（含零输入两档、三态分列、立线条件成对、时效成对）', () => {
    const r = cli(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('[report:live-perf] 自证 21/21')
  })

  it('合成面：两份齐全样本 ⇒ GREEN 且把 4.5× 这种倍差印出来（单样本会把它藏掉）', () => {
    const d = tmp()
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh({ audits: { ...JSON.parse(lh()).audits, 'speed-index': { numericValue: 20000 } } }), 'utf8')
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 2 }]), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('倍差 4.44×')
    expect(r.stdout).toContain('单样本不足以定基线')
  })

  it('合成面：样本声称是 run 却缺 first-contentful-paint ⇒ 判红点名（缺件 ≠ 该指标为 0）', () => {
    const d = tmp()
    const bad = JSON.parse(lh()); delete bad.audits['first-contentful-paint']
    writeFileSync(join(d, 'admin-s1.json'), JSON.stringify(bad), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh(), 'utf8')
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 1 }]), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toContain('缺 `first-contentful-paint`')
  })

  it('合成面：runtimeError 的那次采样不得折进基线', () => {
    const d = tmp()
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh({ runtimeError: { code: 'NETWORK_ERROR' } }), 'utf8')
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 1 }]), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toContain('runtimeError=NETWORK_ERROR')
    expect(r.stdout).toContain('入统计 1／未采到 0／产物不符 1／文件 2（恒等式 ✓）')
  })

  it('零输入：样本目录不存在 ⇒ rc=2 并给取证路径，绝不印"现网很快"', () => {
    const r = cli(['--dir', join(tmp(), 'nope'), '--roster', join(REPO, 'docs', 'live-perf.json')])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('本轮**没测**')
    expect(r.stdout).toContain('取证命令')
  })

  it('零输入：名册读不到 ⇒ rc=2（没有"该量哪些页"的依据就不下结论）', () => {
    const r = cli(['--dir', SAMPLES, '--roster', join(tmp(), 'none.json')])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('名册读不到')
  })

  it('没有阈值就不许谈达标：判据输出内不得出现「达标」判定字样', () => {
    const d = tmp()
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh(), 'utf8')
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 2 }]), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.status, r.stdout).toBe(0)
    expect(r.stdout).not.toMatch(/达标[：:]=?(通过|合格|OK)/)
    expect(r.stdout).toContain('达标线=未立')
    // 名册与被测样本同目录时不得被当成"野标签样本"（本件夹具第一次真跑就在这里被判红过）：
    // 按命名式跳过 **且点名**，两者缺一都会让下一轮多放进去一个 json 时静默少算
    expect(r.stdout).toContain('不是样本命名')
    expect(r.stdout).toContain('roster.json')
  })

  it('真面两态各说各话：有样本印分布，没样本判 UNVERIFIED（期望档由磁盘现推，不写死）', () => {
    const present = existsSync(SAMPLES)
    const r = cli([])
    const line = String(r.stdout).split('\n').find((l) => l.startsWith('[report:live-perf]'))
    expect(line, '门面行缺失').toBeTruthy()
    if (present) {
      expect([0, 1]).toContain(r.status)
      expect(r.stdout).toContain(r.status ? 'verdict=RED' : 'verdict=GREEN')
      // 门面恒等式（入统计 + 未采到 + 产物不符 === 样本文件数）必须自己说 ✓：
      // 本轮第一版这里算出过「产物不符 -3」——整批被剔的组没进 groups，门面就回推出一个物理上不可能的数。
      expect(r.stdout).toContain('恒等式 ✓')
    } else {
      expect(r.status, 'CI 干净检出没有样本面 ⇒ 必须是 rc=2，不得是 0').toBe(2)
      expect(r.stdout).toContain('UNVERIFIED')
    }
  })

  it('R56 批次分组：同一页的两批各算各的分布，混批算中位数这条路走不通', () => {
    const d = tmp()
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 2 }]), 'utf8')
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-d2-s1.json'), lh({ fetchTime: '2026-09-29T09:55:34.216Z' }), 'utf8')
    writeFileSync(join(d, 'admin-d2-s2.json'), lh({ fetchTime: '2026-09-29T09:57:08.049Z' }), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GROUP admin/base')
    expect(r.stdout).toContain('GROUP admin/d2')
  })

  it('R56 立线条件（拒侧）：同日两批不得当跨日 —— 必须具名印出实测天数差 0', () => {
    const d = tmp()
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 2 }]), 'utf8')
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-d2-s1.json'), lh({ fetchTime: '2026-09-29T09:55:34.216Z', audits: { ...JSON.parse(lh()).audits, 'first-contentful-paint': { numericValue: 1900 } } }), 'utf8')
    writeFileSync(join(d, 'admin-d2-s2.json'), lh({ fetchTime: '2026-09-29T09:57:08.049Z', audits: { ...JSON.parse(lh()).audits, 'first-contentful-paint': { numericValue: 1930 } } }), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.stdout).toContain('条件不成立')
    expect(r.stdout).toContain('差 0 天')
    expect(r.stdout).not.toContain('可以把 budget 写进名册')
  })

  it('R56 立线条件（允侧，与上一条成对）：把第二批日期挪到次日 ⇒ 同一条腿必须翻成"条件成立"并给出两侧中位数差', () => {
    const d = tmp()
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 2 }]), 'utf8')
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-s2.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-d2-s1.json'), lh({ fetchTime: '2026-09-30T09:55:34.216Z', audits: { ...JSON.parse(lh()).audits, 'first-contentful-paint': { numericValue: 1900 } } }), 'utf8')
    writeFileSync(join(d, 'admin-d2-s2.json'), lh({ fetchTime: '2026-09-30T09:57:08.049Z', audits: { ...JSON.parse(lh()).audits, 'first-contentful-paint': { numericValue: 1930 } } }), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.stdout).toContain('条件成立')
    expect(r.stdout).toContain('差 1 天')
    expect(r.stdout).toContain('可以把 budget 写进名册')
    expect(r.stdout).toContain('first-contentful-paint')
  })

  it('R56 三态分列：网络类 NO_FCP + about:blank 归"未采到"，不得与"采到且慢"共用一个数', () => {
    const d = tmp()
    const rp = join(d, 'roster.json')
    writeFileSync(rp, roster([{ tag: 'admin', expectUrlIncludes: 'pages.dev', minSamples: 1 }]), 'utf8')
    writeFileSync(join(d, 'admin-s1.json'), lh(), 'utf8')
    writeFileSync(join(d, 'admin-d2-s1.json'), lh({ runtimeError: { code: 'NO_FCP' }, finalDisplayedUrl: 'about:blank' }), 'utf8')
    const r = cli(['--dir', d, '--roster', rp])
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toContain('**这一批没采到**')
    expect(r.stdout).toContain('未采到 1')
    // 整批全没采到时，那一组仍要出现在输出里（洗掉它等于把盲区读成"没这一批"）
    expect(r.stdout).toContain('GROUP admin/d2')
  })

  it('名册与判据同向：thresholds 仍是 null 且 cadence 已声明（有人偷偷写线要在这里现形）', () => {
    const rosterReal = JSON.parse(readFileSync(join(REPO, 'docs', 'live-perf.json'), 'utf8'))
    expect(rosterReal.thresholds, '本轮仍未取得两侧边界分布 ⇒ 名册里不得出现阈值').toBeNull()
    expect(Number(rosterReal.cadence?.maxBatchAgeDays), '取数节奏没声明 ⇒ 时效腿永不可达').toBeGreaterThan(0)
    expect(rosterReal.sampling.command).toBe('npm run collect:live-perf')
    const r = cli(['--selftest'])
    expect(r.stdout).toContain('[report:live-perf] 自证 21/21')
  })
})
