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
  classifyShaToken, shaFindings, selfCheckGhost, fpOf, normalizeLine,
  requiredJobsOf, fileDateOf, aliasUsable, sinceUsable, SHAPE_FROM_UTC,
} from '../scripts/check-delivery-claims.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = resolve(ROOT, 'scripts', 'check-delivery-claims.mjs')
const JOBS = ['gates', 'e2e', 'e2e-cloud-stub', 'visual', 'deploy']
const GOOD = '## 9. 远端回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 **已上线** | run `37228542182`，`completed/success`；`gates` success、`browser-install` success、`e2e` success、`e2e-cloud-stub` success、`visual` success、`deploy` success |\n'
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

/**
 * 现场造一棵**真 git 仓**并留下一枚真孤儿（第七十一轮 CI 一手）：
 * CI 的 `actions/checkout` 缺省 depth=1，本仓历史上那枚 `f5b22d2` 在 runner 上根本不存在 ⇒
 * "幽灵必须判红"那条 CLI 腿在 CI 上会静默走 unknown 分支（假绿）。
 * 夹具自带仓库 ⇒ 判的是逻辑，不是本机历史深浅。手法就是本轮定罪的那一个：commit 后 --amend。
 */
function orphanRepo () {
  const path = mkdtempSync(join(ROOT, 'node_modules', '.tmp-r71-repo-'))
  const g = (args) => spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', windowsHide: true })
  const must = (r, what) => {
    if (!r || r.status !== 0) throw new Error(`${what} 失败：${String((r && (r.stderr || r.error && r.error.message)) || '').split('\n')[0].slice(0, 180)}`)
    return r
  }
  const id = ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture']
  must(g(['init', '-q', '--initial-branch=main']), 'git init')
  must(g([...id, 'commit', '-q', '--allow-empty', '-m', '第一笔（稍后被 amend 顶掉）']), 'commit#1')
  const orphan = must(g(['rev-parse', 'HEAD']), 'rev-parse').stdout.trim()
  must(g([...id, 'commit', '-q', '--amend', '--allow-empty', '-m', '第二笔（真身）']), 'commit#1 --amend')
  const head = must(g(['rev-parse', 'HEAD']), 'rev-parse#2').stdout.trim()
  if (orphan === head) throw new Error('amend 没换出 sha，孤儿夹具不成立')
  return { path, orphan, head }
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
    const r = receiptsOf('run `37228542182` completed/success；gates success', ['gates', 'e2e-cloud-stub'])
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
    expect(out).toContain('--inject-red 已注入 4 处假')
    expect(out).toContain('INJECTED')
    // 三处注入必须**逐个**被点名。只断言 rc=1 的话，其中一处注入死掉、红完全由另外两处供给，
    // 这条演习腿照样绿 —— 那是"有演习"和"演习有牙"的差别（本仓 R-ENUM：判据要能各自独立成红）。
    expect(out, '注入 1：空口已上线').toContain('(注入演习) synthetic.md')
    expect(out, '注入 2：幽灵 sha').toMatch(/f5b22d2/)
    expect(out, '注入 3：结论自相矛盾').toMatch(/自相矛盾/)
    expect(out, '注入 4：本轮已做缺落地凭据').toMatch(/交不出落地凭据/)
    expect(out).toMatch(/cancelled/)
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

/**
 * D5（第七十一轮）：一手缺陷 —— 第七十轮 §7 写「内层提交：`f5b22d2`」，而该 sha 被同轮
 * `git commit --amend` 顶掉（`git merge-base --is-ancestor f5b22d2 HEAD` 实测 rc=1）。
 * D1~D4 全过：那句话的 run 号、结论、必需 job、线上 deploy 锚都是真的；
 * **假的只有"本轮交付物本体"，而那恰恰是下一轮唯一能复算的锚。**
 * 下面的 resolve 表用真孤儿 `f5b22d2` 当样本 —— 演习不需要造假对象。
 */
const SHA_TABLE = { f5b22d2: 'ghost', '96679fb': 'reachable', deadbeef: 'unknown' }
const shaFn = (s) => SHA_TABLE[s] || 'unknown'
const secsOf = (name, text) => sectionsOf(text).map((s) => ({ ...s, file: name }))

describe('D5 结构性分类：先分面，再判定（豁免靠形状，不靠名单）', () => {
  it('纯十进制 = run 号；带点 = 部署 id / 区间；非十六进制字符 = 另一形；其余才是 commit', () => {
    expect(classifyShaToken('37503202951')).toBe('run-id')
    expect(classifyShaToken('37fbb600.supermarket-web.pages.dev')).toBe('dotted')
    expect(classifyShaToken('23c6630..3f55e61')).toBe('dotted')
    expect(classifyShaToken('dead_beef-123')).toBe('other-set')
    expect(classifyShaToken('f5b22d2')).toBe('commit')
  })
  it('run 号形如十六进制也绝不当 commit 判（`37503202951` 每个字符都是合法十六进制位）', () => {
    const r = shaFindings(secsOf('a.md', '## 7. 交付回执\n\n- run `37503202951` `completed/success`\n'), shaFn)
    expect(r.census['run-id']).toBe(1)
    expect(r.census.commit).toBe(0)
    expect(r.ghosts.length + r.unknown.length).toBe(0)
  })
})

describe('D5 幽灵 sha：判红那一半与放行那一半必须同时成立', () => {
  it('正例：回执点名的 sha 对象存在但不在链上 ⇒ 判红并点名是哪份文件哪一节', () => {
    const r = shaFindings(secsOf('r70.md', '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`（工作树干净）\n'), shaFn)
    expect(r.ghosts.length).toBe(1)
    expect(r.ghosts[0]).toMatchObject({ file: 'r70.md', sha: 'f5b22d2' })
    expect(r.annotated).toEqual([])
  })
  it('反向一：就地更正过的（同一行既有标注词、又有一个可达真锚）⇒ 不判红、单独计数', () => {
    const text = '## 7. 交付回执\n\n- **内层提交**：`96679fb`。更正留痕：原文写 `f5b22d2`，那枚已被 `--amend` 顶掉，是幽灵 sha。\n'
    const r = shaFindings(secsOf('r70.md', text), shaFn)
    expect(r.ghosts).toEqual([])
    expect(r.annotated.length).toBe(1)
  })
  it('反向二（牙齿）：只写「幽灵」二字而没有可达真锚 ⇒ 照判红。否则补个词就能绕过，等于把闸拆了', () => {
    const r = shaFindings(secsOf('x.md', '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`（幽灵）\n'), shaFn)
    expect(r.annotated).toEqual([])
    expect(r.ghosts.length).toBe(1)
  })
  it('反向三：两个根都取不到的 sha 判「未定位」，只计数不判红（报告引用对手仓属正常）', () => {
    const r = shaFindings(secsOf('y.md', '## 7. 交付回执\n\n- 对手仓锚点 `deadbeef`（medusa）\n'), shaFn)
    expect(r.unknown.length).toBe(1)
    expect(r.ghosts).toEqual([])
    expect(r.census.commit).toBe(1)
  })
  it('不注入 resolve ⇒ D5 整条不参与，并明写 ran=false（绝不把"没跑"记成"没幽灵"）', () => {
    const r = shaFindings(secsOf('z.md', '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`\n'), null)
    expect(r.ran).toBe(false)
    expect(r.ghosts).toEqual([])
    expect(Object.values(r.census).reduce((a, b) => a + b, 0)).toBe(0)
  })
  it('D5 自证四方向必须同时成立（尺自己有洞就不许报绿）', () => {
    expect(selfCheckGhost()).toEqual({
      rejectsGhost: true, admitsCorrection: true, rejectsNakedAnnotation: true, ignoresUnknown: true,
    })
  })
})

describe('D5 存量指纹册：双向差集两个方向都要拦，且键不许锚行号', () => {
  const J = JOBS
  const withGhost = [{ name: 'a.md', text: '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`\n' }]
  it('fp 取 kind+file+heading+归一化整行，不取行号：同一句在同一节里挪位置，fp 不变', () => {
    expect(normalizeLine('   - a   b  ')).toBe(normalizeLine('- a b'))
    const tail = '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`（工作树干净）\n'
    const at = judgeDeliveries({ files: [{ name: 'a.md', text: tail }], requiredJobs: J, resolveFn: shaFn }).ghosts[0].fp
    // 同一段落前面多两行（行号整体后移 2），fp 必须仍是同一个 —— 否则改上面任何人写的东西都会让存量册集体失配
    const moved = judgeDeliveries({
      files: [{ name: 'a.md', text: '## 6. 别的\n\n甲\n\n乙\n\n' + tail }], requiredJobs: J, resolveFn: shaFn,
    }).ghosts[0].fp
    expect(moved).toBe(at)
    expect(fpOf({ kind: 'ghost', file: 'a.md', heading: 'h', needle: 'n' }))
      .not.toBe(fpOf({ kind: 'ghost', file: 'b.md', heading: 'h', needle: 'n' }))
  })
  it('新增（不在册）判红，且明细里能看见是哪个 sha', () => {
    const r = judgeDeliveries({ files: withGhost, requiredJobs: J, resolveFn: shaFn, baseline: { rows: [] } })
    expect(r.state).toBe('FAIL')
    expect(r.fresh.length).toBe(1)
    expect(r.fresh[0].kind).toBe('ghost')
    expect(r.stale).toEqual([])
  })
  it('存量在册 ⇒ 新增 0 ⇒ PASS（存量不刷明细，只在门面行给计数）', () => {
    const bare = judgeDeliveries({ files: withGhost, requiredJobs: J, resolveFn: shaFn })
    const rows = bare.ghosts.map((b) => ({ fp: b.fp, kind: 'ghost', file: b.file, heading: b.heading, needle: `${b.line}@@${b.sha}` }))
    expect(rows.length).toBe(1)
    const r = judgeDeliveries({ files: withGhost, requiredJobs: J, resolveFn: shaFn, baseline: { rows } })
    expect(r.state).toBe('PASS')
    expect(r.fresh).toEqual([])
  })
  it('反向：册上挂着而当次取不到的行 = 基线死行，同样判红（死豁免不许留在册上）', () => {
    const r = judgeDeliveries({
      files: withGhost, requiredJobs: J, resolveFn: shaFn,
      baseline: { rows: [{ fp: 'ffffffffffffffff', kind: 'claim', file: 'gone.md', heading: 'x', needle: 'y' }] },
    })
    expect(r.state).toBe('FAIL')
    expect(r.stale.length).toBe(1)
    expect(r.fresh.length).toBe(1)
  })
  it('requiredJobs 取不到 / 取数面为空 ⇒ 一律 FAIL，不许"没标准 = 通过"', () => {
    expect(judgeDeliveries({ files: [], requiredJobs: J }).state).toBe('FAIL')
    expect(judgeDeliveries({ files: withGhost, requiredJobs: [] }).state).toBe('FAIL')
  })
})

describe('D5 CLI：真实面与夹具面分开对待（存量册是版面的）', () => {
  it('夹具自带一棵真 git 仓 ⇒ 孤儿 sha 判红在 CI 与本机同形（不依赖仓库历史深浅）', () => {
    const { path, orphan, head } = orphanRepo()
    const dir = writeFix(tmpDir(), { 'a.md': `## 7. 交付回执\n\n- **内层提交**：\`${orphan}\`（工作树干净）\n` })
    const base = join(dir, 'base.json')
    writeFileSync(base, '{"schema":"t","rows":[]}\n', 'utf8')
    const r = runCli(['--dir', dir, '--baseline', base], { DELIVERY_CLAIMS_ROOTS: path })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(1)
    expect(String(r.stdout) + String(r.stderr)).toContain(`幽灵 sha \`${orphan}\``)
    // 反向那一半：同一行补上"幽灵标注 + 一枚可达真锚"⇒ 就地更正必须放行
    const fixed = writeFix(tmpDir(), { 'a.md': `## 7. 交付回执\n\n- **内层提交**：\`${head}\`；原文写 \`${orphan}\`，那枚是幽灵 sha，已被 --amend 顶掉\n` })
    const fb = join(fixed, 'base.json')
    writeFileSync(fb, '{"schema":"t","rows":[]}\n', 'utf8')
    const ok = runCli(['--dir', fixed, '--baseline', fb], { DELIVERY_CLAIMS_ROOTS: path })
    expect(ok.status, `${ok.stdout}${ok.stderr}`).toBe(0)
    expect(String(ok.stdout)).toContain('已就地更正 1')
  })
  it('夹具面不载默认存量册 ⇒ 干净夹具仍 rc=0（回归：拿默认面对账会把整册读成死行，夹具全灭）', () => {
    const dir = writeFix(tmpDir(), { 'a.md': GOOD })
    const r = runCli(['--dir', dir])
    expect(r.status).toBe(0)
    expect(String(r.stdout)).toContain('基线未装载')
  })
  it('真实面 ⇒ 有版面就印 D5 三个分面计数，没版面（CI 只检出代码仓）就必须说"未观测"', () => {
    const r = runCli([])
    const out = String(r.stdout) + String(r.stderr)
    if (/UNVERIFIED/.test(out)) {
      expect(out).toContain('取数面')
      return
    }
    expect(out).toMatch(/D5 sha 引用候选 \d+（commit \d+／run-id \d+／点号形 \d+／非十六进制 \d+/)
    expect(out).toMatch(/存量在册 \d+｜D4 自证/)
    expect(out).toContain('D5 自证 判红=true 认更正=true 拒裸标注=true 容未知=true')
    expect(out).toContain('档位=阻断')
  })
  it('注入演习必须打在"两边都存在的那一面"上：默认版面在 CI 里根本不在 ⇒ 整条判据提前 UNVERIFIED rc=0（第七十一轮 CI 一手假绿）', () => {
    // 一手：本腿第一版跑的是**默认取数面**，本机 ../deliverables 在 ⇒ rc=1；CI 上那个目录不存在 ⇒
    // main() 在注入之前就走了 UNVERIFIED rc=0 ⇒ "演习有牙"这句话在 CI 上从来没被证明过。
    const { path } = orphanRepo()
    const dir = writeFix(tmpDir(), { 'good.md': GOOD })
    const r = runCli(['--dir', dir, '--inject-red'], { DELIVERY_CLAIMS_ROOTS: path })
    const out = String(r.stdout) + String(r.stderr)
    expect(r.status, out.slice(-700)).toBe(1)
    expect(out).toContain('--inject-red 已注入 4 处假')
    expect(out).toContain('INJECTED')
    expect(out).toMatch(/D5 sha 引用候选 \d+/)
    // 注入的那枚 `f5b22d2` 在合成仓里取不到 ⇒ 走"未定位"分支；两个分支都算 D5 收到了这条注入
    expect(out).toMatch(/幽灵 sha `f5b22d2`|未定位 [1-9]/)
  })
})

/**
 * 第七十二轮 · requiredJobAliases：认历史名，但只在它还算现行的那段时间里认。
 * 一手红因（本轮开工实测，不是编的形状）：4349d99 把 CI 的 `build-and-test` 改名 `gates`，
 * 而 `.ci/contract.json` 的 requiredJobs 是**今天**的名单 ⇒ 拿今天的名单判历史报告，
 * 第四十二轮 §8 那段（run 号有、结论有、四个 job 名齐、只有 `gates` 缺席）被判成「新增 1」，
 * `npm run verify` 末腿由绿转红。判据不许把"改名之前的真话"读成缺件，也不许让别名变成永久豁免。
 */
describe('第七十二轮 · 历史别名的时态面', () => {
  const ALIASES = [{ job: 'build-and-test', aliasOf: 'gates', untilUtc: '2026-10-07' }]
  const OLD_NAME = '## 8. 远端回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 **已上线** | run `36364894565`，`completed/success`；`build-and-test` success、`e2e` success、`e2e-cloud-stub` success、`visual` success、`deploy` success |\n'
  it('改名之前的报告用旧名 ⇒ 认（本轮真实 red→green 的那一段）', () => {
    const r = receiptsOf(OLD_NAME, JOBS, { fileDate: '2026-09-28', aliases: ALIASES })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.usedAlias).toEqual(['build-and-test→gates'])
    expect(r.missingJobs).toEqual([])
  })
  it('改名之后的报告只写旧名 ⇒ 照判红（别名是时段，不是永久豁免）', () => {
    const r = receiptsOf(OLD_NAME, JOBS, { fileDate: '2026-10-08', aliases: ALIASES })
    expect(r.ok).toBe(false)
    expect(r.missingJobs).toEqual(['gates'])
    expect(r.usedAlias).toEqual([])
  })
  it('不传 ctx ⇒ 逐字回到第七十一轮行为（默认不放宽）', () => {
    expect(receiptsOf(OLD_NAME, JOBS).ok).toBe(false)
  })
  it('文件名解不出日期 ⇒ 不认别名，且把"未定位日期"计数摊出而不是静默按旧名单放过', () => {
    expect(fileDateOf('GitHub开源项目对标分析报告-第七十一轮-2026-10-07.md')).toBe('2026-10-07')
    expect(fileDateOf('no-date-here.md')).toBe(null)
    const r = judgeDeliveries({ files: [{ name: 'no-date.md', text: OLD_NAME }], requiredJobs: JOBS, aliases: ALIASES })
    expect(r.matched).toBe(0)
    expect(r.shape.dateUnknown).toBe(1)
  })
  it('aliasUsable：日期边界两侧各一态', () => {
    expect(aliasUsable(ALIASES[0], '2026-10-07')).toBe(true)
    expect(aliasUsable(ALIASES[0], '2026-10-08')).toBe(false)
    expect(aliasUsable(ALIASES[0], null)).toBe(false)
  })
  it('半张的别名册 ⇒ 整把尺 BLOCKED（缺 untilUtc / aliasOf 无主 / 不是数组，一律不猜）', () => {
    const cases = [
      { requiredJobs: JOBS, requiredJobAliases: [{ job: 'x', aliasOf: 'gates' }] },
      { requiredJobs: JOBS, requiredJobAliases: [{ job: 'x', aliasOf: 'no-such-job', untilUtc: '2026-01-01' }] },
      { requiredJobs: JOBS, requiredJobAliases: 'not-an-array' },
    ]
    for (const [i, c] of cases.entries()) {
      const p = join(tmpDir(), 'contract.json')
      writeFileSync(p, JSON.stringify(c), 'utf8')
      const cj = requiredJobsOf(p)
      expect(cj.error, `case ${i} 应 fail-closed，实得 ${JSON.stringify(cj)}`).toBeTruthy()
      expect(cj.aliases).toEqual([])
    }
  })
  it('生产面：.ci/contract.json 的别名册良构且 aliasOf 都在现行名单里', () => {
    const cj = requiredJobsOf(join(ROOT, '.ci', 'contract.json'))
    expect(cj.error, String(cj.error)).toBe(null)
    expect(cj.aliases.length, '改名之后必须留下别名册，否则历史回执集体被判红').toBeGreaterThanOrEqual(1)
    for (const a of cj.aliases) {
      expect(cj.jobs).toContain(a.aliasOf)
      expect(/^\d{4}-\d{2}-\d{2}$/.test(a.untilUtc), `${a.job} 的 untilUtc 不是日期`).toBe(true)
      expect(a.job).not.toBe(a.aliasOf)
    }
  })
})

