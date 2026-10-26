// 静态首屏复刻的「不许漂移」判据。
//
// 复刻（crates/edge/src/shell.rs::replica_markup）是**手写的 HTML**，而真身是 React 组件
// （src/components/brand/MarketHero.tsx、CustomerHeader.tsx、BrandMark.tsx）。
// 手写复刻最大的风险不是写错一次，而是**改完组件忘了改复刻** —— 于是复刻里的
// `market-title` 之类会被设计系统改名后悄悄失配，表现为「首屏闪一下旧样式」。
//
// 本判据的做法：从三个源文件里抽出所有 class 片段，逐个要求它出现在复刻里；
// 复刻**故意**不渲染的部分（动态照片）写进 ALLOWED_MISSING 并给出理由。
//
// 用法：node rust/scripts/check-shell-parity.mjs [--edge <边缘服务可执行文件>] [--dist <目录>]

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const repoRoot = path.resolve(rustRoot, '..')
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const edgeBin = path.resolve(argOf('--edge', path.join(rustRoot, 'target', 'release', 'supermarket-edge.exe')))
const dist = path.resolve(argOf('--dist', path.join(repoRoot, 'dist')))

// 复刻刻意不渲染的部分：动态内容（每次开屏随机抽三件照片）由 React 挂载后填进来，
// 复刻里放任何一组都会被替换掉（内容不被承认的闪动），所以干脆留空容器。
const ALLOWED_MISSING = new Set([
  // 每次开屏随机抽三件照片（MarketHero 的 pickExhibits）：复刻里放任何一组
  // 都会被 React 挂载后换掉（内容不被承认的闪动），所以留空容器。
  'market-exhibit', 'exhibit-photo', 'exhibit-back', 'exhibit-side',
  // 路由加载态：复刻不涉及路由切换。
  'loading-badge', 'route-progress',
  // BrandMark 的反色变体：只在非首页头部使用（首页头部走默认变体）。
  'brand-lockup-inverse',
])
// 复刻比这三个组件多出的一层：HomePage 的外层容器（承载全页 background/color/overflow:clip）。
const ALLOWED_EXTRA = new Set([
  // HomePage 的外层容器（全页 background/color/overflow:clip）。
  'home-page',
  // BrandMark 里它是模板字面量的一部分（`brand-lockup ${inverse ? ...}`），
  // 抽取器按「含动态段即跳过」处理，所以它落在「源里没抓到、复刻里有」这一侧。
  'brand-lockup',
])

// 只认「构建产物 CSS 里真有这条规则」的片段 —— 这是把 class 名与代码标识符分开的判据，
// 而不是靠人维护一张忽略名单（同一段源码里 react-router-dom 之类也会被正则捞到）。
const assetsDir = path.join(dist, 'assets')
const cssFile = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.css')).map((f) => path.join(assetsDir, f))[0]
  : null
const cssText = cssFile ? readFileSync(cssFile, 'utf8') : ''
const inCss = (token) => cssText.includes('.' + token)

const sources = [
  'src/components/brand/MarketHero.tsx',
  'src/components/brand/CustomerHeader.tsx',
  'src/components/brand/BrandMark.tsx',
]

const classTokens = (text) => {
  const tokens = new Set()
  // 静态写法：className="a b c"
  for (const m of text.matchAll(/className="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) if (token) tokens.add(token)
  }
  // 表达式写法：className={cond ? 'a' : ''} / className={`...`}
  // 只取里面的字符串/模板字面量；模板里含动态段（$ 开头）的直接跳过 —— 那是复刻无法复现的部分。
  for (const m of text.matchAll(/className=\{([^}]*)\}/g)) {
    for (const lit of m[1].matchAll(/'([^']*)'|`([^`]*)`/g)) {
      const raw = lit[1] ?? lit[2] ?? ''
      if (raw.includes('$')) continue
      for (const token of raw.split(/\s+/)) if (token) tokens.add(token)
    }
  }
  return tokens
}

const wanted = new Set()
for (const rel of sources) {
  const file = path.join(repoRoot, rel)
  if (!existsSync(file)) {
    console.error('找不到源文件：' + file)
    process.exit(2)
  }
  for (const token of classTokens(readFileSync(file, 'utf8'))) {
    if (inCss(token) || ALLOWED_MISSING.has(token)) wanted.add(token)
  }
}

const shell = spawnSync(edgeBin, ['shell', '--dist', dist, '--boot-replica'], { encoding: 'utf8' })
if (shell.status !== 0) {
  console.error('生成复刻失败：' + (shell.stderr || '').slice(-400))
  process.exit(2)
}
const replica = shell.stderr.includes('复刻=true')
if (!replica) {
  console.error('外壳里没有复刻（--boot-replica 没生效）')
  process.exit(2)
}
const html = shell.stdout
const rootStart = html.indexOf('<div id="root">')
const rootEnd = html.indexOf('</div></body>') >= 0 ? html.indexOf('</div></body>') : html.length
const rootHTML = html.slice(rootStart, rootEnd >= 0 ? rootEnd + 6 : html.length)
const present = new Set()
for (const m of rootHTML.matchAll(/class="([^"]*)"/g)) {
  for (const token of m[1].split(/\s+/)) if (token) present.add(token)
}

const missing = [...wanted].filter((token) => !present.has(token) && !ALLOWED_MISSING.has(token)).sort()
const extra = [...present].filter((token) => !wanted.has(token) && !ALLOWED_EXTRA.has(token)).sort()

console.log('构建 CSS：' + (cssFile ? path.basename(cssFile) : '（未找到）'))
console.log('源组件里的 class 片段：' + wanted.size + ' 个')
console.log('复刻里出现的 class：' + present.size + ' 个')
console.log('有意省略（动态内容）：' + [...ALLOWED_MISSING].join(', '))
if (missing.length) {
  console.log('❌ 复刻缺少这些 class（组件改名或漏写）：' + missing.join(', '))
}
if (extra.length) {
  console.log('⚠ 复刻多出这些 class（源里没有，需说明来源）：' + extra.join(', '))
}
if (missing.length) process.exit(1)
console.log('✅ 复刻与源组件的 class 面一致')
