#!/usr/bin/env node
/**
 * 备份恢复演练判据（第十一轮 R11-H1）——「没验证过能恢复的备份只是愿望，不是备份」。
 *
 * 对标取证（本轮实测）：
 *  - `proffesor-for-testing/agentic-qe scripts/aqe-db-backup.sh:56` 载入前跑 `PRAGMA integrity_check`、
 *    `:58` 不合格即丢弃并保留上一份好备份、`:89-90` **恢复入口再查一次**（refusing to restore）。
 *  - `mattermost/mattermost server/channels/app/import_test.go:58-61` 用计数算术断言导入结果
 *    （`initialCount + change == result`）——恢复后的"条数"是最便宜的强不变量。
 *  - 反面教材 `Dicklesworthstone/frankensqlite scripts/ci_integrity_check.sh:32-34,41-43`：
 *    artifact 目录不存在 ⇒ `exit 0`、扫到 0 个库 ⇒ `exit 0`。**零输入记绿**正是要Avoid的那类假判据。
 *  - D1 生态现状：公开可见的 D1 备份 workflow（`caamer20/Telegram-Drive supporter-backup.yml:63-66`、
 *    `duremovich/EasySchematic backup-d1.yml:59`）全部停在"文件存在 + 能下载/有 CREATE TABLE"，
 *    **没有一家把 dump 载入并断言** ⇒ 这一条是补空白，不是抄作业。
 *
 * 本脚本做的事：把 `wrangler d1 export --remote` 产出的 SQL 文本**完整载入一次性内存 SQLite**，
 * 然后断言六条（全部当场取，不信任何缓存）：
 *   1) 载入不抛错；2) `PRAGMA integrity_check` == ok；3) `PRAGMA foreign_key_check` 零行；
 *   4) 表集合与 `db/schema.sql` 双向对账（缺表=备份不完整，多表=schema 真相源漂移）；
 *   5) Σ各表行数 == dump 文本里的 `INSERT INTO` 条数（截断/半截上传必红）；
 *   6) 关键表非空（`products` 为 0 的"schema-only 尸体"不算通过的备份）。
 * 另把 sha256 与逐表行数写进 `$GITHUB_STEP_SUMMARY`（sha256 sidecar 借 `caamer20` 的做法）。
 *
 * 退出码：0=可恢复 / 1=判据不过（含 0 INSERT）/ 2=参数或文件问题（缺失绝不静默过）
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 业务上"绝不能空"的表：目录空 = 顾客端白屏；其余表可为 0（如刚清过的 rate_limits）。 */
export const MUST_BE_NON_EMPTY = ['products']
/** SQLite 自管对象，不参与"schema.sql 双向对账"。 */
const SYSTEM_TABLES = new Set(['sqlite_sequence', 'sqlite_stat1'])

/**
 * 按语句边界切 SQL 文本（尊重单引号与 `''` 转义、跳过 `--` 行注释）。
 * 为什么不用"以 INSERT INTO 开头的行数"计数：dump 里一行可能放多条语句，
 * 而字段值里出现 "INSERT INTO" 字样（备注/描述）会被行首匹配误计 ⇒ 计数必须是**语句级**。
 */
export function splitStatements(sqlText) {
  const out = []
  let cur = ''
  let inString = false
  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i]
    if (inString) {
      cur += ch
      if (ch === "'") {
        if (sqlText[i + 1] === "'") { cur += sqlText[++i] } else { inString = false }
      }
      continue
    }
    if (ch === "'") { inString = true; cur += ch; continue }
    if (ch === '-' && sqlText[i + 1] === '-') {
      const nl = sqlText.indexOf('\n', i)
      i = nl < 0 ? sqlText.length : nl - 1
      continue
    }
    if (ch === ';') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

export function countInsertStatements(sqlText) {
  return splitStatements(sqlText).filter((s) => /^INSERT\s+INTO\b/i.test(s)).length
}

/** 真相源：db/schema.sql 里 CREATE TABLE 出来的表名。 */
export function expectedTablesFromSchema(schemaSql) {
  const names = new Set()
  for (const m of schemaSql.matchAll(/CREATE\s+TABLE(?:\s+IF NOT EXISTS)?\s+"?([A-Za-z_]\w*)"?\s*\(/gi)) names.add(m[1])
  return names
}

/** 真的把 dump 吃进去：一次性内存库，绝不落盘、绝不碰开发库。 */
export function loadDump(sqlText) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(sqlText)
    const integrityRows = db.prepare('PRAGMA integrity_check').all()
    const integrity = integrityRows.length ? String(Object.values(integrityRows[0])[0]) : 'no_result'
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all().length
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
    const counts = {}
    for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c
    return { ok: true, integrity, fkViolations, counts }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), integrity: 'unreachable', fkViolations: -1, counts: {} }
  } finally {
    try { db.close() } catch { /* 内存库，忽略 */ }
  }
}

