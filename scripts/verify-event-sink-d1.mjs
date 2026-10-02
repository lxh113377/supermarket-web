#!/usr/bin/env node
// 事件落库的真 D1 驱动验证（第六十一轮 H-61-3）。
//
// 一手动因（本轮实测，不是假想）：第五十九轮 §8 与第六十轮 §8 把"线上写路径是否真的收到事件"
// 的判据写成 `SELECT COUNT(*) FROM event_log` 回读 —— 本轮实测 n=0，但同一批查询给出
// `orders` 最后一单 = 2026-10-01T12:44:00.682Z，而含 sink 的那一笔部署上线于 2026-10-01T18:41Z
// （`/_health` 的 deploy=ec8b298）⇒ **上线后的窗口里根本没有发生过任何事件**，n=0 不含信息量。
// 那条判据等的是别人的流量，永远不可主动闭合 —— 这是判据缺陷，不是现状缺陷（R-CURRENT：
// 未到点的 0 次不得当结论；判据必须"一次正常提交就能变绿"才有资格当闸）。
//
// 正解 = 把"真 D1 驱动"请回地面：用 wrangler 的 getPlatformProxy 起一个**内存态** bindings
// （persist:false ⇒ 不写 .wrangler、不碰远端、零生产数据），把 `db/schema.sql` 真建出来，
// 然后调用**被测对象本体** `drainAndStore(env.DB)`，再 SELECT 读回。
// 这条链打的是 D1 驱动的 `prepare().bind().run()` 形态本身 —— 此前它只被 tests/eventSink.test.js
// 里的假体（fakeDb 三段式）驱动过，假体永远不会告诉我"真 D1 对同一条语句有不同要求"。
//
// 三档退出码（2 与 1 必须可区分，否则"我起不来"会被读成"代码坏了"，反之"代码坏了"会被读成"安全通过"）：
//   0 = 真驱动落库并逐字段读回相等
//   1 = 落库或读回与断言不符（被测对象确实有问题）
//   2 = 环境取不到（proxy 起不来 / 建表失败 / wrangler 不可导入）⇒ UNVERIFIED，不判绿也不判红
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE_ORDER = 'r61_sink_probe'

/**
 * 按语句边界切 SQL：`db/schema.sql` 里有 `--` 行注释与字符串，但本仓 schema 不含分号字符串，
 * 故"逐行剥注释 → 按 ; 切"足够；不引入依赖，也不假装做了完整词法分析。
 * 反向自证在 --selftest 里：注释行不得成为语句、末尾无分号的残句必须被丢或保留要一致。
 */
