// @vitest-environment node
/**
 * 迁移基线与逐字段复放对账门禁的夹具（对标第十三轮 R13-H1）
 *
 * 每条反例都只绑一条判据（A1/A2/A3/A4），否则"全部被拦"可以是假的（同族教训：
 * 变异体必须各有专属输入面）。另有一组**双门禁对照**：同一份类型漂移夹具，
 * 既有 `check-schema-drift.mjs` 必须判过、本门禁必须判红 —— 这才叫升级而不是重复。
 */
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  judge, normalizeSchema, shapeDiff, applySql, BASELINE_ERA, NON_MIGRATION_SQL,
} from '../scripts/verify-migrate-replay.mjs'

const SCHEMA = readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8')
const REAL = ['migrate-ai-calls.sql', 'migrate-fix.sql', 'migrate-idempotency.sql',
  'migrate-optimize-indexes.sql', 'migrate-security.sql', 'migrate-spec-options.sql',
  'migrate-stock.sql'].map((f) => ({ file: f, text: readFileSync(join(process.cwd(), 'db', f), 'utf8') }))

const files = (extra) => [...REAL, extra]
const mig = (file, text) => ({ file, text })

describe('verify-migrate-replay 正例', () => {
  it('真实仓：基线可重建 + 7 个历史迁移全部豁免 + 无前向迁移 ⇒ 零问题', () => {
    const r = judge({ files: REAL, schemaSql: SCHEMA })
    expect(r.problems, r.problems.join('\n   ')).toEqual([])
    expect(r.stats.waived).toBe(BASELINE_ERA.size)
    expect(r.stats.forward).toBe(0)
  })

  it('幂等的前向迁移（CREATE TABLE IF NOT EXISTS 且已同步真相源）⇒ 仍判过', () => {
    const schema = SCHEMA + '\nCREATE TABLE IF NOT EXISTS zz_probe (id INTEGER PRIMARY KEY, note TEXT);\n'
    const r = judge({
      files: files(mig('migrate-zz.sql', 'CREATE TABLE IF NOT EXISTS zz_probe (id INTEGER PRIMARY KEY, note TEXT);')),
      schemaSql: schema,
    })
    expect(r.problems, r.problems.join('\n   ')).toEqual([])
    expect(r.stats.forward).toBe(1)
  })
})

describe('verify-migrate-replay 反例（每条只绑一条判据）', () => {
  it('A1 迁移面为空 ⇒ 判据自身异常，绝不静默通过', () => {
    const r = judge({ files: [], schemaSql: SCHEMA })
    expect(r.problems.join()).toContain('A1')
    expect(r.stats).toBe(null)
  })

  it('A2 真相源缺失 ⇒ 红（读不到 schema.sql 不等于无需对账）', () => {
    const r = judge({ files: REAL, schemaSql: '   ' })
    expect(r.problems.join()).toContain('schema.sql')
  })

  it('A3 裸 ALTER 的新迁移 ⇒ 第二次重放必炸，被幂等纪律拦住', () => {
    const r = judge({
      files: files(mig('migrate-naked.sql', 'ALTER TABLE products ADD COLUMN zz_color TEXT;')),
      schemaSql: SCHEMA,
    })
    const a3 = r.problems.filter((p) => p.startsWith('A3'))
    expect(a3.join('\n')).toContain('第二次重放失败')
    expect(a3.join('\n')).toContain('migrate-naked.sql')
  })

  it('A4 前向迁移引入的对象没回写真相源 ⇒ 双向对账不闭合（且不误报 A3）', () => {
    const r = judge({
      files: files(mig('migrate-orphan.sql', 'CREATE TABLE IF NOT EXISTS zz_orphan (id INTEGER PRIMARY KEY);')),
      schemaSql: SCHEMA,
    })
    expect(r.problems.filter((p) => p.startsWith('A4')).join('\n')).toContain('zz_orphan')
    expect(r.problems.filter((p) => p.startsWith('A3'))).toEqual([])
  })

  it('A4 列的**类型/非空/默认值**漂移也判红（既有 verify:schema 明确放弃的那一类）', () => {
    const drifted = SCHEMA.replace(
      /(CREATE TABLE IF NOT EXISTS products[\s\S]*?stock\s+)INTEGER/, '$1TEXT')
    expect(drifted).not.toBe(SCHEMA)
    const ref = new DatabaseSync(':memory:'); ref.exec(SCHEMA)
    const bad = new DatabaseSync(':memory:'); bad.exec(drifted)
    const lines = shapeDiff(normalizeSchema(ref), normalizeSchema(bad), '真相源', '漂移库')
    expect(lines.join('\n')).toMatch(/products\.stock 定义不一致/)
    ref.close(); bad.close()
  })

  it('基线期豁免是**白名单**：不在清单里的历史文件同样要过幂等纪律', () => {
    expect(BASELINE_ERA.has('migrate-brand-new.sql')).toBe(false)
    const r = judge({
      files: files(mig('migrate-brand-new.sql', 'ALTER TABLE orders ADD COLUMN zz_x TEXT;')),
      schemaSql: SCHEMA,
    })
    expect(r.problems.filter((p) => p.startsWith('A3')).join('\n')).toContain('migrate-brand-new.sql')
  })
})

