// 第四十三轮夹具②：**"这判据会不会改写产物"由跑一遍来判**（S1~S5）+ 文档对账判据的字节尺。
// 一手实测（本机 @2026-09-28）：候选 9 件、静态推不出 3 件；跑出来的改写面 3 个产物，其中
// `check-d1-roundtrips.mjs --update-write-quota` 改写 `docs/d1-write-quota.json` —— 而静态推导对它
// 是**零风险**（目标常量是 import 进来的）。这就是本件存在的全部理由。
// 另两条一手：① `verify-backend --update` rc=0 且 sha 零差异（幂等生成器）⇒ 只比 sha 会把它误判成"不写"；
// ② 裸快照里 `check-d1-roundtrips` 因取不到 `node_modules/@babel/parser` 直接 rc=2 ⇒ 探针自己跑不动不得读成"没写"。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluate, verdictOf, diffHashes, treeHashes, enumerateCandidates, riskFaceHasWrites,
  stableText, TS_SENTINEL,
} from '../scripts/check-judge-side-effects.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const SCRIPT = join('scripts', 'check-judge-side-effects.mjs')
const DIR = mkdtempSync(join(tmpdir(), 'jsfx-'))
const state = (rows, id) => rows.find((r) => r.id === id)
const f = (name, obj) => { const p = join(DIR, name); writeFileSync(p, JSON.stringify(obj), 'utf8'); return p }

const CAND = [
  { file: 'check-d1-roundtrips.mjs', staticResolved: 0, staticUnbound: 1, blind: true, writeFlags: ['--update-write-quota'] },
  { file: 'verify-backend.mjs', staticResolved: 1, staticUnbound: 3, blind: false, writeFlags: ['--update'] },
  { file: 'gen-api-doc.mjs', staticResolved: 1, staticUnbound: 0, blind: false, writeFlags: [] },
]
const ok = (path, identical = false) => ({ path, identical })
const RES = [
  { file: 'check-d1-roundtrips.mjs', defaultRun: { rc: 0, changed: [], touched: [] }, writeRun: { rc: 0, flag: '--update-write-quota', changed: [{ path: 'docs/d1-write-quota.json' }], touched: [ok('docs/d1-write-quota.json')],
      idempotency: { rc: 0, drift: [], comparable: 1 } } },
  { file: 'verify-backend.mjs', defaultRun: { rc: 0, changed: [], touched: [] }, writeRun: { rc: 0, flag: '--update', changed: [], touched: [ok('docs/sql-baseline.json', true)],
      idempotency: { rc: 0, drift: [], comparable: 1 } } },
  { file: 'gen-api-doc.mjs', defaultRun: { rc: 0, changed: [{ path: 'docs/API.md' }], touched: [ok('docs/API.md')] }, writeRun: null, skippedWrite: true },
]
// 登记册夹具：人填的例外一律带可证伪理由（数字或反引号命令），否则 named() 会当它不存在
const REG = {
  observed_utc: new Date().toISOString(), // S6 判证据新鲜度；过期形状另有专门用例
  entries: [
    { file: 'scripts/check-d1-roundtrips.mjs', writes: ['docs/d1-write-quota.json'] },
    { file: 'scripts/verify-backend.mjs', writes: ['docs/sql-baseline.json'] },
  ],
  generators: [{ file: 'scripts/gen-api-doc.mjs', reason: '默认 args 即重写 docs/API.md：实测 31 个 action 全部由本脚本生成，`node scripts/gen-api-doc.mjs` 是唯一通道' }],
  unprobeable: [],
  conditional_writers: [{ file: 'scripts/verify-backend.mjs', reason: '只在 --update 时改基准：默认 args 实测 rc=0 且零改动，属条件性写入' }],
  allow_stale: [],
}
// 风险表面夹具：check-d1-roundtrips 那一行就是"S5 自愈"的凭据，摘掉它同一份回执必须翻红
const MERGED_MD = '## 风险分类\n\n| 脚本 | 风险特征 | 依据 |\n| --- | --- | --- |\n'
  + '| verify-backend.mjs | sql-delete, writes-artifacts | 登记册 |\n'
  + '| check-d1-roundtrips.mjs | writes-artifacts | 第四十三轮实测并入 |\n'
  + '| gen-api-doc.mjs | writes-artifacts | 生成器通道 |\n'

