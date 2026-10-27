// 字体分包的「不许漂移」判据。
//
// 分包（rust/scripts/split-display-font.py）把「一个 215 KB 文件」换成「A 包 + 6 个懒加载包」。
// 它带来一个大收益（首屏字体从 215 KB 降到 3 KB），也带来一类新缺陷：
//   · 漏掉几个字形 ⇒ 页面上那些字静默掉到系统字体（视觉不一致，肉眼未必立刻发现）；
//   · CSS 的 unicode-range 与文件内容对不上 ⇒ 浏览器拿到一个不含该字形的包；
//   · 有人把 A 包换成大文件 / 把旧文件又加回去 ⇒ 收益悄悄消失。
// 本判据把这三类都变成可执行断言，另附体积预算。
//
// 用法：node rust/scripts/check-font-split.mjs

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rustRoot = path.resolve(here, '..')
const repoRoot = path.resolve(rustRoot, '..')
const manifestPath = path.join(rustRoot, 'fonts', 'display-font-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const problems = []
const ok = (msg) => console.log('  PASS ' + msg)
const bad = (msg) => { problems.push(msg); console.log('  FAIL ' + msg) }

// ── 1. 文件面：存在 / 哈希 / 两两不重叠 / A 包覆盖首屏 ──
// 补包（ext）与主分包同列为「必须校验的产物」：它同样是发布面的一份 woff2，
// 只查主分包等于给补包留了一个没人管的角落。
const allPackages = manifest.packages.concat(manifest.ext ? [manifest.ext] : [])
const seen = new Map()
for (const pkg of allPackages) {
  const file = path.join(repoRoot, 'public', 'fonts', pkg.file)
  if (!existsSync(file)) { bad('缺文件 ' + pkg.file); continue }
  const bytes = readFileSync(file)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== pkg.sha256) bad(pkg.file + ' 的 sha256 与 manifest 不符（分包产物被改过）')
  if (bytes.length !== pkg.bytes) bad(pkg.file + ' 体积与 manifest 不符')
  for (const cp of pkg.codepoints) {
    if (seen.has(cp)) bad('码点 U+' + cp.toString(16).toUpperCase() + ' 同时出现在 ' + seen.get(cp) + ' 与 ' + pkg.name)
    seen.set(cp, pkg.name)
  }
}
if (!problems.length) ok(allPackages.length + ' 个包（含补包）：文件、sha256、体积与 manifest 一致')

const pkgA = manifest.packages.find((p) => p.name === 'a')
// manifest 里 firstScreenUnion 是码点数组（charset.json 里是字符数组）——两种都吃，
// 免得「同一份事实两种编码」把判据本身弄崩。
const cpOf = (c) => (typeof c === 'number' ? c : c.codePointAt(0))
const firstScreen = new Set(manifest.firstScreenUnion.map(cpOf))
const missingFromA = [...firstScreen].filter((cp) => !pkgA.codepoints.includes(cp))
if (missingFromA.length) bad('首屏字符不在 A 包：' + missingFromA.map((c) => String.fromCodePoint(c)).join(''))
else ok('A 包覆盖全部首屏展示体字符（' + firstScreen.size + ' 种）')

// ── 2. 并集 == 源字体的 cmap（用 fontTools 问源文件，不靠 manifest 自述） ──
{
  const source = path.join(rustRoot, 'fonts', manifest.source)
  // 单行 Python：多行脚本经模板串拼出来时容易把换行写成字面 \n（第一版就栽在这），
  // 一行式没有这个风险，也不必再塞个临时脚本文件。
  const py = 'import json,sys;from fontTools.ttLib import TTFont;print(json.dumps(sorted(TTFont(sys.argv[1]).getBestCmap().keys())))'
  const res = spawnSync('python', ['-c', py, source], { encoding: 'utf8' })
  if (res.status !== 0) {
    bad('取源字体 cmap 失败：' + (res.stderr || '').slice(-200))
  } else {
    // 第一行是 -c 的脚本正文，真正的输出在最后一行
    const line = res.stdout.trim().split('\n').pop()
    const sourceCps = JSON.parse(line)
    const lost = sourceCps.filter((cp) => !seen.has(cp))
    if (lost.length) bad('源字体有 ' + lost.length + ' 个字形没有被任何分包覆盖：' + lost.slice(0, 12).map((c) => String.fromCodePoint(c)).join(''))
    else ok('分包并集 == 源字体 cmap（' + sourceCps.length + ' 字形，一个不漏）')
  }
}

