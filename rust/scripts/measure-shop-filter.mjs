// WASM 商城索引的**端到端**收益测量（开关 off vs on），外加结果等价断言。
//
// 为什么不能只拿 rust/scripts/wasm-host-test.mjs 的微基准交差：
//   那个读数（常驻索引 2.47×，即每次查询 ~11µs vs ~23µs）是**纯计算**的；而用户感知的是
//   「击键 → 新列表画出来」，里面还叠着 React 渲染与帧同步。11µs 的差在 60Hz 的帧预算（16.7ms）
//   面前是不可见的 —— 所以本脚本要回答的是「在真实页面上到底能不能量出来」，并且**如实报告量不出来**。
//
// 三件事：
//   ① 端到端：每个查询「击键 → 新列表稳定」的耗时（两臂对比，报中位/p95）；
//   ② 规模扫描：--scale N 把商品表放大 N 倍（拦截 /pub 响应），看差值何时变得可测；
//   ③ 结果等价：两臂在同一组查询下渲染出的商品名序列必须逐条相同（不同即判红）。
//
// 用法：
//   node rust/scripts/measure-shop-filter.mjs [--base http://127.0.0.1:5185] [--scale 1]
//        [--queries 糖,水,味,面,纸] [--repeats 5] [--json out.json]

import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const base = argOf('--base', 'http://127.0.0.1:5185')
const scale = Number(argOf('--scale', '1'))
const repeats = Number(argOf('--repeats', '5'))
const queries = argOf('--queries', '糖,水,味,面,纸').split(',').map((s) => s.trim()).filter(Boolean)
const jsonOut = argOf('--json', path.join(rustRoot, 'docs', 'shop-filter-wasm.json'))
const debug = args.includes('--debug')
const payloadPath = path.join(rustRoot, '.cache', 'catalog-base.json')

// ── 基础载荷：优先用缓存（可复算），没有就联网取一次并落盘 ─────────────────────────
// 两个动作的响应都要缓存：**只拦 /pub 不区分 action 会让 getCategories 拿到商品数组**，
// 于是分类解析不出来 ⇒ 网格「共 0 件」（第一版就这么被自己的夹具骗了一次：页面有渲染但商品卡为 0）。
const fetchAction = async (action) => {
  const res = await fetch('https://supermarket-web.pages.dev/pub', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload: {} }),
  })
  return res.json()
}
let payload
if (existsSync(payloadPath)) {
  payload = JSON.parse(readFileSync(payloadPath, 'utf8'))
  if (!payload.products || !payload.categories) payload = null
}
if (!payload) {
  payload = { products: await fetchAction('getPublicProducts'), categories: await fetchAction('getPublicCategories') }
  mkdirSync(path.dirname(payloadPath), { recursive: true })
  writeFileSync(payloadPath, JSON.stringify(payload) + '\n')
  console.log('已缓存基础载荷 ' + payloadPath)
}
const baseProducts = Array.isArray(payload.products?.data) ? payload.products.data : (payload.products?.data?.products ?? [])
if (!baseProducts.length) {
  console.error('载荷里没有商品：' + JSON.stringify(payload.products).slice(0, 200))
  process.exit(2)
}

// 放大：同一份商品复制 N 份、改 id/name 后缀（算法只见规模，不依赖业务语义）
const scaled = { ...payload.products, data: [] }
for (let k = 0; k < scale; k += 1) {
  for (const p of baseProducts) {
    scaled.data.push(k === 0
      ? p
      : { ...p, _id: String(p._id || p.order || '') + '_x' + k, name: (p.name || '') + '·' + k })
  }
}
console.log(`商品规模：${scaled.data.length} 件（base ${baseProducts.length} × scale ${scale}）`)

const browser = await chromium.launch({ headless: true })

