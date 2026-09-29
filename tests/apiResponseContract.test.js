// 第二十七轮夹具：action 响应形状契约判据的双向变异审计。
//
// 立它的实证：`docs/api-contract.json` 在册 39 个 action，但**没有任何一条断言比过响应字段集合**
// （verify-backend 的 118 条断言里 `Object.keys(...data)` 命中 0）。也就是说后端少回一个字段、
// 或偷偷加一个可选字段，今天没有任何闸会红。本文件负责让"形状"这件事变成会红的东西。
//
// 两条腿的分工：V2~V6 的**逻辑反例**复用一份已取到的真录制（RESPONSE_CONTRACT_IN，秒级），
// "真流量那一腿"由下面 `真仓跑真流量` 用例独立承担 —— 反例不必每次重跑全链，但也不许拿假数据糊过去。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluate, deriveEntry, apiActions, CONTRACT, API_CONTRACT,
} from '../scripts/api-response-contract.mjs'
import { shapeOf } from '../scripts/lib/response-shape.mjs'
import { assertCliRan } from './helpers/cliLeg.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF_SCRIPT = join(REPO, 'scripts', 'api-response-contract.mjs')
const BACKEND_RUNNER = join(REPO, 'scripts', 'verify-backend.mjs')
const tmpDirs = []
const committed = JSON.parse(readFileSync(join(REPO, CONTRACT), 'utf8')).entries
const api = apiActions(REPO)

// 取一份真录制（verify-backend 跑一遍即可），供逻辑反例与假仓用例复用
const recDir = mkdtempSync(join(tmpdir(), 'smrec-'))
tmpDirs.push(recDir)
const RECORDING = join(recDir, 'shapes.json')
const rec = assertCliRan(spawnSync(process.execPath, [BACKEND_RUNNER], {
  cwd: REPO, encoding: 'utf8', timeout: 120_000,
  env: { ...process.env, RESPONSE_CONTRACT_OUT: RECORDING },
}), { label: 'api-response-contract 取录制(verify-backend)' })
if (rec.status !== 0) throw new Error(`取录制失败 rc=${rec.status}: ${String(rec.stderr).slice(-300)}`)

const clone = (o) => JSON.parse(JSON.stringify(o))
const producingOf = (set) => Object.keys(set).filter((k) => (set[k].envelopeSeen || []).length > 0)
/** 缺口集由 covered 反推（派生值；不在夹具里手抄 action 清单）。理由须可证伪（V3 第三十五轮起核）。 */
const gapsForAll = (set) => Object.fromEntries(
  api.filter((k) => !producingOf(set).includes(k))
    .map((k) => [k, '夹具用：本轮实测 0 条成功形状，`node scripts/verify-backend.mjs` 无该 action 的正向探针']),
)
const ev = (over = {}) => evaluate({
  derived: clone(committed), committed, apiActions: api, gaps: gapsForAll(committed), ...over,
})
const row = (rows, id) => rows.find((r) => r.id === id)
const LIST_KEY = '/web getOrders'   // 数组型样本（有 keysAlways）
const OBJ_KEY = Object.keys(committed).find((k) => committed[k].dataKinds.includes('object'))