export function splitStatements(sql) {
  const noComments = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  return noComments.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * 把探针结果归成三档。单独成函数是为了让 --selftest 能在**没有 wrangler 的机器上**
 * 也钉住"取不到 ≠ 通过 / ≠ 失败"这条分类边界（R247 零输入不得静默判绿）。
 */
export function classify({ proxyOk, schemaOk, stmtOk, stored, readback }) {
  if (!proxyOk) return { code: 2, label: 'UNVERIFIED proxy 起不来' }
  if (!schemaOk) return { code: 2, label: 'UNVERIFIED 建表失败（是取数面坏了，不是落库坏了）' }
  if (!stmtOk) return { code: 2, label: 'UNVERIFIED schema.sql 里没有 event_log 建表句' }
  if (stored !== 1) return { code: 1, label: `FAIL drainAndStore 返回 stored=${stored}（期望 1）` }
  if (!readback || readback.n !== 1) return { code: 1, label: `FAIL 读回行数=${readback ? readback.n : 'null'}（期望 1）` }
  return { code: 0, label: `PASS 真 D1 驱动落库并读回（orderId=${PROBE_ORDER}）` }
}

/** 端到端探针：只在 runProbe() 里碰 wrangler，纯函数面不留任何 IO。 */
export async function runProbe({ quiet = false, negative = null } = {}) {
  const say = (m) => { if (!quiet) console.log(m) }
  const out = { proxyOk: false, schemaOk: false, stmtOk: false, stored: null, readback: null, err: null }
  let proxy = null
  let phase = 'setup'
  try {
    const { getPlatformProxy } = await import('wrangler')
    proxy = await getPlatformProxy({ configPath: join(ROOT, 'wrangler.toml'), persist: false })
    out.proxyOk = true
  } catch (e) {
    out.err = `getPlatformProxy: ${String(e && e.message || e).split('\n')[0].slice(0, 200)}`
    return { ...out, verdict: classify(out) }
  }
  try {
    const DB = proxy.env && proxy.env.DB
    if (!DB || typeof DB.prepare !== 'function') {
      out.err = 'bindings 里没有 D1 对象 env.DB.prepare（绑定名或 wrangler.toml 变了）'
      return { ...out, verdict: classify(out) }
    }
    const stmts = splitStatements(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'))
    const create = stmts.filter((s) => /CREATE TABLE IF NOT EXISTS "?event_log"?/i.test(s))
    const idx = stmts.filter((s) => /CREATE INDEX IF NOT EXISTS "?idx_event_log_order_ts"?/i.test(s))
    out.stmtOk = create.length === 1 && idx.length === 1
    if (!out.stmtOk) {
      out.err = `schema.sql 里 event_log 建表句 ${create.length} 条 / 索引句 ${idx.length} 条（各应为 1）`
      return { ...out, verdict: classify(out) }
    }
    if (negative === 'missing-table') {
      // 反向腿（不改动任何源文件）：故意跳过建表，让被测对象自己去撞"no such table"。
      // 没有这一条，"探针绿"与"探针根本不看结果"两种情况长得一模一样。
      out.schemaOk = false
      say('[sink-d1] 反向腿：跳过 event_log 建表，期望本次判红（rc=1）而不是判未验证（rc=2）')
      out.stmtOk = true
    } else {
      await DB.batch([...create, ...idx].map((s) => DB.prepare(s)))
      out.schemaOk = true
    }

    // 装载被测对象仍属 setup：这里抛错＝我的取数面坏了（上一版把 `./functions/...` 写成相对
    // scripts/ 的路径，于是"我 import 错文件"被记成"事件落库代码坏了"rc=1，归属错一档）
    const eventsUrl = pathToFileURL(join(ROOT, 'functions', 'lib', 'events.js')).href
    const sinkUrl = pathToFileURL(join(ROOT, 'functions', 'lib', 'event_sink.js')).href
    const { emit, ORDER_STATUS_CHANGED } = await import(eventsUrl)
    const { drainAndStore } = await import(sinkUrl)
    const e = emit(ORDER_STATUS_CHANGED, {
      orderId: PROBE_ORDER, status: 'paid', totalAmount: 12.5, discountAmount: 2,
    })
    if (!e.emitted) {
      out.err = `emit() 拒收探针事件（reason=${e.reason}）⇒ 白名单口径与探针不符`
      return { ...out, verdict: { code: 1, label: out.err } }
    }
    // 从这里起才叫"打到被测对象"：再抛错才归 FAIL
    phase = 'sink'
    const r = await drainAndStore(DB)
    out.stored = r && r.stored

    phase = 'readback'
    const back = await DB.prepare(
      'SELECT COUNT(*) AS n, SUM(totalAmount) AS total, SUM(discountAmount) AS disc, MAX(status) AS st'
      + ' FROM event_log WHERE orderId = ?',
    ).bind(PROBE_ORDER).first()
    out.readback = back
    const v = classify(out)
    if (v.code === 0 && (back.total !== 12.5 || back.disc !== 2 || back.st !== 'paid')) {
      return { ...out, verdict: { code: 1, label: `FAIL 字段读回不等：total=${back.total} disc=${back.disc} status=${back.st}` } }
    }
    return { ...out, verdict: v }
  } catch (e) {
    const msg = `D1 调用抛错：${String(e && e.message || e).split('\n')[0].slice(0, 200)}`
    out.err = msg
    // 归属分档（R263：判据自己坏了不许记成被测对象红）：探针**建表那一步**抛错＝我的用法或环境坏，
    // 只有真进了 sink / 读回之后的错才有资格判 FAIL。上一版把两者混成 rc=1，
    // 于是我少写一个 DB.prepare() 就被读成"事件落库代码坏了"。
    if (phase === 'setup') return { ...out, verdict: { code: 2, label: `UNVERIFIED 探针自身取数面失败（未打到被测对象）：${msg}` } }
    return { ...out, verdict: { code: 1, label: msg } }
  } finally {
    try { if (proxy && typeof proxy.dispose === 'function') await proxy.dispose() } catch { /* 清理失败不改判定 */ }
  }
}

/** 纯函数面自证：三档分类 + SQL 切分，两侧都有反例（不需要 wrangler，CI 也能跑）。 */
export function selftest() {
  const rows = []
  const t = (name, got, want) => rows.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
  const base = { proxyOk: true, schemaOk: true, stmtOk: true, stored: 1, readback: { n: 1 } }
  t('正例 真驱动落库 ⇒ 0', classify(base).code, 0)
  t('proxy 起不来 ⇒ 2（不得读成 0 或 1）', classify({ ...base, proxyOk: false }).code, 2)
  t('建表失败 ⇒ 2 且文案不得说"落库失败"', classify({ ...base, schemaOk: false }).label.includes('取数面'), true)
  t('schema 里没有该表句 ⇒ 2（取数面坏，不是代码坏）', classify({ ...base, stmtOk: false }).code, 2)
  t('stored=0 ⇒ 1（被测对象没落库）', classify({ ...base, stored: 0 }).code, 1)
  t('读回行数=null ⇒ 1 且不得当作未验证', classify({ ...base, readback: null }).code, 1)
  const sql = '-- 注释; 里的分号不得被当成语句边界\nCREATE TABLE IF NOT EXISTS a (x INTEGER);\nCREATE INDEX IF NOT EXISTS b ON a(x);\n'
  const got = splitStatements(sql)
  t('剥注释后按 ; 切 ⇒ 2 条语句', got.length, 2)
  t('注释行不进结果', got.some((s) => s.startsWith('--')), false)
  const bad = classify({ ...base, stored: 1, readback: { n: 2 } })
  t('反向自证 读回 2 行必须红（否则整条判据恒真）', bad.code, 1)
  return rows
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    const rows = selftest()
    let fail = 0
    for (const r of rows) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`) }
    console.log(`${fail === 0 ? 'GATE-PASS' : 'GATE-FAIL'} sink-d1-selftest :: ${rows.length - fail}/${rows.length} 通过，${fail} 失败`)
    return fail === 0 ? 0 : 1
  }
  const r = await runProbe({
    quiet: argv.includes('--quiet'),
    negative: (argv.find((a) => a.startsWith('--negative=')) || '').split('=')[1] || null,
  })
  const v = r.verdict
  console.log(`[sink-d1] ${v.label}`)
  if (r.err) console.log(`[sink-d1] 取证：${r.err}`)
  console.log(`[sink-d1] 读数：proxy=${r.proxyOk} schema=${r.schemaOk} 面=${r.stmtOk} stored=${r.stored} 读回=${JSON.stringify(r.readback)}`)
  console.log(`${v.code === 0 ? 'GATE-PASS' : v.code === 1 ? 'GATE-FAIL' : 'GATE-UNVERIFIED'} event-sink-d1 :: rc=${v.code}`)
  return v.code
}

const isCli = !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) process.exit(await main())
