#!/usr/bin/env node
/** d1-local-backup —— 本机 D1 备份链（round-4 立，#37 判据 2 的产物）
 *
 *  为什么有它：CI 侧 `CF_D1_BACKUP_TOKEN` secret 是**真外部凭据**（需 Cloudflare 控制台创建），
 *  agent 不得代做 ⇒ 落待办（到期 2026-11-07 见 docs/cron-health.json accepts_red_until）。
 *  但本机 wrangler OAuth 实测含 d1(write) scope ⇒ **备份本身不必等**：本件把 R79 打通的手工链
 *  固化成一条命令，供每轮/每日跑一次保底（回滚口径 = _backup/d1-local-r79/ 下容器 + .dev.vars 口令）。
 *
 *  用法：BACKUP_PASSPHRASE=`<.dev.vars 值>` node scripts/d1-local-backup.mjs [--dir <目录>]
 *  退出码：0=导出+加密+往返自证全过 / 1=任一步失败 / 2=前置不满足（缺口令/无 scope）
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const DIR = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const dir = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : join(DIR, '_backup', 'd1-local-r79')

function fail(msg, code = 1) { console.error(`[d1-local-backup] ${msg}`); process.exit(code) }

// 口令：只从 .dev.vars 读（禁命令行传参——进 shell 历史/进程表）
const dv = (() => { try { return readFileSync(join(DIR, '.dev.vars'), 'utf8') } catch { return '' } })()
const pw = (dv.match(/^BACKUP_PASSPHRASE=(.*)$/m) || [])[1] ? dv.match(/^BACKUP_PASSPHRASE=(.*)$/m)[1].trim() : ''
if (!pw) fail(`BACKUP_PASSPHRASE 不在 ${join(DIR, '.dev.vars')}（读到 ${dv ? dv.length + 'B' : '空/不存在'}）⇒ 拒明文落盘`, 2)

const stamp = new Date().toISOString().slice(0, 10)
mkdirSync(dir, { recursive: true })
const sql = join(dir, `d1-backup-${stamp}.sql`)

const ex = spawnSync('node', [join(DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'export', 'supermarket', '--remote', '--output', sql], { cwd: DIR, encoding: 'utf8', timeout: 600_000 })
if (ex.status !== 0 || !existsSync(sql)) fail(`export rc=${ex.status} ${(ex.stderr || '').split('\n')[0].slice(0, 160)}`)

for (const op of ['--encrypt', '--inspect', '--verify']) {
  const enc = sql + '.smbk'
  const args = op === '--encrypt' ? ['scripts/backup-crypto.mjs', op, sql, enc] : op === '--inspect' ? ['scripts/backup-crypto.mjs', op, enc] : ['scripts/backup-crypto.mjs', op, sql, enc]
  const r = spawnSync('node', args, { cwd: DIR, encoding: 'utf8', env: { ...process.env, BACKUP_PASSPHRASE: pw }, timeout: 300_000 })
  if (r.status !== 0) fail(`${op} rc=${r.status} ${(r.stderr || r.stdout || '').split('\n')[0].slice(0, 200)}`)
  console.log((r.stdout || '').trim().split('\n').slice(-1)[0])
}
console.log(`[d1-local-backup] OK ${statSync(sql).size}B → ${statSync(sql + '.smbk').size}B ｜ ${dir}`)
