// 对标第十七轮（2026-09-27）：上限溯源 —— 代码里每个数值上限必须能追到一个真实约束，
// 否则它就是"某个人当时拍的民俗数字"，而民俗数字会在平台收紧或数据增长时静默变成缺陷。
//
// 一手动因（本轮实测）：`batchUpdateProducts` 与 `batchDeleteProducts` 挂着**同一个 200**，
// 但两者的预算完全不同：删除件 2026-09-18 已把语句数压成常数（受 SQLite 999 绑定参数约束，200 ⇒ 400 参数，安全）；
// 更新件仍是 1 + n 条语句（第十四轮实测斜率），n=200 ⇒ 201 条，而 D1 官方 limits 页写
// "Queries per Worker invocation … 1000 (Workers Paid) / **50 (Free)**" ⇒ 免费档下选满 200 个商品必在半途抛错。
// 同一个数字、两种命运，且**没有任何一处写着它是从哪来的**。
//
// 登记册：docs/limit-provenance.md（形态沿用 docs/env-vars.md + check-env-docs.mjs 的双向对账先例）
// 用法：--emit 打印缺登记行的骨架（带 TODO，判据见 TODO 即红 ⇒ 不许用自动生成冒充已论证）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { requireInputs } from './lib/preflight.mjs'

const require = createRequire(import.meta.url)

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const REGISTRY = 'docs/limit-provenance.md'

// 缺输入面先收口，且必须排在 require('@babel/parser') **之前**：在没有 node_modules 的目录里跑，
// 原来第一行输出是 MODULE_NOT_FOUND 的裸栈（第二十五轮实测的 8 个崩栈门禁之一）。
requireInputs('limit-provenance', [join(root, 'node_modules/@babel/parser'), join(root, 'functions'), join(root, 'src'), join(root, REGISTRY)])
const { parse } = require('@babel/parser')

/** 平台侧真实约束（必须带可核对来源与取证日期；判据 C5 拿它做 ≤ 对账）。 */
export const PLATFORM_FACTS = {
  d1_statement_bytes: { max: 100_000, unit: 'bytes/语句', src: 'developers.cloudflare.com/d1/platform/limits（2026-04-21 更新页）」maximum SQL statement length 100 KB' },
  d1_queries_per_invocation_free: { max: 50, unit: '查询/调用', src: '同上页「Queries per Worker invocation — 1000 (Workers Paid) / 50 (Free)」' },
  d1_queries_per_invocation_paid: { max: 1000, unit: '查询/调用', src: '同上页' },
  d1_batch_wallclock_ms: { max: 30_000, unit: 'ms/整批', src: '同上页脚注「Requests to Cloudflare API must resolve in 30 seconds … applies to the entire batch call」' },
  sqlite_bound_params: { max: 999, unit: '绑定参数/语句', src: 'SQLite 官方 SQLITE_MAX_VARIABLE_NUMBER（旧默认 999；本仓 products.js:156 注释早已引它）' },
  // 第四十一轮补：此前只登记「每次调用」两把尺（字节/条数），**每日**配额在册 0 条 ——
  // 而它自 2026-09-01 起会让超限查询直接失败，属「不登记就永远没人看」那一类。
  d1_rows_written_free_per_day: { max: 100_000, unit: '行写入/日', src: 'cloudflare/cloudflare-docs src/content/partials/workers/d1-pricing.mdx:8「Rows written | 100,000 / day」+ 定义 :18 + 00:00 UTC 重置 :24 + 强制执行 changelog/d1/2026-09-01-d1-free-tier-limit-enforcement.mdx:9「will fail」（@2026-09-28T01:41:11Z gh api 现取）' },
  d1_rows_read_free_per_day: { max: 5_000_000, unit: '行读取/日', src: '同上文件 :7「Rows read | 5 million / day」；:17 说明它按**扫描行**计（全表扫 5000 行就计 5000）⇒ 未建索引的列过滤会虚高' },
}

/** 六类"会砍东西"的数值形态 —— 判据的分母由这六个形状定义，不靠人记。
 *  拒绝型额外捕获比较符：光看值不足以判"这是不是一条上限"（>0 是空判定，>200 才是）。 */
