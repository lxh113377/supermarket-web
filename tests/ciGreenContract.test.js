// 第二十三轮夹具：CI 全绿契约判据的四态双向变异审计。
// 立它的代价来源（不是假想）：CI 连红 7 个 commit 期间，三份对标报告都写着"CI 全绿"。
// 所以本判据的核心不是"能不能测出绿"，而是**能不能拒掉"没查到"**。
// 第二十四轮补 CLI 入口面：上面那 15 条只 import 纯函数，入口通道（stdin 解析 / ref 行字段 /
// 退出码）从头到尾没人跑过，于是一个 ReferenceError 被空 catch 吞掉后，闸门连续三轮
// "看起来在工作"（实测推 feature-x 报的是 branch=main）。下半段专门跑真子进程。
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
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
    // 2026-10-08 分层 CI：build-and-test 拆为 gates（快链 job）。
    // 与 ci.yml 的逐项对账在 tests/ciWorkflow.test.ts 的桥接判据里（本文件只管契约自身自洽）。
    expect(contract.requiredJobs).toContain('gates')
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
  it('回执身份：四态 reason 一律含"被喂的 sha"——不带对象的 ID 不是回执（第三十六轮一手）', () => {
    // 实测起因：pre-push 打印 `run 36314824897 全绿` 未带 sha，我把**基线 bec6252** 的回执
    // 读成"本轮 81cd520 已绿"，而它自己的 run 36318373975 其实 build-and-test=failure。
    // 变异对照（实跑）：把 `who` 退回 `run ${best.databaseId}` ⇒ GREEN/RED/BLOCKED 三条同时翻红。
    const cases = [
      ['GREEN', v([run({ jobs: allJobs() })])],
      ['RED', v([run({ conclusion: 'failure', jobs: allJobs() })])],
      ['BLOCKED', v([run({ status: 'in_progress', conclusion: '', jobs: allJobs() })])],
      ['BLOCKED', v([run({ conclusion: 'success', jobs: allJobs().slice(1) })])],
      ['UNKNOWN', v([run({ headSha: 'other', jobs: allJobs() })])],
    ]
    for (const [want, r] of cases) {
      expect(r.state, JSON.stringify(r)).toBe(want)
      expect(r.reason, `${want} 的回执没指名它是哪个 sha 的 run`).toContain(SHA.slice(0, 7))
    }
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
    { input, env: offlineEnv(env), cwd, encoding: 'utf8', timeout: CLI_SUBPROCESS_BUDGET_MS })
  assertCliRan(r, { label: `ci-green-contract ${script}`, budgetMs: CLI_SUBPROCESS_BUDGET_MS })
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

/**
 * CLI 腿的预算（第七十轮上修；第五十四轮 R54-H4 立守卫时定的 20s/30s 已不够）。
 *
 * 一手起因：第七十轮全链 `npm test`（127 个测试文件并行）下 `变异体 M2` 报
 *   `[cli-leg-timeout] ci-green-contract … status=null（signal=SIGTERM，预算=20000ms，stdout=0B）`，
 * 而**单跑该文件 28/28 全绿**。`stdout=0B + status=null` 是「这条腿没跑成」，不是判据判红 ——
 * 所以治法是**提预算**（把并行负载留的余量补回去），不是改判据、也不是把守卫摘掉。
 *
 * 为什么上修而不是改成"自适应"：本仓的判据面全是显式常数，可审计；自适应预算会让同一条腿
 * 在不同机器上花不同时间还都算绿，等于把可复算性换成方便。**两个常数必须成对改**：
 * 子进程预算（60s）必须小于用例天花板（90s），否则 vitest 会先掐用例，掐出来的报法
 * 是 "Test timed out" 而不是守卫的具名错误 ⇒ 又回到"分不清是没跑成还是判红"那个坑。
 * 守卫本身仍能抓到真超时（spawnSync 超时照旧返回 status=null）。
 */
const CLI_SUBPROCESS_BUDGET_MS = 60_000
const CLI_TEST_TIMEOUT_MS = 90_000

describe('CLI 入口（子进程真跑）', () => {
  // 这一段每条都起子进程：vitest 默认 5s 天花板会在 85 文件并行时先把探针判成超时
  // （报的是"Test timed out"而不是任何真实结论）。子进程预算必须小于用例天花板。
  const itCli = (name, fn) => it(name, fn, CLI_TEST_TIMEOUT_MS)

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
  itCli('逃生门：缺理由照样拒；带理由才放行，且**必须真的落一条可复算的账**（第五十三轮 E3 装的计量）', () => {
    const noReason = runCli({ input: ref('main'), env: { CI_GREEN_SKIP: '1' } })
    expect(noReason.rc).toBe(1)
    expect(noReason.out).toContain('仍拒')
    // 落点指到临时目录：不设这条，本腿会以 cwd=REPO 往仓内真账本 `.ci/escape-hatch.jsonl` 追加一行，
    // 于是"演练"污染了本该只记真实绕过的审计面（本轮实测确实写过）。
    const led = tmpLayout()
    const withReason = runCli({
      input: ref('main'),
      env: { CI_GREEN_SKIP: '1', CI_GREEN_LEDGER_DIR: led, CI_GREEN_REASON: 'fixture 演练：基座红不可自愈，本笔正是那条修复' },
    })
    expect(withReason.rc, withReason.out).toBe(0)
    expect(withReason.out).toContain('绕过契约')
    expect(withReason.out).toContain('.ci/escape-hatch.jsonl')
    const line = readFileSync(join(led, '.ci', 'escape-hatch.jsonl'), 'utf8').trim()
    const rec = JSON.parse(line)
    for (const k of ['utc', 'base_sha', 'head_sha', 'branch', 'reason', 'actor']) {
      expect(String(rec[k] || ''), `记录字段 ${k} 不得为空（否则这条账无法复算）`).not.toBe('')
    }
    expect(rec.head_sha.slice(0, 7)).toBe(HEAD_SHA.slice(0, 7))
    // 理由太短 ⇒ 记一条对不了账的账比不记更坏 ⇒ 拒放行且不留半成品
    const led2 = tmpLayout()
    const short = runCli({ input: ref('main'), env: { CI_GREEN_SKIP: '1', CI_GREEN_LEDGER_DIR: led2, CI_GREEN_REASON: '太短了' } })
    expect(short.rc, short.out).toBe(1)
    expect(short.out).toContain('无法落账')
    expect(existsSync(join(led2, '.ci', 'escape-hatch.jsonl')), '拒写时不得留下半成品记录').toBe(false)
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
  // 第七十轮补的**预算自证腿**：上修预算（20s→60s）最大的风险是把守卫的牙齿一起磨掉 ——
  // 那条腿以后真超时也只会安静地返回一个 status=null，没人再被具名错误拦住。
  // 所以这里不测"预算够不够"，测"**守卫在预算内仍然能分辨没跑成**"：
  // 直接喂一个 status=null 的 spawnSync 返回值（模拟被打断），断言守卫抛的是具名错误而不是静默放行。
  it('预算自证：守卫对 status=null 的返回值仍然抛具名错误（上修预算不许磨掉牙齿）', () => {
    expect(() => assertCliRan({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' },
      { label: '预算自证夹具', budgetMs: CLI_SUBPROCESS_BUDGET_MS }))
      .toThrow(/\[cli-leg-timeout\]/)
    expect(() => assertCliRan({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' },
      { label: '预算自证夹具', budgetMs: CLI_SUBPROCESS_BUDGET_MS }))
      .toThrow(/这条腿没跑成/)
    // 预算必须小于用例天花板，否则 vitest 先掐用例 ⇒ 掐出来的是 "Test timed out"（无判据名），
    // 于是又回到「分不清是没跑成还是判红」那个坑。这条断言把那对关系钉在产物上。
    expect(CLI_SUBPROCESS_BUDGET_MS).toBeLessThan(CLI_TEST_TIMEOUT_MS)
    // 且必须比旧值大，否则这次上修根本没发生（防止有人把两个常数一起改回 20s/30s）
    expect(CLI_SUBPROCESS_BUDGET_MS).toBeGreaterThan(20_000)
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