/**
 * 第七十三轮 · requiredJobSince：**新增 job 与改名是同一颗雷**，而上一块只治了改名那一半。
 * 一手红因（本轮开工实测）：I-73-1 往 ci.yml 加了 `browser-install`，`.ci/contract.json` 的
 * requiredJobs 按桥接判据同笔变成六个之后，第七十二轮那份回执立刻被判「必需 job 未全点名」——
 * 而那个 job 在第 72 轮**根本不存在**，要求回执点到它就是逼作者补一句假话。
 * 判据拒真话却只放行虚报的写法 = 判据缺陷，不是报告缺陷。
 * 生效面与别名**对称且方向相反**：别名管"日期 ≤ untilUtc 认旧名"，免名管"日期 < sinceUtc 免点新名"。
 */
describe('第七十三轮 · 新增 job 的时态面（requiredJobSince）', () => {
  const SINCES = [{ job: 'browser-install', sinceUtc: '2026-10-09' }]
  const SIX = [...JOBS, 'browser-install']
  const FIVE = '`gates` success、`e2e` success、`e2e-cloud-stub` success、`visual` success、`deploy` success'
  const SIX_NAMED = `${FIVE}、\`browser-install\` success`
  // 结论取 success：本块量的是"时态面/免名"这一维，回执正文要保持自洽。
  // （写 completed/cancelled 又把各 job 报成 success，会被同轮的「结论自相矛盾」腿判红 ——
  //  这条规则上线的第一次命中就是本夹具自己，属于判据把作者的 sloppiness 抓出来了。）
  const receipt = (named) => `## 7. 交付回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 **已上线** | run \`37747723889\`，\`completed/success\`；${named} |\n`

  it('引入日之前的回执点不到新 job ⇒ 免名为 ok，且 skippedSince 照印（不许静默缩分母）', () => {
    const r = receiptsOf(receipt(FIVE), SIX, { fileDate: '2026-10-08', since: SINCES })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.skippedSince).toEqual(['browser-install'])
    expect(r.missingJobs).toEqual([])
  })
  it('引入日当天不点名 ⇒ 照判红 —— 免名是时段，不是永久豁免', () => {
    const r = receiptsOf(receipt(FIVE), SIX, { fileDate: '2026-10-09', since: SINCES })
    expect(r.ok).toBe(false)
    expect(r.missingJobs).toEqual(['browser-install'])
    expect(r.skippedSince).toEqual([])
  })
  it('引入日当天点名六个 ⇒ ok（同一段文本，只改日期就能翻转 ⇒ 判据真在解析日期）', () => {
    const r = receiptsOf(receipt(SIX_NAMED), SIX, { fileDate: '2026-10-09', since: SINCES })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.skippedSince).toEqual([])
  })
  it('不传 ctx ⇒ 六个里只认五个现行名（默认不放宽，与第七十一轮行为逐字一致）', () => {
    const r = receiptsOf(receipt(FIVE), SIX)
    expect(r.ok).toBe(false)
    expect(r.missingJobs).toEqual(['browser-install'])
  })
  it('文件名解不出日期 ⇒ 不免名（宁严勿宽），与别名同口径', () => {
    expect(sinceUsable(SINCES[0], '2026-10-08')).toBe(true)
    expect(sinceUsable(SINCES[0], '2026-10-09')).toBe(false)
    expect(sinceUsable(SINCES[0], null)).toBe(false)
    const r = judgeDeliveries({ files: [{ name: 'no-date.md', text: receipt(FIVE) }], requiredJobs: SIX, since: SINCES })
    expect(r.matched).toBe(0)
    expect(r.shape.dateUnknown).toBe(1)
    expect(r.shape.sinceExempt).toBe(0)
  })
  it('免名口径会传导到 judgeDeliveries 的计数（印面而非只改判面）', () => {
    const r = judgeDeliveries({ files: [{ name: 'r72-2026-10-08.md', text: receipt(FIVE) }], requiredJobs: SIX, since: SINCES })
    expect(r.matched).toBe(1)
    expect(r.shape.sinceExempt).toBe(1)
  })
  it('半张的免名册 ⇒ 整把尺 BLOCKED（缺 sinceUtc / job 无主 / 不是数组 / 与别名同 job，一律不猜）', () => {
    const cases = [
      { requiredJobs: SIX, requiredJobSince: [{ job: 'browser-install' }] },
      { requiredJobs: SIX, requiredJobSince: [{ job: 'no-such-job', sinceUtc: '2026-01-01' }] },
      { requiredJobs: SIX, requiredJobSince: 'not-an-array' },
      { requiredJobs: SIX, requiredJobAliases: [{ job: 'browser-install', aliasOf: 'gates', untilUtc: '2026-10-07' }], requiredJobSince: [{ job: 'browser-install', sinceUtc: '2026-10-09' }] },
    ]
    for (const [i, c] of cases.entries()) {
      const p = join(tmpDir(), 'contract.json')
      writeFileSync(p, JSON.stringify(c), 'utf8')
      const cj = requiredJobsOf(p)
      expect(cj.error, `case ${i} 应 fail-closed，实得 ${JSON.stringify(cj)}`).toBeTruthy()
      expect(cj.since).toEqual([])
    }
  })
  it('生产面：免名册只许含"确实晚于历史回执"的新 job ⇒ 老 job 不许塞进来（那是拿时态面偷缩分母）', () => {
    const cj = requiredJobsOf(join(ROOT, '.ci', 'contract.json'))
    expect(cj.error, String(cj.error)).toBe(null)
    for (const a of cj.since) {
      expect(cj.jobs, `${a.job} 的免名无主`).toContain(a.job)
      expect(/^\d{4}-\d{2}-\d{2}$/.test(a.sinceUtc), `${a.job} 的 sinceUtc 不是日期`).toBe(true)
      expect(a.why, `${a.job} 的免名必须写明理由，否则下一轮没人敢删`).toBeTruthy()
    }
    for (const legacy of ['gates', 'e2e', 'e2e-cloud-stub', 'visual', 'deploy']) {
      expect(cj.since.map((a) => a.job), `${legacy} 是第 72 轮之前就存在的 job，不许进免名册`).not.toContain(legacy)
    }
    expect(cj.since.map((a) => a.job), '本轮新增的 browser-install 必须在册，否则历史回执集体不可满足').toContain('browser-install')
  })
})

