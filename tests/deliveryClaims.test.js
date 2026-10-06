// @vitest-environment node
/**
 * delivery-claims 夹具（第六十八轮 M-67-3）——「报告里说已交付，同段必须有可复算的远端回执」。
 *
 * 反例不是编的：形状取自两处一手实况 ——
 *   ① 第 66 轮 §9 空着「待实测回填」而正文 §4 写「本轮已做」，远端 run 37146129990 其实
 *      `completed/failure`、`deploy` skipped、线上 `deploy` 仍是 `2e950ed`；
 *   ② 第 67 轮 §6 断言「普通文本搜索搜不到 VERIFY_RC」，本轮 grep=命中1 / rg=0 / Select-String=0
 *      ⇒ 绝对测量句的取数面只有一把尺。
 * 纯函数与 CLI 两条面都要测：只 import 纯函数 ≠ 这条腿跑过（本仓 R-CURRENT 同族教训）。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCliRan } from './helpers/cliLeg.js'
import {
  sectionsOf, quotedSpans, insideAnySpan, claimHits, receiptsOf, judgeDeliveries, selfCheckAdmission,
} from '../scripts/check-delivery-claims.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = resolve(ROOT, 'scripts', 'check-delivery-claims.mjs')
const JOBS = ['build-and-test', 'e2e', 'e2e-cloud-stub', 'visual', 'deploy']
const GOOD = '## 9. 远端回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 **已上线** | run `37228542182`，`completed/success`；`build-and-test` success、`e2e` success、`e2e-cloud-stub` success、`visual` success、`deploy` success |\n'
const BAD = '## 4. 改进建议清单\n\n| # | 状态 |\n|---|---|\n| H-1 | **本轮已上线** |\n'
const MENTION = '## 3. 逐项差距\n\n- 「已交付」的判定从来没有被机器管住；把"已推送"当"已上线"是上一轮的病。\n'
const MEASURE = '## 6. 证据与时刻\n\n| 主张 | 取证 |\n|---|---|\n| 读日志 | 该日志是 UTF-16LE ⇒ 普通文本搜索**搜不到** `VERIFY_RC` |\n'
const MEASURE_WITH_TOOL = '## 6. 证据与时刻\n\n| 主张 | 取证 |\n|---|---|\n| 读日志 | 同一文件三把尺：grep 命中 1、rg 0、Select-String 0 ⇒ "搜不到"只在后两把成立 |\n'

/** 临时夹具目录建在 node_modules 下：外层工作树有 40+ 条"根目录不得留散件"的看守，别去碰它。 */
const tmpDir = () => mkdtempSync(join(ROOT, 'node_modules', '.tmp-delivclaims-'))
const writeFix = (dir, files) => { for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t, 'utf8'); return dir }
const runCli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } })
  return assertCliRan(r, { label: `check-delivery-claims ${args.join(' ')}`, budgetMs: 60_000 })
}

describe('sectionsOf / claimHits：主张与"讨论这个词"必须分得开', () => {
  it('按标题切段：一段 = 标题到下一标题之前', () => {
    const secs = sectionsOf('front matter\n## A\naaa\n## B\nbbb\n')
    expect(secs.map((s) => s.heading)).toEqual(['(文件头)', 'A', 'B'])
    expect(secs.find((s) => s.heading === 'A').lines.join('')).toContain('aaa')
  })
  it('正例：裸写的"已上线"是主张', () => {
    expect(claimHits('| H-1 **已上线** |')).toEqual(['已上线'])
  })
  it('反例（引用式提及不得冒充主张）：「」/ASCII 双引号/反引号包住的词面一律不算', () => {
    expect(claimHits('「已交付」的判定从来没有被机器管住')).toEqual([])
    expect(claimHits('把"已推送"当"已上线"是上一轮的病')).toEqual([])
    expect(claimHits('`已上线` 这三个字出现在 §9')).toEqual([])
    // 跨度取数要能自证：上面三句各自产生的跨度必须覆盖被抑制的位置（不是靠巧合）
    const spans = quotedSpans('把"已推送"当"已上线"是上一轮的病')
    expect(spans.length).toBeGreaterThan(0)
    expect(insideAnySpan(spans, 4)).toBe(true)
  })
  it('混合句：一处引用 + 一处真主张 ⇒ 只数真的那处', () => {
    expect(claimHits('「已交付」是术语；本轮 H-2 已交付。')).toEqual(['已交付'])
  })
})

describe('receiptsOf：回执三件套逐半都有断言', () => {
  it('全齐 ⇒ ok', () => {
    const r = receiptsOf(GOOD, JOBS)
    expect(r).toMatchObject({ hasRun: true, hasConclusion: true, deployAnchor: false })
    expect(r.missingJobs).toEqual([])
    expect(r.ok).toBe(true)
  })
  it('run 号与结论都在、但必需 job 只点名一半 ⇒ 不 ok，且缺的那半被点名', () => {
    const r = receiptsOf('run `37228542182` completed/success；build-and-test success', ['build-and-test', 'e2e-cloud-stub'])
    expect(r.hasRun && r.hasConclusion).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.missingJobs).toEqual(['e2e-cloud-stub'])
  })
  it('线上锚可以替代 job 名单（把线上和 SHA 绑起来的那种回执）', () => {
    const r = receiptsOf('run 37228542182 completed/success；GET /_health ⇒ {"deploy":"ecdc92d"}', JOBS)
    expect(r.deployAnchor).toBe(true)
    expect(r.ok).toBe(true)
  })
  it('只有一句"本轮已上线" ⇒ 三样全缺', () => {
    const r = receiptsOf(BAD, JOBS)
    expect([r.hasRun, r.hasConclusion, r.deployAnchor]).toEqual([false, false, false])
  })
})