/** 在页面里：把查询写进搜索框并等「新列表稳定」，返回耗时（ms）与稳定后的商品名序列。 */
const drive = (q, expected) => `
  (async () => {
    const input = document.querySelector('input[type="search"]')
    if (!input) return { ms: -1, names: [], reason: 'no-search-input' }
    const names = () => Array.from(document.querySelectorAll('[data-card-name]')).map((el) => el.textContent.trim()).join('|')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    // 清空 + 等列表回到「全部」
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) await frame()
    const t0 = performance.now()
    setter.call(input, ${JSON.stringify(q)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const want = ${JSON.stringify(expected || null)}
    // 「稳定」= **连续三帧读到同一个列表**（不是「变了就算」）。第一版用「变了就算」，
    // 于是空结果/瞬态渲染把 2000ms 的超时样本也计进了中位数 —— 判据自己得能区分
    // 「量到了」与「量不到」：量不到返回 ok:false，由调用方排除，绝不当成 0。
    let stable = 0
    let last = names()
    for (let i = 0; i < 90; i += 1) {
      await frame()
      const now = names()
      if (now === last) stable += 1
      else stable = 0
      last = now
      if (stable >= 2 && (want === null || now === want)) {
        return { ms: performance.now() - t0, names: now, ok: want === null || now === want }
      }
    }
    return { ms: -1, names: names(), ok: false, reason: want === null ? 'probe-not-settled' : 'never-reached-expected' }
  })()
`

const runArm = async (enabled) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  if (enabled) await context.addInitScript(() => { window.__SM_WASM__ = 1 })
  const page = await context.newPage()
  // 按 action 分派：getPublicProducts 用放大后的商品表，其余动作（分类等）用缓存原样回放。
  await page.route('**/pub', async (route) => {
    let action = ''
    try { action = JSON.parse(route.request().postData() || '{}').action || '' } catch { /* 非 JSON 就当未知动作 */ }
    const body = action === 'getPublicProducts' ? scaled : (payload[action === 'getPublicCategories' ? 'categories' : 'products'])
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  if (debug) {
    page.on('console', (m) => console.log('  [console.' + m.type() + '] ' + m.text().slice(0, 200)))
    page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e.message).slice(0, 200)))
    page.on('response', (r) => { if (r.url().includes('/pub')) console.log('  [resp] ' + r.status() + ' ' + r.url().slice(0, 80)) })
  }
  await page.goto(base + '/#/shop', { waitUntil: 'load', timeout: 30000 })
  // **先确认路由块真的挂上了**，再谈别的：判据是 TopNav 的搜索按钮（CustomerPage 渲染后才存在）。
  // 第一版先等 [data-card-name]，结果在「Suspense 回退态（页面加载中）」那一刻量了个空
  // —— 卡片锚点会骗人（瞬态渲染），而搜索按钮不会。
  await page.waitForSelector('button[aria-label*="搜索"]', { timeout: 30000 })
  // 搜索框是**展开态**才存在的（CustomerPage 的 showSearch，由 TopNav 的按钮切）：
  // 第一版直接等 input[type=search]，结果 probe 全空 —— 而两臂的「空结果」彼此相等，
  // 于是等价断言假绿。夹具里的「量不到」必须能被自己发现，这里两条腿一起补。
  const searchOpen = async () => {
    if (await page.$('input[type="search"]')) return true
    const btn = await page.$('[aria-label*="搜索"], [aria-label*="search"], button:has-text("搜索")')
    if (btn) { await btn.click().catch(() => {}); await page.waitForTimeout(400) }
    return Boolean(await page.$('input[type="search"]'))
  }
  await page.waitForSelector('[data-card-name]', { timeout: 30000 })
  if (!(await searchOpen())) {
    const state = await page.evaluate(() => ({
      buttons: document.querySelectorAll('button').length,
      labels: Array.from(document.querySelectorAll('[aria-label]')).map((el) => el.getAttribute('aria-label')).slice(0, 12),
      cards: document.querySelectorAll('[data-card-name]').length,
      body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
    }))
    console.error('  [harness] 打不开搜索框 ⇒ 夹具失效（不是应用缺陷）。现场：' + JSON.stringify(state))
    // 夹具失效必须能被上层看见：量不到 ≠ 等价（第一版就是在这里假绿的）
    await context.close()
    return { enabled, probe: {}, samples: {}, harnessError: 'no-search-input' }
  }
  try {
    await page.waitForSelector('[data-card-name]', { timeout: 30000 })
  } catch (e) {
    if (debug) {
      const info = await page.evaluate(() => ({ body: document.body.innerText.slice(0, 400), hash: location.hash, cards: document.querySelectorAll('[data-card-name]').length }))
      console.log('  未渲染出商品卡：' + JSON.stringify(info))
    }
    throw e
  }
  await page.waitForTimeout(1200)

  // 先跑一轮「不设期望」的探针，拿到每个查询的最终结果作为后续的判据（也用于两臂等价比对）
  const probe = {}
  for (const q of queries) {
    const r = await page.evaluate(drive(q, null))
    probe[q] = r.names
  }
  // 再正式测：等「列表等于探针结果」的那一刻
  const samples = {}
  for (const q of queries) {
    samples[q] = []
    for (let i = 0; i < repeats; i += 1) {
      const r = await page.evaluate(drive(q, probe[q]))
      if (r.ok) samples[q].push(r.ms)
      else if (debug) console.log('  [harness] 「' + q + '」样本无效：' + r.reason)
    }
  }

  // 纯计算对比不在这里做：那是 rust/scripts/wasm-host-test.mjs 的活（同机同进程、JIT 预热后）。
  // 本脚本只回答「端到端能不能量出来」——把两者混在一起才会得出「跑得快所以用户体验变好」的假结论。
  await context.close()
  return { enabled, probe, samples }
}

