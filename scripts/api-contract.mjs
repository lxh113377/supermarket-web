#!/usr/bin/env node
/**
 * 接口契约外化（P1-B3）
 *
 * 后端是「单入口 + action 分发」形态（/web 29 个、/pub 7 个），此前没有任何对外契约，
 * 接第二个客户端或排查问题只能翻源码。本脚本从源码解析出 action 清单及其属性
 * （是否写操作 / 是否走 KV 缓存 / 限流桶），落成 docs/api-contract.json。
 *
 * 两种模式：
 *   node scripts/api-contract.mjs            # --check（默认，门禁用）：源码与契约不一致即 exit 1
 *   node scripts/api-contract.mjs --write    # 重新生成契约文件
 *
 * 设计要点：契约文件内**不写时间戳**，保证 diff 干净、可比对的稳定。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = path.join(root, 'functions', 'lib', 'backend.js')
const SECURITY = path.join(root, 'functions', 'lib', 'security.js')
const OUT = path.join(root, 'docs', 'api-contract.json')

function sliceSection(text, start, end) {
  const i = text.indexOf(start)
  if (i < 0) throw new Error(`源码结构变更：未找到标记「${start}」`)
  const j = end ? text.indexOf(end, i) : -1
  return text.slice(i, j < 0 ? text.length : j)
}

function setLiteral(text, name) {
  const m = text.match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`))
  if (!m) throw new Error(`源码结构变更：未找到集合「${name}」`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function arrayLiteralIncludes(text, section) {
  const m = section.match(/if \(\[([^\]]*)\]\.includes\(action\)\)/)
  if (!m) return []
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

function parseCases(section) {
  const out = []
  for (const m of section.matchAll(/case '([A-Za-z0-9_]+)'/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** 逐行跟踪当前 case，记录该 action 是否走 KV 缓存、走哪个限流桶 */
function annotate(section) {
  const cache = {}
  const bucket = {}
  let cur = null
  for (const line of section.split('\n')) {
    const c = line.match(/case '([A-Za-z0-9_]+)'/)
    if (c) cur = c[1]
    if (!cur) continue
    const k = line.match(/kvCacheGetJSON\(\s*env\s*,\s*'([^']+)'/)
    if (k) cache[cur] = k[1]
    else if (/kvCacheGetJSON\(\s*env\s*,\s*[A-Za-z_]/.test(line)) cache[cur] = 'dynamic'
    if (/checkRate\(/.test(line)) {
      const b = line.match(/rate:([a-z]+):/)
      if (b) bucket[cur] = `rate:${b[1]}:{ip}`
    }
  }
  return { cache, bucket }
}

async function build() {
  const src = await readFile(BACKEND, 'utf8')
  const sec = await readFile(SECURITY, 'utf8')

  const adminSec = sliceSection(src, 'export async function handleAdmin', 'export async function handlePublic')
  const pubSec = sliceSection(src, 'export async function handlePublic', '// 兼容导出')

  const writeActions = setLiteral(src, 'ADMIN_WRITE_ACTIONS')
  const publicWhitelist = setLiteral(sec, 'PUBLIC_ACTIONS')
  const publicRateWrite = arrayLiteralIncludes(src, pubSec)

  const a = annotate(adminSec)
  const p = annotate(pubSec)

  const admin = {}
  for (const name of parseCases(adminSec)) {
    admin[name] = {
      write: writeActions.includes(name),
      cacheKey: a.cache[name] || null,
      rateBucket: a.bucket[name] || null,
    }
  }
  const pub = {}
  for (const name of parseCases(pubSec)) {
    pub[name] = {
      write: publicRateWrite.includes(name),
      cacheKey: p.cache[name] || null,
      rateBucket: p.bucket[name] || null,
    }
  }

  return {
    version: 1,
    source: 'functions/lib/backend.js（由 scripts/api-contract.mjs --write 生成，请勿手改）',
    endpoints: {
      '/web': { auth: 'required（ADMIN_KEY / ADMIN_READONLY_KEY，只读密钥受 ADMIN_WRITE_ACTIONS 拦截）', actions: admin },
      '/pub': { auth: 'none（公开接口，受 PUBLIC_ACTIONS 白名单约束）', actions: pub },
    },
    policies: {
      adminWriteActions: writeActions,
      publicWhitelist,
      publicRateLimitedWrite: publicRateWrite,
    },
  }
}

function diffList(a, b) {
  return [...a.filter((x) => !b.includes(x)), ...b.filter((x) => !a.includes(x))]
}

let pass = 0
let fail = 0
function assert(ok, name, detail = '') {
  if (ok) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const contract = await build()

  if (mode === 'write') {
    await writeFile(OUT, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
    const n = Object.keys(contract.endpoints['/web'].actions).length + Object.keys(contract.endpoints['/pub'].actions).length
    console.log(`[api-contract] 已写入 ${path.relative(root, OUT)}：/web ${Object.keys(contract.endpoints['/web'].actions).length} + /pub ${Object.keys(contract.endpoints['/pub'].actions).length} = ${n} 个 action`)
    return
  }

  // ---- check 模式：源码 vs 契约 ----
  let saved
  try {
    saved = JSON.parse(await readFile(OUT, 'utf8'))
  } catch {
    console.log('FAIL  docs/api-contract.json 不存在或不是合法 JSON — 先跑 npm run gen:api-contract')
    process.exit(1)
  }

  for (const ep of ['/web', '/pub']) {
    const now = Object.keys(contract.endpoints[ep].actions)
    const old = Object.keys(saved.endpoints?.[ep]?.actions || {})
    assert(now.length === old.length && diffList(now, old).length === 0, `${ep} action 清单与契约一致（${now.length} 个）`,
      `差异：${diffList(now, old).join(', ') || '数量不符'}`)
    for (const name of now) {
      const x = contract.endpoints[ep].actions[name]
      const y = saved.endpoints[ep].actions[name]
      if (!y) continue
      assert(x.write === !!y.write && x.cacheKey === y.cacheKey && x.rateBucket === y.rateBucket,
        `${ep} ${name} 属性（写/缓存/限流）与契约一致`,
        `代码=${JSON.stringify(x)} 契约=${JSON.stringify(y)}`)
    }
  }

  // 白名单与实现的双向一致性（能挖出"配了但没实现"或"实现了但永不放行"的死配置）
  const adminCases = Object.keys(contract.endpoints['/web'].actions)
  const pubCases = Object.keys(contract.endpoints['/pub'].actions)
  const w = contract.policies.adminWriteActions
  assert(w.every((x) => adminCases.includes(x)), 'ADMIN_WRITE_ACTIONS 每个都存在于 /web 实现中', `孤儿：${w.filter((x) => !adminCases.includes(x)).join(', ')}`)
  assert(contract.policies.publicWhitelist.length === pubCases.length
    && diffList(contract.policies.publicWhitelist, pubCases).length === 0,
    'PUBLIC_ACTIONS 白名单与 /pub 实现完全对齐',
    `差异：${diffList(contract.policies.publicWhitelist, pubCases).join(', ')}`)
  assert(contract.policies.publicRateLimitedWrite.every((x) => pubCases.includes(x)), '公开写限流集合均属 /pub 实现')

  console.log(`\n==== 结果: ${pass} 通过 / ${fail} 失败 ====`)
  if (fail) {
    console.log('接口契约已漂移 —— 若改动是有意的，请跑 npm run gen:api-contract 重新生成')
    process.exit(1)
  }
  console.log('全部通过 ✅')
}

main().catch((e) => {
  console.error('[api-contract] 执行失败：', e.message)
  process.exit(1)
})