describe('judgeDeliveries：零输入、缺尺、双向都各出一行', () => {
  it('取数面空 ⇒ FAIL（零输入不折算通过）', () => {
    expect(judgeDeliveries({ files: [], requiredJobs: JOBS }).state).toBe('FAIL')
  })
  it('requiredJobs 取不到 ⇒ FAIL 而不是"不需要 job 名单"', () => {
    const r = judgeDeliveries({ files: [{ name: 'x.md', text: GOOD }], requiredJobs: [] })
    expect(r.state).toBe('FAIL')
    expect(r.badClaims[0].why).toContain('不允许按"不需要"放过')
  })
  it('matched / mismatched 两个数分开出，讨论句不进任何一个', () => {
    const r = judgeDeliveries({ files: [{ name: 'g.md', text: GOOD }, { name: 'b.md', text: BAD }, { name: 'm.md', text: MENTION }], requiredJobs: JOBS })
    expect(r.matched).toBe(1)
    expect(r.mismatched).toBe(1)
    expect(r.badClaims[0].file).toBe('b.md')
  })
  it('测量句：不点名取数器判红，点名后放行（同一句话的两个方向）', () => {
    expect(judgeDeliveries({ files: [{ name: 'e.md', text: MEASURE }], requiredJobs: JOBS }).badMeasures.length).toBe(1)
    expect(judgeDeliveries({ files: [{ name: 'o.md', text: MEASURE_WITH_TOOL }], requiredJobs: JOBS }).badMeasures).toEqual([])
  })
  it('D4 自证三方向必须同时成立（尺自己不可信就不许报绿）', () => {
    expect(selfCheckAdmission()).toEqual({ admitsHonest: true, rejectsEmpty: true, admitsMention: true })
  })
})

describe('CLI：三档退出码与注入演习都实测（只 import 纯函数 ≠ 这条腿跑过）', () => {
  it('--dir 指到不存在的路径 ⇒ rc=2（说用法错，不走 UNVERIFIED 后门）', () => {
    const r = runCli(['--dir', join(ROOT, 'node_modules', 'nope-does-not-exist')])
    expect(r.status).toBe(2)
    expect(String(r.stdout) + String(r.stderr)).toContain('环境不满足')
  })
  it('夹具只有合格回执 ⇒ rc=0 且 GATE-PASS，matched=1', () => {
    const dir = writeFix(tmpDir(), { 'a.md': GOOD })
    const r = runCli(['--dir', dir])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('GATE-PASS')
    expect(r.stdout).toContain('matched=1')
  })
  it('夹具有一句空口"已上线" ⇒ rc=1 且把主张词与缺哪几样一起点名', () => {
    const dir = writeFix(tmpDir(), { 'a.md': BAD })
    const r = runCli(['--dir', dir])
    expect(r.status).toBe(1)
    const out = String(r.stdout) + String(r.stderr)
    expect(out).toContain('主张「已上线」')
    expect(out).toContain('缺 run 号')
  })
  it('--inject-red：目录里全是对的时候也必须当场红（演习有牙）', () => {
    const dir = writeFix(tmpDir(), { 'a.md': GOOD })
    const clean = runCli(['--dir', dir])
    expect(clean.status).toBe(0)
    const r = runCli(['--dir', dir, '--inject-red'])
    expect(r.status).toBe(1)
    const out = String(r.stdout) + String(r.stderr)
    expect(out).toContain('--inject-red 已注入一条假主张')
    expect(out).toContain('INJECTED')
  })
  it('--limit 写成非数字 ⇒ rc=2，不许悄悄回落默认值', () => {
    const dir = writeFix(tmpDir(), { 'a.md': BAD })
    const r = runCli(['--dir', dir, '--limit=abc'])
    expect(r.status).toBe(2)
    expect(String(r.stdout) + String(r.stderr)).toContain('解不出正整数')
  })
  it('--limit=N 与 --limit N 两种写法都要认（只认其一 = 静默忽略用户参数）', () => {
    const dir = writeFix(tmpDir(), { 'a.md': GOOD })
    for (const args of [['--limit=3'], ['--limit', '3']]) {
      const r = runCli(['--dir', dir, ...args])
      expect(r.status, `--limit 写法 ${args.join(' ')} 没被认出来`).toBe(0)
    }
  })
  it('真实面：本机能观测到就必须真观测到（UNVERIFIED 不是本地该走的路径）', () => {
    const r = runCli([])
    const out = String(r.stdout) + String(r.stderr)
    // CI 只检出代码仓 ⇒ 那里合法地走 UNVERIFIED；本机必须拿到计数，否则这条尺一直在"没判"。
    expect(out).toMatch(/matched=\d+ mismatched=\d+|UNVERIFIED/)
    expect(out).not.toMatch(/matched=0 mismatched=0/)
    if (/matched=/.test(out)) {
      const m = /matched=(\d+) mismatched=(\d+)/.exec(out)
      expect(Number(m[1]) + Number(m[2])).toBeGreaterThan(0)
    }
  })
  it('目录存在但没有 .md ⇒ rc=1（零输入），不是 rc=0 的"没人说话就是没问题"', () => {
    const r = runCli(['--dir', tmpDir()])
    expect(r.status).toBe(1)
    expect(String(r.stdout) + String(r.stderr)).toContain('0 份 .md')
  })
})