const off = await runArm(false)
const on = await runArm(true)

const stats = (xs) => {
  if (!xs || !xs.length) return { n: 0 }
  const s = [...xs].sort((a, b) => a - b)
  return { n: s.length, median: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], min: s[0], max: s[s.length - 1] }
}
const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)

let parityFail = 0
console.log('\n查询 | 关(中位ms) | 开(中位ms) | 差值 | 结果等价')
console.log('|---|---|---|---|---|')
const table = {}
for (const q of queries) {
  const a = stats(off.samples[q])
  const b = stats(on.samples[q])
  // 等价判据：**夹具两条都真的跑起来了**（有搜索框、有卡片、无 harnessError），
  // 且两臂渲染出的商品名序列逐字相同。空序列是合法结果（例如该查询在默认分类下本就无商品 ——
  // 「面」在饮料分类下就是 0 件），所以「空」不再当作无效；真正无效的是夹具本身没跑起来。
  const a0 = off.probe[q]
  const b0 = on.probe[q]
  const harnessOk = !off.harnessError && !on.harnessError
  const same = harnessOk && a0 === b0
  if (!same) parityFail += 1
  table[q] = { off: a, on: b, same }
  const delta = a.median != null && b.median != null ? round(b.median - a.median) : '—'
  const note = same ? (a0 === '' ? '✅ 两臂都 0 件' : '✅ 逐条相同') : '❌ 不同'
  console.log(`| 「${q}」 | ${a.median != null ? Math.round(a.median * 100) / 100 : '—'} | ${b.median != null ? Math.round(b.median * 100) / 100 : '—'} | ${delta} | ${note} (${(a0 || '').split('|').filter(Boolean).length} 件) |`)
}
console.log(`\n端到端结论：规模 ${scaled.data.length} 件 / 每查询 ${repeats} 次采样`)
console.log('结果等价：' + (parityFail ? '❌ ' + parityFail + ' 个查询两臂不一致' : '✅ 全部查询两臂逐条相同'))
writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), base, scale, products: scaled.data.length, queries, repeats, off, on, table, parityFail }, null, 2) + '\n')
console.log('原始读数 ' + jsonOut)
await browser.close()
process.exit(parityFail ? 1 : 0)
