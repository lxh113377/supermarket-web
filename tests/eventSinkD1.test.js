/**
 * 事件落库真 D1 驱动的**子进程真跑**夹具（第六十一轮 H-61-3）。
 *
 * 为什么必须有这件而不是"我本机跑过一次"：第五十九轮 §8 / 第六十轮 §8 把"线上是否真收到事件"
 * 写成回读 `SELECT COUNT(*) FROM event_log`，本轮实测 n=0 —— 但同一批查询给出上线后窗口内
 * **一单都没有**（`orders` 最后一单 2026-10-01T12:44Z，含 sink 的部署 18:41Z 才上线）
 * ⇒ 那条判据等的是别人家的流量，永远不可主动闭合。本件把判定力搬回仓内：
 * 正例必须 rc=0，反向腿（不建表）必须 rc=1 且红因点名 `no such table`。
 *
 * 口径：起真实 workerd/miniflare 的 D1 绑定（`persist:false` ⇒ 不写 .wrangler、不碰远端、零生产数据），
 * 调的是 `functions/lib/event_sink.js` 本体，不是它的假体复写。
 * 天花板：单条 120_000ms，与 vitest 的 testTimeout=130_000 由 tests/testCeilings.test.js 钉住对齐。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { assertCliRan } from './helpers/cliLeg.js'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'verify-event-sink-d1.mjs')
const SPAWN_MS = 120_000

const run = (args) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
  cwd: REPO, encoding: 'utf8', timeout: SPAWN_MS,
}))

describe('verify-event-sink-d1：真 D1 驱动两侧都有判定力', () => {
  it('正例：rc=0 且门面行 PASS（emit → drainAndStore → SELECT 读回四字段）', () => {
    const r = run([])
    const out = `${r.stdout || ''}${r.stderr || ''}`
    if (r.status === 2) throw new Error(`环境取不到（rc=2）＝本夹具的输入面不满足，不许当通过：\n${out}`)
    expect(r.status, out).toBe(0)
    expect(out).toContain('GATE-PASS event-sink-d1')
    // 具体读数而不是状态词：只有"确实落库并被读回"才算， rc=0 配 null 读数是自洽的假绿形状
    expect(out).toContain('"n":1')
    expect(out).toContain('"st":"paid"')
  }, SPAWN_MS)

  it('反向腿：跳过建表必须 rc=1 且红因点名 no such table（否则正例的绿是恒真）', () => {
    const r = run(['--negative=missing-table'])
    const out = `${r.stdout || ''}${r.stderr || ''}`
    expect(r.status, out).toBe(1)
    expect(out).toContain('GATE-FAIL event-sink-d1')
    expect(out).toMatch(/no such table: event_log/)
  }, SPAWN_MS)

  it('纯函数档：--selftest 9 条含三档退出码归属（2 不得与 0/1 同形）', () => {
    const r = run(['--selftest'])
    const out = `${r.stdout || ''}${r.stderr || ''}`
    expect(r.status, out).toBe(0)
    expect(out).toMatch(/GATE-PASS sink-d1-selftest :: 9\/9/)
  })
})
