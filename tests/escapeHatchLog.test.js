// 第五十三轮 E3（内层 R53-H5）：逃生门计量的常驻夹具。
//
// 立它的实测：`ci-green-contract.mjs` 绕过时印「这笔账会留在 CI 与台账里」，而写入动作**根本不存在**
// （`grep -nE "writeFileSync|appendFile|ledger|\\.jsonl"` 0 命中）⇒ 那句是假主张。
// 本轮装上计量后，"写进去了吗"不能靠我看一眼代码，必须每次真跑：入口子进程 + 行为回执 + 坏面必红。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendEscapeLedger, ESCAPE_LEDGER, ESCAPE_REQUIRED } from '../scripts/ci-green-contract.mjs'

const REPO = resolve(fileURLToPath(import.meta.url), '../..')
const SELF = join('scripts', 'check-escape-hatch-log.mjs')
const dirs = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'eh53-')); dirs.push(d); return d }
const GOOD = { base: '4'.repeat(40), head: '9'.repeat(40), branch: 'main', actor: 'fixture', reason: '合成面上的合规记录，长度已过 20 字下限' }
const run = (args) => {
  const r = spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: 'utf8', timeout: 60_000 })
  return assertCliRan(r, { label: `verify:escape-hatch ${args.join(' ')}`, budgetMs: 60_000 })
}

