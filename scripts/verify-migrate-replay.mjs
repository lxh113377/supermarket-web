#!/usr/bin/env node
/**
 * 迁移基线与逐字段复放对账门禁（对标第十三轮 R13-H1）
 *
 * 为什么要这一道（全部是当轮实测，不是推测）：
 *  1. **新库建不出来**：把 `db/migrate-*.sql` 按序灌进空库，7 个文件里 **5 个直接报错**
 *     （`no such table: products` / `orders`）——它们都是"在既有库上打补丁"的增量。
 *     而 `scripts/migrate.mjs apply` 在全新 D1（空账本）上走的正是这条路 ⇒ 半途崩，
 *     且崩在哪个文件取决于排序，等于"新环境能不能起来"没有答案。
 *  2. **既有 `verify:schema` 有意不管的两件事**：它自己的注释写着"只保证列存在，
 *     类型漂移由人工评审兜底"，且反方向（schema.sql 有、迁移没有）声明为合法不检查。
 *     于是 `TEXT NOT NULL` vs `TEXT`、`DEFAULT -1` vs 无默认、索引列序不同，全都静默通过。
 *
 * 本门禁补的是**结构级双向对账**（零凭据、离线、node:sqlite）：
 *   A1 零输入即红：没有迁移文件 ⇒ 判据自己坏了，不许当通过。
 *   A2 基线重建：空库 → 灌 `schema.sql` → 逐字段（类型/非空/默认值/主键位）+ 索引（表·列序·唯一）
 *      必须与 `schema.sql` 的归一化形态**完全相等**（这条同时钉住"基线通道确实可用"）。
 *   A3 幂等纪律：**非基线期**的迁移必须能在基线库上连跑两次不出错（裸 ALTER 第二次必炸 ⇒ 拦住）。
 *      基线期文件（账本表出现之前已人工执行、内含裸 ALTER）逐条点名豁免，豁免清单见 BASELINE_ERA。
 *   A5 迁移里**声明**的列定义（类型/非空/默认值）必须与真相源一致 —— 既有 `verify:schema`
 *      的注释明说这类"由人工评审兜底"，本轮改成机器判。
 *   A6 契约外 `db/*.sql` 必须逐条点名豁免，否则判红（账本与门禁都只认 `^migrate-.*\.sql$`
 *      ⇒ 名字不合契约的迁移对两者同时隐形；本仓实测已有一例）。
 *   A7 每个 `rollback-*.sql` 必须找得到对应正向件（含 A6 豁免登记），否则判红。
 *   A4 双向对账：跑完全部非基线期迁移后，结构仍须等于 `schema.sql`
 *      —— 即"写了迁移就必须同步回真相源"，多写少写都判红。
 *
 *   node scripts/verify-migrate-replay.mjs      # 退出码 0=一致 / 1=漂移或不合规 / 2=输入异常
 */
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitStatements } from './verify-backup-restore.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbDir = join(root, 'db')
export const LIMIT_HINT = 'db/schema.sql 为真相源；新增迁移须同时回写它，且不得用裸 ALTER'

/**
 * 基线期豁免清单（**逐条点名，不许扩面**）。
 * 判据：这些文件写于 `schema_migrations` 账本表出现之前，内容是对已上线库的裸 ALTER，
 * 第二次执行必然 `duplicate column` —— 它们只作为历史存在，不承担"重建新库"的义务。
 * 新迁移**不得**加入本清单（A3 会要求它可重放两次）；若确需扩充，必须在 CHANGELOG 写明
 * 该文件已在线上执行过的证据，否则视为绕过纪律。
 */
export const BASELINE_ERA = new Set([
  'migrate-ai-calls.sql',
  'migrate-fix.sql',
  'migrate-idempotency.sql',
  'migrate-optimize-indexes.sql',
  'migrate-security.sql',
  'migrate-spec-options.sql',
  'migrate-stock.sql',
])

/**
 * 契约外 *.sql 的**逐条点名豁免**（键 = 文件名）。写在这里等于承认"它不受账本管辖"，
 * 而不是让它静默隐形 —— 未登记的契约外文件由 A6 判红。
 */
export const NON_MIGRATION_SQL = {
  'adhoc-rename-order20.sql': {
    pair: 'rename-order20',
    reason: '一次性数据订正（改商品名），无 schema 对象；当年人工执行，从未进 migrate-* 契约 ⇒ 账本看不见它',
  },
}

