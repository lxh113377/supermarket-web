// 本机 A/B 对照：同一份产物 + 同一套 Lighthouse 参数，只让「服务端实现」这一个变量变化。
//
// 复用仓库既有的两个解析器（scripts/collect-live-perf.mjs 的 resolveLighthouse / resolveBrowser）——
// 于是「本机对照用的 Lighthouse」与「线上回执用的 Lighthouse」在版本与载体上是同一个解析结果，
// 前后读数可以放在一张表里比（docs/05 的三张表就是这么来的）。
//
// 用法：
//   node rust/scripts/measure-local.mjs [--samples 3] [--arms baseline,edge] [--refresh-dist]
//   node rust/scripts/measure-local.mjs --samples 1 --arms edge     # 快跑一遍看通路
//
// 产物：rust/docs/perf-local.json（原始逐次读数）+ stdout 的中位表

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveLighthouse, resolveBrowser } from '../../scripts/collect-live-perf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const repoRoot = path.resolve(rustRoot, '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const samples = Number(argOf('--samples', '3'))
const arms = argOf('--arms', 'baseline,edge').split(',').map((s) => s.trim()).filter(Boolean)
const distSource = path.resolve(argOf('--dist', path.join(repoRoot, 'dist')))
const distWork = path.join(rustRoot, '.cache', 'dist')
const keepDist = args.includes('--keep-dist')
const outJson = path.resolve(argOf('--json', path.join(rustRoot, 'docs', 'perf-local.json')))
const baselinePort = Number(argOf('--baseline-port', '5181'))
const edgePort = Number(argOf('--edge-port', '5182'))
const replicaPort = Number(argOf('--replica-port', '5183'))
const edgeBin = path.resolve(argOf('--edge-bin', path.join(rustRoot, 'target', 'release', 'supermarket-edge.exe')))
const lhConfig = { formFactor: 'mobile', throttlingMethod: 'simulate' }

const lh = resolveLighthouse(process.env)
const browser = resolveBrowser(process.env)
if (!lh) {
  console.error('找不到 lighthouse（先 npm run collect:live-perf 用过一次，或设 LIGHTHOUSE_CLI）')
  process.exit(2)
}
if (!browser) {
  console.error('找不到 Chromium 载体（Edge/Chrome）')
  process.exit(2)
}
if (!existsSync(edgeBin)) {
  console.error('找不到边缘服务产物：' + edgeBin + '（先 cargo build -p supermarket-edge --release）')
  process.exit(2)
}

// 工作副本：预压缩产物要写在 dist 旁边，所以绝不直接动仓里的 dist/。
if (args.includes('--refresh-dist') || !existsSync(distWork)) {
  rmSync(distWork, { recursive: true, force: true })
  mkdirSync(path.dirname(distWork), { recursive: true })
  cpSync(distSource, distWork, { recursive: true })
}
console.log('工作副本 ' + distWork + '（源 ' + distSource + '）')
const pre = spawnSync(edgeBin, ['precompress', '--dist', distWork, '--quality', '11', '--min-bytes', '1024'], { encoding: 'utf8' })
console.log(pre.stdout ? pre.stdout.trim() : pre.stderr.trim())

const servers = []
const startBaseline = () => {
  const child = spawn(process.execPath, [path.join(here, 'static-baseline-server.mjs'), '--dir', distWork, '--port', String(baselinePort)], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stdout.write('[baseline] ' + d))
  child.stderr.on('data', (d) => process.stderr.write('[baseline:err] ' + d))
  servers.push(child)
  return child
}
const startEdge = (port, replica) => {
  const argv = ['serve', '--dist', distWork, '--host', '127.0.0.1', '--port', String(port), '--api-cache-ttl-ms', '60000']
  if (replica) argv.push('--boot-replica')
  const child = spawn(edgeBin, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (d) => process.stdout.write('[edge] ' + d))
  child.stderr.on('data', (d) => process.stderr.write('[edge:err] ' + d))
  servers.push(child)
  return child
}
const portOf = { baseline: baselinePort, edge: edgePort, replica: replicaPort }
if (arms.includes('baseline')) startBaseline()
if (arms.includes('edge')) startEdge(edgePort, false)
// 第三条臂：开启静态首屏复刻（head+hero 静态标记）。它量的正是「首屏不再等 JS」那一步，
// 与 edge 臂的唯一差别就是这个开关 —— 于是表里那两列的差值可以直接归因给它。
if (arms.includes('replica')) startEdge(replicaPort, true)

