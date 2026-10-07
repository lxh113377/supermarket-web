// 第七十一轮夹具：本地 ⇄ 远端的分歧与通道普查（report 档，但每条出口都有反例腿）。
// 一手起因：本轮开工时 `github.com` 整条不通（代理拒连 + 直连 000），而 `api.github.com` 通 ——
// 全仓没有一处能把"哪条通道还活着 + 本地压着几笔没推"取成机器可读的数，于是上一轮那句
// 「写完了 ≠ 上线了」中间的那一跳仍然只存在于散文里。本件把它变成读数。
// 三条判据全部吃注入数据（judge 是纯函数、collect 吃 gitFn/ghFn 表）⇒ 不 shell、不联网、不碰真台账。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCliRan } from './helpers/cliLeg.js'
import { judge, collect, ledgerFrom } from '../scripts/check-remote-divergence.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = resolve(ROOT, 'scripts', 'check-remote-divergence.mjs')
const DIR = mkdtempSync(join(tmpdir(), 'remotediv-'))
const HEAD = 'ca2f8ea1e723b23024878ad451156ef469331046'
const REF = '5620c16badbb3ce77ee22e24deda78b763aed793'

const snap = (over = {}) => ({
  headSha: HEAD, branchSha: HEAD, branch: 'main', localRefSha: REF, shallow: false,
  ahead: 3, behind: 0,
  unpushed: [{ sha: 'ca2f8ea', subject: 'fix(eol)' }, { sha: '10342a5', subject: 'docs(memory)' }, { sha: '96679fb', subject: 'feat(判据)' }],
  api: { ok: true, sha: REF },
  transport: { ok: true, rc: 0, sha: REF, why: '通' },
  ...over,
})
const ledgerOf = (shaList, localHead = HEAD) => ({ localHead, unpushed: shaList.map((sha) => ({ sha })) })
const rowOf = (rows, id) => rows.find((r) => r.id === id)
function fixtureFile(name, obj) {
  const p = join(DIR, name)
  writeFileSync(p, JSON.stringify(obj), 'utf8')
  return p
}
function cli(args) {
  const e = { ...process.env }
  delete e.GITHUB_REPOSITORY
  delete e.DIVERGENCE_REPO
  const r = assertCliRan(spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: e, timeout: 60_000 }), { label: `remote-divergence ${args.join(' ')}` })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
const run = (obj, args = []) => cli(['--fixture', fixtureFile(`${Math.random().toString(36).slice(2)}.json`, obj), ...args])

