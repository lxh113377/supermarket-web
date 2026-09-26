// 对标第十五轮（2026-09-27）：函数级授权的可证性 —— 只读密钥的"禁止清单"漏一项，等于该写操作对只读账号开放。
//
// 为什么要有本判据（一手实测，非推测）：`functions/lib/backend.js` 里 `ADMIN_WRITE_ACTIONS` 的**自带注释**
// 就写着"⚠️ 审计必须覆盖全部 DB 变更类 action：遗漏即意味着只读密钥可执行该写操作"，并注明 2026-09-23
// 一次补齐 6 个漏登项。也就是说：清单被承认必须全覆盖，但**没有任何判据证明它覆盖了** ——
// 新增一个写 action 时，默认状态是"只读密钥可以做它"，且 CI 全绿。
// 与第十三轮"契约外 SQL 文件对账本与门禁双向隐形"同族，被管对象从文件换成权限。
//
// 判据方向（全部由结构枚举得出，不新增手工清单）：
//   业务表面 ← db/schema.sql 的全部表 − 具名副作用表白名单
//   业务写 action 集 ← backend.js 的 switch 路由 → 处理函数 → AST 可达的 SQL 写字面量命中的表
//   与 ADMIN_WRITE_ACTIONS（从源码里解析出来，不复制第二份）做双向差集
//
// 零凭据、离线、纯静态：不连云端、不建库。判据编号 B1~B7，失败原因带机器可读前缀。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { parse } from '@babel/parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ── 副作用表白名单（只读密钥也允许触碰的**非业务**表）：逐条点名 + 必须带 why ──
// 新增表默认落进"业务表面"（见 B7），想进这里必须显式登记并说明。
export const INFRA_TABLES = [
  { table: 'rate_limits', why: '限流计数器：checkRate 在任何鉴权结果下都要写，与调用方权限档位无关。' },
  { table: 'security_events', why: '安全审计流水：含 auth_failed，写它正是鉴权失败时的行为，不能反过来要求写权限。' },
  { table: 'ai_calls', why: 'AI 调用追踪（延迟/成败/token）：aiAdvice/aiChat 的观测副作用，不改业务数据。' },
  { table: 'schema_migrations', why: '迁移账本：只有 scripts/migrate.mjs 写，不在 action 面内。' },
]

// ── 公开通道（/pub）允许的业务写：同样是具名清单，新增即红 ─────────────────
export const PUB_WRITE_ALLOWED = [
  { action: 'createOrder', why: '顾客下单本就是公开写（防超卖靠守卫式扣减 + 幂等键，不靠登录）。' },
  { action: 'addPublicReview', why: '顾客提交评价：公开写，靠 isSafeImageUrl/UGC 校验与限流兜。' },
  { action: 'createSubmission', why: '服务申请入口：公开写，落 submissions 表待商家处理。' },
]

const INFRA_SET = new Set(INFRA_TABLES.map((e) => e.table))
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE)\b/i

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const c of node) walk(c, visit); return }
  visit(node)
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue
    walk(v, visit)
  }
}

const tmplText = (n) => n.quasis.map((q) => q.value.raw).join('@')

