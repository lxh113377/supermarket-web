#!/usr/bin/env node
// @probe-safe: 默认只出计划不动手，实测 rc=0 / 0.07s（@2026-09-29 本机）；fetch/spawnSync/写盘全部在显式 --run 之后。改前形态实测 rc=1 / 219s（真打 6 份 Lighthouse 并落盘）⇒ 正是"探针参数会写盘"那一类，已按合成面夹具断言 DRY 目录零新增
/**
 * 现网性能取数器（第五十六轮 R56-H3）
 *
 * 为什么需要它：R55 立了 `report:live-perf` 这条**读数腿**，但取数靠手抄一条 lighthouse 命令。
 * R55 自己把这件事登记成欠账（R56-H3：「缺的不是接线，是取数节奏，否则这条腿会因为没人喂样本而长期 UNVERIFIED」）。
 * 一手佐证就在本轮：手抄命令跑出的顾客端 d2 批次 3 份**全部** `NO_FCP / about:blank`，
 * 而同一分钟 `curl https://lxh113377.github.io/` = 000（20s 超时）、`pages.dev` = 200
 * ——没有预飞读数时，"站点退化"和"本机到这个域名不通"长得一模一样。
 *
 * 所以本件做三件 R55 那次手抄没做的事：
 *   ① **预飞按域名取状态码**（每个页先探一次可达性，写进采集回执），采样失败时归因有依据；
 *   ② **批次名由本件生成并拒绝覆盖已存在样本**（劣化的一次采集不得盖掉基线，户内「降级测量不得覆写基线」）；
 *   ③ **lighthouse 调用带超时**、产物落盘后**当场自证**（可解析 + 含 first-contentful-paint），
 *      而不是把 rc 当判决（R55 实测 6/6 份产物有效却全部 rc=1，崩在写盘之后的 destroyTmp）。
 *
 * 它**不**做的事：不进 CI（联网 + 浏览器 + 本机网络可达性在 runner 上不可复现，且会把"本机不通"
 * 洗成"站点慢"），不写 docs/live-perf.json 的 thresholds（立线由人写、条件由判据算）。
 *
 * 用法：node scripts/collect-live-perf.mjs [--run] [--batch <name>] [--only <tag>] [--samples <n>] [--force] [--selftest] [--json]
 *       （**默认只出计划不动手**，`--run` 才真采；载体命令 = `npm run collect:live-perf -- --run`）
 * 退出码：0=名册每一页都采到且自证通过 / 1=有页没采到（附域名状态码）/ 2=前置不齐（无名册·无浏览器·无 lighthouse·批次名冲突）
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'collect-live-perf.mjs')
export const DEFAULT_ROSTER = join(ROOT, 'docs', 'live-perf.json')
export const DEFAULT_DIR = join(ROOT, '.lighthouse')
const LH_TIMEOUT_MS = 180_000
const PREFLIGHT_MS = 20_000

/** Chromium 载体探测：本机无 Chrome，用 Edge。顺序=环境变量 → 已知安装路径 → 命令名。 */
export function resolveBrowser(env = process.env) {
  const cands = []
  if (env.CHROME_PATH) cands.push(env.CHROME_PATH)
  cands.push(
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  )
  for (const c of cands) {
    try { if (c && existsSync(c) && statSync(c).isFile()) return { path: c, bytes: statSync(c).size } } catch { /* 继续探下一个 */ }
  }
  return null
}

