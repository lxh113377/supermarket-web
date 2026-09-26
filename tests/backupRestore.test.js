/**
 * 备份恢复演练判据的夹具（第十一轮 R11-H1）。
 * 关键约束：**绝不把真实生产 dump 放进仓里**（里面有客户微信号与订单），所以夹具用
 * `node:sqlite` 现造合成库再自写 mini-dumper 出文本 —— 形态与 wrangler 导出一致
 * （CREATE 段 + `INSERT INTO "t" (...) VALUES (...)` 行）。
 */
// @vitest-environment node
// ↑ 这三份测的是节点级门禁脚本（会 import node:sqlite），必须跑在 node 环境：
//   jsdom 环境下 Vite 会尝试 bundle `node:sqlite` ⇒ ubuntu runner 直接报错（本机侥幸通过，
//   CI 首跑抓到，第十一轮）。判据类测试不需要 DOM，声明 node 既更快也更诚实。
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  countInsertStatements, expectedTablesFromSchema, loadDump, judgeRestore,
} from '../scripts/verify-backup-restore.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_SQL = readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8')
const EXPECTED = expectedTablesFromSchema(SCHEMA_SQL)
const DIR = mkdtempSync(join(tmpdir(), 'r11-restore-'))

const lit = (v) => (v === null || v === undefined ? 'NULL'
  : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

/** 造一份"能恢复"的最小库并导出成 SQL 文本（products 默认 3 行）。 */
function makeDump({ productRows = 3, withProducts = true, extraTable = false } = {}) {
  const db = new DatabaseSync(':memory:')
  const ddl = SCHEMA_SQL
  db.exec(ddl)
  db.prepare('INSERT INTO categories (_id, name, type, "order", subcategories) VALUES (?,?,?,?,?)')
    .run('c_test', '测试分类', 'drink', 1, '["汽水"]')
  if (withProducts) {
    for (let i = 1; i <= productRows; i++) {
      db.prepare('INSERT INTO products (_id, name, price, subcategories, enabled, stock) VALUES (?,?,?,?,?,?)')
        .run(`p_${i}`, `测试商品${i}`, 3.5, '["汽水"]', 1, 10)
    }
  }
  db.prepare(`INSERT INTO schema_migrations (name, checksum, appliedAt, note) VALUES (?,?,?,?)`)
    .run('migrate-x.sql', 'abc', '2026-09-26T00:00:00.000Z', 'fixture')
  if (extraTable) db.exec(`CREATE TABLE ghost_table (id INTEGER PRIMARY KEY, tag TEXT)`)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name)
  const out = ['PRAGMA defer_foreign_keys=TRUE;', '']
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all()
    for (const r of rows) {
      const cols = Object.keys(r)
      out.push(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((c) => lit(r[c])).join(',')});`)
    }
  }
  db.close()
  // CREATE 段与建库用的 DDL 同源（mini-dumper 只重发行，不改真相源）
  return ddl.replace(/\s*$/, '\n') + out.join('\n')
}

function judge(text) {
  return judgeRestore({ loaded: loadDump(text), insertCount: countInsertStatements(text), expectedTables: EXPECTED })
}

describe('正例：合成 dump 必须可恢复', () => {
  it('零问题，且载入行数==文本 INSERT 数', () => {
    const text = makeDump()
    expect(judge(text)).toEqual([])
    const loaded = loadDump(text)
    const rows = Object.values(loaded.counts).reduce((a, b) => a + b, 0)
    expect(rows).toBe(countInsertStatements(text))
    expect(rows).toBeGreaterThan(0)
  })
  it('真值面自证：fixture 覆盖 schema.sql 声明的全部表（少一张就红）', () => {
    const loaded = loadDump(makeDump())
    for (const t of EXPECTED) expect(Object.keys(loaded.counts), `夹具缺表 ${t}`).toContain(t)
    expect([...EXPECTED].length).toBeGreaterThanOrEqual(9)
  })
})

describe('反例：六类坏备份必须各点名一次', () => {
  it('①a 截断在末条 INSERT 中途 ⇒ 判"不是可恢复备份"（实测 sqlite 抛 incomplete input，不静默丢行）', () => {
    const lines = makeDump().split('\n')
    const last = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith('INSERT INTO')).pop()[1]
    lines[last] = lines[last].slice(0, Math.floor(lines[last].length / 2))
    const problems = judge(lines.join('\n'))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('无法载入')
  })
  it('①c 计数不变量本身可反证：文本语句数 ≠ 载入行数即红（纯函数层，不依赖 sqlite 宽容）', () => {
    const problems = judgeRestore({
      loaded: { ok: true, integrity: 'ok', fkViolations: 0, counts: { products: 3, categories: 1 } },
      insertCount: 7,
      expectedTables: new Set(['products', 'categories']),
    })
    expect(problems.join()).toContain('载入行数 4 ≠ dump 文本 INSERT 数 7')
  })
  it('①d 语句级计数：一行塞两条 INSERT 也只按语句计（防"字段值里有 INSERT INTO 字样"误计）', () => {
    const twoOnOneLine = `INSERT INTO "t" (a) VALUES ('x'); INSERT INTO "t" (a) VALUES ('INSERT INTO 冒牌货');`
    expect(countInsertStatements(twoOnOneLine)).toBe(2)
    expect(countInsertStatements(`-- INSERT INTO 注释里的假语句\nINSERT INTO "t" (a) VALUES ('y');`)).toBe(1)
  })
  it('①b 截断在 DDL 段 ⇒ 缺表或载入失败，两条路都跑不掉', () => {
    const lines = makeDump().split('\n')
    const cut = lines.slice(0, Math.floor(lines.length * 0.45)).join('\n')
    expect(judge(cut).join()).toMatch(/备份缺表|无法载入/)
  })
  it('② 只有 schema 没有数据（0 INSERT 的尸体）', () => {
    const p = judge(SCHEMA_SQL)
    expect(p.join()).toContain('0 条 INSERT')
  })
  it('③ 语法被破坏 ⇒ 判"不是可恢复备份"而不是抛出去', () => {
    const text = makeDump().replace('INSERT INTO "products"', 'INSERT BROKEN INTO "products"')
    const p = judge(text)
    expect(p.length).toBeGreaterThan(0)
    expect(p.join()).toContain('无法载入')
  })
  it('④ 缺表（备份比真相源少一张）⇒ 点名缺哪张', () => {
    // 走纯函数层：从真实 schema.sql 里剥掉 products 的 CREATE 会让外键/索引一起塌（sqlite 直接
    // 报 no such table），那测的就不是"缺表判定"而是夹具自己了。
    const counts = { categories: 1, orders: 1, reviews: 0, submissions: 0, schema_migrations: 1 }
    const problems = judgeRestore({
      loaded: { ok: true, integrity: 'ok', fkViolations: 0, counts },
      insertCount: Object.values(counts).reduce((a, b) => a + b, 0),
      expectedTables: EXPECTED,
    })
    expect(problems.join()).toContain('备份缺表：products')
  })
  it('⑤ 多出一张真相源没有的表（schema 漂移）', () => {
    const text = makeDump({ extraTable: true }) + '\nCREATE TABLE ghost_table (id INTEGER PRIMARY KEY, tag TEXT);\n'
    expect(judge(text).join()).toContain('ghost_table')
  })
  it('⑥ 目录表为空 ⇒ 恢复出去是白屏站', () => {
    const text = makeDump({ productRows: 0 })
    expect(judge(text).join()).toContain('关键表 products 为空')
  })
})

describe('CLI 退出码：零输入绝不记绿', () => {
  const script = join(ROOT, 'scripts', 'verify-backup-restore.mjs')
  const run = (args, env = {}) => {
    try {
      return { rc: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }) }
    } catch (e) {
      return { rc: e.status, out: String(e.stdout || '') + String(e.stderr || '') }
    }
  }
  it('缺参数 ⇒ exit 2（不是 0）', () => {
    const r = run([])
    expect(r.rc).toBe(2)
    expect(r.out).toContain('参数缺失')
  })
  it('文件不存在 ⇒ exit 2 且明说绝不静默记绿', () => {
    const r = run([join(DIR, 'nope.sql')])
    expect(r.rc).toBe(2)
    expect(r.out).toContain('不存在或为空')
  })
  it('好备份 ⇒ exit 0 并打印逐表行数', () => {
    const f = join(DIR, 'good.sql')
    writeFileSync(f, makeDump(), 'utf8')
    const r = run([f])
    expect(r.rc).toBe(0)
    expect(r.out).toContain('OK 备份可恢复')
    expect(r.out).toContain('products=3')
  })
  it('坏备份 ⇒ exit 1（判据红，不放宽）', () => {
    const f = join(DIR, 'empty.sql')
    writeFileSync(f, SCHEMA_SQL, 'utf8')
    expect(run([f]).rc).toBe(1)
  })
})