/** 一段函数体里出现的「写 <表>」集合；插值表名统一归为 `@dyn` 以便点名。 */
function writtenTables(body) {
  const out = new Set()
  walk(body, (n) => {
    if (n.type === 'TaggedTemplateExpression') return
    const text = n.type === 'TemplateLiteral' ? tmplText(n) : n.type === 'StringLiteral' ? n.value : null
    if (!text) return
    if (!WRITE_SQL.test(text)) return
    const m = /INSERT\s+INTO\s+([`"]?)([A-Za-z_]\w*)\1/i.exec(text)
      || /UPDATE\s+([`"]?)([A-Za-z_]\w*)\1/i.exec(text)
      || /DELETE\s+FROM\s+([`"]?)([A-Za-z_]\w*)\1/i.exec(text)
    if (m) out.add(m[2])
    // 插值模板（quasis>1 段）里的表名不可静态判定：一律记 @dyn 落进业务面，禁止隐身
    else if (n.type === 'TemplateLiteral' && n.quasis.length > 1 && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)/i.test(text)) out.add('@dyn')
  })
  return out
}

/** insert(DB, 'table', doc) / insertStatement(DB, docs, 'table') 这类经助手写的表。
 *  两处调用的**唯一字符串字面量**就是表名（其余参数是标识符），故取首个 StringLiteral 实参。 */
function helperWrittenTables(body) {
  const out = new Set()
  walk(body, (n) => {
    if (n.type !== 'CallExpression') return
    if (!['insert', 'insertStatement'].includes(n.callee?.name)) return
    const lit = n.arguments.find((a) => a.type === 'StringLiteral')
    if (lit) out.add(lit.value)
  })
  return out
}

/** 解析 functions/** 得到 fn → {直接写的表, 调用的其它函数}，再按文件内可达性传播。 */
export function buildWriteGraph(sources) {
  // sources: [{ rel, code }] —— 由调用方读盘后传入，判据核心本身不碰磁盘，
  // 这样才能在内存里喂变异源码做反证（不往受管根写临时文件）。
  const fns = new Map()
  for (const { rel, code } of sources) {
    walk(parse(code, { sourceType: 'module' }), (n) => {
      const name = n.type === 'FunctionDeclaration' ? n.id?.name
        : (n.type === 'VariableDeclarator' && /^(Arrow)?FunctionExpression$/.test(n.init?.type || '') ? n.id?.name : null)
      if (!name) return
      const body = n.type === 'FunctionDeclaration' ? n.body : n.init.body
      const calls = new Set()
      walk(body, (c) => { if (c.type === 'CallExpression' && c.callee?.name) calls.add(c.callee.name) })
      const direct = new Set([...writtenTables(body), ...helperWrittenTables(body)])
      fns.set(name, { file: rel, direct, calls })
    })
  }
  // 不动点传播：本文件调用图内的表往下传（同名函数后定义者胜，与 ESM 提升语义一致）
  let changed = true
  while (changed) {
    changed = false
    for (const [, info] of fns) {
      for (const c of info.calls) {
        const sub = fns.get(c)
        if (!sub || sub === info) continue
        for (const t of sub.direct) if (!info.direct.has(t)) { info.direct.add(t); changed = true }
      }
    }
  }
  return fns
}

/** 从 backend.js 源码里解析出 switch 路由与 ADMIN_WRITE_ACTIONS（不在本件复制第二份清单）。 */
export function parseBackend(rawSrc, securitySrc) {
  // 行尾归一：判据不能依赖文件是 LF 还是 CRLF（本仓 git autocrlf=true，
  // 未被我改过的文件在盘上是 CRLF，我写的是 LF；混用会让「Set 字面量的收尾」时灵时不灵）。
  const src = rawSrc.replace(/\r\n/g, '\n')
  const ast = parse(src, { sourceType: 'module' })
  const routes = { admin: new Map(), public: new Map() }
  const fnDecls = new Map()
  walk(ast.program, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id?.name) fnDecls.set(n.id.name, n)
  })
  for (const [entry, bucket] of [['handleAdmin', 'admin'], ['handlePublic', 'public']]) {
    const decl = fnDecls.get(entry)
    if (!decl) continue
    walk(decl.body, (n) => {
      if (n.type !== 'SwitchCase' || typeof n.test?.value !== 'string') return
      const calls = new Set()
      walk(n.consequent, (c) => { if (c.type === 'CallExpression' && c.callee?.name) calls.add(c.callee.name) })
      routes[bucket].set(n.test.value, [...calls])
    })
  }
  const m = /const ADMIN_WRITE_ACTIONS = new Set\(\[([\s\S]*?)\]\)\n/.exec(src)
  const registered = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
  const rm = /const ADMIN_READ_ACTIONS = new Set\(\[([\s\S]*?)\]\)\n/.exec(src)
  const readActions = rm ? [...rm[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
  // 穷举表必须真的接进判定链：只读档的拒绝条件必须是"不在读档穷举表里"，
  // 而不是仍看写清单（表建了没人读=半成品）。
  const wired = /role === 'readonly' && !ADMIN_READ_ACTIONS\.has\(action\)/.test(src)
  const secSrc = String(securitySrc || '').replace(/\r\n/g, '\n')
  const pm = /export const PUBLIC_ACTIONS = new Set\(\[([\s\S]*?)\]\)\n/.exec(secSrc)
  const publicActions = pm ? [...pm[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
  return { routes, registered, readActions, wired, publicActions }
}

export function businessTables(schemaSql, infraSet = INFRA_SET) {
  const all = [...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_]\w*)/gi)].map((m) => m[1])
  // 必须用传入的 infraSet：变异测试靠换这份名单来验 B6/B7 的分流，
  // 若这里写死 INFRA_SET，注入就成了摆设（判据可反证性当场作废）。
  return { all: new Set(all), business: new Set(all.filter((t) => !infraSet.has(t))) }
}

/** 判据核心（纯函数：喂任意输入即可逐条反证，同第十四轮 evaluate 口径）。 */
export function evaluate({ schemaSql, backendSrc, securitySrc, files }, {
  pubAllowedList = PUB_WRITE_ALLOWED, infraTables = INFRA_TABLES,
} = {}) {
  const out = []
  const push = (id, cond, label, detail) => out.push({ id, ok: Boolean(cond), label, detail })
  const infraSet = new Set(infraTables.map((e) => e.table))
  const { all: allTables, business } = businessTables(schemaSql, infraSet)
  const { routes, registered, readActions, wired, publicActions } = parseBackend(backendSrc, securitySrc)
  const fns = buildWriteGraph(files)

  const writesBusiness = (callNames) => {
    const hit = new Set()
    for (const cn of callNames) {
      const info = fns.get(cn)
      if (!info) continue
      for (const t of info.direct) if (business.has(t) || t === '@dyn') hit.add(t)
    }
    return [...hit]
  }
  const adminBizWrites = [...routes.admin].filter(([, cn]) => writesBusiness(cn).length > 0).map(([a]) => a)
  const pubBizWrites = [...routes.public].filter(([, cn]) => writesBusiness(cn).length > 0).map(([a]) => a)
  const reg = new Set(registered || [])
  const pubAllowed = new Set(pubAllowedList.map((e) => e.action))

  // B1 枚举面非空：任何一侧为空都说明取数链断了，绝不记 PASS
  push('B1', business.size > 0 && routes.admin.size > 0 && registered !== null,
    'B1 三面枚举均非空', `业务表 ${business.size}｜/web action ${routes.admin.size}｜登记项 ${registered === null ? '解析失败' : registered.length}`)

  // B2 漏登：会改业务数据却没进只读禁用清单
  const missing = adminBizWrites.filter((a) => !reg.has(a))
  push('B2', missing.length === 0, 'B2 业务写 action 全部已登记（漏登=只读密钥可执行）',
    missing.length ? `漏登: ${missing.join(', ')}` : `实测 ${adminBizWrites.length} 个业务写全部在册`)

  // B3 多登：登记了却已不是业务写（潜伏死项，同第十四轮 A3b 教训：反向也要对账）
  const stale = [...reg].filter((a) => !adminBizWrites.includes(a))
  push('B3', stale.length === 0, 'B3 登记项全部仍是业务写（无死项）',
    stale.length ? `死项: ${stale.join(', ')}` : `${reg.size} 条全部对得上`)

  // B4 公开通道：业务写必须逐条具名允许
  const pubBad = pubBizWrites.filter((a) => !pubAllowed.has(a))
  push('B4', pubBad.length === 0, 'B4 /pub 的业务写全部具名允许',
    pubBad.length ? `未具名: ${pubBad.join(', ')}` : `/pub 实测 ${pubBizWrites.length} 个业务写全部在册`)
  const pubDead = pubAllowedList.filter((e) => !pubBizWrites.includes(e.action))
  push('B4b', pubDead.length === 0, 'B4b /pub 具名清单无死项',
    pubDead.length ? `已不再是业务写: ${pubDead.map((d) => d.action).join(', ')}` : `${pubAllowedList.length} 条全部对得上`)

  // B5 路由与公开名单对账：能路由到 /pub 却没登记在 PUBLIC_ACTIONS（或反之）= 鉴权分支与实际入口漂移
  const notInPublicList = [...routes.public.keys()].filter((a) => !publicActions.includes(a))
  const notRouted = publicActions.filter((a) => !routes.public.has(a))
  push('B5', notInPublicList.length === 0 && notRouted.length === 0,
    'B5 /pub 路由集 ⇄ PUBLIC_ACTIONS 集相等',
    `仅在路由: ${notInPublicList.join(',') || '无'}｜仅在名单: ${notRouted.join(',') || '无'}`)

  // B6 副作用表白名单：必须逐条带 why 且表名真实存在（幽灵豁免/无因豁免一律红）
  const infraBad = infraTables.filter((e) => !allTables.has(e.table) || typeof e.why !== 'string' || e.why.length < 12)
  push('B6', infraBad.length === 0, 'B6 副作用表白名单真实且逐条有因',
    infraBad.length ? `不合格: ${infraBad.map((b) => b.table).join(', ')}` : `${infraTables.length} 条全部在册且带原因`)


  // B8 穷举表本身：漏登即"谁都做不了"，所以清单必须与路由两侧严丝合缝，且不许与写清单交叉
  push('B8', readActions !== null && wired, 'B8 只读穷举表存在且已接进判定链',
    `解析到 ${readActions === null ? '失败' : readActions.length} 项｜判定式接线=${wired ? 'yes' : 'no'}`)
  if (readActions !== null) {
    const rd = new Set(readActions)
    const notRoutedRead = readActions.filter((a) => !routes.admin.has(a))
    const uncovered = [...routes.admin.keys()].filter((a) => !rd.has(a) && !reg.has(a))
    const overlap = readActions.filter((a) => reg.has(a))
    push('B8b', notRoutedRead.length === 0 && uncovered.length === 0 && overlap.length === 0,
      'B8b 读档穷举 ⇄ 路由∪写清单 两侧相等且互斥',
      `仅在穷举表: ${notRoutedRead.join(',') || '无'}｜两侧都不在(=只读被默认拒): ${uncovered.join(',') || '无'}｜读写交叉: ${overlap.join(',') || '无'}`)
  }

  // B7 未归类表面：新增业务表若既不在业务面也不在副作用白名单 ⇒ 默认落进业务面并在此点名
  const unclassified = [...allTables].filter((t) => business.has(t) && !writesBusiness(
    [...fns.keys()].filter((n) => fns.get(n).direct.has(t))))
  push('B7', true, 'B7 表面归类完备（未归类表默认按业务表处置）',
    `全表 ${allTables.size}＝业务 ${business.size}＋副作用 ${INFRA_SET.size}｜本轮无写方的业务表: ${unclassified.join(', ') || '无'}`)

  return out
}

export function loadSources(projectRoot = root) {
  // 行尾归一：本仓 git autocrlf=true，未被我改过的文件在盘上是 CRLF、我写的是 LF。
  // 判据一旦依赖行尾形态就会"换个文件就时灵时不灵"，故在入口处统一成 LF。
  const lf = (t) => t.replace(/\r\n/g, '\n')
  const rec = (d) => readdirSync(d).flatMap((e) => {
    const p = join(d, e)
    return statSync(p).isDirectory() ? rec(p) : [p]
  })
  return {
    schemaSql: lf(readFileSync(join(projectRoot, 'db', 'schema.sql'), 'utf8')),
    backendSrc: lf(readFileSync(join(projectRoot, 'functions/lib/backend.js'), 'utf8')),
    securitySrc: lf(readFileSync(join(projectRoot, 'functions/lib/security.js'), 'utf8')),
    files: rec(join(projectRoot, 'functions'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => ({ rel: relative(projectRoot, f).split(sep).join('/'), code: lf(readFileSync(f, 'utf8')) })),
  }
}

export async function run() {
  const src = loadSources()
  const verdicts = evaluate(src)
  let pass = 0
  const fails = []
  for (const v of verdicts) {
    console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.label}${v.detail ? ` (${v.detail})` : ''}`)
    if (v.ok) pass++
    else fails.push(v.label)
  }
  console.log(`\n==== 结果: ${pass} 通过 / ${fails.length} 失败 ====`)
  if (fails.length) { console.log('失败项:'); fails.forEach((f) => console.log('  - ' + f)); return 1 }
  const { routes, registered } = parseBackend(src.backendSrc, src.securitySrc)
  console.log(`[action-authz] OK /web 路由 ${routes.admin.size} 个、只读禁用清单 ${registered.length} 条双向相等，/pub 路由 ${routes.public.size} 个业务写全部具名允许`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().then((rc) => process.exit(rc)).catch((e) => { console.error('[action-authz] 判据自身异常:', e); process.exit(2) })
}
