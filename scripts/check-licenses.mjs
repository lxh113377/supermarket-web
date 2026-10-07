// 生产依赖 license 门禁（对标第三轮 C2；动机：本项目以 MIT 开源发布，GPL/AGPL 类传染许可会污染分发物）
// 范围：--omit=dev 生产子树（含传递依赖）。dev 依赖不进发布物，只影响本地工具链，不在本门禁口径。
// 用法：node scripts/check-licenses.mjs   （exit 0 = 全在白名单；exit 1 = 有禁止/未知许可）
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOW = new Set([
  'mit', 'isc', 'bsd-2-clause', 'bsd-3-clause', 'apache-2.0', 'apache 2.0', '0bsd',
  'cc0-1.0', 'cc-by-4.0', 'python-2.0', 'unlicense', 'wtfpl', 'blueoak-1.0.0',
  'zlib', 'libtiff', 'sqlite', 'postgres', 'bsd', 'mit AND cc0-1.0',
])
// 明确禁止：copyleft/传染/源码-available 类（含各类变体后缀，用包含判断兜住）
const DENY_SUBSTR = ['gpl', 'lgpl', 'agpl', 'sspl', 'elastic', 'common clause', 'apple', 'beesl', 'solder']

function classify(license) {
  if (!license || license === 'UNKNOWN') return 'unknown'
  const l = String(license).toLowerCase().trim()
  const expr = l.replace(/\s+or\s+/g, ' or ').replace(/\s+and\s+/g, ' and ')
  if (ALLOW.has(expr)) return 'allow'
  // 复合表达式（A and B / A or B）：所有原子都必须在白名单
  if (/\b(and|or)\b/.test(expr)) {
    const atoms = expr.split(/\b(?:and|or)\b/).map((s) => s.trim()).filter(Boolean)
    return atoms.length && atoms.every((a) => ALLOW.has(a)) ? 'allow' : 'deny'
  }
  if (DENY_SUBSTR.some((d) => l.includes(d))) return 'deny'
  return 'unknown' // 未识别一律拦下来人工看，防"没见过=没问题"
}

const phantom = []

function walk(tree, key, acc) {
  for (const [name, info] of Object.entries(tree?.dependencies || {})) {
    if (info.extraneous) continue // 本机 node_modules 残留（如历史 optional 二进制）不代表 lock 依赖，CI 的 npm ci 树里没有它
    // 未安装的可选 peer（2026-10-07 打印页引入 three 生态后实测）：npm ls --all 会把
    // `@react-three/fiber → expo / react-native`、`zustand → immer`、`lenis → vue / @nuxt/kit`
    // 这类 optional peerDependencies 列成**空对象 {}**（无 version、磁盘上无包文件）。
    // 它们根本没被安装 ⇒ 不在 lock 解析出的安装树里 ⇒ 不进发布物，按许可口径不该有发言权；
    // 但原实现把它们算进分母并报「未知 → 未找到包文件」，于是任何带可选 peer 的依赖都装不进来。
    // 判据收紧为「无 version **且** 磁盘上确实没有包文件」——两者缺一仍照旧进分母，
    // 不把"真缺依赖"也一并豁免（与 :55 零分母 fail-closed 同一口径）。跳过项逐条打印，不静默。
    if (!info.version && !existsSync(path.join(ROOT, 'node_modules', name, 'package.json'))) {
      phantom.push(name)
      continue
    }
    const id = `${name}@${info.version || '?'}`
    if (!acc.has(id)) acc.set(id, info.license ?? info.link ?? '')
    if (info.dependencies) walk(info, name, acc)
  }
  void key
}

const r = spawnSync('npm', ['ls', '--omit=dev', '--json', '--all'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
// npm ls 对 peer 警告会给非零 exit，但 JSON 仍是完整树——只在解析失败时报错
let json
try { json = JSON.parse(r.stdout || '{}') } catch {
  console.error('[licenses] npm ls JSON 解析失败：', (r.stderr || r.stdout || '').slice(0, 300))
  process.exit(1)
}
const pkgs = new Map()
walk(json, 'root', pkgs)
// 零分母不得判绿（第二十五轮实测）：在没有 package.json / node_modules 的目录里 npm ls 返回空对象，
// 本判据当时打印「0 个生产依赖（含传递）全部 … 白名单 ✅」并 exit 0 —— 把"什么都没扫到"读成"扫过且清白"，
// 与第十八~二十一轮"CI 全绿"假账同机制。取不到依赖树属环境不满足，按 fail-closed 退出。
if (pkgs.size === 0) {
  console.error('[licenses] 环境不满足：npm ls --omit=dev 给出 0 个生产依赖 ⇒ 要么没装依赖（先 npm ci），'
    + `要么取数面不在此目录（${ROOT}）。没有对象就判"全在白名单"是没意义的，fail-closed 退出（rc=2）`)
  process.exit(2)
}
// npm ls 的 JSON 不携带 license 字段（实测）——逐个回读 node_modules 里的 package.json
const bad = []
for (const [id] of pkgs) {
  const name = id.slice(0, id.lastIndexOf('@'))
  let lic = ''
  const direct = path.join(ROOT, 'node_modules', name, 'package.json')
  if (existsSync(direct)) {
    try { lic = JSON.parse(readFileSync(direct, 'utf8')).license || '' } catch { lic = '' }
  } else {
    lic = '(未找到包文件)'
  }
  const c = classify(lic)
  if (c !== 'allow') bad.push(`${c === 'deny' ? '禁止' : '未知'} ${id} → ${lic || '(无 license 字段)'}`)
}
const uniqPhantom = [...new Set(phantom)].sort()
if (uniqPhantom.length) {
  console.log(`[licenses] 跳过 ${uniqPhantom.length} 个未安装的可选 peer（无 version 且磁盘无包文件，不进发布物）：${uniqPhantom.join(', ')}`)
}
if (bad.length) {
  console.error(`[licenses] ${bad.length}/${pkgs.size} 个生产依赖许可不在白名单：`)
  bad.slice(0, 30).forEach((b) => console.error('  - ' + b))
  process.exit(1)
}
console.log(`[licenses] ${pkgs.size} 个生产依赖（含传递）全部 MIT/BSD/Apache/ISC 类白名单 ✅`)
