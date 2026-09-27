// 第二十三轮夹具：CI 全绿契约判据的四态双向变异审计。
// 立它的代价来源（不是假想）：CI 连红 7 个 commit 期间，三份对标报告都写着"CI 全绿"。
// 所以本判据的核心不是"能不能测出绿"，而是**能不能拒掉"没查到"**。
// 第二十四轮补 CLI 入口面：上面那 15 条只 import 纯函数，入口通道（stdin 解析 / ref 行字段 /
// 退出码）从头到尾没人跑过，于是一个 ReferenceError 被空 catch 吞掉后，闸门连续三轮
// "看起来在工作"（实测推 feature-x 报的是 branch=main）。下半段专门跑真子进程。
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verdictOf, loadContract, parseRefLines, CONTRACT_FILE } from '../scripts/ci-green-contract.mjs'

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

/**
 * ── CLI 入口真跑面（第二十四轮新增）────────────────────────────────────
 * 上面 12 条全 import 纯函数 `verdictOf`，于是入口通道上的两个真缺陷一次都没被碰到：
 *   ① `fs.readFileSync(0)` —— 模块里没有 `fs` 这个标识符，ReferenceError 被 `catch { line = '' }`
 *      吞成"git 没给 ref 行"，**整条 stdin 通道静默失效**（实测：推 feature-x 时闸门打印 branch=main）；
 *   ② 分支名正则 `^(?:refs\/(?:heads|tags)\/)?(.+)$` 的 `(.+)` 贪婪吞掉**整行**（含两个 SHA）。
 * 两者互相掩盖：只修 ① 会让闸门 100% 判红（分支名变成带空格的怪物 ⇒ ls-remote 取不到）。
 * 所以这一段只做一件事：**把 `node scripts/ci-green-contract.mjs` 这条真实入口跑起来**，
 * 并给每条断配一个变异体（把源码改掉后同一输入必须翻红），否则夹具退化成"读一遍 stdout"。
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(REPO, 'scripts', 'ci-green-contract.mjs')
const HEAD_SHA = 'a'.repeat(40) // 本次要推的提交（天生还没有 CI run）
const BASE_SHA = 'b'.repeat(40) // 远端当前基点（契约要核的是它）
const tmpDirs = []

function tmpLayout({ contract = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'smcigreen-'))
  tmpDirs.push(dir)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  if (contract) {
    mkdirSync(join(dir, '.ci'), { recursive: true })
    writeFileSync(join(dir, '.ci', 'contract.json'), readFileSync(join(REPO, '.ci', 'contract.json'), 'utf8'))
  }
  return dir
}

/** 离线化：让 gh 在触网之前就失败（GH_HOST 指向不存在的 host + 清空令牌与配置目录）。 */
function offlineEnv(extra = {}) {
  const env = { ...process.env }
  delete env.GH_TOKEN
  delete env.GITHUB_TOKEN
  delete env.CI_GREEN_SKIP
  delete env.CI_GREEN_BASE
  env.GH_HOST = 'gh-invalid.invalid'
  env.GH_ENTERPRISE_HOST = 'gh-invalid.invalid'
  env.GH_CONFIG_DIR = tmpLayout({ contract: false })
  // 覆盖项必须**最后**合并：上一版先 spread 再 delete，把测试自己要设的 CI_GREEN_SKIP 删了，
  // 于是"逃生门缺理由仍拒"这条测的是没设逃生门的行为（假绿）。
  return { ...env, ...extra }
}

function runCli({ script = CLI, input = '', env = {}, cwd = REPO } = {}) {
  const r = spawnSync(process.execPath, [script, 'origin', 'https://example.invalid/repo.git'],
    { input, env: offlineEnv(env), cwd, encoding: 'utf8', timeout: 20_000 })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

const ref = (branch, local = HEAD_SHA, remote = BASE_SHA) =>
  `refs/heads/${branch} ${local} refs/heads/${branch} ${remote}\n`

/** 变异体：改的是**真源码的字符串**，所以它测的是生产路径而不是夹具自己的副本逻辑。 */
function mutated(from, to) {
  const dir = tmpLayout()
  const src = readFileSync(CLI, 'utf8')
  if (!src.includes(from)) throw new Error(`变异锚点不存在（判据已改形，夹具必须同步）：${from}`)
  const script = join(dir, 'scripts', 'ci-green-contract.mjs')
  writeFileSync(script, src.replace(from, to))
  return script
}

describe('parseRefLines：git 的 ref 行契约', () => {
  it('正向：四字段一行解析成本地/远端的 ref+sha', () => {
    expect(parseRefLines(ref('main', HEAD_SHA, BASE_SHA))).toEqual(
      [{ localRef: 'refs/heads/main', localSha: HEAD_SHA, remoteRef: 'refs/heads/main', remoteSha: BASE_SHA }])
  })
  it('多行全收（一次推两个 ref 不能只审第一个）', () => {
    const rows = parseRefLines(ref('a') + ref('b'))
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.remoteRef)).toEqual(['refs/heads/a', 'refs/heads/b'])
  })
  it('反例：字段不足 / 空行一律丢掉，不产生半成品 ref', () => {
    expect(parseRefLines('refs/heads/x\n\n   \ngarbage')).toEqual([])
  })
})

