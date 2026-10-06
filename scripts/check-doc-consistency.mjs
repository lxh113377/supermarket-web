#!/usr/bin/env node
/**
 * 文档事实一致性门禁（第八轮 H2）
 *
 * 起因：本仓 README 出现三处手写数字与真相源脱钩，且**同一文件内部自相矛盾**——
 *   - `README.md` 徽章 `tests-176 passed`（真值数百，同文件另一行写 631）
 *   - `README.md` / `docs/ARCHITECTURE.md` 写 `/web 管理 30 action`
 *     （生成物 `docs/api-contract.json` 实测 31）
 * 这类缺陷不是"没人写文档"，是**写了却没有任何东西守着它**。对标侧的现成解法：
 * microfeed 把 `yarn docs:check` 做成 CI step。本脚本即本仓的对应物。
 *
 * 铁律（写死在实现里，勿改）：
 * 1. 期望值一律由**真相源当场算出**，脚本内不得再抄一份常量（否则脚本自己变成第二个真相源）。
 * 2. 只断言**可静态派生**的事实。跑起来才知道的数字（如用例总数）不在本门禁范围内 ——
 *    给它写个"看起来能算"的近似计数器，就是造一台会误报的机器。
 * 3. 真相源读不到 = exit 2 显式报环境缺失，**禁止**静默跳过记 PASS。
 *
 * 退出码：0=通过 / 1=判据红 / 2=环境不满足
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { bail, requireJson } from './lib/preflight.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const problems = []
const ok = []

const rel = (p) => p.replace(/\\/g, '/')
/** 相对仓库根的 POSIX 风格路径，用于报错定位 */
const at = (file, line) => `${file}:${line}`

function lineOf(text, needle) {
  const i = text.indexOf(needle)
  return i < 0 ? 0 : text.slice(0, i).split('\n').length
}

/** 声明值 == 真相源值，逐条登记 */
function expectEq(label, doc, file, declared, actual) {
  if (declared === null || declared === undefined) {
    problems.push(`${label}：文档 ${file} 里找不到该表述（口径变更须同步文档，别让它静默消失）`)
    return
  }
  if (String(declared) !== String(actual)) {
    problems.push(`${label}：${at(file, lineOf(doc, declared.toString()))} 写的是 ${declared}，真相源实测 ${actual}`)
  } else {
    ok.push(`${label} = ${actual}`)
  }
}

// ── 真相源 1：API 契约生成物（action 数量） ─────────────────────────────
requireJson('doc-consistency', [join(ROOT, 'docs/api-contract.json')])
const contract = JSON.parse(read('docs/api-contract.json'))
const actionCount = (endpoint) => {
  const actions = contract.endpoints?.[endpoint]?.actions
  if (!actions) return null
  return Array.isArray(actions) ? actions.length : Object.keys(actions).length
}
const webActions = actionCount('/web')
const pubActions = actionCount('/pub')
if (webActions === null || pubActions === null) {
  bail('doc-consistency', '契约里读不到 /web 或 /pub 的 actions 集合')
}

// ── 真相源 2：vitest 覆盖率棘轮（阈值） ────────────────────────────────
const viteConfig = read('vite.config.js')
const thresholdBlock = /thresholds:\s*\{([\s\S]*?)\}/.exec(viteConfig)
if (!thresholdBlock) {
  console.error('[doc-consistency] 环境不满足：vite.config.js 里找不到 thresholds 块')
  process.exit(2)
}
const thresholds = {}
for (const m of thresholdBlock[1].matchAll(/(statements|branches|functions|lines):\s*(\d+)/g)) {
  thresholds[m[1]] = Number(m[2])
}
const thresholdText = ['statements', 'branches', 'functions', 'lines'].map((k) => thresholds[k]).join('/')

// ── 真相源 3：单测文件数（口径 = vitest 的 exclude 语义，见 vite.config.js:36） ──
const EXCLUDED_DIRS = ['tests/e2e', 'tests/e2e-visual', 'tests/e2e-stub']
const isUnitTest = (name) => /\.test\.(ts|tsx|js|jsx)$/.test(name)
function countUnitTests(dir) {
  let n = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const relPath = rel(relative(ROOT, full))
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.includes(relPath)) continue
      n += countUnitTests(full)
    } else if (isUnitTest(entry.name)) n += 1
  }
  return n
}
const unitFiles = countUnitTests(join(ROOT, 'tests'))

// ── 断言 A：两份文档的 action 计数必须等于契约 ─────────────────────────
for (const file of ['README.md', 'docs/ARCHITECTURE.md']) {
  const doc = read(file)
  const web = /(?:管理|`\/web`[^0-9]*?管理)\s*(\d+)\s*action/.exec(doc)?.[1]
  const pub = /公开\s*(\d+)\s*action/.exec(doc)?.[1]
  expectEq('/web action 数', doc, file, web ? Number(web) : null, webActions)
  expectEq('/pub action 数', doc, file, pub ? Number(pub) : null, pubActions)
}

// ── 断言 B：README 的阈值表述与单测文件数 ──────────────────────────────
const readme = read('README.md')
expectEq(
  '覆盖率棘轮阈值',
  readme,
  'README.md',
  /阈值\s*(\d+\/\d+\/\d+\/\d+)/.exec(readme)?.[1] ?? null,
  thresholdText,
)
expectEq(
  '单测文件数',
  readme,
  'README.md',
  /(\d+)\s*文件/.exec(readme)?.[1] ?? null,
  unitFiles,
)

