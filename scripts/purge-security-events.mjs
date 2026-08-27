#!/usr/bin/env node
// 手动清理 security_events 90 天前记录（保留策略补充；backend.js 已有写时 5% 采样裁剪兜底）
// 用法：node scripts/purge-security-events.mjs
// 注意：本机 wrangler 走 node 直调（bin shim 在 Git Bash 坏）；需代理时先 export https_proxy=http://127.0.0.1:7897
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const sql = `DELETE FROM security_events WHERE ts < datetime('now', '-90 days');`

console.log('[purge] 清理 security_events 90 天前记录（remote D1）...')
const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'supermarket', '--command', sql, '--remote'], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, NO_COLOR: '1' },
})
process.exit(r.status ?? 1)