const waitFor = async (url, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}
for (const arm of arms) {
  const ok = await waitFor('http://127.0.0.1:' + portOf[arm] + '/')
  console.log('[' + arm + '] 就绪：' + ok)
  if (!ok) {
    servers.forEach((s) => s.kill())
    process.exit(3)
  }
}

const runLighthouse = (url, outFile) => {
  const flags = [
    url,
    '--output=json',
    '--output-path=' + outFile,
    '--only-categories=performance',
    '--form-factor=' + lhConfig.formFactor,
    '--throttling-method=' + lhConfig.throttlingMethod,
    '--max-wait-for-load=45000',
    '--quiet',
    '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage',
  ]
  const res = spawnSync(process.execPath, [lh.cli, ...flags], {
    encoding: 'utf8',
    env: { ...process.env, CHROME_PATH: browser.path },
    timeout: 180000,
  })
  if (res.status !== 0) return { ok: false, error: (res.stderr || '').slice(-400) }
  if (!existsSync(outFile)) return { ok: false, error: '没有产物文件' }
  return { ok: true, json: JSON.parse(readFileSync(outFile, 'utf8')) }
}

const extract = (json) => {
  const a = json.audits || {}
  const num = (k) => (a[k] ? a[k].numericValue : null)
  const items = (a['network-requests'] && a['network-requests'].details && a['network-requests'].details.items) || []
  const sum = (t) => items.filter((i) => i.resourceType === t).reduce((s, i) => s + (i.transferSize || 0), 0)
  const lcpEl = a['largest-contentful-paint-element'] && a['largest-contentful-paint-element'].details && a['largest-contentful-paint-element'].details.items
  return {
    fcp: num('first-contentful-paint'),
    lcp: num('largest-contentful-paint'),
    si: num('speed-index'),
    tbt: num('total-blocking-time'),
    ttfb: num('server-response-time'),
    cls: num('cumulative-layout-shift'),
    bytes: num('total-byte-weight'),
    requests: items.length,
    docBytes: sum('Document'),
    // Lighthouse 的 resourceType 字面量是 'Script'（不是 'ScriptResource'）——
    // 第一版照 Chrome DevTools 的叫法写，结果这一列恒为 0。
    scriptBytes: sum('Script'),
    cssBytes: sum('Stylesheet'),
    fontBytes: sum('Font'),
    unusedJs: a['unused-javascript'] ? a['unused-javascript'].numericValue : null,
    renderBlocking: a['render-blocking-resources'] ? a['render-blocking-resources'].numericValue : null,
    lcpElement: lcpEl && lcpEl[0] && lcpEl[0].items && lcpEl[0].items[0] && lcpEl[0].items[0].node ? lcpEl[0].items[0].node.snippet.slice(0, 80) : null,
  }
}

const stats = (values) => {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (!xs.length) return { median: null, min: null, max: null, n: 0 }
  return { median: xs[Math.floor(xs.length / 2)], min: xs[0], max: xs[xs.length - 1], n: xs.length }
}
const median = (values) => stats(values).median

