// 第三十五轮夹具：登记表 ⇄ 生产者双向对账判据的反向验证。
//
// 立它的实证（本轮 Step 0）：`docs/sql-baseline.json` 43 键 vs 分发面 39 条，4 个键没人解释；
// 其中 `amortized:audit-retention-purge` 是第二十八轮的桶、第三十四轮才入册（迟到 6 轮）。
// 现有链路只判"代码里有、登记里没有"，反方向无人守 ⇒ 本文件把两个方向都钉住。
// 每条反例只绑一条判据 id；"真仓全绿"那条是对照，缺了它就不知道红是机制还是永真。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, loadAll, dispatchSurface, PROBE_EXCEPTIONS } from '../scripts/check-registry-sync.mjs'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { assertCliRan } from './helpers/cliLeg.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-registry-sync.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

const real = () => loadAll(REPO)
// 派生输入（不手抄 action 清单）：例外键由 PROBE_EXCEPTIONS 反推，改动分发面时夹具跟着走。
const baseKeys = (s) => s.baselineKeys
const rows = (over) => evaluate({ ...real(), ...over })
const RED = (v, id) => v.filter((r) => r.id === id && !r.ok)

describe('对照与零输入', () => {
  it('真仓现状 ⇒ 6 条判据全绿', () => {
    const v = rows()
    expect(v.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6'])
    expect(v.filter((r) => !r.ok).map((r) => `${r.id} ${r.detail}`)).toEqual([])
  })
  it('R1 反例：分发面为空 ⇒ 红（枚举器断了绝不记 PASS）', () => {
    expect(RED(rows({ pub: new Set() }), 'R1')).toHaveLength(1)
    expect(RED(rows({ baselineKeys: [] }), 'R1')).toHaveLength(1)
  })
  it('R1 反例：全文件 case 数 ≠ 两段去重数 ⇒ 点名"别处新增了 switch"', () => {
    const v = RED(rows({ totalCases: 41 }), 'R1')
    expect(v).toHaveLength(1)
    expect(v[0].detail).toContain('别处新增了 switch')
  })
  it('anchorLost 分支可达：源码里没有两个 handler ⇒ 只回一条红且说明原因', () => {
    const s = dispatchSurface('export const nothing = 1\n')
    expect(s.anchorLost).toBe(true)
    const v = evaluate({ ...s, apiActions: [], baselineKeys: [], contractKeys: [] })
    expect(v).toHaveLength(1)
    expect(v[0].id).toBe('R1')
    expect(v[0].ok).toBe(false)
  })
})

describe('双向差集：漏登与幽灵各绑一条', () => {
  it('R2 反例：契约里删一条 ⇒ 点名"代码有契约无"；契约里加一条 ⇒ 点名"契约有代码无"', () => {
    const s = real()
    const fewer = s.apiActions.slice(1)
    expect(RED(rows({ apiActions: fewer }), 'R2')[0].detail).toContain('代码有契约无')
    const more = [...s.apiActions, '/web ghostAction']
    expect(RED(rows({ apiActions: more }), 'R2')[0].detail).toContain('契约有代码无')
  })
  it('R3 反例：基线少一键 ⇒ 报"基线缺键"（新调用路径没入册）', () => {
    const s = real()
    expect(RED(rows({ baselineKeys: baseKeys(s).slice(1) }), 'R3')[0].detail).toContain('基线缺键')
  })
  it('R3 反例：基线多一个未解释键 ⇒ 报"基线多键未解释"（这正是 R28 那条迟到 6 轮的形态）', () => {
    const v = RED(rows({ baselineKeys: [...baseKeys(real()), 'A:removedLongAgo'] }), 'R3')
    expect(v).toHaveLength(1)
    expect(v[0].detail).toContain('A:removedLongAgo')
  })
  it('R3 对偶：把未解释键写进例外册 ⇒ 转绿（门禁必须收得下真话）', () => {
    const ex = {
      ...PROBE_EXCEPTIONS,
      'probe-tmp': { covers: ['A:removedLongAgo'], reason: '夹具：`node scripts/check-registry-sync.mjs` 实测 1 条，登记此键的来历' },
    }
    const v = rows({ baselineKeys: [...baseKeys(real()), 'A:removedLongAgo'], exceptions: ex })
    expect(RED(v, 'R3')).toEqual([])
    expect(RED(v, 'R4')).toEqual([])
  })
  it('R6 反例：形状表里塞一个不存在的 action ⇒ 点名幽灵条目', () => {
    const s = real()
    const v = RED(rows({ contractKeys: [...s.contractKeys, '/pub ghostNeverDispatched'] }), 'R6')
    expect(v).toHaveLength(1)
    expect(v[0].detail).toContain('ghostNeverDispatched')
  })
})

describe('例外册自身的两条防线（借 rust-lang/rust tidy 的口径）', () => {
  it('R4 反例：例外册留一条对不上任何登记键的 ⇒ 红，并给出删除指引', () => {
    const ex = {
      ...PROBE_EXCEPTIONS,
      'stale-exception': { covers: ['P:somethingGone'], reason: '这条例外的对象早就不在了：`node --version` 实测 1 处引用' },
    }
    const v = RED(rows({ exceptions: ex }), 'R4')
    expect(v).toHaveLength(1)
    expect(v[0].detail).toContain('Remove from PROBE_EXCEPTIONS')
  })
  it('R5 反例：例外理由退化成不可证伪的散文 ⇒ 红', () => {
    const ex = {
      ...PROBE_EXCEPTIONS,
      'P:x': { covers: ['A:noSuchAction'], reason: '应该没什么问题吧' },
    }
    const v = RED(rows({ exceptions: ex }), 'R5')
    expect(v).toHaveLength(1)
    expect(v[0].detail).toContain('不可证伪')
  })
  it('R5 对偶：理由只要带一个实测数字就合格（不要求文采）', () => {
    const ex = { 'only-number': { covers: ['A:noSuchAction'], reason: '未知 action 探针实测 3 条拒绝记录，故该键在两处登记里合法存在' } }
    expect(RED(rows({ exceptions: ex }), 'R5')).toEqual([])
    // 注意 R4 会同时判它"覆盖了不存在的键"？不会 —— noSuchAction 在册，所以两向都过。
    expect(RED(rows({ exceptions: ex }), 'R4')).toEqual([])
  })
  it('真仓现状：例外册 4 条、声明 7 个键，逐条可证伪', () => {
    expect(Object.keys(PROBE_EXCEPTIONS)).toHaveLength(4)
    expect(new Set(Object.values(PROBE_EXCEPTIONS).flatMap((e) => e.covers)).size).toBe(7)
  })
})

describe('CLI 入口：真仓子进程 + 缺输入面 fail-closed', () => {
  it('① 真跑：GATE-PASS 且 6 条检查数对得上、rc=0', () => {
    const r = assertCliRan(spawnSync(process.execPath, [SELF], { cwd: REPO, encoding: 'utf8', timeout: 120_000 }), { label: 'registry-sync 真跑 GATE-PASS' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('GATE-PASS registry-sync')
    expect(r.stdout).toMatch(/检查 6\/6 通过，0 失败/)
    expect(r.stdout).toContain('matched 6/mismatched 0')
  })
  it('② 缺输入面：只有脚本、没有 functions/ 与 docs/ 的夹具仓 ⇒ rc=2 且点名缺哪个文件', () => {
    // 脚本按自身位置锚仓根（root = scripts/..），所以"换个 cwd"是无效变异 ——
    // 必须造一个**只有 scripts/ 的假仓**才真的把取数面抽掉。
    const dir = mkdtempSync(join(tmpdir(), 'smreg-'))
    tmpDirs.push(dir)
    copyGateScripts(REPO, dir, 'check-registry-sync.mjs')
    const r = assertCliRan(spawnSync(process.execPath, [join(dir, 'scripts', 'check-registry-sync.mjs')], { cwd: dir, encoding: 'utf8', timeout: 120_000 }), { label: 'registry-sync 缺输入面假仓' })
    expect(r.status).toBe(2)
    const out = `${r.stderr}${r.stdout}`
    expect(out).toMatch(/registry-sync/)
    expect(out).toMatch(/backend\.js|api-contract/)
  })
  it('③ --json 通道：合法 JSON 且 rows 数为 6（门面行与机器输出同源）', () => {
    const r = assertCliRan(spawnSync(process.execPath, [SELF, '--json'], { cwd: REPO, encoding: 'utf8', timeout: 120_000 }), { label: 'registry-sync --json 通道' })
    expect(r.status).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.rows).toHaveLength(6)
    expect(j.ok).toBe(true)
  })
})