describe('verify:escape-hatch（逃生门计量）', () => {
  it('入口真跑：--selftest 必须被子进程跑起来并印出 6/6（只 import 纯函数不算覆盖）', () => {
    const r = run(['--selftest'])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    const m = /自证 (\d+)\/(\d+)（账本 (\d+)\/(\d+)・远端腿 (\d+)\/(\d+)）/.exec(r.stdout)
    expect(m, `自证汇总行形状不对：${r.stdout.split('\n').slice(-1)[0]}`).toBeTruthy()
    expect(Number(m[1]), '总通过数必须等于总分母').toBe(Number(m[2]))
    expect(Number(m[3]) + Number(m[5]), '分母恒等式：账本条数 + 远端腿条数 = 总条数').toBe(Number(m[2]))
    expect(Number(m[4]), '账本腿不得掉档（第五十三轮为 6 条）').toBeGreaterThanOrEqual(6)
    expect(Number(m[6]), '远端腿不得掉档（第五十四轮为 5 条）').toBeGreaterThanOrEqual(5)
    expect(r.stderr, `判据不该抛异常：${r.stderr.slice(0, 140)}`).not.toMatch(/Traceback/)
  })

  it('genesis 起始行：真面里必须有一条非绕过的起始记录，且它不计入绕过次数', () => {
    const text = readFileSync(join(REPO, '.ci', 'escape-hatch.jsonl'), 'utf8')
    const recs = text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
    const gen = recs.filter((x) => x.kind === 'genesis')
    expect(gen.length, '缺 genesis 行 ⇒ 账本一旦消失就与「从没发生过绕过」同形，判据只能记未验证').toBe(1)
    expect(gen[0].reason.length).toBeGreaterThan(20)
    const r = run([])
    expect(r.status, r.stdout).toBe(0)
    expect(r.stdout).toMatch(/记录 \d+ 条（绕过 \d+ \/ 起始 1）/)
    expect(r.stdout).toContain('起始行，非绕过')
    expect(r.stderr).not.toMatch(/Traceback/)
  })

  it('真面回执：账本存在时逐条读数，且**必须把"没判的那一半"说出来**（远端是否回绿）', () => {
    const r = run([])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/verdict=GREEN rc=0｜面=(present|missing)｜记录 \d+ 条/)
    expect(r.stdout).toContain('未判的半边')
    expect(r.stdout).toContain('远端有没有回绿')
  })

  it('反例：坏 JSON / 缺字段 / 理由太短 ⇒ rc=1 且逐条点名行号（一条坏账不许被跳过）', () => {
    const d = fresh()
    mkdirSync(join(d, '.ci'), { recursive: true })
    writeFileSync(join(d, ESCAPE_LEDGER), [
      '{ 这不是 JSON',
      JSON.stringify({ ...GOOD, head_sha: undefined, head: undefined }),
      JSON.stringify({ utc: 'x', base_sha: '4'.repeat(40), head_sha: '9'.repeat(40), branch: 'main', actor: 'a', reason: '太短' }),
    ].join('\n') + '\n', 'utf8')
    const r = run(['--dir', d])
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toContain('第 1 行不是合法 JSON')
    expect(r.stdout).toContain('缺字段或为空')
    expect(r.stdout).toContain('第 3 行理由只有 2 字')
    expect(r.stdout).toMatch(/不合规 3/)
    expect(r.stderr).not.toMatch(/Traceback/)
  })

  it('零输入两态：没面可判 ⇒ 一律 rc=2（不得当清白），两种缺席的措辞仍不得同形', () => {
    const absent = run(['--dir', fresh()])
    expect(absent.status, absent.stdout).toBe(2)
    expect(absent.stdout).toContain('账本不存在')
    expect(absent.stdout).toContain('无法区分')
    expect(absent.stdout).toMatch(/verdict=UNVERIFIED rc=2/)
    const empty = fresh()
    mkdirSync(join(empty, '.ci'), { recursive: true })
    writeFileSync(join(empty, ESCAPE_LEDGER), '\n', 'utf8')
    const e = run(['--dir', empty])
    expect(e.status, e.stdout).toBe(2)
    expect(e.stdout).toContain('存在但 0 条')
    expect(e.stdout).not.toContain('账本不存在')
  })

  it('行为回执：写入器真落一行且字段齐全；必填项缺失时**拒写**且不留半成品（fail-closed 要有牙齿）', () => {
    const d = fresh()
    const w = appendEscapeLedger(GOOD, d)
    const text = readFileSync(w.path, 'utf8')
    expect(w.bytes, '回执字节必须与落盘字节相同，否则"我写了"是叙述').toBe(Buffer.byteLength(text))
    const rec = JSON.parse(text.split('\n')[0])
    for (const k of ESCAPE_REQUIRED) expect(rec[k], `必填项 ${k} 不得为空`).toBeTruthy()
    expect(text.endsWith('\n'), 'JSONL 每行必须以 \\n 收尾（否则下一行会被焊上来）').toBe(true)
    expect(text.includes(String.fromCharCode(13)), '不得混进 CR：Windows 下 append 也必须是 LF').toBe(false)
    const before = readFileSync(w.path, 'utf8')
    let threw = null
    try { appendEscapeLedger({ ...GOOD, base: '' }, d) } catch (e) { threw = e }
    expect(threw, '空 base 必须被拒（记一条对不了账的账比不记更坏）').toBeTruthy()
    expect(readFileSync(w.path, 'utf8'), '拒写时不得留半成品行').toBe(before)
    let threw2 = null
    try { appendEscapeLedger({ ...GOOD, reason: '八个字都不到' }, d) } catch (e) { threw2 = e }
    expect(threw2, '理由太短必须被拒').toBeTruthy()
    expect(existsSync(join(d, '.ci')), '目录已建也不算失败痕迹，但内容不得变').toBe(true)
    expect(readFileSync(w.path, 'utf8')).toBe(before)
  })

  it('R54-H3 远端腿（纯函数 + 注入，**夹具里绝不联网**）：四种状态各自归位，且恒 GREEN 的实现会被反例翻红', async () => {
    const { remoteRows, bypassHeads } = await import('../scripts/check-escape-hatch-log.mjs')
    const REC = [{ line: 1, head: 'b'.repeat(40), branch: 'main' }]
    const g = remoteRows(REC, () => [{ name: 'CI', status: 'completed', conclusion: 'success' }])
    expect(g[0].state).toBe('GREEN')
    expect(g[0].detail, '结论行必须带 matched/passed 计数（判据≠覆盖率）').toMatch(/run 1 条：success 1/)
    const bad = remoteRows(REC, () => [{ name: 'CI', status: 'completed', conclusion: 'failure' }])
    expect(bad[0].state).toBe('RED')
    const none = remoteRows(REC, () => null)
    expect(none[0].state).toBe('UNVERIFIED')
    expect(none[0].unverified, '取不到必须是未验证位，不得复用 ok=false 当"判红"').toBe(true)
    expect(none[0].detail).toContain('不等于没回绿')
    const empty = remoteRows(REC, () => [])
    expect(empty[0].state).toBe('NOTFOUND')
    const pend = remoteRows(REC, () => [{ name: 'CI', status: 'in_progress', conclusion: '' }])
    expect(pend[0].state).toBe('PENDING')
    // 变异体面：把状态写死成 GREEN 的实现，必须在 bad/pend 两条上翻红
    expect([bad[0].state, pend[0].state], '若有人把 state 写死，这两条就不再互异').not.toEqual(['GREEN', 'GREEN'])
    // bypassHeads 必须把 genesis 行剔掉（起始行不是绕过，去查它的 run 是给自己造第三条腿）
    const lines = [JSON.stringify({ ...GOOD, head_sha: 'c'.repeat(40), kind: 'genesis' }),
      JSON.stringify({ ...GOOD, head_sha: 'd'.repeat(40) }), '{ 坏行不管它，H2 已判红']
    const heads = bypassHeads(lines)
    expect(heads.length, '两条合法记录里只有一条是绕过').toBe(1)
    expect(heads[0].head).toBe('d'.repeat(40))
  })

  it('R54-H3 接线边界：远端腿**只能落在 report: 前缀下**——链、CI、verify:* 别名里都不得出现 --remote（联网判据当闸＝不可自愈）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(String(pkg.scripts.verify), 'verify 链不得带 --remote').not.toContain('--remote')
    expect(ci, 'CI 不得带 --remote').not.toContain('--remote')
    for (const [k, v] of Object.entries(pkg.scripts)) {
      if (String(v).includes('--remote')) {
        expect(k, `带 --remote 的别名只许住在 report: 命名空间下（发现 ${k}）`).toMatch(/^report:/)
      }
    }
    expect(pkg.scripts['report:escape-hatch-remote'], '没挂别名＝这条腿只有写过它的人会用（半成品）')
      .toContain('check-escape-hatch-log.mjs --remote')
  })

  it('真面回执：账本里的绕过记录确有 1 条可对账（这条腿在真盘上跑过，不是只活在合成 payload 里）', () => {
    const text = readFileSync(join(REPO, '.ci', 'escape-hatch.jsonl'), 'utf8').split(/\r?\n/).filter((l) => l.trim())
    const heads = text.map((l) => JSON.parse(l)).filter((o) => o.kind !== 'genesis')
    expect(heads.length, '本轮之前那次真实绕过必须在账上（回溯补记也算）').toBeGreaterThanOrEqual(1)
    for (const h of heads) expect(String(h.head_sha)).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('接线回归：别名直指本脚本、verify 链收它、CI 里确有这一步（两跳核，不按别名假判缺口）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    const cmd = String(pkg.scripts['verify:escape-hatch'] || '')
    expect(cmd, '别名必须直指 scripts/check-escape-hatch-log.mjs').toContain('scripts/check-escape-hatch-log.mjs')
    expect(String(pkg.scripts.verify), '离线可判 ⇒ 应进本机 verify 链').toContain('npm run verify:escape-hatch')
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(ci, 'CI 必须有真跑这一步的一步').toContain('npm run verify:escape-hatch')
  })
})
