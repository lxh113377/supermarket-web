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
import { evaluate, collect, collectRegistered, collectCovered, isGateLike, parseRegistry, REGISTRY } from '../scripts/check-cli-entrypoints.mjs'

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

describe('判据 G1~G8：合成仓双向变异', () => {
  /**
   * 一个"应当全绿"的最小合成仓：demo-gate 有夹具、other-gate 具名挂账、
   * 判据自身（check-cli-entrypoints.mjs）也在登记面且有夹具 —— 正向腿必须八条全过，
   * 否则后面每条反例都可能只是"合成仓本来就建坏了"。
   */
  const SELF = 'check-cli-entrypoints.mjs'
  const cleanRegistry = `- **覆盖地板**：2

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
      'CONTRIBUTING.md': '本地门禁：`git config core.hooksPath .githooks`\n',
      [REGISTRY]: over.registry ?? cleanRegistry,
    })
    return { dir, res: evaluate(collect(dir)) }
  }

  it('正向：干净合成仓 ⇒ 八条全过（G7 也过，因为判据自己在登记面+有夹具）', () => {
    const { res } = baseRepo()
    const bad = res.rows.filter((r) => !r.pass)
    expect(bad.map((r) => `${r.id}:${r.detail}`), JSON.stringify(res.rows, null, 1)).toEqual([])
    expect(res.summary.matched).toBe(res.summary.declared)
    expect(res.summary.declared).toBe(8)
  })

  it('G1 反例：登记面枚举为空 ⇒ 判红（零输入不得 PASS）', () => {
    const dir = tmpRepo({ 'package.json': JSON.stringify({ scripts: {} }) })
    const rows = evaluate(collect(dir)).rows
    expect(rows.find((r) => r.id === 'G1').pass).toBe(false)
  })

  it('G2 反例：实测未覆盖却不登记 ⇒ 红；登记了个已覆盖的 ⇒ 也算红（幽灵缺口）', () => {
    const undeclared = baseRepo({ registry: '- **覆盖地板**：1\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n' })
    expect(undeclared.res.rows.find((r) => r.id === 'G2').pass).toBe(false)
    expect(undeclared.res.rows.find((r) => r.id === 'G2').detail).toContain('未登记缺口: other-gate.mjs')

    const phantom = baseRepo({ registry: '- **覆盖地板**：1\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| demo-gate.mjs | 其实已被夹具覆盖，这里挂着就是幽灵行 |\n' })
    expect(phantom.res.rows.find((r) => r.id === 'G2').pass).toBe(false)
    expect(phantom.res.rows.find((r) => r.id === 'G2').detail).toContain('幽灵登记')
  })

  it('G3 反例：理由写成 TODO / 太薄 ⇒ 判红（防空格把缺口洗成"已登记"）', () => {
    const thin = baseRepo({ registry: '- **覆盖地板**：1\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| other-gate.mjs | TODO |\n' })
    expect(thin.res.rows.find((r) => r.id === 'G3').pass).toBe(false)
  })

  it('G4 反例：地板写高于实际覆盖 ⇒ 判红（棘轮不许靠改数字变绿，改数字要改的是代码）', () => {
    const high = baseRepo({ registry: '- **覆盖地板**：99\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |\n' })
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
      registry: '- **覆盖地板**：1\n\n## 已知缺口\n\n| 脚本 | 理由 |\n| --- | --- |\n| other-gate.mjs | 不在 verify 链里，本轮先挂账待补夹具 |\n',
    })
    writeFileSync(join(added.dir, 'scripts', 'newcomer.mjs'), 'console.log("ok")\n')
    const row = evaluate(collect(added.dir)).rows.find((r) => r.id === 'G8')
    expect(row.pass).toBe(false)
    expect(row.detail).toContain('newcomer.mjs')

    // 对偶：把它具名豁免（带实测理由）⇒ 变绿，且必须登记在豁免表而不是缺口表
    const waived = baseRepo({
      pkg: { 'verify:newcomer': 'node scripts/newcomer.mjs' },
      registry: `- **覆盖地板**：1
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
describe('缺输入面探针：门禁类入口必须 fail-closed 且不崩栈', () => {
  const SHELL_RE = /^\s*(node:|file:\/\/|\s+at\s|SyntaxError|ReferenceError|TypeError|Error \[|MODULE_NOT_FOUND|ENOENT)/
  const dir = mkdtempSync(join(tmpdir(), 'smnoinput-'))
  tmpDirs.push(dir)
  cpSync(join(REPO, 'scripts'), join(dir, 'scripts'), { recursive: true })
  const gateClass = collectRegistered().filter((r) => isGateLike(r.sources))

  it('分母非零：门禁类入口由 package.json 结构枚举得出（不手抄）', () => {
    expect(gateClass.length).toBeGreaterThanOrEqual(20)
  })

  for (const r of gateClass) {
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
describe('零分母探针：输入面齐、内容全 0 字节时不得返回 0', () => {
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

  const gateClass = collectRegistered().filter((r) => isGateLike(r.sources))
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

  for (const r of gateClass) {
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

describe('真仓登记册与实测互洽（防文档自说自话）', () => {
  it('parseRegistry 读得到真登记册的两张表', () => {
    const md = readFileSync(join(REPO, REGISTRY), 'utf8')
    const d = parseRegistry(md)
    expect(d.floor).toBeGreaterThanOrEqual(PROBED.length)
    expect(d.gaps.length).toBeGreaterThan(0)
    expect(d.exemptions.length).toBeGreaterThan(0)
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