const normType = (t) => String(t || '').replace(/\s+/g, '').toUpperCase()
const normDefault = (d) => (d === null || d === undefined ? null : String(d).trim())

/** 归一化结构：表→列(类型/非空/默认值/主键序)，索引→(表/列序/是否唯一) */
export function normalizeSchema(db) {
  const shape = {}
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((r) => r.name)
  for (const t of tables) {
    const cols = {}
    for (const c of db.prepare(`PRAGMA table_info("${t}")`).all()) {
      cols[c.name] = { type: normType(c.type), notnull: !!c.notnull, dflt: normDefault(c.dflt_value), pk: c.pk }
    }
    shape[`T:${t}`] = cols
  }
  for (const t of tables) {
    for (const i of db.prepare(`PRAGMA index_list("${t}")`).all()) {
      if (i.name.startsWith('sqlite_autoindex')) continue   // 隐式索引不属显式 DDL，两边都不记
      const cols = db.prepare(`PRAGMA index_info("${i.name}")`).all()
        .sort((a, b) => a.seqno - b.seqno).map((r) => r.name)
      shape[`I:${i.name}`] = { table: t, columns: cols, unique: !!i.unique }
    }
  }
  return shape
}

/** 结构差集（双向）。返回人类可读行，供 A2/A4 复用。 */
export function shapeDiff(a, b, labelA = 'A', labelB = 'B') {
  const out = []
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[key], y = b[key]
    if (!x) { out.push(`${labelB} 多出 ${key}（${labelA} 没有）`); continue }
    if (!y) { out.push(`${labelA} 有 ${key}，${labelB} 缺`); continue }
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      if (key.startsWith('T:')) {
        const cn = [...new Set([...Object.keys(x), ...Object.keys(y)])]
        for (const c of cn.sort()) {
          if (JSON.stringify(x[c]) !== JSON.stringify(y[c])) {
            out.push(`${key}.${c} 定义不一致 ${labelA}=${JSON.stringify(x[c] ?? null)} ${labelB}=${JSON.stringify(y[c] ?? null)}`)
          }
        }
      } else {
        out.push(`${key} 索引不一致 ${labelA}=${JSON.stringify(x)} ${labelB}=${JSON.stringify(y)}`)
      }
    }
  }
  return out
}

/** 解析 `ALTER TABLE t ADD COLUMN c <类型/默认/非空>`；迁移不写类型时返回 null（不猜）。 */
export function parseAddedColumn(stmt) {
  const m = /^ALTER TABLE (\w+) ADD COLUMN (\w+)(.*)$/i.exec(stmt.replace(/\s+/g, ' ').trim())
  if (!m) return null
  const tail = m[3].trim()
  const def = /\bDEFAULT\s+('[^']*'|"[^"]*"|-?[\w.]+(?:\(\d+(?:,\d+\))?)?)/i.exec(tail)
  const typeM = /^([A-Z]+(?:\(\d+(?:,\d+)?\))?)/i.exec(tail)
  return {
    table: m[1], column: m[2],
    type: typeM && typeM[1] ? normType(typeM[1]) : null,
    notnull: /\bNOT NULL\b/i.test(tail) || /\bPRIMARY KEY\b/i.test(tail) ? true : null,
    dflt: def ? normDefault(def[1]) : null,
  }
}

/** 逐语句执行；返回失败列表（含语句前 70 字，便于定位） */
export function applySql(db, sqlText) {
  const errs = []
  for (const st of splitStatements(sqlText)) {
    try {
      db.exec(st)
    } catch (e) {
      errs.push(`${st.replace(/\s+/g, ' ').slice(0, 70)} ⇒ ${String(e.message).slice(0, 80)}`)
    }
  }
  return errs
}

/**
 * 纯函数判定（测试可直接喂文本，不碰磁盘）。
 * files: [{file, text}]；schemaSql: db/schema.sql 全文。
 */
