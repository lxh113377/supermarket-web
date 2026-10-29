// 不依赖 wrangler 的 D1 导出器（只带 D1:Read 的 token 也能跑）。
//
// 为什么另写一件：wrangler d1 export 启动时会先去列账号，而只带 D1:Read 的 token 列不了号，
// 于是报 Failed to automatically retrieve account IDs（2026-10-29 实测；连 CLOUDFLARE_ACCOUNT_ID 环境变量
// 与 wrangler.toml 的 account_id 都给了也没绕过去）。本件改用 REST /query 端点自己拼 SQL dump：
// ① 读 sqlite_master 拿**原始 DDL**（table/index 的 sql 列就是原文）；② 逐表 SELECT * 生成 INSERT。
// 出口与 wrangler 版完全一致：写同一个 d1-backup.sql，后面的恢复演练 / 加密 / 上传三步不用改。
// @probe-safe: 缺 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID 任一即 rc=2 直接 bail（本机实测 0s），
// 所有 fetch 都在那道门之后 ⇒ 探针面可以安全 spawn 它（声明与 scripts/lib/preflight.mjs 的 fail-closed 口径一致）。
import { readFileSync, writeFileSync } from 'node:fs'

const TOK = process.env.CLOUDFLARE_API_TOKEN
const ACC = process.env.CLOUDFLARE_ACCOUNT_ID
const DB = process.env.D1_DATABASE_ID
const OUT = process.env.BACKUP_SQL || 'd1-backup.sql'
if (!TOK || !ACC || !DB) {
  console.error('[backup-d1-rest] 环境不满足：需要 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID（rc=2）')
  process.exit(2)
}
const URL_Q = 'https://api.cloudflare.com/client/v4/accounts/' + ACC + '/d1/database/' + DB + '/query'

async function q(sql) {
  const r = await fetch(URL_Q, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  const j = await r.json()
  if (!j.success) throw new Error('D1 REST 失败 http=' + r.status + ' errors=' + JSON.stringify(j.errors))
  const first = (j.result || [])[0] || {}
  return first.results || []
}

// SQL 字面量：字符串按 SQLite 口径把单引号翻倍；对象（JSON 文本落库时其实是字符串）兜底 stringify
function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return "'" + s.split("'").join("''") + "'"
}
const ident = (n) => '"' + String(n).split('"').join('""') + '"'

// 表集真相源 = db/schema.sql（**不是** sqlite_master）。理由：D1 里还有 _cf_KV 与 sqlite_sequence 这类内部表，
// 把它们连 DDL 一起导出去，载入后就是「多表」⇒ 恢复演练判据（表集与 schema 双向对账）会判 schema 真相源漂移。
// 第一版正是这么挂的：13 张声明表 + 这 2 张内部表 = 15，判据当场对不上。
const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
const declared = new Set(
  [...schemaSql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["'\`]?([A-Za-z0-9_]+)["'\`]?/gi)].map((m) => m[1]),
)
if (!declared.size) {
  console.error('[backup-d1-rest] 读不到 db/schema.sql 的表集 ⇒ 没有真相源就不产备份（rc=2，别产半截）')
  process.exit(2)
}
const objs = await q("SELECT type, name, sql, tbl_name FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC, name ASC")
const liveTables = objs.filter((o) => o.type === 'table').map((o) => o.name)
const tables = objs.filter((o) => o.type === 'table' && declared.has(o.name))
// schema 声明了、线上却没有 ⇒ 备份必然不完整，响亮失败（别把缺表当成"库很小"）
const missing = [...declared].filter((n) => !liveTables.includes(n))
if (missing.length) {
  console.error('[backup-d1-rest] schema 声明了但线上缺表：' + missing.join(',') + ' ⇒ 备份不完整（rc=1）')
  process.exit(1)
}
// 索引只保留挂在已导出表上的（内表索引跟着表一起被排除，否则载入时会因缺表报错）
const indexes = objs.filter((o) => o.type === 'index' && declared.has(o.tbl_name))
const out = []
out.push('-- D1 逻辑备份（由 scripts/backup-d1-rest.mjs 经 REST /query 生成，不依赖 wrangler）')
out.push('-- 生成时刻 ' + new Date().toISOString() + '｜表 ' + tables.length + ' 张｜索引 ' + indexes.length + ' 个')
out.push('PRAGMA foreign_keys=OFF;')
out.push('BEGIN TRANSACTION;')
for (const t of tables) out.push(t.sql.trim() + ';')
for (const i of indexes) out.push(i.sql.trim() + ';')
let rows = 0
for (const t of tables) {
  const name = t.name
  const data = await q('SELECT * FROM ' + ident(name))
  if (!data.length) continue
  const cols = Object.keys(data[0])
  for (const row of data) {
    out.push('INSERT INTO ' + ident(name) + ' (' + cols.map(ident).join(', ') + ') VALUES (' + cols.map((c) => lit(row[c])).join(', ') + ');')
    rows++
  }
}
out.push('COMMIT;')
writeFileSync(OUT, out.join('\n') + '\n')
console.log('[backup-d1-rest] OK 表 ' + tables.length + ' 张｜索引 ' + indexes.length + ' 个｜数据行 ' + rows + ' 行 -> ' + OUT)
