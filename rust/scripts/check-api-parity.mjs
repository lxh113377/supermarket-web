// API 形状对账：现网响应的键集与键序 ⇄ Rust 映射层源码里的字段顺序。
//
// 为什么这么判（而不是「打两边比 JSON」）：
//   · 本机没有 D1 API token（.dev.vars 只有 ADMIN_KEY/PRINT_ADMIN_PASSWORD/BACKUP_PASSPHRASE/
//     ADMIN_READONLY_KEY），原生动作在本机起不来 ⇒ 【值级对账验不了】，不能装成验了；
//   · 但「键集 + 键序」这两件事不需要凭据：现网 /pub 是公开接口（直接打），
//     Rust 侧的字段顺序从 api_shapes.rs 的源码字面量里读 —— 两边一比即可；
//   · 键序不是无关紧要的：现网响应就是 JS 对象字面量的键序，前端/判据按文本对账时它可观察。
//
// 用法：node rust/scripts/check-api-parity.mjs [--live https://supermarket-web.pages.dev] [--json out.json]

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const live = argOf('--live', 'https://supermarket-web.pages.dev')
const jsonOut = argOf('--json', path.join(rustRoot, 'docs', 'api-live-shapes.json'))

const ACTIONS = ['getPublicProducts', 'getPublicCategories', 'getCatalogOrders']

/** 从 api_shapes.rs 读某函数的 out.insert("key", …) 顺序 —— 源码即真相，不另抄一份。 */
function rustKeyOrder(fnName) {
  const src = readFileSync(path.join(rustRoot, 'crates', 'core', 'src', 'api_shapes.rs'), 'utf8')
  const start = src.indexOf('pub fn ' + fnName)
  if (start < 0) return null
  const next = src.indexOf('pub fn ', start + 1)
  const block = src.slice(start, next < 0 ? src.length : next)
  return [...block.matchAll(/out\.insert\(\s*"([a-zA-Z_]+)"/g)].map((m) => m[1])
}

const liveCall = async (action) => {
  const res = await fetch(live + '/pub', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, payload: {} }),
  })
  return { status: res.status, json: await res.json() }
}

const problems = []
const liveShapes = {}
for (const action of ACTIONS) {
  let got
  try { got = await liveCall(action) } catch (e) {
    problems.push(action + '：现网取不到（' + String(e.message).slice(0, 60) + '）⇒ UNVERIFIED，不当通过')
    continue
  }
  const data = got.json && Array.isArray(got.json.data) ? got.json.data : null
  if (!data) { problems.push(action + '：现网响应没有 data 数组（code=' + got.json.code + '）'); continue }
  const first = data[0] || null
  liveShapes[action] = {
    status: got.status,
    code: got.json.code,
    dataLength: data.length,
    sampleKeys: first ? Object.keys(first) : [],
    keyTypes: first ? Object.fromEntries(Object.entries(first).map(([k, v]) => [k, Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v])) : {},
  }
  console.log(action + '：现网 ' + got.status + '｜data ' + data.length + ' 件｜样本键 ' + (first ? Object.keys(first).join(',') : '(空)'))

  if (action === 'getCatalogOrders') {
    const want = ['order', 'needsLocalImage']
    const gotKeys = first ? Object.keys(first) : []
    if (first && gotKeys.join(',') !== want.join(',')) problems.push(action + '：键序 ' + gotKeys.join(',') + ' ≠ Rust ' + want.join(','))
    else console.log('  ├ 键序与 Rust 常量一致：' + want.join(','))
  } else {
    const fn = action === 'getPublicProducts' ? 'row_to_product' : 'row_to_category'
    const want = rustKeyOrder(fn)
    const gotKeys = first ? Object.keys(first) : []
    if (!want) problems.push('读不到 api_shapes.rs 里的 ' + fn + ' 键序')
    else if (first && gotKeys.join(',') !== want.join(',')) {
      problems.push(action + '：现网键序 [' + gotKeys.join(',') + '] ≠ Rust ' + fn + ' [' + want.join(',') + ']')
    } else if (first) {
      console.log('  ├ 键序与 Rust ' + fn + ' 逐位一致（' + want.length + ' 个键）')
    }
  }
}

// 本地原生路径对账（需要 D1 凭据；本机默认没有 ⇒ 明确印 UNVERIFIED，不静默当通过）
const edgeBase = process.env.EDGE_BASE || ''
const nativeNote = edgeBase
  ? 'EDGE_BASE=' + edgeBase + ' 已给 ⇒ 可做「本地原生 vs 现网」值级对账（需 NATIVE_PUBLIC_ACTIONS 已开且 D1 已配）'
  : '未给 EDGE_BASE（且本机无 D1_API_TOKEN/D1_ACCOUNT_ID/D1_DATABASE_ID）⇒ 值级对账与原生路径实测均 UNVERIFIED（本轮只做了键集/键序对账）'
console.log('\n本地原生：' + nativeNote)

writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), live, actions: liveShapes, problems, nativeNote }, null, 2) + '\n')
console.log('原始读数 ' + jsonOut)
console.log(problems.length ? '\nGATE-FAIL check-api-parity：' + problems.length + ' 项' : '\nGATE-PASS check-api-parity：键集/键序与现网一致（值级对账见上方 UNVERIFIED 说明）')
process.exit(problems.length ? 1 : 0)
