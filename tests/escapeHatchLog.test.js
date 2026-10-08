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

  it('R54-H3 远端腿（纯函数 + 注入，**夹具里绝不联网**）：判决面各状态各自归位，且恒 GREEN 的实现会被反例翻红', async () => {
    const { remoteRows, bypassHeads } = await import('../scripts/check-escape-hatch-log.mjs')
    const REC = [{ line: 1, head: 'b'.repeat(40), branch: 'main' }]
    const g = remoteRows(REC, () => [{ name: 'CI', status: 'completed', conclusion: 'success' }])
    expect(g[0].state).toBe('GREEN')
    // 第七十二轮 G-72-2：detail 口径从「run N 条」改为「判决面「CI」N 条」。
    // 为什么必须带分母：判决面限定之后，"这条绕过绿没绿"只看得到 CI，
    // 面上还并存别的 workflow 的 run —— 印不出分母，读的人会以为把别的 workflow 也算进判决了。
    expect(g[0].detail, '结论行必须带判决面计数（判据≠覆盖率）').toMatch(/判决面「CI」1 条：success 1/)
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

  /**
   * 第七十二轮 G-72-2 的一半：**判决面必须被限定**，否则别的链红就把这条绕过标成 RED。
   * 一手 ecdc92d（账本第 12 条）：它的 CI run 37228542182 = success、Release parity 37228744546 = success，
   * 而 D1 Daily Backup / Uptime 红（缺 CF_D1_BACKUP_TOKEN 那一支），旧实现 `failed.length ? 'RED'`
   * 把它判成 RED ⇒ 10 条 RED 里混着无法处置的假红 ⇒ 整个列表没人再看。
   * 本组三腿分别钉：判决面绿时旁证不污染判决、旁证必须被点名、判决面一个 run 都没有不许读成绿。
   */
  it('判决面限定：别的 workflow 红不污染判决，但必须被点名；判决面缺席时判 NOVERDICT 而非绿', async () => {
    const { remoteRows } = await import('../scripts/check-escape-hatch-log.mjs')
    const REC = [{ line: 1, head: 'b'.repeat(40), branch: 'main' }]
    const mixed = remoteRows(REC, () => [
      { name: 'CI', status: 'completed', conclusion: 'success' },
      { name: 'D1 Daily Backup', status: 'completed', conclusion: 'failure' },
    ])
    expect(mixed[0].state, '判决面绿就是绿：D1 Daily Backup 的红与「这次绕过 CI 绿没绿」无关').toBe('GREEN')
    expect(mixed[0].sideRed, '旁证必须以结构化形式留下，不能只在文本里提一句').toEqual(['D1 Daily Backup'])
    expect(mixed[0].detail, '旁证必须被点名，且要说清它不计入判决').toContain('旁证')
    expect(mixed[0].detail).toContain('不计入判决')

    const noVerdict = remoteRows(REC, () => [{ name: 'Dispatch deploy to github.io', status: 'completed', conclusion: 'success' }])
    expect(noVerdict[0].state, '判决面一个 run 都没有 ⇒ 没跑过，不是绿').toBe('NOVERDICT')
    expect(noVerdict[0].ok, 'NOVERDICT 不得被读成 ok').toBe(false)

    // 判决面名不许写死在代码里：注入别的 workflow 时判决跟着换（真相源是 .ci/contract.json 的 workflow）
    const runs = [{ name: 'Alpha', status: 'completed', conclusion: 'failure' }, { name: 'CI', status: 'completed', conclusion: 'success' }]
    expect(remoteRows(REC, () => runs, { workflow: 'CI' })[0].state).toBe('GREEN')
    expect(remoteRows(REC, () => runs, { workflow: 'Alpha' })[0].state).toBe('RED')
    // 判决面名真的取自契约，不是恰好等于 'CI'
    const { scopeWorkflow } = await import('../scripts/check-escape-hatch-log.mjs')
    const contract = JSON.parse(readFileSync(join(REPO, '.ci', 'contract.json'), 'utf8'))
    expect(scopeWorkflow(), '判决面必须等于 .ci/contract.json 的 workflow（不许另设配置项当第二真相源）').toBe(contract.workflow)
  })

  it('判决面 cancelled 必须单列 CANCELLED（不许藏进 OTHER）：那是 G-72-1 那一类，不是"其它"', async () => {
    const { remoteRows } = await import('../scripts/check-escape-hatch-log.mjs')
    const REC = [{ line: 1, head: 'b'.repeat(40), branch: 'main' }]
    const cut = remoteRows(REC, () => [{ name: 'CI', status: 'completed', conclusion: 'cancelled' }])[0]
    expect(cut.state, 'CI 被平台作业上限掐断 = 从来没给出结论，必须有自己的名字').toBe('CANCELLED')
    expect(cut.ok).toBe(false)
    expect(cut.unverified, 'cancelled 不进 RED 也不进 GREEN ⇒ 是未验证位').toBe(true)
    expect(cut.cancelledRuns).toBe(1)
    expect(cut.detail).toContain('从来没给出结论')
    // 混面：cancelled 之外还有一次 success ⇒ 不因一次掐断就否认已绿
    const mixed = remoteRows(REC, () => [
      { name: 'CI', status: 'completed', conclusion: 'cancelled' },
      { name: 'CI', status: 'completed', conclusion: 'success' },
    ])[0]
    expect(mixed.state).toBe('GREEN')
  })

  /**
   * 第七十二轮 C10：**覆盖不等于办完了**。C9 判"读数盖住了账"，C10 判"盖住的那些判决面红的有没有结论"。
   * 只立 C9 会出现一种很坏的绿：账本 100% 被读数覆盖、verdict=GREEN，而读数里躺着 9 条 RED。
   */
  it('C10 结论闭环：判决面 RED 无处置结论 ⇒ OPEN（待处置）；有可证伪解释 ⇒ EXPLAINED；不可证伪的话仍判 OPEN', async () => {
    const { reconcileDisposition, MIN_DISPOSITION_CHARS } = await import('../scripts/check-escape-hatch-log.mjs')
    expect(reconcileDisposition({ rows: [{ state: 'GREEN' }, { state: 'GREEN' }] }).state).toBe('CLOSED')

    const open = reconcileDisposition({ rows: [{ state: 'RED', head: 'a'.repeat(40) }] })
    expect(open.state, '判决面红且没人认领 ⇒ 待处置，不能因为"读数已覆盖"就当办完').toBe('OPEN')
    expect(open.open).toBe(1)
    expect(open.rows[0].why).toContain('没有处置结论')

    const good = reconcileDisposition({ rows: [{ state: 'RED', disposition: { why: 'run 37673508810 的 build-and-test 红在 Test (vitest, with v8 coverage)；治本提交 ddd6de0 钉 SHA' } }] })
    expect(good.state).toBe('EXPLAINED')
    expect(good.open).toBe(0)

    // 长度到了但不可证伪（「已知问题待观察」+ 空格凑够）⇒ 仍 OPEN
    const vague = reconcileDisposition({ rows: [{ state: 'RED', disposition: { why: '已知问题待观察'.padEnd(MIN_DISPOSITION_CHARS + 20, ' ') } }] })
    expect(vague.state, '凑够字数但一个数字一个命令都没有 ⇒ 不是处置结论').toBe('OPEN')

    // 没取到 / 没跑完都不是谁欠账，不进 open 分母（否则会逼人编解释）
    const unknown = reconcileDisposition({ rows: [{ state: 'NOVERDICT' }, { state: 'UNVERIFIED' }, { state: 'NOTFOUND' }, { state: 'PENDING' }, { state: 'CANCELLED' }] })
    expect(unknown.state).toBe('CLOSED')
    expect(unknown.open).toBe(0)
    expect(unknown.unknown, '五个"没结论"状态各自都要进 unknown 分母').toBe(5)
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

/**
 * 第七十二轮 C9：绕过之后的**终态读数**必须有一本在册的账，且与账本做双向差集。
 * 一手：`--remote` 自第 54 轮就在，但它只往 stdout 印一次 —— 本轮实测账本 28 条里 10 条 RED，
 * 而这些 RED 在上一轮的报告里一个字都没有；"有取证通道"被当成了"查过了"。
 * 与第 71 轮 C7（登记册有写无读）同族，所以修法也一样：**把读数落盘 + 每次都判它盖没盖住**。
 */
describe('第七十二轮 C9 · 终态读数 ⇄ 账本 的双向对账', () => {
  it('生产面真跑：默认每次跑都出 C9 一行，且两个分母（未覆盖/死读数）都印出来', () => {
    const r = run([])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    const line = String(r.stdout).split(/\r?\n/).find((l) => l.includes('C9 ::'))
    expect(line, 'C9 不在默认输出里 = 又有通道没接线').toBeTruthy()
    expect(line).toMatch(/未覆盖 \d+｜死读数 \d+/)
  })
  it('反例（CLI 级）：账本里多一条读数没盖住的绕过 ⇒ C9 具名 DRIFT，但默认档不改 rc', () => {
    const d = fresh()
    mkdirSync(join(d, '.ci'), { recursive: true })
    const rec = { utc: '2026-01-01T00:00:00Z', base_sha: 'a'.repeat(40), head_sha: 'e'.repeat(40), branch: 'main', reason: '合成面上的又一条绕过记录，长度同样过 20 字下限', actor: 'fixture' }
    writeFileSync(join(d, '.ci', 'escape-hatch.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8')
    const r = run(['--dir', d])
    const out = String(r.stdout) + String(r.stderr)
    expect(r.status, out.slice(-700)).toBe(0)
    expect(out).toMatch(/(FAIL|UNVERIFIED)  C9 ::/)
    expect(out).toMatch(/未覆盖 [1-9]/)
    expect(out, '未覆盖的那条 head 必须点出来，不许只有一个计数').toContain('eeeeeeee')
  })
  it('升档演习：--require-covered 才把 C9 的 DRIFT 变成 rc=2（缺省档 = 现状，不偷偷加闸）', () => {
    const d = fresh()
    mkdirSync(join(d, '.ci'), { recursive: true })
    const rec = { utc: '2026-01-01T00:00:00Z', base_sha: 'a'.repeat(40), head_sha: 'f'.repeat(40), branch: 'main', reason: '合成面上的升档用例记录，同样满足 20 字下限', actor: 'fixture' }
    writeFileSync(join(d, '.ci', 'escape-hatch.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8')
    const off = run(['--dir', d])
    const on = run(['--dir', d, '--require-covered'])
    expect(off.status).toBe(0)
    expect(on.status, String(on.stdout) + String(on.stderr)).toBe(2)
    expect(String(on.stdout)).toContain('--update-remote')
  })
  it('在册读数必须是工具自己生成的，且真盖住当前账本（生产面自证，不接受手抄）', () => {
    const doc = JSON.parse(readFileSync(join(REPO, 'docs', 'escape-hatch-remote.json'), 'utf8'))
    expect(doc.schema).toBe('chaoshi-escape-hatch-remote-v1')
    expect(Array.isArray(doc.rows) && doc.rows.length).toBeGreaterThan(0)
    expect(doc.rows.every((x) => typeof x.head === 'string' && /^[0-9a-f]{7,40}$/.test(x.head)), '读数行缺 head ⇒ C9 无从对账')
        .toBe(true)
    const state = doc.rows.map((x) => x.state)
    for (const s of state) expect(['GREEN', 'RED', 'PENDING', 'UNVERIFIED', 'NOTFOUND', 'OTHER', 'CANCELLED', 'NOVERDICT']).toContain(s)
    expect(doc.note, 'note 必须写明这条腿不进阻断链').toContain('永不进阻断链')
    // 第七十二轮 G-72-2：判决面必须写在读数册里（不写就看不出这些 state 是按什么面判的）
    expect(doc.scopeWorkflow, '读数册必须记下判决面 workflow 名').toBe(
      JSON.parse(readFileSync(join(REPO, '.ci', 'contract.json'), 'utf8')).workflow,
    )
    // 生产面自证：真账本里判决面红的行**每一条**都必须带可证伪处置结论，否则 C10 会 OPEN。
    // 这条断言是 C10 真正上牙齿的地方：删掉任意一条 disposition，本用例立刻红。
    const { reconcileDisposition } = require('../scripts/check-escape-hatch-log.mjs')
    const rec = reconcileDisposition({ rows: doc.rows })
    expect(rec.state, `生产面还有 ${rec.open} 条判决面 RED 没写处置结论：${rec.rows.map((x) => x.why).join(' | ')}`).not.toBe('OPEN')
  })
  it('接线：升档通道有 npm 别名（没挂别名＝这条腿只有写过它的人会用，本仓判它半成品）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    expect(String(pkg.scripts['report:escape-hatch-remote:update'])).toContain('check-escape-hatch-log.mjs --update-remote')
  })
})