describe('正例与分母', () => {
  it('全绿正例：静态漏登件一旦并进风险表 ⇒ S1~S5 齐绿、rc=0（本件可自愈，不是永红闸）', () => {
    const { rows, counts } = evaluate({ candidates: CAND, results: RES, registry: REG, entryMd: MERGED_MD })
    const bad = rows.filter((r) => r.ok !== true).map((r) => `${r.id}(${r.detail})`)
    expect(bad).toEqual([])
    expect(verdictOf(rows)).toEqual({ verdict: 'GREEN', rc: 0 })
    expect(counts).toEqual({ candidates: 3, blind: 1, receipts: 3, observedWrites: 2 })
  })

  it('分母由枚举得出：含 writeFileSync 的才进候选，盲件与写开关各自现算', () => {
    const sources = [
      { file: 'keeper.mjs', src: "const OUT = 'docs/keeper.json'\nwriteFileSync(OUT, '{}')" },
      { file: 'blind.mjs', src: "import { P } from './lib/p.mjs'\nwriteFileSync(P, '{}')" },
      { file: 'flagged.mjs', src: "const Q = 'docs/q.json'\nif (a === '--update-write-quota') writeFileSync(Q)" },
      { file: 'quiet.mjs', src: 'console.log(1)' },
    ]
    const c = enumerateCandidates(sources)
    expect(c.map((x) => x.file)).toEqual(['blind.mjs', 'flagged.mjs', 'keeper.mjs'])
    const byName = Object.fromEntries(c.map((x) => [x.file, x]))
    expect(byName['keeper.mjs'].blind).toBe(false)
    expect(byName['blind.mjs'].blind).toBe(true) // 目标 import 进来 ⇒ 静态解不出 ⇒ 必须靠跑
    expect(byName['flagged.mjs'].writeFlags).toEqual(['--update-write-quota'])
    // 反向腿：收紧取词不许把真通道一起收掉（否则"整词匹配"只是另一条静默漏报）
    const both = enumerateCandidates([
      { file: 'two.mjs', src: "const Q = 'docs/q.json'\nif (x === '--update') writeFileSync(Q)" },
    ])
    expect(both[0].writeFlags).toEqual(['--update'])
  })

  it('本件不测自己（否则会在临时树里再 archive 一次，属递归）', () => {
    const c = enumerateCandidates([{ file: 'check-judge-side-effects.mjs', src: 'writeFileSync(x)' }, { file: 'other.mjs', src: 'writeFileSync(y)' }])
    expect(c.map((x) => x.file)).toEqual(['other.mjs'])
  })
})

