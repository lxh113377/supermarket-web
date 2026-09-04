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

// 通用插入：按白名单构建列，JSON 字段序列化
export async function insert(DB, table, doc) {
  const cols = Object.keys(doc)
  const quoted = cols.map((c) => `"${c}"`).join(', ')
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map((c) => {
    const v = doc[c]
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v)
    return v
  })
  await qRun(DB, `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`, values)
  return doc._id
}