export function judge({ files, schemaSql, extraFiles = [] }) {
  const problems = []
  const notes = []
  if (!schemaSql || !schemaSql.trim()) {
    return { problems: ['读不到 db/schema.sql（真相源缺失 ≠ 无需对账）'], notes, stats: null }
  }
  if (!files || files.length === 0) {
    return { problems: ['A1 未发现任何 db/migrate-*.sql —— 迁移面为空，判据自身异常，不判通过'], notes, stats: null }
  }

  const ref = new DatabaseSync(':memory:')
  ref.exec(schemaSql)
  const reference = normalizeSchema(ref)
  ref.close()

  // A2：基线通道 —— 空库灌 schema.sql 必须逐字段等于真相源
  const base = new DatabaseSync(':memory:')
  const bootErrs = applySql(base, schemaSql)
  if (bootErrs.length) {
    problems.push(`A2 基线灌入 schema.sql 自身失败 ${bootErrs.length} 条：${bootErrs[0]}`)
  }
  const afterBoot = normalizeSchema(base)
  for (const line of shapeDiff(reference, afterBoot, 'schema.sql', '基线库')) {
    problems.push(`A2 基线重建不忠实：${line}`)
  }

  const forward = files.filter((f) => !BASELINE_ERA.has(f.file))
  const waived = files.filter((f) => BASELINE_ERA.has(f.file)).map((f) => f.file)
  notes.push(`A3 基线期豁免 ${waived.length} 个：${waived.join(', ') || '（无）'}`)
  notes.push(`A3 需可重放两次的前向迁移 ${forward.length} 个：${forward.map((f) => f.file).join(', ') || '（暂无）'}`)

  // A3：前向迁移幂等（连跑两次）
  for (const f of forward) {
    const once = applySql(base, f.text)
    if (once.length) problems.push(`A3 ${f.file} 第一次重放即失败：${once[0]}`)
    const twice = applySql(base, f.text)
    if (twice.length) problems.push(`A3 ${f.file} 第二次重放失败（裸 ALTER 不可重放，禁止静默上线）：${twice[0]}`)
  }

  // A5：迁移里**声明**的列定义必须与真相源逐字段一致 —— 既有 `verify:schema` 的注释
  //      明说"只保证列存在，类型漂移由人工评审兜底"，本条就是去补那个兜底没接住的洞。
  let colDefs = 0
  for (const f of files) {
    for (const st of splitStatements(f.text)) {
      const ac = parseAddedColumn(st)
      if (!ac) continue
      const cols = reference[`T:${ac.table}`]
      if (!cols) { problems.push(`A5 ${f.file} 往不存在的表加列：${ac.table}.${ac.column}`); continue }
      const col = cols[ac.column]
      if (!col) { problems.push(`A5 ${f.file} 的 ${ac.table}.${ac.column} 没回写真相源`); continue }
      colDefs += 1
      if (ac.type && col.type !== ac.type) {
        problems.push(`A5 ${ac.table}.${ac.column} 类型漂移：迁移=${ac.type} 真相源=${col.type}（${f.file}）`)
      }
      if (ac.notnull !== null && !!col.notnull !== ac.notnull) {
        problems.push(`A5 ${ac.table}.${ac.column} 非空漂移：迁移=${ac.notnull} 真相源=${col.notnull}（${f.file}）`)
      }
      if (ac.dflt !== null && col.dflt !== ac.dflt) {
        problems.push(`A5 ${ac.table}.${ac.column} 默认值漂移：迁移=${JSON.stringify(ac.dflt)} 真相源=${JSON.stringify(col.dflt)}（${f.file}）`)
      }
    }
  }
  notes.push(`A5 逐字段核对加列语句 ${colDefs} 条（类型·非空·默认值）`)

  // A6/A7 文件契约（对标 Saleor 的"新增路径必须被看见"式判据）：
  //   账本与门禁都只认 `^migrate-.*\.sql$` ⇒ 落在契约外的迁移文件对两者**同时隐形**。
  //   本仓实测有一例：`db/adhoc-rename-order20.sql`（一条 UPDATE 改商品名，配套
  //   `rollback-rename-order20.sql`）——它确实改过线上，却从没进过账本。
  //   处理：A6 未知 *.sql 必须逐条点名豁免（不许静默隐形）；A7 每个 rollback 必须有同名正向件。
  for (const f of (extraFiles || [])) {
    if (NON_MIGRATION_SQL[f.file]) continue
    if (/^migrate-.*\.sql$/.test(f.file) || /^rollback-.*\.sql$/.test(f.file)) continue
    if (f.file === 'schema.sql' || f.file === 'seed.sql') continue
    problems.push(`A6 ${f.file} 落在迁移契约之外且未登记豁免 ⇒ 账本与门禁双双看不见它`
      + '（正解：改名成 migrate-*.sql 走账本，或在 NON_MIGRATION_SQL 里写清它为什么不算迁移）')
  }
  const forwardNames = new Set(files.map((f) => f.file.replace(/^migrate-/, '')
    .replace(/\.sql$/, '')))
  for (const f of (extraFiles || [])) {
    const m = /^rollback-(.+)\.sql$/.exec(f.file)
    if (!m) continue
    const declared = Object.values(NON_MIGRATION_SQL).some((v) => v.pair === m[1])
    if (!forwardNames.has(m[1]) && !declared) {
      problems.push(`A7 ${f.file} 找不到对应的正向迁移（既不在 migrate-* 里，也不在豁免登记里）`
        + ` ⇒ 回滚件从未被任何通道验证过（键：${m[1]}）`)
    }
  }

  // ── A8/A9（第十六轮）回滚件的执行验证：自写下起零执行证据，本轮补上 ─────────
  // 结构轨的对象清单是**具名**的（不靠正则从 SQL 里猜要删什么），正向件按谓词挑语句回来对数，
  // 两条轨都覆盖不到的回滚件一律判红（承第十五轮 B7「未归类默认落进判据面」的 fail-closed 立场）。
  const ROLLBACK_STRUCTURAL = {
    'rollback-idempotency.sql': {
      forward: 'migrate-idempotency.sql',
      objects: [{ table: 'orders', column: 'idempotencyKey' }, { table: 'orders', index: 'idx_orders_idempotency' }],
    },
    'rollback-spec-options.sql': {
      forward: 'migrate-spec-options.sql',
      objects: [{ table: 'products', column: 'specOptions' }],
    },
    'rollback-stock.sql': {
      forward: 'migrate-stock.sql',
      objects: [{ table: 'products', column: 'stock' }],
    },
  }
  const ROLLBACK_DATA = {
    'rollback-rename-order20.sql': { forward: 'adhoc-rename-order20.sql' },
  }
  const textOf = (name) => [...files, ...(extraFiles || [])].find((f) => f.file === name)?.text
  const seedSql = textOf('seed.sql') || ''
  let rbChecked = 0
  for (const f of (extraFiles || [])) {
    if (!/^rollback-.*\.sql$/.test(f.file)) continue
    const s = ROLLBACK_STRUCTURAL[f.file]
    const d = ROLLBACK_DATA[f.file]
    if (!s && !d) {
      problems.push(`A8 ${f.file} 既不在结构轨也不在数据轨的具名清单里 ⇒ 该回滚件仍未被执行验证过`
        + '（正解：判定它删的是 schema 对象还是行值，然后登记进 ROLLBACK_STRUCTURAL / ROLLBACK_DATA）')
      continue
    }
    rbChecked++
    const fwdText = textOf((s || d).forward)
    if (!fwdText) {
      problems.push(`A8 ${f.file} 的配对正向件 ${(s || d).forward} 不在盘上 ⇒ 无法做往返验证`)
      continue
    }
    const probs = s
      ? structuralRollbackTrip({ schemaSql, rollbackText: f.text, forwardText: fwdText, objects: s.objects, label: `A8 ${f.file}` })
      : dataRollbackTrip({ schemaSql, seedSql, rollbackText: f.text, forwardText: fwdText, label: `A9 ${f.file}` })
    problems.push(...probs)
  }
  notes.push(`A8/A9 回滚件往返：结构轨 ${Object.keys(ROLLBACK_STRUCTURAL).length} 件 + 数据轨 ${Object.keys(ROLLBACK_DATA).length} 件，实测覆盖 ${rbChecked} 件`)

  // A4：跑完前向迁移后仍须等于真相源
  const after = normalizeSchema(base)
  for (const line of shapeDiff(reference, after, 'schema.sql', '重放后')) {
    problems.push(`A4 双向对账不闭合：${line}`)
  }
  base.close()

  const stats = {
    files: files.length, forward: forward.length, waived: waived.length,
    tables: Object.keys(reference).filter((k) => k.startsWith('T:')).length,
    indexes: Object.keys(reference).filter((k) => k.startsWith('I:')).length,
    colDefs,
  }
  return { problems, notes, stats }
}

