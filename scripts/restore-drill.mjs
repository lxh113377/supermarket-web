#!/usr/bin/env node
/**
 * restore-drill —— 备份恢复的**端到端闭环演练**（第三十八轮 R38-H1）。
 *
 * 为什么要有它（一手反做，不是假想）：在册陈述 `memory/07-next-steps.part44.md` 写着
 * "`verify:restore`（2 项）需 `CF_D1_BACKUP_TOKEN` ⇒ 既有红灯"。本轮实跑否证了它：
 * 用本机 `db/schema.sql + db/seed.sql` 合成 dump 喂给同一个判据 ⇒
 * `[restore] OK 备份可恢复：56 行 / 10 表，integrity=ok，fk=0`。
 * 也就是说**演练本身不需要任何云凭据**，需要的只是一份 dump；真正需要凭据的只有"取到现网 dump"这一步。
 * （同轮两次把自己的生成器错误读成判据缺陷的诱惑都被拒：`#` 不是 SQL 注释、
 *  `SET FOREIGN_KEY_CHECKS` 是 MySQL 语法 —— 判据两次都当场判红，判得对。）
 *
 * 本脚本把这条链一次跑通，让"产物存在 ≠ 备份可用"在**每轮 push** 都被证一次：
 *   合成 dump → 加密 → 解密 → 逐字节相等 → 交既有 `verify:restore` 判"可恢复"
 * 口令用测试口令（演练的是**链路**，不是密钥管理）；跨机取回只有拿真实产物才算演练过，
 * 所以 `--artifact <path>` 不给时，最后一律打印 `UNVERIFIED 现网产物取回未演练`，不折算成通过。
 *
 * 用法：node scripts/restore-drill.mjs [--artifact <解密的.sql>] [--json]
 * 退出码：0=闭环通过（现网取回可能未验证）/ 1=闭环任一步失败 / 2=输入面不满足（缺 schema/seed 或解析不了）
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { requireInputs, bail } from './lib/preflight.mjs'
import { encryptBuffer, decryptBuffer, inspect, PASSPHRASE_ENV } from './backup-crypto.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 演练口令：**不是**任何生产密钥，只用于证明加解密链路通。生产口令走 secrets.BACKUP_PASSPHRASE。 */
export const DRILL_PASSPHRASE = 'restore-drill-only-not-a-real-secret'

/** 用本仓真相源（schema.sql + seed.sql）合成一份 dump。形状刻意贴近 `wrangler d1 export`：建表 + 逐行 INSERT。 */
export function synthesizeDump(schemaSql, seedSql) {
  const db = new DatabaseSync(':memory:')
  db.exec(schemaSql)
  db.exec(seedSql)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name)
  const lines = ['-- 本机合成演练 dump（schema.sql + seed.sql）；**不是现网备份**']
  for (const t of tables) {
    for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) {
      const cols = Object.keys(row).map((k) => `"${k}"`).join(', ')
      const vals = Object.values(row).map((v) => (
        v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
      )).join(', ')
      lines.push(`INSERT INTO "${t}" (${cols}) VALUES (${vals});`)
    }
  }
  db.close()
  return `-- 本机合成演练 dump（schema.sql + seed.sql）；**不是现网备份**\n${schemaSql}\n${lines.slice(1).join('\n')}\n`
}

/** 恢复判据作为**子进程**跑（不 import）：入口通道、BACKUP_SQL 读取、退出码都得被真走到。 */
function runRestore(sqlPath, extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'verify-backup-restore.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, BACKUP_SQL: sqlPath, ...extraEnv }, timeout: 300_000,
  })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

export function evaluate({ steps, artifactVerified, dumpBytes, containerBytes }) {
  const rows = []
  const push = (id, state, label, detail) => rows.push({ id, state, ok: state !== 'FAIL', label, detail })
  for (const s of steps) push(s.id, s.state, s.label, s.detail)
  push('D5', artifactVerified ? 'PASS' : 'UNVERIFIED', 'D5 现网产物的跨机取回',
    artifactVerified
      ? '已用真实产物路径跑过解密→恢复 ⇒ "从 CI 下载的密文能变成可用 SQL"是有证据的'
      : '未给 --artifact ⇒ 本轮只证明"合成 dump 的加解密+恢复"闭环通；**取回链路本身仍未演练**（缺现网 dump，不是缺代码）')
  const fail = rows.filter((r) => r.state === 'FAIL').length
  return {
    rows,
    summary: {
      matched: rows.filter((r) => r.state === 'PASS').length,
      mismatched: fail,
      declared: rows.length,
      unver: rows.filter((r) => r.state === 'UNVERIFIED').length,
      dumpBytes, containerBytes,
    },
  }
}