/** 假仓：脚本按自身位置锚仓根，所以要连 scripts/ 一起拷，再只改基准文件。 */
function fakeRepo(contractObj) {
  const dir = mkdtempSync(join(tmpdir(), 'smresp-'))
  tmpDirs.push(dir)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, API_CONTRACT), readFileSync(join(REPO, API_CONTRACT), 'utf8'))
  if (contractObj) writeFileSync(join(dir, CONTRACT), JSON.stringify(contractObj, null, 2) + '\n')
  return dir
}
const runIn = (dir, inPath = RECORDING) => assertCliRan(spawnSync(
  process.execPath, [join(dir, 'scripts', 'api-response-contract.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...process.env, RESPONSE_CONTRACT_IN: inPath },
  }), { label: 'api-response-contract 假仓子进程' })

describe('shapeOf / deriveEntry：形状口径本身', () => {
  it('正向：信封键、data 形态、顶层键都排序稳定（契约文件要可 diff）', () => {
    expect(shapeOf({ data: { b: 1, a: 2 }, code: 0 }))
      .toEqual({ envelope: ['code', 'data'], dataKind: 'object', keys: ['a', 'b'] })
    expect(shapeOf({ code: 0, data: [{ x: 1 }, { y: 2 }] }).keys).toEqual(['x', 'y'])
  })
  it('三种"没有内容"必须分得开：无 data 键 / data:null / data 是标量', () => {
    // 把"返回 0"读成"没返回"、把失败信封读成"返回了 null"，都是把形状判错的方向
    expect(shapeOf({ code: -1, message: 'x' }).dataKind).toBe('absent')
    expect(shapeOf({ code: 0, data: null }).dataKind).toBe('null')
    expect(shapeOf({ code: 0, data: 0 }).dataKind).toBe('scalar')
    expect(shapeOf({ code: 0, data: '' }).dataKind).toBe('scalar')
  })
  it('deriveEntry：交集=保证有、并集=可能出现', () => {
    const e = deriveEntry({
      side: '/pub', action: 'createOrder', calls: 2,
      ok: [shapeOf({ code: 0, data: { id: 'a', totalAmount: 1 } }),
        shapeOf({ code: 0, data: { id: 'a', totalAmount: 1, deduplicated: true } })],
      err: [],
    })
    expect(e.keysAlways).toEqual(['id', 'totalAmount'])
    expect(e.keysSeen).toEqual(['deduplicated', 'id', 'totalAmount'])
  })
})

describe('V1~V6 双向变异', () => {
  it('正向：实测=契约、缺口全部具名 ⇒ 六条全过', () => {
    const rows = ev()
    expect(rows.map((r) => r.id)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6'])
    expect(rows.filter((r) => !r.ok).map((r) => `${r.id} ${r.detail}`)).toEqual([])
  })
  it('V1 反例：录制为空 ⇒ 判红（零输入不得 PASS）', () => {
    expect(row(ev({ derived: {} }), 'V1').ok).toBe(false)
  })
  it('V2 反例：实测里有成功响应却没在 api-contract 在册 ⇒ 点名幽灵', () => {
    const ghost = clone(committed)
    ghost['/web ghostAction'] = { ...ghost[LIST_KEY], action: 'ghostAction' }
    const v = row(ev({ derived: ghost }), 'V2')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('ghostAction')
  })
  it('V3 反例：漏登记缺口 ⇒ 红；把已覆盖的挂成缺口 ⇒ 幽灵登记同样红', () => {
    // 「漏登记」这一腿必须**自己造出有缺口的前提**。第三十四轮前它写成 `ev({ gaps: {} })`，
    // 靠的是 RESPONSE_GAPS 里真有一条 `/pub aiChat` —— 那轮把它清零后，`gaps: {}` 与真实态
    // 逐字节相同，"反例"退化成正向，判据正确地不红：**假过的是夹具，不是判据**。
    // 现在的前提由"抽掉一条已覆盖的录制"造出来（uncovered 里必然有它），与缺口表内容无关。
    const covered = producingOf(committed)[0]
    const lost = clone(committed)
    delete lost[covered]
    const missing = row(ev({ derived: lost, gaps: {} }), 'V3')
    expect(missing.ok).toBe(false)
    expect(missing.detail).toContain('未登记缺口')
    expect(missing.detail).toContain(covered)
    // 门禁必须收得下真话：给被抽掉那条补上理由 ⇒ V3 转绿（否则是在逼虚报"零缺口"）
    expect(row(ev({ derived: lost, gaps: { ...gapsForAll(committed), [covered]: '夹具：本轮抽掉 1 条录制（derived 实测少 1 项）' } }), 'V3').ok).toBe(true)
    // 前提自证：被抽掉那条必须**确实在册**，否则 uncovered 根本装不下它，这条反例会静默失去牙齿
    expect(api).toContain(covered)
    expect(producingOf(committed).length).toBeGreaterThan(0)
    const phantom = row(ev({ gaps: { ...gapsForAll(committed), [covered]: '这条实测已有 1 次成功响应（calls≥1），挂着就是幽灵行' } }), 'V3')
    expect(phantom.ok).toBe(false)
    expect(phantom.detail).toContain('幽灵登记')
    expect(phantom.detail).toContain(covered)
    // 理由质量腿（第三十五轮 V3 扩）：RESPONSE_GAPS 今天**是空集** ⇒ 这条必须自造前提，
    // 否则它和上一轮那个失效的 `gaps: {}` 变异体同形：没有样本的判据＝没有牙齿。
    const thin = row(ev({ derived: lost, gaps: { [covered]: '这个跑不通大概是环境问题吧' } }), 'V3')
    expect(thin.ok).toBe(false)
    expect(thin.detail).toContain('不可证伪')
    expect(thin.detail).toContain(covered)
    // 红因只许来自这一条（㉓ red_sub）：缺口本身已具名、也没挂幽灵 ⇒ 若混进另两类就是夹具没造干净
    expect(thin.detail).not.toContain('未登记缺口')
    expect(thin.detail).not.toContain('幽灵登记')
  })
  it('V4 反例：字段少一个 / 整条没录到都必须红，且 detail 要指出差在哪个字段', () => {
    const drifted = clone(committed)
    drifted[LIST_KEY].keysSeen = ['_id']
    const v = row(ev({ derived: drifted }), 'V4')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('keysSeen')
    const removed = clone(committed)
    delete removed[LIST_KEY]
    expect(row(ev({ derived: removed }), 'V4').detail).toContain('实测没录到')
  })
  it('V5 反例：新增一个"时有时无"的字段却没具名 ⇒ 红（新可选字段不能只有加它的人知道）', () => {
    const withCond = clone(committed)
    withCond[LIST_KEY].keysSeen = [...new Set([...withCond[LIST_KEY].keysSeen, 'mystery'])].sort()
    const v = row(ev({ derived: withCond }), 'V5')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain(`${LIST_KEY}.mystery`)
  })
  it('V6 反例：对象型响应却没有任何保证字段 ⇒ 红；数组型不适用该条', () => {
    const hollow = clone(committed)
    hollow[OBJ_KEY].keysAlways = []
    expect(row(ev({ derived: hollow }), 'V6').ok).toBe(false)
    const arrHollow = clone(committed)
    arrHollow[LIST_KEY].keysAlways = []
    expect(row(ev({ derived: arrHollow }), 'V6').ok).toBe(true)
  })
})

describe('真入口与真流量（子进程）', () => {
  it('真仓跑真流量：GATE-PASS 且六条检查数对得上', () => {
    const r = assertCliRan(spawnSync(process.execPath, [SELF_SCRIPT], { cwd: REPO, encoding: 'utf8', timeout: 120_000 }), { label: 'api-response-contract 真仓真流量' })
    const out = `${r.stdout}${r.stderr}`
    expect(r.status, out.slice(-800)).toBe(0)
    expect(out).toContain('GATE-PASS response-contract')
    expect(out).toContain('检查 6/6 通过，0 失败')
  }, 300_000)

  it('变异体：基准里删掉一个 keysAlways 字段 ⇒ 真入口必须红且点名该字段', () => {
    const tampered = clone(committed)
    const before = tampered[LIST_KEY].keysAlways.length
    tampered[LIST_KEY].keysAlways = tampered[LIST_KEY].keysAlways.filter((k) => k !== 'items')
    expect(tampered[LIST_KEY].keysAlways.length, '锚点字段本来就不在 keysAlways 里 ⇒ 变异是空的').toBe(before - 1)
    const r = runIn(fakeRepo({ version: 1, entries: tampered }))
    const out = `${r.stdout}${r.stderr}`
    expect(r.status, '基准被动过却仍判通过 ⇒ 漂移对例没有牙齿').toBe(1)
    expect(out).toContain('keysAlways')
    expect(out).toContain('GATE-FAIL')
  }, 300_000)

  it('缺基准文件一律 fail-closed（rc=2 + 人话），不把"没基准"读成"没漂移"', () => {
    const r = runIn(fakeRepo(null))
    const out = `${r.stdout}${r.stderr}`
    expect(r.status, out.slice(-400)).toBe(2)
    expect(out).toContain('环境不满足')
    expect(out).not.toMatch(/^\s*(node:|file:\/\/|\s+at\s)/)
  }, 300_000)

  it('录制注入点不能变成绕过口：指向不存在的路径 ⇒ 同样 rc=2', () => {
    const dir = fakeRepo({ version: 1, entries: clone(committed) })
    const r = runIn(dir, join(dir, 'nope.json'))
    const out = `${r.stdout}${r.stderr}`
    expect(r.status, out.slice(-400)).toBe(2)
    expect(out).toContain('RESPONSE_CONTRACT_IN')
  }, 300_000)
})

afterAll(() => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 清理失败不改结论 */ } }
})
