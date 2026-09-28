// 对标第二十四轮（2026-09-27）：门禁的**入口通道**有没有被真跑过
//
// 一手动因（本轮实测，不是假想）：`scripts/ci-green-contract.mjs` 的 15 条夹具全 import 纯函数
// `verdictOf`，CLI 入口（stdin 读 ref 行 → 解析字段 → 判据 → exit code）一次都没被跑过。
// 于是 `fs.readFileSync(0)`（模块里没有 `fs` 这个标识符）抛出的 ReferenceError 被
// `catch { line = '' }` 吞成"git 没给 ref 行"，**整条输入通道静默失效**：实测推 feature-x
// 时闸门打印的是 branch=main。而这条闸正是上一轮为了"CI 全绿不能靠自觉"才立的。
//
// 所以本判据不问"你写了多少门禁"，只问：**这 33 个真被 `node scripts/X.mjs` 跑起来的入口，
// 有几个被测试当子进程真跑过（喂 stdin、断言退出码）？** 没跑过的入口 = 缺陷藏身处。
//
// 登记册：docs/cli-entrypoints.md（缺口表与实测未覆盖集合**双向对账**，防"文档自称已覆盖"）
// 取数面（结构性枚举，禁手抄清单）：package.json 的 scripts.* 值 + .githooks/* + .github/workflows/*.yml
// 覆盖面（同法枚举）：tests/** 里含 spawn 调用且引用该脚本文件名
// 用法：node scripts/check-cli-entrypoints.mjs        真仓全量校验
//       node scripts/check-cli-entrypoints.mjs --emit 打印当前缺口的表格骨架（带 TODO，见 TODO 即红）
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireInputs, requireJson, classifyRisk, probeSafeEvidence } from './lib/preflight.mjs'
import { reasonDefects } from './lib/registry-reason.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
export const REGISTRY = 'docs/cli-entrypoints.md'
export const SELF = 'scripts/check-cli-entrypoints.mjs'
requireInputs('cli-entrypoints', [join(root, 'package.json'), join(root, 'scripts'), join(root, 'tests'), join(root, REGISTRY)])
requireJson('cli-entrypoints', [join(root, 'package.json')])
const SPAWN_RE = /\b(spawnSync|spawn|execFileSync|execSync|fork)\s*\(/

/** 枚举某个目录下的文件（只一层够用：workflows / .githooks 都不递归）。 */
function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => {
    const st = statSync(join(dir, f))
    return st.isFile()
  })
}

/**
 * 取数面 A：被**登记为可执行**的脚本 —— 也就是"人或 CI 真会敲的那条命令"。
 * 三个来源分别标注，便于归因（npm:xxx / hook:xxx / ci:xxx）。
 */
export function collectRegistered(dir = root) {
  const map = new Map()
  const add = (script, source) => {
    if (!map.has(script)) map.set(script, new Set())
    map.get(script).add(source)
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    for (const m of String(cmd).matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) add(m[1], `npm:${name}`)
  }
  for (const h of listFiles(join(dir, '.githooks'))) {
    const src = readFileSync(join(dir, '.githooks', h), 'utf8')
    for (const m of src.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) add(m[1], `hook:${h}`)
  }
  for (const w of listFiles(join(dir, '.github', 'workflows'))) {
    const src = readFileSync(join(dir, '.github', 'workflows', w), 'utf8')
    for (const m of src.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) add(m[1], `ci:${w}`)
  }
  return [...map.entries()].map(([script, sources]) => ({ script, sources: [...sources].sort() }))
    .sort((a, b) => a.script.localeCompare(b.script))
}

/**
 * 取数面 A′（第四十六轮，G13 的对象）：别名里引用了 `scripts/` 下**非 .mjs** 的文件。
 * 一手分母（本轮实测）：`grep -o "scripts/[A-Za-z0-9._-]*\.[a-z]*" package.json` 去重后只有 **1** 条不属于 `.mjs`
 * —— `npm run verify:images` → `python scripts/verify_images.py`；而 `collectRegistered` 的正则只收 `.mjs`，
 * 于是这条门禁别名**既不在登记面、也不在缺口面、也不在 CI**（`.github/workflows/*` 里 grep `verify:images` = 0 处）。
 * 更关键的是它**不能**被简单放进来：实测 `node scripts/verify_images.py` 得 `ERR_UNKNOWN_FILE_EXTENSION` 裸栈
 * ⇒ 一旦进 node 探针面，②③ 腿会把"解释器不对"读成"入口不 fail-closed"，那是判据在说谎。
 */
