// 第四十二轮夹具：**每条 cron 的"最近一次"是不是红的**（C1~C6 七道腿）。
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
import { evaluate, verdictOf, cronPeriodDays, enumerateScheduled } from '../scripts/check-cron-health.mjs'

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
  registry: { entries: [{ workflow: 'd1-backup.yml' }, { workflow: 'uptime.yml' }] },
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
  const out = evaluate({
    workflows: WF, remote: REMOTE, nowIso: NOW,
    runsByName: {
      'd1-backup.yml': runs.backup ?? [run()],
      'uptime.yml': runs.uptime ?? [run({ id: 2, event: 'schedule' })],
    },
    registry, ...rest,
  })
  return out
}

describe('cron 普查 · 正例', () => {
  it('两条 cron 全绿 ⇒ 七道腿（C1/C2/C3/C3b/C4/C5/C6）全过、rc=0', () => {
    const { rows } = base()
    expect(rows.filter((r) => r.ok !== true).map((r) => r.id)).toEqual([])
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
  it('喂绿色合成读数 ⇒ rc=0，门面行印"声明 2 条"与 7/7', () => {
    const f = fixtureFile('green.json', GREEN_FIXTURE())
    const { rc, out } = cli(['--fixture', f])
    expect(rc, out.slice(-600)).toBe(0)
    expect(out).toContain('GATE-PASS cron-health')
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
