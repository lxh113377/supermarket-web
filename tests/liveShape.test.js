// 第三十八轮夹具：线上形状 ⇄ 本仓声明键集比对（live-shape）。
// 立它的两条一手读数：15:40Z 线上无 deploy 键（旧构建）；16:0xZ 同端点 deploy=a19cc0e == 本地 HEAD
// （push 自动部署已把漂移消掉）⇒ 这条判据量的是**变化中的事实**，所以它的每个状态都得可演习。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { declaredKeys, evaluate, HEALTH_SOURCE } from '../scripts/check-live-shape.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-live-shape.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'smls-')); tmpDirs.push(d); return d }
const row = (rows, id) => rows.find((r) => r.id === id)
const declared = ['status', 'db', 'ts', 'ai', 'deploy']

describe('键集从源码推导（不是手抄清单）', () => {
  it('真仓 _health.js 推出的顶层键就是那 5 个（手抄清单会在下一次加字段时变成新的"只有措辞在守"）', () => {
    expect(declaredKeys(readFileSync(HEALTH_SOURCE, 'utf8'))).toEqual(declared)
  })
  it('能改：换一个对象字面量就得换一批键（证明它真的在读 AST，不是返回常量）', () => {
    const other = "export function h({ env }) { return new Response(JSON.stringify({ foo: 1, bar: { baz: 2 } }), { headers: {} }) }"
    expect(declaredKeys(other)).toEqual(['foo', 'bar'])
  })
  it('找不到对象字面量 ⇒ null（"没推导出来"不得伪装成空数组 = 零分母）', () => {
    expect(declaredKeys('export const x = 1')).toBe(null)
  })
})

describe('evaluate：三态分明，未观测不与通过同形', () => {
  it('键集相等 ⇒ MATCH', () => {
    const v = evaluate({ declared, live: { status: 'ok', db: 'ok', ts: 't', ai: {}, deploy: 'abc1234' }, liveStatus: 200, localSha: 'abc1234' })
    expect(row(v, 'L2').state).toBe('MATCH')
    expect(row(v, 'L3').state).toBe('PASS')
  })
  it('线上缺 deploy ⇒ STALE 并点名它（本判据存在的唯一理由）', () => {
    const v = evaluate({ declared, live: { status: 'ok', db: 'ok', ts: 't', ai: {} }, liveStatus: 200, localSha: 'abc1234' })
    expect(row(v, 'L2').state).toBe('STALE')
    expect(row(v, 'L2').detail).toContain('deploy')
    expect(row(v, 'L3').state).toBe('STALE')
    expect(row(v, 'L3').detail).toContain('N3 部署欠账')
  })
  it('线上多出本仓没有的键 ⇒ 也判漂移（不许只测"少了"这一半）', () => {
    const v = evaluate({ declared, live: { status: 'ok', db: 'ok', ts: 't', ai: {}, deploy: 'a1b2c3d', surprise: 1 }, liveStatus: 200, localSha: 'a1b2c3d' })
    expect(row(v, 'L2').state).toBe('STALE')
    expect(row(v, 'L2').detail).toContain('surprise')
  })
  it('deploy 值与本地 HEAD 不同 ⇒ STALE 且两个 sha 都印出来（可比对，不用猜）', () => {
    const v = evaluate({ declared, live: { status: 'ok', db: 'ok', ts: 't', ai: {}, deploy: 'dead111' }, liveStatus: 200, localSha: 'feed999' })
    expect(row(v, 'L3').state).toBe('STALE')
    expect(row(v, 'L3').detail).toContain('dead111')
    expect(row(v, 'L3').detail).toContain('feed999')
  })
  it('线上回空对象 ⇒ FAIL（那不是本端点的形状，多半被网关吞了）', () => {
    expect(row(evaluate({ declared, live: {}, liveStatus: 200 }), 'L2').state).toBe('FAIL')
  })
  it('取不到 ⇒ UNREACHABLE；既不算通过也不算漂移（禁把网络态记成代码态）', () => {
    const v = evaluate({ declared, live: null, liveStatus: 'err:fetch failed' })
    expect(row(v, 'L2').state).toBe('UNREACHABLE')
    expect(v.some((r) => r.state === 'FAIL' || r.state === 'MATCH')).toBe(false)
  })
  it('声明推不出来 ⇒ 只出 L1 UNVERIFIED 一行（无声明可比时不产任何结论）', () => {
    const v = evaluate({ declared: null, live: { status: 'ok' }, liveStatus: 200 })
    expect(v.map((r) => r.id)).toEqual(['L1'])
    expect(v[0].state).toBe('UNVERIFIED')
  })
})

describe('CLI 真跑（注入态确定性；advisory 不许阻断）', () => {
  const run = (env = {}, cwd = REPO) => {
    const r = spawnSync(process.execPath, [SELF], { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 })
    return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
  }
  it('注入缺 deploy 的线上响应 ⇒ rc=0（advisory 不阻断）但判 GATE-STALE 并点名 deploy', () => {
    const { rc, out } = run({ LIVE_SHAPE_JSON: JSON.stringify({ status: 'ok', db: 'ok', ts: 'x', ai: {} }) })
    expect(rc, out.slice(-400)).toBe(0)
    expect(out).toContain('GATE-STALE live-shape')
    expect(out).toContain('deploy')
  })
  // 用**当前真 HEAD** 造注入响应：造出来的才可能是 PASS；写死一个假 sha 会稳定判 STALE，
  // 那条腿就成了"期望自己造出来的红"（本轮夹具第一版正是这个错）。
  const HEAD = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim()
  it('注入同型响应（deploy == 本地 HEAD）⇒ GATE-PASS 且 已核 + 漂移 + 未观测 + 失败 == 声明', () => {
    const { rc, out } = run({ LIVE_SHAPE_JSON: JSON.stringify({ status: 'ok', db: 'ok', ts: 'x', ai: {}, deploy: HEAD }) })
    expect(rc, out.slice(-400)).toBe(0)
    expect(out).toContain('GATE-PASS live-shape')
    const m = /已核 (\d+)\/(\d+)｜漂移 (\d+)｜未观测 (\d+)｜失败 (\d+)/.exec(out)
    expect(m, `门面行形状变了：${out.split('\n').pop()}`).toBeTruthy()
    expect(Number(m[1]) + Number(m[3]) + Number(m[4]) + Number(m[5])).toBe(Number(m[2]))
  })
  it('注入值不是 JSON ⇒ rc=2（不猜线上形状），且不印 GATE 结论行', () => {
    const { rc, out } = run({ LIVE_SHAPE_JSON: '{not json' })
    expect(rc, out.slice(-400)).toBe(2)
    expect(out).not.toContain('GATE-')
  })
  it('没有 functions/_health.js 的假仓 ⇒ rc=2 点名取不到（缺输入面不静默）', () => {
    const dir = tmp()
    copyGateScripts(REPO, dir, 'check-live-shape.mjs')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ls-fix' }))
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-live-shape.mjs')], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(2)
  })
})
