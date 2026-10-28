#!/usr/bin/env node
/**
 * 静态资源缓存语义判据（第七十五轮 I-75-3）
 *
 * 一手起因（@2026-10-17 实测，不是假想）：线上带内容 hash 的产物仍然回
 *   Cache-Control: public, max-age=0, must-revalidate
 * 也就是「文件名即内容指纹」这个唯一的强缓存资格被白扔了 —— 每次导航都要为几十个
 * 已缓存过的 chunk 回源复验（命中 304 时只省 body，往返照付）。这一维此前
 * **没有任何判据**：CSP 有 verify:csp、体积有 check:size，缓存只有散文注释。
 *
 * 三态（同本仓口径，绝不把「读不到」当「没问题」）：
 *   PASS        每条声明都成立，且下方「必须存在的声明」逐条在册
 *   FAIL        声明与要求不符（缺声明 / 给不该长缓存的面长缓存 / 同块重复声明）
 *   UNVERIFIED  public/_headers 不在盘面（取数面缺失，rc=2）
 *
 * 判据只读**声明面**（public/_headers 是 Cloudflare Pages 的真相源），不读线上：
 * 线上是否真照这份文件下发属于部署回执，由 check:live-shape / smoke 负责；把两类
 * 事实塞进一条闸，会得到「部署晚了就红」的不可自愈门禁。
 *
 * 用法：node scripts/check-cache-headers.mjs [--file public/_headers] [--selftest] [--json]
 * 退出码：0=通过 / 1=有声明不符 / 2=取数面缺失
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(ROOT, 'scripts', 'check-cache-headers.mjs')
export const DEFAULT_FILE = join(ROOT, 'public', '_headers')
/**
 * 上线真相源已是 dist/_headers（构建期会有脚本往里追加「生成段」，如入口 Link 预载）。
 * 只看 public/_headers，那份多出来的生成段就永远不被判据看见 ⇒ 声明面与产物漂移。
 * 本函数把两者对账：dist 去掉哨兵段之后，必须与 public 逐字相同。
 */
export function distSideDrift(rootDir = ROOT) {
  const pub = join(rootDir, 'public', '_headers')
  const distFile = join(rootDir, 'dist', '_headers')
  if (!existsSync(pub) || !existsSync(distFile)) return { skipped: true }
  const strip = (s) => {
    // 切掉**整行**哨兵段：从 '# >>> ' 那行的行首，到 '# <<< ' 那行的行尾（含换行）。
    // 第一版只切到 '# <<< ' 之后 6 个字符，把该行剩下的「inline-css 生成段 <<<」留在产物里
    // ⇒ 判据自己报漂移（这回漂移是判据造出来的，不是产物）。切整行才是对的。
    const a = s.indexOf('# >>> ')
    const b = s.indexOf('# <<< ')
    if (a < 0 || b <= a) return s.replace(/\s+$/, '')
    const endOfLine = s.indexOf('\n', b)
    const tail = endOfLine >= 0 ? s.slice(endOfLine + 1) : ''
    return (s.slice(0, a) + tail).replace(/\s+$/, '')
  }
  const p = strip(readFileSync(pub, 'utf8'))
  const d = strip(readFileSync(distFile, 'utf8'))
  return { skipped: false, same: p === d, pubLen: p.length, distLen: d.length }
}

/**
 * 必须存在的声明（顺序无关）。每一条都写清「为什么」——
 * 一句没有理由的规则，下一轮就会被当成多余的东西删掉。
 */
export const REQUIRED = [
  {
    pattern: '/assets/*',
    rule: /^\s*public,\s*max-age=(\d{6,}),\s*immutable$/i,
    why: '带内容 hash 的构建产物：文件名变则内容变 ⇒ 可以也应当 immutable 长缓存（重复访问零回源）',
    tokens: ['immutable'],
    minMaxAge: 31536000,
  },
  {
    pattern: '/images/*',
    rule: /^\s*public,\s*max-age=\d+,\s*stale-while-revalidate=\d+$/i,
    why: '商品图是「同名换内容」⇒ 只能是短强缓存 + 后台复验，绝不能 immutable（否则换图用户看不见）',
    forbidden: ['immutable'],
    maxMaxAge: 3600,
  },
  {
    pattern: '/sw.js',
    rule: /^\b.*\bmax-age=0\b.*\bmust-revalidate\b/i,
    why: 'Service Worker 脚本必须每次回源 —— 它挂长缓存后新版本可能要等一整天才会被浏览器检查',
  },
  {
    pattern: '/index.html',
    rule: /^\b.*\bmax-age=0\b.*\bmust-revalidate\b/i,
    why: '入口 HTML 引用带 hash 的 assets；它自己被缓存，用户会拿旧 entry 永远找不到新 chunk',
  },
]

