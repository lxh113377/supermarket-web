// rust/ 侧的一键门禁：把「本轮改动是否还成立」的判据串起来，供 CI 或收尾前自检调用。
//
// 它只看**本目录能独立证明**的东西：契约与纯计算、WASM 与 JS 同值、复刻不漂移、
// 边缘服务能起来且首屏读数符合预期。它不碰线上、不碰 wrangler（部署另走 chaoshi-web-deploy skill）。
//
// 用法：node rust/scripts/verify-all.mjs [--cargo <cargo 路径>] [--skip-build]

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const cargo = argOf('--cargo', process.env.CARGO || 'cargo')
const skipBuild = args.includes('--skip-build')

const steps = []
const step = (name, cmd, cmdArgs, opts = {}) => steps.push({ name, cmd, cmdArgs, ...opts })

step('cargo test（core 契约与纯计算 16 条 + edge 单测 6 条）', cargo, ['test', '-p', 'supermarket-core', '-p', 'supermarket-edge'])
if (!skipBuild) {
  step('cargo build（edge release）', cargo, ['build', '-p', 'supermarket-edge', '--release'])
  step('cargo build（wasm release-wasm）', cargo, ['build', '-p', 'supermarket-wasm', '--profile', 'release-wasm', '--target', 'wasm32-unknown-unknown'])
}
step('WASM ↔ JS 对账 + 微基准', process.execPath, [path.join(here, 'wasm-host-test.mjs')])
step('复刻 class 面不漂移', process.execPath, [path.join(here, 'check-shell-parity.mjs')])
step('字体分包完整性（并集/不重叠/A 包覆盖/预算）', process.execPath, [path.join(here, 'check-font-split.mjs')])
step('WASM 产物三方一致（产物 ⇄ manifest ⇄ ABI）', process.execPath, [path.join(here, 'check-wasm-artifact.mjs')])
// 联网腿默认不进：它要打现网 /pub 真值并起 mock D1（本机可跑，但不该让「断网」把整条 verify 判红）。
// 不给开关时**打印 SKIP 与原因**，而不是静默省略 —— 静默省略等于「没跑」被读成「过了」。
if (process.env.RUST_E2E_LIVE === '1') {
  step('原生动作端到端（现网真值 + mock D1）', process.execPath, [path.join(here, 'check-api-native-e2e.mjs')])
} else {
  console.log('▶ 原生动作端到端（现网真值 + mock D1） … SKIP（未设 RUST_E2E_LIVE=1；需要联网打现网 /pub）')
}

let failed = 0
for (const s of steps) {
  process.stdout.write('▶ ' + s.name + ' … ')
  const t0 = Date.now()
  const res = spawnSync(s.cmd, s.cmdArgs, { cwd: rustRoot, encoding: 'utf8', timeout: 900000 })
  const ms = Date.now() - t0
  if (res.status === 0) {
    console.log('PASS（' + (ms / 1000).toFixed(1) + 's）')
  } else {
    failed += 1
    console.log('FAIL（rc=' + res.status + '，' + (ms / 1000).toFixed(1) + 's）')
    console.log(((res.stdout || '') + (res.stderr || '')).slice(-1500))
  }
}

// 读数自检：A/B 原始读数里的「确定性胜利」必须还在
// （这几条不随机器噪声变化，一旦变了就说明外壳或缓存头被改坏了）。
const perfFile = path.join(rustRoot, 'docs', 'perf-local.json')
if (existsSync(perfFile)) {
  process.stdout.write('▶ A/B 读数自检（渲染阻塞归零 / CSS 请求消失 / 请求数 −1）… ')
  const perf = JSON.parse(readFileSync(perfFile, 'utf8'))
  const r = perf.results || {}
  const problems = []
  if (!r.baseline || !r.edge) problems.push('读数缺少 baseline/edge 两臂')
  else {
    if (!(r.baseline.median.renderBlocking > 0)) problems.push('baseline 渲染阻塞应为正值')
    if (r.edge.median.renderBlocking !== 0) problems.push('edge 渲染阻塞应为 0')
    if (!(r.edge.median.cssBytes === 0 && r.baseline.median.cssBytes > 0)) problems.push('CSS 传输应为 24KB→0')
    if (!(r.edge.median.requests < r.baseline.median.requests)) problems.push('请求数应减少')
    // 取数字段名与 measure-local.mjs 的 extract() 保持一致（ttfb = Lighthouse 的 server-response-time）
    if (!(r.edge.median.ttfb < r.baseline.median.ttfb)) problems.push('server-response-time 应下降')
  }
  if (problems.length) {
    failed += 1
    console.log('FAIL：' + problems.join('；'))
  } else {
    console.log('PASS')
  }
} else {
  console.log('▶ A/B 读数自检 … SKIP（还没有 ' + perfFile + '，先跑 measure-local.mjs）')
}

console.log(failed === 0 ? '\nGATE-PASS rust/verify-all：全部通过' : '\nGATE-FAIL rust/verify-all：' + failed + ' 项未过')
process.exit(failed === 0 ? 0 : 1)