// ── 2b. 补包面：并集 == 补包源 cmap；且「站内用到的 CJK 字形」一个不缺 ──
// 这两条就是本轮的目标断言：「557 个缺字的回退缺口」必须被补包结构性填上，
// 而不是靠「补包存在」这种弱判据（存在≠覆盖，覆盖≠不重叠）。
if (manifest.ext) {
  const extSource = path.join(rustRoot, 'fonts', manifest.extSource ? manifest.extSource : 'display-serif-cjk-ext.source.woff2')
  const py = 'import json,sys;from fontTools.ttLib import TTFont;print(json.dumps(sorted(TTFont(sys.argv[1]).getBestCmap().keys())))'
  const res = spawnSync('python', ['-c', py, extSource], { encoding: 'utf8' })
  if (res.status !== 0) {
    bad('取补包源 cmap 失败：' + (res.stderr || '').slice(-200))
  } else {
    const srcCps = JSON.parse(res.stdout.trim().split('\n').pop())
    const lost = srcCps.filter((cp) => !seen.has(cp))
    if (lost.length) bad('补包源有 ' + lost.length + ' 个字形没被任何包覆盖：' + lost.slice(0, 12).map((c) => String.fromCodePoint(c)).join(''))
    else ok('全部包并集 == 补包源 cmap（' + srcCps.length + ' 字形，一个不漏）')
  }
  const extCharset = JSON.parse(readFileSync(path.join(rustRoot, 'fonts', 'display-charset-ext.json'), 'utf8'))
  // 白名单只有两个「不是字形需求」的码点：U+FE0F（变体选择符，跟在前一个字符后面生效）
  // 与 U+FEFF（零宽不换行空格/BOM）。它们本来就不该有字形。
  const NOT_GLYPHS = new Set([0xfe0f, 0xfeff])
  const stillMissing = extCharset.usedCjk.filter((cp) => !seen.has(cp) && !NOT_GLYPHS.has(cp))
  if (stillMissing.length) {
    bad('站内用到的 ' + stillMissing.length + ' 个 CJK 字形仍无包覆盖（回退缺口没补上）：' + stillMissing.slice(0, 12).map((c) => String.fromCodePoint(c)).join(''))
  } else {
    ok('站内用到的 CJK 字形已全覆盖（' + extCharset.usedCjk.length + ' 种；仅剩 ' + (extCharset.usedCjk.length - extCharset.usedCjk.filter((cp) => seen.has(cp)).length) + ' 个非字形码点走回退）')
  }
}

// ── 3. CSS 面：src/index.css 必须为每个分包给出同名的 @font-face + 同 unicode-range ──
{
  const css = readFileSync(path.join(repoRoot, 'src', 'index.css'), 'utf8')
  const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1])
  for (const pkg of allPackages) {
    const hit = blocks.filter((b) => b.includes(pkg.file))
    if (!hit.length) { bad('src/index.css 缺少 ' + pkg.file + ' 的 @font-face'); continue }
    const block = hit[0]
    const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1] || ''
    // 比对时去掉空白，避免排版差异造成假红
    const norm = (s) => s.replace(/\s+/g, '').toUpperCase()
    if (norm(range) !== norm(pkg.unicodeRange)) bad(pkg.file + ' 的 unicode-range 与分包内容不符')
    if (!/font-display:\s*swap/.test(block)) bad(pkg.file + ' 的 @font-face 少了 font-display: swap')
  }
  if (!problems.length) ok('src/index.css 的 ' + allPackages.length + ' 条 @font-face 与分包一一对应')
}

// ── 4. 入口面：index.html 只 preload A 包；旧单文件不许再出现 ──
{
  const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8')
  if (!html.includes(pkgA.file)) bad('index.html 没有 preload A 包（' + pkgA.file + '）')
  if (/display-serif-cjk\.woff2/.test(html)) bad('index.html 还在引用旧的单文件字体')
  // 只在「声明面」上判：注释里提到旧文件是解释性文字（本文件就写了为什么拆），不算漂移。
  const cssNoComment = readFileSync(path.join(repoRoot, 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  if (/display-serif-cjk\.woff2/.test(cssNoComment)) bad('src/index.css 的声明里还在引用旧的单文件字体')
  if (existsSync(path.join(repoRoot, 'public', 'fonts', 'display-serif-cjk.woff2'))) {
    bad('旧单文件仍在 public/fonts/ —— 它会随站点发布，且让「首屏只下 3 KB」这个收益失效')
  }
  if (!problems.length) ok('入口只 preload A 包，旧单文件已从发布面移除')
}

// ── 5. 体积预算 ──
{
  const total = manifest.packages.reduce((s, p) => s + p.bytes, 0)
  // 预算 16 KB：A 包要装下「首屏 + 首屏路由整页」的展示体文字（约 60 字形），
  // 这样首屏加载不会因为折叠下内容再连锁拉起分片。源文件 215,580 B，16 KB 是它的 7.4%。
  if (pkgA.bytes > 16 * 1024) bad('A 包超过 16 KB 预算（' + pkgA.bytes + ' B）')
  else ok('A 包 ' + pkgA.bytes + ' B ≤ 16 KB 预算（源文件的 ' + ((pkgA.bytes / manifest.sourceBytes) * 100).toFixed(1) + '%）')
  if (total > manifest.sourceBytes * 1.12) bad('主分包合计 ' + total + ' B 超过源文件 112%（' + manifest.sourceBytes + ' B）')
  else ok('主分包合计 ' + total + ' B（源 ' + manifest.sourceBytes + ' B，切分总成本 +' + (total - manifest.sourceBytes) + ' B）')
  if (manifest.ext) {
    // 补包预算 150 KB：它是懒加载面（只有页面上真出现那 562 个字之一才会下），
    // 换掉的是「564 个字走系统回退」这个已实测的视觉不一致。
    if (manifest.ext.bytes > 150 * 1024) bad('补包超过 150 KB 预算（' + manifest.ext.bytes + ' B）')
    else ok('补包 ' + manifest.ext.bytes + ' B ≤ 150 KB 预算（懒加载面；覆盖 ' + manifest.ext.glyphs + ' 个缺字）')
  }
}

console.log(problems.length ? '\nGATE-FAIL check-font-split：' + problems.length + ' 项' : '\nGATE-PASS check-font-split：全部通过')
process.exit(problems.length ? 1 : 0)