export const SHAPES = {
  // 拒绝型：只认"数字字面量"的右值。第三十六轮实测：面内 `.length` 比较共 27 处走这条，
  // 另有 **8 处右值是大写常量名**（SPEC_OPTION_LIMIT / MAX_REVIEW_IMAGES / BATCH_UPDATE_MAX /
  // BATCH_DELETE_MAX / PAGE_SIZE / BATCH）——它们在这把尺上**完全隐形**，且不在 `CONST_RE`
  // （不以 MAX|LIMIT|… 开头，`SPEC_` 不匹配）。⇒ 新增下面的「常量上限」形状把它们纳面，
  // 而不是把 8 处改写成字面量（那等于为了让尺子好看去改被测量）。
  拒绝型: /\.length\s*(<|>)=?\s*(\d+)/g,
  常量上限: /\.length\s*(<|>)=?\s*([A-Z][A-Z0-9_]{2,})\b/g,
  截断型: /\.slice\(\s*0\s*,\s*(\d+)\s*\)/g,
  // 与上面「常量上限」同一族的另一半（第三十六轮同轮发现）：`.slice(0, SOME_CONST)` 在旧口径里
  // 同样隐形。实测面内 3 处 / 2 个 (文件,常量) 组合：ProductInlineEditForm 的 FLAVOR_MAX_LEN
  // 与 ReviewForm 的 MAX_REVIEW_IMAGES×2 —— 后者对侧正是服务端字面量 3，
  // 即"前端常量、后端数字"这种两侧异名同值的写法，本来一点都扫不到。
  截断上限: /\.slice\(\s*0\s*,\s*([A-Z][A-Z0-9_]{2,})\s*\)/g,
  体积型: /(\d+)\s*\*\s*1024/g,
  保留期: /'-(\d+) days'/g,
  分页: /\bLIMIT (\d+)/gi,
}
/**
 * 拒绝型的"空判定"排除表（第十八轮 M6 扩面时暴露的度量器缺陷）。
 * `x.length > 0` / `x.length < 1` 是**非空判断**，不是"会砍东西的上限"——
 * 它在 functions/ 里恰好一次都没出现（都写成 `!x.length`），所以前十七轮从未暴露；
 * 一进 src/ 就在 9 个文件里造出 12 行假上限。
 * 正解是修形状定义（下面这个集合），**不是**把阈值调大或给 src/ 开豁免：
 * 后者等于把"前端没人管"这件事重新藏回去。
 */
export const EMPTY_TEST = new Set(['>,0', '>=,1', '<,1', '<=,0'])
const CONST_RE = /^(MAX|MIN|LIMIT|TOP|TTL|BATCH|_MS$|DAYS|SIZE|WINDOW|RATE_|TIMEOUT)/

/**
 * 取数面（单点声明）：第十八轮 M6 起含前端。
 * 为什么必须单点：登记册头部那句"取数面只到 functions/**"是散在文档里的承诺，
 * 上一轮写在 docs 里、这一轮改代码时很容易只改一边 —— 于是"扩面"这件事没人知道，
 * 前端上限继续裸奔而门禁显示全绿。这里定义 + C7 回读 + 文档行三处必须一致，由 limitProvenance 夹具钉住。
 */
export const SURFACE_PREFIXES = ['functions/', 'src/']
/** 面内排除：d.ts 无可执行上限，纯类型声明。 */
const SURFACE_SKIP = /\.d\.ts$/
/**
 * 每个声明前缀各自的后缀集 —— 必须与前缀表一一对上（第四十一轮 C7b 钉这件事）。
 * 一手实测：把 'scripts/' 加进 SURFACE_PREFIXES 之后普查**一项没多**（74 项 → 74 项照样 PASS），
 * 因为采集器读的是 loadAll 里硬编码的 roots，而 C7 的 outsideLeak 又明确禁止 scripts 入面
 * ⇒「扩面」在旧结构下是一次看起来成功的空操作，还会被 C7 印成「面已含 scripts/」。
 * 现在：roots 由本表派生；前缀没登记后缀集=红、前缀一个上限项都没贡献=红（逐根各出一行分母）。
 * 另记一条口径决定：判据自己不入产品码普查面（SURFACE_NEVER 保住 C7 的既有教义），
 * 所以「43 个门禁脚本自己的数值」的正确落点不是扩这张面，而是判据侧的出处注释 +
 * docs/d1-write-quota.json 那类登记件（见 check-d1-roundtrips.mjs 的 A9/A10）。
 */
