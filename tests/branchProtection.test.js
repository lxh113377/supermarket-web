// 第三十三轮：分支保护普查判据的常驻夹具。
// 它是 advisory（永不拦提交），但**四态必须分得开**：把"取不到"读成"没开"，或读成"已开"，
// 都是把欠账洗成清白 —— 第二十一~二十四轮"CI 全绿假账"的同一族，只是这次的清白写在安全设置上。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { evaluate } from '../scripts/check-branch-protection.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-branch-protection.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'smbp-'))
const tmpDirs = [tmp]
mkdirSync(join(tmp, 'scripts'), { recursive: true })
const run = (recording, script = SELF) => {
  const f = join(tmp, 'in.json')
  writeFileSync(f, JSON.stringify(recording))
  const r = spawnSync(process.execPath, [script], { cwd: REPO, encoding: 'utf8', timeout: 60_000, env: { ...process.env, BRANCH_PROTECTION_JSON: f } })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

describe('分支保护普查：四态分明，取不到绝不写成结论', () => {
  it('真值表：经典 protection 生效 ⇒ ENFORCED，并且把 admin-only 子项列为未观测', () => {
    const r = evaluate({ protection: { http: 200, required_status_checks: { contexts: ['CI / build-and-test'] } }, at: 'T' })
    expect(r.state).toBe('ENFORCED')
    expect(r.line).toContain('CI / build-and-test')
    expect(r.unobserved.length).toBe(5)
  })

  it('真值表：两条通道都可观测且都无保护 ⇒ NOT_ENFORCED（措辞必须落到"服务端不拦"）', () => {
    const r = evaluate({ protection: { http: 404 }, rulesets: { http: 200 }, at: 'T' })
    expect(r.state).toBe('NOT_ENFORCED')
    expect(r.line).toContain('服务端不拦任何 push')
  })

  it('真值表：modern ruleset 生效也算已保护（别拿"经典 protection 404"就判没开）', () => {
    const r = evaluate({ repo: 'o/r', protection: { http: 404 }, rulesets: { http: 200, enforcement_active: ['o/r'] }, at: 'T' })
    expect(r.state).toBe('ENFORCED-VIA-RULESET')
  })

  it('真值表：401/403 等取不到 ⇒ UNVERIFIED 且 rc=2 —— 既不写"没开"也不写"已开"', () => {
    for (const code of [401, 403, undefined, 'rc=3']) {
      const r = evaluate({ protection: { http: code, status: code }, rulesets: { http: code, status: code }, at: 'T' })
      expect(r.state, `状态码 ${code} 被读成了结论`).toBe('UNVERIFIED')
      expect(r.rc).toBe(2)
      expect(r.line).not.toMatch(/服务端不拦|已启用/)
    }
  })

  it('回归钉子：碎参数读数（rc=3）绝不能被读成 NOT_ENFORCED', () => {
    // 本轮真实修过的 bug：gh() 的形参是 args 但调用方传字符串，[...字符串] 拆成单字符 ⇒ gh 用法错误
    // 退出码 3 ⇒ 读数 'rc=3'。若那被读成"没开"，一条通道坏了就会把安全欠账写成"已核查且清白"。
    expect(evaluate({ protection: { http: 'rc=3' }, rulesets: { http: 200 }, at: 'T' }).state).toBe('UNVERIFIED')
  })

  it('真入口：注入三种读数，退出码与状态词都要由子进程自己印出来（不是 import 出来的）', () => {
    const ok = run({ at: '2026-09-27T00:00:00Z', protection: { http: 200, required_status_checks: { contexts: ['CI / deploy'] } } })
    expect(ok.out).toContain('ENFORCED')
    expect(ok.rc).toBe(0)
    const none = run({ at: '2026-09-27T00:00:00Z', protection: { http: 404 }, rulesets: { http: 200 } })
    expect(none.out).toContain('NOT_ENFORCED')
    expect(none.rc).toBe(0)
    const blind = run({ at: '2026-09-27T00:00:00Z', protection: { http: 401 }, rulesets: { http: 401 } })
    expect(blind.out).toContain('UNVERIFIED')
    expect(blind.rc).toBe(2)
    expect(blind.out).toContain('2026-09-27T00:00:00Z')   // 时刻必须随结论一起出（挂账要带时刻）
  })

  it('探针有牙齿：把"取不到"改成"按满足计"（scorecard 那种取舍）⇒ 401 读数必须被这一判据抓住', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smbpmut-'))
    tmpDirs.push(dir)
    // 连依赖一起拷（判据 import 了 ./lib/preflight）：只拷单文件会先崩在模块解析上，
    // 那测到的是"复制清单不全"，不是判据行为 —— 第二十六轮的教训，走共用 helper。
    const local = copyGateScripts(REPO, dir, 'check-branch-protection.mjs')
    const target = join(local, 'check-branch-protection.mjs')
    const src = readFileSync(target, 'utf8')
    const mutated = src.replace("const bothObserved = (pCode === 404 || pCode === '404') && (rCode === 200 || rCode === 404 || rCode === 403)",
      'const bothObserved = true')
    expect(mutated, '变异锚点已失效（判据改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated)
    const r = run({ at: 'T', protection: { http: 401 }, rulesets: { http: 401 } }, target)
    expect(r.out, '把守卫摘掉后仍判 UNVERIFIED ⇒ 这条探针没在看这件事').toContain('NOT_ENFORCED')
    expect(r.rc).toBe(0)
  })
})

afterAll(() => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 清理失败不改结论 */ } }
})
