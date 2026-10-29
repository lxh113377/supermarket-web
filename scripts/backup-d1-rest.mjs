// 不依赖 wrangler 的 D1 导出器（只带 D1:Read 的 token 也能跑）。
//
// 为什么另写一件：wrangler d1 export 启动时会先去列账号，而只带 D1:Read 的 token 列不了号，
// 于是报 Failed to automatically retrieve account IDs（2026-10-29 实测；连 CLOUDFLARE_ACCOUNT_ID 环境变量
// 与 wrangler.toml 的 account_id 都给了也没绕过去）。本件改用 REST /query 端点自己拼 SQL dump：
// ① 读 sqlite_master 拿**原始 DDL**（table/index 的 sql 列就是原文）；② 逐表 SELECT * 生成 INSERT。
// 出口与 wrangler 版完全一致：写同一个 d1-backup.sql，后面的恢复演练 / 加密 / 上传三步不用改。
import { writeFileSync } from 'node:fs'

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

const objs = await q("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC, name ASC")
const tables = objs.filter((o) => o.type === 'table')
const indexes = objs.filter((o) => o.type === 'index')
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
  if (name.startsWith('_cf_') || name === 'sqlite_sequence') continue // D1 内部对象不进备份
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