export const SURFACE_EXT = { 'functions/': ['.js'], 'src/': ['.ts', '.tsx'] }
/** 永不入面的面（判据/文档/测试/迁移件）：它们各有自己的登记件，不进产品码上限普查。 */
export const SURFACE_NEVER = ['scripts/', 'docs/', 'tests/', 'db/']

export function collectJs(dir, out = [], exts = ['.js']) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) collectJs(p, out, exts)
    else if (exts.some((x) => e.endsWith(x))) out.push(p)
  }
  return out.sort()
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const c of node) walk(c, visit); return }
  visit(node)
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue
    walk(v, visit)
  }
}

/** 第十八轮 M6：前端入面后必须能吃 TS/TSX；旧行为（只 module + 无插件）对 .ts 会直接抛。
 *  解析失败一律点名并判红，**禁止静默跳文件** —— 静默跳过等于把该类文件永远留在普查面外。 */
function parseFor(rel, code, onError) {
  const tsx = /\.tsx$/.test(rel)
  const ts = /\.tsx?$/.test(rel)
  try {
    return parse(code, {
      sourceType: 'module',
      ...(ts ? { plugins: tsx ? ['typescript', 'jsx'] : ['typescript'] } : tsx ? { plugins: ['jsx'] } : {}),
    })
  } catch (e) {
    onError(`${rel} 解析失败（${e.message.split('\n')[0]}）`)
    return null
  }
}

/** 收集注释区间（交给解析器判"哪里是注释"，不用朴素正则 —— 正则分不清 `//` 在字符串里还是注释里）。
 *  ⚠️ 本轮实跑踩过的坑：`onComment` 是 **acorn** 的选项，`@babel/parser` 不认；传了它不会报错，
 *  只会安静地一条注释都不给 ⇒ "精确遮蔽"退化成"什么都没剥"，phantom 项原封不动。
 *  babel 的取法是返回对象上的 `ast.comments`，所以读它、并断言拿到的确实是数组（拿不到就降级并点名）。 */
export function commentRanges(code, rel, onError) {
  const ranges = []
  try {
    const tsx = /\.tsx$/.test(rel)
    const ts = /\.tsx?$/.test(rel)
    const ast = parse(code, {
      sourceType: 'module',
      ...(ts ? { plugins: tsx ? ['typescript', 'jsx'] : ['typescript'] } : tsx ? { plugins: ['jsx'] } : {}),
    })
    const cs = ast.comments || (ast.program && ast.program.comments)
    if (!Array.isArray(cs)) {
      onError(`${rel} 解析器没给出注释数组（ast.comments 缺失）⇒ 降级为朴素剥除，行尾注释可能仍计入`)
      return null
    }
    for (const c of cs) ranges.push([c.start, c.end])
    return ranges
  } catch (e) {
    // 解析失败 ⇒ 退回"整行 + 块注释"的朴素剥除（本轮之前的行为），并**把降级说出来**：
    // 静默退回弱口径 = 该类文件的行尾注释悄悄留在面内，正是 C8 禁止的形态。
    onError(`${rel} 注释区间解析失败（${e.message.split(String.fromCharCode(10))[0]}）⇒ 降级为朴素剥除`)
    return null
  }
}

/** 用空格替换注释字节：长度与换行位置都不动 ⇒ 登记册/告警里的行号不会漂（R37 已经为漂行号改过一次）。 */
function maskRanges(code, ranges) {
  const out = []
  let cursor = 0
  for (const [s, e] of ranges.sort((a, b) => a[0] - b[0])) {
    if (s < cursor) continue
    out.push(code.slice(cursor, s))
    out.push(code.slice(s, e).replace(/[^\n]/g, ' '))
    cursor = e
  }
  out.push(code.slice(cursor))
  return out.join('')
}

