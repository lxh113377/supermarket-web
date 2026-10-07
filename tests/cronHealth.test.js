// 第四十二轮夹具：**每条 cron 的"最近一次"是不是红的**（C1~C8 九道腿；C7/C8 由第七十一轮补）。
// 立它的读数（本机实测 @2026-09-28）：`gh run list --workflow=Uptime` 第一行 = run 36299454141
// @2026-09-27T06:13:21Z event=schedule **failure**，而旧尺 `LIVENESS_MODE=presence ... check-backup-liveness.mjs`
// 对同一时刻实跑 **rc=0**（它认的是 09-26 的一次 workflow_dispatch）。⇒ "窗口内成功过"与"最近一次红"
// 是两件事，本文件的核心反例就是第 2 条：**手动补跑不得把调度层的红洗白**。
// 判据只吃注入数据（evaluate 是纯函数），每条反例都不碰网络、不读本机 git 状态。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, verdictOf, cronPeriodDays, enumerateScheduled, ageOfRegistry, stepCensus } from '../scripts/check-cron-health.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const SCRIPT = join('scripts', 'check-cron-health.mjs')
const DIR = mkdtempSync(join(tmpdir(), 'cronhealth-'))
/** 写一份合成读数到系统临时目录（不污染受管面），再以**子进程**跑入口本身。 */
function fixtureFile(name, obj) {
  const p = join(DIR, name)
  writeFileSync(p, JSON.stringify(obj), 'utf8')
  return p
}
function cli(args, env = {}) {
  const e = { ...process.env, ...env }
  delete e.GITHUB_REPOSITORY
  delete e.CRON_HEALTH_REPO
  const r = assertCliRan(spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: e, timeout: 60_000 }), { label: `cronHealth ${SCRIPT} ${args.join(' ')}` })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
const GREEN_FIXTURE = () => ({
  workflows: WF, remote: REMOTE, nowIso: NOW,
  runsByName: { 'd1-backup.yml': [run()], 'uptime.yml': [run({ id: 2 })] },
  registry: { generatedUtc: NOW, entries: [{ workflow: 'd1-backup.yml' }, { workflow: 'uptime.yml' }] },
})

const WF = {
  'd1-backup.yml': 'name: D1 Daily Backup\non:\n  schedule:\n    - cron: \'0 20 * * *\'   # UTC 20:00\n  workflow_dispatch:\n',
  'uptime.yml': 'name: Uptime\non:\n  schedule:\n    # 注释行（第一版在这里破口：碰到注释就退出块）\n    - cron: \'0 1 * * *\'\n  workflow_dispatch:\n',
  'ci.yml': 'name: CI\non:\n  push:\n    branches: [main]\n',
}
const REMOTE = [
  { name: 'D1 Daily Backup', path: '.github/workflows/d1-backup.yml', state: 'active' },
  { name: 'Uptime', path: '.github/workflows/uptime.yml', state: 'active' },
  { name: 'CI', path: '.github/workflows/ci.yml', state: 'active' },
]
const NOW = '2026-09-28T00:30:00Z'
const run = (over = {}) => ({ id: 1, at: '2026-09-27T20:00:00Z', conclusion: 'success', event: 'schedule', ...over })
const entries = (over = {}) => [
  { workflow: 'd1-backup.yml', accepts_red_until: '', accepts_red_reason: '', root_cause: '' },
  { workflow: 'uptime.yml', accepts_red_until: '', accepts_red_reason: '', root_cause: '' },
  ...(over.extraEntries || []),
]
const state = (rows, id) => rows.find((r) => r.id === id)

function base({ runs = {}, registry = entries(), ...rest } = {}) {
  // C7 判的是"册上读数几时生成的"，而老夹具传的是裸数组（没有 generatedUtc 这种册级字段）。
  // 这里统一包成对象并给一个"刚刚生成"的时刻 ⇒ 其余各腿的断言面不被 C7 污染；C7 自己的正/反例单独造。
  const reg = Array.isArray(registry) ? { generatedUtc: rest.nowIso || NOW, entries: registry } : registry
  const out = evaluate({
    workflows: WF, remote: REMOTE, nowIso: NOW,
    runsByName: {
      'd1-backup.yml': runs.backup ?? [run()],
      'uptime.yml': runs.uptime ?? [run({ id: 2, event: 'schedule' })],
    },
    registry: reg, ...rest,
  })
  return out
}

