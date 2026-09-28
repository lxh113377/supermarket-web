// 第四十六轮：**两条天花板必须互相对齐** —— 测试自己的超时 ≥ 它给子进程设的预算。
// 一手触发点（本机 @2026-09-28）：`npm run verify` 里 `tests/memoryPointerSync.test.js` 的一条子进程用例
// 报 `Error: Test timed out in 5000ms.`；单跑该文件实测 1.37s 全绿、判据本身 0.36s ⇒ 争用抖动，不是代码坏了。
// 往下挖才发现这是系统性的：`tests/` 下 **17 个文件**用 spawnSync 真跑入口，预算写的是 30s/60s/120s，
// 而**没有一条**给 `it()` 设 timeout ⇒ 它们全跑在 vitest 默认 5s 上（差 24 倍）。
// 红的时候被怀疑的是夹具/并发，真正的缺陷是"两个天花板各说各话"。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTestSourceFile } from '../scripts/check-cli-entrypoints.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const num = (s) => Number(String(s).replace(/_/g, ''))

/** 从 vite.config.js 读 vitest 的每测试天花板（读不到就算 5000 = vitest 默认）。 */
function configCeiling(cfg) {
  const m = /testTimeout\s*:\s*([0-9_]+)/.exec(cfg)
  return m ? num(m[1]) : 5000
}
/** tests/ 里给子进程设的最大预算（`timeout: N` 形态，忽略 vitest 自己的 timeout）。 */
function maxSpawnBudget(srcs) {
  let max = 0
  for (const s of srcs) for (const m of s.matchAll(/spawnSync\([\s\S]{0,400}?timeout\s*:\s*([0-9_]+)/g)) max = Math.max(max, num(m[1]))
  return max
}
/** 对齐判据：调用方天花板必须 ≥ 被调方预算（留 5s 收尾余量）。 */
export function ceilingsAligned(ceiling, budget, slack = 5000) {
  return ceiling >= budget + slack
}

const CFG = readFileSync(join(REPO, 'vite.config.js'), 'utf8')
const TEST_SRC = readdirSync(join(REPO, 'tests'))
  .filter((f) => isTestSourceFile(f))
  .map((f) => readFileSync(join(REPO, 'tests', f), 'utf8'))

describe('天花板对齐（测试超时 ⇄ 子进程预算）', () => {
  const ceiling = configCeiling(CFG)
  const budget = maxSpawnBudget(TEST_SRC)

  it('分母自证：取数面非空，且确实扫到了子进程夹具（扫不到就是采集面坏了）', () => {
    expect(TEST_SRC.length).toBeGreaterThan(50)
    const withSpawn = TEST_SRC.filter((s) => /spawnSync\(/.test(s)).length
    expect(withSpawn).toBeGreaterThanOrEqual(10)
    expect(budget).toBeGreaterThan(5000)
    // 三个数（文件数/预算/天花板）由断言本身承载；这里不再 console.log —— `oxlint --max-warnings 0` 会拦，
    // 而且数值一旦进断言消息就能在失败输出里看到，没必要占一条 stdout 通道。
    expect(ceiling).toBeGreaterThan(budget)
  })

  it('正向：vitest 的每测试天花板 ≥ 最大子进程预算 + 收尾余量', () => {
    expect(ceilingsAligned(ceiling, budget), `testTimeout=${ceiling} 而子进程预算到 ${budget}`).toBe(true)
  })

  it('反向自证：把天花板降回 vitest 默认 5s ⇒ 同一条判据必须判不对齐（否则正例是恒真）', () => {
    expect(ceilingsAligned(5000, budget)).toBe(false)
    expect(ceilingsAligned(budget, budget)).toBe(false)   // 相等也不够：子进程之外还有断言与启动
    expect(ceilingsAligned(budget + 5000, budget)).toBe(true)
  })

  it('配置真的读到了值（禁把"没匹配到"当成默认值蒙过：默认分支只允许在显式缺省时成立）', () => {
    expect(/testTimeout\s*:/.test(CFG)).toBe(true)
    expect(configCeiling('module.exports = { test: {} }')).toBe(5000)
  })
})