/**
 * 第七十三轮 · 回执的**结论一致性**：点了 job 名 ≠ 如实转述它的结论。
 * 一手背景（不是假想）：本仓曾在 CI 连红七笔的期间于三份报告写"CI 全绿"（见 ciGreenContract.test.js 顶部），
 * 而那批句子 run 号/job 名/结论词样样齐全 —— `named` 查的是"点没点名"，从没查过"点的名与给的结论互相打脸"。
 * 口径按**行**取，因为一份诚实的回执常要同时转述多个 run（旧的 cancelled + 新的 success）。
 */
describe('第七十三轮 · 回执结论自相矛盾（cancelled 却写 deploy success）', () => {
  const FIVE = '`gates` success、`e2e` success、`e2e-cloud-stub` success、`visual` success、`deploy` success'
  it('同一行既写 run 终态 cancelled 又写 deploy success ⇒ 判红并把原行引出来', () => {
    const bad = `## 7. 交付回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 **已上线** | run \`37747723889\` \`completed/cancelled\`，deploy success；${FIVE} |\n`
    const r = receiptsOf(bad, JOBS)
    expect(r.ok).toBe(false)
    expect(r.contradictions.length, JSON.stringify(r)).toBe(1)
    expect(r.contradictions[0]).toMatch(/cancelled/)
  })
  it('写法换成 `conclusion=cancelled` 同样要抓到（词面不只一种就能被绕过）', () => {
    const r = receiptsOf(`## 7. 交付回执\n\n| H-1 **已上线** | run \`37747723889\` conclusion=cancelled，deploy 已上线；${FIVE} |\n`, JOBS)
    expect(r.contradictions.length).toBe(1)
  })
  it('反例·不许误伤：两个 run 分行转述（旧的那次 cancelled，新的一次 deploy success）⇒ 不判红', () => {
    const honest = '## 7. 交付回执\n\n'
      + '| 上一笔 | run `37747723889` `completed/cancelled`，deploy skipped |\n'
      + `| 本笔 **已上线** | run \`37800000000\`，\`completed/success\`；${FIVE}；deploy success |\n`
    const r = receiptsOf(honest, JOBS)
    expect(r.contradictions, JSON.stringify(r.contradictions)).toEqual([])
  })
  it('反例·诚实写法不判红：run cancelled 且如实写 deploy skipped（第七十二轮回执的真实形状）', () => {
    // 名单显式列，不用 FIVE.split('、deploy')去切 —— 原文是「、`deploy`」带反引号，
    // 按 '、deploy' 切**切不开**，会把 `deploy` success 留在"诚实"夹具里，
    // 于是这条反例腿自己就变成了它所反对的那种写法（第七十三轮实测：本腿第一版就这么假红过）。
    const honestFour = '`gates` success、`e2e` success、`e2e-cloud-stub` success、`visual` success'
    const honest = `## 7. 交付回执\n\n| H-1 | run \`37747723889\`，\`completed/cancelled\`；${honestFour}、\`deploy\` **skipped**；线上 "deploy":"4349d99" |\n`
    const r = receiptsOf(honest, JOBS)
    expect(r.contradictions, JSON.stringify(r.contradictions)).toEqual([])
    expect(r.deployAnchor, '线上锚要认得这种写法').toBe(true)
    expect(r.ok, JSON.stringify(r)).toBe(true)
  })
  it('矛盾要传导到 judgeDeliveries 的 mismatched 与明细，且能在 --inject-red 之外独立成红', () => {
    const bad = `## 7. 交付回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 **已上线** | run \`37747723889\` \`completed/cancelled\`，deploy success；${FIVE} |\n`
    const r = judgeDeliveries({ files: [{ name: 'x-2026-10-09.md', text: bad }], requiredJobs: JOBS })
    expect(r.matched).toBe(0)
    expect(r.mismatched).toBe(1)
    expect(r.badClaims[0].why).toMatch(/自相矛盾|cancelled/)
  })
})