describe('cron 普查 · 正例', () => {
  it('两条 cron 全绿 ⇒ 九道腿（C1/C2/C3/C3b/C4/C5/C6/C7/C8）全过、rc=0', () => {
    const { rows } = base()
    expect(rows.filter((r) => r.ok !== true).map((r) => r.id)).toEqual([])
    expect(rows.length).toBe(9)
    expect(verdictOf(rows)).toEqual({ verdict: 'GREEN', rc: 0 })
    expect(state(rows, 'C6').detail).toContain('OK 2')
  })

  it('C6 印的是实测数字（条数/连红/run 号），不是一个状态词', () => {
    const { rows } = base({ runs: { uptime: [run({ id: 900, conclusion: 'failure', event: 'schedule' }), run({ id: 899, event: 'schedule' })] } })
    expect(state(rows, 'C6').detail).toContain('900')
    expect(state(rows, 'C6').detail).toContain('连红 1')
  })
})

describe('cron 普查 · 核心反例（本轮立它的直接动因）', () => {
  it('手动 dispatch 成功**不得**洗白最近一次 scheduled 的红', () => {
    const { rows, per } = base({
      runs: { uptime: [run({ id: 11, event: 'workflow_dispatch', at: '2026-09-27T23:00:00Z' }), run({ id: 12, event: 'schedule', at: '2026-09-27T06:13:21Z', conclusion: 'failure' })] },
    })
    expect(state(rows, 'C6').ok).toBe(false)
    const up = per.find((p) => p.file === 'uptime.yml')
    expect(up.lastScheduled.id).toBe(12)
    expect(up.redStreak).toBe(1)
    expect(up.why).toContain('failure')
  })

  it('cron 到点没跑（龄期超 2 个周期）⇒ C6 红，且不说成"失败"', () => {
    const { rows, per } = base({ runs: { uptime: [run({ id: 13, at: '2026-09-20T01:00:00Z' })] } })
    expect(state(rows, 'C6').ok).toBe(false)
    expect(per.find((p) => p.file === 'uptime.yml').why).toContain('天前')
  })

  it('窗口内一次 scheduled 都没有 ⇒ 红（"全被别的顶替了"不是健康）', () => {
    const { rows } = base({ runs: { uptime: [run({ id: 14, event: 'push' }), run({ id: 15, event: 'workflow_dispatch' })] } })
    expect(state(rows, 'C6').ok).toBe(false)
    expect(state(rows, 'C6').detail).toContain('uptime.yml')
  })

  it('工作流被禁用（state=inactive）⇒ 红：cron 到点也不会跑', () => {
    const remote = REMOTE.map((w) => (w.path.endsWith('uptime.yml') ? { ...w, state: 'inactive' } : w))
    const { rows } = base({ remote })
    expect(state(rows, 'C6').ok).toBe(false)
  })

  it('in_progress 的 run（conclusion 为 null）不算失败；且**自己的 run 被排除**', () => {
    const { rows, per } = base({
      runs: { uptime: [run({ id: 777, conclusion: null, at: '2026-09-28T01:00:00Z' }), run({ id: 778, at: '2026-09-27T01:00:00Z', conclusion: 'failure' })] },
      excludeRunId: '777',
    })
    const up = per.find((p) => p.file === 'uptime.yml')
    expect(up.lastScheduled.id).toBe(778)
    // 被剔出判定的两条：777 是"自己 + 未完成"，计数按**剔除**口径（宁可多数一条也不让 in_progress 混进判定）
    expect(up.droppedUnfinished).toBe(1)
    expect(state(rows, 'C6').ok).toBe(false)
    // 不排自己时，那行 in_progress 会被当成"还没跑完"而**整条剔除**，绝不会读成红
    const { per: per2 } = base({ runs: { uptime: [run({ id: 777, conclusion: null })] } })
    expect(per2.find((p) => p.file === 'uptime.yml').state).toBe('RED')
    expect(per2.find((p) => p.file === 'uptime.yml').droppedUnfinished).toBe(1)
  })
})

