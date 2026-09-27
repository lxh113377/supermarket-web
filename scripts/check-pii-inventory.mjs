// 对标第二十轮 H1：个人数据登记册 —— 把「我们知道这些列装着什么」从自觉变成机器事实。
//
// 一手动因（本轮实测，非假想）：
//   （本轮第一版漏了 ai_calls / schema_migrations 两张表。**真因已复核并纠正**：不是只读了 schema.sql ——
//   实测 schema.sql 自己就建了全部 9 张表；是我 grep 时只取了前 70 行，**窗口截断**恰好切在两张表之前。
//   同一窗口也会让"我确认过了"变成假话，所以分母一律程序化全量解析，禁按行窗口取数。）
//   `functions/lib/actions/ai.js:28` 的 aiAdvice 全量 SELECT 里带着 `wechat, remark`，
//   `:77` 还把 `pub-${ip.slice(0,40)}` 当第三方用户标识 —— 个人数据有两条**未登记的出境路径**，
//   而 SECURITY.md 对"删除/保留/个人信息"零字。今天没出事，只说明没人写过那一行。
//
// 形态沿用本仓三个自家先例：docs/limit-provenance.md（双向对账 + TODO 即红）、
// docs/env-vars.md（每行必须写"未配置时行为"，这里是"无通道时必须写为什么可接受"）、
// tests/piiExportAllowlist.test.ts（导出表白名单，本判据拿它反推"进导出"列，派生值不双写）。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const REGISTRY = 'docs/pii-inventory.md'
const EXPORT_JUDGE = 'tests/piiExportAllowlist.test.ts'

export const CATEGORIES = new Set(['个人数据', '凭证', '派生', '运营'])
export const VISIBILITY = new Set(['pub', 'admin', 'internal'])
export const YESNO = new Set(['是', '否'])

/** 「进导出」由导出面判据的白名单反推：登记册里填"是"的列必须 ⊆ 实际 CSV 表头集合。 */
export function parseExportAllowlist(ts) {
  const m = /const EXPORT_HEADER_ALLOWLIST\s*=\s*\[([\s\S]*?)\]/.exec(ts.replace(/\r\n/g, '\n'))
  if (!m) return null
  return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

/**
 * 表头中文名 -> 数据列。CSV 导出的**唯一**来源是 orders 表，所以本映射只在 orders 范围内对账。
 * 不加这个界会出假红：`时间` 映射到 `createdAt`，而 reviews/submissions 也有 createdAt 列，
 * 于是它们被误判成"册内标否却出现在导出表头"。本轮第一版就踩到了，故把作用域写死并留此注。
 */
export const EXPORT_TABLE = 'orders'
export const HEADER_TO_COLUMN = {
  房间号: 'roomNumber', 商品: 'items', 口味: 'items', 数量: 'items',
  单价: 'items', 小计: 'items', 状态: 'status', 时间: 'createdAt',
}

/** 分母 = db/ 下**全部** .sql 的 CREATE TABLE。只读 schema.sql 会漏掉迁移里建的 ai_trace（第十三轮"契约外文件隐形"同族坑）。 */
export function parseSchemaTables(sqlTexts) {
  const map = new Map()
  for (const { sql } of sqlTexts) {
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(([\s\S]*?)\n\s*\)/gmi)) {
      const cols = []
      for (const raw of m[2].split('\n')) {
        const l = raw.trim()
        if (!l || /^--/.test(l)) continue
        const c = /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(TEXT|INTEGER|REAL|NUMERIC|BLOB)\b/i.exec(l)
        if (c && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(c[1])) cols.push(c[1])
      }
      const prev = map.get(m[1]) || []
      map.set(m[1], [...new Set([...prev, ...cols])])
    }
  }
  return map
}

export function parseInventory(md) {
  const rows = []
  const exempt = new Map()
  let section = ''
  md.split(/\r?\n/).forEach((line) => {
    const h = /^##\s+(.*)$/.exec(line)
    if (h) { section = h[1].trim(); return }
    if (!line.trim().startsWith('|')) return
    const c = line.split('|').slice(1, -1).map((s) => s.replace(/\*\*/g, '').trim())
    if (c.length < 2) return
    if (/^表级豁免/.test(section)) {
      if (/^[a-z_][a-z0-9_]*$/.test(c[0])) exempt.set(c[0], c[1])
      return
    }
    const mt = /^覆盖表[：:]\s*([a-z_][a-z0-9_]*)$/.exec(section)
    if (!mt || c.length < 8) return
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\s*\/\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(c[0])) return
    for (const col of c[0].split('/').map((s) => s.trim())) {
      rows.push({ table: mt[1], column: col, category: c[1], visibility: c[2], egress: c[3],
        retention: c[4], deletion: c[5], exported: c[6], basis: c[7], line: line })
    }
  })
  return { rows, exempt }
}