/** 批次名：默认取 UTC 时刻 `t<HHMM>`；显式传入时校验切分无歧义（batch 段含 `-s<数字>` 会让判据认错页） */
export function normalizeBatch(input, now = new Date()) {
  const b = input && String(input).trim()
    ? String(input).trim()
    : `t${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(b)) return { error: `批次名非法：${b}（只许字母数字 . _ -）` }
  if (/-s\d/.test(b)) return { error: `批次名不得含 "-s<数字>"：${b} ⇒ 判据按最后一个 -s<n> 切分，会认错页` }
  return { batch: b }
}

/** 计划：名册 × 批次 → 要跑的 (页, 序号, 文件名) 清单 + 已存在的冲突项 */
export function buildPlan({ roster, batch, only, samples, dir }) {
  const pages = (roster.pages || []).filter((p) => !only || p.tag === only)
  const plan = []
  const conflicts = []
  for (const p of pages) {
    const n = samples || p.minSamples || 3
    for (let i = 1; i <= n; i += 1) {
      const file = `${p.tag}-${batch}-s${i}.json`
      if (existsSync(join(dir, file))) conflicts.push(file)
      plan.push({ tag: p.tag, url: p.url, file, expects: p.expectUrlIncludes || '' })
    }
  }
  return { plan, conflicts }
}

/**
 * lighthouse CLI 解析链（本机一手实测出来的形态）：
 *   ① 显式 env LIGHTHOUSE_CLI；② 装成依赖时 createRequire.resolve；
 *   ③ npx 缓存面 `<npm cache>/_npx/<hash>/node_modules/lighthouse/cli/index.js`——
 *      R55 的 `npx --no-install lighthouse` 实际就解析在这里（它的报错栈里露出 D:/npm-cache/_npx/0f94…）。
 * 一律用 `process.execPath` 直调，**不走 shell**：spawnSync 在 Windows 上找不到 `npx`（它是 .cmd shim，
 * Node 无 shell 时拒绝起 .cmd；加 shell 又要自己拼 `--chrome-flags` 里的空格）。
 * 首版就是在这条上踩空，报出 `rc=null version="空"`——看着像"没装 lighthouse"，其实是"起不来"。
 */
export function resolveLighthouse(env = process.env) {
  const req = createRequire(import.meta.url)
  // 显式点名时**只认那一条**：不得被缓存面的"另一份 lighthouse"悄悄顶掉——
  // 否则点名失去意义，且夹具会读到本机状态（同一份测试在装了 lighthouse 的机器上是另一个答案）。
  const explicit = !!env.LIGHTHOUSE_CLI
  const cands = []
  if (explicit) cands.push(env.LIGHTHOUSE_CLI)
  else {
    try { cands.push(req.resolve('lighthouse/cli/index.js')) } catch { /* 没装成依赖，继续往下探 */ }
  }
  const bases = explicit ? [] : [env.npm_config_cache, env.NPM_CONFIG_CACHE, join(homedir(), 'AppData', 'Local', 'npm-cache'), 'D:/npm-cache', 'C:/npm-cache']
  for (const b of bases) {
    if (!b) continue
    const npxDir = join(b, '_npx')
    let entries = []
    try { if (existsSync(npxDir)) entries = readdirSync(npxDir) } catch { continue }
    for (const e of entries) cands.push(join(npxDir, e, 'node_modules', 'lighthouse', 'cli', 'index.js'))
  }
  for (const c of cands) {
    try {
      if (!c || !existsSync(c) || !statSync(c).isFile()) continue
      const pkg = JSON.parse(readFileSync(join(dirname(dirname(c)), 'package.json'), 'utf8'))
      if (pkg.name !== 'lighthouse') continue
      return { cli: c, version: String(pkg.version || '') }
    } catch { /* 下一个候选 */ }
  }
  return null
}

/** 预飞：按域名取状态码。取不到时**如实报错误名**，不得折成"站点慢" */
export async function preflight(url) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PREFLIGHT_MS) })
    return { url, status: res.status, ms: Date.now() - t0, ok: res.status >= 200 && res.status < 400 }
  } catch (e) {
    return { url, status: null, ms: Date.now() - t0, ok: false, error: e.name || String(e) }
  }
}

/** 产物自证：判"这次采到了没有"看产物，不看 lighthouse 的 rc（R55 实测 rc=1 但 6/6 有效） */
export function verifyArtifact(file, expects) {
  if (!existsSync(file)) return { ok: false, why: '产物不存在' }
  let j = null
  try { j = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { ok: false, why: `JSON 解析失败（${e.message.split('\n')[0]}）` } }
  if (!j.audits || !j.audits['first-contentful-paint']) return { ok: false, why: '缺 first-contentful-paint' }
  const url = j.finalDisplayedUrl || j.finalUrl || ''
  if (j.runtimeError) return { ok: false, why: `runtimeError=${j.runtimeError.code || '?'}｜最终 URL=${url || '(空)'}`, notMeasured: true }
  if (expects && !url.includes(expects)) return { ok: false, why: `最终 URL=${url}，不含名册期望 ${expects}` }
  return { ok: true, fetchTime: j.fetchTime || '', url, bytes: statSync(file).size }
}

function runLighthouse({ browser, url, file, lh }) {
  const args = [lh.cli, url,
    '--only-categories=performance', '--output=json', `--output-path=${file}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
    '--max-wait-for-load=45000', '--quiet']
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', timeout: LH_TIMEOUT_MS,
    env: { ...process.env, CHROME_PATH: browser.path },
  })
  return { rc: r.status, timedOut: r.error?.code === 'ETIMEDOUT' || r.signal != null, err: (r.stderr || '').split('\n')[0] || '' }
}

