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

/** 返回命中的风险标签（去重、排序）；空数组=该脚本可以被探针真跑。 */
export function classifyRisk(src) {
  const code = stripWholeLineComments(src)
  const out = []
  for (const [re, tag] of RISK_PATTERNS) if (re.test(code)) out.push(tag)
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