describe('辅助函数与 CLI 退出码', () => {
  it('applySql 逐语句收集错误（不中断、不吞）', () => {
    const db = new DatabaseSync(':memory:')
    const errs = applySql(db, 'CREATE TABLE ok (id INTEGER); SELECT * FROM nope;')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('nope')
    db.close()
  })

  it('shapeDiff 对索引列序与唯一性敏感', () => {
    const a = { 'I:idx': { table: 't', columns: ['x', 'y'], unique: true } }
    const b = { 'I:idx': { table: 't', columns: ['y', 'x'], unique: true } }
    expect(shapeDiff(a, b, 'A', 'B').join()).toContain('索引不一致')
  })

  it('CLI：夹具仓里漂移未回写 ⇒ exit 1；无迁移文件 ⇒ exit 1；无 db 目录 ⇒ exit 2', () => {
    const tmp = join(tmpdir(), `mr_${Date.now()}`)
    mkdirSync(join(tmp, 'db'), { recursive: true })
    // 脚本按**自身位置的上一层**锚仓库根（scripts/ → 仓根），夹具必须复刻这个层级，
    // 否则它找的是 tmp/../db —— 那正是第九轮记下的"runGate 只改 cwd 仍扫真仓"同族坑。
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    const src = 'scripts/verify-migrate-replay.mjs'
    copyFileSync(src, join(tmp, 'scripts', 'verify-migrate-replay.mjs'))
    copyFileSync('scripts/verify-backup-restore.mjs', join(tmp, 'scripts', 'verify-backup-restore.mjs'))
    writeFileSync(join(tmp, 'db', 'schema.sql'), SCHEMA, 'utf8')
    writeFileSync(join(tmp, 'db', 'migrate-orphan2.sql'),
      'CREATE TABLE IF NOT EXISTS zz_orphan2 (id INTEGER PRIMARY KEY);\n', 'utf8')
    const run = () => execFileSync(process.execPath, [join(tmp, 'scripts', 'verify-migrate-replay.mjs')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    let rc = 0
    let out = ''
    try { out = run() } catch (e) { rc = e.status }
    expect(rc, out).toBe(1)

    rmSync(join(tmp, 'db', 'migrate-orphan2.sql'), { force: true })
    rc = 0
    try { run() } catch (e) { rc = e.status }
    expect(rc).toBe(1)                                   // A1 零输入即红

    rmSync(join(tmp, 'db'), { recursive: true, force: true })
    rc = 0
    try { run() } catch (e) { rc = e.status }
    expect(rc).toBe(2)                                   // 环境异常，不判"看起来一样就放行"
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe('A6/A7 文件契约（账本与门禁同一个正则，名字不合契约就双双隐形）', () => {
  const base = { files: REAL, schemaSql: SCHEMA }

  it('正例：真实 db/ 的全部契约外 *.sql（含 adhoc 与 4 个 rollback）⇒ 零问题', () => {
    const extras = readdirSync(join(process.cwd(), 'db'))
      .filter((f) => /\.sql$/.test(f) && !/^migrate-.*\.sql$/.test(f))
      .sort()
      .map((f) => ({ file: f, text: readFileSync(join(process.cwd(), 'db', f), 'utf8') }))
    expect(extras.length).toBeGreaterThan(0)                 // 分母由磁盘枚举，不许手抄
    const r = judge({ ...base, extraFiles: extras })
    expect(r.problems, r.problems.join('\n   ')).toEqual([])
  })

  it('A6 反例：契约外的新 *.sql 未登记豁免 ⇒ 判红并点名文件', () => {
    const r = judge({ ...base, extraFiles: [{ file: 'zz-sneaky-change.sql', text: 'ALTER TABLE products ADD COLUMN zz INT;' }] })
    expect(r.problems.join('\n')).toContain('A6 zz-sneaky-change.sql')
  })

  it('A7 反例：rollback 找不到正向件 ⇒ 判红（回滚件不许长期无人验证）', () => {
    const r = judge({ ...base, extraFiles: [{ file: 'rollback-nonexistent.sql', text: 'SELECT 1;' }] })
    expect(r.problems.join('\n')).toContain('A7 rollback-nonexistent.sql')
  })

  it('A6 豁免是登记表不是通配符：同一文件第二次出现仍要求在册', () => {
    expect(Object.keys(NON_MIGRATION_SQL)).toContain('adhoc-rename-order20.sql')
    const r = judge({ ...base, extraFiles: [{ file: 'adhoc-totally-new.sql', text: 'SELECT 1;' }] })
    expect(r.problems.join('\n')).toContain('adhoc-totally-new.sql')
  })
})

describe('双门禁对照：既有 verify:schema 放行的类型漂移，本门禁必须判红', () => {
  it('同一份夹具（products.stock 由 INTEGER 改 TEXT）——旧门禁 exit 0、新门禁 exit 1', () => {
    const tmp = join(tmpdir(), `mrcmp_${Date.now()}`)
    mkdirSync(join(tmp, 'db'), { recursive: true })
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    for (const s of ['check-schema-drift.mjs', 'verify-migrate-replay.mjs', 'verify-backup-restore.mjs']) {
      copyFileSync(join('scripts', s), join(tmp, 'scripts', s))
    }
    for (const f of REAL) copyFileSync(join('db', f.file), join(tmp, 'db', f.file))
    const drifted = SCHEMA.replace(/(CREATE TABLE IF NOT EXISTS products[\s\S]*?stock\s+)INTEGER/, '$1TEXT')
    expect(drifted).not.toBe(SCHEMA)                       // 锚点必须真的改到，否则整个对照是空的
    writeFileSync(join(tmp, 'db', 'schema.sql'), drifted, 'utf8')

    const run = (which) => {
      try {
        const out = execFileSync(process.execPath, [join(tmp, 'scripts', which)],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        return { rc: 0, out }
      } catch (e) {
        return { rc: e.status, out: (e.stdout || '') + (e.stderr || '') }
      }
    }
    const old = run('check-schema-drift.mjs')
    const neu = run('verify-migrate-replay.mjs')
    expect(old.rc, `既有门禁本应看不见类型漂移（它只比对象名）：${old.out.slice(-300)}`).toBe(0)
    expect(neu.rc, `新门禁必须判红：${neu.out.slice(-400)}`).toBe(1)
    rmSync(tmp, { recursive: true, force: true })
  })
})