/**
 * A8（第十六轮）结构类回滚件的「回滚 → 再前滚」往返。
 * 为什么必须有：4 个 rollback 文件自写下起从未被执行过一次（第十三轮 M1 登记、两度顺延）。
 * 障碍是配对正向件是"裸 ALTER 补丁"，整文件重放会撞已存在的对象 ⇒ 只挑**结构语句**前滚。
 * objects 具名声明该回滚件应删掉的对象（禁靠正则从 SQL 里猜），挑不到就说明清单与文件脱节。
 * 返回问题串数组（空 = 通过）。
 */
export function structuralRollbackTrip({ schemaSql, rollbackText, forwardText, objects, label }) {
  const out = []
  const db = new DatabaseSync(':memory:')
  try {
    applySql(db, schemaSql)
    const ref = normalizeSchema(db)
    // ① 回滚件自身必须可执行
    const rbErrs = applySql(db, rollbackText)
    if (rbErrs.length) {
      out.push(`${label} 回滚件自身不可执行：${rbErrs[0]}`)
      return out
    }
    // ② 回滚必须真的改变了结构（写了没生效 = 最隐蔽的假回滚）
    const afterRb = normalizeSchema(db)
    for (const o of objects) {
      // normalizeSchema 的形态：表 → shape[`T:<表>`] = {列名: 定义}；索引 → shape[`I:<名>`]
      const hasIn = (sh) => (o.column ? !!sh[`T:${o.table}`]?.[o.column] : false)
      const hasIx = (sh) => (o.index ? `I:${o.index}` in sh : false)
      if (o.column) {
        if (!hasIn(ref)) out.push(`${label} 声明要删的列 ${o.table}.${o.column} 不在基线真相源里 ⇒ 清单与 schema.sql 脱节`)
        else if (hasIn(afterRb)) out.push(`${label} 执行后列 ${o.table}.${o.column} 仍存在 ⇒ 回滚件没有生效（假回滚）`)
      }
      if (o.index) {
        if (!hasIx(ref)) out.push(`${label} 声明要删的索引 ${o.index} 不在基线真相源里 ⇒ 清单与 schema.sql 脱节`)
        else if (hasIx(afterRb)) out.push(`${label} 执行后索引 ${o.index} 仍存在 ⇒ 回滚件没有生效（假回滚）`)
      }
    }
    // ③ 从配对正向件里按谓词挑出结构语句（挑不到 = 谓词与文件对不上，判据不许静默跳过）
    const fwdStmts = splitStatements(forwardText)
      .map((s) => s.replace(/^\s+|--[^\n]*\n/g, '').trim())
      .filter((s) => /^ALTER TABLE .+ ADD COLUMN/i.test(s) || /^CREATE (UNIQUE )?INDEX/i.test(s))
    const needAdd = objects.filter((o) => o.column).length
    const needIdx = objects.filter((o) => o.index).length
    const gotAdd = fwdStmts.filter((s) => /^ALTER TABLE .+ ADD COLUMN/i.test(s)).length
    const gotIdx = fwdStmts.filter((s) => /^CREATE (UNIQUE )?INDEX/i.test(s)).length
    if (gotAdd !== needAdd || gotIdx !== needIdx) {
      out.push(`${label} 正向件挑出的结构语句数与声明不符（ADD COLUMN ${gotAdd}/${needAdd}、INDEX ${gotIdx}/${needIdx}）`
        + ' ⇒ 无法证明"前滚"用的就是当年那条语句，本轮不猜')
      return out
    }
    // ④ 前滚必须逐字段回到基线
    for (const st of fwdStmts) {
      const e = applySql(db, st)
      if (e.length) { out.push(`${label} 前滚语句失败：${e[0]}`); return out }
    }
    for (const line of shapeDiff(ref, normalizeSchema(db), '基线', '回滚→前滚后')) {
      out.push(`${label} 往返未闭合：${line}`)
    }
  } finally {
    db.close()
  }
  return out
}

