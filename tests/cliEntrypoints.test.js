// 第二十四轮：门禁**入口通道**的常驻夹具。
//
// 为什么必须有这么一个文件（本轮实测的教训，不是假想）：
// `scripts/ci-green-contract.mjs` 的 15 条夹具全是 `import { verdictOf }`，
// CLI 那段（读 stdin → 解析 git 的 ref 行 → 判据 → exit code）从来没被跑过。
// 结果 `fs.readFileSync(0)` 抛的 ReferenceError 被 `catch { line = '' }` 吞掉，
// 闸门从此永远读不到 ref 行、把"推 feature-x"审成"branch=main"，而 `npm test` 全绿。
// 本文件把"真跑一遍入口"变成常驻：新增门禁若不在此登记（或被具名豁免），G8 当场判红。
//
// 覆盖清单刻意写成**字面量**：判据 G8 拿它和 package.json 结构性枚举出的"门禁类入口"对账，
// 漏登记 = 红。手抄清单在这里不是坏习惯，是**被对账的那一侧**。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, cpSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { evaluate, collect, collectRegistered, collectCovered, isGateLike, parseRegistry, probeDenominator, testFace, verdictOf, REGISTRY } from '../scripts/check-cli-entrypoints.mjs'
import { classifyRisk, probeSafeEvidence } from '../scripts/lib/preflight.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(REPO, 'scripts')
const tmpDirs = []

/**
 * 被子进程真跑的门禁入口清单。筛法：跑得完（<2s 量级）、不碰网络、不依赖 build 产物、
 * 不写库、不改文件。跑不动的（esbuild 9s / 要 gh 查 PR / 要 dist / 会改库）一律进
 * `docs/cli-entrypoints.md` 的「不可子进程豁免」表并写明实测依据，禁止悄悄少跑。
 */
const PROBED = [
  'check-error-semantics.mjs', 'check-pii-inventory.mjs', 'check-limit-provenance.mjs',
  'check-action-authz.mjs', 'check-csp-static.mjs', 'check-env-docs.mjs',
  'check-import-cycles.mjs', 'check-licenses.mjs', 'check-schema-drift.mjs',
  'check-d1-roundtrips.mjs', 'verify-backend.mjs', 'api-contract.mjs',
  'list-uncovered.mjs', 'check-cli-entrypoints.mjs', 'api-response-contract.mjs',
  'scan-secrets.mjs',
]

function probe(script, { cwd = REPO } = {}) {
  // 子进程预算必须**小于**调用它的 it() 的天花板：首版给 spawnSync 60s、却没给 it() 抬 timeout，
  // 于是 85 个文件并行时 check-licenses 从 1.2s 涨到 5s+ ⇒ vitest 先 5s 判超时，
  // 报的是"Test timed out"而不是任何真实结论（把自己的测量天花板当成被测对象的失败）。
  const r = spawnSync(process.execPath, [join(SCRIPTS, script)], {
    cwd, encoding: 'utf8', timeout: 20_000,
  })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

function tmpRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'smentry-'))
  tmpDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

describe('入口探针：每条门禁的 CLI 路径必须真跑得通', () => {
  it(`PROBED 清单与判据结构性枚举出的"门禁类入口"对得上（防两边漂移）`, () => {
    const gateLike = collectRegistered().filter((r) => isGateLike(r.sources)).map((r) => r.script).sort()
    // 已具备夹具、但不归本文件管的（gateFixtures / migrateReplay 等自带 spawn 的那批）允许在两侧之差里
    const coveredElsewhere = [...collectCovered().keys()]
    const orphans = PROBED.filter((s) => !gateLike.includes(s) && !coveredElsewhere.includes(s))
    expect(orphans, `探针清单里有 ${orphans.join(', ')} 既不是门禁类入口、也没别的夹具引用`).toEqual([])
    expect(gateLike.length).toBeGreaterThanOrEqual(14)
  })

  for (const script of PROBED) {
    it(`${script} 作为子进程真跑：rc=0 且有输出`, () => {
      const { rc, out } = probe(script)
      expect(out.length, `${script} 什么都没打印`).toBeGreaterThan(0)
      expect(rc, `${script} 退出码非 0：\n${out.slice(-600)}`).toBe(0)
    }, 30_000)
  }

  it('探针本身有牙齿：植入一个必然失败的门禁 ⇒ 必须被测出 rc!=0', () => {
    // 缺了这条，"全绿"可能只是因为探针根本没跑东西（零输入不得 PASS 的入口版）
    const dir = tmpRepo({ 'scripts/always-fail.mjs': 'console.log("boom")\nprocess.exit(3)\n' })
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'always-fail.mjs')], { encoding: 'utf8', timeout: 20_000 })
    expect(r.status).toBe(3)
    expect(r.stdout).toContain('boom')
  }, 30_000)
})

