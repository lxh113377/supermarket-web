#!/usr/bin/env node
/**
 * backup-print-data —— 打印应用的数据快照（SQLite 在线备份 + 加密资产目录），交既有加密面落盘。
 *
 * 为什么需要它（2026-10-23 一手实测，不是假想）：
 *  · 顾客在 /print 下的单、老大在 /admin 收的数据、以及两张收款码，**全部只存在这台笔记本**：
 *    实测 `var/db/campus-print.sqlite` = 704512B（44 张表、17 条 files、40 条 users）、
 *    `var/payment-assets` 2 件（154615B / 381639B）、`var/student-files` 30 件 3732.7KB；
 *  · 上游虽有 `backend/files/backups.js`（哈希校验 + 保留期），但实测 `managed-backups` 目录
 *    **0 个子项**，且它没有 /admin 路由（`GET /api/admin/backups` = 404 NOT_FOUND）⇒ 那套
 *    在册机制从没在生产里跑过；本仓 `d1-backup.yml` 只管 Cloudflare D1，管不到这个文件库；
 *  · C: 与 D: 实测**同一块物理盘**（Get-Partition：C 与 D 都是 DiskNumber 0，一块 954GB NVMe）
 *    ⇒ 上一轮我手放的 `D:\\campus-print-backups` 快照只挡误删，**不挡盘坏**，别当备份数。
 *
 * 为什么用 `node:sqlite` 的 backup() 而不是拷文件：库在 WAL 模式下被服务持续写，直接 cp 会拿到
 * 半截页。backup() 走 SQLite 在线备份 API，读侧用 { readOnly: true } 打开 ⇒ 快照要么一致、
 * 要么当场失败，不存在"悄悄备了一份坏的"。
 *
 * 加密口径复用 scripts/backup-crypto.mjs（与 D1 备份同一个容器格式与口令 env），
 * 这样恢复只有一条路要练；口令缺席 ⇒ **响亮失败 rc=2**，绝不退回明文落盘。
 *
 *
 * 用法：BACKUP_PASSPHRASE=… node scripts/backup-print-data.mjs [--dest <目录>] [--keep N] [--json] [--dry-run]
 * 退出码：0=快照已落盘并回读校验通过 / 1=任一步失败 / 2=前置条件不满足（缺口令或缺库）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, lstatSync, readdirSync, rmSync, mkdtempSync } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite'
import { requireInputs, bail } from './lib/preflight.mjs'
import { encryptBuffer, inspect, PASSPHRASE_ENV } from './backup-crypto.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * 落盘点刻意选在**任何 git 仓之外**：实测 `超市web\` 本身是个外层仓，而
 * `join(ROOT, '..', 'campus-print-backups')` 正落在它里面且不被忽略（`git check-ignore`
 * 实测返回空）⇒ 快照会把外层仓弄脏。这里沿用它 2026-10-22 那份手写快照的同名目录，
 * 让「一处名册、两处历史」。可用 --dest 或 CAMPUS_PRINT_BACKUP_DIR 覆盖。
 */
export const DEFAULT_DEST = process.env.CAMPUS_PRINT_BACKUP_DIR || 'D:\\campus-print-backups'
/** 保留几份：实测单份约 0.75MB（库）+ 0.5MB（两张码），14 份上限 ≈ 18MB，忽略不计。 */
export const DEFAULT_KEEP = 14
const ASSET_DIRS = ['payment-assets', 'advertisement-assets']

