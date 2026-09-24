#!/usr/bin/env node
/**
 * Schema 漂移门禁（对标 Saleor migration_lint / litemall flyway_location 的零依赖版）
 *
 * 本项目的真相源有两份：`db/schema.sql`（测试与文档用，verify-backend 每次重建 :memory: 库）
 * 与 `db/migrate-*.sql`（线上 D1 增量）。两者靠人手动同步——一旦某个迁移没回写 schema.sql，
 * 症状是"176 个测试全绿、线上 no column named ..."，且 `migrate-fix.sql` 这类裸 ALTER
 * 不可重复执行，无法用"重放迁移"的方式做对账。
 *
 * 因此本脚本只做一件可靠的事：**断言每个迁移引入的 DDL 对象在 schema.sql 里都存在**。
 * 反方向（schema.sql 有、迁移没有）是合法的（新库直接建全量），故不检查。
 *
 *   node scripts/check-schema-drift.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbDir = join(root, 'db')

const failures = []
let checks = 0
function check(ok, label, detail = '') {
  checks += 1
  if (ok) {
    console.log(`PASS  ${label}`)
  } else {
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

// 以 schema.sql 为准建一份内存库，作为"应有对象"的判定基准
const ref = new DatabaseSync(':memory:')
ref.exec(readFileSync(join(dbDir, 'schema.sql'), 'utf8'))

function tableExists(name) {
  return !!ref.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
}
function indexExists(name) {
  return !!ref.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name)
}
function columnExists(table, column) {
  if (!tableExists(table)) return false
  return ref.prepare(`PRAGMA table_info("${table}")`).all().some((c) => c.name === column)
}

// 逐条解析迁移文件里的 DDL 目标对象（只认本项目实际使用的三种形态）
const MIGRATIONS = readdirSync(dbDir)
  .filter((f) => /^migrate-.*\.sql$/.test(f))
  .sort()

if (MIGRATIONS.length === 0) {
  console.log('FAIL  未发现任何 db/migrate-*.sql —— 迁移目录异常（判据自身坏了 ≠ 通过）')
  process.exit(1)
}

for (const file of MIGRATIONS) {
  const sql = readFileSync(join(dbDir, file), 'utf8')
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const stmt of statements) {
    const oneLine = stmt.replace(/\s+/g, ' ')
    const tTable = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(oneLine)
    const tIndex = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/i.exec(oneLine)
    const tAlter = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(oneLine)
    // ALTER 语句本身不可重放（重复执行报 duplicate column），无法静态验证其定义是否与
    // schema.sql 逐字一致；此处只保证"列存在"，类型漂移由人工评审兜底。
    const label = `${file}: ${oneLine.slice(0, 64)}`

    if (tTable) {
      check(tableExists(tTable[1]), `${label}`, `schema.sql 缺表 ${tTable[1]}`)
    } else if (tIndex) {
      check(indexExists(tIndex[1]), `${label}`, `schema.sql 缺索引 ${tIndex[1]}`)
    } else if (tAlter) {
      const [, table, column] = tAlter
      check(columnExists(table, column), `${label}`, `schema.sql 的 ${table} 缺列 ${column}`)
    } else if (/^(UPDATE|INSERT|DELETE|PRAGMA)\b/i.test(oneLine)) {
      // 数据回填语句：不引入 schema 对象，无需对账（但会打印，防止解析规则漏掉 DDL 时被当成回填）
      console.log(`SKIP  ${label}（数据回填/会话语句，无 schema 对象）`)
    } else {
      check(false, `${label}`, '迁移含未识别的 DDL 形态，请扩展本门禁的解析规则（禁止静默跳过）')
    }
  }
}

console.log(`\n==== 结果: ${checks - failures.length} 通过 / ${failures.length} 失败 ====`)
if (failures.length) {
  console.log('存在 schema 漂移：迁移引入的对象未回写 db/schema.sql，测试库与线上库不一致。')
  process.exit(1)
}
console.log('全部通过 ✅（每个迁移引入的对象均已在 schema.sql 就位）')
ref.close()