/** 解析 Cloudflare Pages _headers 形态：pattern 行 + 其后两空格缩进的头行。 */
export function parseHeaders(text) {
  const out = []
  let cur = null
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim() || /^\s*#/.test(line)) continue
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), headers: {} }
      out.push(cur)
      continue
    }
    const m = /^\s+([A-Za-z0-9-]+):\s*(.+)$/.exec(line)
    if (m && cur) {
      const name = m[1].toLowerCase()
      // 同名头只留第一条并记重复：重复声明是「自相矛盾」的前身，必须点名而不是后者覆盖前者
      if (cur.headers[name] !== undefined) {
        cur.duplicate = (cur.duplicate || []).concat(name)
      } else cur.headers[name] = m[2].trim()
    }
  }
  return out
}

export function evaluate({ text }) {
  const problems = []
  const parsed = parseHeaders(text)
  const known = new Map(parsed.map((b) => [b.pattern, b]))
  const checks = []
  for (const req of REQUIRED) {
    const block = known.get(req.pattern)
    if (!block) {
      problems.push(req.pattern + '：声明面里没有这一条 ⇒ ' + req.why)
      checks.push({ pattern: req.pattern, state: 'MISSING', value: null })
      continue
    }
    if (Array.isArray(block.duplicate) && block.duplicate.length) {
      problems.push(req.pattern + '：同一块里重复声明 ' + block.duplicate.join(', ') + ' ⇒ 后者覆盖前者，读到的语义不一定是下发的')
    }
    const value = block.headers['cache-control']
    if (!value) {
      problems.push(req.pattern + '：块里没有 Cache-Control ⇒ 缓存语义只是平台默认，不是本仓的声明')
      checks.push({ pattern: req.pattern, state: 'NO-CACHE-CONTROL', value: null })
      continue
    }
    const missing = (req.tokens || []).filter((t) => !value.toLowerCase().includes(t))
    if (missing.length) {
      problems.push(req.pattern + '：Cache-Control 缺 ' + missing.join('/') + ' ⇒ 长缓存资格没兑现（' + req.why + '）')
      checks.push({ pattern: req.pattern, state: 'MISSING-TOKEN', value })
      continue
    }
    const banned = (req.forbidden || []).filter((t) => value.toLowerCase().includes(t))
    if (banned.length) {
      problems.push(req.pattern + '：Cache-Control 含 ' + banned.join('/') + ' ⇒ ' + req.why)
      checks.push({ pattern: req.pattern, state: 'FORBIDDEN-TOKEN', value })
      continue
    }
    if (!req.rule.test(value)) {
      problems.push(req.pattern + '：Cache-Control=' + JSON.stringify(value) + ' 不满足要求 ⇒ ' + req.why)
      checks.push({ pattern: req.pattern, state: 'MISMATCH', value })
      continue
    }
    const maxAge = Number((/max-age=(\d+)/i.exec(value) || [])[1])
    if (req.minMaxAge && !(maxAge >= req.minMaxAge)) {
      problems.push(req.pattern + '：max-age=' + maxAge + ' < 下限 ' + req.minMaxAge + ' 秒 ⇒ 长缓存资格没兑现（' + req.why + '）')
      checks.push({ pattern: req.pattern, state: 'TOO-SHORT', value })
      continue
    }
    if (req.maxMaxAge && !(maxAge <= req.maxMaxAge)) {
      problems.push(req.pattern + '：max-age=' + maxAge + ' > 上限 ' + req.maxMaxAge + ' 秒 ⇒ 同名换内容的面被长缓存了（' + req.why + '）')
      checks.push({ pattern: req.pattern, state: 'TOO-LONG', value })
      continue
    }
    checks.push({ pattern: req.pattern, state: 'OK', value })
  }
  // 反向腿：除 REQUIRED 外，任何被写成 immutable 的块都必须含 glob —— 防「给 /images/* 顺手加 immutable」这类看起来无害的改动
  for (const b of parsed) {
    const cc = (b.headers['cache-control'] || '').toLowerCase()
    if (cc.includes('immutable') && !/\*/.test(b.pattern)) {
      problems.push(b.pattern + '：给了 immutable 但模式里没有 glob ⇒ 这个 URL 很可能同名换内容，长缓存会让用户看不到更新')
    }
  }
  const rc = problems.length ? 1 : 0
  return { rc, checks, problems, blocks: parsed.length }
}