/**
 * P12 的两块拼图：出境链（aiAdvice）的 orders 投影列 ⇄ 下游真引用集。
 *
 * 为什么按"引用"而不是按"类别"划界：登记册把 `items`/`createdAt` 也标为个人数据，
 * 但分析确实要用它们 —— 按类别禁列会把这条闸做成"永远需要豁免"的死闸。
 * 按引用划界才是硬约束：**没用到却带进内存/日志面的列，一律白读，一律判红**；
 * 敏感列只要没被引用就同时被这条抓住（第二十四轮实测：原投影 9 列里 6 列没人用，
 * 含 wechat、remark 两列个人数据 —— 它当时并未真的出境，"出境"是上一轮把"SELECT 带过"
 * 误当成"送进 Dify"，本轮连同这条误判一起更正）。
 */
export function sliceFn(src, name) {
  const i = src.indexOf(`function ${name}`)
  if (i < 0) return ''
  const next = src.slice(i).search(/\nexport /)
  return next < 0 ? src.slice(i) : src.slice(i, i + next)
}

export function parseOrderProjection(aiSlice) {
  const m = /\bSELECT\s+([\s\S]*?)\s+FROM\s+orders\b/i.exec(aiSlice)
  if (!m) return null
  return m[1].split(',').map((s) => s.trim().replace(/^o\./, '')).filter((c) => /^[A-Za-z_]\w*$/.test(c))
}

export function orderRefs(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/\bo\.([A-Za-z_]\w*)/g)) out.add(m[1])
  return out
}

