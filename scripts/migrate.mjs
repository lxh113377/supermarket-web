#!/usr/bin/env node
/**
 * D1 迁移账目与执行器（对标 Flyway / TypeORM migrations / Django migration recorder）
 *
 * 治理前的状态：db/ 下 6 个 migrate-*.sql 靠 README 注释和记忆决定"哪个还没跑"，
 * 而 `migrate-fix.sql`、`migrate-stock.sql` 里的裸 ALTER 重复执行会直接报错
 * ——也就是说"忘了跑没跑"这件事本身没有安全答案。
 *
 * 本脚本引入 `schema_migrations` 账目表：每个迁移文件按文件名排序、只跑一次、跑完记 SHA256。
 * 事后改历史文件会被 checksum 检出（同 Flyway 的 checksum 校验）。
 *
 *   node scripts/migrate.mjs status                    # 只读：列出已应用/待应用（默认 --local）
 *   node scripts/migrate.mjs status --remote
 *   node scripts/migrate.mjs apply --local
 *   node scripts/migrate.mjs apply --remote            # 生产：需先完成全量备份（见 chaoshi-web-deploy skill）
 *   node scripts/migrate.mjs mark <file> --remote --reason "上线前既有库，DDL 已人工执行"
 *   node scripts/migrate.mjs bootstrap --local            # 全新库：schema.sql 全量 + 记满基线
 *   node scripts/migrate.mjs bootstrap --remote --yes    # 仅限空库；非空即拒（防覆盖既有数据）
 *
 * 设计取舍：不引入 wrangler 原生 `d1 migrations` 目录约定，因为既有 6 个迁移已在线上人工执行过，
 * 换约定会让"哪个跑过"重新变成口头约定——账目表比目录约定更可证。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbDir = join(root, 'db')
const LEDGER = 'schema_migrations'
const args = process.argv.slice(2)
const cmd = args[0] || 'status'

function target() {
  if (args.includes('--local')) return 'local'
  if (args.includes('--remote')) return 'remote'
  // 默认本地：生产库必须显式点名，防止在CI或随手一跑时误改线上
  return 'local'
}

const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
if (!existsSync(wrangler)) {
  console.error('FAIL  未找到本地 wrangler（node_modules/wrangler/bin/wrangler.js），先 npm ci')
  process.exit(1)
}

function extractJson(text) {
  // wrangler 会在 JSON 前后混入日志行，且 JSON 顶层可能是数组（多语句）也可能是对象。
  // 用括号配平（跳过字符串内的括号）取第一个完整文档，禁止 indexOf('{') 这种取法——
  // 实测 `--json` 顶层是 [ {results:[...]} ]，从内层 '{' 切会得到截断文档。
  const start = text.search(/[[{]/)
  if (start < 0) throw new Error('wrangler 输出无 JSON：' + text.slice(0, 200))
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('wrangler 输出 JSON 未闭合：' + text.slice(start, start + 200))
}

function rowsOf(parsed) {
  const blocks = Array.isArray(parsed) ? parsed : parsed.result ?? []
  return blocks.flatMap((b) => b.results ?? [])
}

// collapse 只用于**无注释的单行语句**：迁移文件含 `-- 说明` 行，压平换行会让注释吞掉后续全部 SQL
function runWrangler(extraFlags, quiet) {
  const flags = ['d1', 'execute', 'supermarket', '--json']
  if (target() === 'remote') flags.push('--remote')
  else flags.push('--local')
  flags.push(...extraFlags)
  const out = execFileSync(process.execPath, [wrangler, ...flags], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'pipe',
  })
  const parsed = extractJson(out)
  if (parsed && parsed.success === false) {
    throw new Error('D1 执行失败：' + JSON.stringify(parsed.errors || parsed).slice(0, 400))
  }
  if (Array.isArray(parsed) && parsed.some((b) => b.success === false)) {
    throw new Error('D1 执行失败（多语句中某条）：' + JSON.stringify(parsed).slice(0, 400))
  }
  return rowsOf(parsed)
}

function d1(sql, { quiet = false } = {}) {
  return runWrangler(['--command', sql.replace(/\s+/g, ' ').trim()], quiet)
}

// 迁移文件按原文件交给 wrangler（保留换行与注释，多语句按序执行）
function d1File(absPath, { quiet = false } = {}) {
  return runWrangler([`--file=${absPath}`], quiet)
}

function migrations() {
  return readdirSync(dbDir)
    .filter((f) => /^migrate-.*\.sql$/.test(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dbDir, f), 'utf8')
      return { file: f, text, checksum: createHash('sha256').update(text).digest('hex').slice(0, 16) }
    })
}

function ensureLedger() {
  d1(`CREATE TABLE IF NOT EXISTS ${LEDGER} (
  name       TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  appliedAt  TEXT NOT NULL,
  note       TEXT DEFAULT ''
)`)
}

function applied() {
  try {
    return d1(`SELECT name, checksum, appliedAt FROM ${LEDGER} ORDER BY name`)
  } catch (e) {
    if (/no such table/i.test(String(e.message))) return null
    throw e
  }
}

function fail(msg) {
  console.log(`FAIL  ${msg}`)
  process.exit(1)
}

function report(rows, ledger) {
  const byName = new Map(ledger.map((r) => [r.name, r]))
  for (const m of rows) {
    const rec = byName.get(m.file)
    if (!rec) console.log(`TODO  ${m.file}  (sha ${m.checksum})`)
    else if (rec.checksum !== m.checksum)
      console.log(`DRIFT ${m.file}  账目 ${rec.checksum} ≠ 当前 ${m.checksum} —— 历史迁移被修改，禁止；请新增迁移文件`)
    else console.log(`DONE  ${m.file}  (${rec.appliedAt}${rec.note ? ' ' + rec.note : ''})`)
  }
  return rows.filter((m) => !byName.has(m.file))
}

const all = migrations()
const mode = target()

if (cmd === 'status') {
  ensureLedger()
  const ledger = applied() ?? []
  const pending = report(all, ledger)
  console.log(`\n==== ${mode}：${all.length - pending.length} 已应用 / ${pending.length} 待应用 / 共 ${all.length} ====`)
  if (all.some((m) => ledger.find((r) => r.name === m.file && r.checksum !== m.checksum))) process.exit(1)
  process.exit(0)
}

if (cmd === 'apply') {
  ensureLedger()
  const ledger = applied() ?? []
  const pending = report(all, ledger)
  const drifted = all.filter((m) => ledger.some((r) => r.name === m.file && r.checksum !== m.checksum))
  if (drifted.length) {
    console.log(`FAIL  ${drifted.length} 个已应用迁移的内容被修改：${drifted.map((m) => m.file).join(', ')}`)
    console.log('      正确做法：新增一个迁移文件修正，不要改历史。')
    process.exit(1)
  }
  if (!pending.length) {
    console.log(`\n==== 结果: ${all.length} 已应用 / 0 待应用，无需执行 ====`)
    process.exit(0)
  }
  if (mode === 'remote') await confirmRemote(pending)
  let ok = 0
  for (const m of pending) {
    try {
      d1File(join(dbDir, m.file), { quiet: true })
      d1(`INSERT INTO ${LEDGER} (name, checksum, appliedAt, note) VALUES ('${m.file}', '${m.checksum}', '${new Date().toISOString()}', '${mode}')`)
      console.log(`APPLIED ${m.file}`)
      ok += 1
    } catch (e) {
      console.log(`FAIL  ${m.file} — ${String(e.message).slice(0, 300)}`)
      console.log('      迁移未记账，修好后重跑本命令会从头跳过已完成项（账目只记成功）。')
      process.exit(1)
    }
  }
  console.log(`\n==== 结果: ${ok} 新应用 / ${all.length - ok} 已是最新（目标：${mode}）====`)
  process.exit(0)
}

if (cmd === 'mark') {
  const file = args[1]
  if (!file) fail('用法: migrate.mjs mark <migrate-xxx.sql> --local|--remote --reason "..."')
  const m = all.find((x) => x.file === file)
  if (!m) fail(`未找到迁移文件 ${file}（可选：${all.map((x) => x.file).join(', ')}）`)
  const reasonIdx = args.indexOf('--reason')
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : '历史迁移（DDL 已在账目启用前人工执行）'
  ensureLedger()
  const ledger = applied() ?? []
  if (ledger.some((r) => r.name === file)) {
    console.log(`SKIP  ${file} 已在账目中 (${ledger.find((r) => r.name === file).appliedAt})`)
    process.exit(0)
  }
  d1(`INSERT INTO ${LEDGER} (name, checksum, appliedAt, note) VALUES ('${file}', '${m.checksum}', '${new Date().toISOString()}', '回记：${reason}')`)
  console.log(`MARKED ${file} 未执行 DDL，仅回记账目（${reason}）`)
  process.exit(0)
}

// baseline 的安全阀：只允许回记"对象在该库确实已存在"的迁移。
// 反例（本仓 2026-09-24 实测踩过）：无脑把全部迁移记为基线，会把**尚未执行**的新迁移
// 一起吞掉——apply 随后显示 0 待应用，列永远不建，代码上线直接 no column named。
function parseDdlTargets(sqlText) {
  const clean = sqlText.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  const targets = []
  for (const stmt of clean.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const t = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(stmt)
      || /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)/i.exec(stmt)
    if (t) { targets.push({ kind: /INDEX/i.test(stmt) ? 'index' : 'table', name: t[1] }); continue }
    const a = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(stmt)
    if (a) { targets.push({ kind: 'column', table: a[1], name: a[2] }); continue }
    if (/^(UPDATE|INSERT|DELETE|PRAGMA)\b/i.test(stmt)) continue
    targets.push({ kind: 'unknown', name: stmt.slice(0, 50) })
  }
  return targets
}

function catalog() {
  const rows = d1('SELECT type, name, sql FROM sqlite_master')
  const names = new Set(rows.map((r) => r.name))
  const ddl = new Map(rows.filter((r) => r.type === 'table').map((r) => [r.name, String(r.sql || '')]))
  return { names, ddl }
}

function migrationIsApplied(m, cat) {
  for (const t of parseDdlTargets(m.text)) {
    if (t.kind === 'table' || t.kind === 'index') { if (!cat.names.has(t.name)) return `缺 ${t.kind} ${t.name}` }
    else if (t.kind === 'column') {
      const sql = cat.ddl.get(t.table) || ''
      if (!new RegExp(`\\b${t.name}\\b`).test(sql)) return `缺列 ${t.table}.${t.name}`
    } else return `未识别 DDL：${t.name}`
  }
  return null
}

// 共用标记循环：把"对象确实已在本库"的迁移记入账目（不执行任何 DDL）。
// baseline 与 bootstrap 都走这一份实现，避免两条通道对"什么算已就位"各说各话。
function markExisting(reason) {
  ensureLedger()
  const ledger = applied() ?? []
  const cat = catalog()
  let marked = 0
  const skipped = []
  for (const m of all) {
    if (ledger.some((r) => r.name === m.file)) continue
    const missing = migrationIsApplied(m, cat)
    if (missing) { skipped.push(`${m.file}（${missing}）`); continue }
    d1(`INSERT INTO ${LEDGER} (name, checksum, appliedAt, note) VALUES ('${m.file}', '${m.checksum}', '${new Date().toISOString()}', '${reason}')`)
    console.log(`BASELINED ${m.file}`)
    marked += 1
  }
  for (const s of skipped) console.log(`SKIP ${s} —— 对象不在本库，属未执行迁移，不记基线`)
  return { marked, skipped }
}

// Flyway 的 baseline 语义：给"库已存在（由 schema.sql 全量建好 / 迁移早已人工跑过）"
// 的存量库建立起点，避免把历史迁移重放一遍（裸 ALTER 重放必报错）。
if (cmd === 'baseline') {
  const reasonIdx = args.indexOf('--reason')
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : '基线：本库对象已就位，历史迁移不回重放'
  const { marked, skipped } = markExisting(reason)
  console.log(`\n==== ${mode}：${marked} 个历史迁移记为基线（未执行任何 DDL）/ ${skipped.length} 个待应用 ====`)
  process.exit(0)
}

// 全新 D1 的起点。为什么 baseline 不够：baseline 只记"对象已在本库"的迁移，
// 而对空库 7 个迁移全部不满足 ⇒ 它会把 7 个都 SKIP，随后 apply 仍会在
// `ALTER TABLE products ...` 上撞 `no such table: products`（第十三轮实测 5/7 失败）。
// ⇒ 空库必须先由 schema.sql 建全量，再把历史迁移记满账，此后才轮到新迁移走 apply。
if (cmd === 'bootstrap') {
  ensureLedger()
  const cat = catalog()
  const userTables = [...cat.names].filter((n) => !n.startsWith('sqlite_') && n !== LEDGER)
  if (userTables.length) {
    fail(`bootstrap 只用于空库；目标(${mode}) 已有 ${userTables.length} 张业务表：`
      + `${userTables.slice(0, 6).join(', ')}${userTables.length > 6 ? ' …' : ''}`
      + ' —— 存量库请走 baseline，禁止拿全量基线覆盖既有数据')
  }
  if (mode === 'remote') await confirmRemote([{ file: 'db/schema.sql（全量基线，并把既有迁移记入账目）' }])
  d1File(join(dbDir, 'schema.sql'), { quiet: true })
  const { marked, skipped } = markExisting('基线：本库由 schema.sql 全新建立')
  console.log(`\n==== bootstrap 完成（${mode}）：schema.sql 已灌入 / ${marked} 个历史迁移记入账目 / ${skipped.length} 个未就位 ====`)
  if (skipped.length) {
    console.log('   ⚠️ 有迁移未记入账目 = schema.sql 没覆盖到它的对象，请核对真相源是否漏同步。')
  }
  process.exit(0)
}

fail(`未知子命令 ${cmd}（可用：status | apply | mark | baseline | bootstrap）`)

// 生产迁移是不可逆动作：非交互环境（CI）直接拒执行，交互式要求逐字输入库名。
async function confirmRemote(pending) {
  console.log(`\n⚠️  即将对**生产** D1（supermarket）执行 ${pending.length} 个迁移：${pending.map((m) => m.file).join(', ')}`)
  console.log('   前置铁律（chaoshi-web-deploy skill）：先全量导出备份并确认文件大小非 0。')
  // --yes 必须先判：否则自动化（stdin 非 TTY）永远进不去，显式授权形同虚设（2026-09-24 实测踩到）
  if (args.includes('--yes')) {
    console.log('   已给出 --yes（自动化场景），继续。')
    return
  }
  if (!process.stdin.isTTY) fail('非交互环境且未给 --yes，拒绝执行生产迁移。')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((res) => rl.question('   输入 supermarket 确认执行：', res))
  rl.close()
  if (answer.trim() !== 'supermarket') fail('确认串不匹配，已中止。')
}