function selftest() {
  const cases = [
    ['① 批次名：含 "-s<数字>" 必须拒（否则判据按最后一个 -s<n> 切分会认错页）',
      normalizeBatch('spring-3-s1'), (x) => !!x.error && /不得含/.test(x.error)],
    ['② 批次名：合法名原样通过', normalizeBatch('d3'), (x) => x.batch === 'd3'],
    ['③ 批次名：路径穿越类字符必须拒（批次名会拼进文件名）',
      normalizeBatch('../../etc'), (x) => !!x.error],
    ['④ 批次名：默认名取自时刻且不产生 -s 歧义',
      normalizeBatch('', new Date('2026-09-29T09:55:00Z')), (x) => x.batch === 't0955'],
    ['⑤ 产物自证：缺 FCP ⇒ 判"没采到"，而不是"采到了但慢"',
      inTmp({ audits: {} }, ''), (x) => !x.ok && /缺 first-contentful-paint/.test(x.why)],
    ['⑥ 产物自证：runtimeError=NO_FCP + about:blank ⇒ 归"未采到(网络类)"',
      inTmp({ runtimeError: { code: 'NO_FCP' }, finalDisplayedUrl: 'about:blank', audits: { 'first-contentful-paint': {} } }, ''),
      (x) => !x.ok && x.notMeasured === true],
    ['⑦ 产物自证：URL 与名册期望不符 ⇒ 测错页必须现形（重定向/404 全靠这条）',
      inTmp({ finalDisplayedUrl: 'https://example.invalid/', audits: { 'first-contentful-paint': {} } }, 'pages.dev'),
      (x) => !x.ok && /不含名册期望/.test(x.why)],
    ['⑧ 零输入：产物路径不存在 ⇒ 报"产物不存在"而不是崩（失败路径自己不能失败）',
      withMissingFile(), (x) => !x.ok && /不存在/.test(x.why)],
    ['⑨ 浏览器探测：候选全不存在 ⇒ null（不得假装探到了）',
      resolveBrowserFromList(['/nope/nope.exe'], () => false), (x) => x === null],
    ['⑩ 计划：--only 指定页时不得把别的页卷进计划（分母由点名范围决定）',
      buildPlan({ roster: { pages: [{ tag: 'admin', url: 'u', minSamples: 2 }, { tag: 'customer', url: 'v', minSamples: 2 }] }, batch: 'd9', only: 'admin', samples: 0, dir: join(ROOT, '.lighthouse') }),
      (x) => x.plan.length === 2 && x.plan.every((p) => p.tag === 'admin')],
    ['⑪ 执行器解析：env 里缓存路径全是 undefined 时不得崩（首版就是 join(undefined) 抛 ERR_INVALID_ARG_TYPE，把"没装"报成"判据坏了"）',
      (() => { try { return { ran: true, got: resolveLighthouse({ PATH: '' }) } } catch (e) { return { ran: false, err: e.message } } })(),
      (x) => x.ran === true],
    ['⑫ 执行器解析（正向）：造一棵 lighthouse 包树 ⇒ 必须取到包自报的 version，而不是"文件在就算"',
      withFakeLhTree('lighthouse', '9.9.9'), (x) => x && x.version === '9.9.9'],
    ['⑬ 执行器解析（反例）：同形状但包名不是 lighthouse ⇒ 必须拒（否则会把别的包的 cli/index.js 当执行器跑起来）',
      withFakeLhTree('some-other-tool', '1.0.0'), (x) => x === null],
  ]
  let bad = 0
  for (const [name, got, check] of cases) {
    let ok = false, note = ''
    try { ok = check(typeof got === 'function' ? got() : got) } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note}`)
  }
  console.log(`[collect:live-perf] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
}

