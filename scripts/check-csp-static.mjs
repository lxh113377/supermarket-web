#!/usr/bin/env node
/**
 * 静态 HTML 的 CSP 自洽门禁（第十一轮 R11-H2）
 *
 * 起因是本轮一次**测错机制**的误判：我拿 markup 的 `style=` 属性做探针，量出"被 CSP 拦"，
 * 就断言 React 的 8 处内联样式在线上全死了；复测才发现 React 走 CSSOM（放行），
 * 而被拦的只有 markup 属性与 `<style>` 元素（见 memory/2026-09-26.md 第十一项）。
 * 结论落两条：
 *  ① 真实内容上的 CSSOM 生效与否，由 `tests/e2e-visual/layout.spec.ts` 在**生产构建**上判；
 *  ② 静态 HTML 面（会被 markup 路径命中的那一层）由本门禁判 —— 它带内联样式就是死样式，
 *     而且静默：浏览器只报一条 console 违规，页面看起来"只是没样式"。
 * 顺带把 F2（去掉 `style-src 'unsafe-inline'`）从"改过一次"变成"改不掉"。
 *
 * 退出码：0=自洽 / 1=违反（含 CSP 缺失）/ 2=一个 HTML 都没扫到（空集绝不记绿）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function findStaticHtml(rootDir) {
  const out = []
  if (existsSync(join(rootDir, 'index.html'))) out.push('index.html')
  const pub = join(rootDir, 'public')
  if (existsSync(pub)) {
    for (const f of readdirSync(pub)) if (f.endsWith('.html')) out.push(`public/${f}`)
  }
  return out
}

/** 取某个 CSP 指令的取值（返回 {error} 表示缺该指令）。 */
export function cspDirective(metaContent, name) {
  // 反引号里的取值本身含单引号（'self' / 'unsafe-inline'），所以只能按"配对的另一种引号"取，
  // 不能用 [^"']+ —— 那会在第一个 ' 处截断（夹具首跑就是被这条打回全红的）。
  const one = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])([\s\S]*?)\1/i.exec(metaContent)
  if (!one) return { error: '没找到 CSP meta（http-equiv=Content-Security-Policy）' }
  for (const part of one[2].split(';')) {
    const cells = part.trim().split(/\s+/)
    if (cells[0] === name) return { value: cells.slice(1).join(' ') }
  }
  return { error: `CSP 里没有 ${name} 指令` }
}

export function judgeStaticHtml(file, html) {
  const problems = []
  const styleSrc = cspDirective(html, 'style-src')
  if (styleSrc.error) {
    problems.push(`${file}：${styleSrc.error}`)
    return problems
  }
  for (const weak of ["'unsafe-inline'", "'unsafe-hashes'"]) {
    if (styleSrc.value.includes(weak)) problems.push(`${file}：style-src 含 ${weak} ⇒ F2 的收紧被回退（内联样式重新变成可注入面）`)
  }
  const scriptSrc = cspDirective(html, 'script-src')
  if (scriptSrc.error) problems.push(`${file}：${scriptSrc.error}`)
  else if (scriptSrc.value.includes("'unsafe-inline'")) problems.push(`${file}：script-src 含 'unsafe-inline'（脚本面比样式面更危险）`)

  // markup 路径：静态 HTML 里的 style 属性在这套 CSP 下必然被拦 ⇒ 写了就是死样式，不许留
  const attrHits = [...html.matchAll(/<[^>]+\sstyle=["'][^"']*["']/gi)].map((m) => m[0].slice(0, 60))
  for (const h of attrHits) problems.push(`${file}：静态 HTML 带内联 style 属性（被 style-src 'self' 拦掉，是死样式）→ ${h}`)
  if (/<style[\s>]/i.test(html)) problems.push(`${file}：静态 HTML 带 <style> 元素（同样被拦；dev 下 Vite 注入的那份不算，本门禁只扫源码与 public）`)
  return problems
}

function main() {
  const files = findStaticHtml(ROOT)
  if (!files.length) {
    console.error('[csp-static] 一个静态 HTML 都没扫到 ⇒ 判据没有对象，不记绿（请检查 index.html 是否还在）')
    process.exit(2)
  }
  const problems = []
  for (const f of files) problems.push(...judgeStaticHtml(f, readFileSync(join(ROOT, f), 'utf8')))
  console.log(`[csp-static] 扫描 ${files.length} 个静态 HTML：${files.join(', ')}`)
  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`)
    console.error(`[csp-static] FAIL ${problems.length} 项`)
    process.exit(1)
  }
  console.log('[csp-static] OK CSP 严格（style/script-src 均无 unsafe-inline）且静态 HTML 不带死内联样式')
}

const isCli = !!process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isCli) main()