export function collectNonNode(dir = root) {
  const out = new Map()
  let pkg
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { return [] }
  for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
    for (const m of String(cmd).matchAll(/scripts\/([A-Za-z0-9._-]+\.(?:cjs|js|ts|py|sh))\b/g)) {
      if (!out.has(m[1])) out.set(m[1], { file: m[1], cmd: String(cmd).trim(), aliases: [] })
      out.get(m[1]).aliases.push(name)
    }
  }
  return [...out.values()].sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * 括号配对扫描（第三十一轮，H1 的地基）：只认**代码里**的 `()` / `[]`，字符串与注释里的括号一概不算。
 * 刻意不做完整词法分析（正则字面量等边角不管）：失配的后果是"某对括号没被配对"⇒ 那个范围不算数 ⇒
 * 覆盖面**少记**而不是多记。这个方向是安全的：少记会让判据来问"这条到底跑没跑"，
 * 多记会让假绿永久存续（本轮要治的正是后者）。
 *
 * **第四十四轮一手修复（这条腿此前从来没生效过）**：字符串态一律用**名字**（sq/dq/tpl）存，
 * 旧写法把**引号字符本身**赋给 state，而下面的分支判的是 `'sq' | 'dq' | 'tpl'` ⇒ 两边永不相等，
 * 于是字符串内容根本没被跳过：串里的括号照计数、串里的 `//` 当行注释、**串里的 `/*` 当块注释**。
 * 一手事故面：`tests/docCommands.test.js:96` 的理由串里有 `.github/workflows/*`，那个 `/*` 把该行之后
 * 整段吞成注释 ⇒ `spawnSync(` 的括号配不上对 ⇒ 覆盖采集少记一个入口，`verify:entrypoints` 的 G2/G8
 * 于是把**已经有子进程真跑夹具**的 `check-doc-commands.mjs` 报成"未登记缺口"。
 * 修法只统一状态名，不动"宁少记不多记"的方向。
 */
export function scanBrackets(src) {
  const QUOTE_STATE = { "'": 'sq', '"': 'dq', '`': 'tpl' }
  const parens = []
  const brackets = []
  const stack = []
  let state = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const d = src[i + 1]
    if (state === 'line') { if (c === '\n') state = null; continue }
    if (state === 'block') { if (c === '*' && d === '/') { i++; state = null }; continue }
    if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (c === '\\') { i++; continue }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = null
      continue
    }
    if (c === '/' && d === '/') { state = 'line'; i++; continue }
    if (c === '/' && d === '*') { state = 'block'; i++; continue }
    if (QUOTE_STATE[c]) { state = QUOTE_STATE[c]; continue }
    if (c === '(' || c === '[') { stack.push([c, i]); continue }
    if (c === ')' || c === ']') {
      const want = c === ')' ? '(' : '['
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k][0] === want) {
          const pair = stack.splice(k, 1)[0]
          ;(c === ')' ? parens : brackets).push([pair[1], i])
          break
        }
      }
      continue
    }
  }
  return { parens, brackets }
}

const inRange = (ranges, at) => ranges.some(([a, b]) => at > a && at < b)

/**
 * 取数面 B：被测试当**子进程真跑过**的脚本。
 *
 * 第三十一轮把口径收紧（台账 #1 坐实的假覆盖）：上一版只要"文件里有 spawn + 出现过这个文件名"就记账，
 * 于是 `expect(... === 'dangerous.mjs').toBe(false)` 这种**只在否定断言里提到名字**的写法也会把它读成
 * "已覆盖"（合成仓实测复现：覆盖面凭空多出 dangerous.mjs，真仓 24 条里掺了水）。现在名字必须**沿调用链
 * 到达执行点**，四种合法形态（不要求人额外登记任何东西）：
 * ① 直接写在 spawn/exec 家族的实参里；
 * ② 写在数组字面量里（本仓 `const PROBED = [...]` + `for (const s of PROBED) probe(s)` 的约定）；
 * ③ 写在 `const X = join(...,'x.mjs')` 这类**同一行**的声明里，且 `X` 被喂进了①/④那类调用；
 * ④ 写在**本地 runner** 的实参里 —— runner = "函数体内确实有 spawn"的自定义封装（`runGate(DOCS, dir)`）。
 *    补④的原因：收紧后第一轮实测有真夹具走封装被误判未覆盖 ⇒ 加的是"一跳封装"的通用判据，不是给名字开洞。
 * 反例照样被排除：`toContain('x.mjs')`、`expect(x === 'x.mjs')` 的被调方是断言方法，不在执行点集合里。
 * 只做 import 的（`import { evaluate } from '../scripts/x.mjs'`）不算覆盖：那测不到入口。
 */
