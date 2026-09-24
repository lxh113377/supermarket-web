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

// Flyway 的 baseline 语义：给"库已存在（由 schema.sql 全量建好 / 迁移早已人工跑过）"
// 的存量库建立起点，避免把历史迁移重放一遍（裸 ALTER 重放必报错）。
if (cmd === 'baseline') {
  ensureLedger()
  const ledger = applied() ?? []
  const reasonIdx = args.indexOf('--reason')
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : '基线：本库对象已就位，历史迁移不回重放'
  let marked = 0
  for (const m of all) {
    if (ledger.some((r) => r.name === m.file)) continue
    d1(`INSERT INTO ${LEDGER} (name, checksum, appliedAt, note) VALUES ('${m.file}', '${m.checksum}', '${new Date().toISOString()}', '${reason} (pre-${mode})')`)
    console.log(`BASELINED ${m.file}`)
    marked += 1
  }
  console.log(`\n==== ${mode}：${marked} 个历史迁移已记为基线（未执行任何 DDL）====`)
  process.exit(0)
}

fail(`未知子命令 ${cmd}（可用：status | apply | mark | baseline）`)

// 生产迁移是不可逆动作：非交互环境（CI）直接拒执行，交互式要求逐字输入库名。
async function confirmRemote(pending) {
  const isTty = process.stdin.isTTY && !args.includes('--yes')
  console.log(`\n⚠️  即将对**生产** D1（supermarket）执行 ${pending.length} 个迁移：${pending.map((m) => m.file).join(', ')}`)
  console.log('   前置铁律（chaoshi-web-deploy skill）：先全量导出备份并确认文件大小非 0。')
  if (!isTty) fail('非交互环境禁止自动执行生产迁移（需 TTY 确认或显式 --yes）。')
  if (args.includes('--yes')) {
    console.log('   --yes 已给出，继续。')
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((res) => rl.question('   输入 supermarket 确认执行：', res))
  rl.close()
  if (answer.trim() !== 'supermarket') fail('确认串不匹配，已中止。')
}