/**
 * A9（第十六轮）数据类回滚件的往返。
 * 结构判据看不见这类回滚件的失效形态：WHERE 打空 ⇒ 执行"成功"、零行变更、什么也没还原。
 * 故本轨断言的是**行值逐字节相等 + changes==1**，且回滚字面量必须与正向字面量不同（否则是空操作）。
 */
export function dataRollbackTrip({ schemaSql, seedSql, rollbackText, forwardText, label }) {
  const out = []
  const parse = (t) => {
    const m = /^UPDATE\s+(\w+)\s+SET\s+(\w+)\s*=\s*'([^']*)'\s+WHERE\s+(.+);?$/is.exec(
      t.replace(/^\s*--[^\n]*\n/g, '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).join(' ').trim())
    return m ? { table: m[1], column: m[2], value: m[3], where: m[4] } : null
  }
  const fwd = parse(forwardText)
  const rb = parse(rollbackText)
  if (!fwd || !rb) { out.push(`${label} 无法解析出「UPDATE t SET c='v' WHERE …」单语句形态 ⇒ 本轨不适用，须显式登记而非静默跳过`); return out }
  if (fwd.table !== rb.table || fwd.column !== rb.column || fwd.where !== rb.where) {
    out.push(`${label} 与正向件的作用对象/条件不一致（${rb.table}.${rb.column} WHERE ${rb.where} vs ${fwd.where}）⇒ 回滚的不是同一次变更`)
    return out
  }
  if (fwd.value === rb.value) { out.push(`${label} 回滚值与正向值完全相同 ⇒ 这是一条空操作，不是回滚`); return out }
  const db = new DatabaseSync(':memory:')
  try {
    applySql(db, schemaSql)
    applySql(db, seedSql)
    const rows = db.prepare(
      `SELECT ${rb.column} AS v, COUNT(*) AS n FROM ${rb.table} WHERE ${rb.where} GROUP BY ${rb.column}`).all()
    if (rows.length !== 1) { out.push(`${label} WHERE ${rb.where} 命中 ${rows.length} 行（应为 1 行）⇒ 还原目标不唯一或不存在`); return out }
    // 先直接跑回滚件：证明它的 WHERE 真的打得到行（结构判据永远看不见"打空"）
    let info = db.prepare(rb0(rollbackText)).run()
    if (!info.changes) { out.push(`${label} 首次执行即零行变更 ⇒ 回滚语句打空，从未还原过任何东西`); return out }
    if (String(db.prepare(`SELECT ${rb.column} AS v FROM ${rb.table} WHERE ${rb.where}`).get().v) !== rb.value) {
      out.push(`${label} 回滚后行值不等于回滚件里的字面量`)
    }
    info = db.prepare(rb0(forwardText)).run()
    if (info.changes !== 1) { out.push(`${label} 正向语句未命中唯一行（changes=${info.changes}）`); return out }
    info = db.prepare(rb0(rollbackText)).run()
    const now = db.prepare(`SELECT ${rb.column} AS v FROM ${rb.table} WHERE ${rb.where}`).get().v
    if (info.changes !== 1 || String(now) !== rb.value) {
      out.push(`${label} 往返未闭合：正向改完后回滚得到 ${JSON.stringify(String(now))}，期望 ${JSON.stringify(rb.value)}`)
    }
  } finally {
    db.close()
  }
  return out
}