describe('cron 普查 · 取数面与登记面', () => {
  it('一条 schedule 都没有 ⇒ C1 红（零输入不得 PASS），不是"没有 cron 所以安全"', () => {
    const { rows } = evaluate({ workflows: { 'ci.yml': WF['ci.yml'] }, remote: REMOTE, runsByName: {}, registry: [], nowIso: NOW })
    expect(state(rows, 'C1').ok).toBe(false)
    expect(verdictOf(rows).rc).toBe(2)
  })

  it('枚举器碰到"有 schedule: 块却解不出 cron"必须入面并点名（第一版就是静默漏掉 d1-backup.yml）', () => {
    const wf = { 'broken.yml': 'name: Broken\non:\n  schedule:\n    - thing: other\n  workflow_dispatch:\n' }
    const listed = enumerateScheduled(wf)
    expect(listed.length).toBe(1)
    expect(listed[0].unparsed).toBe(true)
    const { rows } = evaluate({ workflows: wf, remote: [{ name: 'Broken', path: '.github/workflows/broken.yml', state: 'active' }], runsByName: { 'broken.yml': [] }, registry: [], nowIso: NOW })
    expect(state(rows, 'C2').ok).toBe(false)
    expect(state(rows, 'C2').detail).toContain('broken.yml')
    expect(verdictOf(rows).rc).toBe(2)
  })

  it('YAML 有、远端名单没有 ⇒ C3 幽灵；远端有、本地无文件 ⇒ C3 孤儿。两个方向都要点名', () => {
    const { rows } = base({ remote: REMOTE.filter((w) => !w.path.endsWith('uptime.yml')) })
    expect(state(rows, 'C3').ok).toBe(false)
    expect(state(rows, 'C3').detail).toMatch(/幽灵|孤儿/)
    const { rows: r2 } = base({ remote: [...REMOTE, { name: 'Gone', path: '.github/workflows/gone.yml', state: 'active' }] })
    expect(state(r2, 'C3').ok).toBe(false)
    expect(state(r2, 'C3').detail).toContain('gone.yml')
  })

  it('改工作流不改登记册 ⇒ C4 缺条目红；册里留幽灵条目 ⇒ 同样红', () => {
    const { rows } = base({ registry: [entries()[0]] })
    expect(state(rows, 'C4').ok).toBe(false)
    expect(state(rows, 'C4').detail).toContain('缺条目')
    const { rows: r2 } = base({ registry: [...entries(), { workflow: 'old.yml' }] })
    expect(state(r2, 'C4').detail).toContain('幽灵条目')
  })

  it('取不到 run 历史 ⇒ C5 红且 rc=2（失明绝不读成健康）', () => {
    const out = evaluate({
      workflows: WF, remote: REMOTE, nowIso: NOW,
      runsByName: { 'd1-backup.yml': [run()], 'uptime.yml': null }, registry: entries(),
    })
    expect(state(out.rows, 'C5').ok).toBe(false)
    expect(verdictOf(out.rows)).toEqual({ verdict: 'UNVERIFIED', rc: 2 })
  })
})

describe('cron 普查 · 豁免通道（能豁免就必须可证伪 + 限期 + 具名根因）', () => {
  const exempt = (over = {}) => entries().map((e) => (e.workflow === 'uptime.yml'
    ? { ...e, accepts_red_until: '2026-10-12', accepts_red_reason: '实测 run 36299454141 唯一失败 step 是 `check-backup-liveness` 判 rc=1，与备份链同因', root_cause: '缺 CF_D1_BACKUP_TOKEN', ...over }
    : e))

  it('合法三件套：降为 WARN、rc=0，且 C6 行写明"至某日"', () => {
    const { rows } = base({ registry: exempt(), runs: { uptime: [run({ id: 21, conclusion: 'failure' })] } })
    expect(state(rows, 'C6').ok).toBe(true)
    expect(state(rows, 'C6').detail).toContain('WARN 1')
    expect(state(rows, 'C6').detail).toContain('2026-10-12')
    expect(verdictOf(rows).rc).toBe(0)
  })

  it('豁免**过期** ⇒ 该红重新生效（不许无限期挂着）', () => {
    const { rows } = base({ registry: exempt({ accepts_red_until: '2026-09-27' }), runs: { uptime: [run({ id: 22, conclusion: 'failure' })] } })
    expect(state(rows, 'C6').ok).toBe(false)
    expect(state(rows, 'C6').detail).toContain('到期')
  })

  it('豁免理由太薄（无可复跑命令也没数字）⇒ C4 红；缺 root_cause ⇒ 同样红', () => {
    const { rows } = base({ registry: exempt({ accepts_red_reason: '以后再处理' }), runs: { uptime: [run({ id: 23, conclusion: 'failure' })] } })
    expect(state(rows, 'C4').ok).toBe(false)
    const { rows: r2 } = base({ registry: exempt({ root_cause: '' }), runs: { uptime: [run({ id: 24, conclusion: 'failure' })] } })
    expect(state(r2, 'C4').ok).toBe(false)
    expect(state(r2, 'C4').detail).toContain('root_cause')
  })

  it('2 条红共享同一具名根因 ⇒ C6 说"2 条 ⇄ 1 个根因"，不数成两件事', () => {
    const reg = entries().map((e) => ({ ...e, accepts_red_until: '', accepts_red_reason: '', root_cause: '缺 CF_D1_BACKUP_TOKEN' }))
    const { rows } = base({
      registry: reg,
      runs: { backup: [run({ id: 31, conclusion: 'failure' })], uptime: [run({ id: 32, conclusion: 'failure' })] },
    })
    expect(state(rows, 'C6').detail).toContain('具名根因 1 个')
    expect(state(rows, 'C6').detail).toContain('同因归并')
  })
})

