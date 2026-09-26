#!/usr/bin/env node
/**
 * 目录事实对账（第十一轮 R11-H3）——把「D1 ↔ seed」这条挂了十几轮的口头账变成机器输出。
 *
 * 两件事分开，因为它们的性质不同：
 *  A. **硬不变量**（线上公开目录必须成立，违一条即 exit 1）：非空、_id 唯一、name 非空、
 *     price 是有限非负数、公开接口不得返回下架项（enabled 必须为真）、subcategories 是数组。
 *     这些不是"风格"，是白屏/错价/越权可见的直接成因。
 *  B. **漂移**（seed 与线上的差异：只在此有、只在彼有、同名不同价）——生产数据本来就会漂，
 *     判红等于逼运营回滚，所以**只报告不阻断**（advisory，遵「新指标先量误报率再接闸」）。
 *     顺带把长期口口相传的「28 上架 / 55 总数」口径当场打出来，不再靠人记。
 *
 * 取数：`POST {DEPLOY_URL}/pub {action:getPublicProducts}`（无需密钥；与前端同源）。
 * 取不到 ⇒ exit 2 = BLOCKED，绝不记绿（本机 github.io 不可达那次已经吃过"把取不到写成通过"的亏）。
 *
 * 退出码：0=硬不变量通过（漂移可为非零条数）/ 1=硬不变量违反 / 2=拿不到数据
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitStatements } from './verify-backup-restore.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.DEPLOY_URL || 'https://supermarket-web.pages.dev').replace(/\/$/, '')
const UA = { 'user-agent': 'supermarket-web-catalog-facts/1.0 (CI gate)', 'content-type': 'application/json' }

/** 解析 SQL 字面量：只处理本仓 seed 里出现的四种形态（字符串/数字/NULL/裸词）。 */
export function parseSqlValue(raw) {
  const t = raw.trim()
  if (/^NULL$/i.test(t)) return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t.startsWith("'")) {
    const inner = t.slice(1, t.lastIndexOf("'"))
    return inner.replace(/''/g, "'")
  }
  return t
}

/** 把 `INSERT INTO products (...) VALUES (...)` 解成对象数组（列名按括号序）。 */
export function parseSeedProducts(sqlText) {
  const rows = []
  for (const stmt of splitStatements(sqlText)) {
    const m = /^INSERT\s+INTO\s+products\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)$/i.exec(stmt)
    if (!m) continue
    const cols = m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    // 值区按逗号切，但要跳过引号内的逗号（subcategories 是 JSON 文本，含逗号）
    const vals = []
    let cur = ''
    let inStr = false
    for (let i = 0; i < m[2].length; i++) {
      const ch = m[2][i]
      if (inStr) {
        cur += ch
        if (ch === "'") {
          if (m[2][i + 1] === "'") { cur += m[2][++i] } else inStr = false
        }
        continue
      }
      if (ch === "'") { inStr = true; cur += ch; continue }
      if (ch === ',') { vals.push(parseSqlValue(cur)); cur = ''; continue }
      cur += ch
    }
    vals.push(parseSqlValue(cur))
    if (cols.length !== vals.length) continue
    rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])))
  }
  return rows
}

/**
 * A 面：商品行的硬不变量。两种形状分开判（本轮实测出来的差别，不是想象）：
 *  - `'api'` = /pub 返回的解码后行：subcategories 必须已是数组，且不得含下架项（公开接口越权可见面）。
 *  - `'db'`  = seed.sql / D1 原始行：subcategories 是 JSON 文本（必须能 parse 成数组），
 *              enabled 允许 0/1（种子本就含未上架项，"下架即越权"这条只对 API 面成立）。
 * 混用会同时造成假红与漏判：拿 api 规则判 db 行 ⇒ 54 行全红；拿 db 规则判 api ⇒ 未解码 bug 漏掉。
 */
export function judgeCatalogFacts(items, shape = 'api') {
  const problems = []
  if (!Array.isArray(items)) return ['商品清单不是数组（数据源形态变了）']
  if (items.length === 0) return [shape === 'api' ? '公开目录为空 ⇒ 顾客端白屏，这不是可用的线上状态' : '种子目录为空 ⇒ 本地演示模式无货可展']
  const seen = new Set()
  items.forEach((p, i) => {
    const id = String(p?._id ?? '')
    if (!id) problems.push(`第 ${i} 项缺 _id`)
    else if (seen.has(id)) problems.push(`${id}：_id 重复（会导致 React key 撞车与更新串号）`)
    else seen.add(id)
    if (!String(p?.name ?? '').trim()) problems.push(`${id || '#' + i}：name 为空`)
    const price = Number(p?.price)
    if (!Number.isFinite(price) || price < 0) problems.push(`${id || '#' + i}：price 非法（${JSON.stringify(p?.price)}）`)
    const subs = p?.subcategories
    if (shape === 'api') {
      if (subs !== undefined && !Array.isArray(subs)) problems.push(`${id || '#' + i}：subcategories 不是数组（JSON 列未解码）`)
      if (p?.enabled === false || p?.enabled === 0) problems.push(`${id || '#' + i}：公开接口返回了下架项（越权可见面）`)
    } else {
      if (typeof subs === 'string') {
        try {
          if (!Array.isArray(JSON.parse(subs))) problems.push(`${id || '#' + i}：subcategories JSON 解出来不是数组`)
        } catch { problems.push(`${id || '#' + i}：subcategories 不是合法 JSON 文本`) }
      } else if (subs !== undefined && !Array.isArray(subs)) problems.push(`${id || '#' + i}：subcategories 既非 JSON 文本也非数组`)
      if (p?.enabled !== undefined && ![0, 1, true, false].includes(p.enabled)) problems.push(`${id || '#' + i}：enabled 不是 0/1（${JSON.stringify(p.enabled)}）`)
    }
  })
  return problems
}

