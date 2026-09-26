// D1 帮助函数 + 通用工具（从 backend.js 拆出，逻辑零改动）
// 调用方：functions/lib/security.js、functions/lib/actions/*.js、backend.js

export async function qAll(DB, sql, params = []) {
  const r = await DB.prepare(sql).bind(...params).all()
  return r.results || []
}

export async function qFirst(DB, sql, params = []) {
  return await DB.prepare(sql).bind(...params).first()
}

export async function qRun(DB, sql, params = []) {
  return await DB.prepare(sql).bind(...params).run()
}

// D1 batch：多条语句一次网络往返送出、按给定顺序执行、任一条失败整批回滚（官方语义）。
// 刻意不做「运行时无 batch 就退回循环」的兜底——静默降级会把 O(1) 往返偷偷变回 O(N)，
// 而往返数正是 scripts/check-d1-roundtrips.mjs 的被测对象，宁可响亮报错。
export async function qBatch(DB, statements) {
  return await DB.batch(statements)
}

export function jparse(v, fallback) {
  if (v == null) return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}

export function nowISO() { return new Date().toISOString() }

export function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 仅保留白名单字段，防注入；JSON 字段序列化
export function pick(input, allowed) {
  const out = {}
  for (const k of allowed) if (k in input) out[k] = input[k]
  return out
}

// 通用插入：按白名单构建列，JSON 字段序列化。
// 单条与批量共用 insertSql/insertValues 一份构造逻辑，
// 否则两条通道会各说各话——列序或 JSON 序列化口径一漂移，就会写出错列的数据。
export function insertStatement(DB, docs, table) {
  return docs.map((doc) => DB.prepare(insertSql(table, doc)).bind(...insertValues(doc)))
}

export async function insert(DB, table, doc) {
  await qRun(DB, insertSql(table, doc), insertValues(doc))
  return doc._id
}

function insertSql(table, doc) {
  const quoted = Object.keys(doc).map((c) => `"${c}"`).join(', ')
  const placeholders = Object.keys(doc).map(() => '?').join(', ')
  return `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`
}

function insertValues(doc) {
  return Object.keys(doc).map((c) => {
    const v = doc[c]
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
    return v
  })
}
