// TypeScript 迁移助手（一次性）：把 src/ 下 .js/.jsx 重命名为 .ts/.tsx，
// 并只改写 import/export 说明符里的相对路径扩展名（不动运行时字符串如 './sw.js'）。
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TESTS = join(ROOT, 'tests')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function isGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const git = isGitRepo()

// 1) 重命名 src 下文件
const renames = []
for (const file of walk(SRC)) {
  const ext = file.endsWith('.jsx') ? '.tsx' : '.ts'
  const extLen = file.endsWith('.jsx') ? 4 : 3
  const target = file.slice(0, -extLen) + ext
  if (!existsSync(target)) {
    if (git) execFileSync('git', ['mv', file, target], { cwd: ROOT })
    else execFileSync('mv', [file, target], { cwd: ROOT })
    renames.push(`${relative(ROOT, file)} -> ${relative(ROOT, target)}`)
  }
}

// 2) 改写相对导入说明符（仅 src 内部 + 测试对 src 的引用）
function rewrite(content, isTest) {
  const strip = (m, pre, q1, path, q2) => `${pre}${q1}${path}${q2}`
  let out = content
  if (isTest) {
    out = out.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.\.\/src\/[^'"]+?)(\.jsx?)(['"])/g, strip)
  } else {
    out = out.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+?)(\.jsx?)(['"])/g, strip)
  }
  return out
}

function walkAny(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkAny(full))
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

let rewritten = 0
for (const file of walkAny(SRC)) {
  const original = readFileSync(file, 'utf-8')
  const next = rewrite(original, false)
  if (next !== original) {
    writeFileSync(file, next, 'utf-8')
    rewritten += 1
  }
}
for (const file of walkAny(TESTS)) {
  const original = readFileSync(file, 'utf-8')
  const next = rewrite(original, true)
  if (next !== original) {
    writeFileSync(file, next, 'utf-8')
    rewritten += 1
  }
}

console.log(`renamed: ${renames.length} files`)
renames.slice(0, 20).forEach((r) => console.log('  ' + r))
console.log(`rewritten: ${rewritten} files`)
