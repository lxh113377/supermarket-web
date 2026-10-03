// 第三十六轮夹具：外层"工作区级记忆指针"看守判据（P1/P2 三态）。
// 立它的实测：外层指针序列止于第二十九轮、内层已到第三十五轮，5 轮断更无人在意。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { assertCliRan } from './helpers/cliLeg.js'
import { evaluate, latestRound, roundSetOf, changelogRounds, ORPHAN_BASELINE, roundsOf, cnNum, OUTER_MEMORY } from '../scripts/check-memory-pointer-sync.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-memory-pointer-sync.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const row = (rows, id) => rows.find((r) => r.id === id)
/** cn(36) → '三十六'：cnNum 的反向，只为造合成外层；配对是否成立由夹具自己往返断言。 */
const CN_D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const cn = (n) => (n < 10 ? CN_D[n] : `${CN_D[Math.floor(n / 10)] || ''}十${n % 10 ? CN_D[n % 10] : ''}`)

describe('中文轮次解析（读不懂必须返回空，不得当 0）', () => {
  it('单值与边界', () => {
    expect(cnNum('三十五')).toBe(35)
    expect(cnNum('十')).toBe(10)
    expect(cnNum('二十')).toBe(20)
    expect(cnNum('九十九')).toBe(99)
    expect(cnNum('七')).toBe(7)
  })
  it('区间写法（R35 那次补齐就是"第三十~三十五轮"）⇒ 两个端点都要收到', () => {
    expect(roundsOf('## 2026-09-27 — 对标第三十~三十五轮（工作区级指针）')).toEqual([30, 35])
    expect(roundsOf('## 对标第三十二轮')).toEqual([32])
  })
  it('第五十九轮反例：标题不带"对标"二字也必须入面（58/59 两轮就是这样整段躲过这条闸的）', () => {
    expect(roundsOf('## 2026-10-01 — 第五十八轮续（R58-H1 落地：跨日采样 t1910）')).toEqual([58])
    expect(roundsOf('## 2026-10-01 — 第五十九轮（对侧「维护状态」转引改实测）')).toEqual([59])
    // 两种写法同时存在时都要收到，且不得因前缀可选而把"本轮/末轮"这类词读成轮次
    expect(roundsOf('第五十七轮正文已迁至 part115')).toEqual([57])
    expect(roundsOf('本轮 末轮 下一轮')).toEqual([])
  })
  it('解析不了 ⇒ 空数组，不是 [0]', () => {
    expect(roundsOf('## 随便一行没有轮次')).toEqual([])
    expect(roundsOf('## 对标第X轮')).toEqual([])
    expect(cnNum('三百')).toBe(null)
  })
})

describe('P1/P2 三态', () => {
  const inner = { round: 36, seen: [36], ambiguous: [] }
  const outer36 = { round: 36, seen: [36], ambiguous: [] }
  it('跟上 ⇒ 四条都 PASS（P3 喂对齐的 CHANGELOG 面，不喂即 UNVERIFIED）', () => {
    const v = evaluate({ inner, outer: outer36, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36] })
    expect(v.map((r) => r.state)).toEqual(['PASS', 'PASS', 'PASS', 'PASS'])
  })
  it('不断言"没喂 CHANGELOG 也全绿"：缺第三面时 P3 必须写 UNVERIFIED', () => {
    const v = evaluate({ inner, outer: outer36 })
    expect(row(v, 'P3').state).toBe('UNVERIFIED')
  })
  it('断更 ⇒ P2 红，并把"补指针或改口径"两条出路写进结论', () => {
    const v = row(evaluate({ inner, outer: { round: 29, seen: [29] } }), 'P2')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('断更 7 轮')
    expect(v.detail).toContain('补一条指针')
  })
  it('外层超前 ⇒ 也判红并指向"取数有一侧不对"（不许把它当"外层更勤快"）', () => {
    const v = row(evaluate({ inner, outer: { round: 40, seen: [40] } }), 'P2')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('超前')
  })
  it('外层目录不存在 ⇒ UNVERIFIED，且 ok 不为 FAIL（CI 只检出代码仓）', () => {
    const v = row(evaluate({ inner, outer: null }), 'P2')
    expect(v.state).toBe('UNVERIFIED')
    expect(v.detail).toContain('不是已核对')
  })
  it('内层取不到轮次 ⇒ FAIL（取数面坏了不判通过）', () => {
    expect(row(evaluate({ inner: null, outer: { round: 1, seen: [1] } }), 'P1').state).toBe('FAIL')
  })
})

