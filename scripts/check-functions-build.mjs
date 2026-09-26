#!/usr/bin/env node
/**
 * 可部署产物契约检查（第八轮 H4，对标 microfeed 的 "Verify the Worker bundle"）
 *
 * 为什么不是 `wrangler pages deploy --dry-run`：Pages 子命令**没有** --dry-run
 * （实测 `npx wrangler pages deploy --help | grep -i dry-run` 零输出），
 * Workers 侧的 `wrangler deploy --dry-run --strict` 又不适用于 Pages Functions。
 * 本页等价物 = `wrangler pages functions build`：把 functions/ 真的编译成单个 Worker，
 * 零鉴权、零网络写、不创建任何 Cloudflare 资源。
 *
 * 它拦的是本仓此前无人守的一类缺陷：**前端 build 全绿，Functions 侧却要等到部署才炸**。
 * `npm run build` 只编译 src/，functions/ 完全在 vite 视野之外。
 *
 * 反例（已实跑，见第八轮交付记录）：往 functions/ 放一个 import 不存在模块的文件
 *   → `X [ERROR] Could not resolve "./definitely-missing-module-x.js"` + 非零退出。
 * 三条结构断言的反例 = 把对应路由文件改名/清空，各自单独变红。
 *
 * 退出码：0=通过 / 1=判据红 / 2=环境不满足（wrangler 不可用，不静默假绿，R247）
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTDIR = 'dist-functions' // .gitignore 的 dist-* 已覆盖
const BUNDLE = join(ROOT, OUTDIR, 'index.js')

// 编译后的路由必须非空。实测当前产物 88.6KB，取下限 40KB：
// 防的是"编译成功但什么都没打进包"（本仓 2026-09-24 那起 echarts 零 export 事故的同族形态）。
const MIN_BYTES = 40 * 1024
// 三个入口的路由字面量。functions/ 下任一文件被改名或漏打包，这里立刻失配。
const REQUIRED_ROUTES = ['/web', '/pub', '/_health']

const fail = (msg) => { console.error(`[functions-build] FAIL ${msg}`); process.exit(1) }

rmSync(join(ROOT, OUTDIR), { recursive: true, force: true })

const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
if (!existsSync(wrangler)) {
  console.error('[functions-build] 环境不满足：node_modules/wrangler 不存在，先 npm ci')
  process.exit(2)
}

const run = spawnSync(process.execPath, [wrangler, 'pages', 'functions', 'build', '--outdir', OUTDIR], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 300_000,
})

if (run.error) {
  console.error(`[functions-build] 环境不满足：${run.error.message}`)
  process.exit(2)
}

const out = `${run.stdout || ''}${run.stderr || ''}`
if (run.status !== 0) {
  console.error(out)
  fail(`Pages Functions 编译失败（exit=${run.status}）—— 这类错误 vite build 看不见，只会拖到部署`)
}

if (!existsSync(BUNDLE)) fail(`编译退出 0 但产物缺失：${OUTDIR}/index.js`)

const bytes = statSync(BUNDLE).size
if (bytes < MIN_BYTES) fail(`产物仅 ${bytes}B < 下限 ${MIN_BYTES}B —— 疑似空打包`)

const code = readFileSync(BUNDLE, 'utf8')
const missing = REQUIRED_ROUTES.filter((r) => !code.includes(JSON.stringify(r)))
if (missing.length) fail(`产物里找不到路由字面量 ${missing.join(', ')}（functions/ 入口被改名或漏打包）`)

rmSync(join(ROOT, OUTDIR), { recursive: true, force: true })
console.log(`[functions-build] OK 编译产物 ${bytes}B，三入口路由齐备：${REQUIRED_ROUTES.join(' ')}`)
