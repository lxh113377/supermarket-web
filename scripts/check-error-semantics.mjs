// 对标第十八轮（2026-09-27）：错误语义的可编程性
//   —— 一次失败，调用方能不能**只靠机器可读字段**区分「该改输入 / 该改数量 / 该重登 / 该等一会儿 / 是平台的错」。
//
// 一手动因（本轮实测的丢单链，不是假想）：functions/ 的 55 个失败出口全返回
// `{ code: -1, message: '<中文>' }` 且 HTTP 恒 200 ⇒ src/db/orders.ts 的 catch 无法区分
// 「服务端明确拒收」与「请求没送到」，一律 addLocalOrder() 本地兜底，
// 而 OrderSuccessPage 从不读 localFallback ⇒ 库存不足的订单在顾客屏上显示「下单成功！请完成支付」。
//
// 登记册：docs/error-codes.md（形态沿用 docs/limit-provenance.md + check-env-docs.mjs 的双向对账先例）
// 真相源：functions/lib/errors.js 的 ERRORS
// 用法：node scripts/check-error-semantics.mjs        真仓全量校验
//       node scripts/check-error-semantics.mjs --emit 打印缺登记行的骨架（带 TODO，见 TODO 即红）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { requireInputs, requireJson } from './lib/preflight.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const REGISTRY = 'docs/error-codes.md'
const MIRROR = 'src/api/error-codes.ts'
const SOURCE_OF_TRUTH = 'functions/lib/errors.js'
const SELF = 'scripts/check-error-semantics.mjs'
const ORDER_GATE = 'src/db/orders.ts'
const LIMITER = 'functions/lib/security.js'

/** kind 的合法取值 —— 与 errors.js / error-codes.ts 三处同源，判据以本集合为准。 */
export const KINDS = new Set(['input', 'state', 'auth', 'quota', 'platform'])
/** 允许出现的 HTTP 状态：只准语义码，禁止再退回"一律 200"。 */
export const ALLOWED_STATUS = new Set([400, 401, 403, 404, 409, 413, 429, 500])

export function collectJs(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) collectJs(p, out)
    else if (e.endsWith('.js')) out.push(p)
  }
  return out
}

/**
 * E1 的枚举器：找出 functions/ 里所有"返回失败信封"的地方，并区分裸字面量与 fail()。
 * 裸 `{ code: -1` 只在 errors.js 的 fail() 内部合法（那里是信封的唯一出生地）。
 */
