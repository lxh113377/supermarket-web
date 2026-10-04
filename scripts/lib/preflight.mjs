// 缺输入面的统一收口（第二十五轮）。
//
// 动因是实测，不是假想：把 22 个"门禁类入口"（npm 别名 verify:*/check:*）逐条拷进一个
// **只有 scripts/ 的空目录**里跑，结果 8 个直接甩 ENOENT/MODULE_NOT_FOUND 栈、
// 1 个连 package.json 都没有却打印「0 个生产依赖（含传递）全部 MIT/BSD/Apache/ISC 类白名单 ✅」
// 然后 exit 0。前者把环境问题伪装成代码崩溃（CI 里没人能从 `node:fs:441` 读出该补什么），
// 后者把"什么都没扫到"读成"扫过且清白" —— 那正是本项目第十八~二十一轮"CI 全绿"假账的机制。
//
// 口径沿用本仓既有判据的文案（`[env-docs] 代码源目录缺失：functions/ —— 取不到真值集就不判"通过"`、
// `[doc-consistency] 环境不满足：…`），退出码取 2 = "环境不满足"，与 1 = "判出违规"分开。
import { existsSync, readFileSync } from 'node:fs'

/** 唯一的"环境不满足"出口：一条人话 + rc=2。第二十六轮把形状收成一个（见 R25-M4）。 */
export function bail(label, reason) {
  console.error(`[${label}] 环境不满足：${reason} ⇒ 没有对象就无法判"通过"，fail-closed 退出（rc=2）`)
  process.exit(2)
}

/**
 * @param {string} label 判据前缀。探针断言"输出首行是自家诊断而不是 node: 栈帧"，所以 label 必须真打印出来。
 * @param {string[]} paths 必须存在的路径（文件或目录），空值会被忽略以免把拼错的路径算成缺失。
 */
export function requireInputs(label, paths) {
  const missing = (paths || []).filter((p) => p && !existsSync(p))
  if (!missing.length) return
  bail(label, `取不到 ${missing.join(' , ')}`)
}

/** 缺必需参数（env / CLI flag）走同一条出口 —— 否则"缺输入"在日志里会有第二种长相。 */
export function requireParams(label, names) {
  const missing = (names || []).filter((n) => !String(process.env[n] || '').trim())
  if (!missing.length) return
  bail(label, `缺少参数 ${missing.join(' , ')}（由调用方显式给出，判据不猜默认值）`)
}

/**
 * 脚本"能不能被自动探针跑"由**源码特征**判，不由人记（第三十轮）。
 *
 * 为什么要这么切：第二十五轮的探针分母只有门禁类（`verify:*`/`check:*`），
 * 于是非门禁面的两个真缺陷藏到现在才被抓到（`check-catalog-facts`、`list-uncovered` 在缺输入时甩裸栈）。
 * 把分母扩到全部登记面就会撞上一堆"根本不该自动跑"的脚本（会写库 / 起服务 / 打线上），
 * 而那份"不该跑"的名单一旦手抄，就会随重构过期 —— 所以改成从每个脚本自己的源码里读风险特征。
 * 命中任一特征即**永不 spawn**；判据 G9 再核对"登记册里写的风险"与"这段源码推出来的风险"是否一致。
 */