describe('P3 第三取数面（第六十五轮：CHANGELOG 宣称 ⇄ 内层记忆，权威=内层）', () => {
  const inner = { round: 36, seen: [36], ambiguous: [] }
  const outer36 = { round: 36, seen: [36], ambiguous: [] }
  const base = { inner, outer: outer36, innerRounds: [36] }
  it('对齐面 ⇒ P3 PASS 且写清"新增缺失 0"', () => {
    const v = row(evaluate({ ...base, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36] }), 'P3')
    expect(v.state).toBe('PASS')
    expect(v.detail).toContain('新增缺失 0')
  })
  it('新增缺失 ⇒ FAIL 并点名轮号（禁加进基线消音）', () => {
    const v = row(evaluate({ ...base, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36, 63] }), 'P3')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('63')
    expect(v.detail).toContain('禁加进基线消音')
  })
  it('存量在册 ⇒ PASS（口径立于判据之前，不逼后人编假记忆）', () => {
    const v = row(evaluate({ ...base, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36] }), 'P3')
    expect(v.state).toBe('PASS')
    expect(v.detail).toContain('存量在册')
  })
  it('基线幽灵 ⇒ FAIL（那一轮已有记忆节就必须把号删出基线）', () => {
    const v = row(evaluate({ ...base, innerRounds: [12, 36], clRounds: [...ORPHAN_BASELINE, 12, 36] }), 'P3')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('基线幽灵')
    expect(v.detail).toContain('12')
  })
  it('CHANGELOG 取不到 ⇒ UNVERIFIED（未观测，不判漂移）', () => {
    const v = row(evaluate({ ...base, clRounds: null, changelogPath: 'no-such-file.md' }), 'P3')
    expect(v.state).toBe('UNVERIFIED')
  })
  it('ORPHAN_BASELINE 不含 63（约定生效后才发生的真缺陷不许进册）', () => {
    expect(ORPHAN_BASELINE).not.toContain(63)
  })
})

describe('P4 一节只准一个轮号（第六十五轮：补记者编号不得顶高最新轮次）', () => {
  const inner = { round: 64, seen: [64], ambiguous: [] }
  const outer64 = { round: 64, seen: [64], ambiguous: [] }
  const base = { inner, outer: outer64, innerRounds: [64], clRounds: [64] }
  it('无歧义 ⇒ P4 PASS', () => {
    expect(row(evaluate(base), 'P4').state).toBe('PASS')
  })
  it('一节双号 ⇒ FAIL 并点名文件（标题只留被记轮，补记说明挪正文）', () => {
    const bad = { ...inner, ambiguous: [{ file: '07-next-steps.md', rounds: [43, 44], title: '## 2026-09-28 — 对标第四十四轮' }] }
    const v = row(evaluate({ ...base, inner: bad }), 'P4')
    expect(v.state).toBe('FAIL')
    expect(v.detail).toContain('43,44')
  })
  it('区间写法豁免（第三十~三十五轮是本仓合法补齐形态）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smptr-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, '07-next-steps.md'), '## 2026-09-27 — 对标第三十~三十五轮（工作区级指针）\n')
    const r = latestRound(dir)
    expect(r.round).toBe(35)
    expect(r.ambiguous).toEqual([])
  })
})

describe('roundSetOf / changelogRounds（集合形态：max 口径盖得住缺号，差集盖不住）', () => {
  it('只吃标题行：正文里的"第N轮"转述不算宣称', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smptr-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, '07-next-steps.md'),
      '## 2026-10-02 — 第六十四轮（正文）\n接管第六十二轮那条 P0。\n')
    expect(roundSetOf(dir)).toEqual([64])
  })
  it('CHANGELOG 面认 ### 前缀：正文口径会把 2 个宣称涨成 9 个（第六十五轮实测）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smptr-'))
    tmpDirs.push(dir)
    const f = join(dir, 'CHANGELOG.md')
    writeFileSync(f, '### 2026-10-02 商品图轮换（第六十三轮）\n正文提到第六十二轮。\n')
    expect(changelogRounds(f)).toEqual([63])
  })
  it('文件不在 ⇒ null（未观测，不是零）', () => {
    expect(changelogRounds(join(tmpdir(), 'sm-no-such-file.md'))).toBeNull()
  })
})