export function scanFailExits(src, rel) {
  const hits = []
  src.split(/\r?\n/).forEach((line, i) => {
    const bare = /\bcode:\s*-1\b/.test(line)
    const viaFail = /\bfail\(\s*'[a-z_]+'/.test(line)
    if (bare) hits.push({ file: rel, line: i + 1, kind: 'bare', text: line.trim() })
    else if (viaFail) {
      for (const m of line.matchAll(/\bfail\(\s*'([a-z_]+)'/g)) {
        hits.push({ file: rel, line: i + 1, kind: 'coded', code: m[1], text: line.trim() })
      }
    }
  })
  return hits
}

/** 登记册解析：只认「| code | kind | HTTP | retryable | ... |」四列齐备的数据行。 */
export function parseRegistry(md) {
  const rows = new Map()
  md.split(/\r?\n/).forEach((line) => {
    if (!line.trim().startsWith('|')) return
    const c = line.split('|').slice(1, -1).map((s) => s.trim())
    if (c.length < 4 || !/^[a-z][a-z0-9_]*$/.test(c[0])) return
    if (c[0] === 'errorCode') return
    rows.set(c[0], { kind: c[1], status: Number(c[2]), retryable: c[3] === 'true', raw: line })
  })
  return rows
}

/** 前端镜像解析：SERVER_ERROR_KIND 字面量块里的 `code: 'kind'` 对。 */
export function parseMirror(ts) {
  const block = /export const SERVER_ERROR_KIND[^=]*=\s*\{([\s\S]*?)\n\}/.exec(ts.replace(/\r\n/g, '\n'))
  if (!block) return null
  const map = new Map()
  for (const m of block[1].matchAll(/^\s*([a-z][a-z0-9_]*):\s*'([a-z]+)'/gm)) map.set(m[1], m[2])
  return map
}

/**
 * 登记册 ⇄ 真相源差分（纯函数，供夹具喂变异样本 —— 判据拆纯函数的口径来自第十轮）。
 * 返回三个清单：表缺行 / 表多行 / 逐项不符（kind、HTTP、retryable、非法 kind、非法档位）。
 */
export function diffRegistry(declared, ERRORS, reg) {
  const miss = declared.filter((c) => !reg.has(c))
  const extra = [...reg.keys()].filter((c) => !declared.includes(c))
  const mismatch = []
  for (const [c, r] of reg) {
    const t = ERRORS[c]
    if (!t) continue
    if (r.kind !== t.kind) mismatch.push(`${c} kind 文档=${r.kind} 代码=${t.kind}`)
    if (r.status !== t.status) mismatch.push(`${c} HTTP 文档=${r.status} 代码=${t.status}`)
    if (r.retryable !== t.retryable) mismatch.push(`${c} retryable 文档=${r.retryable} 代码=${t.retryable}`)
    if (!KINDS.has(r.kind)) mismatch.push(`${c} kind=${r.kind} 非法（只允许 ${[...KINDS].join('/')}）`)
    if (!ALLOWED_STATUS.has(t.status)) mismatch.push(`${c} HTTP=${t.status} 不在允许档位`)
  }
  const stub = [...reg.values()].filter((r) => /TODO|待补|TBD/.test(r.raw))
  return { miss, extra, mismatch, stub }
}

/** 前端镜像 ⇄ 真相源差分（同上，纯函数）。 */
export function diffMirror(declared, ERRORS, mirror) {
  if (!mirror) return { unparseable: true, miss: [], extra: [], kindDiff: [] }
  const miss = declared.filter((c) => !mirror.has(c))
  const extra = [...mirror.keys()].filter((c) => !declared.includes(c))
  const kindDiff = [...mirror].filter(([c, k]) => ERRORS[c] && ERRORS[c].kind !== k).map(([c, k]) => `${c}=${k}`)
  return { unparseable: false, miss, extra, kindDiff }
}

/** E6：429 类出口必须自带 retryAfterMs —— 窗口在这里是已知量，不发就是让前端猜。 */
export function scanRetryAfter(src) {
  const bad = []
  src.split(/\r?\n/).forEach((line, i) => {
    if (/\bfail\(\s*'rate_limited'/.test(line) && !/retryAfterMs/.test(line)) {
      bad.push(`${i + 1}: ${line.trim()}`)
    }
  })
  return bad
}

/**
 * E5 的核心：**下单链路上的静默兜底判据**。
 * 这不是"扫个关键字"，而是把本轮修的动作结构钉住：
 *   ① createOrder 函数体里必须有 isFallbackSafe 分流；
 *   ② **catch 块内部** OrderRejectedError 早退必须排在 addLocalOrder 之前
 *      （函数开头那句"非云端模式直接落本地"是正常路径，不参与本判据）；
 *   ③ 文件必须 import OrderRejectedError（防止有人把早退写成判 message 字符串）。
 * 三条缺一即红 —— 判 message 分支正是本轮要根治的行为。
 */
export function scanSilentFallback(src) {
  const flat = src.replace(/\r\n/g, '\n')
  const fn = /export async function createOrder[\s\S]*?\n\}/.exec(flat)
  const problems = []
  if (!fn) return ['没解析到 createOrder 函数体（改名/换写法会让本判据静默失效）']
  const body = fn[0]
  if (!/\bisFallbackSafe\s*\(/.test(body)) problems.push('createOrder 未做 isFallbackSafe 分流')
  // 只看 catch 块内部的顺序：函数开头还有一句"非云端模式直接落本地"的正常 addLocalOrder，
  // 拿整个函数体比位置会把它误判成"兜底在早退之前"。
  const blk = /\bcatch\s*\(\s*e\s*\)\s*\{([\s\S]*?)\n {2}\}/.exec(body)
  if (!blk) problems.push('没解析到 createOrder 的 catch 块（改写法会让本判据静默失效）')
  else {
    const seg = blk[1]
    const guard = seg.search(/if\s*\(\s*e\s+instanceof\s+OrderRejectedError\s*\)\s*throw\s+e\b/)
    const local = seg.search(/\baddLocalOrder\s*\(/)
    if (guard === -1) problems.push('catch 里没有 OrderRejectedError 早退（业务拒绝会被兜底吞掉）')
    else if (local !== -1 && guard > local) problems.push('OrderRejectedError 早退出现在 addLocalOrder 之后（顺序错=等于没防）')
  }
  if (!/import[^']*OrderRejectedError[^']*from\s*'\.\.\/api\/error-codes'/.test(flat))
    problems.push('未从 src/api/error-codes 导入 OrderRejectedError')
  if (/\.message\s*===|includes\([^)]*库存不足/.test(body))
    problems.push('createOrder 里出现按 message 字符串分支（本轮根治的就是这个）')
  return problems
}

export async function run() {
  const results = []
  const push = (id, name, ok, detail) => results.push({ id, name, ok, detail })
  requireInputs('error-semantics', [join(root, 'functions'), join(root, REGISTRY), join(root, MIRROR), join(root, SOURCE_OF_TRUTH)])
requireJson('error-semantics', [join(root, 'package.json')])

  const files = collectJs(join(root, 'functions')).map((p) => relative(root, p).replace(/\\/g, '/'))
  const { ERRORS, fail: failFn, apiResponse } = await import(pathToFileURL(join(root, SOURCE_OF_TRUTH)).href)

  // ── E1 functions/ 不得有裸 { code: -1 }（信封出生地 errors.js 除外）
  const exits = []
  for (const f of files) {
    if (f === SOURCE_OF_TRUTH) continue
    for (const h of scanFailExits(readFileSync(join(root, f), 'utf8'), f)) exits.push(h)
  }
  const bare = exits.filter((e) => e.kind === 'bare')
  push('E1', '失败出口一律经 fail()（无裸 code:-1）',
    bare.length === 0,
    bare.length ? `${bare.length} 处裸出口：${bare.slice(0, 4).map((b) => `${b.file}:${b.line}`).join(', ')}` : `${exits.filter((e) => e.kind === 'coded').length} 处出口全部带码`)

  // ── E2 代码用到的码 ⇄ 登记表码集合 双向对账
  const used = new Set(exits.filter((e) => e.code).map((e) => e.code))
  const declared = new Set(Object.keys(ERRORS))
  const undeclared = [...used].filter((c) => !declared.has(c))
  const unused = [...declared].filter((c) => !used.has(c))
  push('E2', '码表 ⇄ 代码引用双向对账（死码也判红）',
    undeclared.length === 0 && unused.length === 0,
    undeclared.length || unused.length
      ? `未使用登记: ${unused.join(',') || '-'} | 代码用了未登记: ${undeclared.join(',') || '-'}`
      : `${used.size} 个码，两侧集合相等`)

  // ── E3 登记册 ⇄ 真相源：集合相等 + kind/HTTP/retryable 逐项相等
  const reg = parseRegistry(readFileSync(join(root, REGISTRY), 'utf8'))
  const d3 = diffRegistry([...declared], ERRORS, reg)
  push('E3', `登记册(${REGISTRY}) 与真相源逐项相等`,
    d3.miss.length === 0 && d3.extra.length === 0 && d3.mismatch.length === 0,
    [d3.miss.length && `表缺行: ${d3.miss.join(',')}`, d3.extra.length && `表多行: ${d3.extra.join(',')}`,
      d3.mismatch.length && d3.mismatch.join('; ')].filter(Boolean).join(' | ') || `${reg.size} 行全对`)

  // ── E3b 依据不得是占位（沿用上限册"TODO 即红"的立场：自动生成不等于已论证）
  push('E3b', '登记册无 TODO/待补占位行', d3.stub.length === 0,
    d3.stub.length ? `${d3.stub.length} 行仍是占位` : '无占位行')

  // ── E4 前端镜像 ⇄ 真相源：键集合相等 + kind 逐项相等
  const mirror = parseMirror(readFileSync(join(root, MIRROR), 'utf8'))
  const d4 = diffMirror([...declared], ERRORS, mirror)
  push('E4', `前端镜像(${MIRROR}) 与真相源码集合相等且 kind 逐项相等`,
    !d4.unparseable && d4.miss.length === 0 && d4.extra.length === 0 && d4.kindDiff.length === 0,
    d4.unparseable ? '没解析到 SERVER_ERROR_KIND 块 —— 改名会让判据静默失效'
      : [d4.miss.length && `前端缺: ${d4.miss.join(',')}`, d4.extra.length && `前端多: ${d4.extra.join(',')}`,
        d4.kindDiff.length && `kind 不符: ${d4.kindDiff.join(',')}`].filter(Boolean).join(' | ')
      || `${mirror.size} 码两侧一致`)

  // ── E5 下单链路禁静默兜底（本轮 P0 的永久化）
  const fbProblems = scanSilentFallback(readFileSync(join(root, ORDER_GATE), 'utf8'))
  push('E5', `${ORDER_GATE} createOrder 禁把业务拒绝兜底成本地单`, fbProblems.length === 0,
    fbProblems.join(' | ') || '分流+早退+导入三条结构齐备，且无按 message 分支')

  // ── E6 429 出口自带 retryAfterMs
  const ra = scanRetryAfter(readFileSync(join(root, LIMITER), 'utf8'))
  push('E6', '429 出口必须带 Retry-After 来源（retryAfterMs）', ra.length === 0,
    ra.length ? `${ra.length} 处缺：${ra.join(' / ')}` : '两处限流出口均带窗口余量')

  // ── E7 枚举器自证：取数面确实只在 functions/ 下、不含判据自身与信封出生地，
  //          并且**真扫到了东西**（"0 命中"不能当通过 —— R247）。
  const coded = exits.filter((e) => e.kind === 'coded')
  const insideFunctions = files.length > 0 && files.every((f) => f.startsWith('functions/'))
  push('E7', '取数面自证（含正向对照：枚举器非空转）',
    insideFunctions && !files.includes(SELF) && exits.every((e) => e.file !== SOURCE_OF_TRUTH) && coded.length >= 40,
    `面 ${files.length} 个文件全在 functions/ 下；出口 ${coded.length} 处（阈值 40 为正向对照，防"空扫=通过"）；`
    + `errors.js 与本脚本均不出现在出口清单里`)

  // ── E8 兼容性红线：code 恒 -1；成功仍 200；未登记码降级成 platform 而不是抛
  const f = failFn('stock_insufficient', '库存不足: 可乐')
  const u = failFn('不存在的码', 'x')
  const okEnvelope = f.code === -1 && f.errorCode === 'stock_insufficient' && f.kind === 'state' && f.retryable === false
    && typeof f.message === 'string'
  const degrade = u.code === -1 && u.errorCode === 'internal_error' && u.kind === 'platform'
  const st = (r) => apiResponse(r, {}).status
  const statusMap = st(f) === 409 && st({ code: 0 }) === 200 && st(failFn('rate_limited', 'x', { retryAfterMs: 1000 })) === 429
    && st(failFn('auth_failed', 'x')) === 401 && st(failFn('image_too_large', 'x')) === 413
  const hdr = new Headers(apiResponse(failFn('rate_limited', 'x', { retryAfterMs: 1500 }), {}).headers).get('Retry-After')
  push('E8', '信封与状态映射真跑：code 恒 -1 / 成功仍 200 / 未登记码降级不抛',
    okEnvelope && degrade && statusMap && hdr === '2',
    `state→${st(f)}，成功→${st({ code: 0 })}，未登记→${u.errorCode}/${u.kind}，Retry-After=${hdr}`)

  return { results, used, declared }
}

// 只在作为命令执行时跑：被单测 import 时不得触发 process.exit。
// ⚠️ 比较前必须 resolve + 小写 —— 本仓 2026-09-27 第十八轮实测踩过：
// 直接比 `fileURLToPath(import.meta.url) === process.argv[1]`，命令行传相对路径时两边永不相等，
// 判据**一声不响地 exit 0**，看起来全绿其实一行没跑。形态同 check-env-docs.mjs 末尾注释。
const isCli = !!process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (isCli) {
  const emit = process.argv.includes('--emit')
  const { results, used, declared } = await run()
  if (emit) {
    const miss = [...used].filter((c) => !declared.has(c))
    console.log(miss.length ? miss.map((c) => `| ${c} | TODO | 400 | false | TODO | TODO |`).join('\n') : '// 无缺登记码')
    process.exit(0)
  }
  let pass = 0
  let failN = 0
  for (const r of results) {
    if (r.ok) { pass++; console.log(`PASS  ${r.id} ${r.name}\n      ${r.detail}`) }
    else { failN++; console.log(`FAIL  ${r.id} ${r.name}\n      ${r.detail}`) }
  }
  const bare2 = results.find((r) => r.id === 'E1')
  if (!bare2) { console.error('[error-semantics] 判据未产出 E1 结论，按失败处理'); process.exit(2) }
  console.log(`\n==== 结果: ${pass} 通过 / ${failN} 失败 ====`)
  console.log(failN === 0
    ? `[error-semantics] OK ${declared.size} 个错误码双向对账通过（登记册 ${REGISTRY}）`
    : `[error-semantics] FAILED ${failN} 项`)
  process.exit(failN === 0 ? 0 : 1)
}