describe('CLI 入口（子进程真跑）', () => {
  // 这一段每条都起子进程：vitest 默认 5s 天花板会在 85 文件并行时先把探针判成超时
  // （报的是"Test timed out"而不是任何真实结论）。子进程预算 20s < 用例天花板 30s。
  const itCli = (name, fn) => it(name, fn, 30_000)

  itCli('入口通道真的读得到 stdin：推 feature-x 时闸门必须报 feature-x', () => {
    const { rc, out } = runCli({ input: ref('feature-x') })
    expect(out).toContain('branch=feature-x')
    expect(out).not.toContain('branch=main')
    expect(rc).toBe(1) // 合成基点没有回执 ⇒ 判红，不是放行
  })
  itCli('对偶（本轮 P1 的主断言）：核的是远端基点 base，不是本次 HEAD', () => {
    const { out } = runCli({ input: ref('main', HEAD_SHA, BASE_SHA) })
    expect(out).toContain(`base=${BASE_SHA.slice(0, 7)}`)
    expect(out).not.toContain(`base=${HEAD_SHA.slice(0, 7)}`)
  })
  itCli('多 ref 同推：两条都要被审（只审第一条 = 第二条绕过闸门）', () => {
    const { rc, out } = runCli({ input: ref('aa') + ref('bb') })
    expect(out).toContain('branch=aa')
    expect(out).toContain('branch=bb')
    expect(rc).toBe(1)
  })
  itCli('gh 取不到回执 ⇒ FAIL-CLOSED 判红（裸静音判红，端到端在真入口上）', () => {
    const { rc, out } = runCli({ input: ref('main') })
    expect(rc).toBe(1)
    expect(out).toContain('FAIL-CLOSED')
    expect(out).toContain('取不到远端回执不等于没事')
  })
  itCli('删除分支（local_sha 全 0）⇒ 放行且不查 CI：没有基座被叠加', () => {
    const { rc, out } = runCli({ input: ref('stale', '0'.repeat(40), BASE_SHA) })
    expect(rc).toBe(0)
    expect(out).toContain('SKIP')
    expect(out).toContain('删除分支')
  })
  itCli('新建分支（remote_sha 全 0）⇒ 放行：远端还没有基线可保护', () => {
    const { rc, out } = runCli({ input: ref('newcomer', HEAD_SHA, '0'.repeat(40)) })
    expect(rc).toBe(0)
    expect(out).toContain('新建分支')
  })
  itCli('既无 ref 行又无 ls-remote 能力 ⇒ 判红（不是"没查到就算过"）', () => {
    const dir = tmpLayout({ contract: false })
    const { rc, out } = runCli({ input: '', cwd: dir })
    expect(rc).toBe(1)
    expect(out).toContain('取不到远端')
  })
  itCli('契约缺失 / JSON 坏掉 ⇒ rc=1（真入口上的 fail-closed，不是单测里的）', () => {
    const noFile = tmpLayout({ contract: false })
    const s1 = join(noFile, 'scripts', 'ci-green-contract.mjs')
    writeFileSync(s1, readFileSync(CLI, 'utf8'))
    const a = runCli({ script: s1, input: ref('main'), cwd: noFile })
    expect(a.rc).toBe(1)
    expect(a.out).toContain('读不到合法的')

    const bad = tmpLayout()
    writeFileSync(join(bad, '.ci', 'contract.json'), '{ not json')
    const s2 = join(bad, 'scripts', 'ci-green-contract.mjs')
    writeFileSync(s2, readFileSync(CLI, 'utf8'))
    const b = runCli({ script: s2, input: ref('main'), cwd: bad })
    expect(b.rc).toBe(1)
    expect(b.out).toContain('读不到合法的')
  })
  itCli('逃生门：CI_GREEN_SKIP=1 缺理由照样拒；带理由才放行且 loudly 留痕', () => {
    const noReason = runCli({ input: ref('main'), env: { CI_GREEN_SKIP: '1' } })
    expect(noReason.rc).toBe(1)
    expect(noReason.out).toContain('仍拒')
    const withReason = runCli({ input: ref('main'), env: { CI_GREEN_SKIP: '1', CI_GREEN_REASON: 'fixture: 演练逃生门' } })
    expect(withReason.rc).toBe(0)
    expect(withReason.out).toContain('绕过契约')
  })

  itCli('变异体 M1：基点取错字段（remote→local）⇒ 上面那条对偶断言必须翻红', () => {
    // 锚点取整行：只改条件不改取值会造出**空变异**（上一版就是这样，测了个没改的分支）
    const script = mutated(
      "let base = SHA40.test(String(r.remoteSha || '')) ? r.remoteSha : null",
      "let base = SHA40.test(String(r.localSha || '')) ? r.localSha : null")
    const { out } = runCli({ script, input: ref('main', HEAD_SHA, BASE_SHA) })
    expect(out).toContain(`base=${HEAD_SHA.slice(0, 7)}`)
    expect(out).not.toContain(`base=${BASE_SHA.slice(0, 7)}`)
  })
  itCli('变异体 M2：把 stdin 读取退回"静默吞掉"⇒ branch=feature-x 断言必须翻红', () => {
    const script = mutated('line = readFileSync(0, \'utf8\')', 'line = \'\'')
    const { out } = runCli({ script, input: ref('feature-x') })
    expect(out).not.toContain('branch=feature-x')
    expect(out).toContain('branch=main') // 退回契约默认分支 = 审了个不相干的分支
  })
  itCli('变异体 M3：只审第一行 ref ⇒ 多 ref 断言必须翻红', () => {
    const script = mutated('const refs = parseRefLines(pushRef)', 'const refs = parseRefLines(pushRef).slice(0, 1)')
    const { out } = runCli({ script, input: ref('aa') + ref('bb') })
    expect(out).toContain('branch=aa')
    expect(out).not.toContain('branch=bb')
  })
})

afterAll(() => {
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响结论 */ } }
})

function joinTmp() { return './__no_such_dir_for_test__' }