export function main({ artifact = null } = {}) {
  requireInputs('restore-drill', [join(root, 'db', 'schema.sql'), join(root, 'db', 'seed.sql'),
    join(root, 'scripts', 'verify-backup-restore.mjs'), join(root, 'scripts', 'backup-crypto.mjs')])
  const steps = []
  const step = (id, label, state, detail) => steps.push({ id, label, state, detail })
  const dir = mkdtempSync(join(tmpdir(), 'sm-drill-'))
  const dumpPath = join(dir, 'drill.sql')
  const cnrPath = join(dir, 'drill.sql.smbk')
  const backPath = join(dir, 'restored.sql')
  try {
    // D1 合成 dump 本身必须是个**能恢复**的备份 —— 否则后面每一步都在验一份废品
    const dump = synthesizeDump(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'), readFileSync(join(root, 'db', 'seed.sql'), 'utf8'))
    writeFileSync(dumpPath, dump)
    const first = runRestore(dumpPath)
    step('D1', 'D1 合成 dump 能通过恢复判据（先证明对象是真的）',
      first.rc === 0 && /备份可恢复/.test(first.out) ? 'PASS' : 'FAIL',
      first.rc === 0 ? `restore rc=0｜${(first.out.match(/\[restore\] OK[^\n]*/) || [''])[0]}` : `restore rc=${first.rc}｜${first.out.split('\n').filter((l) => /FAIL|处置|无法载入/.test(l))[0] || first.out.slice(0, 120)}`)
    if (first.rc !== 0) return { steps, artifactVerified: false, ok: false, why: 'D1 失败：合成 dump 自己就恢复不了' }

    // D2 加密：产物必须是密文（明文被误当备份 = R36 那族"绿色的零备份"）
    const container = encryptBuffer(Buffer.from(dump), DRILL_PASSPHRASE)
    writeFileSync(cnrPath, container)
    const insp = inspect(container)
    step('D2', 'D2 dump 加密成密文容器', insp.encrypted ? 'PASS' : 'FAIL',
      `明文 ${Buffer.byteLength(dump)}B → 容器 ${container.length}B，magic/version=${insp.version || '-'}`)
    if (!insp.encrypted) return { steps, artifactVerified: false, ok: false, why: 'D2 失败：容器头不合法' }

    // D3 解密 + 逐字节相等：口令解不开 = 这份备份对恢复方不存在
    let plain = null
    let d3detail = ''
    try {
      plain = decryptBuffer(readFileSync(cnrPath), DRILL_PASSPHRASE)
    } catch (e) { d3detail = e.message }
    const same = !!plain && Buffer.compare(plain, Buffer.from(dump)) === 0
    step('D3', 'D3 口令解回且逐字节相等', same ? 'PASS' : 'FAIL',
      same ? `解出 ${plain.length}B == 原文 ${Buffer.byteLength(dump)}B` : `解密不等或抛错：${d3detail || '字节不同'}`)
    if (!same) return { steps, artifactVerified: false, ok: false, why: 'D3 失败：密文解不回原文' }

    // D4 解出来的东西交给**同一个恢复判据**：能解密 ≠ 能恢复，两件事都要证据
    writeFileSync(backPath, plain)
    const restored = runRestore(backPath)
    step('D4', 'D4 解密后的 SQL 仍可被恢复判据接受', restored.rc === 0 && /备份可恢复/.test(restored.out) ? 'PASS' : 'FAIL',
      restored.rc === 0 ? 'restore rc=0（同一条判据，输入是解密产物）' : `restore rc=${restored.rc}｜${restored.out.split('\n').filter((l) => /FAIL|无法载入/.test(l))[0] || ''}`)

    // 口令错必须解不开 —— 反面对照，防"任何输入都能解出点什么"
    let wrongRejected = false
    try { decryptBuffer(container, 'not-the-passphrase') } catch { wrongRejected = true }
    step('D4b', 'D4b 错口令被拒（GCM tag 真在起作用）', wrongRejected ? 'PASS' : 'FAIL',
      wrongRejected ? 'decryptBuffer 抛错 ⇒ 口令不是装饰' : '错口令竟然解开了 —— 密码学面失效')

    // 可选：真实产物路径（跨机取回的证据）
    let artifactVerified = false
    if (artifact) {
      const p = resolve(artifact)
      if (!existsSync(p)) bail('restore-drill', `--artifact 指向的文件不存在：${p}`)
      const buf = readFileSync(p)
      const ins = inspect(buf)
      const pw = process.env[PASSPHRASE_ENV] || DRILL_PASSPHRASE
      let ok = false
      let why = ''
      if (!ins.encrypted) { why = '产物不是本工具密文（可能是明文 dump，直接验恢复）' ; ok = runRestore(p).rc === 0 }
      else {
        try { const pl = decryptBuffer(buf, pw); const t = join(dir, 'from-artifact.sql'); writeFileSync(t, pl); ok = runRestore(t).rc === 0 }
        catch (e) { why = e.message }
      }
      artifactVerified = ok
      step('D5x', 'D5x 真实产物解密→恢复', ok ? 'PASS' : 'FAIL', ok ? `${p} 可用` : `${p} 不可用：${why}`)
    }
    return { steps, artifactVerified, ok: steps.every((s) => s.state !== 'FAIL'), dumpBytes: Buffer.byteLength(dump), containerBytes: container.length }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const ai = process.argv.indexOf('--artifact')
  const res = main({ artifact: ai >= 0 ? process.argv[ai + 1] : null, json: process.argv.includes('--json') })
  if (!res.steps) { console.error(`[restore-drill] FAIL ${res.why}`); process.exit(1) }
  const v = evaluate({ steps: res.steps, artifactVerified: res.artifactVerified, dumpBytes: res.dumpBytes, containerBytes: res.containerBytes })
  for (const r of v.rows) console.log(`${r.state} ${r.id} :: ${r.label} —— ${r.detail}`)
  const bad = v.summary.mismatched
  console.log(`${bad ? 'GATE-FAIL' : 'GATE-PASS'} restore-drill :: 闭环 ${v.summary.matched}/${v.summary.declared - v.summary.unver} 项已核｜未验证 ${v.summary.unver}｜dump ${v.summary.dumpBytes}B → 容器 ${v.summary.containerBytes}B`)
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n')
  process.exit(bad ? 1 : 0)
}