/** B 面：seed ↔ 线上 的漂移（只报告）。 */
export function diffSeedVsLive(seed, live) {
  const byKey = (rows) => new Map(rows.map((r) => [String(r.name ?? '').trim(), r]))
  const s = byKey(seed)
  const l = byKey(live)
  const onlySeed = [...s.keys()].filter((k) => k && !l.has(k))
  const onlyLive = [...l.keys()].filter((k) => k && !s.has(k))
  const priceDiff = [...l.keys()].filter((k) => s.has(k) && Number(s.get(k).price) !== Number(l.get(k).price))
    .map((k) => `${k}：seed ${s.get(k).price} → 线上 ${l.get(k).price}`)
  const dupSeed = seed.length - s.size
  const dupLive = live.length - l.size
  return { onlySeed, onlyLive, priceDiff, dupSeed, dupLive }
}

async function fetchLiveCatalog() {
  const res = await fetch(`${BASE}/pub`, {
    method: 'POST', headers: UA, cache: 'no-store',
    body: JSON.stringify({ action: 'getPublicProducts', payload: {} }),
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const j = await res.json()
  if (j?.code !== 0 || !Array.isArray(j.data)) throw new Error(`code=${j?.code} data=${typeof j?.data}`)
  return j.data
}

function main() {
  const seed = parseSeedProducts(readFileSync(join(ROOT, 'db', 'seed.sql'), 'utf8'))
  if (!seed.length) {
    console.error('[catalog] db/seed.sql 里解不出任何 products 行 ⇒ 解析器与真相源已脱节，不记绿')
    process.exit(2)
  }
  const seedProblems = judgeCatalogFacts(seed, 'db')
  console.log(`[catalog] seed.sql 解出 ${seed.length} 行商品；线上取数目标 ${BASE}/pub`)
  if (seedProblems.length) {
    console.error('[catalog] seed 自身违反硬不变量（这会让本地演示模式与线上不同形）：')
    for (const p of seedProblems.slice(0, 8)) console.error(`  - ${p}`)
    process.exit(1)
  }
  return fetchLiveCatalog().then((live) => {
    const problems = judgeCatalogFacts(live)
    const drift = diffSeedVsLive(seed, live)
    const enabledCount = live.length
    console.log(`[catalog] 线上公开目录 ${enabledCount} 条（= 已上架）；seed ${seed.length} 条（含未上架）`)
    console.log(`[catalog] 口径：线上上架 ${enabledCount} / seed 总数 ${seed.length}`)
    console.log(`[catalog] 漂移（仅报告）：只在 seed ${drift.onlySeed.length} 项 · 只在线上 ${drift.onlyLive.length} 项 · 价格不同 ${drift.priceDiff.length} 项`
      + `${drift.dupSeed ? ` · seed 同名重复 ${drift.dupSeed}` : ''}${drift.dupLive ? ` · 线上同名重复 ${drift.dupLive}` : ''}`)
    for (const x of drift.onlySeed.slice(0, 8)) console.log(`  · seed 独有：${x}`)
    for (const x of drift.onlyLive.slice(0, 8)) console.log(`  · 线上独有：${x}`)
    for (const x of drift.priceDiff.slice(0, 8)) console.log(`  · 价格漂移：${x}`)
    if (problems.length) {
      for (const p of problems.slice(0, 10)) console.error(`  - ${p}`)
      console.error(`[catalog] FAIL 硬不变量违反 ${problems.length} 项（漂移不在此列）`)
      process.exit(1)
    }
    console.log('[catalog] OK 线上公开目录硬不变量全过；漂移已如实报告（不阻断）')
  }).catch((e) => {
    console.error(`[catalog] BLOCKED 取不到线上目录：${e instanceof Error ? e.message : e} ⇒ 没有对象就不记绿`)
    process.exit(2)
  })
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  Promise.resolve(main()).catch((e) => {
    console.error(`[catalog] 未预期异常：${e?.stack || e}`)
    process.exit(2)
  })
}
