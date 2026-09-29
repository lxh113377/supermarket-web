import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCliRan } from './helpers/cliLeg.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 第五十四轮 R54-H4：CLI 腿的"先证跑成了"守卫。
 * 起因是一条 flake——并行负载把 20s 预算打断，`status=null`/`stdout=''` 被当成"判据给出的空结论"
 * 继续做内容断言，报出 `expected '' to contain 'branch=main'`（单跑却绿）。
 * 本文件钉的是**这条守卫本身**：它必须只拒"没跑成"，绝不能把"跑成了但输出为空/rc 非 0"也拒掉，
 * 否则就是一条会吞真话的假守卫。
 */

describe('assertCliRan（CLI 腿守卫：没跑成 ≠ 判据结论）', () => {
  it('真跑成的腿：rc=0 且 stdout 为空 ⇒ **不得**抛（空输出在 status 存在时是合法结论）', () => {
    const r = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8', timeout: 20_000 })
    expect(assertCliRan(r, { label: 'exit0', budgetMs: 20_000 }).status).toBe(0)
  })

  it('真跑成但判红：rc=1 ⇒ 不得抛（守卫不是"任何非 0 都拒"，那是把判据的嘴堵上）', () => {
    const r = spawnSync(process.execPath, ['-e', 'process.exit(1)'], { encoding: 'utf8', timeout: 20_000 })
    expect(assertCliRan(r, { label: 'exit1', budgetMs: 20_000 }).status).toBe(1)
  })

  it('漏报侧：status=null（超时被信号杀）⇒ 必须抛具名 [cli-leg-timeout]，且消息里带预算与 label', () => {
    let msg = ''
    try {
      assertCliRan({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', options: {} }, { label: 'mutant M2', budgetMs: 20_000 })
    } catch (e) { msg = String(e && e.message) }
    expect(msg).toContain('[cli-leg-timeout]')
    expect(msg).toContain('mutant M2')
    expect(msg).toContain('预算=20000ms')
    expect(msg).toContain('signal=SIGTERM')
  })

  it('形态：被信号杀但 signal 缺失 ⇒ 印 unknown 而不是崩在字符串拼接上（失败路径自己不许失败）', () => {
    let msg = ''
    try {
      assertCliRan({ status: null, signal: null, stdout: null }, { label: 'noSignal' })
    } catch (e) { msg = String(e && e.message) }
    expect(msg).toContain('signal=unknown')
    expect(msg).toContain('stdout=0B')
    expect(msg).toContain('预算=?')
  })

  it('变异体面：把 null 判定摘掉（传 status=0）⇒ 守卫必须放行，证明它判的是 null 而不是"有没有 stdout"', () => {
    const r = { status: 0, signal: 'SIGTERM', stdout: '', stderr: '' }
    expect(assertCliRan(r, { label: 'onlyNullCounts', budgetMs: 1000 }).status).toBe(0)
  })

  it('接线正向：接入面由磁盘现算，并与欠账判据双向对账（名单不手抄）', () => {
    // 上一版这里写死 `['ciGreenContract','itemBudgets','escapeHatchLog','docCommands']` 四个名字。
    // 第五十五轮把 4 件文件接上守卫后，那份名单当场落后（判据说 9 件在用，名单只认 4 件）——
    // 这正是户内「声明式名单每轮要跑双向差集，否则会漂成死豁免」的形态，故改成从磁盘取数。
    const importers = readdirSync(HERE)
      .filter((n) => n.endsWith('.test.js'))
      .map((n) => ({ n, src: readFileSync(join(HERE, n), 'utf8') }))
      .filter((x) => x.src.includes("from './helpers/cliLeg.js'"))
    expect(importers.length, '接入面为 0 ⇒ 守卫没人用（不得静默 PASS）').toBeGreaterThan(0)
    for (const { n, src } of importers) {
      expect(src, `${n} import 了却不调用 = 装饰性接线`).toMatch(/assertCliRan\(/)
    }
    // 双向差集：判据认定的「已接守卫」集合 ⇄ 磁盘 import 集合，两个方向都要空
    const r = spawnSync(process.execPath, ['scripts/check-cli-leg-coverage.mjs', '--json'], {
      cwd: join(HERE, '..'), encoding: 'utf8', timeout: 120_000,
    })
    const judged = assertCliRan(r, { label: 'cliLegGuard 取欠账判据 --json', budgetMs: 120_000 })
    expect(judged.status, `判据自身崩了 rc=${judged.status}：${String(judged.stderr).slice(-200)}`).toBe(0)
    const j = JSON.parse(judged.stdout)
    const onDisk = importers.map((x) => `tests/${x.n}`).sort()
    const fromJudge = [...j.guarded].sort()
    const debt = [...j.debt].sort()
    // 判据的采集面必须与磁盘同集合（它扫的也是 tests/*.test.js）：否则"两边各自数自己的"照样对不出漂移
    expect(fromJudge.length + debt.length, `判据采集的守卫接入数(${fromJudge.length})+欠账(${debt.length}) 应与磁盘名单独立可核`).toBeGreaterThan(0)
    const missingFromJudge = onDisk.filter((f) => !fromJudge.includes(f))
    expect(missingFromJudge, `磁盘 import 了但判据没认成已接入：${missingFromJudge.join(', ')}`).toEqual([])
    const phantomInJudge = fromJudge.filter((f) => !onDisk.includes(f))
    expect(phantomInJudge, `判据认成已接入但磁盘上没有：${phantomInJudge.join(', ')}`).toEqual([])
    // 两个集合必须互斥：同一件文件既算"已接守卫"又算"欠账"说明判据的取数面自己矛盾
    const both = fromJudge.filter((f) => debt.includes(f))
    expect(both, `同批文件既在已接入又在欠账名单：${both.join(', ')}`).toEqual([])
    expect(debt.length, '欠账名单非空时判据必须把它们逐个点名（名单长度==stats.debt 是它自己的恒等面）').toBe(j.stats.debt)
    // 恒等式外部复算：判据自证的 1+2==3 这条腿，测试这一侧要能独立发现它不成立
    expect(j.stats.sitesTotal, `位点恒等式不闭合：total=${j.stats.sitesTotal} with_timeout=${j.stats.sitesTimeout} without=${j.stats.sitesNoTimeout}`)
      .toBe(j.stats.sitesTimeout + j.stats.sitesNoTimeout)
  })
})