export function evaluate({ tables, rows, exempt, exportCols, mdText, aiSlice, difySlice }) {
  const out = []
  const push = (id, ok, label, detail) => out.push({ id, ok, label, detail })
  const byKey = new Map(rows.map((r) => [`${r.table}.${r.column}`, r]))

  push('P1', rows.length > 0 && (tables?.size ?? 0) > 0 && exportCols !== null,
    'P1 分母、登记册与导出白名单均非空',
    `表 ${tables?.size} 张｜列 ${rows?.length} 行｜豁免 ${exempt?.size} 张｜导出 ${exportCols?.length} 列`)

  const noTable = rows.filter((r) => !tables.has(r.table))
  push('P2', noTable.length === 0, 'P2 登记册不得有幽灵表（schema 里没有）',
    noTable.length ? [...new Set(noTable.map((r) => r.table))].join(',') : '每张在册表都存在于 schema')

  const missing = []
  const double = []
  for (const [t, cols] of tables) {
    if (exempt.has(t)) {
      if (cols.some((c) => byKey.has(`${t}.${c}`))) double.push(`${t} 既豁免又有行`)
      continue
    }
    if (!rows.some((r) => r.table === t)) missing.push(`${t}（整张未覆盖，也没进豁免表）`)
    else for (const c of cols) if (!byKey.has(`${t}.${c}`)) missing.push(`${t}.${c}`)
  }
  push('P3', missing.length === 0 && double.length === 0, 'P3 每列都要有家（覆盖 or 带理由豁免）',
    [missing.length ? `缺 ${missing.length} 列: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}` : '',
      double.length ? double.join('; ') : ''].filter(Boolean).join(' | ')
      || `${[...tables.keys()].length} 张表 ${rows.length + exempt.size} 处收口`)

  const dead = rows.filter((r) => !(tables.get(r.table) || []).includes(r.column))
  push('P4', dead.length === 0, 'P4 无死行（列已从 schema 消失）',
    dead.length ? dead.map((r) => `${r.table}.${r.column}`).join(',') : `${rows.length} 列行全部对得上现状`)

  const badEnum = []
  for (const r of rows) {
    if (!CATEGORIES.has(r.category)) badEnum.push(`${r.table}.${r.column} 类别=${r.category}`)
    if (!VISIBILITY.has(r.visibility)) badEnum.push(`${r.table}.${r.column} 可见性=${r.visibility}`)
    if (!YESNO.has(r.egress)) badEnum.push(`${r.table}.${r.column} 出境=${r.egress}`)
    if (!YESNO.has(r.exported)) badEnum.push(`${r.table}.${r.column} 进导出=${r.exported}`)
  }
  const thin = rows.filter((r) => (r.basis || '').replace(/TODO.*/i, '').trim().length < 14)
  const stub = rows.filter((r) => /TODO|待补|TBD/.test(r.line))
  push('P5', badEnum.length === 0 && thin.length === 0 && stub.length === 0,
    'P5 取值合法 + 依据不得是占位（≥14 字且非 TODO）',
    badEnum.length ? badEnum.slice(0, 4).join('; ')
      : thin.length ? `空泛 ${thin.length} 行: ${thin.slice(0, 3).map((t) => `${t.table}.${t.column}`).join(',')}`
        : stub.length ? `${stub.length} 行仍是 TODO` : `${rows.length} 行取值全合法、依据全写实`)

  const exNoWhy = [...exempt].filter(([, why]) => (why || '').trim().length < 14)
  const exCred = [...exempt].filter(([, why]) => /非个人|不涉及/.test(why) && !/[（(].{4,}[)）]|IP|ip|顾客|用户|商家|输入|目录|账本/.test(why))
  push('P6', exNoWhy.length === 0 && exCred.length === 0, 'P6 表级豁免必须给理由，空话不算豁免',
    exNoWhy.length ? `无/短理由: ${exNoWhy.map(([t]) => t).join(',')}`
      : exCred.length ? `空话豁免: ${exCred.map(([t]) => t).join(',')}` : `${exempt.size} 张表豁免全部带可读理由`)

  const claimed = rows.filter((r) => r.table === EXPORT_TABLE && r.exported === '是').map((r) => r.column)
  const actual = [...new Set((exportCols || []).map((h) => HEADER_TO_COLUMN[h]).filter(Boolean))]
  const notExported = claimed.filter((c) => !actual.includes(c))
  const saidNo = rows.filter((r) => r.table === EXPORT_TABLE && r.exported === '否' && actual.includes(r.column))
  const unmapped = (exportCols || []).filter((h) => !HEADER_TO_COLUMN[h])
  push('P7', notExported.length === 0 && saidNo.length === 0 && unmapped.length === 0,
    'P7 「进导出」与导出表白名单双向对账（派生值不手填）',
    [notExported.length && `册内标是但白名单无: ${notExported.join(',')}`,
      saidNo.length && `册内标否却出现在导出表头: ${saidNo.map((r) => `${r.table}.${r.column}`).join(',')}`,
      unmapped.length && `导出表头有未登记的列: ${unmapped.join(',')}`].filter(Boolean).join(' | ')
      || `标"是"的列 ⊆ 表头 ${actual.join(',')}；表头每列都有归属`)

  const egressYes = rows.filter((r) => r.egress === '是')
  const egressNoPointer = egressYes.filter((r) => !/(\w+\.\w+):\d+/.test(r.basis))
  // 零输入不得 PASS：第二十四轮把两列的"出境=是"更正为"否"之后，原判据只剩"0 列均有凭据"这句空话。
  // 补上对偶侧 —— 一列都不出境时，必须存在**点名第三方调用**的零出境声明，否则"全标否"就能自动变绿。
  const zeroDeclared = /出境列数\s*=\s*0/.test(mdText || '') && /pubAiChat|callDify/.test(mdText || '')
  push('P8', egressNoPointer.length === 0 && (egressYes.length > 0 || zeroDeclared),
    'P8 出境列必须点名代码落点；零出境时必须有点名第三方调用的零出境声明（双向，防"全标否"变绿）',
    egressNoPointer.length ? egressNoPointer.map((r) => `${r.table}.${r.column}`).join(',')
      : egressYes.length ? `${egressYes.length} 列出境均有行号凭据`
        : zeroDeclared ? '0 列出境，且「出境面」节点名了真实出境调用（pubAiChat/callDify）'
          : '0 列出境，但登记册没有可核对的零出境声明 ⇒ 不接受"标否即清白"')

  const noChannel = rows.filter((r) => /无通道/.test(r.deletion))
  // 「无通道」的交代按**表**收口，不按行灌样板水：
  // ① 敏感列（个人数据/凭证/派生）逐行写清为什么可接受；
  // ② 运营列不重复解释，但该表必须出现在文末「已知缺口」节里被点名 —— 机器可查，比逐行凑字更硬。
  const sensitiveNoChannel = noChannel.filter((r) => ['个人数据', '凭证', '派生'].includes(r.category))
  const sensitiveUnjustified = sensitiveNoChannel.filter((r) => r.basis.trim().length < 20)
  const tablesWithNoChannel = [...new Set(noChannel.map((r) => r.table))]
  const gapSection = /##\s+已知缺口[\s\S]*$/.exec(mdText || '')
  const gapMissing = gapSection
    ? tablesWithNoChannel.filter((t) => !new RegExp(`\\b${t}\\b`).test(gapSection[0]))
    : tablesWithNoChannel
  push('P9', sensitiveUnjustified.length === 0 && gapMissing.length === 0 && !!gapSection,
    'P9 「无删除通道」逐行交代 + 所属表必须在「已知缺口」被点名',
    !gapSection ? '缺「已知缺口」节：无通道的账不许散在行里悄悄存在'
      : sensitiveUnjustified.length ? `敏感列无通道且依据单薄: ${sensitiveUnjustified.map((r) => `${r.table}.${r.column}`).join(',')}`
        : gapMissing.length ? `有"无通道"列但缺口节未点名: ${gapMissing.join(',')}`
          : `${noChannel.length} 行标"无通道"，涉及 ${tablesWithNoChannel.length} 张表均已在缺口节挂账`)

  const pii = rows.filter((r) => ['个人数据', '凭证', '派生'].includes(r.category))
  const piiNoRetention = pii.filter((r) => /无自动清理/.test(r.retention) && !/无通道|仅人工|随记录|随父/.test(r.deletion))
  push('P10', pii.length >= 15 && piiNoRetention.length === 0,
    'P10 正向对照：个人数据列不得少于 15，且无保留策略的必须有删除路径',
    piiNoRetention.length ? piiNoRetention.map((r) => `${r.table}.${r.column}`).join(',')
      : `个人数据/凭证/派生 ${pii.length} 列（阈值 15），保留与删除两列互洽`)

  const exemptSelf = [...exempt.keys()].filter((k) => /check-pii-inventory|pii-inventory/.test(k))
  push('P11', exemptSelf.length === 0 && !rows.some((r) => /scripts|docs|tests/.test(r.table)),
    'P11 取数面不含判据自身与文档',
    `面 = db/**.sql 的 CREATE TABLE（${tables.size} 张），判据与登记册在面外`)

  // P12 出境链投影 ⇄ 引用集 互锁（第二十四轮 H7 的守门人）
  const proj = parseOrderProjection(aiSlice || '')
  const refs = orderRefs(`${aiSlice || ''}\n${difySlice || ''}`)
  const orderCols = tables.get('orders') || []
  const whiteRead = (proj || []).filter((c) => !refs.has(c))
  const notProjected = [...refs].filter((c) => orderCols.includes(c) && !(proj || []).includes(c))
  push('P12', !!proj && proj.length > 0 && whiteRead.length === 0 && notProjected.length === 0,
    'P12 aiAdvice 的 orders 投影每列必须被下游引用（白读列=把个人数据多搬进出境链的内存面）',
    !proj ? '未解析到 aiAdvice 的 orders SELECT ⇒ 出境链改形，判据必须同步（不许悄悄失明）'
      : [whiteRead.length && `白读列: ${whiteRead.join(',')}`,
        notProjected.length && `引用了却没投影: ${notProjected.join(',')}`].filter(Boolean).join(' | ')
        || `投影 ${proj.join(',')} 与引用集 ${[...refs].sort().join(',')} 完全互覆（零白读）`)

  return out
}

