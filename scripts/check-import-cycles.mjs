/**
 * 静态检测 src/ 下的 ESM 循环依赖。
 *
 * 背景：目录缓存需要被 db.js（读写）和 auth.js（失效）共用，而 db.js 本身
 * 依赖 auth.js 的 adminCall。若把缓存放在 db.js，就会形成 db ↔ auth 环。
 * 本脚本用于持续保证这类环不再出现。
 *
 * 用法：node scripts/check-import-cycles.mjs
 * 退出码：0 = 无环；1 = 检测到环。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
// ⚠️ 2026-09-23 第三轮优化修复：TS 迁移（41 文件）后 EXTS 仍只含 JS 系，walk 永远 0 命中、
// 门禁恒报"0 个模块/无环"= 静默假通过（R236 同族）。必须覆盖全部源码扩展名。
const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXTS.includes(path.extname(entry.name))) out.push(full)
  }
  return out
}

// 匹配 import ... from 'x' / export ... from 'x' / import('x')
const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * 剥离注释，避免注释里的示例代码（如 `import x from './db.js'`）被误判成真依赖。
 * 用逐字符状态机而非正则，这样字符串/模板串里的 // 和 /* 不会被当成注释起点。
 */
function stripComments(code) {
  let out = ''
  let i = 0
  let quote = null // 当前所处的字符串引号类型
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (quote) {
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue }
      if (ch === quote) quote = null
      out += ch; i++; continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i++; continue }
    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    out += ch; i++
  }
  return out
}

function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return null // 第三方包不参与环检测
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))]
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null
}

const files = walk(SRC)
const graph = new Map()
for (const file of files) {
  const code = stripComments(fs.readFileSync(file, 'utf8'))
  const deps = new Set()
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2]
    if (!spec) continue
    const resolved = resolveSpecifier(file, spec)
    if (resolved) deps.add(resolved)
  }
  graph.set(file, [...deps])
}

// DFS 找环
const cycles = []
const WHITE = 0, GRAY = 1, BLACK = 2
const color = new Map(files.map((f) => [f, WHITE]))
const stack = []

function dfs(node) {
  color.set(node, GRAY)
  stack.push(node)
  for (const dep of graph.get(node) || []) {
    const c = color.get(dep)
    if (c === GRAY) {
      cycles.push([...stack.slice(stack.indexOf(dep)), dep])
    } else if (c === WHITE) {
      dfs(dep)
    }
  }
  stack.pop()
  color.set(node, BLACK)
}

for (const f of files) if (color.get(f) === WHITE) dfs(f)

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
// 用 process.stdout.write 而非 console.log：本仓库 lint 规则 no-console 只放行 warn/error，
// 而 CLI 工具的正常结果输出本就该走 stdout，不该降级成 warn。
const out = (line) => process.stdout.write(line + '\n')

out(`扫描模块: ${files.length} 个`)

if (cycles.length === 0) {
  out('✅ 未检测到循环依赖')
  process.exit(0)
}

out(`❌ 检测到 ${cycles.length} 处循环依赖:`)
for (const cycle of cycles) out('   ' + cycle.map(rel).join(' -> '))
process.exit(1)