describe('副作用实测腿 · 每条红都必须可归因', () => {
  it('漏登还没并进风险表 ⇒ S5 红并点名（本件存在的理由）', () => {
    const { rows } = evaluate({ candidates: CAND, results: RES, registry: REG, entryMd: '## 风险分类（表）\n\n| 脚本 | 风险特征 |\n| verify-backend.mjs | sql-delete, writes-artifacts |\n' })
    expect(state(rows, 'S5').ok).toBe(false)
    expect(state(rows, 'S5').detail).toMatch(/静态漏登且尚未并入风险表[^|]*check-d1-roundtrips\.mjs/)
    expect(verdictOf(rows).rc).toBe(1)
  })

  it('默认 args 改写产物但没声明生成器 ⇒ S2 红；补具名理由即绿（门禁形状不许拒真话）', () => {
    const noGen = { ...REG, generators: [] }
    const { rows } = evaluate({ candidates: CAND, results: RES, registry: noGen, entryMd: '| check-d1-roundtrips.mjs | writes-artifacts |\n## 风险分类' })
    expect(state(rows, 'S2').ok).toBe(false)
    expect(state(rows, 'S2').detail).toContain('gen-api-doc.mjs')
    const green = evaluate({ candidates: CAND, results: RES, registry: REG, entryMd: MERGED_MD })
    expect(state(green.rows, 'S2').ok).toBe(true)
  })

  it('跑出来的产物没登记 ⇒ S3 双向都红：漏登与幽灵各点名一次', () => {
    const leak = { ...REG, entries: [{ file: 'scripts/verify-backend.mjs', writes: ['docs/sql-baseline.json'] }, { file: 'scripts/stale.mjs', writes: ['docs/never-touched.json'] }] }
    const { rows } = evaluate({ candidates: CAND, results: RES, registry: leak, entryMd: MERGED_MD })
    expect(state(rows, 'S3').ok).toBe(false)
    expect(state(rows, 'S3').detail).toContain('漏登: docs/d1-write-quota.json')
    expect(state(rows, 'S3').detail).toContain('幽灵: docs/never-touched.json')
  })

  it('取不到读数又没有在册理由 ⇒ S4 红且 verdict=UNVERIFIED（rc=2，不折算成"没改写"）', () => {
    const blindRun = [{ file: 'check-d1-roundtrips.mjs', unverified: 'tar rc=2 环境没有 tar', defaultRun: null, writeRun: null }]
    const { rows } = evaluate({ candidates: [CAND[0]], results: blindRun, registry: { entries: [], generators: [], unprobeable: [], conditional_writers: [] }, entryMd: '' })
    expect(state(rows, 'S1').detail).toContain('回执=未验证')
    expect(state(rows, 'S1').ok).toBe(false)
    expect(state(rows, 'S4').ok).toBe(false)
    expect(verdictOf(rows)).toEqual({ verdict: 'UNVERIFIED', rc: 2 })
  })

  it('「没敲那扇门」不许冒充「登记说谎」：生产者未触达 ⇒ 它的产物不计幽灵（CI 无 CF 凭据那一类）', () => {
    const cand = [{ file: 'usage.mjs', staticResolved: 1, staticUnbound: 0, blind: false, writeFlags: ['--write'] }]
    const reg = { entries: [{ file: 'scripts/usage.mjs', writes: ['docs/usage.json'] }], generators: [], unprobeable: [], conditional_writers: [] }
    // 侧 1：写通道跑了但 rc≠0（本机没有凭据）⇒ 未复核，不指控
    const notReached = [{ file: 'usage.mjs', defaultRun: { rc: 0, changed: [], touched: [] }, writeRun: { rc: 1, flag: '--write', changed: [], touched: [] } }]
    const a = evaluate({ candidates: cand, results: notReached, registry: reg, entryMd: MERGED_MD })
    expect(state(a.rows, 'S3').ok).toBe(true)
    expect(state(a.rows, 'S3').detail).toContain('生产者本轮未触达、不计幽灵 1 个')
    // 侧 2：门敲开了、里面是空的 ⇒ 这才是幽灵
    const reached = [{ file: 'usage.mjs', defaultRun: { rc: 0, changed: [], touched: [] }, writeRun: { rc: 0, flag: '--write', changed: [], touched: [] } }]
    const b = evaluate({ candidates: cand, results: reached, registry: reg, entryMd: MERGED_MD })
    expect(state(b.rows, 'S3').ok).toBe(false)
    expect(state(b.rows, 'S3').detail).toContain('幽灵: docs/usage.json')
    // 侧 3（--blind-only 的取数面）：这一件干脆没进本轮 results ⇒ 与"没敲开门"同判，不得凭空多一条幽灵
    const shrunk = evaluate({ candidates: cand, results: [], registry: reg, entryMd: MERGED_MD })
    // 只禁"指控式"的那一形（；幽灵: 路径）——"不计幽灵 N 个"是同一句话的免责声明，不是缺陷
    expect(state(shrunk.rows, 'S3').detail).not.toMatch(/幽灵: /)
    expect(state(shrunk.rows, 'S3').detail).toContain('不计幽灵 1 个')
    // 同一份缩面读数下 S5 也不许指控：本轮实测 --blind-only 一度造出 5 条假幽灵
    expect(state(shrunk.rows, 'S5').ok).toBe(true)
    expect(state(shrunk.rows, 'S5').detail).toContain('写通道未触达 1 件')
  })

  it('零候选 ⇒ S1 红（零输入不得 PASS，不是"没有副作用很安全"）', () => {
    const { rows } = evaluate({ candidates: [], results: [], registry: { entries: [] }, entryMd: '' })
    expect(state(rows, 'S1').ok).toBe(false)
  })

  it('「没测到」不许冒充「静态幽灵」（第四十四轮真跑抓到 S5 指控新增件）', () => {
    // 同一件、同一个"静态说有写通道"，唯一差别是有没有取到读数 ⇒ 结论必须相反
    const cand = [{ file: 'new-gate.mjs', staticResolved: 2, staticUnbound: 0, blind: false, writeFlags: ['--update'] }]
    const neverRan = [{ file: 'new-gate.mjs', unverified: 'HEAD 快照里没有这个文件', defaultRun: null, writeRun: null }]
    const clean = [{ file: 'new-gate.mjs', defaultRun: { rc: 0, changed: [], touched: [] }, writeRun: { rc: 0, flag: '--update', changed: [], touched: [] } }]
    const reg = { entries: [], generators: [], unprobeable: [], conditional_writers: [] }
    const a = evaluate({ candidates: cand, results: neverRan, registry: reg, entryMd: MERGED_MD })
    expect(state(a.rows, 'S5').ok).toBe(true)
    expect(state(a.rows, 'S5').detail).not.toMatch(/静态幽灵/)
    const b = evaluate({ candidates: cand, results: clean, registry: reg, entryMd: MERGED_MD })
    expect(state(b.rows, 'S5').ok).toBe(false)
    expect(state(b.rows, 'S5').detail).toMatch(/静态幽灵[^|]*new-gate\.mjs/)
  })
})

