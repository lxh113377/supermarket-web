// 对标第十四轮（2026-09-26/27）：D1「往返数」判据 —— 一次业务动作打多少次数据库。
//
// 与第三轮 C1 的分工（两把尺，互不顶替；第一把尺口径一字未动）：
//   statements = 送进 D1 的 SQL 条数 → 对应配额（D1 免费档「每调用查询数」50）
//   roundTrips = 与 D1 的网络往返次数 → 对应延迟与崩溃窗口
// 一个 batch(N) 计 N 条语句、1 次往返 ⇒ 两条尺会给出不同答案，只看任一条都会漏。
// 本轮实测：createOrder 十件商品 statements 15 / roundTrips 6（改造前两条尺同为 15）。
//
// 零凭据离线：node:sqlite + functions/lib/backend.js 直跑，不需要 Cloudflare 账号/网络（同 verify-backend 口径）。
// 判据 A1~A7b，失败原因带机器可读前缀。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { parse } from '@babel/parser'
import { openSqlite, createMeteredD1 } from './lib/metered-d1.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const ADMIN_KEY = 'roundtrip-probe-key'
// D1 官方「Queries per Worker invocation」：Workers Paid 1000 / Free 50。
// 本仓无 CF 凭据、判不出当前档位 ⇒ 一律按最坏情况（免费档 50）设防。
export const STATEMENT_BUDGET_FREE = 50

let pass = 0
const failures = []
function ok(cond, msg) {
  if (cond) { pass++; return true }
  failures.push(msg)
  return false
}
function okLine(cond, label, detail) {
  const shown = detail === undefined ? label : `${label} (${detail})`
  const hit = ok(cond, shown)
  console.log(`${hit ? 'PASS' : 'FAIL'}  ${shown}`)
  return hit
}

// ── 在册 action：怎么按规模驱动 + 期望的往返斜率 ────────────────────────────
// at: [小规模, 大规模]；fixedShape: true 表示输入规模不由调用方决定（此时 at 两端必须相同，
//     否则等于用 span=0 假造斜率 0 —— 见 A2c）。
export const REGISTER = [
  {
    name: 'P:createOrder', channel: 'public', at: [1, 10], rtSlope: 0,
    payload: (ctx, n) => ({
      roomNumber: `rt-${n}`, wechat: 'wx',
      items: ctx.productIds.slice(0, n).map((id) => ({ productId: id, quantity: 1 })),
    }),
  },
  {
    name: 'A:batchUpdateProducts', channel: 'admin', at: [1, 10], rtSlope: 0,
    payload: (ctx, n) => ({ items: ctx.productIds.slice(0, n).map((id) => ({ productId: id, updates: { price: 9.9 } })) }),
  },
  {
    name: 'A:batchDeleteProducts', channel: 'admin', at: [1, 50], rtSlope: 0,
    payload: (ctx, n) => ({ productIds: ctx.ghostIds.slice(0, n) }),
  },
  {
    // 定形：20 条种子写死在源码里，规模不由调用方决定。上界 3 = 1 次鉴权 + 1 次限流 + 1 次 batch
    // （改造前是 2 + 20 次逐条 INSERT = 22 次往返；本轮把它压成常数，故上界按常数级而非按条数级给）。
    name: 'A:seedReviews', channel: 'admin', at: [1, 1], fixedShape: true, rtSlope: 0, rtMax: 3,
    payload: () => ({}),
  },
]

// ── 具名豁免（承第十三轮 BASELINE_ERA 形态：清单不是正则，新犯默认落进判据面）──
// action 与 REGISTER 对账；site 与 A7 扫描命中对账；两者都必须带 why。
export const EXEMPT = [
  {
    action: 'A:batchUpdateProducts',
    site: 'functions/lib/actions/products.js#batchUpdateProducts',
    why: '产品决定要逐条成功/失败明细（部分失败可定位重试），而 batch 的官方语义是任一条失败整批回滚 —— 二者冲突，'
      + '保留逐条通道。真缺口登记为第十四轮 P1：单次上限 200 与免费档每调用 50 查询未对账，'
      + '修法是 JS 侧批量校验 + 1 条 bulk UPDATE + 1 条核对（斜率压到 0），不是本轮悄悄放宽判据。',
  },
  {
    site: 'functions/lib/actions/orders.js#recalculateOrders',
    why: '全表分页修正（while + LIMIT/OFFSET 批次），往返数 = 数据量/批大小，属预期形态而非 N+1 回归；'
      + '批大小 200 由 orders 表规模封顶，已在 A:recalculateOrders 峰值基线里计量。',
  },
]

// 语句预算（A3）专用登记：越界但已具名说明者
export const STATEMENT_BUDGET_EXEMPT = [
  {
    action: 'A:batchUpdateProducts',
    why: '斜率 1（实测 statements = 1 + n）⇒ n=200 时 201 条，远超免费档 50。与 A2 同一处豁免，修法同上一条。',
  },
]

