#!/usr/bin/env node
// @probe-safe: 骨架实测 rc=2 / 0s（`existsSync(functions/_health.js)` 拦在 fetch 之前即 bail），网络请求在其后才走
/**
 * live-shape —— 线上 /_health 的**响应形状** ⇄ 本仓 `functions/_health.js` 声明的键集比对（第三十八轮 R38-H2）。
 *
 * 一手事实（本轮 Step 0，@2026-09-27T15:40:03Z）：
 *   线上 `https://supermarket-web.pages.dev/_health` 回
 *     {"status":"ok","db":"ok","ts":"…","ai":{…}}
 *   而本地 `functions/_health.js:16-22` 构造的顶层键是 status/db/ts/ai/**deploy**。
 *   `deploy` 不是"env 缺位所以没值"——那样应打印 `"deploy":null`；它是**整个键都不存在**
 *   ⇒ 线上跑的是早于该行的旧构建。该行注释（:4）自述它就是为了发现"改了 secret 但忘记重新部署"，
 *   也就是说：**这个字段设计的靶心正在发生，而没有任何东西在做这个比对**。
 *
 * 所以本判据不新增断言口径，只把"线上是哪一版"从口头变成数字：
 *   ① 键集双向差集（缺 = 线上落后本仓；多 = 线上有本仓没有的东西）；
 *   ② `deploy` 值 ⇄ 本地 HEAD 短 sha（不同时 = 部署漂移，注明两个 sha）；
 *   ③ 取不到就是取不到：按 `UNREACHABLE` 记，**绝不与"通过"共用退出码 0 的沉默态**。
 *
 * advisory 定位（部署在用户侧、且免费档 pages.dev 时通时不通）：rc 恒 0（除输入面缺失），
 * 结论进台账与 CI 日志。禁写探针：只发 GET，不拿 createOrder 打线上。
 *
 * 用法：node scripts/check-live-shape.mjs [--json]
 *   env LIVE_BASE_URL（默认 https://supermarket-web.pages.dev）
 *   env LIVE_SHAPE_JSON（注入 /_health 原文，给 CI/夹具用；给了就不发网络请求）
 * 退出码：0=已判定（含 STALE/UNREACHABLE）/ 2=输入面不满足（找不到 _health.js、注入值不是 JSON）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { bail, requireJson } from './lib/preflight.mjs'

const require = createRequire(import.meta.url)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const HEALTH_SOURCE = join(root, 'functions', '_health.js')
export const DEFAULT_BASE = 'https://supermarket-web.pages.dev'

/**
 * 从源码推导"本端点声明的顶层键"。**不手抄清单** —— 手抄的清单会在下一次加字段时变成
 * 又一个"只有措辞在守"的东西（本轮的起因正是加了字段却没人比对线上）。
 * 取法：找到 `JSON.stringify( … )` 的第一个对象字面量，取其顶层 property 键。
 */
/** 解析器只在真要推导时才加载：没有 node_modules 的目录里必须先 fail-closed 到 rc=2，
 *  而不是 ERR_MODULE_NOT_FOUND 崩栈（同 `check-limit-provenance.mjs:24` 的在册教训）。 */
export function declaredKeys(src, parseFn) {
  const parse = parseFn || require('@babel/parser').parse
  const ast = parse(src, { sourceType: 'module', plugins: ['typescript'] })
  let obj = null
  const visit = (n) => {
    if (!n || typeof n !== 'object' || obj) return
    // `JSON.stringify({...})` 的 callee 是**成员表达式**（不是标识符）—— 两种都收。
    const nameOf = (c) => (c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' && c.property ? (c.property.name || c.property.value) : null)
    if (n.type === 'CallExpression' && nameOf(n.callee) === 'stringify'
      && (n.arguments?.[0]?.type === 'ObjectExpression' || n.arguments?.[0]?.type === 'CallExpression')) {
      const a0 = n.arguments[0]
      if (a0.type === 'ObjectExpression') { obj = a0; return }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v)
    }
  }
  visit(ast)
  if (!obj) return null
  // babel 的键节点是 ObjectProperty（acorn 是 Property）—— 两种都收，防止将来换解析器时静默返回空集
  return obj.properties.filter((p) => (p.type === 'Property' || p.type === 'ObjectProperty') && p.key)
    .map((p) => p.key.name ?? p.key.value)
}