export const RISK_PATTERNS = [
  [/\bwrangler\b/, 'wrangler', '要 Cloudflare 凭据并会操作远端 D1/Pages'],
  [/d1 execute/, 'd1-execute', '会直接改线上数据库'],
  [/\bDELETE FROM\b/, 'sql-delete', '语句里含删除动作，探针跑到就是真删'],
  [/createServer\s*\(|\.listen\s*\(/, 'http-server', '常驻 HTTP 服务，spawn 会挂到超时'],
  [/writeFileSync\([^)]*(?:docs|dist|api-contract|API\.md)/, 'writes-artifacts', '运行即改写受版本控制的产物'],
  [/\bfetch\s*\(|['"]curl['"]\s*,/, 'network-fetch', '直连线上端点（fetch 或 curl），本地探针只会测网络'],
  [/['"]gh['"]\s*[,.]/, 'gh-cli', '要 gh 鉴权与远端 API，探针跑它等于测 GitHub 可用性'],
  // 第六十七轮补：共享取数件 `scripts/lib/gh-cli.mjs` 把「定位并调用 gh」收进了一层间接，
  // 于是 `benchmark-peers.mjs` 里不再出现 `'gh',` 字面量 —— **风险是代码的属性，间接也是属性**。
  // 不补这一条的后果实测过：benchmark-peers 从派生风险名单里静默消失 ⇒ 自动探针会开始真跑它
  // ⇒ 而它每次跑都要打十几个远端 API 调用（等于拿探针测 GitHub 可用性，正是这条标签要防的）。
  // 所以凡是**调用/导入**这个取数件的，一律仍判 gh-cli：宁可多报，不可漏报。
  [/\brunGh\s*\(|\bgh-cli\.mjs['"]/, 'gh-cli', '经共享取数件调用 gh CLI（间接也算：风险跟着行为走，不跟着字面量走）'],
]

/**
 * 只删**整行注释**（行首为双斜线、或注释块的首尾记号/星号，且该行无代码）。
 * 为什么必须删：本仓的门禁会在注释里解释这套风险词表，于是 `check-cli-entrypoints.mjs`
 * 自己的注释命中了 wrangler / d1 execute / DELETE FROM ⇒ 被推成"永不自动跑"。风险是**代码的属性**，
 * 不是散文的属性。为什么只删整行、不删行尾注释：后者要靠真正的词法分析才不会把
 * `execFileSync('gh', ...)` 截掉（那会把危险读成安全 = 错方向）。宁可多报，不可漏报。
 */
function stripWholeLineComments(src) {
  return String(src).split(/\r?\n/).filter((l) => !/^\s*(?:\/\/|\/\*|\*\/|\*)/.test(l)).join('\n')
}

/**
 * `writeFileSync(<标识符>, ...)` 的目标解析（第四十二轮，R42-H2）。
 *
 * 一手漏报：`check-d1-roundtrips.mjs:401` 运行即改写受版本控制的登记册，但写的是
 * `writeFileSync(WRITE_QUOTA_FILE, …)` —— 路径在常量右侧，而 `RISK_PATTERNS` 那条要求字面路径出现在
 * 调用括号内，于是风险表上它是"零风险"。分母当场数得（本轮实测 `scripts/` 44 个 .mjs）：
 * 标识符形态 10 处（其中上轮 grep 口径的大写常量 5 处）、字面量形态 0 处 ⇒ 这一族不是假想，是这里的多数派。
 *
 * 口径（两态分开数，禁合并）：
 *  - `resolved` = 标识符在同文件有 `const/let/var NAME = …` 声明，且 RHS 命中产物路径词表 ⇒ 真危险；
 *  - `unbound`  = 目标由运行时决定：RHS 含 `process.argv/env`，**或该标识符根本没有同文件声明**
 *                 （函数形参、局部变量、跨文件 import、运行时拼出来的路径）⇒ 不算危险特征，但必须被数出来
 *                 并写进登记册（"看不见"≠"无风险"）；把它们并进危险集会反过来削掉探针分母（本轮实测：
 *                 `restore-drill.mjs` 的 4 个形参目标全被误判 ⇒ 覆盖退步，方向错）。
 *                 这一族的真解是**经验腿**（跑完核对工作树是否变脏），已记 R43-P0，不在本轮冒充。
 */
export const ARTIFACT_PATH_RE = /(?:docs|dist|api-contract|API\.md|\.ci\/contract\.json)/
// 第一个实参**整段**取出来再提标识符：本轮新增判据自己的写法是
// `writeFileSync(join(ROOT, REGISTRY), …)` —— 目标既不是裸标识符也不是字面量，
// 只认标识符形态会漏掉"表达式里指着产物常量"这一大类（R42-H2 的剩余半边）。
// 逗号不能当分隔符（`join(ROOT, REGISTRY)` 里就有逗号）⇒ 按括号深度扫到第一个**顶层**逗号为止。
const WRITE_OPEN_RE = /\bwriteFileSync\(\s*/g
const IDENT_RE = /\b([A-Za-z_$][\w$]*)\b/g

/** 从 `writeFileSync(` 之后取第一个实参的原文（配对到闭合或顶层逗号）。 */
export function firstArgOf(code, from) {
  let depth = 1
  let arg = ''
  for (let i = from; i < code.length; i++) {
    const c = code[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break }
    else if (c === ',' && depth === 1) break
    arg += c
  }
  return arg
}

export function scanArtifactWrites(src) {
  const code = stripWholeLineComments(src)
  const names = new Set()
  let literalHit = false
  for (const m of code.matchAll(WRITE_OPEN_RE)) {
    const arg = firstArgOf(code, m.index + m[0].length)
    if (ARTIFACT_PATH_RE.test(arg)) literalHit = true
    for (const x of arg.matchAll(IDENT_RE)) names.add(x[1])
  }
  const resolved = []
  const unbound = []
  if (literalHit) resolved.push('字面路径直接出现在调用第一实参里')
  for (const n of [...names].sort()) {
    const m = new RegExp(`\\b(?:const|let|var)\\s+${n.replace(/\$/g, '\\$')}\\s*=`).exec(code)
    if (!m) { unbound.push(`${n}(无同文件声明=形参/局部/import)`); continue }
    const eol = code.indexOf('\n', m.index)
    const rhs = code.slice(m.index + m[0].length, eol === -1 ? undefined : eol)
    if (ARTIFACT_PATH_RE.test(rhs)) { resolved.push(`${n}→${rhs.trim().slice(0, 60)}`); continue }
    if (/process\.(?:argv|env)/.test(rhs)) { unbound.push(`${n}(flag/env 注入)`); continue }
    unbound.push(`${n}(声明有、RHS 无产物词=${rhs.trim().slice(0, 40)})`)
  }
  return { names: [...names].sort(), resolved, unbound }
}

/** 返回命中的风险标签（去重、排序）；空数组=该脚本可以被探针真跑。 */
export function classifyRisk(src) {
  const code = stripWholeLineComments(src)
  const out = []
  for (const [re, tag] of RISK_PATTERNS) if (re.test(code)) out.push(tag)
  // 常量解引用腿：字面量那条扫不到的，按 RHS 现取；解不出静态产物路径的不算（见上"分母退步"实证）
  if (scanArtifactWrites(code).resolved.length) out.push('writes-artifacts')
  return [...new Set(out)].sort()
}

/** 风险标签的"为什么不该自动跑"，给登记册与报错文案用。 */
export const RISK_WHY = Object.fromEntries(RISK_PATTERNS.map(([, tag, why]) => [tag, why]))

/**
 * `@probe-safe` 声明（第三十二轮，借 `golang/go` 的 `-short` 口径：昂贵/危险测试由**被试对象自己**声明，
 * 框架只做机械核对，不维护中心名单）。见 testflag.go:67 `"tell long-running tests to shorten their run time"`。
 *
 * 为什么需要它：第三十一轮实测出"哪些危险项其实会在门口就停住"（6 条里 5 条非门禁项 rc=1/2、0–1s、
 * 不触碰外部世界），但这份判断若写死在判据或测试里，就又变成一份会过期的手抄名单。
 * ⇒ 让脚本自己在源码里带上**实测依据**，判据只核对"声明 ⇄ 登记册的说法 ⇄ 源码确有危险特征"三者是否一致。
 * 格式：`// @probe-safe: <一句话依据（必须含实测数字与日期）>`
 */
// 只认**独占一行**的行注释（第三十二轮实测：写在解释性文字里的 `@probe-safe: ...` 会被判据自己的
// 注释命中，于是这个文件被记成"带声明但无危险特征"的无效声明 —— 与第三十轮 classifyRisk 命中自己注释
// 是同一族，所以口径统一为"声明必须占一行"，正文里提它不算声明）。
export const PROBE_SAFE_RE = /^\s*\/\/\s*@probe-safe:\s*(.+)$/m

/** 返回声明依据文本；没有声明返回 null。 */
export function probeSafeEvidence(src) {
  const m = PROBE_SAFE_RE.exec(String(src))
  return m ? m[1].trim() : null
}


/**
 * JSON 输入必须**解析得动**才算"输入面存在"。第二十六轮零分母普查实测：损坏/0 字节的 package.json
 * 会让 Node 在解析任何仓库内模块前先崩在 `package_json_reader`（裸栈），判据的 fail-closed 文案根本没机会印；
 * 而"0 通过 / 0 失败"这类结论又是另一条路把空集读成绿。两种都要在门口拦住。
 */
export function requireJson(label, paths) {
  const broken = []
  for (const p of (paths || []).filter(Boolean)) {   // 刻意允许传 null："这一项本次不需要"（如 --write 时基准文件还没生成）
    if (!existsSync(p)) { broken.push(`${p}（不存在）`); continue }
    try {
      const t = readFileSync(p, 'utf8').trim()
      if (!t) { broken.push(`${p}（空文件）`); continue }
      JSON.parse(t)
    } catch { broken.push(`${p}（不是合法 JSON）`) }
  }
  if (!broken.length) return
  bail(label, `JSON 输入不可解析：${broken.join(' , ')}`)
}