// ── 断言 C：禁"手写死数字"的静态徽章（本类缺陷的成因） ─────────────────
// CI 状态徽章走 GitHub 实时端点（README 已有），任何 *数字* 徽章都是第二真相源。
const deadBadge = /img\.shields\.io\/badge\/[a-z]+-[^-]*?(\d[\d,%20]*?)[a-z]*-/i.exec(readme)
if (deadBadge) {
  problems.push(
    `静态数字徽章：${at('README.md', lineOf(readme, deadBadge[0]))} ` +
    `「${deadBadge[0]}」写死了数字 —— 要么改用实时端点徽章，要么删掉（本门禁不接受把数字改对后留着它）`,
  )
} else {
  ok.push('无手写死数字徽章')
}

// ── 断言 D：文档里被引用的路径必须真实存在（R-CURRENT：文档写了 ≠ 磁盘有） ──
for (const file of ['README.md', 'docs/ARCHITECTURE.md']) {
  const doc = read(file)
  const dir = dirname(join(ROOT, file))
  for (const m of doc.matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = join(dir, decodeURIComponent(m[1]))
    if (!existsSync(target)) {
      problems.push(`死链：${at(file, lineOf(doc, m[0]))} 指向不存在的 ${m[1]}`)
    }
  }
}

// ── 断言 E：权威文档 `HANDOFF.md` 的单测文件数与实测戳（第六十八轮）──────────
// 为什么不把 'HANDOFF.md' 直接塞进上面 A/B/D 的循环：`expectEq` 在**句式匹配不到时 also 判红**
// （口径变更须同步文档），而 HANDOFF 没有「管理 N action」这种句式 ⇒ 追加进循环 = 立刻假红。
// 所以这里按"哪个文件含哪条事实"逐条挂，不按"整份文件进整盘面"。
// 一手实况（本轮盘面）：HANDOFF 一个文件里同时写着 `132/132`、`63 文件 631 用例`、`18 文件 126 用例`
// 三个互相矛盾的单测数，而 `AGENTS.md` 把它列为权威文档 #2 —— 文件内部自相矛盾正是本脚本立项的缺陷类。
const HANDOFF = 'HANDOFF.md'
if (existsSync(join(ROOT, HANDOFF))) {
  const doc = read(HANDOFF)
  // 只认**单测口径**的「N 文件」：窗口回看 34 个字符内必须出现 vitest/单测。
  // 不加这层限定的第一轮就把 `### 2026-08-08 全量上线` 里那句「41 文件 TS 迁移」（历史事实）
  // 也判成了当前单测数 —— 门禁拒真话、放行自相矛盾的写法，那就是判据缺陷（本轮实拍）。
  const unitWindow = 34
  const hits = [...doc.matchAll(/(\d+)\s*文件/g)]
    .filter((m) => /vitest|单测/i.test(doc.slice(Math.max(0, m.index - unitWindow), m.index)))
  if (!hits.length) {
    problems.push(`单测文件数（交接文档）：${HANDOFF} 里找不到 vitest/单测口径的「N 文件」表述 ⇒ 交接件不再对账，等于放开手写`)
  } else {
    let mismatched = 0
    for (const m of hits) {
      if (Number(m[1]) !== unitFiles) {
        mismatched += 1
        problems.push(`单测文件数（交接文档）：${at(HANDOFF, lineOf(doc, m[0]))} 写的是 ${m[1]}，真相源实测 ${unitFiles}`)
      }
    }
    if (!mismatched) ok.push(`单测文件数（交接文档）= ${unitFiles}（${hits.length} 处 vitest 口径逐一相等；历史口径句按 vitest/单测 上下文筛除）`)
  }
  // E2：实测戳龄期。交接文档一旦不写"什么时候核过"，读者就只能凭它当下的口气决定信多少。
  // 阈值 45 天是拍的（> 本仓"对标轮"节奏的两倍），所以必须连复算命令一起印出来，方便被反驳。
  const stamp = /最后实测验证[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(doc)
  if (!stamp) {
    problems.push(`实测戳：${HANDOFF} 里没有「最后实测验证：YYYY-MM-DD」戳 ⇒ 交接件的新旧无法机器判，只能靠人记`)
  } else {
    const t = Date.parse(`${stamp[1]}T00:00:00Z`)
    if (!Number.isFinite(t)) {
      problems.push(`实测戳：${HANDOFF} 的日期解不出来（${stamp[1]}）⇒ 按不通过处理，不折算成"很新"`)
    } else {
      const ageDays = Math.floor((Date.now() - t) / 86400_000)
      const maxAge = 45
      if (ageDays > maxAge) {
        problems.push(`实测戳龄期：${HANDOFF} 的「最后实测验证」= ${stamp[1]}，距已 ${ageDays} 天（阈值 ${maxAge} 天）`
          + ` ⇒ 交接件比代码旧两轮以上。复算：node -e "console.log((Date.now()-Date.parse('${stamp[1]}T00:00:00Z'))/86400000|0)"`)
      } else {
        ok.push(`实测戳龄期 = ${ageDays} 天（阈值 ${maxAge} 天）`)
      }
    }
  }
} else {
  problems.push(`交接文档缺席：${HANDOFF} 不在盘面（本脚本的 E 组判据因此无对象可判，这不是"通过"）`)
}

if (problems.length) {
  console.error(`[doc-consistency] FAIL ${problems.length} 项：`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  修法：改文档追上真相源（禁改真相源凑绿，判据 vs 数据先修判据）')
  process.exit(1)
}
console.log(`[doc-consistency] OK ${ok.length} 项：${ok.join(' | ')}`)
console.log(`  真相源：契约 /web=${webActions} /pub=${pubActions}；阈值=${thresholdText}；单测文件=${unitFiles}`)