/** 顶层键集合的比较（只比顶层 —— 嵌套形状由响应契约基线管，不在这里重复判）。 */
export function evaluate({ declared, live, liveStatus, localSha, liveSha }) {
  // liveSha 由响应自己给（deploy 键）：调用方不必重复决定，也避免「传了 live 却没传 liveSha」
  // 导致 L3 整行消失 —— 本轮夹具第一版就是这么错的（少一行不是少一个红，是少一类判定）。
  if (liveSha === undefined) liveSha = live && typeof live.deploy === 'string' ? live.deploy : null
  const rows = []
  const push = (id, state, label, detail) => rows.push({ id, state, ok: state !== 'FAIL', label, detail })
  if (!Array.isArray(declared) || !declared.length) {
    push('L1', 'UNVERIFIED', 'L1 本仓声明的键集可推导', `推导失败（${declared === null ? '源码里找不到 JSON.stringify 的对象字面量' : '键集为空'}）⇒ 无声明可比`)
    return rows
  }
  push('L1', 'PASS', 'L1 本仓声明的键集可推导', `声明 ${declared.length} 个顶层键：${declared.join(',')}`)
  if (live === null || live === undefined) {
    push('L2', 'UNREACHABLE', 'L2 线上 /_health 可达', `取不到响应（HTTP=${liveStatus ?? 'n/a'}）⇒ 未观测，不算通过也不算漂移`)
    return rows
  }
  const liveKeys = Object.keys(live)
  if (!liveKeys.length) {
    push('L2', 'FAIL', 'L2 线上响应键集 ⇄ 本仓声明', '线上返回空对象 ⇒ 那不是本端点的形状（多半被网关吞了），不记 MATCH')
    return rows
  }
  const missing = declared.filter((k) => !liveKeys.includes(k))
  const extra = liveKeys.filter((k) => !declared.includes(k))
  push('L2', missing.length || extra.length ? 'STALE' : 'MATCH', 'L2 线上响应键集 ⇄ 本仓声明',
    missing.length || extra.length
      ? `线上缺 ${missing.length} 键 [${missing.join(',')}]；线上多 ${extra.length} 键 [${extra.join(',')}] ⇒ 部署落后或双边漂移（键集只比顶层）`
      : `${liveKeys.length} 键双向对得上 ⇒ 线上构建与本仓声明同型`)
  if (missing.includes('deploy')) {
    push('L3', 'STALE', 'L3 deploy 字段在位（它存在的意义就是暴露"改了没部署"）',
      '线上没有 deploy 键 ⇒ 该构建早于本仓加此字段的那次提交 ⇒ **N3 部署欠账是实测事实，不是推测**')
  } else if (localSha && liveSha && localSha !== liveSha) {
    push('L3', 'STALE', 'L3 deploy 字段 ⇄ 本地 HEAD', `线上 deploy=${liveSha}｜本地 HEAD=${localSha} ⇒ 部署落后（advisory：发布在用户侧）`)
  } else if (liveSha) {
    push('L3', 'PASS', 'L3 deploy 字段 ⇄ 本地 HEAD', `线上 deploy=${liveSha}${localSha ? `｜本地 HEAD=${localSha}` : ''}`)
  }
  return rows
}

export async function main({ json = false } = {}) {
  if (!existsSync(HEALTH_SOURCE)) bail('live-shape', `取不到 ${HEALTH_SOURCE}`)
  const src = readFileSync(HEALTH_SOURCE, 'utf8')
  // 零分母（第三十九轮实测抓到）：`_health.js` 存在但是 0 字节时，改前会走到"推导不出键集 ⇒ L1 UNVERIFIED
  // ⇒ rc=0"——把"没有对象"读成"没发现问题"，被在册的零分母探针当场判红。空文件就是没有对象，rc=2。
  if (!src.trim()) bail('live-shape', `${HEALTH_SOURCE} 是空文件 ⇒ 没有可推导的声明，不判"通过"`)
  // 解析器是 require 进来的：package.json 空/坏时 Node 先炸 ERR_INVALID_PACKAGE_CONFIG 裸栈
  // （本轮零分母镜像实测到的第一行就是 `node:internal/modules/package_json_reader:173`）
  // ⇒ 按在册口径"先收环境、再取模块"，这里必须先把 package.json 核一遍。
  requireJson('live-shape', [join(root, 'package.json')])
  const declared = declaredKeys(src)
  const base = process.env.LIVE_BASE_URL || DEFAULT_BASE
  let live = null
  let liveStatus = null
  const injected = process.env.LIVE_SHAPE_JSON
  if (injected) {
    // 注入态 = 确定性通道（CI 与夹具用它）；解析失败 fail-closed，不拿"没解析出来"当"线上没这些键"
    let parsed = null
    try { parsed = JSON.parse(injected) } catch { bail('live-shape', 'LIVE_SHAPE_JSON 不是合法 JSON ⇒ 不猜线上形状') }
    live = parsed
    liveStatus = 200
  } else {
    try {
      const res = await fetch(`${base}/_health`, { signal: AbortSignal.timeout(15_000) })
      liveStatus = res.status
      if (res.ok) {
        try { live = await res.json() } catch { live = null; liveStatus = `${res.status}:body-not-json` }
      }
    } catch (e) {
      live = null
      liveStatus = `err:${String(e.message || e).split(String.fromCharCode(10))[0]}`
    }
  }
  let localSha = ''
  try {
    const { execFileSync } = await import('node:child_process')
    localSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch { localSha = '' }
  const rows = evaluate({ declared, live, liveStatus, localSha, liveSha: live && typeof live.deploy === 'string' ? live.deploy : null })
  const bad = rows.filter((r) => r.state === 'FAIL')
  const stale = rows.filter((r) => r.state === 'STALE')
  const unver = rows.filter((r) => r.state === 'UNREACHABLE' || r.state === 'UNVERIFIED')
  // 口径与 memory-volume/registry-sync 一致：已核对 = 真判出结论的行（PASS 或 MATCH），
  // 且 已核对 + 漂移 + 未观测 + 失败 == 声明数 —— 少算一类就会印出对不上账的分数（本轮第一版就把 PASS 漏在外面）。
  const matched = rows.filter((r) => r.state === 'MATCH' || r.state === 'PASS').length
  if (json) {
    process.stdout.write(JSON.stringify({ rows, base, declared, liveKeys: live ? Object.keys(live) : null, liveStatus }, null, 2) + String.fromCharCode(10))
  } else {
    for (const r of rows) console.log(`${r.state} ${r.id} :: ${r.label} —— ${r.detail}`)
    console.log(`${bad.length ? 'GATE-FAIL' : stale.length ? 'GATE-STALE' : unver.length ? 'GATE-UNVERIFIED' : 'GATE-PASS'} live-shape :: 目标 ${base}/_health（HTTP=${liveStatus}）｜已核 ${matched}/${rows.length}｜漂移 ${stale.length}｜未观测 ${unver.length}｜失败 ${bad.length}`)
  }
  return bad.length ? 1 : 0
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main({ json: process.argv.includes('--json') }).then((rc) => process.exit(rc))