export function collectCovered(dir = root) {
  const testDir = join(dir, 'tests')
  const covered = new Map()
  const files = []
  if (!existsSync(testDir)) return covered
  ;(function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.m?[jt]sx?$/.test(e)) files.push(p)
    }
  })(testDir)
  const SPAWN_FNS = new Set(['spawnSync', 'spawn', 'execFileSync', 'execSync', 'fork'])
  const CALLEE_RE = /([A-Za-z0-9_$]+)\s*\($/
  const DEF_RE = /\b(?:function\s+([A-Za-z0-9_$]+)\s*\(|const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*[\s(])/g
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!SPAWN_RE.test(src)) continue
    const { parens, brackets } = scanBrackets(src)
    // 每个左括号 → 紧邻其前的被调方名（取不到就当链式/匿名，不计入执行点：宁少记不多记）
    const calleeAt = new Map()
    for (const [open] of parens) {
      const m = CALLEE_RE.exec(src.slice(Math.max(0, open - 60), open + 1))
      calleeAt.set(open, m ? m[1] : '')
    }
    // runner = 函数体里确实有 spawn 的本地封装（`runGate(DOCS, dir)` 这种）。体的边界按
    // "到下一个顶层定义为止"近似 —— 失配的后果是少认一个 runner ⇒ 少记覆盖，方向安全。
    const defs = [...src.matchAll(DEF_RE)].map((m) => ({ name: m[1] || m[2], at: m.index }))
    const runners = new Set(defs.filter((d, i) => {
      const end = i + 1 < defs.length ? defs[i + 1].at : src.length
      return SPAWN_RE.test(src.slice(d.at, end))
    }).map((d) => d.name))
    const execRanges = parens.filter(([open]) => {
      const c = calleeAt.get(open)
      return SPAWN_FNS.has(c) || runners.has(c)
    })
    const execText = execRanges.map(([a, b]) => src.slice(a, b + 1)).join('\n')
    // ② 的可信版本：数组字面量只有**真的被喂进执行点**才算覆盖清单。判据＝该数组绑定的名字出现在执行点
    // 文本里，或它是 `for (const it of ARR)` 的数据源且 `it` 出现在执行点里（本仓 PROBED 就是这一形）。
    // 没有这一步，`const IGNORED = ['some-gate.mjs']` 就能凭空给一道门禁记上"已跑过"。
    const reachNames = new Set()
    for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s+of\s+([A-Za-z0-9_$]+)\s*\)/g)) {
      const [, it, arr] = m
      if (new RegExp(`\\b${it}\\b`).test(execText)) reachNames.add(arr)
    }
    const arrayRanges = brackets.filter(([a]) => {
      const decl = /\s*=\s*$/.exec(src.slice(Math.max(0, a - 60), a))
      if (!decl) return inRange(execRanges, a)          // 直接写在执行点里的数组（如 argv）
      const head = src.slice(0, a - decl[0].length)
      const nm = /(?:const|let|var)\s+([A-Za-z0-9_$]+)$/.exec(head.trimEnd())
      if (!nm) return inRange(execRanges, a)
      // 只问"这个名字有没有到达执行点"——不许把名字边遍历边塞进可达集再拿来自查（那是一条恒真条件）
      return new RegExp(`\\b${nm[1]}\\b`).test(execText) || reachNames.has(nm[1])
    })
    // ③ 用：收集"声明在同一行、且该变量被喂进了执行点"的行区间
    const declLines = []
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g)) {
      const ident = m[1]
      if (!new RegExp(`\\b${ident.replace(/\$/g, '\\$')}\\b`).test(execText)) continue
      const ls = src.lastIndexOf('\n', m.index) + 1
      const le = src.indexOf('\n', m.index)
      declLines.push([ls, le === -1 ? src.length : le])
    }
    const rel = relative(dir, f).replace(/\\/g, '/')
    // 允许 `'scripts/x.mjs'` / `'../scripts/x.mjs'` 这类带路径前缀的写法：只认裸文件名的话，
    // 真跑过它的夹具会被判成"没跑过"（第二十四轮合成夹具首次落地时就踩到过，覆盖数凭空少一截）。
    for (const m of src.matchAll(/['"`][A-Za-z0-9._/\\-]*?([A-Za-z0-9._-]+\.mjs)['"`]/g)) {
      const at = m.index
      const ok = inRange(execRanges, at) || inRange(arrayRanges, at) || declLines.some(([a, b]) => at >= a && at <= b)
      if (!ok) continue
      if (!covered.has(m[1])) covered.set(m[1], new Set())
      covered.get(m[1]).add(rel)
    }
  }
  return covered
}