describe('证据新鲜度（S6）——"在册"不等于"仍成立"', () => {
  const base = { entries: REG.entries, generators: REG.generators, unprobeable: [], conditional_writers: REG.conditional_writers }
  const DAY = 86400000

  it('读数在期限内 ⇒ S6 绿，并把年龄与阈值都印出来', () => {
    const reg = { ...base, observed_utc: new Date(Date.now() - 2 * DAY).toISOString() }
    const { rows } = evaluate({ candidates: CAND, results: RES, registry: reg, entryMd: MERGED_MD, now: Date.now(), maxAgeDays: 14 })
    expect(state(rows, 'S6').ok).toBe(true)
    expect(state(rows, 'S6').detail).toContain('读数距今 2.0 天')
    expect(verdictOf(rows).rc).toBe(0)
  })

  it('读数过期 ⇒ S6 红且判 UNVERIFIED（rc=2）——过期是证据失效，不是"标签错了"，更不是"通过"', () => {
    const reg = { ...base, observed_utc: new Date(Date.now() - 40 * DAY).toISOString() }
    const { rows } = evaluate({ candidates: CAND, results: RES, registry: reg, entryMd: MERGED_MD, now: Date.now(), maxAgeDays: 14 })
    expect(state(rows, 'S6').ok).toBe(false)
    expect(state(rows, 'S6').detail).toContain('证据已过期')
    expect(verdictOf(rows)).toEqual({ verdict: 'UNVERIFIED', rc: 2 })
  })

  it('册上没有时刻 ⇒ 同判过期（零证据不许折算成"仍成立"）', () => {
    const { rows } = evaluate({ candidates: CAND, results: RES, registry: base, entryMd: MERGED_MD, now: Date.now(), maxAgeDays: 14 })
    expect(state(rows, 'S6').ok).toBe(false)
    expect(state(rows, 'S6').detail).toContain('无法判新鲜度')
  })

  it('期限可由调用方覆写（禁把 14 天写成不可改的常量；非法值当场 rc=2 而不是静默退回默认）', () => {
    const reg = { ...base, observed_utc: new Date(Date.now() - 40 * DAY).toISOString() }
    expect(state(evaluate({ candidates: CAND, results: RES, registry: reg, entryMd: MERGED_MD, now: Date.now(), maxAgeDays: 60 }).rows, 'S6').ok).toBe(true)
    const bad = spawnSync(process.execPath, [SCRIPT, '--max-age-days', 'abc'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
    expect(bad.status, `${bad.stdout}${bad.stderr}`.slice(-400)).toBe(2)
    expect(`${bad.stderr}`).toContain('需要一个非负数字')
  })

  it('缩面档拒绝 --update（用偏样重写全量册 + 刷新时刻 = 冒充刚核过）', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--blind-only', '--update'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
    expect(r.status, `${r.stdout}${r.stderr}`.slice(-400)).toBe(2)
    expect(`${r.stderr}`).toContain('缩面')
  })

  it('真面自证：仓里现存那份册必须在期限内（这条红就说明上一轮根本没重跑探针）', () => {
    const reg = JSON.parse(readFileSync(join(ROOT, 'docs', 'judge-side-effects.json'), 'utf8'))
    const { rows } = evaluate({ candidates: [], results: [], registry: reg, entryMd: '', now: Date.now(), maxAgeDays: 14 })
    expect(state(rows, 'S6').ok, state(rows, 'S6').detail).toBe(true)
  })
})

describe('两把字节尺（幂等生成器的形状）', () => {
  const mk = (sha, mt) => ({ sha, mt })
  it('同字节但 mtime 变 ⇒ touched 有、changed 无（这就是 verify-backend 那一类）', () => {
    const d = diffHashes({ 'a.json': mk('same', 1) }, { 'a.json': mk('same', 2) })
    expect(d.changed).toEqual([])
    expect(d.touched).toEqual([{ path: 'a.json', identical: true }])
  })
  it('内容变 ⇒ 两把尺同时有；文件新增/消失也进 touched（不许静默）', () => {
    const d = diffHashes({ 'a.json': mk('x', 1), 'gone.json': mk('g', 1) }, { 'a.json': mk('y', 2) })
    expect(d.changed.map((c) => c.path)).toEqual(['a.json', 'gone.json'])
    expect(d.touched.length).toBe(2)
    const add = diffHashes({ 'a.json': mk('x', 1) }, { 'a.json': mk('x', 1), 'new.json': mk('n', 5) })
    expect(add.changed[0]).toMatchObject({ path: 'new.json', from: '(新增)' })
  })
  it('treeHashes 读得到真盘（双读数齐备，且跳过 .git）', () => {
    const h = treeHashes(join(ROOT, 'docs'))
    const keys = Object.keys(h)
    expect(keys.length).toBeGreaterThan(5)
    expect(keys.some((k) => k.includes('.git'))).toBe(false)
    expect(h[keys[0]]).toHaveProperty('sha')
    expect(Number.isFinite(h[keys[0]].mt)).toBe(true)
  })
  it('node_modules 不得进差集面（第四十六轮分相归因：一次读数 12,299ms / 10,933 个文件，其中 10,225 个来自注入的依赖 junction）', () => {
    const t = mkdtempSync(join(tmpdir(), 'jsfx-tree-'))
    mkdirSync(join(t, 'node_modules', 'x'), { recursive: true })
    mkdirSync(join(t, 'docs'), { recursive: true })
    writeFileSync(join(t, 'node_modules', 'x', 'index.js'), 'module.exports=1')
    writeFileSync(join(t, 'docs', 'a.json'), '{}')
    const keys = Object.keys(treeHashes(t))
    expect(keys).toEqual(['docs/a.json'])
    expect(keys.some((k) => k.startsWith('node_modules'))).toBe(false)
  })
  it('跳过依赖面不许把真产物一起跳掉：同树里 docs 与根文件都必须在读数里', () => {
    const t = mkdtempSync(join(tmpdir(), 'jsfx-tree2-'))
    mkdirSync(join(t, 'node_modules'), { recursive: true })
    writeFileSync(join(t, 'node_modules', 'junk.js'), 'x')
    writeFileSync(join(t, 'README.md'), '# hi')
    writeFileSync(join(t, 'docs.md'), '# hi')
    expect(Object.keys(treeHashes(t)).sort()).toEqual(['README.md', 'docs.md'])
  })
  it('riskFaceHasWrites 只在「风险分类」节内找（别的表里的同名行不许喂绿）', () => {
    const md = '## 已知缺口\n\n| verify-x.mjs | 这行写 writes-artifacts 也不算 |\n\n## 风险分类\n\n| verify-y.mjs | writes-artifacts | 实测 |\n'
    expect(riskFaceHasWrites(md, 'verify-y.mjs')).toBe(true)
    expect(riskFaceHasWrites(md, 'verify-x.mjs')).toBe(false)
    expect(riskFaceHasWrites('', 'verify-y.mjs')).toBe(false)
  })
})

describe('入口通道真跑（--fixture / --inject-red / 缺输入面）', () => {
  const cli = (args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
    return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
  }
  it('喂全绿合成回执 ⇒ rc=0 且门面行印回执数与改写面', () => {
    const p = f('green.json', { candidates: CAND, results: RES, registry: REG, entryMd: MERGED_MD })
    const { rc, out } = cli(['--fixture', p])
    expect(rc, out.slice(-700)).toBe(0)
    expect(out).toContain('GATE-PASS judge-side-effects')
    expect(out).toContain('实测改写面 2 个')
  })
  it('--inject-red 演习 ⇒ rc=1，注入件必须被 S5 点名', () => {
    const p = f('inj.json', { candidates: [CAND[1]], results: [RES[1]], registry: REG, entryMd: MERGED_MD })
    const { rc, out } = cli(['--fixture', p, '--inject-red'])
    expect(rc, out.slice(-700)).toBe(1)
    expect(out).toContain('INJECTED-writer.mjs')
  })
  it('零候选的合成面 ⇒ S1 红且 rc 绝不记 0（"没有副作用"必须由读数说话，不是由空面说话）', () => {
    const p = f('empty.json', { candidates: [], results: [], registry: { entries: [], observed_utc: new Date().toISOString() } })
    const { rc, out } = cli(['--fixture', p])
    // 相位说明：第五十轮加了 S7 之后，空面同时是"判出违规"（S1）与"双跑没有对象"（S7 未验证），
    // 而 `verdictOf` 的既有口径是 **2 优先于 1**（混合时不得读成"判出违规"）。
    // 所以这里断言"非 0 + 两条各自点名"，不把 rc 写死成 1 —— 写死等于把相位变化伪装成回归。
    expect(rc, out.slice(-500)).not.toBe(0)
    expect([1, 2]).toContain(rc)
    expect(out).toContain('FAIL S1')
    expect(out).toContain('UNVERIFIED S7')
    expect(out).toContain('候选 0 件')
  })
})

/**
 * S7（第五十轮 R50-H2①）：同一写开关连跑两趟 ⇒ 产物字节必须收敛。
 * 一手动因：上一轮 `check-doc-commands --update` 三跑三个 sha（README 生成块每次多一个空行），
 * 是本轮机翻输出时人肉发现的 —— 本件比过"默认 args vs 写盘 args"，从没比过"写盘 vs 写盘"。
 * 归一化只折 ISO 观测时刻（`observed_utc` 这类字段天生每次都不同，按裸字节比 = 自造一条永红假漂移，
 * 教训 L-2 同族）；空行/缩进/顺序一律**不**归一，那才是真缺陷形态。
 */
describe('S7 写侧幂等：双跑收敛判定 + 归一化的两侧', () => {
  const w = (extra = {}) => [{
    file: 'check-d1-roundtrips.mjs', defaultRun: { rc: 0, changed: [], touched: [] },
    writeRun: { rc: 0, flag: '--update-write-quota', changed: [{ path: 'docs/d1-write-quota.json' }],
      touched: [ok('docs/d1-write-quota.json')], idempotency: { rc: 0, drift: [], comparable: 1 }, ...extra },
  }]
  const s7 = (results) => evaluate({ candidates: CAND, results, registry: REG, entryMd: MERGED_MD }).rows.find((r) => r.id === 'S7')

  it('反例：第二趟后归一面仍不等 ⇒ S7 判红并点名"哪个脚本改了哪个产物"', () => {
    const r = s7(w({ idempotency: { rc: 0, drift: ['docs/d1-write-quota.json'], comparable: 1 } }))
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('check-d1-roundtrips.mjs → docs/d1-write-quota.json')
    expect(r.detail).toContain('第二趟会继续改产物')
    expect(verdictOf([...evaluate({ candidates: CAND, results: w({ idempotency: { rc: 0, drift: ['x'] }, }), registry: REG, entryMd: MERGED_MD }).rows, r]).rc).toBe(1)
  })

  it('正例：双跑全部收敛 ⇒ S7 绿，且读数里印出"双跑几件 / 几件没对象"（不是一句"通过"）', () => {
    const r = s7(RES)
    expect(r.ok).toBe(true)
    expect(r.detail).toMatch(/双跑 \d+ 件/)
    expect(r.detail).toContain('全部收敛')
  })

  it('没有对象：写通道一次都没碰产物 ⇒ 记 UNVERIFIED 而不是"幂等已证"', () => {
    const none = [{ file: 'usage.mjs', defaultRun: { rc: 0, changed: [], touched: [] },
      writeRun: { rc: 0, flag: '--write', changed: [], touched: [] } }]
    const rows = evaluate({ candidates: [{ file: 'usage.mjs', staticResolved: 1, staticUnbound: 0, blind: false, writeFlags: ['--write'] }],
      results: none, registry: { entries: [], observed_utc: new Date().toISOString() }, entryMd: '' }).rows
    const r = rows.find((x) => x.id === 'S7')
    expect(r.ok).toBe(false)
    expect(r.unverified).toBe(true)
    expect(r.detail).toContain('没有对象')
    expect(verdictOf(rows).rc, '证据失效必须是 2 相位，不得与"判出违规"的 1 混写').toBe(2)
  })

  it('真入口回执：全量面跑出来的登记册里必须带着双跑读数（S7 的证据落在册上，不只在 stdout）', () => {
    const reg = JSON.parse(readFileSync(join(ROOT, 'docs', 'judge-side-effects.json'), 'utf8'))
    const double = reg.entries.filter((e) => e.double_ran)
    expect(double.length, '册上没有任何一件 double_ran ⇒ --update 那一步没重跑，S7 只是本机一次性输出').toBeGreaterThan(0)
    expect(double.every((e) => Array.isArray(e.idempotent_drift) && e.idempotent_drift.length === 0),
      `漂移件：${double.filter((e) => (e.idempotent_drift || []).length).map((e) => e.file).join(', ')}`).toBe(true)
    // as-of 口径：册上的时刻只证明"那次跑过"，不承诺现值（同 D 系判据的 note 措辞）。
    expect(Date.parse(reg.observed_utc) / 1000).toBeLessThan(Date.now() / 1000 + 60)
  })

  it('归一化两侧：只差一个 ISO 时刻 ⇒ 相等；多一个空行 ⇒ 不等（少一侧都算没验证）', () => {
    const a = Buffer.from('{"observed_utc":"2026-09-28T07:50:30.755Z","counts":{"mentions":202}}', 'utf8')
    const b = Buffer.from('{"observed_utc":"2026-09-28T09:12:01.004Z","counts":{"mentions":202}}', 'utf8')
    const c = Buffer.from('{"observed_utc":"2026-09-28T07:50:30.755Z","counts":{"mentions":202}}\n\n', 'utf8')
    expect(stableText(a)).toBe(stableText(b))
    expect(stableText(a)).not.toBe(stableText(c))
    expect(stableText(a)).toContain(TS_SENTINEL)
    expect(stableText(null), '文件在第二趟被删掉也是漂移的一种，不得与"没变"同形').toBe('(缺席)')
  })
})