describe('cron 周期解析（口径本身要能反例）', () => {
  it('日级/小时级/每 3 天解得出；月级与步进小时一律 null（宁可 UNVERIFIED 也不猜）', () => {
    expect(cronPeriodDays('0 20 * * *')).toBe(1)
    expect(cronPeriodDays('*/30 * * * *')).toBe(30 / 1440)
    expect(cronPeriodDays('0 1 */3 * *')).toBe(3)
    expect(cronPeriodDays('0 1 * 1-6 *')).toBeNull()
    expect(cronPeriodDays('0 */6 * * *')).toBeNull()
    expect(cronPeriodDays('bogus')).toBeNull()
  })
})

describe('入口通道真跑（子进程 + 三档退出码；第二十四轮立的规矩：只 import 纯函数不算跑过入口）', () => {
  it('喂绿色合成读数 ⇒ rc=0，门面行印"声明 2 条"与 9/9', () => {
    const f = fixtureFile('green.json', GREEN_FIXTURE())
    const { rc, out } = cli(['--fixture', f])
    expect(rc, out.slice(-600)).toBe(0)
    expect(out).toContain('GATE-PASS cron-health')
    expect(out).toContain('检查 9/9 通过，0 失败')
    expect(out).toContain('声明 2 条')
  })

  it('喂"最近一次 scheduled 判红且无豁免" ⇒ rc=1，且点名是哪条', () => {
    const fix = GREEN_FIXTURE()
    fix.runsByName['uptime.yml'] = [run({ id: 55, conclusion: 'failure' })]
    const { rc, out } = cli(['--fixture', fixtureFile('red.json', fix)])
    expect(rc, out.slice(-600)).toBe(1)
    expect(out).toContain('GATE-FAIL')
    expect(out).toContain('uptime.yml')
  })

  it('既没有 GITHUB_REPOSITORY 也没有 fixture ⇒ rc=2（取不到数绝不落到 0）', () => {
    const { rc, out } = cli([])
    expect(rc).toBe(2)
    expect(out).toContain('BLOCKED')
  })

  it('--inject-red 演习 ⇒ rc=1（这条腿不是摆设），且注入行带 INJECTED 前缀可与真产物区分', () => {
    const { rc, out } = cli(['--fixture', fixtureFile('inj.json', GREEN_FIXTURE()), '--inject-red'])
    expect(rc, out.slice(-600)).toBe(1)
    expect(out).toContain('INJECTED')
  })
})

/**
 * C7 / C8（第七十一轮）。一手实况：`docs/cron-health.json` 的 generatedUtc 停在 2026-10-04，
 * observed_last_run 落后现实 3 夜，而 grep 全仓**没有任何判据读这三个字段**（只有 --update 写它）。
 * ⇒ 人填的豁免理由是照着册上读数写的，读数过期 = 理由是照着旧事实写的，此前没人复核。
 * C7 走 rc=2（过期的是证据，不是某条 cron 病了）；C8 默认只报，`--require-reason-match` 才拦。
 */