/** 判定核心（纯函数，便于本机常驻反例覆盖）。 */
export function judgeRestore({ loaded, insertCount, expectedTables }) {
  const problems = []
  if (!loaded.ok) {
    problems.push(`dump 无法载入（不是可恢复备份）：${loaded.error || '未知错误'}`)
    return problems
  }
  if (loaded.integrity !== 'ok') problems.push(`PRAGMA integrity_check = ${loaded.integrity}（库体损坏即丢弃，别把它当备份留着）`)
  if (loaded.fkViolations > 0) problems.push(`PRAGMA foreign_key_check 命中 ${loaded.fkViolations} 行外键违反（导出顺序或库内容有问题）`)

  const restored = new Set(Object.keys(loaded.counts))
  const missing = [...expectedTables].filter((t) => !restored.has(t))
  if (missing.length) problems.push(`备份缺表：${missing.join(', ')}（db/schema.sql 有、dump 里没有 ⇒ 备份不完整）`)
  const extra = [...restored].filter((t) => !expectedTables.has(t) && !SYSTEM_TABLES.has(t))
  if (extra.length) problems.push(`备份里出现 schema.sql 之外的表：${extra.join(', ')} ⇒ 真相源漂移`)

  const rows = Object.values(loaded.counts).reduce((a, b) => a + b, 0)
  if (insertCount === 0) problems.push('dump 里 0 条 INSERT ⇒ 这是一份只有 schema 的尸体，不是数据备份')
  else if (rows !== insertCount) problems.push(`载入行数 ${rows} ≠ dump 文本 INSERT 数 ${insertCount} ⇒ 备份被截断或半截上传`)

  for (const t of MUST_BE_NON_EMPTY) {
    if (restored.has(t) && loaded.counts[t] === 0) problems.push(`关键表 ${t} 为空 ⇒ 恢复出去是白屏站，这份备份不可用`)
  }
  return problems
}

export function sha256Of(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function main() {
  const target = process.env.BACKUP_SQL || process.argv[2] || ''
  if (!target) {
    console.error('[restore] 参数缺失：BACKUP_SQL（要演练的 dump 路径）未给 —— 没有对象就判"通过"是没意义的')
    process.exit(2)
  }
  if (!existsSync(target) || statSync(target).size === 0) {
    console.error(`[restore] 备份文件不存在或为空：${target} —— 绝不静默记绿（frankensqlite 那类 exit 0 是本仓反例）`)
    process.exit(2)
  }
  const sqlText = readFileSync(target, 'utf8')
  const digest = sha256Of(sqlText)
  const size = statSync(target).size
  const expectedTables = expectedTablesFromSchema(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'))
  const insertCount = countInsertStatements(sqlText)
  const loaded = loadDump(sqlText)
  const problems = judgeRestore({ loaded, insertCount, expectedTables })
  const rows = Object.values(loaded.counts).reduce((a, b) => a + b, 0)

  const perTable = Object.entries(loaded.counts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}=${c}`).join(' ')
  const line = `size=${size}B sha256=${digest.slice(0, 16)}… INSERT文本=${insertCount} 载入行数=${rows} 表数=${Object.keys(loaded.counts).length}`
  console.log(`[restore] ${line}`)
  if (perTable) console.log(`[restore] 逐表行数：${perTable}`)

  if (process.env.GITHUB_STEP_SUMMARY) {
    const status = problems.length ? `❌ ${problems.length} 项不过` : '✅ 可恢复'
    const body = [`### D1 备份恢复演练（载回内存库实测）`, '', `- 结论：${status}`, `- ${line}`,
      `- 逐表行数：\`${perTable || '（无表载入）'}\``,
      `- sha256 全值：\`${digest}\``,
      ...(problems.length ? ['', ...problems.map((p) => `- ❌ ${p}`)] : []),
      ''].join('\n')
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, body)
    } catch { /* summary 写失败不影响判据本身 */ }
  }

  if (problems.length) {
    console.error(`[restore] FAIL ${problems.length} 项：`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('  处置：这份 dump 不能用于恢复 ⇒ 修导出链（不是放宽判据）；上一份通过的备份才是可依赖的回滚点。')
    process.exit(1)
  }
  console.log(`[restore] OK 备份可恢复：${rows} 行 / ${Object.keys(loaded.counts).length} 表，integrity=ok，fk=0`)
}

const isCli = !!process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main()