describe('judge R1/R3：通道与计数的正例面', () => {
  it('AHEAD 3 ⇒ 三笔逐笔具名，且 R5 明写"没有远端 run 回执是因为没推"', () => {
    const r = judge({ ...snap(), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(r.state).toBe('AHEAD 3')
    expect(r.rc).toBe(0)
    expect(rowOf(r.rows, 'R3').detail).toContain('96679fb')
    expect(rowOf(r.rows, 'R5').detail).toContain('按构造不存在')
  })
  it('IN_SYNC：ahead 0 ⇒ 待兑现清单为空，不许仍印 AHEAD', () => {
    const r = judge({ ...snap({ ahead: 0, unpushed: [] }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(r.state).toBe('IN_SYNC')
    expect(rowOf(r.rows, 'R5').detail).toContain('待兑现清单为空')
  })
  it('behind>0 ⇒ DIVERGED（不是"AHEAD n"，那会让人以为只差推一下）', () => {
    const r = judge({ ...snap({ behind: 2 }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(r.state).toBe('DIVERGED')
  })
  it('通道普查：transport 断 + api 通 ⇒ R1 仍算观测到（本轮实况：git 不通而 API 通）', () => {
    const r = judge({ ...snap({ transport: { ok: false, rc: 128, why: 'Failed to connect to github.com port 443' } }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R1').ok).toBe(true)
    expect(rowOf(r.rows, 'R1').detail).toContain('transport=断(rc=128)')
    expect(r.state).toBe('AHEAD 3')
  })
  it('两条通道全哑 ⇒ R1 判未验证并折 rc=2（"这台机器量不到"必须它自己说）', () => {
    const r = judge({ ...snap({ transport: { ok: false, rc: 128, why: '拒连' }, api: { ok: false, why: 'gh 不可用(exe=null)' } }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R1').ok).toBe(false)
    expect(r.rc).toBe(2)
  })
})

describe('judge R2：计数前置对账（假绿的那条通道）', () => {
  it('浅克隆 ⇒ 计数折成未验证：CI 的 fetch-depth:1 会让"领先 0"读成"已同步"', () => {
    const r = judge({ ...snap({ shallow: true, ahead: 0, unpushed: [] }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R2').ok).toBe(false)
    expect(rowOf(r.rows, 'R2').detail).toContain('浅克隆')
    expect(rowOf(r.rows, 'R3').detail).toContain('ahead=未取')
    expect(r.rc).toBe(2)
  })
  it('API head 与本地 remote-tracking ref 不等 ⇒ 我这边的图本身就是旧的，不许拿它算 ahead', () => {
    const r = judge({ ...snap({ api: { ok: true, sha: 'ffffffffffffffffffffffffffffffffffffffff' } }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R2').ok).toBe(false)
    expect(rowOf(r.rows, 'R2').detail).toContain('旧的')
    expect(r.state).toBe('UNVERIFIED')
    expect(r.rc).toBe(2)
  })
  it('本地 ref 取不到（全新 clone / detached）⇒ 同样不许造数', () => {
    const r = judge({ ...snap({ localRefSha: null }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R2').ok).toBe(false)
    expect(rowOf(r.rows, 'R2').detail).toContain('没有对账基准')
  })
  it('API 整条不可用但本地 ref 在 ⇒ R2 仍可计数（不能因为少一条通道就把已知事实判成未知）', () => {
    const r = judge({ ...snap({ api: { ok: false, why: 'status=1' } }), ledger: ledgerOf([]), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R2').ok).toBe(true)
    expect(rowOf(r.rows, 'R2').detail).toContain('API 不可用')
    expect(r.state).toBe('AHEAD 3')
  })
})

describe('judge R4：台账双向对账（册上说没推、其实已推 = 幽灵）', () => {
  it('幽灵：册上一笔现在已能从 origin 走到 ⇒ rc=1 并点名是哪笔', () => {
    const led = ledgerOf(['abcd123'])
    const r = judge({ ...snap(), ledger: led, isPushedFn: (s) => s === 'abcd123' })
    expect(rowOf(r.rows, 'R4').ok).toBe(false)
    expect(rowOf(r.rows, 'R4').detail).toContain('幽灵 1')
    expect(r.rc).toBe(1)
  })
  it('STALE：册记的 HEAD 与当前 HEAD 不符 ⇒ rc=1（台账是昨天的）', () => {
    const r = judge({ ...snap(), ledger: ledgerOf(['ca2f8ea', '10342a5', '96679fb'], 'ffffffffffffffffffffffffffffffffffffffff'), isPushedFn: () => false })
    expect(rowOf(r.rows, 'R4').detail).toContain('STALE=是')
    expect(r.rc).toBe(1)
  })
  it('正例：三笔都还没推 ⇒ 幽灵 0 / STALE 否 ⇒ rc=0', () => {
    const r = judge({ ...snap(), ledger: ledgerOf(['ca2f8ea', '10342a5', '96679fb']), isPushedFn: () => false })
    expect(r.rc).toBe(0)
    expect(rowOf(r.rows, 'R4').detail).toContain('幽灵 0')
  })
  it('缺册 ⇒ 判未对账（rc=1）而不是"没有未推送"；探针没注入也同理', () => {
    const noLedger = judge({ ...snap(), ledger: null })
    expect(rowOf(noLedger.rows, 'R4').ok).toBe(false)
    expect(rowOf(noLedger.rows, 'R4').detail).toContain('无账可对')
    const noProbe = judge({ ...snap(), ledger: ledgerOf(['ca2f8ea']) })
    expect(rowOf(noProbe.rows, 'R4').detail).toContain('不允许按')
  })
})

describe('collect：字段序与三态读数的来源（--left-right --count 的左右曾经装反）', () => {
  const gitTable = (map) => (args) => {
    const key = args.join(' ')
    const hit = Object.entries(map).find(([needle]) => key.includes(needle))
    return hit ? { rc: hit[1].rc ?? 0, stdout: hit[1].out, stderr: hit[1].err || '' } : { rc: 1, stdout: '', stderr: 'no such key' }
  }
  const ghOk = () => ({ status: 0, stdout: `${REF}\n`, stderr: '' })
  const baseMap = {
    'rev-parse HEAD': { out: HEAD },
    'rev-parse --verify': { out: REF },
    'is-shallow-repository': { out: 'false' },
    'left-right --count': { out: '0\t3' },
    'log --format': { out: 'ca2f8ea\tfix(eol)\n10342a5\tdocs(memory)\n96679fb\tfeat(判据)' },
    'merge-base --is-ancestor': { rc: 1, out: '' },
    'ls-remote': { out: `${REF}\trefs/heads/main` },
  }
  it('behind 在左、ahead 在右（装反会把"落后 0 领先 3"报成"领先 0"，于是永远显示已同步）', () => {
    const s = collect({ repo: 'x/y', gitFn: gitTable(baseMap), ghFn: ghOk })
    expect({ ahead: s.ahead, behind: s.behind }).toEqual({ ahead: 3, behind: 0 })
    expect(s.unpushed.map((u) => u.sha)).toEqual(['ca2f8ea', '10342a5', '96679fb'])
    expect(s.transport.ok).toBe(true)
  })
  it('浅克隆读数必须原样带出来（判据靠它把计数折成未验证）', () => {
    const s = collect({ repo: 'x/y', gitFn: gitTable({ ...baseMap, 'is-shallow-repository': { out: 'true' } }), ghFn: ghOk })
    expect(s.shallow).toBe(true)
  })
  it('API 与 transport 各报各的：gh 跑不起来是 status=null，不等于"没有未推送"', () => {
    const s = collect({ repo: 'x/y', gitFn: gitTable(baseMap), ghFn: () => ({ status: null, stdout: '', stderr: '' }) })
    expect(s.api.ok).toBe(false)
    expect(s.api.why).toContain('status=null')
  })
  it('isPushedFn 按 ancestry 判，不看字符串（短 sha 与全长 sha 混在台账里也认得出）', () => {
    const pushed = gitTable({ ...baseMap, 'merge-base --is-ancestor': { rc: 0, out: '' } })
    expect(collect({ repo: 'x/y', gitFn: pushed, ghFn: ghOk }).isPushedFn('ca2f8ea')).toBe(true)
    expect(collect({ repo: 'x/y', gitFn: gitTable(baseMap), ghFn: ghOk }).isPushedFn('ca2f8ea')).toBe(false)
  })
})

describe('ledgerFrom + 入口三档退出码（只 import 纯函数 ≠ 这条腿跑过）', () => {
  it('台账把"待兑现的回执"逐笔录下，且带 schema/observed_utc（缺一项就是第二真相源）', () => {
    const l = ledgerFrom(snap())
    expect(l.schema).toBe('chaoshi-remote-divergence-v1')
    expect(l.unpushed.map((u) => u.sha)).toEqual(['ca2f8ea', '10342a5', '96679fb'])
    expect(l.channel).toEqual({ transport: 'ok', api: 'ok' })
    expect(typeof l.observed_utc).toBe('string')
  })
  it('既无 GITHUB_REPOSITORY 又无 --fixture ⇒ rc=2，不许静默 0', () => {
    const { rc, out } = cli([])
    expect(rc).toBe(2)
    expect(out).toContain('BLOCKED')
  })
  it('夹具跑通 ⇒ rc=0 且门面行印 matched／mismatched 两个数', () => {
    const { rc, out } = run({ snapshot: snap(), ledger: ledgerOf(['ca2f8ea', '10342a5', '96679fb']), isPushed: [] })
    expect(rc, out.slice(-600)).toBe(0)
    expect(out).toContain('GATE-PASS remote-divergence')
    expect(out).toMatch(/matched \d+／mismatched 0/)
  })
  it('夹具里的幽灵笔 ⇒ rc=1（台账说谎这一档与"量不到"的 rc=2 分开）', () => {
    const { rc, out } = run({ snapshot: snap(), ledger: ledgerOf(['abcd123']), isPushed: ['abcd123'] })
    expect(rc, out.slice(-600)).toBe(1)
    expect(out).toContain('GATE-FAIL')
  })
  it('浅克隆夹具 ⇒ rc=2 且 R3 不印 ahead 数（假绿那条通道被当场关掉）', () => {
    const { rc, out } = run({ snapshot: snap({ shallow: true }), ledger: ledgerOf([]), isPushed: [] })
    expect(rc, out.slice(-600)).toBe(2)
    expect(out).toContain('浅克隆')
    expect(out).toContain('ahead=未取')
  })
  it('--update 在计数未成立时拒绝落盘（不许把一份不可信的快照写成台账）', () => {
    const { rc, out } = run({ snapshot: snap({ shallow: true }), ledger: ledgerOf([]), isPushed: [] }, ['--update'])
    expect(rc, out.slice(-600)).toBe(2)
    expect(out).toContain('计数未成立')
  })
  it('--inject-red ⇒ rc=1（演习有牙：往册前塞一枚"现在已能走到"的假笔）', () => {
    const { rc, out } = run({ snapshot: snap(), ledger: ledgerOf(['ca2f8ea', '10342a5', '96679fb']), isPushed: [] }, ['--inject-red'])
    expect(rc, out.slice(-600)).toBe(1)
    expect(out).toMatch(/幽灵 [1-9]/)
  })
})
