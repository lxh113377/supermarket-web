// 修复 migrate-ts.mjs 早期 bug：改写时吞掉了相对导入的右引号。
// 处理两类损坏：`from './x.js`（缺右引号，行尾/分号结尾）与 `import('./x.js)`。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function stripExt(path) {
  return path.replace(/\.(js|jsx)$/, '')
}

function repair(content) {
  let out = content
  // 1) from './x.js 缺右引号（行尾，可有分号）
  out = out.replace(
    /(\bfrom\s*)(['"])(\.{1,2}\/[^'"]*?\.(?:js|jsx))(\s*;?\s*)$/gm,
    (m, pre, q, path, tail) => `${pre}${q}${stripExt(path)}'${tail}`,
  )
  // 2) import('./x.js) 缺右引号
  out = out.replace(
    /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*?\.(?:js|jsx))(?=\))/g,
    (m, pre, q, path) => `${pre}${q}${stripExt(path)}'`,
  )
  // 3) import './x.js 缺右引号（行尾，可有分号）
  out = out.replace(
    /(\bimport\s*)(['"])(\.{1,2}\/[^'"]*?\.(?:js|jsx))(\s*;?\s*)$/gm,
    (m, pre, q, path, tail) => `${pre}${q}${stripExt(path)}'${tail}`,
  )
  // 4) 兜底：仍是完整引号的相对 .js/.jsx 导入（未被 bug 触及的文件）
  out = out.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+?)(\.jsx?)(['"])/g,
    (m, pre, q1, path, ext, q2) => `${pre}${q1}${path}${q2}`,
  )
  // 5) 归一化动态导入的多余右括号：import('./x')) 多出的 ')' 移除一个
  out = out.replace(
    /(import\(\s*['"]\.{1,2}\/[^'"]+?['"])(\){3,})/g,
    (m, pre, parens) => pre + parens.slice(1),
  )
  return out
}

let fixed = 0
for (const dir of ['src', 'tests']) {
  for (const file of walk(join(ROOT, dir))) {
    const original = readFileSync(file, 'utf-8')
    const next = repair(original)
    if (next !== original) {
      writeFileSync(file, next, 'utf-8')
      fixed += 1
      console.log('fixed:', file)
    }
  }
}
console.log(`fixed files: ${fixed}`)
