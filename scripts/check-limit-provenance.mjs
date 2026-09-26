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

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const REGISTRY = 'docs/limit-provenance.md'

/** 平台侧真实约束（必须带可核对来源与取证日期；判据 C5 拿它做 ≤ 对账）。 */
export const PLATFORM_FACTS = {
  d1_statement_bytes: { max: 100_000, unit: 'bytes/语句', src: 'developers.cloudflare.com/d1/platform/limits（2026-04-21 更新页）」maximum SQL statement length 100 KB' },
  d1_queries_per_invocation_free: { max: 50, unit: '查询/调用', src: '同上页「Queries per Worker invocation — 1000 (Workers Paid) / 50 (Free)」' },
  d1_queries_per_invocation_paid: { max: 1000, unit: '查询/调用', src: '同上页' },
  d1_batch_wallclock_ms: { max: 30_000, unit: 'ms/整批', src: '同上页脚注「Requests to Cloudflare API must resolve in 30 seconds … applies to the entire batch call」' },
  sqlite_bound_params: { max: 999, unit: '绑定参数/语句', src: 'SQLite 官方 SQLITE_MAX_VARIABLE_NUMBER（旧默认 999；本仓 products.js:156 注释早已引它）' },
}

/** 六类"会砍东西"的数值形态 —— 判据的分母由这六个形状定义，不靠人记。 */
const SHAPES = {
  拒绝型: /\.\s*length\s*[<>]=?\s*(\d+)/g,
  截断型: /\.slice\(\s*0\s*,\s*(\d+)\s*\)/g,
  体积型: /(\d+)\s*\*\s*1024/g,
  保留期: /'-(\d+) days'/g,
  分页: /\bLIMIT (\d+)/gi,
}
const CONST_RE = /^(MAX|MIN|LIMIT|TOP|TTL|BATCH|_MS$|DAYS|SIZE|WINDOW|RATE_|TIMEOUT)/

export function collectJs(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) collectJs(p, out)
    else if (e.endsWith('.js')) out.push(p)
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

/** 普查：返回 [{key, file, shape, value, line}]，key = `文件#类型#值`（同值同文件归一行，防噪）。 */
export function census(sources) {
  const hits = new Map()
  for (const { rel, code } of sources) {
    // 先剥掉整行注释：登记册统计的是「代码里真的会砍东西的数」，注释与文档里的数字不算
    // （不剥的话，像「远低于 SQLite 999 参数上限」这种解释性注释会被当成上限，噪声到没人肯修）。
    const body = code.split(String.fromCharCode(10))
      .map((l) => (/^\s*(--|\/\/)/.test(l) ? '' : l)).join(String.fromCharCode(10))
    for (const [shape, re] of Object.entries(SHAPES)) {
      for (const m of body.matchAll(re)) {
        const value = Number(m[1] !== undefined ? m[1] : m[0].replace(/\D/g, ''))
        const line = body.slice(0, m.index).split('\n').length
        const key = `${rel}#${shape}#${value}`
        if (!hits.has(key)) hits.set(key, { key, file: rel, shape, value, line })
      }
    }
    walk(parse(code, { sourceType: 'module' }), (n) => {
      if (n.type !== 'VariableDeclarator' || n.init?.type !== 'NumericLiteral') return
      const name = n.id?.name || ''
      if (!CONST_RE.test(name)) return
      const key = `${rel}#常量#${name}=${n.init.value}`
      if (!hits.has(key)) hits.set(key, { key, file: rel, shape: '常量', value: n.init.value, name, line: n.loc.start.line })
    })
  }
  return [...hits.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** 登记册解析：只认 markdown 表格数据行，列序固定为 文件 | 类型 | 值 | 来源类别 | 依据 */
export function parseRegistry(md) {
  const rows = []
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 5) continue
    if (!cells[0].startsWith('functions/')) continue
    rows.push({ file: cells[0].replace(/`/g, ''), shape: cells[1], value: cells[2], kind: cells[3], basis: cells[4] })
  }
  return rows
}

export const ALLOWED_KINDS = new Set(['platform', 'schema', 'product', 'perf', 'self'])

/** 判据核心（纯函数，喂任意输入即可反证；同第十四/十五轮口径）。 */
export function evaluate({ items, rows, planRegistered }) {
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

  // C7：判据自身不得进普查面（否则 PLATFORM_FACTS 里的 50/1000/999 会自证成上限）
  const selfLeak = items.filter((i) => /check-limit-provenance/.test(i.file))
  push('C7', selfLeak.length === 0, 'C7 普查面不含判据自身',
    selfLeak.length ? '泄漏 ' + selfLeak.length + ' 项' : '取数面 = functions/**.js，判据与登记册在面外')
  return out
}

export function loadAll() {
  const sources = collectJs(join(root, 'functions')).map((f) => ({
    rel: relative(root, f).split(String.fromCharCode(92)).join('/'),
    code: readFileSync(f, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)),
  }))
  const items = census(sources)
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
  return { items, rows, planRegistered }
}


async function main() {
  const { items, rows, planRegistered } = loadAll()
  if (process.argv.includes('--emit')) {
    const have = new Set(rows.map((r) => `${r.file}#${r.shape}#${r.value}`))
    const miss = items.filter((i) => !have.has(i.key))
    console.log(`| 文件 | 类型 | 值 | 来源类别 | 依据 |`)
    console.log(`|---|---|---|---|---|`)
    for (const m of miss) console.log(`| ${m.file} | ${m.shape} | ${m.value} | TODO | TODO：追到哪个真实约束（平台事实/列定义/产品决定/性能实测），为什么是这个数 |`)
    console.error(`[limit-provenance] 骨架 ${miss.length} 行（TODO 一律判红，不许直接贴上去交差）`)
    process.exit(0)
  }
  const verdicts = evaluate({ items, rows, planRegistered })
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