const DAY = 86_400_000
const iso = (msAgo) => new Date(Date.parse(NOW) - msAgo).toISOString()
const regOf = (per, generatedUtc = NOW) => ({
  generatedUtc,
  entries: entries().map((e) => ({ ...e, ...(per[e.workflow] ? { observed_failing_steps: per[e.workflow] } : {}) })),
})

describe('C7 登记册读数新鲜度（没人读的字段现在有人读了）', () => {
  it('龄期在限内 ⇒ PASS，且把龄期数字印出来（不是只印一个状态词）', () => {
    const { rows } = base({ registry: regOf({}, iso(DAY)) })
    expect(state(rows, 'C7').ok).toBe(true)
    expect(state(rows, 'C7').detail).toContain('龄期 1.00d')
  })
  it('超限 ⇒ ok=false，且 verdictOf 折成 rc=2（UNVERIFIED）而不是 rc=1（RED）', () => {
    const { rows } = base({ registry: regOf({}, iso(12 * DAY)) })
    expect(state(rows, 'C7').ok).toBe(false)
    expect(state(rows, 'C7').detail).toContain('超 7d')
    expect(verdictOf(rows)).toEqual({ verdict: 'UNVERIFIED', rc: 2 })
  })
  it('册上没有 generatedUtc ⇒ 判"无法判新鲜度"，不得折算成证据仍成立', () => {
    const { rows } = base({ registry: { entries: entries() } })
    expect(state(rows, 'C7').ok).toBe(false)
    expect(state(rows, 'C7').detail).toContain('无法判新鲜度')
  })
  it('generatedUtc 是一坨读不懂的串 ⇒ 也判未验证；解析器禁止返回 0 天（那会伪装成"刚刚生成"）', () => {
    const { rows } = base({ registry: regOf({}, '昨天下午') })
    expect(state(rows, 'C7').ok).toBe(false)
    expect(state(rows, 'C7').detail).toContain('解不出时刻')
    expect(ageOfRegistry('昨天下午', NOW)).toBe(null)
    expect(ageOfRegistry(undefined, NOW)).toBe(null)
    expect(ageOfRegistry(NOW, NOW)).toBe(0)
  })
  it('阈值是读出来的：--max-age-days 收紧到 0.5 天，同一份 1 天前的册必须转红', () => {
    const looser = base({ registry: regOf({}, iso(DAY)), maxAgeDays: 2 })
    const tighter = base({ registry: regOf({}, iso(DAY)), maxAgeDays: 0.5 })
    expect(state(looser.rows, 'C7').ok).toBe(true)
    expect(state(tighter.rows, 'C7').ok).toBe(false)
    expect(state(tighter.rows, 'C7').detail).toContain('超 0.5d')
  })
})