/** 登记册解析：`- **覆盖地板**：N` + 三张表（已知缺口 / 不可子进程豁免 / 风险分类）的数据行。 */
export function parseRegistry(md) {
  const floorM = /覆盖地板\*{0,2}[：:]\s*(\d+)/.exec(md)
  const denomM = /分母地板\*{0,2}[：:]\s*(\d+)/.exec(md)
  const table = (heading) => {
    // 只取**本节**：按 `## ` 切节后取以该标题开头的那一段，到下一节为止。
    // 上一版取"该标题之后的全部内容"，前一张表把后一张表的行也吞了进来
    // ⇒ 三行豁免被当成「缺口∩豁免同一行挂两处」，G2 误报。
    const sec = md.split(/^##\s+/m).slice(1).find((s) => s.trimStart().startsWith(heading)) || ''
    const rows = []
    for (const line of sec.split(/\r?\n/)) {
      const cells = line.split('|').map((c) => c.trim())
      // 行名允许非 .mjs 扩展名（第四十六轮）：`## 非 node 入口` 那张表就是要记 `.py` 这类真入口；
      // 旧写法只收 `\.mjs$` ⇒ 越盲区时连"把漏的东西登记下来"这条路都是堵的。
      if (cells.length < 3 || !/^[A-Za-z0-9._-]+\.(?:mjs|cjs|js|ts|py|sh)$/.test(cells[1])) continue
      // 第四列（若有）= 实测依据。风险分类表用它承载"为什么探针不能跑它"的数值证据。
      rows.push({ script: cells[1], reason: cells[2], note: cells.slice(3).join(' | ').trim() })
    }
    return rows
  }
  const riskRows = table('风险分类').map((r) => ({
    script: r.script,
    tags: r.reason.split(/[,，]/).map((t) => t.trim()).filter(Boolean).sort(),
    note: r.note,
  }))
  return {
    floor: floorM ? Number(floorM[1]) : null, declaredFloor: !!floorM,
    denomFloor: denomM ? Number(denomM[1]) : null, declaredDenomFloor: !!denomM,
    gaps: table('已知缺口'), exemptions: table('不可子进程豁免'), risk: riskRows,
    nonNode: table('非 node 入口'),
  }
}

/** 读"跑出来的副作用登记册"：entries[].writes 非空 => 该脚本实测会改写受控产物。 */
export function empiricalWriters(dir = root) {
  const p = join(dir, 'docs', 'judge-side-effects.json')
  const map = []
  if (!existsSync(p)) return { ok: false, map }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    for (const e of j.entries || []) if ((e.writes || []).length) map.push([String(e.file).replace(/^scripts\//, ''), e.writes])
    return { ok: true, map }
  } catch { return { ok: false, map } }
}

/** 门禁类入口：npm 别名形如 `verify:xxx` / `check:xxx`（裸 `verify` 是聚合命令，本身不是入口）。 */
export function isGateLike(sources) {
  return sources.some((s) => /^npm:(verify|check):/.test(s))
}

/**
 * 能不能被自动探针 spawn：门禁类全部可以（它们本来就必须在 CI/本地跑），非门禁类要满足
 * "源码推不出危险特征" **或** 自带 `@probe-safe` 实测声明（第三十二轮，口径借 `golang/go` 的 `-short`
 * ：昂贵/危险测试由被试对象自述、框架只机械核对，不维护中心名单）。判据只写这一处。
 */
const isProbeable = (r, riskOf, safeOf = new Map()) =>
  isGateLike(r.sources) || !(riskOf.get(r.script) || []).length || safeOf.has(r.script)

/**
 * **探针分母**（第三十轮立，第三十二轮扩）：门禁类全部 + 非门禁类里"源码推不出危险特征"
 * 或"自带 `@probe-safe` 实测声明"的那部分。
 * 为什么由判据导出而不是测试里各写一遍：同一把尺量两处，改口径时只会有一处需要改；
 * 测试若自己复制条件，判据和夹具会在两次重构后悄悄量不同的东西（第二十七轮踩过同型坑）。
 * 无声明的危险项仍永不自动 spawn —— 实测它们里有"无 tty 也照删远端审计日志"的脚本与"一起服务就挂死"的脚本。
 */
export function probeDenominator(dir = root) {
  const { registered, riskOf, safeOf } = collect(dir)
  return registered.filter((r) => isProbeable(r, riskOf, safeOf))
}

/**
 * 纯判据。G1 分母 / G2 双向对账 / G3 理由非空 / G4 棘轮地板 / G5 hook 目标文件真实存在 + 生效前提 /
 * G6 本地钩子入口必须有夹具 / G7 判据自身入面 / G8 门禁类入口必须被真跑或具名豁免 /
 * G9 派生风险 ⇄ 登记册「风险分类」表双向对账。
 */
export function evaluate({ registered, covered, declared, floorOk, hookTargets, scriptFiles, docsRegisterHooksPath, selfRegistered, riskOf = new Map(), safeOf = new Map(), nonNode = [] }) {
  const rows = []
  const uncovered = registered.filter((r) => !covered.has(r.script))
  // 登记面 = 缺口表 ∪ 豁免表（两张表都参与对账，但一行只准挂一处）：
  // 缺口 =「该补夹具、本轮没补」；豁免 =「结构上 spawn 不了，理由要能审计」。
  const declaredSet = new Set([...declared.gaps, ...declared.exemptions].map((g) => g.script))
  const doubleBooked = declared.gaps.filter((g) => declared.exemptions.some((e) => e.script === g.script))
  const uncoveredSet = new Set(uncovered.map((r) => r.script))

  rows.push({
    id: 'G1',
    pass: registered.length > 0,
    detail: `登记面 ${registered.length} 个可执行入口（零输入不得 PASS：枚举面空了说明取数面本身坏了）`,
  })

  const phantom = [...declaredSet].filter((s) => !uncoveredSet.has(s))
  const undeclared = [...uncoveredSet].filter((s) => !declaredSet.has(s))
  rows.push({
    id: 'G2',
    pass: phantom.length === 0 && undeclared.length === 0 && doubleBooked.length === 0,
    detail: `缺口∪豁免 ⇄ 实测未覆盖 双向对账：登记 ${declaredSet.size} / 实测 ${uncoveredSet.size}` +
      (phantom.length ? `；幽灵登记（已覆盖或不存在却还挂着）: ${phantom.join(', ')}` : '') +
      (undeclared.length ? `；未登记缺口: ${undeclared.join(', ')}` : '') +
      (doubleBooked.length ? `；一行挂两处（缺口∩豁免）: ${doubleBooked.map((g) => g.script).join(', ')}` : ''),
  })

  const thin = [...declared.gaps, ...declared.exemptions].filter((g) => g.reason.replace(/TODO.*/i, '').trim().length < 8)
  rows.push({
    id: 'G3',
    pass: thin.length === 0,
    detail: thin.length ? `缺口/豁免理由过薄或含 TODO: ${thin.map((g) => g.script).join(', ')}`
      : `${declared.gaps.length} 条缺口 + ${declared.exemptions.length} 条豁免都带可审计理由`,
  })

  const coveredCount = registered.filter((r) => covered.has(r.script)).length
  const headroom = coveredCount - (declared.floor || 0)
  rows.push({
    id: 'G4',
    pass: floorOk && declared.floor !== null && coveredCount >= declared.floor,
    detail: floorOk ? `子进程覆盖 ${coveredCount} ${headroom >= 0 ? `>= 地板 ${declared.floor}（headroom +${headroom}）` : `< 地板 ${declared.floor}（**退步 ${-headroom} 条夹具被删**）`}`
      : '登记册缺「覆盖地板」行 ⇒ 棘轮无基准',
  })

  const missingTargets = hookTargets.filter((t) => !scriptFiles.includes(t.script))
  rows.push({
    id: 'G5',
    pass: missingTargets.length === 0 && docsRegisterHooksPath,
    detail: (missingTargets.length ? `hook 调了不存在的脚本: ${missingTargets.map((t) => `${t.hook}->${t.script}`).join(', ')}` : 'hook 目标脚本全部在册') +
      ' / ' + (docsRegisterHooksPath ? '生效前提（core.hooksPath）已在文档登记' : '文档未登记 core.hooksPath 生效前提 ⇒ 新克隆静默无门禁'),
  })

  // G6 本地钩子入口必须有夹具。为什么单独一道：`.githooks/*` 调的脚本 **CI 根本不跑**（pre-push 只在
  // 推的人那台机器上活着），所以"CI 里真跑过"这条减轻因素对它不成立 —— 本轮那个静默失效的闸正是它。
  // （第一版这里定成"夹具引用了不存在的脚本名 ⇒ 判红"，被自己的合成夹具当场误报：植入名既不在登记面、
  // 也不参与任何计数，判它红是过度严格。改判成有牙齿且零误报的这一条。）
  const unprobedHooks = hookTargets.filter((t) => !covered.has(t.script))
  rows.push({
    id: 'G6',
    pass: hookTargets.length > 0 && unprobedHooks.length === 0,
    detail: unprobedHooks.length ? `本地钩子入口没有子进程夹具（CI 不跑它，崩了没人知道）: ${unprobedHooks.map((t) => `${t.hook}->${t.script}`).join(', ')}`
      : `${new Set(hookTargets.map((t) => `${t.hook}:${t.script}`)).size} 个钩子入口全部有夹具`,
  })

  rows.push({
    id: 'G7',
    pass: selfRegistered && covered.has(SELF.split('/').pop()),
    detail: selfRegistered
      ? (covered.has(SELF.split('/').pop()) ? '本判据自己也在登记面且被子进程跑过（不吃豁免）' : '本判据登记在册却**没有**子进程夹具 —— 入口纪律对自己同样生效')
      : `本判据未接入 npm/CI/hook 任一登记面 = 写了没人调的入口`,
  })

  // G8 是本判据的"牙齿"：门禁类入口（npm 别名 verify:*/check:*）按**结构枚举**得出，
  // 覆盖清单按测试文件里的字面量枚举得出 —— 两者相减就是"新加了一道门禁却没人真跑过它的入口"。
  // 这条正是第二十四轮 ci-green-contract 那个缺陷的类级修法：不指望人记得，只让漏登当场变红。
  const gateClass = registered.filter((r) => isGateLike(r.sources))
  const exempt = new Set(declared.exemptions.map((e) => e.script))
  const gateUnprobed = gateClass.filter((r) => !covered.has(r.script) && !exempt.has(r.script))
  const phantomExempt = [...exempt].filter((s) => covered.has(s) || !gateClass.some((r) => r.script === s))
  rows.push({
    id: 'G8',
    pass: gateClass.length > 0 && gateUnprobed.length === 0 && phantomExempt.length === 0,
    detail: `门禁类入口 ${gateClass.length} 个：子进程真跑 ${gateClass.filter((r) => covered.has(r.script)).length} 个` +
      (gateUnprobed.length ? `；未跑过且未豁免: ${gateUnprobed.map((r) => r.script).join(', ')}` : '') +
      (phantomExempt.length ? `；幽灵豁免（其实已覆盖/根本不是门禁类）: ${phantomExempt.join(', ')}` : ''),
  })

  // G9：「哪些入口自动探针绝不能 spawn」这份名单**不手抄**，由每个脚本自己的源码特征推导
  // （`preflight.classifyRisk`），再与登记册的「风险分类」表逐条对账，三个方向都要红：
  //   漏登（源码里有 DELETE/网络/起服务，表里没这行）／幽灵（表里挂着但源码已改干净）／
  //   标签不符（写了 wrangler 其实还带 sql-delete）／依据过薄（没有实测数值）。
  // 为什么值得单独立一道：第二十九轮的探针分母只有门禁类，非门禁面的裸栈一直藏到本轮；
  // 而把分母直接扩到全登记面就会撞上"真会删线上审计日志"的脚本（本轮实测：`purge-security-events`
  // 在无 tty 下照样把 DELETE 打到远端 D1）。名单一旦手抄就会随重构过期，那道"不该跑"的闸也就形同虚设。
  // 第四十三轮：静态推不出的产物写入（目标是 import 进来的常量、形参或 argv）由
  // `check-judge-side-effects.mjs` **跑出来**并登记；这里把实测面并进来，两类证据合成一份风险集。
  // 没有这份册（首轮/CI 干净检出）时按"没有额外证据"处理，且把缺口印在 G9 的 detail 里 ——
  // 不静默、也不虚报成"核过"。
  const empirical = empiricalWriters()
  for (const [script, paths] of empirical.map) {
    const cur = riskOf.get(script) || []
    if (!cur.includes('writes-artifacts')) riskOf.set(script, [...cur, 'writes-artifacts'].sort())
    void paths
  }
  const risky = registered.filter((r) => {
    const t = riskOf.get(r.script) || []
    return t.length && !t.includes('missing-file')
  })
  // 登记面引用了不存在的脚本 = 另一件事，不能要求它去风险表里挂一行（那是一道**满足不了**的闸：
  // 'missing-file' 不是合法标签，人只能改别名或补文件）⇒ 单列一条红因，措辞直说该做什么。
  const dangling = registered.filter((r) => (riskOf.get(r.script) || []).includes('missing-file')).map((r) => r.script)
  const riskRowOf = new Map(declared.risk.map((r) => [r.script, r]))
  const riskMissing = risky.filter((r) => !riskRowOf.has(r.script)).map((r) => r.script)
  const riskPhantom = declared.risk.filter((r) => !(riskOf.get(r.script) || []).length).map((r) => r.script)
  const riskMismatch = risky.filter((r) => {
    const row = riskRowOf.get(r.script)
    return row && row.tags.join(',') !== (riskOf.get(r.script) || []).join(',')
  }).map((r) => `${r.script}(派生 ${(riskOf.get(r.script) || []).join('+')} / 登记 ${riskRowOf.get(r.script).tags.join('+')})`)
  const riskThin = risky.filter((r) => {
    const row = riskRowOf.get(r.script)
    return !!row && String(row.note).replace(/TODO.*/i, '').trim().length < 8
  }).map((r) => r.script)
  rows.push({
    id: 'G9',
    pass: dangling.length === 0 && riskMissing.length === 0 && riskPhantom.length === 0 && riskMismatch.length === 0 && riskThin.length === 0,
    detail: `派生风险 ${risky.length} 条 ⇄ 登记 ${declared.risk.length} 条` +
      (dangling.length ? `；登记面引用了不存在的脚本（改别名或补文件，别挂风险行）: ${dangling.join(', ')}` : '') +
      (riskMissing.length ? `；漏登（源码里有危险特征却没进表）: ${riskMissing.join(', ')}` : '') +
      (riskPhantom.length ? `；幽灵（表里挂着但源码已无该特征/脚本不存在）: ${riskPhantom.join(', ')}` : '') +
      (riskMismatch.length ? `；标签不符: ${riskMismatch.join(' , ')}` : '') +
      (riskThin.length ? `；缺实测依据（第四列为空或含 TODO）: ${riskThin.join(', ')}` : ''),
  })

  // G10 分母自身要是有棘轮，否则"把尺子缩短"这件事没有任何后果：有人把某个 npm 别名从 `verify:` 改名成
  // `report:`（而脚本里正好有 fetch）⇒ 该项**静默离开探针分母**，覆盖数、缺口数一起变好看，CI 照样全绿。
  // 缺「分母地板」这行同样判红：不给"没有基准"留成空子（同 G4 的口径）。
  const denom = registered.filter((r) => isProbeable(r, riskOf, safeOf))
  rows.push({
    id: 'G10',
    pass: declared.denomFloor !== null && denom.length >= declared.denomFloor,
    detail: declared.denomFloor === null
      ? '登记册缺「分母地板」行 ⇒ 探针分母无基准（分母=可被自动 spawn 的入口数）'
      : `探针分母 ${denom.length} ${denom.length >= declared.denomFloor ? `>= 地板 ${declared.denomFloor}（headroom +${denom.length - declared.denomFloor}；其中靠 @probe-safe 声明进来的非门禁危险项 ${denom.filter((r) => !isGateLike(r.sources) && (riskOf.get(r.script) || []).length).length} 个）` : `< 地板 ${declared.denomFloor}（**分母被缩短 ${declared.denomFloor - denom.length} 项**：改别名或加危险特征都会走到这里）`}`,
  })

  // G12（第四十五轮，承 R41-H3「声明的面 ⇄ 喂进采集器的面是两处」这条同族欠账）：
  // 取数面 A 声明了三个来源（package.json 别名 / .githooks / .github/workflows），但 G1 只判"总数非零"
  // ⇒ 任一来源**静默归零**时登记面会悄悄缩短，而账面照样绿（第四十一轮的病：往根表加一项是 74→74 的空操作）。
  // 口径借本仓 `check-limit-provenance` 的 C7b：声明了却零贡献的来源必须点名，二选一——修取数，或删声明。
  const famOf = (s) => (String(s).startsWith('npm:') ? 'npm' : String(s).startsWith('hook:') ? 'hook' : String(s).startsWith('ci:') ? 'ci' : null)
  const byFam = { npm: new Set(), hook: new Set(), ci: new Set() }
  for (const r of registered) for (const s of r.sources) { const f = famOf(s); if (f) byFam[f].add(r.script) }
  const emptyFam = Object.entries(byFam).filter(([, v]) => v.size === 0).map(([k]) => k)
  rows.push({
    id: 'G12',
    pass: emptyFam.length === 0,
    detail: `取数面逐来源非空：npm 别名 ${byFam.npm.size}／.githooks ${byFam.hook.size}／workflows ${byFam.ci.size}（三者可重叠，故和 ≠ 总数 ${registered.length}）`
      + (emptyFam.length ? `；**声明了却零贡献的来源**: ${emptyFam.join(', ')} ⇒ 要么取数面坏了（目录改名 / 不再直调 scripts），要么把这条来源从声明里删掉，不许留着当"已覆盖"` : ''),
  })
  // G11（第三十二轮）：`@probe-safe` 是**脚本自己**说"我会在触碰外部世界之前停住"，所以三件事必须同时对得上：
  //   a) 声明必须落在真有危险特征的脚本上（没特征还声明 = 无效声明，只会把口径搞浑）；
  //   b) 声明必须带实测数字（"应该没问题"不算依据；`golang/go` 的 `-short` 也是测试自己给条件）；
  //   c) 登记册风险表的"停在门口"说法 ⇄ 声明集合必须相等（表说了源码没说 = 幽灵；源码说了表没说 = 漏登）。
  // 真正的安全证明由测试腿执行：被解禁的项会进 ②③ 两法（缺输入面 + 零分母骨架），跑不出 fail-closed 就红。
  const markerNames = [...safeOf.keys()]
  const bogusMarker = markerNames.filter((s) => !(riskOf.get(s) || []).length || (riskOf.get(s) || []).includes('missing-file'))
  const thinMarker = markerNames.filter((s) => !/\d/.test(String(safeOf.get(s))))
  const claimedStopped = declared.risk.filter((row) => /已证明停在门口/.test(row.note)).map((row) => row.script)
  const claimNoMarker = claimedStopped.filter((s) => !markerNames.includes(s))
  // 非门禁项一旦被声明解禁，风险表就必须写"停在门口"（它是靠这句话进的分母，不能只存在于源码注释里）；
  // 门禁类本来就在 CI/本地必跑，声明只是给风险表背书 ⇒ 只作信息打印，不强判红。
  const srcOf = (s) => (registered.find((r) => r.script === s) || {}).sources || []
  const markerNoClaim = markerNames.filter((s) => !claimedStopped.includes(s) && !isGateLike(srcOf(s)))
  rows.push({
    id: 'G11',
    pass: bogusMarker.length === 0 && thinMarker.length === 0 && claimNoMarker.length === 0 && markerNoClaim.length === 0,
    detail: `@probe-safe 声明 ${markerNames.length} 条 ⇄ 风险表"停在门口" ${claimedStopped.length} 条` +
      (bogusMarker.length ? `；无效声明（源码其实没有危险特征，或脚本不存在）: ${bogusMarker.join(', ')}` : '') +
      (thinMarker.length ? `；声明没有实测数字（依据必须是量出来的）: ${thinMarker.length ? thinMarker.join(', ') : ''}` : '') +
      (claimNoMarker.length ? `；表里说停在门口但源码没声明: ${claimNoMarker.join(', ')}` : '') +
      (markerNoClaim.length ? `；已声明解禁但风险表未标"停在门口"（进了分母就必须在册可查）: ${markerNoClaim.join(', ')}` : '') +
      (markerNames.filter((s) => !claimedStopped.includes(s) && isGateLike(srcOf(s))).length
        ? `；[信息] 门禁类已声明、表未标（CI 必跑，不强制）: ${markerNames.filter((s) => !claimedStopped.includes(s) && isGateLike(srcOf(s))).join(', ')}` : ''),
  })

  // G13（第四十六轮）：别名里引用的**非 .mjs** 入口。取数面的正则是 `.mjs`，所以这类入口今天既不在登记面、
  // 也不在缺口面、也不在豁免面 —— 它是**结构性失踪**，不是"登记了但没夹具"。本轮一手分母：非 .mjs 只有 1 条
  // （`verify:images` → `python scripts/verify_images.py`），且 `.github/workflows/*` 里 grep 它为 0 处。
  // 也不许把它直接塞进 node 探针面：实测 `node scripts/verify_images.py` 得 `ERR_UNKNOWN_FILE_EXTENSION` 裸栈
  // ⇒ ②③ 腿会把"解释器不对"读成"入口不会 fail-closed"，那是判据在说谎。第一步先让它**可见**：
  // 要么在 `## 非 node 入口` 登记真实命令 + 可证伪理由，要么判红；等解释器分派的腿建好再谈进面（R47）。
  const nnReg = new Map((declared.nonNode || []).map((r) => [r.script, r]))
  const nnUnreg = nonNode.filter((e) => !nnReg.has(e.file))
  const nnThin = nonNode.filter((e) => nnReg.has(e.file) && reasonDefects(e.file, nnReg.get(e.file).reason).length)
  const nnGhost = [...nnReg.keys()].filter((f) => !nonNode.some((e) => e.file === f))
  rows.push({
    id: 'G13',
    pass: nnUnreg.length === 0 && nnThin.length === 0 && nnGhost.length === 0,
    detail: `别名引用的非 .mjs 入口 ${nonNode.length} 个 ⇄ 册上「非 node 入口」登记 ${nnReg.size} 个`
      + (nnUnreg.length ? `；**结构性失踪（取数面看不见，也没人登记）**: ${nnUnreg.map((e) => `${e.file}（别名 ${e.aliases.join('/')}｜真实命令 ${e.cmd}）`).join(' / ')}` : '')
      + (nnThin.length ? `；登记了但理由不可证伪: ${nnThin.map((e) => e.file).join(', ')}` : '')
      + (nnGhost.length ? `；幽灵（册上登记的文件已不被任何别名引用）: ${nnGhost.join(', ')}` : '')
      + (nonNode.length && !nnUnreg.length && !nnThin.length ? ' ⇒ 已登记为"探针不 spawn"，解释器分派的腿待 R47' : ''),
  })

  const bad = rows.filter((r) => !r.pass).length
  const probeable = registered.filter((r) => !(riskOf.get(r.script) || []).length)
  return { rows, summary: { matched: rows.length - bad, mismatched: bad, declared: rows.length, covered: coveredCount, uncovered: uncovered.length, risky: risky.length, probeable: probeable.length, denom: denom.length, nonNode: nonNode.length } }
}

export function collect(dir = root) {
  const registered = collectRegistered(dir)
  const covered = collectCovered(dir)
  const regPath = join(dir, REGISTRY)
  const md = existsSync(regPath) ? readFileSync(regPath, 'utf8') : ''
  const declared = parseRegistry(md)
  const hookTargets = []
  for (const h of listFiles(join(dir, '.githooks'))) {
    const src = readFileSync(join(dir, '.githooks', h), 'utf8')
    for (const m of src.matchAll(/scripts\/([A-Za-z0-9._-]+\.mjs)/g)) hookTargets.push({ hook: h, script: m[1] })
  }
  const docsRegisterHooksPath = ['CONTRIBUTING.md', 'README.md', 'docs/ci-triage-runbook.md']
    .some((f) => existsSync(join(dir, f)) && readFileSync(join(dir, f), 'utf8').includes('core.hooksPath'))
  const selfName = SELF.split('/').pop()
  // 风险由**源码特征**推导（见 preflight 的 classifyRisk）：命中 wrangler / d1 execute / DELETE FROM /
  // 起服务 / 改写受控产物 / 直连线上 的脚本，默认**不自动 spawn**。
  // 第三十轮的动因：上一轮探针分母只有门禁类，于是非门禁面的两个真缺陷（catalog-facts、
  // list-uncovered 缺输入时甩裸栈）藏到本轮才被同一个手法抓到；把分母扩到全登记面又必然
  // 撞上"根本不该自动跑"的脚本 ⇒ 那份名单不能手抄，只能从每个脚本自己的源码里读。
  // 第三十二轮再加一格：脚本可以**自述**"我会在门口就停住"（`@probe-safe: <实测依据>`），
  // 由 G11 核对声明 ⇄ 风险表说法 ⇄ 源码确有危险特征三者一致 —— 名单仍然不是人抄的。
  const riskOf = new Map()
  const safeOf = new Map()
  for (const r of registered) {
    const abs = join(dir, 'scripts', r.script)
    if (!existsSync(abs)) { riskOf.set(r.script, ['missing-file']); continue }
    const src = readFileSync(abs, 'utf8')
    riskOf.set(r.script, classifyRisk(src))
    const ev = probeSafeEvidence(src)
    if (ev) safeOf.set(r.script, ev)
  }
  return {
    registered, covered, declared, riskOf, safeOf, nonNode: collectNonNode(dir),
    floorOk: /覆盖地板/.test(md),
    hookTargets, scriptFiles: listFiles(join(dir, 'scripts')), docsRegisterHooksPath,
    selfRegistered: registered.some((r) => r.script === selfName),
  }
}

function emit() {
  const { registered, covered, riskOf } = collect()
  const rows = (list, hint) => {
    console.log('| 脚本 | ' + hint + ' |')
    console.log('| --- | --- |')
    for (const r of list) console.log(`| ${r.script} | TODO ${r.sources.join(', ')} |`)
  }
  console.log('\n## 已知缺口\n')
  rows(registered.filter((r) => !covered.has(r.script)), '为什么还没有子进程夹具')
  console.log('\n## 不可子进程豁免\n')
  rows(registered.filter((r) => isGateLike(r.sources) && !covered.has(r.script)), '为什么不能 spawn（实测依据：耗时/网络/产物依赖/会写库）')
  console.log('\n## 风险分类（自动探针不得 spawn；标签由 classifyRisk 从源码推导）\n')
  console.log('| 脚本 | 风险特征 | 为什么不能自动 spawn + 实测依据 |')
  console.log('| --- | --- | --- |')
  for (const r of registered) {
    const tags = riskOf.get(r.script) || []
    if (tags.length) console.log(`| ${r.script} | ${tags.join(', ')} | TODO 实测依据 |`)
  }
}

export function main() {
  if (process.argv.includes('--emit')) { emit(); return 0 }
  const res = evaluate(collect())
  for (const r of res.rows) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} :: ${r.detail}`)
  const s = res.summary
  // 门面行必须带 matched/mismatched/声明数三者（"判据回状态词 ≠ 覆盖过了"）
  const ok = s.mismatched === 0 && s.matched + s.mismatched === s.declared
  console.log(`${ok ? 'GATE-PASS' : 'GATE-FAIL'} cli-entrypoints :: 入口 ${s.covered + s.uncovered} 个（子进程跑过 ${s.covered} / 缺口 ${s.uncovered}；探针分母 ${s.denom} / 无风险 ${s.probeable} / 带风险 ${s.risky}；别名里的非 node 入口 ${s.nonNode}）｜检查 ${s.matched}/${s.declared} 通过，${s.mismatched} 失败`)
  return ok ? 0 : 1
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(main())