const results = Object.fromEntries(arms.map((a) => [a, { url: 'http://127.0.0.1:' + portOf[a] + '/', runs: [] }]))
mkdirSync(path.join(rustRoot, '.cache', 'lh'), { recursive: true })
// **交错采样**：每轮把每条臂都跑一次（baseline → edge → replica → 下一轮），而不是「先把 baseline 跑完再跑 edge」。
// 为什么必须交错：这台机器上 Lighthouse 单次耗时 16~60 s，进程调度与磁盘/CPU 的热状态会随分钟级漂移
// （实测同一天两轮中位数差到 10%+），顺序成块采样会把「时刻漂移」洗成「实现差异」。
// 交错采样让每条臂承受相同的时刻分布，差值才是实现差值。
for (let i = 1; i <= samples; i += 1) {
  for (const arm of arms) {
    const outFile = path.join(rustRoot, '.cache', 'lh', arm + '-s' + i + '.json')
    process.stdout.write('第 ' + i + '/' + samples + ' 轮 [' + arm + '] … ')
    const t0 = Date.now()
    const res = runLighthouse(results[arm].url, outFile)
    if (!res.ok) {
      console.log('失败：' + res.error)
      continue
    }
    const metric = extract(res.json)
    results[arm].runs.push(metric)
    console.log('FCP ' + Math.round(metric.fcp) + ' / LCP ' + Math.round(metric.lcp) + ' / ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
  }
}
for (const arm of arms) {
  const runs = results[arm].runs
  // 逐指标给 min/median/max + 样本数：中位数会掩掉离群（实测出现过一份 9 s FCP 的样本，
  // 静默只报中位等于替读者做了取舍）。门禁用哪个统计量由使用者决定，但**不隐瞒方差**。
  const metricKeys = Object.keys(runs[0] || {}).filter((k) => k !== 'lcpElement')
  results[arm].stats = Object.fromEntries(metricKeys.map((k) => [k, stats(runs.map((r) => r[k]))]))
  results[arm].median = Object.fromEntries(metricKeys.map((k) => [k, median(runs.map((r) => r[k]))]))
  results[arm].lcpElement = runs[0] ? runs[0].lcpElement : null
}

const keys = [
  ['fcp', 'FCP (ms)'],
  ['lcp', 'LCP (ms)'],
  ['si', 'Speed Index (ms)'],
  ['tbt', 'TBT (ms)'],
  ['ttfb', 'server-response-time (ms)'],
  ['cls', 'CLS'],
  ['bytes', '总传输 (B)'],
  ['requests', '请求数'],
  ['docBytes', '文档 (B)'],
  ['cssBytes', 'CSS (B)'],
  ['scriptBytes', 'JS (B)'],
  ['fontBytes', '字体 (B)'],
  ['unusedJs', '未使用 JS (ms)'],
  ['renderBlocking', '渲染阻塞 (ms)'],
]
console.log('\n## 本机 A/B（Lighthouse ' + lh.version + ' / ' + lhConfig.formFactor + ' / ' + lhConfig.throttlingMethod + ' / ' + samples + ' 次取中位）')
// 差值列一律「相对第一条臂」（第一条臂 = 现网形态），多臂时每臂各一格。
console.log('| 指标 | ' + arms.map((a) => a + ' 中位[min~max]').join(' | ') + ' | ' + arms.slice(1).map((_arm) => 'vs ' + arms[0]).join(' | ') + ' |')
console.log('|---|---|---' + '|---|'.repeat(Math.max(0, arms.length - 1)) + '|')
for (const [key, title] of keys) {
  const cells = arms.map((a) => {
    const s = results[a] && results[a].stats ? results[a].stats[key] : null
    if (!s || s.median == null) return '—'
    const round = (v) => Math.round(v * 100) / 100
    return round(s.median) + ' [' + round(s.min) + '~' + round(s.max) + ']'
  })
  const deltas = arms.slice(1).map((_arm, i) => {
    const base = results[arms[0]] && results[arms[0]].median ? results[arms[0]].median[key] : null
    const other = results[arms[i + 1]] && results[arms[i + 1]].median ? results[arms[i + 1]].median[key] : null
    if (!Number.isFinite(base) || !Number.isFinite(other) || base === 0) return '—'
    const pct = (other - base) / base * 100
    return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
  })
  console.log('| ' + title + ' | ' + cells.join(' | ') + ' | ' + deltas.join(' | ') + ' |')
}
console.log('\nLCP 元素（' + arms[0] + '）：' + (results[arms[0]] ? results[arms[0]].lcpElement : '—'))

mkdirSync(path.dirname(outJson), { recursive: true })
// 末行换行是仓内门禁（check:syntax / verify:eol 的 insert_final_newline）硬要求：
// 少了它，pre-commit 会直接判红（本目录第一次提交就被这条挡下过）。
writeFileSync(outJson, JSON.stringify({ at: new Date().toISOString(), lighthouse: lh, browser: browser.path, config: lhConfig, samples, arms, results }, null, 2) + '\n')
console.log('原始读数 ' + outJson)

servers.forEach((s) => s.kill())
if (!keepDist) console.log('（工作副本保留在 ' + distWork + '，用于复算与人工目检）')