describe('C8 在册失败 step ⇄ 当次实测失败 step（双向差集）', () => {
  const redUptime = { runs: { uptime: [run({ id: 55, conclusion: 'failure', event: 'schedule' })] } }
  it('两侧相等（含乱序）⇒ CONFIRMED，且不因 C6 判红而少报', () => {
    const c = stepCensus(
      [{ workflow: 'uptime.yml', observed_failing_steps: ['A', 'B'] }, { workflow: 'd1-backup.yml' }],
      { 'uptime.yml': ['B', 'A'] },
      [{ file: 'uptime.yml', state: 'RED', warned: false }, { file: 'd1-backup.yml', state: 'OK', warned: false }],
    )
    expect({ due: c.due, confirmed: c.confirmed, drift: c.drift, unreviewed: c.unreviewed }).toEqual({ due: 1, confirmed: 1, drift: 0, unreviewed: 0 })
  })
  it('两侧不等 ⇒ 漂移，并**两个方向各自点名**（只在册 / 只在实测）', () => {
    const c = stepCensus(
      [{ workflow: 'uptime.yml', observed_failing_steps: ['旧理由点名的那一步'] }],
      { 'uptime.yml': ['今天真正红的那一步'] },
      [{ file: 'uptime.yml', state: 'RED', warned: false }],
    )
    expect(c.drift).toBe(1)
    expect(c.driftRows[0]).toEqual({ file: 'uptime.yml', onlyReg: ['旧理由点名的那一步'], onlyLive: ['今天真正红的那一步'] })
  })
  it('册上没字段 / 本轮没取 / 取失败 ⇒ 三种都记未复核，一律不得折进 CONFIRMED', () => {
    const per = [{ file: 'uptime.yml', state: 'RED', warned: false }]
    const noField = stepCensus([{ workflow: 'uptime.yml' }], { 'uptime.yml': ['A'] }, per)
    const notFetched = stepCensus([{ workflow: 'uptime.yml', observed_failing_steps: ['A'] }], {}, per)
    const fetchErr = stepCensus([{ workflow: 'uptime.yml', observed_failing_steps: ['A'] }], { 'uptime.yml': { error: 'boom' } }, per)
    expect([noField.unreviewed, notFetched.unreviewed, fetchErr.unreviewed]).toEqual([1, 1, 1])
    expect([noField.confirmed, notFetched.confirmed, fetchErr.confirmed]).toEqual([0, 0, 0])
    expect(fetchErr.unreviewedRows[0].why).toContain('boom')
  })
  it('两侧都是"没有失败步骤"⇒ CONFIRMED（空集相等是真相等，不是没数据）', () => {
    const c = stepCensus([{ workflow: 'uptime.yml', observed_failing_steps: [] }], { 'uptime.yml': [] }, [{ file: 'uptime.yml', state: 'RED', warned: false }])
    expect(c.confirmed).toBe(1)
    expect(c.unreviewed).toBe(0)
  })
  it('报告档：漂移不翻 rc；拧上 --require-reason-match 才拦（到期轮的那颗开关）', () => {
    const reg = regOf({ 'uptime.yml': ['旧理由点名的那一步'] })
    const live = { 'uptime.yml': ['今天真正红的那一步'] }
    const report = base({ ...redUptime, registry: reg, failingSteps: live })
    expect(state(report.rows, 'C8').ok).toBe(true)
    expect(state(report.rows, 'C8').detail).toContain('漂移 1')
    expect(report.rows.filter((r) => r.ok !== true).map((r) => r.id)).toEqual(['C6'])
    const gated = base({ ...redUptime, registry: reg, failingSteps: live, requireReasonMatch: true })
    expect(state(gated.rows, 'C8').ok).toBe(false)
    expect(state(gated.rows, 'C8').detail).toContain('档位=阻断')
    expect(verdictOf(gated.rows)).toEqual({ verdict: 'RED', rc: 1 })
  })
  it('册上已声称复核过的条目，即使今天不红也必须复核（脱节不该等今天正好红才查）', () => {
    const { rows } = base({ registry: regOf({ 'uptime.yml': ['一条今天已经不红的步骤'] }), failingSteps: { 'uptime.yml': [] } })
    expect(state(rows, 'C8').detail).toContain('应复核 1')
    expect(state(rows, 'C8').detail).toContain('漂移 1')
  })
})

describe('C7 / C8 的演习通道（子进程真跑入口）', () => {
  it('--inject-stale ⇒ rc=2 且点名 C7（尺残不是 cron 病）', () => {
    const { rc, out } = cli(['--fixture', fixtureFile('stale.json', GREEN_FIXTURE()), '--inject-stale'])
    expect(rc, out.slice(-600)).toBe(2)
    expect(out).toContain('C7')
    expect(out).toContain('超 7d')
  })
  it('--inject-step-drift ⇒ 报告档仍 rc=0，但门面行必须印出漂移条数', () => {
    const { rc, out } = cli(['--fixture', fixtureFile('drift1.json', GREEN_FIXTURE()), '--inject-step-drift'])
    expect(rc, out.slice(-600)).toBe(0)
    expect(out).toMatch(/C8 .*漂移 [1-9]/)
  })
  it('同一份注入 + --require-reason-match ⇒ rc=1（开关真的有牙）', () => {
    const { rc, out } = cli(['--fixture', fixtureFile('drift2.json', GREEN_FIXTURE()), '--inject-step-drift', '--require-reason-match'])
    expect(rc, out.slice(-600)).toBe(1)
    expect(out).toContain('档位=阻断')
  })
  it('--max-age-days 写成非正数 ⇒ rc=2，不许悄悄回落默认值', () => {
    const { rc, out } = cli(['--fixture', fixtureFile('age.json', GREEN_FIXTURE()), '--max-age-days=abc'])
    expect(rc, out.slice(-500)).toBe(2)
    expect(out).toContain('解不出正整数')
  })
})