describe('判据 G1~G9：合成仓双向变异', () => {
  /**
   * 一个"应当全绿"的最小合成仓：demo-gate 有夹具、other-gate 具名挂账、
   * 判据自身（check-cli-entrypoints.mjs）也在登记面且有夹具 —— 正向腿必须八条全过，
   * 否则后面每条反例都可能只是"合成仓本来就建坏了"。
   */
  const SELF = 'check-cli-entrypoints.mjs'
  const cleanRegistry = `- **覆盖地板**：2
- **分母地板**：2

## 已知缺口

| 脚本 | 理由 |
| --- | --- |
| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |
`
  const baseRepo = (over = {}) => {
    const dir = tmpRepo({
      'package.json': JSON.stringify({
        name: 'fix',
        scripts: {
          'verify:demo': 'node scripts/demo-gate.mjs',
          'verify:entrypoints': `node scripts/${SELF}`,
          // other-gate 刻意用非门禁别名（report:）：它要测的是"缺口表对账"，不该同时触发 G8
          'report:other': 'node scripts/other-gate.mjs',
          ...over.pkg,
        },
      }),
      'scripts/demo-gate.mjs': 'console.log("ok")\n',
      'scripts/other-gate.mjs': 'console.log("ok")\n',
      [`scripts/${SELF}`]: 'console.log("ok")\n',
      'tests/demo.test.js': `import { spawnSync } from 'node:child_process'\nspawnSync('node', ['scripts/demo-gate.mjs'])\nspawnSync('node', ['scripts/${SELF}'])\n`,
      '.githooks/pre-push': '#!/bin/sh\nnode scripts/demo-gate.mjs\n',
      // 第四十五轮 G12 顺带抓到的**夹具人口缺口**：取数面声明了三个来源（npm 别名 / .githooks / workflows），
      // 而这份合成仓只建了两个 ⇒ 真面有的第三个来源在夹具里从来没被喂过（②-f 同族：夹具人口必须等于真面人口）。
      '.github/workflows/ci.yml': 'name: CI\njobs:\n  build:\n    steps:\n      - run: node scripts/demo-gate.mjs\n',
      'CONTRIBUTING.md': '本地门禁：`git config core.hooksPath .githooks`\n',
      [REGISTRY]: over.registry ?? cleanRegistry,
    })
    return { dir, res: evaluate(collect(dir)) }
  }

  it('正向：干净合成仓 ⇒ 九条全过（G7 也过，因为判据自己在登记面+有夹具）', () => {
    const { res } = baseRepo()
    const bad = res.rows.filter((r) => !r.pass)
    expect(bad.map((r) => `${r.id}:${r.detail}`), JSON.stringify(res.rows, null, 1)).toEqual([])
    expect(res.summary.matched).toBe(res.summary.declared)
    expect(res.summary.declared).toBe(14)
  })

  it('G1 反例：登记面枚举为空 ⇒ 判红（零输入不得 PASS）', () => {
    const dir = tmpRepo({ 'package.json': JSON.stringify({ scripts: {} }) })
    const rows = evaluate(collect(dir)).rows
    expect(rows.find((r) => r.id === 'G1').pass).toBe(false)
  })

  it('G2 反例：实测未覆盖却不登记 ⇒ 红；登记了个已覆盖的 ⇒ 也算红（幽灵缺口）', () => {
    const undeclared = baseRepo({ registry: '- **覆盖地板**：1\n- **分母地板**：2\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n' })
    expect(undeclared.res.rows.find((r) => r.id === 'G2').pass).toBe(false)
    expect(undeclared.res.rows.find((r) => r.id === 'G2').detail).toContain('未登记缺口: other-gate.mjs')

    const phantom = baseRepo({ registry: '- **覆盖地板**：1\n- **分母地板**：2\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| demo-gate.mjs | 其实已被夹具覆盖，这里挂着就是幽灵行 |\n' })
    expect(phantom.res.rows.find((r) => r.id === 'G2').pass).toBe(false)
    expect(phantom.res.rows.find((r) => r.id === 'G2').detail).toContain('幽灵登记')
  })

  it('G3 反例：理由写成 TODO / 太薄 ⇒ 判红（防空格把缺口洗成"已登记"）', () => {
    const thin = baseRepo({ registry: '- **覆盖地板**：1\n- **分母地板**：2\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| other-gate.mjs | TODO |\n' })
    expect(thin.res.rows.find((r) => r.id === 'G3').pass).toBe(false)
  })

  it('G4 反例：地板写高于实际覆盖 ⇒ 判红（棘轮不许靠改数字变绿，改数字要改的是代码）', () => {
    const high = baseRepo({ registry: '- **覆盖地板**：99\n- **分母地板**：2\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |\n' })
    expect(high.res.rows.find((r) => r.id === 'G4').pass).toBe(false)
    expect(high.res.rows.find((r) => r.id === 'G4').detail).toContain('99')
  })

  it('G5 反例：hook 指向不存在的脚本 / 文档没登记生效前提 ⇒ 都判红', () => {
    const badHook = baseRepo()
    writeFileSync(join(badHook.dir, '.githooks', 'pre-push'), '#!/bin/sh\nnode scripts/nope-gone.mjs\n')
    const r1 = evaluate(collect(badHook.dir)).rows.find((r) => r.id === 'G5')
    expect(r1.pass).toBe(false)
    expect(r1.detail).toContain('nope-gone.mjs')

    const noDoc = baseRepo()
    writeFileSync(join(noDoc.dir, 'CONTRIBUTING.md'), '# 没有 hooksPath 这一行\n')
    rmSync(join(noDoc.dir, 'README.md'), { force: true })
    expect(evaluate(collect(noDoc.dir)).rows.find((r) => r.id === 'G5').pass).toBe(false)
  })

  it('G6 反例：本地钩子调的脚本没有夹具 ⇒ 判红（CI 不跑 pre-push，崩了没人知道）', () => {
    const bare = baseRepo()
    writeFileSync(join(bare.dir, '.githooks', 'pre-push'), '#!/bin/sh\nnode scripts/other-gate.mjs\n')
    const row = evaluate(collect(bare.dir)).rows.find((r) => r.id === 'G6')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('other-gate.mjs')
  })

  it('G7 反例：判据自己没被登记为可执行入口 ⇒ 判红（不吃自我豁免）', () => {
    const noSelf = baseRepo()
    const c = collect(noSelf.dir)
    const row = evaluate({ ...c, selfRegistered: false, covered: new Map([...c.covered, ['check-cli-entrypoints.mjs', new Set()]]) }).rows.find((r) => r.id === 'G7')
    expect(row.pass).toBe(false)
  })

  it('G8 反例：新增一道门禁却没夹具没豁免 ⇒ 当场判红（本轮缺陷的类级修法）', () => {
    const added = baseRepo({
      pkg: { 'verify:newcomer': 'node scripts/newcomer.mjs' },
      registry: '- **覆盖地板**：1\n- **分母地板**：2\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |\n',
    })
    writeFileSync(join(added.dir, 'scripts', 'newcomer.mjs'), 'console.log("ok")\n')
    const row = evaluate(collect(added.dir)).rows.find((r) => r.id === 'G8')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('newcomer.mjs')

    // 对偶：把它具名豁免（带实测理由）⇒ 变绿，且必须登记在豁免表而不是缺口表
    const waived = baseRepo({
      pkg: { 'verify:newcomer': 'node scripts/newcomer.mjs' },
      registry: `- **覆盖地板**：1
- **分母地板**：2
## 已知缺口

| 脚本 | 理由 |
| --- | --- |
| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |

## 不可子进程豁免

| 脚本 | 为什么不能 spawn（实测依据） |
| --- | --- |
| newcomer.mjs | 冷启动要打网络，实测 40s，放夹具里会拖垮 npm test |
`,
    })
    writeFileSync(join(waived.dir, 'scripts', 'newcomer.mjs'), 'console.log("ok")\n')
    const rows = evaluate(collect(waived.dir)).rows
    expect(rows.find((r) => r.id === 'G8').pass).toBe(true)
    // 缺口表里没挂 newcomer ⇒ G2 不能因为它报警（豁免面与缺口面互斥且都参与对账）
    expect(rows.find((r) => r.id === 'G2').pass).toBe(true)
  })

  it('G8 反例：豁免表挂了一个其实已覆盖的脚本 ⇒ 幽灵豁免判红', () => {
    const w = baseRepo({
      registry: `- **覆盖地板**：1
- **分母地板**：2
## 已知缺口

| 脚本 | 理由 |
| --- | --- |
| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |

## 不可子进程豁免

| 脚本 | 为什么不能 spawn（实测依据） |
| --- | --- |
| demo-gate.mjs | 已经有夹具了还挂在豁免表 = 幽灵豁免 |
`,
    })
    const row = evaluate(collect(w.dir)).rows.find((r) => r.id === 'G8')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('幽灵豁免')
  })

  /**
   * G9（第三十轮）：「自动探针不得 spawn」这份名单由**源码特征**推导，登记册只是它的账。
   * 所以反例要同时打两侧：账上没有 / 账上有但源码已改干净 / 标签少写 / 依据空着。
   */
  const dangerRepo = (riskRows, dangerSrc = 'const r = await fetch("https://example.invalid")\nconsole.log(r)\n') => {
    const r = baseRepo({
      pkg: { 'report:danger': 'node scripts/danger.mjs' },
      registry: `- **覆盖地板**：1
- **分母地板**：2
## 已知缺口

| 脚本 | 理由 |
| --- | --- |
| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |
| danger.mjs | 源码里有网络出口，本轮先挂账：等接 preflight 后再进探针分母 |

${riskRows}
`,
    })
    writeFileSync(join(r.dir, 'scripts', 'danger.mjs'), dangerSrc)
    return evaluate(collect(r.dir))
  }
  const RISK_OK = `## 风险分类

| 脚本 | 风险特征 | 实测依据 |
| --- | --- | --- |
| danger.mjs | network-fetch | 骨架里实测 2s 打到外网，探针跑它等于测网络 |`

  it('G9 正向：源码有危险特征 + 账上有对应行且带实测依据 ⇒ 过（否则后面几条反例可能只是仓建坏了）', () => {
    const res = dangerRepo(RISK_OK)
    expect(res.rows.filter((x) => !x.pass).map((x) => `${x.id}:${x.detail}`)).toEqual([])
  })

  it('G9 反例：源码里有 fetch/DELETE 却没进风险表 ⇒ 判红（漏登）', () => {
    const res = dangerRepo('## 风险分类\n\n| 脚本 | 风险特征 | 实测依据 |\n| --- | --- | --- |')
    const row = res.rows.find((r) => r.id === 'G9')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('漏登')
    expect(row.detail).toContain('danger.mjs')
  })

  it('G9 反例：账上挂着一个源码里其实没危险的脚本 ⇒ 判红（幽灵风险行）', () => {
    const res = dangerRepo(`${RISK_OK}\n| demo-gate.mjs | wrangler | 这脚本源码里根本没有 wrangler，挂着就是幽灵行 |`)
    expect(res.rows.find((r) => r.id === 'G9').detail).toContain('幽灵')
  })

  it('G9 反例：源码同时有 gh 与 fetch，账上只写一个标签 ⇒ 判红且两侧数值都印出来', () => {
    const res = dangerRepo(RISK_OK,
      "import { execFileSync } from 'node:child_process'\nconsole.log(await fetch('https://example.invalid'), execFileSync('gh', ['api']))\n")
    const row = res.rows.find((r) => r.id === 'G9')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('标签不符')
    expect(row.detail).toContain('派生 gh-cli+network-fetch')   // 派生侧：两标签按字典序
    expect(row.detail).toContain('登记 network-fetch')          // 登记侧：少写的那个必须看得见
  })

  it('G9 反例：风险表的实测依据留空/写 TODO ⇒ 判红（光有标签不等于有理由）', () => {
    const res = dangerRepo(`## 风险分类\n\n| 脚本 | 风险特征 | 实测依据 |\n| --- | --- | --- |\n| danger.mjs | network-fetch | TODO |`)
    const row = res.rows.find((r) => r.id === 'G9')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('缺实测依据')
  })

  it('G9 边界：登记面指向不存在的脚本 ⇒ 单列红因，且这道闸**满足得了**（补文件/改别名即可，不是要人挂非法标签）', () => {    const withGhost = baseRepo({
      pkg: { 'verify:ghost': 'node scripts/ghost.mjs' },
      registry: `- **覆盖地板**：1
- **分母地板**：2
## 已知缺口

| 脚本 | 理由 |
| --- | --- |
| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |
| ghost.mjs | 别名指向的文件还没写出来，本轮先挂账 |

## 风险分类

| 脚本 | 风险特征 | 实测依据 |
| --- | --- | --- |
`,
    })
    const ghost = withGhost.res.rows.find((r) => r.id === 'G9')
    expect(ghost.pass).toBe(false)
    expect(ghost.detail).toContain('不存在的脚本')
    expect(ghost.detail).toContain('ghost.mjs')
    // 对偶：把这条**靠补上脚本文件**修好 ⇒ G9 必须转绿（否则它是一道只能靠改判据才能过的死闸）
    writeFileSync(join(withGhost.dir, 'scripts', 'ghost.mjs'), 'console.log("ok")\n')
    const fixed = evaluate(collect(withGhost.dir)).rows.find((r) => r.id === 'G9')
    expect(fixed.pass, fixed.detail).toBe(true)
  })

  /**
   * G12（第四十五轮）：取数面声明了三个来源，就必须**逐个**问它有没有贡献。
   * 动因是 R41-H3 那条欠账的形状：往根表加一项结果 74→74（静默空操作），而账面写着"面已含"。
   * 口径借本仓 `check-limit-provenance` 的 C7b（声明了却零贡献的来源判红）。
   */
  it('G12 正向：npm 别名 / .githooks / workflows 三个来源各自都有贡献 ⇒ 绿并逐个数', () => {
    const { res } = baseRepo()
    const row = res.rows.find((r) => r.id === 'G12')
    expect(row.pass, row.detail).toBe(true)
    expect(row.detail).toMatch(/npm 别名 \d+／\.githooks \d+／workflows \d+/)
  })

  it('G12 反例：workflows 整面消失 ⇒ 取数面静默缩短，必须点名 ci 而不是只报总数', () => {
    const r = baseRepo()
    rmSync(join(r.dir, '.github'), { recursive: true, force: true })
    const row = evaluate(collect(r.dir)).rows.find((x) => x.id === 'G12')
    expect(row.pass).toBe(false)
    expect(row.detail).toMatch(/声明了却零贡献的来源\*\*: ci/)
  })

  it('G12 反例：钩子目录改名（真面最容易踩的那种）⇒ 判红点名 hook，且 G1 的总数照样绿，正说明只有这条能抓', () => {
    const r = baseRepo()
    rmSync(join(r.dir, '.githooks'), { recursive: true, force: true })
    const res = evaluate(collect(r.dir))
    const g12 = res.rows.find((x) => x.id === 'G12')
    expect(g12.pass).toBe(false)
    expect(g12.detail).toMatch(/声明了却零贡献的来源\*\*: hook/)
    expect(res.rows.find((x) => x.id === 'G1').pass, 'G1 只看总数 ⇒ 它看不见这件事').toBe(true)
  })

  it('G12 对偶：把删掉的来源补回来 ⇒ 必须转绿（不许是一道只能改判据才能过的死闸）', () => {
    const r = baseRepo()
    rmSync(join(r.dir, '.github'), { recursive: true, force: true })
    expect(evaluate(collect(r.dir)).rows.find((x) => x.id === 'G12').pass).toBe(false)
    mkdirSync(join(r.dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(r.dir, '.github', 'workflows', 'ci.yml'), 'name: CI\njobs:\n  b:\n    steps:\n      - run: node scripts/other-gate.mjs\n')
    const back = evaluate(collect(r.dir)).rows.find((x) => x.id === 'G12')
    expect(back.pass, back.detail).toBe(true)
  })

  /**
   * G13（第四十六轮）：别名里的**非 .mjs** 入口 —— 取数面看不见它，所以它既不在登记面也不在缺口面，
   * 属"结构性失踪"。一手分母：真仓 `package.json` 里这样的入口恰好 1 条（`verify:images` → `python scripts/verify_images.py`），
   * 而 workflows 里 grep `verify:images` = 0 处 ⇒ 只有人手敲才跑。
   */
  const NN_PKG = { 'report:pix': 'python scripts/pix.py' }
  const nnReg = (rows) => `${cleanRegistry}\n## 非 node 入口\n\n| 脚本 | 真实命令 | 为什么不能 spawn |\n| --- | --- | --- |\n${rows}\n`
  const NN_OK_ROW = '| pix.py | `python scripts/pix.py` | 实测 node 起它得 ERR_UNKNOWN_FILE_EXTENSION 裸栈，5,227B 纯 python |'

  it('G13 正向：非 .mjs 入口登记了真实命令 + 可证伪理由 ⇒ 绿（登记不等于进面）', () => {
    const { res } = baseRepo({ pkg: NN_PKG, registry: nnReg(NN_OK_ROW) })
    const row = res.rows.find((r) => r.id === 'G13')
    expect(row.pass, row.detail).toBe(true)
    expect(row.detail).toContain('非 .mjs 入口 1 个 ⇄ 册上「非 node 入口」登记 1 个')
  })

  it('G13 反例：别名有 python 入口而册上没登记 ⇒ 判红并点名"结构性失踪"', () => {
    const { res } = baseRepo({ pkg: NN_PKG })
    const row = res.rows.find((r) => r.id === 'G13')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('结构性失踪')
    expect(row.detail).toContain('pix.py')
    // 这条红不许被 G1/G12 同时抓走 ⇒ 它们看不见非 .mjs，正是本条存在的理由
    expect(res.rows.find((r) => r.id === 'G1').pass).toBe(true)
    expect(res.rows.find((r) => r.id === 'G12').pass).toBe(true)
  })

  it('G13 反例：登记了但理由不可证伪（无数字无反引号命令）⇒ 判红', () => {
    const { res } = baseRepo({ pkg: NN_PKG, registry: nnReg('| pix.py | python scripts/pix.py | 应该是 python 跑的吧') })
    const row = res.rows.find((r) => r.id === 'G13')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('不可证伪')
  })

  it('G13 反向对账：册上登记了别名里已经没有的入口 ⇒ 幽灵判红（不许留着当"已核过"）', () => {
    const { res } = baseRepo({ registry: nnReg(NN_OK_ROW) })
    const row = res.rows.find((r) => r.id === 'G13')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('幽灵')
    expect(row.detail).toContain('pix.py')
  })

  /**
   * G14（第四十七轮）：采集目录 tests/ 本身要有正向断言 —— 旧版 `collectCovered` 第一行就是
   * "目录不存在 ⇒ return 空 Map"，于是"没人写夹具"与"我根本没读到目录"两种情况账面完全一样。
   */
  it('G14 正向：tests/ 存在、有测试文件、且至少一个真起子进程 ⇒ 绿并印出两个数', () => {
    const { res } = baseRepo()
    const row = res.rows.find((r) => r.id === 'G14')
    expect(row.pass, row.detail).toBe(true)
    expect(row.detail).toMatch(/tests\/：\d+ 个测试文件，其中 \d+ 个真起子进程/)
  })

  it('G14 反例：tests/ 被改名 ⇒ 本条判"采集面消失"，而 G1 照样绿、G2 却报出一堆假"缺口"（正是本条要抓的误诊）', () => {
    const r = baseRepo()
    rmSync(join(r.dir, 'tests'), { recursive: true, force: true })
    const res = evaluate({ ...collect(r.dir), declared: parseRegistry(readFileSync(join(r.dir, REGISTRY), 'utf8')) })
    const g14 = res.rows.find((x) => x.id === 'G14')
    expect(g14.pass).toBe(false)
    expect(g14.status).toBe('UNVERIFIED')
    expect(g14.detail).toContain('空集而不是零覆盖')
    expect(res.rows.find((x) => x.id === 'G1').pass, '登记面与 tests/ 无关 ⇒ 它看不见这件事').toBe(true)
    expect(res.rows.find((x) => x.id === 'G2').pass, '症状长在别处：覆盖面空 ⇒ G2 会喊"未登记缺口"').toBe(false)
  })

  it('G14 反例：tests/ 还在但里面没有一个真起子进程 ⇒ 判红并说清"实测未覆盖"其实是"全都未覆盖"', () => {
    const r = baseRepo()
    rmSync(join(r.dir, 'tests', 'demo.test.js'))
    writeFileSync(join(r.dir, 'tests', 'pure.test.js'), "import { evaluate } from '../scripts/check-cli-entrypoints.mjs'\nevaluate({})\n")
    const g14 = evaluate(collect(r.dir)).rows.find((x) => x.id === 'G14')
    expect(g14.pass).toBe(false)
    expect(g14.detail).toContain('没有任何一个含 spawn')
  })

  it('G14 对偶：把起子进程的夹具补回来 ⇒ 必须转绿（不许是一道只能改判据才能过的死闸）', () => {
    const r = baseRepo()
    rmSync(join(r.dir, 'tests', 'demo.test.js'))
    expect(evaluate(collect(r.dir)).rows.find((x) => x.id === 'G14').pass).toBe(false)
    writeFileSync(join(r.dir, 'tests', 'demo.test.js'), `import { spawnSync } from 'node:child_process'\nspawnSync('node', ['scripts/demo-gate.mjs'])\n`)
    const back = evaluate(collect(r.dir)).rows.find((x) => x.id === 'G14')
    expect(back.pass, back.detail).toBe(true)
  })

  it('G14 边界：调用方没喂采集面读数 ⇒ 记 UNVERIFIED，且**不得**把它印成"tests/ 不存在"（读不动 ≠ 结论为否）', () => {
    const r = baseRepo()
    const row = evaluate({ ...collect(r.dir), face: undefined }).rows.find((x) => x.id === 'G14')
    expect(row.pass).toBe(false)
    expect(row.status).toBe('UNVERIFIED')
    expect(row.detail).toContain('未传采集面读数')
    expect(row.detail, '把"没读数"写成"目录不存在"就是给后人留一条假证据').not.toContain('不存在')
  })

  it('G14 边界：落在扩展名名单外的文件必须**被印出来**，不许静默少记（第四十七轮 R46-H2）', () => {
    const r = baseRepo()
    expect(evaluate(collect(r.dir)).rows.find((x) => x.id === 'G14').detail).not.toContain('名单外')
    writeFileSync(join(r.dir, 'tests', 'payload.json'), '{"a":1}\n')
    const row = evaluate(collect(r.dir)).rows.find((x) => x.id === 'G14')
    expect(row.pass, '数据件不该把判据判红').toBe(true)
    expect(row.detail).toContain('.json×1')
  })

  it('R46-H2 去写死有牙齿：`.cjs` 夹具进采集面（旧版三处各写一遍 `\\.m?[jt]sx?$`，.cjs 恒被少记成"没跑过"）', () => {
    const r = baseRepo()
    expect(collect(r.dir).covered.has('other-gate.mjs'), '基线：other-gate 只有缺口表登记，没有夹具').toBe(false)
    writeFileSync(join(r.dir, 'tests', 'legacy.cjs'), `const { spawnSync } = require('node:child_process')\nspawnSync('node', ['scripts/other-gate.mjs'])\n`)
    expect(collect(r.dir).covered.get('other-gate.mjs'), '新增的 .cjs 夹具必须被认成覆盖').toBeTruthy()
    // 反向半边：名单外的扩展名仍然不算对象（证明这不是"把过滤整个删掉"换来的绿）
    writeFileSync(join(r.dir, 'tests', 'stray.txt'), "spawnSync('node', ['scripts/other-gate.mjs'])\n")
    const face = testFace(r.dir)
    expect(face.outside).toContain('.txt×1')
    expect(face.files).toBe(2)
  })

  /**
   * 退出码分相（第四十七轮）：0 全绿 / 1 判出违规 / 2 证据失效。
   * 形状取自 `pytest-dev/pytest`：`src/_pytest/main.py:392` 在收集后先问 `session.testscollected == 0`
   * 并返回专属的 `ExitCode.NO_TESTS_COLLECTED`，而不是让它顺着 `return None` 掉进"通过"。
   * 户内同源件是 `check-judge-side-effects.mjs` 的 S4/S6（同样 rc=2）。
   */
  describe('verdictOf 退出码分相', () => {
    it('三态：全绿 0 / 只有违规 1 / 含证据失效 2，且 2 优先于 1（混合时不得读成"判出违规"）', () => {
      expect(verdictOf([{ id: 'G1', pass: true }])).toEqual({ verdict: 'GREEN', rc: 0 })
      expect(verdictOf([{ id: 'G2', pass: false }])).toEqual({ verdict: 'RED', rc: 1 })
      expect(verdictOf([{ id: 'G9', pass: false }, { id: 'G14', pass: false, status: 'UNVERIFIED' }]))
        .toEqual({ verdict: 'UNVERIFIED', rc: 2 })
    })

    it('边界两则：pass=true 却带 UNVERIFIED 不得抬成 rc=2；rows 为空（判据集合失踪）不得记 GREEN', () => {
      expect(verdictOf([{ id: 'G1', pass: true, status: 'UNVERIFIED' }])).toEqual({ verdict: 'GREEN', rc: 0 })
      expect(verdictOf([]), '没有可判对象 ≠ 全部通过（与 V3/G1 的零分母同一族）').toEqual({ verdict: 'RED', rc: 1 })
    })

    it('真入口回执：本仓当场跑 `check-cli-entrypoints.mjs` ⇒ rc=0 且门面行自报 rc=（调用方能不解析文案就分档）', () => {
      const r = spawnSync(process.execPath, ['scripts/check-cli-entrypoints.mjs'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 })
      expect(r.status, `真面应当全绿，实测 rc=${r.status}：${String(r.stdout).split(/\r?\n/).slice(-1)}`).toBe(0)
      expect(r.stdout).toMatch(/GATE-PASS cli-entrypoints :: .*｜rc=0$/m)
    })
  })

  /**
   * G11（第三十二轮）：`@probe-safe` 让"危险的项"可以自述"我会在门口就停住"并回到探针分母，
   * 口径借 golang/go 的 `-short`（条件写在被试对象里，框架只做机械核对）。
   * 于是必须双向核对三件事：声明要有真危险特征可宣、要有实测数字、且与风险表的"已证明停在门口"一一对应。
   */
  const MARK = '// @probe-safe: 骨架实测 rc=2 / 0s（缺输入即 bail）\n'
  const RISK_NET = "console.log(await fetch('https://example.invalid'))\n"
  const RISK_ROW_OK = '## 风险分类\n\n| 脚本 | 风险特征 | 实测依据 |\n| --- | --- | --- |\n| danger.mjs | network-fetch | ✅ 已证明停在门口：rc=2 / 0s（缺输入先撞 requireInputs） |'
  const riskRepo = (dangerSrc, riskRow) => dangerRepo(riskRow, dangerSrc)

  it('G11 正向：源码声明 + 风险表"已证明停在门口" + 确有危险特征 ⇒ 三条全对得上', () => {
    const res = riskRepo(MARK + RISK_NET, RISK_ROW_OK)
    const row = res.rows.find((r) => r.id === 'G11')
    expect(row.pass, row.detail).toBe(true)
    expect(row.detail).toContain('声明 1 条 ⇄ 风险表"停在门口" 1 条')
  })

  it('G11 反例：表里写了"已证明停在门口"但源码没有声明 ⇒ 判红（口径不能只活在文档里）', () => {
    const row = riskRepo(RISK_NET, RISK_ROW_OK).rows.find((r) => r.id === 'G11')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('表里说停在门口但源码没声明')
  })

  it('G11 反例：源码有声明但风险表未标（非门禁项已进分母却查无实据）⇒ 判红', () => {
    const row = riskRepo(MARK + RISK_NET,
      '## 风险分类\n\n| 脚本 | 风险特征 | 实测依据 |\n| --- | --- | --- |\n| danger.mjs | network-fetch | 骨架里实测 2s 打到外网 |').rows.find((r) => r.id === 'G11')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('已声明解禁但风险表未标')
  })

  it('G11 反例：声明落在其实没有危险特征的脚本上 ⇒ 判红（无效声明只会把口径搞浑）', () => {
    const row = riskRepo(MARK + 'console.log("我谁也不碰")\n', RISK_ROW_OK).rows.find((r) => r.id === 'G11')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('无效声明')
  })

  it('G11 反例：声明只写"应该会停住"没有实测数字 ⇒ 判红（自述也必须有数）', () => {
    const row = riskRepo('// @probe-safe: 应该会先停住吧\n' + RISK_NET, RISK_ROW_OK).rows.find((r) => r.id === 'G11')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('声明没有实测数字')
  })
})

/**
 * classifyRisk 自身的夹具（第三十轮）。它现在决定"哪些入口永不被自动 spawn"，
 * 所以两个方向都要钉住：散文里提到危险词**不算**（否则解释这套词表的判据自己会被标成危险，
 * 本轮就真的发生在这条闸上），而代码里真有的东西**必须算**（哪怕它写在行尾注释旁边 —— 只删整行注释，
 * 不做词法分析，宁可多报也不能把危险读成安全）。
 */
describe('classifyRisk：风险从代码读，不从散文读', () => {
  it('正向：真代码里的网络/删除/起服务/产物写入都被标出', () => {
    expect(classifyRisk('const r = await fetch(url)')).toEqual(['network-fetch'])
    expect(classifyRisk('const q = `DELETE FROM security_events WHERE ts < 1`')).toEqual(['sql-delete'])
    expect(classifyRisk("http.createServer(fn).listen(3000)")).toEqual(['http-server'])
    expect(classifyRisk("writeFileSync(join(root, 'docs', 'API.md'), md)")).toEqual(['writes-artifacts'])
    // curl 与 gh 走 exec 家族，靠"命令名字面量 + 逗号"识别：cmd 是变量时也命中（调用处必然出现 'gh',）
    expect(classifyRisk("execFileSync('curl', args)")).toEqual(['network-fetch'])
    expect(classifyRisk("run('gh', ['pr', 'list'])")).toEqual(['gh-cli'])
  })
  it('反向：整行注释里的这些词一律不算（本轮真实踩到：判据注释解释词表 ⇒ 自己被判成不可跑）', () => {
    for (const line of [
      '// 命中 wrangler / d1 execute / DELETE FROM / 起服务 的脚本永不 spawn',
      '/* fetch(url) 与 execFileSync(\'gh\', ...) 都不该自动跑 */',
      ' * purge 会打 DELETE FROM 到远端',
    ]) expect(classifyRisk(line), line).toEqual([])
    expect(classifyRisk('console.log("我什么都没干")')).toEqual([])
  })
  it('保守方向：行尾注释里的词仍然算（只删整行注释，不做词法分析 ⇒ 宁可多报不可漏报）', () => {
    expect(classifyRisk("spawnSync('gh', a) // gh 只是举例")).toEqual(['gh-cli'])
    expect(classifyRisk('doWork(x) // 这里其实有 DELETE FROM 也没关系')).toEqual(['sql-delete'])
  })
  it('@probe-safe 只认**独占一行**的声明：正文里引用这个词不算声明（本轮真实踩到）', () => {
    // 反例来源：判据在注释里解释这套机制时写了 "`@probe-safe: <依据>`"，于是解释者自己被记成
    // "带声明但无危险特征" ⇒ 又一次自指（第三十轮 classifyRisk 命中自己注释的同型事）。口径=行首独占。
    expect(probeSafeEvidence('// 脚本可以自述（`@probe-safe: <依据>`）之类的话都不算')).toBeNull()
    expect(probeSafeEvidence('const x = 1\n// @probe-safe: 骨架实测 rc=2 / 0s\nconst y = 2')).toBe('骨架实测 rc=2 / 0s')
    expect(probeSafeEvidence('/* @probe-safe: 块注释里写的也不算 */')).toBeNull()
  })
})

/**
 * 覆盖面口径自身（第三十一轮 H1）。它决定"某道门禁被真跑过"这句话成不成立，
 * 所以三向都要钉：真跑的必须记账、死数组与只在断言里提到的**不得**记账。
 * 上一版规则＝"文件里有 spawn + 出现过文件名"，第二向/第三向全会被误记（本轮实测复现过）。
 */
describe('collectCovered：名字必须沿调用链到达执行点才算覆盖', () => {
  const dir = tmpRepo({
    'package.json': JSON.stringify({
      name: 'f',
      scripts: { 'verify:a': 'node scripts/a.mjs', 'verify:b': 'node scripts/b.mjs', 'verify:c': 'node scripts/c.mjs' },
    }),
    'scripts/a.mjs': 'console.log("ok")\n',
    'scripts/b.mjs': 'console.log("ok")\n',
    'scripts/c.mjs': 'console.log("ok")\n',
    'tests/cover.test.js': [
      "import { spawnSync } from 'node:child_process'",
      "const PROBED = ['a.mjs']",
      'function runGate(p) { return spawnSync(process.execPath, [p]) }',
      'for (const p of PROBED) { runGate(p) }',
      "const IGNORED = ['b.mjs']",
      "expect(true).toBe(true && 'c.mjs' === 'c.mjs')",
    ].join('\n'),
  })
  const cov = collectCovered(dir)
  it('正例：数组 + for..of + 本地 runner（体内有 spawn）⇒ 记账', () => {
    expect([...cov.keys()]).toContain('a.mjs')
  })
  it('反例两向：没人用的数组、只在断言里提到的名字 ⇒ 都不许记账', () => {
    expect(cov.has('b.mjs'), '死数组被记成"已跑过"').toBe(false)
    expect(cov.has('c.mjs'), '仅出现在断言里被记成"已跑过"').toBe(false)
  })
  it('反向自检：这个合成仓确实"有 spawn"（否则上面两条只是因为整个探针没启动）', () => {
    expect(/\bspawnSync\s*\(/.test(readFileSync(join(dir, 'tests', 'cover.test.js'), 'utf8'))).toBe(true)
    expect(cov.size).toBe(1)
  })
})

/**
 * 缺输入面探针（第二十五轮）：把每个门禁类入口**拷进只有 scripts/ 的空目录**真跑一遍。
 * 两件事必须同时成立，缺一即红：
 *   ① rc != 0 —— 拿不到输入面却返回"通过"的判据，等于把"没扫到"记成"扫过且清白"；
 *   ② 首行必须是自家诊断，不能是 node:/file:// 栈、SyntaxError、MODULE_NOT_FOUND ——
 *      裸栈会把"环境不满足"伪装成"判据崩溃"，CI 里没人能从 node:fs:441 读出该补什么。
 * 修之前的基线（本轮实测）：22 个门禁类入口里 8 个甩裸栈、1 个静默放行
 * —— check-licenses 在没有 package.json 时打印「0 个生产依赖（含传递）全部 … 白名单 ✅」并 exit 0。
 */
describe('缺输入面探针：探针分母（门禁类 + 非门禁可安全 spawn）必须 fail-closed 且不崩栈', () => {
  const SHELL_RE = /^\s*(node:|file:\/\/|\s+at\s|SyntaxError|ReferenceError|TypeError|Error \[|MODULE_NOT_FOUND|ENOENT)/
  const dir = mkdtempSync(join(tmpdir(), 'smnoinput-'))
  tmpDirs.push(dir)
  cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true })
  const denom = probeDenominator()

  it('分母非零 + 不变式：非门禁项进这一腿，只能"无危险特征"或"自带 @probe-safe 实测声明"', () => {
    expect(denom.filter((r) => isGateLike(r.sources)).length).toBeGreaterThanOrEqual(20)
    // 第三十二轮的口径（借 golang/go 的 -short：条件由被试对象自述，框架只机械核对）。
    // 实测依据：这些项在**两种骨架**里都 rc=1/2、0–1s、首行为自家诊断 ⇒ "停在门口"为真。
    const admitted = []
    for (const r of denom.filter((x) => !isGateLike(x.sources))) {
      const src = readFileSync(join(SCRIPTS, r.script), 'utf8')
      const tags = classifyRisk(src)
      if (!tags.length) continue
      const ev = probeSafeEvidence(src)
      expect(ev, `${r.script} 带危险特征 ${tags.join('+')} 却无 @probe-safe 声明 ⇒ 不该被自动 spawn`).not.toBeNull()
      expect(String(ev), `${r.script} 的声明必须带实测数字`).toMatch(/\d/)
      admitted.push(r.script)
    }
    // 期望集**读登记册风险表**，不再在测试里抄第三份名单（第三十三轮 M1）：
    // 「账本 ⇄ 源码」由 G11 双向核，「账本 ⇄ 分母」由这条核 —— 三份清单必然会漂，一处为准。
    const fromLedger = parseRegistry(readFileSync(join(REPO, REGISTRY), 'utf8')).risk
      .filter((row) => row.note.includes('已证明停在门口'))
      .map((row) => row.script)
      .filter((s) => { const e = denom.find((x) => x.script === s); return e && !isGateLike(e.sources) })
      .sort()
    expect(fromLedger.length, '风险表里应有"已证明停在门口"的非门禁行（空表会让这条断言失去意义）').toBeGreaterThan(0)
    expect(admitted.sort()).toEqual(fromLedger)
  })

  for (const r of denom) {
    it(`${r.script} 在没有输入面的目录里：非 0 退出 + 首行是人话诊断`, () => {
      const res = spawnSync(process.execPath, [join(dir, 'scripts', r.script)], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
      const out = `${res.stdout || ''}${res.stderr || ''}`
      const first = out.trim().split(/\r?\n/)[0] || '(无输出)'
      expect(res.status, `${r.script} 缺输入面却返回 0（把"没扫到"当成"扫过且清白"）：${first}`).not.toBe(0)
      expect(first, `${r.script} 首行是崩栈而不是诊断：${first}`).not.toMatch(SHELL_RE)
      expect(out.length).toBeGreaterThan(0)
    }, 90_000)
  }

  it('探针有牙齿：植入"缺输入仍 exit 0"与"直接崩栈"两种假门禁 ⇒ 同一规则都必须抓住', () => {
    const openScript = join(dir, 'scripts', 'planted-fail-open.mjs')
    writeFileSync(openScript, "console.log('[planted] 0 个对象，全部通过')\n")
    expect(spawnSync(process.execPath, [openScript], { cwd: dir, encoding: 'utf8', timeout: 20_000 }).status).toBe(0)
    const crashScript = join(dir, 'scripts', 'planted-crash.mjs')
    writeFileSync(crashScript, 'nopeNotDefined.x()\n')
    const r = spawnSync(process.execPath, [crashScript], { cwd: dir, encoding: 'utf8', timeout: 20_000 })
    const first = `${r.stdout}${r.stderr}`.trim().split(/\r?\n/)[0]
    expect(r.status).not.toBe(0)
    expect(first).toMatch(SHELL_RE)
  })

  it('变异体：把 check-licenses 的零分母收口摘掉 ⇒ 同一探针必须把它读成"静默放行"', () => {
    // 没有这条，上面 22 条"全绿"可能只是因为探针根本没跑东西，或因为**判据自己变瞎**。
    // 摘的是真源码里那段 `if (pkgs.size === 0)`（第二十五轮实测的那条缺陷：空依赖树被打印成"全部在白名单 ✅"）。
    const target = join(dir, 'scripts', 'check-licenses.mjs')
    const src = readFileSync(target, 'utf8')
    const mutated = src.replace('if (pkgs.size === 0) {', 'if (false) {')
    expect(mutated, '变异锚点已失效（check-licenses 改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated)
    try {
      const r = spawnSync(process.execPath, [target], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
      expect(r.status, '摘掉零分母收口后探针仍判非 0 ⇒ 探针没在看这件事').toBe(0)
      expect(`${r.stdout}${r.stderr}`).toContain('全部 MIT/BSD/Apache/ISC 类白名单')
    } finally {
      writeFileSync(target, src) // 还原：后面的用例还要跑原始副本
    }
    const back = spawnSync(process.execPath, [target], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    expect(back.status, '还原后必须重新 fail-closed（证明上面那个 0 是变异造成的，不是环境噪声）').not.toBe(0)
  }, 90_000)
})

/**
 * 零分母探针（第二十六轮）：上一轮测的是"输入面**不存在**"，这一轮测更难也更要紧的一种 ——
 * **输入面全在、内容全为空**。区别很实在：`requireInputs` 这类存在性检查在这里全部过关，
 * 于是判据要么"扫到 0 个对象"后照常报绿，要么在解析空文件时甩裸栈。
 * 基线（修之前实测）：22 个门禁类入口里 **2 个返回 rc=0**
 * （`check-schema-drift` 打印「==== 结果: 0 通过 / 0 失败 ====」；`check-import-cycles` 在 0 字节源文件上
 * 报"扫描模块: 84 个 / 未检测到循环依赖"）**+ 2 个裸栈**（空 package.json 让 Node 崩在模块解析前）。
 * 现在 22/22 均 rc≠0 且首行是诊断。
 */
describe('零分母探针：输入面齐、内容全 0 字节时，同一分母不得返回 0', () => {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-stub', '.wrangler', 'coverage', 'test-results'])
  const skeleton = mkdtempSync(join(tmpdir(), 'smzero-'))
  tmpDirs.push(skeleton)
  ;(function mirror(rel) {
    for (const e of readdirSync(join(REPO, rel), { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { mkdirSync(join(skeleton, r), { recursive: true }); mirror(r) }
      else {
        mkdirSync(dirname(join(skeleton, r)), { recursive: true })
        // scripts/ 要真内容（跑的就是这批判据），其余一律 0 字节：判据的"输入"因此存在但为空
        writeFileSync(join(skeleton, r), r.startsWith('scripts/') ? readFileSync(join(REPO, r)) : '')
      }
    }
  })('')

  const denom = probeDenominator()
  const runIn = (script) => spawnSync(process.execPath, [join(skeleton, 'scripts', script)],
    { cwd: skeleton, encoding: 'utf8', timeout: 60_000 })

  it('骨架仓真的建起来了（有 src/functions/docs，且它们全是 0 字节）', () => {
    // 不证这一条，下面的"22 条全红"可能只是因为骨架是空的目录、判据在测不存在面（上一轮已测过）
    expect(readFileSync(join(skeleton, 'src', 'main.tsx'), 'utf8') ?? '').toBe('')
    expect(readdirSync(join(skeleton, 'db')).length).toBeGreaterThan(0)
    expect(statSync(join(skeleton, 'package.json')).size).toBe(0)
    // 两把尺必须同形：上一版拿"骨架 scripts/ 的全部条目数"去比"真仓的 .mjs 数"，
    // 一边含 lib/、.py、.sh、archive/，一边只数 .mjs ⇒ 39 vs 34 的假失败。
    const mjsNames = (d) => readdirSync(d).filter((f) => f.endsWith('.mjs')).sort()
    expect(mjsNames(join(skeleton, 'scripts'))).toEqual(mjsNames(SCRIPTS))
  })

  for (const r of denom) {
    it(`${r.script} 面对"文件在、内容为空"的输入 ⇒ 非 0 退出且不崩栈`, () => {
      const res = runIn(r.script)
      const out = `${res.stdout || ''}${res.stderr || ''}`
      const first = out.trim().split(/\r?\n/)[0] || '(无输出)'
      expect(res.status, `${r.script} 在零分母输入上返回 0（把"扫到 0 个对象"读成"扫过且清白"）：${first}`).not.toBe(0)
      expect(first).not.toMatch(/^\s*(node:|file:\/\/|\s+at\s|SyntaxError|ReferenceError|TypeError|Error \[|MODULE_NOT_FOUND|ENOENT|<anonymous_script>)/)
    }, 90_000)
  }

  it('变异体：摘掉 check-schema-drift 的零对象守卫 ⇒ 同一探针必须把它读成"装绿"', () => {
    const target = join(skeleton, 'scripts', 'check-schema-drift.mjs')
    const src = readFileSync(target, 'utf8')
    const mutated = src.replace('if (checks === 0 && !failures.length) {', 'if (false) {')
    expect(mutated, '变异锚点已失效（判据改形，夹具必须同步）').not.toBe(src)
    writeFileSync(target, mutated)
    try {
      expect(runIn('check-schema-drift.mjs').status, '摘掉守卫后探针仍判非 0 ⇒ 探针没在看这件事').toBe(0)
    } finally {
      writeFileSync(target, src)
    }
    expect(runIn('check-schema-drift.mjs').status, '还原后必须重新非 0（证明那个 0 是变异造成的）').not.toBe(0)
  }, 90_000)
})

/**
 * preflight 自身的夹具（R25-M4 收尾）：它现在承担 15 个门禁的"缺输入"出口，
 * 却只靠调用方间接覆盖 —— 一旦它自己写坏（比如 label 没进 stderr、退出码变了），
 * 所有门禁会一起变成"人话不成立"而探针只看到 rc≠0，照样绿。所以直接打它。
 */
describe('preflight 出口件：bail / requireInputs / requireParams / requireJson', () => {
  const dir = tmpRepo({})
  const driver = join(dir, 'driver.mjs')
  writeFileSync(driver, [
    "import { bail, requireInputs, requireParams, requireJson } from '" + pathToFileURL(join(SCRIPTS, 'lib', 'preflight.mjs')).href + "'",
    "const [what, ...rest] = process.argv.slice(2)",
    "if (what === 'bail') bail('probe', rest.join(' '))",
    "if (what === 'inputs') requireInputs('probe', rest)",
    "if (what === 'params') requireParams('probe', rest)",
    "if (what === 'json') requireJson('probe', rest)",
    "console.log('PASSED-THROUGH')",
  ].join('\n'))
  const go = (...args) => spawnSync(process.execPath, [driver, ...args], { encoding: 'utf8', timeout: 20_000 })

  for (const [what, badArg, goodArg] of [['bail', '就是少了它', null], ['inputs', join(dir, 'nope.sql'), join(dir, 'driver.mjs')], ['params', 'NO_SUCH_ENV_AT_ALL', 'PATH']]) {
    it(`${what}：缺 ⇒ 首行是 [probe] 环境不满足 且 rc=2${goodArg ? '；齐 ⇒ 放行' : '（bail 没有"齐"这一侧）'}`, () => {
      const bad = go(what, badArg)
      expect(bad.status).toBe(2)
      expect(bad.stderr).toContain('[probe] 环境不满足')
      expect(bad.stderr).toContain('rc=2')
      if (!goodArg) return
      const good = spawnSync(process.execPath, [driver, what, goodArg], { encoding: 'utf8', timeout: 20_000 })
      expect(good.stdout).toContain('PASSED-THROUGH')
      expect(good.status).toBe(0)
    })
  }

  it('requireJson：0 字节 / 坏 JSON / 不存在 三种都拦，合法放行（空 package.json 曾让 Node 先崩栈）', () => {
    writeFileSync(join(dir, 'empty.json'), '')
    writeFileSync(join(dir, 'bad.json'), '{')
    writeFileSync(join(dir, 'ok.json'), '{"a":1}')
    for (const f of ['empty.json', 'bad.json', 'missing.json']) {
      const r = go('json', join(dir, f))
      expect(r.status, `${f} 没被拦住`).toBe(2)
      expect(r.stderr).toContain('JSON 输入不可解析')
    }
    expect(go('json', join(dir, 'ok.json')).stdout).toContain('PASSED-THROUGH')
  })
})

/**
 * 密钥扫描的三种分母形状（第三十一轮 H2）：第二十五/二十六轮把"零对象不得记绿"立成了规矩，
 * 而这条入口当时不在分母里（它就是那轮被抓到的病号）。这里把它三种输出形状钉死，防止回退。
 */
describe('scan-secrets：扫到了 / 没得扫 / 暂存区为空，三种输出必须不同', () => {
  const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 30_000 })
  const run = (dir, args = []) => spawnSync(process.execPath, [join(SCRIPTS, 'scan-secrets.mjs'), ...args],
    { cwd: dir, encoding: 'utf8', timeout: 60_000 })
  const out = (r) => `${r.stdout || ''}${r.stderr || ''}`

  it('暂存区有文件 ⇒ rc=0 且印出"已读 N 个文件"（N≥1）', () => {
    const dir = tmpRepo({ 'a.txt': 'hello\n' })
    git(dir, ['init', '-q'])
    git(dir, ['add', 'a.txt'])
    const r = run(dir, ['--staged'])
    expect(out(r), out(r)).toContain('已读 1 个文件')
    expect(r.status, out(r)).toBe(0)
  }, 90_000)

  it('暂存区为空 ⇒ 必须说"跳过"并且不得说"通过"（看守型不阻断，但"没得扫"≠"扫过且干净"）', () => {
    const dir = tmpRepo({ 'a.txt': 'hello\n' })
    git(dir, ['init', '-q'])
    const r = run(dir, ['--staged'])
    expect(out(r)).toContain('跳过')
    expect(out(r)).not.toContain('密钥扫描通过')
    expect(r.status).toBe(0)
  }, 90_000)

  it('整仓零跟踪文件 ⇒ rc=2 fail-closed（第三十轮的病：这一情形曾打印与真扫 632 文件逐字相同的"通过"）', () => {
    const dir = tmpRepo({})
    git(dir, ['init', '-q'])
    const r = run(dir)
    expect(r.status, out(r)).toBe(2)
    expect(out(r)).toContain('环境不满足')
  }, 90_000)
})

describe('真仓登记册与实测互洽（防文档自说自话）', () => {
  it('parseRegistry 读得到真登记册的三张表（缺口 / 豁免 / 风险分类）', () => {
    const md = readFileSync(join(REPO, REGISTRY), 'utf8')
    const d = parseRegistry(md)
    expect(d.floor).toBeGreaterThanOrEqual(PROBED.length)
    expect(d.gaps.length).toBeGreaterThan(0)
    expect(d.exemptions.length).toBeGreaterThan(0)
    // 风险表的标签必须是纯逗号分隔的词（写进自然语言就说明解析口径漂了）
    const known = new Set(['wrangler', 'd1-execute', 'sql-delete', 'http-server', 'writes-artifacts', 'network-fetch', 'gh-cli'])
    expect(d.risk.length).toBeGreaterThanOrEqual(14)
    for (const r of d.risk) expect(r.tags.every((t) => known.has(t)), `${r.script} 标签越界: ${r.tags.join('+')}`).toBe(true)
  })
  it('真仓 GATE-PASS：判据跑在自己的仓库上必须是绿的', () => {
    const { rc, out } = probe('check-cli-entrypoints.mjs')
    expect(out).toContain('GATE-PASS cli-entrypoints')
    expect(rc).toBe(0)
    expect(out).not.toContain('TODO')
  })
  afterAll(() => {
    for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 临时目录清理失败不改结论 */ } }
  })
})
