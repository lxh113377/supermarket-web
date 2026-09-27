#!/usr/bin/env node
// @probe-safe: 无 --yes 时实测 rc=2 / 0s 直接 bail（第三十一轮立的授权门），远端 DELETE 不可能被探针走到
// 手动清理 security_events 90 天前记录（保留策略补充；backend.js 已有写时 5% 采样裁剪兜底）
// 用法：node scripts/purge-security-events.mjs --yes
// 注意：本机 wrangler 走 node 直调（bin shim 在 Git Bash 坏）；需代理时先 export https_proxy=http://127.0.0.1:7897
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { bail } from './lib/preflight.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const sql = `DELETE FROM security_events WHERE ts < datetime('now', '-90 days');`

// 第三十轮的实测动因：把探针分母从门禁类换到"全部登记入口"时，这条命令**在没有 tty 的情况下
// 直接把 DELETE 打到远端 D1**（打印意图后 1s 内进入 wrangler 调用）。删的是审计日志，
// 而审计日志正是"谁在什么时候动过数据"的唯一证据。判据/探针/agent 任何一次误 spawn 都是真删。
// 口径抄本仓 `migrate.mjs:312 confirmRemote`：--yes 显式授权，且非交互环境无 --yes 一律拒。
if (!process.argv.slice(2).includes('--yes')) {
  bail('purge-security-events', '破坏性远端 DELETE 需要显式 --yes（审计日志删了不可恢复；无 --yes 视为误调用）')
}
if (!existsSync(wrangler)) bail('purge-security-events', `取不到 ${path.relative(root, wrangler)} ⇒ 先 npm ci，不猜全局 wrangler（鉴权仍由 wrangler 自己判）`)

console.log('[purge] 清理 security_events 90 天前记录（remote D1，已 --yes 授权）...')
const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'supermarket', '--command', sql, '--remote'], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, NO_COLOR: '1' },
})
process.exit(r.status ?? 1)
