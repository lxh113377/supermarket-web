// 第二十八轮：SQL 语句峰值的**归因正确性**常驻夹具。
//
// 为什么单独要有这么一份：第二十七轮发现"C1 的逐 action 峰值基线会随机变红"，当时的处置是
// 加噪声带 + 多次采样取上界 —— 那是止血，不是修好。本轮把机制查清了：
// `functions/lib/security.js` 的审计保留裁剪以 **5% 概率**顺带执行一条
// `DELETE FROM security_events WHERE ts < datetime('now','-90 days')`，
// 它被记在"恰好触发它的那个 action"头上 ⇒ 11/30 个 action 峰值随机 +1、每轮换受害者，
// 而全链总语句数几乎不变（这就是"归属错了"而非"某次调用变贵了"的判别证据）。
//
// 修法是给 mock 一个可插拔的 classify 缝，把摊销型语句单独立到 `amortized:*` 桶，
// 并让它不参与逐 action 的回归比较。本文件钉住修好的性质：
//   ① 逐 action 峰值在多次**单采样**下必须逐键相等（归因一旦退回随机，这里立刻红）；
//   ② 基线里不得出现"峰值随采样轮次变化的 action"；
//   ③ 摊销桶自己允许变（它本来就是概率计数），且必须被 INFO 行说出来而不是被当异常。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER = join(REPO, 'scripts', 'verify-backend.mjs')
const BASELINE = join(REPO, 'docs', 'sql-baseline.json')
const SAMPLES = 6

function emitPeaksOnce(dir, i) {
  const f = join(dir, `peaks-${i}.json`)
  const r = spawnSync(process.execPath, [RUNNER, '--emit-peaks', f], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000, env: { ...process.env, SQL_PEAK_SAMPLES: '1' },
  })
  if (r.status !== 0) throw new Error(`采样轮 ${i} 跑挂 rc=${r.status}: ${String(r.stderr).slice(-200)}`)
  return JSON.parse(readFileSync(f, 'utf8'))
}

describe('SQL 峰值归因：逐 action 必须可复现', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smattr-'))
  const runs = []
  try {
    for (let i = 0; i < SAMPLES; i++) runs.push(emitPeaksOnce(dir, i))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  it(`正向：${SAMPLES} 轮单采样下，所有非摊销键逐键相等`, () => {
    expect(runs.length).toBe(SAMPLES)
    const keys = new Set(runs.flatMap(Object.keys))
    const normal = [...keys].filter((k) => !k.startsWith('amortized:'))
    expect(normal.length).toBeGreaterThanOrEqual(25)
    const varying = normal.filter((k) => new Set(runs.map((r) => r[k])).size > 1)
    expect(varying.map((k) => `${k}[${runs.map((r) => r[k]).join(',')}]`),
      '逐 action 峰值又变成随机量了 —— 说明有摊销型语句被记回了 action 头上（先找那句 SQL，再谈加容差）').toEqual([])
  })

  it('摊销桶允许是概率量，但必须单独立账（前缀 amortized:）', () => {
    const buckets = new Set([...runs.flatMap(Object.keys)].filter((k) => k.startsWith('amortized:')))
    // 5% 概率 × 每轮十几次审计写 ⇒ 单轮几乎必然出现；真一次没出现也不能判绿成"没有摊销"，
    // 所以这里只断言"出现的键一定带正确前缀且计数为正"，不拿概率量当硬断言。
    for (const b of buckets) {
      expect(b).toMatch(/^amortized:[a-z0-9-]+$/)
      for (const r of runs) if (r[b] !== undefined) expect(r[b]).toBeGreaterThan(0)
    }
    expect([...buckets].every((b) => b === 'amortized:audit-retention-purge')).toBe(true)
  })

  it('基线在册键与实测同形，且不含"峰值随机"的 action（防基线里留着旧口径的脏数）', () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
    const keys = Object.keys(base.peakStatements).filter((k) => !k.startsWith('amortized:'))
    expect(keys.length).toBeGreaterThanOrEqual(30)
    for (const k of keys) {
      const seen = new Set(runs.map((r) => r[k]))
      expect(seen.size, `基线键 ${k} 的实测值不止一种 ⇒ 归因不稳`).toBe(1)
      expect([...seen][0], `基线与实测对不上：${k}`).toBe(base.peakStatements[k])
    }
    expect(base.samples, '归因收口后单采样即确定；采样数若被抬起，必须说明为什么').toBeLessThanOrEqual(3)
  })
})