/** 普查：返回 [{key, file, shape, value, line}]，key = `文件#类型#值`（同值同文件归一行，防噪）。 */
export function census(sources, onParseError = () => {}) {
  const hits = new Map()
  let masked = 0
  let degraded = 0
  for (const { rel, code } of sources) {
    // 取数面只算**代码里的数**。注释里的数字不算上限（第一版只剥整行注释 ⇒
    // 「远低于 SQLite 999 参数上限」这类解释性文字被当成上限，噪声到没人肯修）。
    // 第三十八轮补第二半：**行尾注释**按解析器区间精确剥除（朴素正则会把 `'https://x'` 里的 // 当注释）。
    const ranges = commentRanges(code, rel, onParseError)
    let body
    if (ranges) {
      const before = code
      body = maskRanges(before, ranges)
      if (body !== before) masked++
    } else {
      degraded++
      const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, (m) => String.fromCharCode(10).repeat(m.split(String.fromCharCode(10)).length - 1))
      body = noBlock.split(String.fromCharCode(10)).map((l) => (/^\s*(--|\/\/)/.test(l) ? '' : l)).join(String.fromCharCode(10))
    }
    body = body.split(String.fromCharCode(10)).map((l) => (/^\s*(--|\/\/)/.test(l) ? '' : l)).join(String.fromCharCode(10))
    for (const [shape, re] of Object.entries(SHAPES)) {
      for (const m of body.matchAll(re)) {
        // 「常量上限」的右值是一个标识符（值在常量定义处），其余形状取数字
        const value = NAME_VALUED_SHAPES.has(shape) ? m[m.length - 1] : Number(m[m.length - 1])
        if (shape === '拒绝型' && EMPTY_TEST.has(`${m[1]},${value}`)) continue
        const line = body.slice(0, m.index).split('\n').length
        const key = `${rel}#${shape}#${value}`
        if (!hits.has(key)) hits.set(key, { key, file: rel, shape, value, name: NAME_VALUED_SHAPES.has(shape) ? value : undefined, line })
      }
    }
    const ast = parseFor(rel, code, onParseError)
    if (ast) walk(ast, (n) => {
      if (n.type !== 'VariableDeclarator' || n.init?.type !== 'NumericLiteral') return
      const name = n.id?.name || ''
      if (!CONST_RE.test(name)) return
      const key = `${rel}#常量#${name}=${n.init.value}`
      if (!hits.has(key)) hits.set(key, { key, file: rel, shape: '常量', value: n.init.value, name, line: n.loc.start.line })
    })
  }
  if (masked || degraded) {
    // 摊开取数面的工作量：静默降级 = 那类文件的行尾注释仍留在面内而没人知道。
    // 走 stderr（stdout 是结论通道，不能被统计污染）。
    process.stderr.write('[limit-provenance] 注释遮蔽统计：剥到注释的文件 ' + masked + ' 个｜解析失败降级 ' + degraded
      + ' 个（降级即行尾注释仍可能计入，属未覆盖面）\n')
  }
  return [...hits.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** 登记册解析：只认 markdown 表格数据行，列序固定为 文件 | 类型 | 值 | 来源类别 | 依据
 *  取数面前缀由 SURFACE_PREFIXES 单点决定（第十八轮 M6 把 src/ 纳入），不在这里另写一遍。 */
export function parseRegistry(md) {
  const rows = []
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 5) continue
    if (!SURFACE_PREFIXES.some((p) => cells[0].startsWith(p))) continue
    rows.push({ file: cells[0].replace(/`/g, ''), shape: cells[1], value: cells[2], kind: cells[3], basis: cells[4] })
  }
  return rows
}

export const NAME_VALUED_SHAPES = new Set(['常量上限', '截断上限'])

export const ALLOWED_KINDS = new Set(['platform', 'schema', 'product', 'perf', 'self'])

/**
 * C9 图片入口的**服务端条数 cap**（第三十五轮；由台账 A-08 的一手缺陷立出来）。
 * 规则：凡调用 `validateImages(...)` 的函数，函数体内必须同时存在一条**条数**拒绝
 * （`.length > N` / `>= N`，或直接返回 `too_many_images`）。
 * 一手动因：普查 4 个出口里只有 `addReview` 有 cap（>3），`createSubmission` 与
 * `createProduct`/`updateProduct` 三处只查 scheme 与单张体积 ⇒ "最多 5 张"只活在
 * `ServiceFormPage.tsx` 的拒绝分支里，直接 POST 可塞任意多张。
 * **按函数核、不按文件核**：products.js 有两个出口，只给一个加 cap 时按文件的判据会绿，
 * 而漏掉的那个正是同一条攻击路径（同一 action 族走哪个出口都能把图册塞满）。
 */
export function imageCapGaps(sources) {
  const gaps = []
  for (const { rel, code } of sources || []) {
    if (!code.includes('validateImages(')) continue
    const ast = parseFor(rel, code, () => {})
    if (!ast) { gaps.push(`${rel}：解析失败 ⇒ 无法判定条数 cap（不得当作有 cap）`); continue }
    const fns = []
    const calls = []
    walk(ast, (n) => {
      if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
        if (typeof n.start === 'number' && typeof n.end === 'number') fns.push(n)
      }
      if (n.type === 'CallExpression' && n.callee?.name === 'validateImages' && typeof n.start === 'number') {
        const arg = n.arguments?.[0]
        // 被校验对象的**源码文本**就是要核的对象（`clean.images` / `data.images`）。
        // 只认"路径完全相同"的比较，是为了不放过这一手：首版我写成通用的
        // /\.length\s*>\s*\d+/，于是同一函数里的**单张体积** cap（`img.length > 2 * 1024 * 1024`）
        // 被当成条数 cap，摘掉真正的条数判断后 C9 仍然绿 —— 反例当场证伪了首版判据。
        calls.push({ at: n.start, target: arg && typeof arg.start === 'number' ? code.slice(arg.start, arg.end).trim() : null })
      }
    })
    for (const { at, target } of calls) {
      const owner = fns.filter((f) => f.start <= at && at < f.end).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
      if (!owner) { gaps.push(`${rel}：validateImages 调用落在任何函数体外 ⇒ 判据无法归属，按缺失处理`); continue }
      const name = owner.id?.name || '(匿名)'
      const body = code.slice(owner.start, owner.end)
      const line = code.slice(0, at).split('\n').length
      if (!target) {
        if (!/too_many_images/.test(body)) gaps.push(`${rel}:${line} 函数 ${name} 的 validateImages 实参不可解析且无 too_many_images ⇒ 无法证明有条数 cap`)
        continue
      }
      const esc = target.replace(/[.*+?^${}()|[\]\\]/g, String.fromCharCode(92) + '$&')
      const countCap = new RegExp(esc + '\\.length\\s*(?:>|>=)\\s*\\d+(?!\\s*\\*)')
      const constCap = new RegExp(esc + '\\.length\\s*(?:>|>=)\\s*[A-Za-z_$]')
      if (!countCap.test(body) && !(constCap.test(body) && /too_many_images/.test(body))) {
        gaps.push(`${rel}:${line} 函数 ${name} 收图片却无 ${target}.length 的条数 cap`)
      }
    }
  }
  return gaps.sort()
}

/** 判据核心（纯函数，喂任意输入即可反证；同第十四/十五轮口径）。 */
export function evaluate({ items, rows, planRegistered, parseErrors, sources }) {
  const out = []
  const push = (id, cond, label, detail) => out.push({ id, ok: Boolean(cond), label, detail })
  const keyOf = (r) => `${r.file}#${r.shape}#${r.value}`
  const byKey = new Map(rows.map((r) => [keyOf(r), r]))

  push('C1', items.length > 0 && rows.length > 0, 'C1 普查面与登记册均非空',
    `普查 ${items.length} 项｜登记 ${rows.length} 行`)

  const missing = items.filter((i) => !byKey.has(i.key))
  push('C2', missing.length === 0, 'C2 每个上限都有登记行',
    missing.length ? `缺登记 ${missing.length} 项: ${missing.slice(0, 6).map((m) => m.key).join(', ')}${missing.length > 6 ? ' …' : ''}` : `${items.length} 项全覆盖`)

  const badKind = rows.filter((r) => !ALLOWED_KINDS.has(r.kind))
  push('C3', badKind.length === 0, 'C3 来源类别合法（platform|schema|product|perf|self）',
    badKind.length ? `非法类别: ${[...new Set(badKind.map((b) => `${b.file}:${b.kind}`))].join(', ')}` : `${rows.length} 行类别全部在册`)
  const thin = rows.filter((r) => ALLOWED_KINDS.has(r.kind) && (r.basis || '').replace(/TODO.*/i, '').trim().length < 14)
  push('C3b', thin.length === 0, 'C3b 每行依据不得是占位（≥14 字且非 TODO）',
    thin.length ? `空泛/TODO ${thin.length} 行: ${thin.slice(0, 4).map((t) => `${t.file}#${t.value}`).join(', ')}` : '无 TODO 占位')

  const dead = rows.filter((r) => !items.some((i) => i.key === keyOf(r)))
  push('C4', dead.length === 0, 'C4 登记册无死行（源码已无该上限）',
    dead.length ? `死行: ${dead.slice(0, 5).map((d) => keyOf(d)).join(', ')}` : `${rows.length} 行全部对得上现状`)

  // C5：声称受平台约束的行，必须点名是哪个事实，且值不得超过该事实
  const bad = []
  for (const r of rows.filter((x) => x.kind === 'platform')) {
    const fact = /\b([a-z_]+(?:_free|_paid|_ms|_bytes|_params|_invocation)?)\b/.exec(r.basis)
    const known = Object.keys(PLATFORM_FACTS).find((k) => r.basis.includes(k))
    if (!known) { bad.push(`${keyOf(r)} 写了 platform 却没引用 PLATFORM_FACTS 里的名字`); continue }
    const num = Number(String(r.value).replace(/[^\d]/g, ''))
    if (!Number.isFinite(num)) continue
    if (num > PLATFORM_FACTS[known].max) bad.push(`${keyOf(r)} 值 ${num} 超过 ${known} 上限 ${PLATFORM_FACTS[known].max}（${PLATFORM_FACTS[known].unit}）`)
    if (fact && fact[1] === known) continue
  }
  push('C5', bad.length === 0, 'C5 平台耦合值不得超过所引事实',
    bad.length ? bad.join('；') : `${rows.filter((x) => x.kind === 'platform').length} 行 platform 类均在预算内`)

  // C6：档位假设必须登记（Free 50 / Paid 1000 差 20 倍，不登记就没法判"这个值到底安不安全"）
  const needsPlan = rows.some((r) => /d1_queries_per_invocation/.test(r.basis))
  if (needsPlan) {
    push('C6', Boolean(planRegistered), 'C6 Workers 档位已登记（决定 50 还是 1000 预算）',
      planRegistered ? '档位=' + planRegistered
        : '登记册引用了 d1_queries_per_invocation_*，但 docs/env-vars.md 没有 WORKERS_PLAN 行 => 预算取哪个数无人能说清')
  }

  // C7：取数面自证。旧写法只 filter(/check-limit-provenance/)，而判据住在 scripts/ 下、
  //      根本不可能进面 ⇒ 那条断言**永远为真**（空转判据）。第十八轮改成：
  //      ① 面内文件的每一行都必须落在声明的前缀里；② scripts//docs/ 一件都不许漏进来；
  //      ③ 正向对照：面非空且含 src/ 文件（否则"扩了面"这件事没人能证）。
  const leaked = items.filter((i) => !SURFACE_PREFIXES.some((p) => i.file.startsWith(p)))
  const outsideLeak = items.filter((i) => /^(scripts|docs|tests|db)\//.test(i.file))
  const hasSrc = items.some((i) => i.file.startsWith('src/'))
  // C7b（第四十一轮）：把「声明了面」与「面真的在贡献东西」分成两件事判。
  const noExts = SURFACE_PREFIXES.filter((p) => !(p in SURFACE_EXT) || !SURFACE_EXT[p].length)
  const extraExts = Object.keys(SURFACE_EXT).filter((p) => !SURFACE_PREFIXES.includes(p))
  const silent = SURFACE_PREFIXES.filter((p) => !items.some((i) => i.file.startsWith(p)))
  const neverIn = SURFACE_NEVER.filter((p) => SURFACE_PREFIXES.includes(p))
  push('C7b', !noExts.length && !extraExts.length && !silent.length && !neverIn.length,
    'C7b 取数面单一来源 + 逐根有产出（前缀⇄后缀集双向、空根即红、判据面永不入面）',
    (!noExts.length && !extraExts.length && !silent.length && !neverIn.length)
      ? SURFACE_PREFIXES.map((p) => `${p} 后缀=${SURFACE_EXT[p].join('+')} 实贡献 ${items.filter((i) => i.file.startsWith(p)).length} 项`).join(' ｜ ')
      : `缺后缀集 [${noExts.join(',')}]；多写后缀集 [${extraExts.join(',')}]；声明了却零贡献的空根 [${silent.join(',')}]；把判据面拉进来了 [${neverIn.join(',')}] —— 空根不是「没有上限」，是这根没被量`)
  push('C7', leaked.length === 0 && outsideLeak.length === 0 && hasSrc,
    'C7 取数面自证（前缀内 + 判据/文档不入面 + src/ 真在里面）',
    leaked.length || outsideLeak.length
      ? `越面: ${[...new Set([...leaked, ...outsideLeak].map((l) => l.file))].slice(0, 5).join(', ')}`
      : `取数面 = ${SURFACE_PREFIXES.join(' + ')}（src/ 命中 ${items.filter((i) => i.file.startsWith('src/')).length} 项），判据与登记册在面外`)

  // C8（新增）：解析失败不许静默跳文件 —— 静默跳过等于把该类文件永久留在面外，
  //      而这正是"看起来全绿其实没测"的形态（R236：命令跑失败输出空被当成通过）。
  push('C8', (parseErrors || []).length === 0, 'C8 面内文件零静默跳过（解析失败即点名）',
    parseErrors && parseErrors.length ? `解析失败 ${parseErrors.length} 个: ${parseErrors.slice(0, 4).join(' | ')}` : `${(sources || []).length} 个文件全部解析成功`)

  // C9（第三十五轮）：图片出口的**条数** cap 必须与服务端同在 —— 见 imageCapGaps 的动因注释。
  const capGaps = imageCapGaps(sources)
  push('C9', capGaps.length === 0,
    'C9 收图片的函数必须有服务端条数 cap（"≤N 张"不得只活在前端）',
    capGaps.length ? `缺 cap: ${capGaps.slice(0, 6).join(' ; ')}`
      : `validateImages 出口 ${(sources || []).filter((s) => s.code.includes('validateImages(')).length} 个文件全部带条数 cap`)
  return out
}

export function loadAll() {
  const parseErrors = []
  const roots = SURFACE_PREFIXES.map((p) => [p.replace(/\/$/, ''), SURFACE_EXT[p] || []])
  const sources = []
  for (const [dir, exts] of roots) {
    for (const f of collectJs(join(root, dir), [], exts)) {
      const rel = relative(root, f).split(String.fromCharCode(92)).join('/')
      if (SURFACE_SKIP.test(rel)) continue
      sources.push({ rel, code: readFileSync(f, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)) })
    }
  }
  const items = census(sources, (msg) => parseErrors.push(msg))
  let rows = []
  try { rows = parseRegistry(readFileSync(join(root, REGISTRY), 'utf8')) } catch { rows = [] }
  let planRegistered = ''
  try {
    // 档位登记在 limits 册自己那节里，不放 docs/env-vars.md：
    // env 登记册是「代码引用 ⇄ 文档」双向对账的（verify:env），代码不读的运营事实塞进去必被判多行。
    const doc = readFileSync(join(root, REGISTRY), 'utf8')
    const row = doc.split(String.fromCharCode(10)).find((l) => /当前档位登记/.test(l)) || ''
    if (/paid/i.test(row)) planRegistered = 'Paid(1000)'
    else if (/free/i.test(row)) planRegistered = 'Free(50)'
  } catch { /* 缺文件由 C6 判红 */ }
  return { items, rows, planRegistered, parseErrors, sources }
}


async function main() {
  const { items, rows, planRegistered, parseErrors, sources } = loadAll()
  if (process.argv.includes('--emit')) {
    const have = new Set(rows.map((r) => `${r.file}#${r.shape}#${r.value}`))
    const miss = items.filter((i) => !have.has(i.key))
    console.log(`| 文件 | 类型 | 值 | 来源类别 | 依据 |`)
    console.log(`|---|---|---|---|---|`)
    for (const m of miss) console.log(`| ${m.file} | ${m.shape} | ${m.value} | TODO | TODO：追到哪个真实约束（平台事实/列定义/产品决定/性能实测），为什么是这个数 |`)
    console.error(`[limit-provenance] 骨架 ${miss.length} 行（TODO 一律判红，不许直接贴上去交差）`)
    process.exit(0)
  }
  const verdicts = evaluate({ items, rows, planRegistered, parseErrors, sources })
  let pass = 0
  const fails = []
  for (const v of verdicts) {
    console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.label}${v.detail ? ` (${v.detail})` : ''}`)
    if (v.ok) pass++
    else fails.push(v.label)
  }
  console.log(`\n==== 结果: ${pass} 通过 / ${fails.length} 失败 ====`)
  if (fails.length) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
  const platform = rows.filter((r) => r.kind === 'platform').length
  console.log(`[limit-provenance] OK 普查 ${items.length} 项上限全部溯源（platform 类 ${platform} 行已对账预算），登记册 ${REGISTRY}`)
  process.exit(0)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error('[limit-provenance] 判据自身异常:', e); process.exit(2) })
}