export function collectSources(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...collectSources(p))
    else if (/\.js$/.test(e)) out.push(p)
  }
  return out.sort()
}

// ── A7 的枚举核心：AST 找「循环体（含 2 跳内的本文件局部异步函数）里的 D1 调用」──
const DB_CALLS = new Set(['qRun', 'qAll', 'qFirst', 'insert', 'qBatch'])

function fnName(node) {
  if (!node) return null
  if (node.type === 'FunctionDeclaration') return node.id?.name || null
  // 只有 `const f = () => {}` / `const f = async function(){}` 才算函数名；
  // 否则 `const r = await foo()` 会把普通变量名冒充归属函数（实测踩坑：报成 products.js#r）
  if (node.type === 'VariableDeclarator') {
    return /^(Arrow)?FunctionExpression$/.test(node.init?.type || '') ? (node.id?.name || null) : null
  }
  if (node.type === 'ClassMethod' || node.type === 'ObjectMethod') return node.key?.name || null
  return null
}

export function findLoopsInSource(code, label) {
  const ast = parse(code, { sourceType: 'module', errorRecovery: false })
  const hits = []
  const LOOP_TYPES = new Set([
    'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement',
  ])
  // 第一遍：本文件里「自己就会打 D1」的局部函数名（供 2 跳追踪）
  const directDbFns = new Set()
  const fnBodyOf = (node) => {
    if (node.type === 'FunctionDeclaration') return node.body
    if (node.type === 'VariableDeclarator' && /^(Arrow)?FunctionExpression$/.test(node.init?.type || '')) return node.init.body
    return null
  }
  ;(function survey(node) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const c of node) survey(c); return }
    const name = fnName(node)
    const body = fnBodyOf(node)
    if (name && body) {
      let has = false
      ;(function inner(n) {
        if (!n || typeof n !== 'object') return
        if (Array.isArray(n)) { for (const c of n) inner(c); return }
        if (n.type === 'CallExpression' && DB_CALLS.has(n.callee?.name)) has = true
        for (const [k, v] of Object.entries(n)) {
          if (k === 'loc' || k === 'start' || k === 'end') continue
          inner(v)
        }
      })(body)
      if (has) directDbFns.add(name)
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      survey(v)
    }
  })(ast.program)

  function walk(node, inLoop, curFn) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const c of node) walk(c, inLoop, curFn); return }
    let loop = inLoop
    if (LOOP_TYPES.has(node.type)) loop = true
    if (node.type === 'CallExpression'
      && /^(map|forEach|flatMap)$/.test(node.callee?.property?.name || '')
      && /^(Arrow)?FunctionExpression$/.test(node.arguments?.[0]?.type || '')) loop = true
    const owner = fnName(node) || curFn
    if (node.type === 'CallExpression' && inLoop && owner) {
      const callee = node.callee?.name
      if (DB_CALLS.has(callee)) hits.push({ site: `${label}#${owner}`, via: callee, line: node.loc.start.line })
      else if (directDbFns.has(callee)) hits.push({ site: `${label}#${owner}`, via: `${callee}()`, line: node.loc.start.line })
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      walk(v, loop, owner)
    }
  }
  walk(ast.program, false, null)
  return hits
}

export function scanLoopedDbCalls(files, projectRoot) {
  const hits = []
  for (const f of files) {
    const label = relative(projectRoot, f).replace(/\\/g, '/')
    hits.push(...findLoopsInSource(readFileSync(f, 'utf8'), label))
  }
  // 同一函数体只报一次（一个函数一条豁免，不按行号堆）
  const seen = new Map()
  for (const h of hits) if (!seen.has(h.site)) seen.set(h.site, h)
  return [...seen.values()].sort((a, b) => a.site.localeCompare(b.site))
}