/** 取语句体（去注释）并去掉尾分号，供 prepare 使用 */
function rb0(text) {
  const stmt = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).join(' ').trim().replace(/;$/, '')
  return stmt.replace(/\s+/g, ' ')
}

function main() {
  let files
  try {
    files = readdirSync(dbDir)
      .filter((f) => /^migrate-.*\.sql$/.test(f))
      .sort()
      .map((f) => ({ file: f, text: readFileSync(join(dbDir, f), 'utf8') }))
  } catch (e) {
    console.error(`[migrate-replay] 读不到 db/ 目录：${e.message}`)
    process.exit(2)
  }
  let schemaSql = ''
  try {
    schemaSql = readFileSync(join(dbDir, 'schema.sql'), 'utf8')
  } catch (e) {
    console.error(`[migrate-replay] 读不到 schema.sql：${e.message}`)
    process.exit(2)
  }
  const extra = readdirSync(dbDir).filter((f) => /\.sql$/.test(f) && !/^migrate-.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dbDir, f), 'utf8') }))
  const { problems, notes, stats } = judge({ files, schemaSql, extraFiles: extra })
  for (const n of notes) console.log(`[migrate-replay] ${n}`)
  if (stats) {
    console.log(`[migrate-replay] 真相源规模：表 ${stats.tables} / 索引 ${stats.indexes} / 迁移 ${stats.files}`)
  }
  if (problems.length) {
    console.error(`[migrate-replay] FAIL ${problems.length} 项：`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error(`  ${LIMIT_HINT}`)
    process.exit(1)
  }
  console.log('[migrate-replay] OK 基线可重建 + 前向迁移幂等 + 结构逐字段闭合')
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main()
}