/**
 * 第七十二轮 · D6「接受侧自证」+ 回执形状位。
 * 一手取数（本轮现算，取数器 = node + 本判据自己的 sectionsOf/claimHits）：
 * `../deliverables` 80 份 md 里标题含「回执/交付」的段 **49** 个（≥2026-09-28 的 28 个），
 * 而词面 claimHits 在这 28 个里只命中 **1** 个 ⇒ 判据自第 68 轮立起到本轮，matched 在真实面上
 * **从来没有过一条样本**（本轮开工实测 matched=0）。"能认出一份合格回执"只在夹具串上证明过。
 */
describe('第七十二轮 · D6 接受侧零样本不许读成通过', () => {
  const noClaimFace = [{ name: `x-${SHAPE_FROM_UTC}.md`, text: MENTION }]
  it('非空面 matched=0 且开了 requirePositiveSample ⇒ UNVERIFIED（不是 PASS）', () => {
    expect(judgeDeliveries({ files: noClaimFace, requiredJobs: JOBS }).state).toBe('PASS')
    expect(judgeDeliveries({ files: noClaimFace, requiredJobs: JOBS, requirePositiveSample: true }).state).toBe('UNVERIFIED')
  })
  it('面上有一条合格回执 ⇒ D6 不介入（正反两向都要有，否则等于把闸关掉）', () => {
    const r = judgeDeliveries({ files: [{ name: `g-${SHAPE_FROM_UTC}.md`, text: GOOD }], requiredJobs: JOBS, requirePositiveSample: true })
    expect(r.matched).toBe(1)
    expect(r.positiveBlind).toBe(false)
    expect(r.state).toBe('PASS')
  })
  it('D6 不掩盖真红：面里有缺件主张时仍判 FAIL（红优先于未验证）', () => {
    expect(judgeDeliveries({ files: [{ name: 'b.md', text: BAD }], requiredJobs: JOBS, requirePositiveSample: true }).state).toBe('FAIL')
  })
  it('CLI 腿：--require-positive-sample 在合成面上真能翻出 rc=2 与 GATE-UNVERIFIED D6', () => {
    const dir = writeFix(tmpDir(), { 'mention.md': MENTION })
    const r = runCli(['--dir', dir, '--require-positive-sample'])
    const out = String(r.stdout) + String(r.stderr)
    expect(r.status, out.slice(-700)).toBe(2)
    expect(out).toContain('GATE-UNVERIFIED D6')
    expect(out).toContain('matched=0')
  })
})