function selftest() {
  const base = [
    '/*', '  X-Frame-Options: DENY',
    '/assets/*', '  Cache-Control: public, max-age=31536000, immutable',
    '/images/*', '  Cache-Control: public, max-age=600, stale-while-revalidate=86400',
    '/sw.js', '  Cache-Control: public, max-age=0, must-revalidate',
    '/index.html', '  Cache-Control: public, max-age=0, must-revalidate',
  ].join('\n')
  const cases = [
    ['① 正例：四条必需声明齐备且形态正确 ⇒ rc=0', { text: base }, (r) => r.rc === 0 && r.checks.every((c) => c.state === 'OK')],
    ['② 反例：/assets/* 回落到 max-age=0（改前的真实形态）⇒ 判红并点名称长缓存资格没兑现',
      { text: base.replace('max-age=31536000, immutable', 'max-age=0, must-revalidate') },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('/assets/*') && p.includes('长缓存资格没兑现'))],
    ['③ 反例：/images/* 给了 immutable ⇒ 判红（同名换内容的面长缓存 = 换图用户看不见）',
      { text: base.replace('max-age=600, stale-while-revalidate=86400', 'max-age=31536000, immutable') },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('/images/*'))],
    ['④ 反例：/sw.js 缺失 ⇒ 判红点名（SW 挂缓存后新版本可能一整天不被检查）',
      { text: base.replace('/sw.js\n  Cache-Control: public, max-age=0, must-revalidate\n', '') },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('/sw.js'))],
    ['⑤ 反例：同块重复声明 Cache-Control ⇒ 判红点名（后者覆盖前者，读到的语义不一定是下发的）',
      { text: base.replace('  Cache-Control: public, max-age=600, stale-while-revalidate=86400', '  Cache-Control: public, max-age=600, stale-while-revalidate=86400\n  Cache-Control: public, max-age=0') },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('重复声明'))],
    ['⑥ 反例：无 glob 的模式给 immutable ⇒ 判红（同名换内容风险）',
      { text: base + '\n/favicon.svg\n  Cache-Control: public, max-age=31536000, immutable' },
      (r) => r.rc === 1 && r.problems.some((p) => p.includes('/favicon.svg'))],
    ['⑦ 解析器：注释行与空行不制造假块',
      { text: '# 只有注释\n\n# 再来一行' },
      (r) => r.blocks === 0 && r.rc === 1 && r.problems.length === REQUIRED.length],
  ]
  let bad = 0
  for (const [name, input, check] of cases) {
    let ok = false, note = ''
    try { ok = check(evaluate(input)) } catch (e) { ok = false; note = '（崩：' + e.message + '）' }
    if (!ok) bad += 1
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + note)
  }
  console.log('[cache-headers] 自证 ' + (cases.length - bad) + '/' + cases.length + (bad ? ' ⇒ 有腿没咬住' : ''))
  return bad ? 1 : 0
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const i = argv.indexOf('--file')
  const file = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : DEFAULT_FILE
  if (!existsSync(file)) {
    console.log('[cache-headers] UNVERIFIED 取数面缺失：' + file + ' ⇒ 没有声明面就无法判「缓存语义对不对」，fail-closed（rc=2）')
    return 2
  }
  const r = evaluate({ text: readFileSync(file, 'utf8') })
  if (argv.includes('--json')) { console.log(JSON.stringify({ file, ...r }, null, 2)); return r.rc }
  const tag = r.rc === 0 ? 'GATE-PASS' : 'GATE-FAIL'
  console.log('[cache-headers] ' + tag + ' :: 块 ' + r.blocks + ' 个｜必需声明 ' + r.checks.length + ' 条｜不符 ' + r.problems.length)
  for (const c of r.checks) console.log('  ' + (c.state === 'OK' ? 'OK  ' : 'BAD ') + c.pattern.padEnd(14) + ' Cache-Control=' + (c.value === null ? '(缺)' : c.value))
  for (const p of r.problems) console.log('  · ' + p)
  // 声明面 ⇄ 产物 对账：dist/_headers 去掉构建期生成段后必须与 public 逐字相同。
  // 只看 public 的话，那份多出来的生成段（入口 Link 预载）永远不被判据看见
  // ⇒ 声明面与上线真相源漂移，而漂移的那一半恰恰是线上真正生效的那一半。
  const drift = distSideDrift(ROOT)
  if (!drift.skipped && !drift.same) {
    console.log('[cache-headers] GATE-FAIL :: dist/_headers 去掉生成段后与 public/_headers 不同（声明面与产物漂移）')
    return 1
  }
  if (!drift.skipped) console.log('[cache-headers] dist 侧对账 OK（生成段之外逐字相同）')
  return r.rc
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SELF)) process.exit(main())