// ── 度量：在册 action 在两个规模下的 statements / roundTrips ────────────────
export async function measure() {
  const db = openSqlite([
    readFileSync(join(root, 'db', 'schema.sql'), 'utf8'),
    readFileSync(join(root, 'db', 'seed.sql'), 'utf8'),
  ])
  const D1 = createMeteredD1(db)
  const be = await import(pathToFileURL(join(root, 'functions', 'lib', 'backend.js')).href)
  const env = { DB: D1, ADMIN_KEY }
  const productIds = db.prepare('SELECT _id FROM products WHERE enabled = 1 ORDER BY _id LIMIT 12').all().map((r) => r._id)
  for (const id of productIds) db.prepare('UPDATE products SET stock = 5000 WHERE _id = ?').run(id)
  const ghostIds = Array.from({ length: 50 }, (_, i) => `ghost-${i}`)
  const ctx = { productIds, ghostIds, db, D1, env, be }

  const rows = []
  for (const entry of REGISTER) {
    const point = []
    for (const n of entry.at) {
      const s0 = D1.__counters.statements
      const r0 = D1.__counters.roundTrips
      const payload = entry.payload(ctx, n)
      const res = entry.channel === 'admin'
        ? await be.handleAdmin(env, entry.name.slice(2), ADMIN_KEY, payload)
        : await be.handlePublic(env, entry.name.slice(2), payload)
      if (res.code !== 0) throw new Error(`${entry.name} 规模 ${n} 驱动失败: ${res.message || JSON.stringify(res)}`)
      point.push({ n, statements: D1.__counters.statements - s0, roundTrips: D1.__counters.roundTrips - r0 })
    }
    const span = entry.at[1] - entry.at[0]
    const last = point[point.length - 1]
    rows.push({
      ...entry, point, last,
      rtSlope: span === 0 ? null : (point[1].roundTrips - point[0].roundTrips) / span,
      stSlope: span === 0 ? null : (point[1].statements - point[0].statements) / span,
      maxStatements: Math.max(...point.map((p) => p.statements)),
      maxRoundTrips: last.roundTrips,
    })
  }
  return { rows }
}

// ── 判据核心（纯函数，可对任意输入反证）────────────────────────────────────
// 第十轮立的规矩：判据要能脱离真实环境被逐条打红，否则「跑一遍没红」不等于「它有牙齿」。
export function evaluate({ rows, hits, sourcesCount }, {
  register = REGISTER, exempt = EXEMPT, budgetExempt = STATEMENT_BUDGET_EXEMPT,
  budget = STATEMENT_BUDGET_FREE,
} = {}) {
  const out = []
  const push = (id, cond, label, detail) => out.push({ id, ok: Boolean(cond), label, detail })
  const exemptByAction = new Map(exempt.filter((e) => e.action).map((e) => [e.action, e]))
  const exemptSites = new Set(exempt.map((e) => e.site))

  push('A1', rows.length === register.length && register.length > 0,
    'A1 在册 action 全部完成实测', `${rows.length}/${register.length}`)

  for (const r of rows) {
    const named = exemptByAction.get(r.name)
    if (r.fixedShape) {
      // 定形 action（规模不由调用方决定）没有斜率可测，但**必须**声明往返上界，
      // 否则 fixedShape 就是免检通道——登记了却不测任何东西，正是第十二轮「绿色零备份」的形态。
      push('A2', r.at[0] === r.at[1] && typeof r.rtMax === 'number',
        `A2 定形项须声明上界 ${r.name}`, `at=${JSON.stringify(r.at)}｜rtMax=${r.rtMax}`)
      push('A2b', r.maxRoundTrips <= r.rtMax, `A2b 定形往返上界 ${r.name}`, `${r.maxRoundTrips} ≤ ${r.rtMax}`)
      continue
    }
    push('A2', Boolean(named) || r.rtSlope === 0, `A2 往返不随规模增长 ${r.name}`,
      named ? `具名豁免：${named.why.slice(0, 24)}…`
        : `斜率 ${r.rtSlope}｜n=${r.at[0]}→${r.at[1]} 往返 ${r.point[0].roundTrips}→${r.last.roundTrips}`)
  }

  for (const r of rows) {
    const named = budgetExempt.find((e) => e.action === r.name)
    push('A3', r.maxStatements <= budget || Boolean(named),
      `A3 语句预算对账 ${r.name}`, `峰值 ${r.maxStatements} / 预算 ${budget}${named ? '｜具名豁免' : ''}`)
  }
  // 反向也对账：豁免里指向不在册 action 的条目（变异测试 M3 抓到本行原先只在命中时才判，
  // 于是「幽灵豁免」可以长期潜伏不报错——与 lessons-p0「退役必须登记黑名单」同族）
  for (const e of budgetExempt) {
    push('A3b', register.some((x) => x.name === e.action), `A3b 预算豁免须在在册清单内 ${e.action}`)
  }

  push('A6', sourcesCount > 0, 'A6 源码扫描面非空', `${sourcesCount} 个文件`)
  for (const h of hits) {
    push('A7', exemptSites.has(h.site), `A7 循环内 DB 调用已具名豁免 ${h.site}`, `经由 ${h.via} @L${h.line}`)
  }
  if (!hits.length) push('A7', false, 'A7 扫描零命中（枚举器可能失效，须人工复核）')
  const dead = exempt.filter((e) => !hits.some((h) => h.site === e.site))
  push('A7b', dead.length === 0, 'A7b 豁免清单无死件（每项仍命中真实扫描结果）',
    dead.length ? `潜伏死豁免: ${dead.map((d) => d.site).join(', ')}` : `${exempt.length} 条全部在册命中`)
  push('A6b', exempt.every((e) => typeof e.why === 'string' && e.why.length > 20),
    'A6b 豁免条目必须逐条写明原因', `${exempt.filter((e) => (e.why || '').length > 20).length}/${exempt.length}`)
  return out
}