describe('第七十二轮 · 回执形状位：把真正写回执的那一半纳入取数面', () => {
  const SHAPE_TEXT = '## 7. 交付回执\n\n- 本轮内层提交已推平，CI 全绿，顾客端也发了。\n'
  it(`shapeFrom（=${SHAPE_FROM_UTC}）及以后的文件：标题含「回执」而三件套不齐 ⇒ 进 mismatched`, () => {
    const r = judgeDeliveries({ files: [{ name: `报告-${SHAPE_FROM_UTC}.md`, text: SHAPE_TEXT }], requiredJobs: JOBS })
    expect(r.mismatched).toBe(1)
    expect(r.badClaims[0].claim).toContain('回执形状段')
    expect(r.shape.sites).toBe(1)
  })
  it('不溯及既往：同一段落落在 shapeFrom 之前 ⇒ 形状位不扫（扩面不许把历史报告刷成新增）', () => {
    const r = judgeDeliveries({ files: [{ name: '报告-2026-09-01.md', text: SHAPE_TEXT }], requiredJobs: JOBS })
    expect(r.mismatched).toBe(0)
    expect(r.shape.sites).toBe(0)
  })
  it('形状位认合格回执：带齐三件套的 §回执 段进 matched（本轮报告自己就走这条线）', () => {
    const ok = '## 7. 交付回执\n\n| 事 | 回执 |\n|---|---|\n| H-1 | run `37677572509`，`completed/success`；gates／e2e／e2e-cloud-stub／visual／deploy 各 success；线上 {"deploy":"55829a1"} |\n'
    const r = judgeDeliveries({ files: [{ name: `报告-${SHAPE_FROM_UTC}.md`, text: ok }], requiredJobs: JOBS })
    expect(r.matched).toBe(1)
    expect(r.mismatched).toBe(0)
  })
})
