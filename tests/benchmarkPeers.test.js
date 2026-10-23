/**
 * 对标取证载体（第五十九轮 H-59-2）的入口真跑 + 形状断言。
 * 口径：`--selftest` 与"缺名册门口 bail"两条腿都用**子进程**跑（import 纯函数不算被测），
 * 全程不触网 —— 网络面只在 `--selftest` 的打桩 call 里存在。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCliRan } from './helpers/cliLeg.js'
import { lastPageFromLink, sinceIso, measureOne, resolveLedgerPath, ledgerAgeDays, LEDGER_DEFAULT } from '../scripts/benchmark-peers.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts', 'benchmark-peers.mjs')
const BUDGET = 20_000

const run = (args, cwd = REPO) => assertCliRan(
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: BUDGET }),
  { label: `benchmark-peers ${args.join(' ') || '(real)'}`, budgetMs: BUDGET },
)

describe('benchmark-peers：Link 头与窗口', () => {
  it('反例：`per_page=1` 里也含 "page="，锚点必须是 [?&]page=（本轮实测踩过：错写时所有仓贡献者数恒为 1）', () => {
    expect(lastPageFromLink('<https://api.github.com/x?per_page=1&page=280>; rel="last"')).toBe(280)
    expect(lastPageFromLink('<https://api.github.com/x?per_page=1&page=2>; rel="next"')).toBe(null)
    expect(lastPageFromLink('')).toBe(null)
    expect(lastPageFromLink(null)).toBe(null)
  })

  it('窗口起点按 UTC 且不带毫秒（对方与我方必须同一把尺）', () => {
    expect(sinceIso(Date.UTC(2026, 9, 1, 12, 0, 0), 30)).toBe('2026-09-01T12:00:00Z')
  })

  it('反例：取不到的一面一律 null，输出串里不得出现 "stars":0 这种"把没测折成测到 0"', () => {
    const rec = measureOne('x/y', { sinceIso: 's', call: () => ({ err: 'Not Found' }) })
    const json = JSON.stringify(rec)
    expect(rec.stars).toBe(null)
    expect(rec.commitsInWindow).toBe(null)
    expect(rec.status).toBe('UNAVAILABLE')
    expect(json).not.toContain('"stars":0')
    expect(rec.unavailable.length).toBeGreaterThan(3)
  })
})

describe('benchmark-peers：入口必须被子进程真跑过', () => {
  it('--selftest ⇒ rc=0 且印出自证 token（条数随腿数走，不钉死数字；第七十八轮起钉 ≥9 防退腿）', () => {
    const r = run(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('[GATE:peers-selftest-pass]')
    const m = r.stdout.match(/selftest: (\d+)\/\1 通过/)
    expect(m, '自证行形态未变').toBeTruthy()
    expect(Number(m[1]), 'selftest 腿数').toBeGreaterThanOrEqual(9)
  })

  it('缺名册 ⇒ 在第一次 gh 调用之前就 fail-closed 退出（rc=2，且点名不可解析的输入面）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smrpeers-'))
    try {
      const r = run([], dir)
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toContain('benchmark-peers.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--offline ⇒ 全部面按不可得计（rc=2），一条名册记录都不折算成 0', () => {
    const r = run(['--offline'])
    expect(r.status).toBe(2)
    expect(r.stdout).toContain('GATE-UNVERIFIED')
    expect(r.stdout).toContain('全面可得 0')
    expect(r.stdout).not.toMatch(/star=0\s/)
  })

  it('--no-json（第七十八轮演练面）⇒ 零触网、不落盘、不打印龄期提示（裸跑的"当面喊龄期"只属于真量过的面）', () => {
    const r = run(['--no-json'])
    expect(r.status).toBe(2)
    expect(r.stdout).toContain('演练面')
    expect(r.stdout).not.toContain('本次未落盘')
    expect(r.stdout).not.toContain('台账已落')
  })

  it('裸跑（live）不落盘但必须当面报台账龄期（第七十八轮：转引病生成器的闸）——子进程真跑一次不现实（触网），此腿断纯函数', () => {
    // resolveLedgerPath([])===null：裸跑不写；ledgerAgeDays 对坏件/畸形一律 null 不折算 0
    expect(resolveLedgerPath([])).toBe(null)
    expect(resolveLedgerPath(['--json'])).toBe(LEDGER_DEFAULT)
    expect(ledgerAgeDays('{oops')).toBe(null)
    expect(ledgerAgeDays(JSON.stringify({ measuredAt: '2026-10-17T00:00:00Z' }), Date.parse('2026-10-24T12:00:00Z')).days).toBe(7)
  })
})
