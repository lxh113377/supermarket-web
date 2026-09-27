// @vitest-environment node
/**
 * 备份链存活判据的夹具（第十二轮 R12-H1）。
 * 反例不是编的：全部对照 2026-09-26 用 API 实测到的形状 —— 两次 run 都是
 * `conclusion=success` + `artifact=0` + 导出/上传步骤 skipped（未配 token 只发 warning）。
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgeLiveness } from '../scripts/check-backup-liveness.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = Date.parse('2026-09-26T12:00:00Z')
// 默认窗口 1 天 ⇒ 分母下限=1，正例不必堆一串 run；分母本身另有用例专测
const judge = (runs, over = {}) => judgeLiveness({ runs, nowMs: NOW, lookbackDays: 1, cronPeriodDays: 1, ...over, })
const dayAgo = (d) => new Date(NOW - d * 86400_000).toISOString()
const step = (name, conclusion) => ({ name, conclusion })
const realRun = (over = {}) => ({
  id: 36199812627, createdAt: dayAgo(0.5), conclusion: 'success', event: 'schedule', artifactCount: 0,
  steps: [step('Export remote D1', 'skipped'), step('Upload backup artifact', 'skipped')], ...over,
})

describe('judgeLiveness：产物才算数，conclusion 不算', () => {
  it('正例：导出步骤 success + artifact≥1 + 新 ⇒ 通过', () => {
    const r = judge([realRun({ artifactCount: 1, steps: [step('Export remote D1', 'success')] })])
    expect(r.problems).toEqual([])
    expect(r.good).toBeTruthy()
  })
  it('实测反例：success 但 0 artifact、步骤全 skipped ⇒ 判"从未被这条链备份过"，并给出恒绿警告', () => {
    const r = judge([realRun(), realRun({ id: 2, createdAt: dayAgo(0.4) })])
    expect(r.problems.join()).toContain('从未被这条链备份过')
    expect(r.warnings.join()).toContain('恒绿空转')
    expect(r.good).toBe(null)
  })
  it('有产物但太久（10 天前）⇒ 判"链已停摆"', () => {
    const r = judge([realRun({ createdAt: dayAgo(10), artifactCount: 1, steps: [step('Export remote D1', 'success')] })], { maxAgeDays: 2 })
    expect(r.problems.join()).toContain('链已停摆')
  })
  it('零输入 ⇒ 判红（不许"没数据=没问题"）', () => {
    expect(judgeLiveness({ runs: [], nowMs: NOW }).problems.join()).toContain('从未有过任何 run')
  })
  it('runs 不是数组 / nowMs 非法 / 时间戳解不出 ⇒ 各自判红而不是沉默', () => {
    expect(judge(null).problems.join()).toContain('不是数组')
    expect(judgeLiveness({ runs: [realRun()], nowMs: NaN, lookbackDays: 1 }).problems.join()).toContain('nowMs 非法')
    const r = judge([realRun({ createdAt: '不是时间', artifactCount: 1, steps: [step('Export remote D1', 'success')] })])
    expect(r.problems.join()).toContain('时间戳解不出来')
  })
  it('artifact 有但导出步骤是 skipped ⇒ 不算好（步骤与产物要同时成立）', () => {
    const r = judge([realRun({ artifactCount: 1 })])
    expect(r.problems.join()).toContain('从未被这条链备份过')
  })
  it('无步骤数据时不退化成假红（list 接口本来不给 steps）', () => {
    const r = judge([{ id: 9, event: 'schedule', createdAt: dayAgo(0.2), conclusion: 'success', artifactCount: 2 }])
    expect(r.problems).toEqual([])
  })
  it('豁免开关只改变响亮程度，不改变事实陈述', () => {
    const r = judge([realRun()], { exempt: true })
    expect(r.problems).toEqual([])
    expect(r.warnings.join()).toContain('已豁免')
    expect(r.warnings.join()).toContain('从未被这条链备份过')
  })
})

describe('分母与模式断言（治"列表非空但全不相干"的假绿）', () => {
  const good = (n) => Array.from({ length: n }, (_, i) => realRun({
    id: 100 + i, createdAt: dayAgo(0.2 + i * 0.3), artifactCount: 1,
    steps: [step('Export remote D1', 'success')],
  }))
  it('窗口里只有 1 次 scheduled 且就在昨天 ⇒ 新上线的链不该被误红', () => {
    expect(judgeLiveness({ runs: good(1), nowMs: NOW, lookbackDays: 4, cronPeriodDays: 1 }).problems).toEqual([])
  })
  it('最近一次 scheduled 在 10 天前 ⇒ 判 cron 停摆（public 仓 60 天无活动会被自动禁用）', () => {
    const r = judgeLiveness({ runs: [{ ...good(1)[0], createdAt: dayAgo(10) }], nowMs: NOW, lookbackDays: 40, cronPeriodDays: 1 })
    expect(r.problems.join()).toContain('cron 被改/被自动禁用')
  })
  it('全是 push 事件的 run（被风暴挤出列表）⇒ 即使有产物也判调度的问题', () => {
    const r = judge(good(2).map((x) => ({ ...x, event: 'push' })))
    expect(r.problems.join()).toContain('调度层已停')
  })
  it('取不到步骤明细 ⇒ 必须出"步骤级断言是空话"的警告，不能静默按 artifact 过关', () => {
    const r = judge([{ id: 5, event: 'schedule', createdAt: dayAgo(0.2), conclusion: 'success', artifactCount: 1, steps: [] }])
    expect(r.problems).toEqual([])
    // 第三十六轮：文案从"1/4 取不到"改成**分子/分母 + 三种成因分形**（旧写法把
    // "判据自己少取"“取数失败”“没走到取数分支”混成一个数，看着像 API 不稳）。
    const w = r.warnings.join()
    expect(w).toContain('步骤明细覆盖 0/1')
    expect(w).toContain('步骤级断言是空话')
    expect(w).toContain('无取数记录 1 次')
  })
  it('三种失明成因不得同形：取数失败（带原因）／判据主动未取／无取数记录', () => {
    const base = { event: 'schedule', conclusion: 'success', artifactCount: 1, steps: [] }
    const failed = judge([{ ...base, id: 1, createdAt: dayAgo(0.1), stepBlind: '取 jobs 失败：HTTP 403' }]).warnings.join()
    expect(failed).toContain('取数失败 1 次')
    expect(failed).toContain('HTTP 403')
    const capped = judge([{ ...base, id: 2, createdAt: dayAgo(0.1), stepBlind: '超出步骤明细上限 12（本轮未取）' }]).warnings.join()
    expect(capped).toContain('判据主动未取 1 次')
    expect(capped).not.toContain('取数失败')
    // 对偶：全覆盖时**不得**再出这条警告（否则它会变成一条永远响的噪声）
    const allCovered = judge([{ ...base, id: 3, createdAt: dayAgo(0.1), steps: [{ name: 'Export remote D1', conclusion: 'success' }] }]).warnings.join()
    expect(allCovered).not.toContain('步骤明细覆盖')
  })
  it('presence 模式（自动化链互指）：不看 artifact，只认成功的定时 run', () => {
    const r = judge([{ id: 6, event: 'schedule', createdAt: dayAgo(0.5), conclusion: 'success', artifactCount: 0 }], { mode: 'presence' })
    expect(r.problems).toEqual([])
    const bad = judge([{ id: 6, event: 'schedule', createdAt: dayAgo(0.5), conclusion: 'failure', artifactCount: 0 }], { mode: 'presence' })
    expect(bad.problems.join()).toContain('scheduled run')
  })
})

describe('CLI：三档退出码都可反证', () => {
  const DIR = mkdtempSync(join(process.cwd(), 'node_modules/.tmp-liveness-'))
  const run = (env) => {
    try {
      return { rc: 0, out: execFileSync(process.execPath, [resolve(ROOT, 'scripts', 'check-backup-liveness.mjs')], { encoding: 'utf8', env: { ...process.env, ...env } }) }
    } catch (e) {
      return { rc: e.status, out: String(e.stdout || '') + String(e.stderr || '') }
    }
  }
  it('缺参数 ⇒ exit 2（不静默）', () => {
    const r = run({ GITHUB_REPOSITORY: '', BACKUP_WORKFLOW_ID: '', LIVENESS_FIXTURE: '' })
    expect(r.rc).toBe(2)
    // 第二十六轮 R25-M4：缺输入的统一出口是 `[label] 环境不满足：…`（原先各处自带"参数缺失/环境不满足"两套文案）。
    // 这条断言因此改指**统一后的形状**，同时钉住 label —— 文案改了却没改这里，会当场红。
    expect(r.out).toContain('环境不满足')
    expect(r.out).toContain('liveness')
  })
  it('fixture 全 skipped ⇒ exit 1 且摊出步骤形态', () => {
    const f = join(DIR, 'vacuous.json')
    writeFileSync(f, JSON.stringify([{ id: 1, created_at: dayAgo(0.5), event: 'schedule', conclusion: 'success', artifacts_count: 0,
      steps: [{ name: 'Export remote D1', conclusion: 'skipped' }] }]), 'utf8')
    const r = run({ LIVENESS_FIXTURE: f })
    expect(r.rc).toBe(1)
    expect(r.out).toContain('Export remote D1=skipped')
  })
  it('fixture 真有产物 ⇒ exit 0', () => {
    const f = join(DIR, 'good.json')
    writeFileSync(f, JSON.stringify([{ id: 7, created_at: dayAgo(0.2), event: 'schedule', conclusion: 'success', artifacts_count: 1,
      steps: [{ name: 'Export remote D1', conclusion: 'success' }] }]), 'utf8')
    expect(run({ LIVENESS_FIXTURE: f }).rc).toBe(0)
  })
})