/** 上游 DATA_DIR 是相对路径（实测 .env 写 `DATA_DIR=var`），必须按上游仓根解析，不能按 cwd。 */
export function resolveDataDir(upstreamHome) {
  const envPath = join(upstreamHome, '.env')
  let rel = 'var'
  if (existsSync(envPath)) {
    const m = /^DATA_DIR=(.*)$/m.exec(readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n'))
    if (m && m[1].trim()) rel = m[1].trim()
  }
  return isAbsoluteish(rel) ? rel : join(upstreamHome, rel)
}
function isAbsoluteish(p) { return /^([A-Za-z]:[\\/]|[\\/])/.test(p) }

function arg(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

export async function evaluate({ argv = [], env = process.env, log = console.log } = {}) {
  const upstreamHome = arg(argv, '--upstream') || env.CAMPUSPRINT_HOME || null
  if (!upstreamHome || !existsSync(join(upstreamHome, 'backend', 'server.js'))) {
    bail('backup-print-data', '找不到打印后端所在仓库。给 --upstream <路径> 或设 CAMPUSPRINT_HOME（需含 backend/server.js）')
  }
  const dataDir = resolveDataDir(upstreamHome)
  const dbPath = join(dataDir, 'db', 'campus-print.sqlite')
  if (!existsSync(dbPath)) bail('backup-print-data', '数据库文件不存在：' + dbPath)
  const passphrase = (env[PASSPHRASE_ENV] || '').trim()
  if (!passphrase) {
    bail('backup-print-data', '未设 ' + PASSPHRASE_ENV + ' ⇒ 拒绝落盘。这里不退回明文：库里有顾客房间号与手机号，收款码也在同一个目录')
  }
  const dryRun = argv.includes('--dry-run')
  const dest = resolve(arg(argv, '--dest') || DEFAULT_DEST)
  const keep = Number(arg(argv, '--keep') || DEFAULT_KEEP)
  if (!Number.isInteger(keep) || keep < 1) bail('backup-print-data', '--keep 要是正整数，收到 ' + arg(argv, '--keep'))

  const started = Date.now()
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '').slice(0, 8) + '-' + String(Date.now()).slice(-6)
  const dirName = 'print-' + stamp
  const outDir = join(dest, dirName)

  // ① 库：只读在线备份，落 tmp 再加密
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const counts = {}
  // 表名以实测为准：订单表在下游叫 `print_orders`（写 `orders` 会静默拿到 null ⇒ 清单里
  // 最该有数的那一项永远是 n/a，等于没记）。
  for (const t of ['users', 'files', 'print_orders', 'print_quotes', 'payment_channels']) {
    try { counts[t] = db.prepare('SELECT count(*) c FROM "' + t + '"').get().c } catch { counts[t] = null }
  }
  const scratch = dryRun ? mkdtempSync(join(tmpdir(), 'bpdb-')) : outDirPrep(outDir)
  const rawDb = join(scratch, dirName + '.sqlite')
  await sqliteBackup(db, rawDb)
  db.close()
  const dbBytes = statSync(rawDb).size
  if (!dbBytes) bail('backup-print-data', '在线备份产出 0 字节 ⇒ 不是有效快照')
  // 读回来确认这份能打开且非空 —— 只测"文件存在"等于没备
  const check = new DatabaseSync(rawDb, { readOnly: true })
  const okIntegrity = check.prepare('PRAGMA integrity_check').get().integrity_check === 'ok'
  const tableCount = check.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c
  check.close()
  if (!okIntegrity) { rmSync(rawDb, { force: true }); bail('backup-print-data', '快照 integrity_check 非 ok，已删除不落盘') }

  // ② 资产：收款码与广告图（实测都不是符号链接；仍逐个 lstat 拒绝 link，防把目录指到盘外）
  const assets = []
  for (const name of ASSET_DIRS) {
    const srcDir = join(dataDir, name)
    if (!existsSync(srcDir)) continue
    for (const f of readdirSync(srcDir)) {
      const p = join(srcDir, f)
      const st = lstatSafe(p)
      if (!st) { bail('backup-print-data', name + '/' + f + ' 无法 lstat，跳过整个资产面以免备了半套') }
      if (st.isSymbolicLink()) { bail('backup-print-data', name + '/' + f + ' 是符号链接 ⇒ 拒绝跟随') }
      if (!st.isFile()) continue
      assets.push({ name: f, bytes: st.size, from: p })
    }
  }

  if (dryRun) {
    // 演练档也要把自己写的东西收干净：临时库里可能带 -wal/-shm，留在 os.tmpdir 里就是垃圾
    for (const junk of [rawDb, rawDb + '-wal', rawDb + '-shm']) rmSync(junk, { force: true })
    rmSync(scratch, { recursive: true, force: true })
    log(JSON.stringify({ verdict: 'DRY-RUN', outDir, dbBytes, tableCount, counts, assets: assets.map((a) => ({ name: a.name, bytes: a.bytes })), ms: Date.now() - started }))
    return { rc: 0, dryRun: true }
  }

  // ③ 加密：库 + 每个资产各一个容器（同一口令、同一格式 ⇒ 恢复只有一条路要练）
  const encDb = join(outDir, basename(rawDb) + '.enc')
  writeFileSync(encDb, encryptBuffer(readFileSync(rawDb), passphrase))
  // 删明文库**以及它的 WAL/SHM 伴生件**：`backup()` 落目的库时会留 `-shm`/`-wal`（实测各
  // 32768B/0B）。只删主文件会把两个未加密文件留在标榜「全加密」的目录里 ——
  // 快照的可读性靠加密容器，伴生件对恢复无用（本文件的回读夹具已证：只喂 .enc 就能
  // integrity=ok 且逐表数与现网相等），所以一律清掉。
  for (const junk of [rawDb, rawDb + '-wal', rawDb + '-shm']) rmSync(junk, { force: true })
  const encAssets = []
  for (const a of assets) {
    const to = join(outDir, a.name + '.enc')
    writeFileSync(to, encryptBuffer(readFileSync(a.from), passphrase))
    encAssets.push({ name: a.name, plainBytes: a.bytes, encBytes: statSync(to).size })
  }

  // ④ 回读：容器能被同一口令解析（不验解密成功＝只验了"写进去了"，那是自证的一半）
  const meta = inspect(readFileSync(encDb))
  if (!meta || meta.version === undefined) { rmSync(outDir, { recursive: true, force: true }); bail('backup-print-data', '加密容器回读失败') }
  const manifest = {
    utc: new Date().toISOString(), tool: 'scripts/backup-print-data.mjs', upstreamHome, dbPath,
    dbBytes, tableCount, counts, encryptedWith: PASSPHRASE_ENV, container: meta,
    assets: encAssets, keep, note: 'C: 与 D: 同一物理盘 ⇒ 本目录只防误删，不防盘坏',
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  // ⑤ 保留期：按目录名排序留最近 keep 份
  const pruned = pruneDest(dest, keep)

  log('[backup-print-data] OK 快照 ' + dirName + '：库 ' + dbBytes + 'B/' + tableCount + ' 表 integrity=ok，' +
      Object.entries(counts).map(([k, v]) => k + '=' + (v ?? 'n/a')).join(' ') + '，资产 ' + encAssets.length + ' 件（全加密）⇒ ' + outDir +
      (pruned.length ? '；清理 ' + pruned.length + ' 份旧快照' : ''))
  return { rc: 0, outDir, dbBytes, tableCount, counts, assets: encAssets.length, pruned }
}

/** lstat 拿不到就当作危险（宁可整轮失败，也不要备出"半套还说 OK"）。 */
function lstatSafe(p) { try { return lstatSync(p) } catch { return null } }
function outDirPrep(dir) { mkdirSync(dir, { recursive: true }); return dir }

/** 只删本脚本自己命名（print-<8位>-<6位>）的子目录 ⇒ 上一轮那份手写 snapshot-* 不会被误删。 */
export function pruneDest(dest, keep) {
  if (!existsSync(dest)) return []
  const mine = readdirSync(dest, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^print-\d{8}-\d{6}$/.test(e.name))
    .map((e) => e.name).sort()
  const drop = mine.slice(0, Math.max(0, mine.length - keep))
  for (const d of drop) rmSync(join(dest, d), { recursive: true, force: true })
  return drop
}

requireInputs('backup-print-data', [join(ROOT, 'scripts', 'backup-crypto.mjs')])
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const r = await evaluate({ argv: process.argv.slice(2) }).catch((e) => { console.error('[backup-print-data] 失败：' + e.message); return { rc: 1 } })
  process.exit(r.rc)
}
