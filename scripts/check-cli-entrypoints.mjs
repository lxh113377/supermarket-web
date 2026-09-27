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
import { requireInputs, requireJson, classifyRisk } from './lib/preflight.mjs'

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
 * 取数面 B：被测试当**子进程真跑过**的脚本 —— 文件里既有 spawn/exec 家族调用，
 * 又以字符串形式出现该脚本文件名（`join(REPO,'scripts','x.mjs')` 这种分片写法也算）。
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
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!SPAWN_RE.test(src)) continue
    // 允许 `'scripts/x.mjs'` / `'../scripts/x.mjs'` 这类带路径前缀的写法：只认裸文件名的话，
    // 真跑过它的夹具会被判成"没跑过"（本轮合成夹具首次落地时就踩到过，覆盖数凭空少一截）。
    for (const m of src.matchAll(/['"`][A-Za-z0-9._/\\-]*?([A-Za-z0-9._-]+\.mjs)['"`]/g)) {
      if (!covered.has(m[1])) covered.set(m[1], new Set())
      covered.get(m[1]).add(relative(dir, f).replace(/\\/g, '/'))
    }
  }
  return covered
}

/** 登记册解析：`- **覆盖地板**：N` + 三张表（已知缺口 / 不可子进程豁免 / 风险分类）的数据行。 */
export function parseRegistry(md) {
  const floorM = /覆盖地板\*{0,2}[：:]\s*(\d+)/.exec(md)
  const table = (heading) => {
    // 只取**本节**：按 `## ` 切节后取以该标题开头的那一段，到下一节为止。
    // 上一版取"该标题之后的全部内容"，前一张表把后一张表的行也吞了进来
    // ⇒ 三行豁免被当成「缺口∩豁免同一行挂两处」，G2 误报。
    const sec = md.split(/^##\s+/m).slice(1).find((s) => s.trimStart().startsWith(heading)) || ''
    const rows = []
    for (const line of sec.split(/\r?\n/)) {
      const cells = line.split('|').map((c) => c.trim())
      if (cells.length < 3 || !/^[A-Za-z0-9._-]+\.mjs$/.test(cells[1])) continue
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
    gaps: table('已知缺口'), exemptions: table('不可子进程豁免'), risk: riskRows,
  }
}

/** 门禁类入口：npm 别名形如 `verify:xxx` / `check:xxx`（裸 `verify` 是聚合命令，本身不是入口）。 */
export function isGateLike(sources) {
  return sources.some((s) => /^npm:(verify|check):/.test(s))
}

/**
 * **探针分母**（第三十轮）：门禁类全部 + 非门禁类里"源码推不出危险特征"的那部分。
 * 为什么由判据导出而不是测试里各写一遍：同一把尺量两处，改口径时只会有一处需要改；
 * 测试若自己复制条件，判据和夹具会在两次重构后悄悄量不同的东西（第二十七轮踩过同型坑）。
 * 危险项（`classifyRisk` 非空）永不自动 spawn —— 本轮实测它们里有"无 tty 也照删远端审计日志"的脚本。
 */
export function probeDenominator(dir = root) {
  const { registered, riskOf } = collect(dir)
  return registered.filter((r) => isGateLike(r.sources) || !(riskOf.get(r.script) || []).length)
}

/**
 * 纯判据。G1 分母 / G2 双向对账 / G3 理由非空 / G4 棘轮地板 / G5 hook 目标文件真实存在 + 生效前提 /
 * G6 本地钩子入口必须有夹具 / G7 判据自身入面 / G8 门禁类入口必须被真跑或具名豁免 /
 * G9 派生风险 ⇄ 登记册「风险分类」表双向对账。
 */
export function evaluate({ registered, covered, declared, floorOk, hookTargets, scriptFiles, docsRegisterHooksPath, selfRegistered, riskOf = new Map() }) {
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

  const bad = rows.filter((r) => !r.pass).length
  const probeable = registered.filter((r) => !(riskOf.get(r.script) || []).length)
  return { rows, summary: { matched: rows.length - bad, mismatched: bad, declared: rows.length, covered: coveredCount, uncovered: uncovered.length, risky: risky.length, probeable: probeable.length } }
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
  // 起服务 / 改写受控产物 / 直连线上 的脚本，自动探针**永不 spawn**它们。
  // 第三十轮的动因：上一轮探针分母只有门禁类，于是非门禁面的两个真缺陷（catalog-facts、
  // list-uncovered 缺输入时甩裸栈）藏到本轮才被同一个手法抓到；把分母扩到全登记面又必然
  // 撞上"根本不该自动跑"的脚本 ⇒ 那份名单不能手抄，只能从每个脚本自己的源码里读。
  const riskOf = new Map()
  for (const r of registered) {
    const abs = join(dir, 'scripts', r.script)
    riskOf.set(r.script, existsSync(abs) ? classifyRisk(readFileSync(abs, 'utf8')) : ['missing-file'])
  }
  return {
    registered, covered, declared, riskOf,
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
  console.log(`${ok ? 'GATE-PASS' : 'GATE-FAIL'} cli-entrypoints :: 入口 ${s.covered + s.uncovered} 个（子进程跑过 ${s.covered} / 缺口 ${s.uncovered}；可探针 ${s.probeable} / 带风险 ${s.risky}）｜检查 ${s.matched}/${s.declared} 通过，${s.mismatched} 失败`)
  return ok ? 0 : 1
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(main())
