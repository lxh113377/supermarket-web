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
import { evaluate, latestRound, roundSetOf, changelogRounds, ORPHAN_BASELINE, roundsOf, cnNum, OUTER_MEMORY, reportRoundOf, parsePorcelainZ, makeGitRunner, OUTER_REPO } from '../scripts/check-memory-pointer-sync.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-memory-pointer-sync.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
/**
 * 合成"外层目录存在"的面（第七十一轮 CI 一手）。
 * 本机 `OUTER_MEMORY` 在，CI 里没有 ⇒ 凡拿它当默认面的夹具都会**两端跑出不同分支**：
 * P5 在 CI 上走"外层目录不在"，在本地走"git 探针没注入"，同一句断言只能在一边成立。
 * 夹具必须自带它要测的那个前提，不靠本机现状。
 */
const OUTER_FAKE = mkdtempSync(join(tmpdir(), 'smouter-face-'))
tmpDirs.push(OUTER_FAKE)
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
    // P5 不在这四条的断言面里：它判的是"归档仓有没有入库"，需要 git 通道 + 外层目录两个前提，单独一个 describe 立它的牙齿。
    expect(v.filter((r) => r.id !== 'P5').map((r) => r.state)).toEqual(['PASS', 'PASS', 'PASS', 'PASS'])
    expect(row(v, 'P5').state).toBe('UNVERIFIED')
  })
  it('P5 的未验证有两种来源，各自都要点名（外层不在 / git 探针没注入 ⇒ 两句不同的话）', () => {
    const noGit = evaluate({ inner, outer: outer36, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36], outerPath: OUTER_MEMORY, gitRunner: null })
    const noOuter = evaluate({ inner, outer: outer36, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36], outerPath: join(OUTER_MEMORY, 'no-such-dir'), gitRunner: () => ({ rc: 0, stdout: '' }) })
    if (existsSync(OUTER_MEMORY)) {
      expect(row(noGit, 'P5').detail).toContain('禁止按')
      expect(row(noOuter, 'P5').detail).toContain('外层目录不在')
    } else {
      // CI：外层目录本来就不在，"探针没注入"那一支只能由显式给的合成面来证
      expect(row(noOuter, 'P5').detail).toContain('外层目录不在')
    }
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
      const mine = v.filter((r) => r.id !== 'P5')
      expect(mine.some((r) => r.state === 'UNVERIFIED'), `外层在本地可见却报未验证：${JSON.stringify(mine)}`).toBe(false)
    } else {
      // CI：外层不在场 ⇒ 判据必须把"没比"写在脸上，且分母要降下来（不得印 检查 2/2）
      expect(row(v, 'P2').state).toBe('UNVERIFIED')
      const r = assertCliRan(spawnSync(process.execPath, [SELF], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'memory-pointer-sync 外层不在场' })
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(r.stdout).toContain('已核对 3/5')
      expect(r.stdout).toContain('未验证 P2,P5')
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
    // 合成外层没有配套归档仓 ⇒ P5 必须走未验证（不许悄悄去读**真**归档仓，那会让两套事实挤进同一行）
    expect(same.stdout).toContain('已核对 4/5')
    expect(same.stdout).toContain('未验证 P5')
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
    expect(j.rows.map((x) => x.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
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

/**
 * 第七十轮 E3：把 P2 从"只在 verify 链里跑"挪到**提交那一刻**。
 *
 * 立它的实测：第七十轮 `npm run verify` 全链 34 条判据里唯一那条红就是 P2（外层 68 / 内层 69，断更 1 轮），
 * 而它**连坐**了上面那条「子进程 rc 断言」——因为那条用例真跑生产判据、期望 rc=0。
 * 也就是说：断更这件事本来在 commit 那一刻就能拦，却要等下一轮 verify 才现形，
 * 而"等下一轮"这个动作没人保证会发生（第30~34轮曾静默断更 5 轮）。
 *
 * 三块缺一不可：
 *   ① 接线半边 —— 腿在钩子里、在 `set -e` 之后、且不以注释形态出现；
 *   ② 牙齿半边 —— HEAD 干净检出上该腿必须绿；把外层轮号改旧后**同一行**必须红；复原后重新变绿；
 *   ③ 反向半边 —— 把该腿换成 no-op，上面那些断言必须翻红（证明 ①②不是在读空气）。
 *
 * 命令从**钩子原文**里读出来，不在夹具里写死 —— 钩子改了腿，夹具跟着走，
 * 也就不会测成"另一个我手抄的命令"（沿用 tests/docCommands.test.js 的 E2 口径）。
 */
describe('E3 指针断更挪到提交那一刻（钩子必须拦）', () => {
  const HOOK = join(REPO, '.githooks', 'pre-commit')
  // 从钩子原文里取那条腿，不写死命令
  const hookLeg = () => {
    const hook = readFileSync(HOOK, 'utf8')
    const legs = hook.split('\n').filter((l) => l.includes('check-memory-pointer-sync.mjs') && !l.trimStart().startsWith('#'))
    return { hook, legs }
  }

  it('接线半边：钩子里真有那条腿、恰好一次、在 set -e 之后、且不以注释形态出现', () => {
    const { hook, legs } = hookLeg()
    expect(legs, `钩子里该腿出现 ${legs.length} 次，必须恰好 1 次`).toHaveLength(1)
    expect(legs[0].trim(), '本腿不带档位参数：判据本身默认即阻断档，多加 flag 只会掩盖钩子接线错了').toBe('node scripts/check-memory-pointer-sync.mjs')
    // 位置比的是**腿行本身**，不是 `indexOf('脚本文本')` —— 注释里只要提一句这个名字，
    // `indexOf` 就会命中注释（byte 1028）而不是腿（byte 1430），断言当场翻红。
    // 夹具自己也会写坏（沿用 docCommands E2 记过的同一形态），所以这条断言必须量可归因的那个位置。
    const lines = hook.split('\n')
    const setEAt = lines.findIndex((l) => l.trim() === 'set -e')
    const legAt = lines.findIndex((l) => l.includes('check-memory-pointer-sync.mjs') && !l.trimStart().startsWith('#'))
    expect(setEAt, '钩子里必须有 `set -e`，否则前一条腿红时后面的腿照样跑').toBeGreaterThanOrEqual(0)
    expect(setEAt, '`set -e` 必须在该腿之前').toBeLessThan(legAt)
    // 夹具自身先自证往返：写的中文轮次必须能被同一套解析器读回同一个数，否则绿的是空气
    expect(roundsOf(`## 2026-10-07 — 对标第${cn(69)}轮（工作区级指针）`)).toEqual([69])
  })

  it('反向半边：把那条腿换成 no-op ⇒ 上面那条断言必须翻红（证明接线断言有牙齿）', () => {
    const { hook } = hookLeg()
    const tampered = hook.replace(/check-memory-pointer-sync\.mjs/g, 'echo-ok.mjs')
    expect(tampered).not.toContain('check-memory-pointer-sync.mjs')
    expect(tampered.split('\n').filter((l) => l.includes('echo-ok.mjs') && !l.trimStart().startsWith('#'))).toHaveLength(1)
  })

  it('牙齿半边：HEAD 干净检出上那条腿必须绿（断更不许进库），外层轮号改旧后同一行必须红', () => {
    const { legs } = hookLeg()
    const dir = mkdtempSync(join(tmpdir(), 'smptr-hook-'))
    try {
      // git archive 的两条纪律（照 docCommands E2 抄）：`-o` 收**绝对路径**（否则 tar 落进 cwd=仓库根），
      // `-xf` 只在检出根里用相对文件名（绝对路径喂 tar 在 Git-Bash 上会被当远程主机名）。
      const tar = join(dir, 'head.tar')
      const arch = spawnSync('git', ['archive', '-o', tar, 'HEAD'], { cwd: REPO, encoding: 'utf8', timeout: 120_000 })
      expect(arch.status, arch.stderr).toBe(0)
      expect(existsSync(tar), `git archive 没在检出根里落下 ${tar}`).toBe(true)
      const ex = spawnSync('tar', ['-xf', 'head.tar'], { cwd: dir, encoding: 'utf8', timeout: 120_000 })
      expect(ex.status, ex.stderr).toBe(0)

      // 合成外层：检出树里**没有**真外层目录（它在仓外），所以这条腿默认会判 P2 UNVERIFIED。
      // 而 UNVERIFIED 是"未观测"不是"通过" ⇒ 不能拿它当绿。要证明这条腿真的会红，必须显式喂一个外层。
      const inner = latestRound(join(dir, 'memory'))
      expect(inner.round, '检出树里取不到内层轮次 ⇒ 后面全是空气').not.toBeNull()
      const outer = mkdtempSync(join(tmpdir(), 'smptr-outer-'))
      tmpDirs.push(outer)
      const outerFile = join(outer, '07-next-steps.md')
      const sameRound = `## 2026-10-07 — 对标第${cn(inner.round)}轮（工作区级指针）\n`
      writeFileSync(outerFile, sameRound, 'utf8')

      const argv = legs[0].trim().split(/\s+/)
      expect(argv[0], '腿的 runner 必须能换成 process.execPath（本仓用 node）').toBe('node')
      const runLeg = (outDir) => spawnSync(process.execPath, [...argv.slice(1), '--outer', outDir],
        { cwd: dir, encoding: 'utf8', timeout: 120_000 })

      const control = runLeg(outer)
      expect(control.error, `那条腿没跑起来，结论不作数：${control.error && control.error.message}`).toBeUndefined()
      expect(control.status,
        `HEAD 里就带着一张断更的外层指针 ⇒ 这正是本块要禁的那件事：${`${control.stdout || ''}${control.stderr || ''}`.slice(-500)}`
      ).toBe(0)

      // 断更 3 轮 ⇒ 同一行必须红，且红话要说人话（点出断更几轮）
      writeFileSync(outerFile, `## 2026-10-07 — 对标第${cn(Math.max(1, inner.round - 3))}轮（工作区级指针）\n`, 'utf8')
      const red = runLeg(outer)
      expect(red.error, `反例那腿没跑起来，结论不作数：${red.error && red.error.message}`).toBeUndefined()
      expect(red.status, '外层指针落后 3 轮，钩子那条腿必须拦').toBe(1)
      expect(red.stdout).toContain('断更 3 轮')

      // 复原 ⇒ 重新变绿（顺带证明"绿/红"不是检出树被搞坏导致的假象）
      writeFileSync(outerFile, sameRound, 'utf8')
      expect(runLeg(outer).status, '复原后必须重新变绿').toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 240_000)
})

/**
 * P5（第七十一轮）：外层**归档面**是否真入库。一手缺陷：第七十轮那份报告写在磁盘上、内容也对，
 * 但它在外层 git 里是 `??`，台账改动一直是 `M` ⇒ P2 判"内容跟上了"是绿的，而账没还。
 * 本块的 git 通道全部走注入表（夹具不建 git 仓、不碰真归档仓）。
 */
const repName = (r) => `GitHub开源项目对标分析报告-第${cn(r)}轮-2026-01-01.md`
const archDirOf = (rounds) => {
  const d = mkdtempSync(join(tmpdir(), 'smarch-'))
  tmpDirs.push(d)
  for (const r of rounds) writeFileSync(join(d, repName(r)), '# x\n', 'utf8')
  return d
}
/** 归档面替身：tracked=跟踪册里有哪些路径；dirty=`git status --porcelain -z` 的原始记录。 */
const archiveFace = ({ tracked = [], dirty = [], rc = 0 } = {}) => (args) => {
  if (args[0] === 'ls-files') return { rc, stdout: `${tracked.join('\0')}${tracked.length ? '\0' : ''}` }
  if (args[0] === 'status') return { rc, stdout: `${dirty.map((p) => ` M ${p}`).join('\0')}${dirty.length ? '\0' : ''}` }
  return { rc: 1, stdout: '' }
}

describe('P5 外层归档面：产物必须真进归档仓（第七十一轮）', () => {
  const inner = { round: 36, seen: [36], ambiguous: [] }
  const outer36 = { round: 36, seen: [36], ambiguous: [] }
  const base = (over) => evaluate({
    inner, outer: outer36, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36],
    outerPath: OUTER_FAKE, deliverablesDir: archDirOf([35, 36]), ...over,
  })
  it('文件名轮号解析与状态行解析各自成面', () => {
    expect(reportRoundOf(repName(36))).toBe(36)
    expect(reportRoundOf('对标报告-2026-09-30.md')).toBe(null)
    expect(reportRoundOf('对标第二轮交付记录-2026-09-24.md')).toBe(2)
    expect(parsePorcelainZ(' M 超市/memory/07-next-steps.md\0')).toEqual([{ xy: ' M', path: '超市/memory/07-next-steps.md' }])
    expect(parsePorcelainZ('')).toEqual([])
  })
  it('正例：上一轮的报告已跟踪 + 归档面干净 ⇒ PASS', () => {
    const v = base({ gitRunner: archiveFace({ tracked: [`deliverables/${repName(35)}`, '超市/memory/07-next-steps.md'] }) })
    expect(row(v, 'P5').state).toBe('PASS')
    expect(row(v, 'P5').detail).toContain('上一轮 35 已跟踪 是')
  })
  it('反例一：上一轮的报告在磁盘上但不在跟踪册 ⇒ FAIL，并把"到外层 add 哪个文件"写进结论', () => {
    const v = base({ gitRunner: archiveFace({ tracked: ['超市/memory/07-next-steps.md'] }) })
    expect(row(v, 'P5').state).toBe('FAIL')
    expect(row(v, 'P5').detail).toContain('产物写了但没入库')
    expect(row(v, 'P5').detail).toContain('git add')
  })
  it('反例二：归档面有未提交件（台账改了没落历史）⇒ FAIL 且逐件点名 XY 状态', () => {
    const v = base({
      gitRunner: archiveFace({ tracked: [`deliverables/${repName(35)}`], dirty: ['超市/memory/07-next-steps.md'] }),
    })
    expect(row(v, 'P5').state).toBe('FAIL')
    expect(row(v, 'P5').detail).toContain('M 超市/memory/07-next-steps.md')
  })
  it('宽限一轮：本轮（36）那份报告 dirty 不拦 —— 循环次序本来就是 报告→内层提交→外层提交', () => {
    const v = base({
      gitRunner: archiveFace({ tracked: [`deliverables/${repName(35)}`], dirty: [`deliverables/${repName(36)}`] }),
    })
    expect(row(v, 'P5').state).toBe('PASS')
  })
  it('反向三（牙齿）：本轮报告既不在磁盘也不在跟踪册 ⇒ FAIL，"产物没落笔"不许被宽限规则盖住', () => {
    const d = mkdtempSync(join(tmpdir(), 'smarch-'))
    tmpDirs.push(d)
    writeFileSync(join(d, repName(34)), '# x\n', 'utf8')
    const v = evaluate({
      inner, outer: outer36, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36],
      outerPath: OUTER_FAKE, deliverablesDir: d, gitRunner: archiveFace({ tracked: [`deliverables/${repName(35)}`] }),
    })
    expect(row(v, 'P5').state).toBe('FAIL')
    expect(row(v, 'P5').detail).toContain('产物没落笔')
  })
  it('未验证四态：git 通道没注入 / git 非零 / 外层目录不在 ⇒ 一律 UNVERIFIED，绝不折算成"都干净"', () => {
    expect(row(base({ gitRunner: null }), 'P5').state).toBe('UNVERIFIED')
    expect(row(base({ gitRunner: () => ({ rc: 128, stdout: '' }) }), 'P5').state).toBe('UNVERIFIED')
    const gone = join(archDirOf([35, 36]), 'nope')
    expect(row(base({ gitRunner: archiveFace({}), outerPath: gone }), 'P5').state).toBe('UNVERIFIED')
  })
  it('取数面读不出目录（deliverables 不在）⇒ UNVERIFIED 并点名那个目录', () => {
    const v = evaluate({
      inner, outer: outer36, innerRounds: [36], clRounds: [...ORPHAN_BASELINE, 36],
      outerPath: OUTER_FAKE,
      deliverablesDir: join(REPO, 'node_modules', 'no-such-archive-face'),
      gitRunner: archiveFace({ tracked: [`deliverables/${repName(35)}`] }),
    })
    expect(row(v, 'P5').state).toBe('UNVERIFIED')
    expect(row(v, 'P5').detail).toContain('no-such-archive-face')
  })
  it('真实归档面：外层在场就必须观测到；外层不在就必须把"未观测"说出口（两边各有一条断言，不空过）', () => {
    const v = evaluate({
      inner: latestRound(join(REPO, 'memory')), outer: existsSync(OUTER_MEMORY) ? latestRound(OUTER_MEMORY) : null,
      outerPath: OUTER_MEMORY, innerRounds: roundSetOf(join(REPO, 'memory')),
      clRounds: changelogRounds(join(REPO, 'CHANGELOG.md')), changelogPath: join(REPO, 'CHANGELOG.md'),
      gitRunner: makeGitRunner(OUTER_REPO),
    })
    const p5 = row(v, 'P5')
    if (existsSync(OUTER_MEMORY)) {
      expect(['PASS', 'FAIL'], `本机归档面必须量到，实得 ${p5.state}：${p5.detail}`).toContain(p5.state)
      expect(p5.detail).toMatch(/R=\d+/)
    } else {
      expect(p5.state).toBe('UNVERIFIED')
      expect(p5.detail).toContain('外层目录不在')
    }
  })
})

/**
 * 第七十三轮 · 钩子环境不许污染跨仓取数。
 * 一手红因（可复现，不是竞态）：pre-commit 里 P5 报「第 72 轮报告不在外层跟踪册里」，
 * 而 `npm run verify:pointers` 直跑同盘面 PASS。差别 = git 给钩子注入的 GIT_DIR/GIT_INDEX_FILE
 * 被子进程继承 ⇒ `git -C <外层仓>` 仍以**内层仓**为根，外层 ls-files 读成空集。
 * 这类"直跑绿 / 钩子红"的根因不在判据逻辑，在子进程继承了它不该继承的上下文。
 */
describe('makeGitRunner 的环境隔离（钩子内 vs 直跑）', () => {
  const capture = () => {
    const calls = []
    const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0, stdout: '' } }
    return { calls, spawn }
  }
  const OUTER = resolve(join(REPO, '..'))
  it('钩子环境（GIT_DIR 指向别的仓）⇒ 剥掉 GIT_* 再 spawn，否则 -C 会被 ambient 仓库根吃掉', () => {
    const { calls, spawn } = capture()
    const env = { GIT_DIR: resolve(join(REPO, '.git')), GIT_INDEX_FILE: '/tmp/x', GIT_WORK_TREE: REPO, PATH: 'p' }
    const runner = makeGitRunner(OUTER, { spawn, env })
    runner(['ls-files', '-z', '--', 'deliverables'])
    const o = calls[0].opts
    expect(o.env, '跨仓取数必须带净化过的 env').toBeTruthy()
    for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX']) {
      expect(o.env, `${k} 还留在 env 里 ⇒ 子进程会打到错的仓`).not.toHaveProperty(k)
    }
    expect(o.env.PATH).toBe('p')
  })
  it('ambient GIT_DIR 就是目标仓自己 ⇒ **不许**剥（那是另一种失明）：--staged 那类判据必须能看见钩子的 index', () => {
    const { calls, spawn } = capture()
    const env = { GIT_DIR: resolve(join(OUTER, '.git')), PATH: 'p' }
    makeGitRunner(OUTER, { spawn, env })(['status', '--porcelain', '-z'])
    expect(calls[0].opts.env, '同仓时不该改动 env').toBeUndefined()
  })
  it('压根没有 GIT_DIR（直跑）⇒ env 不动，行为与修复前逐字一致', () => {
    const { calls, spawn } = capture()
    makeGitRunner(OUTER, { spawn, env: { PATH: 'p' } })(['ls-files'])
    expect(calls[0].opts.env).toBeUndefined()
  })
  it('**只设 GIT_INDEX_FILE**（不设 GIT_DIR）也必须净化 —— `git commit --only` 的钩子环境就是这一形态', () => {
    // 第一版修复只认 GIT_DIR，这条形态整个漏网：钩子里 P5 照旧报"第 72 轮报告没入库"。
    // 实测对照：GIT_INDEX_FILE=<内层>/.git/index 时 `git -C 外层 ls-files -- deliverables` = **0 条**。
    const { calls, spawn } = capture()
    const env = { GIT_INDEX_FILE: resolve(join(REPO, '.git', 'index')), PATH: 'p' }
    makeGitRunner(OUTER, { spawn, env })(['ls-files', '-z', '--', 'deliverables'])
    expect(calls[0].opts.env, '只设 GIT_INDEX_FILE 时也必须净化，否则跨仓读的是内层的 index').toBeTruthy()
    expect(calls[0].opts.env).not.toHaveProperty('GIT_INDEX_FILE')
  })
})