/**
 * 夹具：把 verifyArtifact 的输入写成临时文件再让它读回。
 * 建在 tmpdir 而不是 .lighthouse/ —— 自证夹具落进样本目录会被 report:live-perf 点名成"野 json"，
 * 那是别的判据的取数面，不该被本件的测试污染。
 */
function inTmp(obj, expects) {
  const d = mkdtempSync(join(tmpdir(), 'lhcol-'))
  const f = join(d, 's.json')
  try {
    writeFileSync(f, JSON.stringify(obj), 'utf8')
    return verifyArtifact(f, expects)
  } finally { rmSync(d, { recursive: true, force: true }) }
}
const withMissingFile = () => () => {
  const d = mkdtempSync(join(tmpdir(), 'lhcol-'))
  try { return verifyArtifact(join(d, 'gone.json'), '') } finally { rmSync(d, { recursive: true, force: true }) }
}
/** 造一棵假的 lighthouse 包树（只够解析链读），返回 thunk 让 cases 循环自己调用 */
function withFakeLhTree(name, version) {
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'lhcol-'))
    try {
      const pkgDir = join(d, 'node_modules', name)
      mkdirSync(join(pkgDir, 'cli'), { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
      const cli = join(pkgDir, 'cli', 'index.js')
      writeFileSync(cli, '// fake\n', 'utf8')
      return resolveLighthouse({ LIGHTHOUSE_CLI: cli })
    } finally { rmSync(d, { recursive: true, force: true }) }
  }
}
function resolveBrowserFromList(list, ex) {
  for (const c of list) { try { if (c && ex(c)) return { path: c } } catch { /* next */ } }
  return null
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const flagVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
  const rosterPath = resolve(flagVal('--roster', DEFAULT_ROSTER))
  const dir = resolve(flagVal('--dir', DEFAULT_DIR))
  const only = argv.includes('--only') ? flagVal('--only', '') : ''
  const samples = Number(flagVal('--samples', 0)) || 0
  // 默认**只出计划不动手**：本件一枪下去会联网 + 起浏览器 + 写样本目录，那是"全量采集"而不是探针。
  // 一手代价就在本轮：改前裸调用 `node scripts/collect-live-perf.mjs` **实测 rc=1 / 219s**（真打了 6 份
  // Lighthouse 并落盘），所以真要采必须显式 `--run`，文档里的载体命令也带上它。
  const dry = !argv.includes('--run')
  const force = argv.includes('--force')

  let roster = null
  try { roster = JSON.parse(readFileSync(rosterPath, 'utf8')) } catch (e) {
    console.log(`[collect:live-perf] BLOCKED 名册读不到：${rosterPath}（${e.code || e.name}）⇒ 不知道"该量哪些页"，一枪都不开`); return 2
  }
  if (!roster.pages?.length) { console.log('[collect:live-perf] BLOCKED 名册 pages 为空 ⇒ 同上'); return 2 }
  if (only && !roster.pages.some((p) => p.tag === only)) {
    console.log(`[collect:live-perf] BLOCKED --only ${only} 不在名册（在册：${roster.pages.map((p) => p.tag).join('/')}）⇒ 不许自动并入`); return 2
  }
  const nb = normalizeBatch(flagVal('--batch', ''))
  if (nb.error) { console.log(`[collect:live-perf] BLOCKED ${nb.error}`); return 2 }
  const browser = resolveBrowser()
  if (!browser) { console.log('[collect:live-perf] BLOCKED 没探到 Chromium（CHROME_PATH / Edge / Chrome 四条路径全空）⇒ 采不了，不得拿旧样本冒充本轮'); return 2 }
  const lh = resolveLighthouse(process.env)
  if (!lh) {
    console.log('[collect:live-perf] BLOCKED 没解析到 lighthouse CLI（试过 env LIGHTHOUSE_CLI → 依赖解析 → npm 缓存 _npx 面）⇒ 装成依赖 `npm i -D lighthouse` 或设 LIGHTHOUSE_CLI=<…/lighthouse/cli/index.js>。缺执行器时**一枪都不开**，不得拿旧样本冒充本轮'); return 2
  }
  const lhVersion = lh.version
  if (!dry) mkdirSync(dir, { recursive: true })
  const { plan, conflicts } = buildPlan({ roster, batch: nb.batch, only, samples, dir })
  if (conflicts.length && !force) {
    console.log(`[collect:live-perf] BLOCKED 批次 ${nb.batch} 已有 ${conflicts.length} 份产物（${conflicts.join(', ')}）⇒ 劣化的一次采集不得盖掉既有基线。换批次名，或确认要覆写时显式加 --force`); return 2
  }
  if (dry) {
    console.log(`[collect:live-perf] DRY（未联网、未起浏览器、未写盘；要真采显式加 --run）浏览器=${browser.path}（${browser.bytes}B）lighthouse=${lhVersion}（${lh.cli}）批次=${nb.batch} 计划 ${plan.length} 份：${plan.map((p) => p.file).join(', ')}`)
    return 0
  }

  console.log(`[collect:live-perf] 浏览器=${browser.path}（${browser.bytes}B）｜lighthouse=${lhVersion}｜执行器=${lh.cli}｜批次=${nb.batch}｜计划 ${plan.length} 份`)
  const rows = []
  for (const p of roster.pages.filter((x) => !only || x.tag === only)) {
    const pre = await preflight(p.url)
    rows.push({ kind: 'preflight', tag: p.tag, ...pre })
    console.log(`预飞 ${p.tag}｜${p.url}｜status=${pre.status ?? '取不到'}｜${pre.ms}ms${pre.error ? `｜error=${pre.error}` : ''}`)
  }
  const results = []
  for (const item of plan) {
    const file = join(dir, item.file)
    const run = runLighthouse({ browser, url: item.url, file, lh })
    const v = verifyArtifact(file, item.expects)
    results.push({ file: item.file, rc: run.rc, timedOut: run.timedOut, ...v })
    console.log(`采样 ${item.file}｜lh rc=${run.rc}${run.timedOut ? '（超时被杀）' : ''}｜${v.ok ? `采到 fetchTime=${v.fetchTime} bytes=${v.bytes}` : `未采到：${v.why}`}`)
  }
  const good = results.filter((r) => r.ok).length
  const bad = results.length - good
  const receipt = {
    batch: nb.batch, collectedAt: new Date().toISOString(), browser: browser.path, browserBytes: browser.bytes,
    lighthouse: lhVersion, lighthouseCli: lh.cli, formFactor: 'mobile', throttlingMethod: 'simulate',
    preflight: rows.filter((r) => r.kind === 'preflight'), results,
  }
  const receiptPath = join(dir, `receipt-${nb.batch}.json`)
  // 同一批次可以分几次补齐（例如 --only admin 之后再 --only customer）。**不得覆写**前一次的读数：
  // 否则"这个批次到底采了什么"这一页会被最后那半截抹掉，而它正是归因不可达时唯一的事实来源。
  let merged = receipt
  if (existsSync(receiptPath)) {
    try {
      const prev = JSON.parse(readFileSync(receiptPath, 'utf8'))
      const seen = new Set((prev.results || []).map((r) => r.file))
      merged = {
        ...prev,
        collectedAt: `${prev.collectedAt || ''} ~ ${receipt.collectedAt}`,
        preflight: [...(prev.preflight || []), ...receipt.preflight],
        results: [...(prev.results || []), ...receipt.results.filter((r) => !seen.has(r.file))],
      }
    } catch { /* 旧回执坏了就用新的顶掉——但它必须被点名，不许静默换掉历史 */ }
  }
  writeFileSync(receiptPath, JSON.stringify(merged, null, 2), 'utf8')
  console.log(`回执 ${receiptPath}（预飞状态码 + 逐份判决；report:live-perf 只认 \`*-s<n>.json\`，回执会被它按命名规则跳过并点名）`)
  console.log(`[collect:live-perf] verdict=${bad ? 'RED' : 'GREEN'} rc=${bad ? 1 : 0}｜采到 ${good}／未采到 ${bad}（共 ${results.length} 份）｜复算：npm run report:live-perf`)
  return bad ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) main().then((rc) => process.exit(rc))
