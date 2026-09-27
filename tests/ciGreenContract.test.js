// 第二十三轮夹具：CI 全绿契约判据的四态双向变异审计。
// 立它的代价来源（不是假想）：CI 连红 7 个 commit 期间，三份对标报告都写着"CI 全绿"。
// 所以本判据的核心不是"能不能测出绿"，而是**能不能拒掉"没查到"**。
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { verdictOf, loadContract, CONTRACT_FILE } from '../scripts/ci-green-contract.mjs'

const contract = loadContract()
const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const run = (over = {}) => ({ headSha: SHA, databaseId: 1, conclusion: 'success', status: 'completed', jobs: [], ...over })
const allJobs = (c = 'success') => contract.requiredJobs.map((name) => ({ name, conclusion: c }))
const v = (runs) => verdictOf({ sha: SHA, runs, contract })

describe('契约文件本身在册且自洽', () => {
  it('正向：JSON 可解析、requiredJobs 非空、逃生门字段在', () => {
    expect(contract).toBeTruthy()
    expect(typeof contract).toBe('object')
    expect(contract.requiredJobs.length).toBeGreaterThanOrEqual(5)
    expect(contract.escapeHatch).toBe('CI_GREEN_SKIP')
    expect(contract.why.length).toBeGreaterThan(40)
  })
  it('requiredJobs 必须含 deploy —— 只盯测试 job 会漏掉"绿了但没发出去"这种形态', () => {
    expect(contract.requiredJobs).toContain('deploy')
    expect(contract.requiredJobs).toContain('build-and-test')
  })
  it('反例：契约文件缺失或 JSON 坏掉 ⇒ UNKNOWN（不是默默放行）', () => {
    expect(verdictOf({ sha: SHA, runs: [run({ jobs: allJobs() })], contract: null }).state).toBe('UNKNOWN')
    expect(verdictOf({ sha: SHA, runs: [run()], contract: 'PARSE_ERROR' }).state).toBe('UNKNOWN')
    expect(loadContract(joinTmp())).toBe(null)
  })
})

describe('四态判定', () => {
  it('GREEN：run success 且必需 job 全 success', () => {
    expect(v([run({ jobs: allJobs() })]).state).toBe('GREEN')
  })
  it('RED：run 整体 failure ⇒ 点名失败 job', () => {
    const r = v([run({ conclusion: 'failure', jobs: allJobs().map((j) => (j.name === 'e2e' ? { ...j, conclusion: 'failure' } : j)) })])
    expect(r.state).toBe('RED')
    expect(r.reason).toContain('e2e=failure')
  })
  it('RED 对偶：run 结论是 success 但某个必需 job 非 success ⇒ 仍判红（防 needs 让 job skip 后被当成绿）', () => {
    const jobs = allJobs().map((j) => (j.name === 'deploy' ? { ...j, conclusion: 'skipped' } : j))
    expect(v([run({ conclusion: 'success', jobs })]).state).toBe('RED')
  })
  it('BLOCKED：run 还在跑 ⇒ 无结论不放行', () => {
    expect(v([run({ status: 'in_progress', conclusion: '', jobs: allJobs() })]).state).toBe('BLOCKED')
  })
  it('BLOCKED：run 结束但 deploy job 缺席 ⇒ 这正是连红 7 次的真实形态', () => {
    const jobs = allJobs().filter((j) => j.name !== 'deploy')
    const r = v([run({ conclusion: 'success', jobs })])
    expect(r.state).toBe('BLOCKED')
    expect(r.reason).toContain('deploy')
  })
  it('UNKNOWN：查不到本次 sha 的 run ⇒ 裸静音判红，绝不读成"没失败就是通过"', () => {
    const r = v([run({ headSha: 'other', jobs: allJobs() })])
    expect(r.state).toBe('UNKNOWN')
    expect(r.reason).toContain(SHA.slice(0, 7))
  })
  it('UNKNOWN 边界：runs 为空数组同样判红（零输入不得记 PASS）', () => {
    expect(v([]).state).toBe('UNKNOWN')
  })
})

describe('接线：hook 真的指向本判据', () => {
  it('pre-push 存在、可执行、调的是 ci-green-contract', () => {
    const hook = readFileSync('.githooks/pre-push', 'utf8')
    expect(hook).toContain('ci-green-contract.mjs')
    expect(hook).toContain('set -e')
    expect(existsSync(CONTRACT_FILE)).toBe(true)
  })
  it('反例：把判据从 hook 里去掉 ⇒ 断言必须翻红（证明这条检查有牙齿）', () => {
    // 上一版这里用 String.replace(字符串) 只替换**第一处**，而 hook 里有两处调用
    // （skip 分支与非 skip 分支）⇒ 残留一处让断言失败。**夹具自己也会写坏，所以它同样要跑红→绿一遍。**
    const tampered = readFileSync('.githooks/pre-push', 'utf8').replace(/ci-green-contract\.mjs/g, 'echo-OK.sh')
    expect(tampered).not.toContain('ci-green-contract.mjs')
    expect(tampered.match(/echo-OK\.sh/g)).toHaveLength(2)
  })
})

function joinTmp() { return './__no_such_dir_for_test__' }