async function main() {
  const { rows } = await measure()
  const sources = collectSources(join(root, 'functions'))
  const hits = scanLoopedDbCalls(sources, root)
  let aborted = false
  for (const v of evaluate({ rows, hits, sourcesCount: sources.length })) {
    console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.label}${v.detail ? ` (${v.detail})` : ''}`)
    if (v.ok) pass++
    else failures.push(v.label)
    if (v.id === 'A1') aborted = !v.ok
  }
  if (aborted) return finish()

  // A4 度量工具自证：batch(N) 计「1 次往返 / N 条语句」，且第 2 条撞主键要整批回滚
  const pdb = openSqlite([readFileSync(join(root, 'db', 'schema.sql'), 'utf8')])
  pdb.prepare('INSERT INTO categories (_id, name, type, "order") VALUES (?, ?, ?, ?)').run('c1', 'A', 'x', 1)
  const pD1 = createMeteredD1(pdb)
  const s0 = pD1.__counters.statements
  const r0 = pD1.__counters.roundTrips
  await pD1.batch([
    pD1.prepare('INSERT INTO categories (_id, name, type, "order") VALUES (?, ?, ?, ?)').bind('c2', 'B', 'x', 2),
    pD1.prepare('INSERT INTO categories (_id, name, type, "order") VALUES (?, ?, ?, ?)').bind('c3', 'C', 'x', 3),
  ])
  okLine(pD1.__counters.statements - s0 === 2 && pD1.__counters.roundTrips - r0 === 1,
    'A4 batch(2) 计 2 条语句 / 1 次往返', `语句 ${pD1.__counters.statements - s0}｜往返 ${pD1.__counters.roundTrips - r0}`)
  let rolledBack = false
  try {
    await pD1.batch([
      pD1.prepare('INSERT INTO categories (_id, name, type, "order") VALUES (?, ?, ?, ?)').bind('c4', 'D', 'x', 4),
      pD1.prepare('INSERT INTO categories (_id, name, type, "order") VALUES (?, ?, ?, ?)').bind('c1', 'dup', 'x', 5),
    ])
  } catch {
    rolledBack = pdb.prepare("SELECT COUNT(*) AS c FROM categories WHERE _id = 'c4'").get().c === 0
  }
  okLine(rolledBack, 'A4b batch 第 2 条撞主键 ⇒ 整批回滚（对齐 D1 abort 语义）')

  // A5 库存不足必须零残留：三项各买 2、末项只够 1 ⇒ 前两项也不得被扣
  const sdb = openSqlite([
    readFileSync(join(root, 'db', 'schema.sql'), 'utf8'),
    readFileSync(join(root, 'db', 'seed.sql'), 'utf8'),
  ])
  const ids = sdb.prepare('SELECT _id FROM products WHERE enabled = 1 ORDER BY _id LIMIT 3').all().map((r) => r._id)
  for (const id of ids) sdb.prepare('UPDATE products SET stock = 10 WHERE _id = ?').run(id)
  sdb.prepare('UPDATE products SET stock = 1 WHERE _id = ?').run(ids[2])
  const sD1 = createMeteredD1(sdb)
  const sBe = await import(pathToFileURL(join(root, 'functions', 'lib', 'backend.js')).href)
  const snap = () => JSON.stringify(sdb.prepare(
    `SELECT _id, stock FROM products WHERE _id IN (${ids.map(() => '?').join(',')}) ORDER BY _id`).all(...ids))
  const before = snap()
  const badRes = await sBe.handlePublic({ DB: sD1, ADMIN_KEY: 'x' }, 'createOrder', {
    roomNumber: 'rt-a5', wechat: 'w', items: ids.map((id) => ({ productId: id, quantity: 2 })),
  })
  okLine(badRes.code === -1, 'A5 库存不足被拒', badRes.message || '')
  okLine(before === snap(), 'A5b 部分扣减无残留（补偿把已扣项全部回补）',
    `前 ${before}｜后 ${snap()}`)

  return finish(hits.length)
}

function finish(loopHits = 0) {
  const failed = failures.length
  console.log(`\n==== 结果: ${pass} 通过 / ${failed} 失败 ====`)
  if (failed) { console.log('失败项:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1) }
  console.log(`[d1-roundtrip] OK 在册 ${REGISTER.length} 项、循环内 DB 调用命中 ${loopHits} 处（全部具名豁免）、语句预算 ${STATEMENT_BUDGET_FREE}`)
  process.exit(0)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error('[d1-roundtrip] 判据自身异常:', e); process.exit(2) })
}