describe('真面与入口', () => {
  it('路径自证：外层目录必须是代码仓的**同级**（首版写成上两级 ⇒ 恒 UNVERIFIED 且输出看着合理）', () => {
    const parent = resolve(REPO, '..')
    expect(resolve(OUTER_MEMORY)).toBe(join(parent, '超市', 'memory'))
  })
  it('真跑本仓：内层取到轮次；外层**在不在场由本机决定**，但两条分支各有一条真断言', () => {
    // 第八形态教训（第三十六轮 CI 实测）：本腿曾无条件断言"外层目录必须存在"，
    // 而 CI 只检出代码仓 ⇒ 一条讲本机事实的断言把 81cd520 判红。环境可以缺，断言不能空。
    const inner = latestRound(join(REPO, 'memory'))
    expect(inner.round, '内层 07 系里应能取到"对标第N轮"标题').not.toBeNull()
    const present = existsSync(OUTER_MEMORY)
    const outer = present ? latestRound(OUTER_MEMORY) : null
    const clPath = join(REPO, 'CHANGELOG.md')
    const v = evaluate({
      inner, outer, outerPath: OUTER_MEMORY,
      innerRounds: roundSetOf(join(REPO, 'memory')),
      clRounds: changelogRounds(clPath), changelogPath: clPath,
    })
    if (present) {
      expect(outer, '本机外层目录存在 ⇒ 必须读出轮次，读不出就是取数面坏了').not.toBeNull()
      expect(v.some((r) => r.state === 'UNVERIFIED'), `外层在本地可见却报未验证：${JSON.stringify(v)}`).toBe(false)
    } else {
      // CI：外层不在场 ⇒ 判据必须把"没比"写在脸上，且分母要降下来（不得印 检查 2/2）
      expect(row(v, 'P2').state).toBe('UNVERIFIED')
      const r = assertCliRan(spawnSync(process.execPath, [SELF], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync 外层不在场' })
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(r.stdout).toContain('已核对 3/4')
      expect(r.stdout).toContain('未验证 P2')
      expect(r.stdout).not.toContain('检查 2/2')
    }
  })
  it('合成外层在场 ⇒ 观测通道真的通（CI 里外层永远不在，这条用注入替它自证）', () => {
    const inner = latestRound(join(REPO, 'memory'))
    expect(inner.round).not.toBeNull()
    const dir = mkdtempSync(join(tmpdir(), 'smouter-'))
    tmpDirs.push(dir)
    writeFileSync(join(dir, '07-next-steps.md'), `## 2026-09-27 — 对标第${cn(inner.round)}轮（工作区级指针）\n`)
    // 夹具自身先做往返自证：我写的中文轮次必须能被同一套解析器读回同一个数，否则绿的是空气
    expect(roundsOf(readFileSync(join(dir, '07-next-steps.md'), 'utf8'))).toEqual([inner.round])
    const same = assertCliRan(spawnSync(process.execPath, [SELF, '--outer', dir], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync 合成外层同轮' })
    expect(same.status, same.stdout + same.stderr).toBe(0)
    expect(same.stdout).toContain('已核对 4/4')
    expect(same.stdout).not.toContain('未验证')
    const behind = mkdtempSync(join(tmpdir(), 'smouter-'))
    tmpDirs.push(behind)
    writeFileSync(join(behind, '07-next-steps.md'), `## 2026-09-27 — 对标第${cn(Math.max(1, inner.round - 3))}轮（工作区级指针）\n`)
    const lag = assertCliRan(spawnSync(process.execPath, [SELF, '--outer', behind], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync 合成外层落后' })
    expect(lag.status, lag.stdout + lag.stderr).toBe(1)
    expect(lag.stdout).toContain('断更 3 轮')
  })
  it('子进程：GATE 行 + rc（红=1 / 绿=0），--json 出结构', () => {
    const r = assertCliRan(spawnSync(process.execPath, [SELF], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync GATE 行' })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GATE-PASS memory-pointer-sync')
    const j = JSON.parse(assertCliRan(spawnSync(process.execPath, [SELF, '--json'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync --json' }).stdout)
    expect(j.rows.map((x) => x.id)).toEqual(['P1', 'P2', 'P3', 'P4'])
    expect(j.checked + j.rows.filter((x) => x.state === 'UNVERIFIED').length).toBe(j.declared)
  })
  it('缺输入面：只有脚本、没有 memory/ 的假仓 ⇒ rc=2 且点名取不到（不得静默 0）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smptr-'))
    tmpDirs.push(dir)
    copyGateScripts(REPO, dir, 'check-memory-pointer-sync.mjs')
    const r = assertCliRan(spawnSync(process.execPath, [join(dir, 'scripts', 'check-memory-pointer-sync.mjs')], { cwd: dir, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync 缺输入面' })
    expect(r.status, r.stdout + r.stderr).toBe(2)
    expect(`${r.stderr}${r.stdout}`).toMatch(/memory/)
  })
})