export function loadAll() {
  const sqlTexts = readdirSync(join(root, 'db')).filter((f) => f.endsWith('.sql'))
    .map((f) => ({ rel: `db/${f}`, sql: readFileSync(join(root, 'db', f), 'utf8') }))
  const tables = parseSchemaTables(sqlTexts)
  const { rows, exempt } = parseInventory(readFileSync(join(root, REGISTRY), 'utf8'))
  const exportCols = parseExportAllowlist(readFileSync(join(root, EXPORT_JUDGE), 'utf8'))
  return {
    tables, rows, exempt, exportCols, sources: sqlTexts,
    mdText: readFileSync(join(root, REGISTRY), 'utf8'),
    aiSlice: sliceFn(readFileSync(join(root, 'functions/lib/actions/ai.js'), 'utf8'), 'adminAiAdvice'),
    difySlice: sliceFn(readFileSync(join(root, 'functions/lib/dify.js'), 'utf8'), 'buildAdviceInput')
      + sliceFn(readFileSync(join(root, 'functions/lib/dify.js'), 'utf8'), 'ruleAdvice'),
  }
}

export async function main() {
  const s = loadAll()
  const verdicts = evaluate(s)
  let pass = 0
  const fails = []
  for (const v of verdicts) {
    console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.id} ${v.label}${v.detail ? ` (${v.detail})` : ''}`)
    if (v.ok) pass++
    else fails.push(v.id)
  }
  console.log(`\n==== 结果: ${pass} 通过 / ${fails.length} 失败 ====`)
  if (fails.length) { console.error(`[pii-inventory] FAILED 缺账项: ${fails.join(', ')}`); return 1 }
  const pii = s.rows.filter((r) => ['个人数据', '凭证', '派生'].includes(r.category)).length
  console.log(`[pii-inventory] OK 登记 ${s.rows.length} 列（个人数据/凭证/派生 ${pii} 列）+ 表级豁免 ${s.exempt.size} 张，与导出面判据互洽`)
  return 0
}

const isCli = !!process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main().then((rc) => process.exit(rc)).catch((e) => { console.error('[pii-inventory] 判据自身异常:', e); process.exit(2) })
