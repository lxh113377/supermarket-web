// 对标第四十三轮（2026-09-28）：**文档里印出来的命令，有没有人和现实对过账**
//
// 一手实况（本轮实测）：`grep -c "npm run" scripts/check-doc-consistency.mjs` = **0** —— 现成的文档
// 判据只核**数字**（action 条数 / 覆盖率阈值 / 单测文件数），从不核**命令**。而 durable 文档里
// code-span 形态的 `npm run X` / `node scripts/Y.mjs` 实测 108 条提及、**4 条不成立**：
//   - `docs/implementation-plan-2026-08-08.md` 的 `npm run predeploy` ×3 = CloudBase 时代死命令
//     （部署权威 skill §7 明写"照旧版执行 = 部署到已死的腾讯云"），但它躺在**历史归档**里，不是缺陷；
//   - `docs/cli-entrypoints.md` 的 `node scripts/X.mjs` = 用法骨架的**占位符**，也不是缺陷。
// ⇒ 难点不是"抓到 4 条"，而是**不把这两类误判成缺陷**：一把只会红的尺，下一轮就被人加白名单消音。
//
// 三类面（分类本身是判据，不是注释）：
//   claim    现行主张 ⇒ 必须成立（alias 在册 / 文件在盘），否则 D2 点名判红
//   template 模板占位 ⇒ 按形状认（大写 X/Y 结尾文件名、<...>、…、$VAR）；D3 配**反向腿**证明
//              真文件名不会被这类吞掉，否则"占位符"就成了万能豁免口
//   archive  历史归档 ⇒ 按**路径 + 声明的截止时刻**认，过期即重新入 claim（历史不许当永久豁免）
// 取数面结构性枚举（README/SECURITY/CONTRIBUTING/HANDOFF + docs/**/*.md），零输入不得 PASS。
// 只认 code-span：散文里那句 "npm run verify" 是指令还是叙述不可判 ⇒ 不入面（写明以免后来人以为漏了）。
// 另有 D5 反向：门禁类 alias 在册却任何文档都不提 ⇒ "有闸没人知道"（承 R41-H3 未做完的那半）。
//
// 用法：node scripts/check-doc-commands.mjs            全量校验
//       node scripts/check-doc-commands.mjs --update   重写登记册（人填字段保留）
//       node scripts/check-doc-commands.mjs --fixture F [--aliases A]  喂合成面（夹具/演练，不读真仓）
//       node scripts/check-doc-commands.mjs --inject-red   演习：注入假主张，必须当场判红
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reasonDefects } from './lib/registry-reason.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(__dirname, '..')
export const SELF = 'scripts/check-doc-commands.mjs'
export const REGISTRY = 'docs/doc-commands.json'
const CODE_SPAN_RE = /`([^`\n]+)`|```(?:bash|sh|shell|console)?\n([\s\S]*?)```/g
const CMD_RE = /npm run ([a-zA-Z0-9:._-]+)|node\s+(?:--\S+\s+)*?((?:scripts|[.\w/-]*\/scripts)\/[A-Za-z0-9._/<>-]+\.(?:mjs|cjs|js|py))/g
const PLACEHOLDER_RE = /(<[^>\n]+>|…|\$\{?[A-Z_][A-Z0-9_]*\}?|\b[A-Za-z0-9._-]*[XY]\.(?:mjs|js|py)\b)/

export function collectDocs(readRoot = ROOT) {
  const out = []
  // 第四十八轮 R48-H3：`CHANGELOG.md` 原本**整份不在取数面里** —— 一手实测（@2026-09-28）：
  // 往里植入一条盘上根本不存在的 `node scripts/zz-not-a-real-file.mjs`，提及数 128→128 纹丝不动、D2 仍 GREEN
  // ⇒ 变更日志里每条"跑 X 即可复现"都是没人核过的断言，而它恰恰是最容易被后来人照抄的那份文档。
  // 上轮我担心"历史条目里的 CloudBase 死命令会让它一入面就恒红"，本轮先量再动：
  // 现面 137 条命令式 code-span，涉及 6 个脚本名（盘上不存在 **0** 个）、28 个别名（不在册 **0** 个）
  // ⇒ 直接进 claim 面，零红。真要出现"历史命令已失效"，走它自己的归档面（`archive_faces` + `exempt_until`），
  // 而不是把这份文档长期留在面外（第四十一轮"历史不是永久豁免"的同一口径，方向反过来用）。
  for (const f of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'HANDOFF.md', 'CHANGELOG.md']) {
    const p = join(readRoot, f)
    if (existsSync(p)) out.push({ path: f, src: readFileSync(p, 'utf8') })
  }
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (e.endsWith('.md')) out.push({ path: relative(readRoot, full).replace(/\\/g, '/'), src: readFileSync(full, 'utf8') })
    }
  }
  walk(join(readRoot, 'docs'))
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** 抽出一份文档里的全部命令主张，带行号（红因要能指到人眼下那一行）。 */
export function extractCommands(src) {
  const found = []
  for (const m of src.matchAll(CODE_SPAN_RE)) {
    const body = m[1] !== undefined ? m[1] : (m[2] || '')
    const line = src.slice(0, m.index).split('\n').length
    for (const c of body.matchAll(CMD_RE)) {
      const target = c[1] || c[2]
      found.push({ kind: c[1] ? 'npm' : 'file', target, line, placeholder: PLACEHOLDER_RE.test(target) })
    }
  }
  return found
}

export function readAliases(readRoot = ROOT) {
  const pkg = JSON.parse(readFileSync(join(readRoot, 'package.json'), 'utf8'))
  return Object.entries(pkg.scripts || {}).map(([name, cmd]) => ({ name, cmd: String(cmd) }))
}

export function evaluate({ docs, aliases, fileExists = () => true, registry, injected = null }) {
  const rows = []
  const push = (id, ok, label, detail) => rows.push({ id, ok, label, detail })
  const aliasNames = new Set(aliases.map((a) => a.name))
  const archiveFaces = (registry && registry.archive_faces) || []
  const nowIso = (registry && registry.observed_utc) || new Date().toISOString()
  const all = docs.flatMap((d) => extractCommands(d.src).map((c) => ({ ...c, file: d.path })))
    .concat(injected || [])
  const liveAt = (path) => archiveFaces.find((a) => path === a.path || path.startsWith(a.prefix))
  const archived = (c) => {
    const face = liveAt(c.file)
    return !!face && !(face.exempt_until && Date.parse(face.exempt_until) < Date.parse(nowIso))
  }
  const claim = all.filter((c) => !c.placeholder && !archived(c))
  const tpl = all.filter((c) => c.placeholder)
  const arch = all.filter((c) => !c.placeholder && archived(c))
  const broken = claim.filter((c) => (c.kind === 'npm' ? !aliasNames.has(c.target) : !fileExists(c.target)))

  push('D1', docs.length > 0 && aliases.length > 0, 'D1 取数面非空（文档面 + 别名面，零输入不得 PASS）',
    `durable 文档 ${docs.length} 份、scripts 别名 ${aliases.length} 条 ⇒ 命令提及 ${all.length} 条（claim ${claim.length} / template ${tpl.length} / archive ${arch.length}）；一条都没有 = 取数面坏了，不是"文档很干净"`)

  push('D2', broken.length === 0, 'D2 每条现行主张都成立（alias 在册 / 文件在盘）',
    broken.length ? `不成立 ${broken.length} 条：${broken.map((b) => `${b.file}:${b.line} -> ${b.kind === 'npm' ? 'npm run ' + b.target : b.target}`).join(' ｜ ')}`
      : `全部 ${claim.length} 条对得上真相源（别名面 ${aliasNames.size} 条 + 盘上文件面）`)

  // D3 是**反向腿**：真名必须逃得出占位形状。只断言"占位符数量"没有判定力——
  // 若形状式写宽了，它会一边吞真缺陷一边看起来在自检（A-get-memory ② 的取样面问题同族）。
  const realFiles = all.filter((c) => c.kind === 'file' && !c.placeholder && fileExists(c.target))
  const eaten = all.filter((c) => c.kind === 'file' && c.placeholder && fileExists(c.target))
  push('D3', eaten.length === 0 && realFiles.length > 0, 'D3 占位符这一类没有吞掉真命令（反向腿：真名必须逃得出形状）',
    (eaten.length ? `被占位形状误吞的真实脚本: ${eaten.map((e) => `${e.file}:${e.line} ${e.target}`).join(' / ')} ⇒ 这条豁免现在正在藏缺陷` : '')
    + (realFiles.length === 0 ? '盘上一个真实脚本名都没被文档提到 ⇒ 本腿无对象，判未成立不判通过' : '')
    + (!eaten.length && realFiles.length ? `已核 ${realFiles.length} 个"文档提到且盘上确实存在"的脚本名，逐个都不含占位形状（抽样：${realFiles.slice(0, 3).map((r) => r.target).join(' / ')}）；template 类 ${tpl.length} 条`
      : ''))

  const staleFaces = archiveFaces.filter((a) => a.exempt_until && Date.parse(a.exempt_until) < Date.parse(nowIso))
  push('D4', staleFaces.length === 0, 'D4 历史归档面必须带到期时刻且未过期（历史不是永久豁免）',
    staleFaces.length ? `已过期仍挂着: ${staleFaces.map((a) => `${a.path || a.prefix}@${a.exempt_until}`).join(' / ')} ⇒ 其中的死命令重新按 claim 判`
      : `在册归档面 ${archiveFaces.length} 条，逐条带 exempt_until 且未到期（面：${archiveFaces.map((a) => a.path || a.prefix).join(' / ') || '（无）'}）`)

  // D5 反向：门禁类 alias "在册却无人知晓"。提=别名原文或它指向的脚本名出现在任一 durable 文档里；
  // 没提的必须逐条进 `undocumented_gates` 并带可证伪理由（复用 lib/registry-reason 那一份实现）。
  const docText = docs.map((d) => d.src).join('\n')
  const mentioned = (a) => docText.includes(`npm run ${a.name}`)
    || [...a.cmd.matchAll(/scripts\/([A-Za-z0-9._-]+)/g)].some((m) => docText.includes(m[1]))
  const undocumented = aliases.filter((a) => /^(verify|check):/.test(a.name) && !mentioned(a))
  const unreg = (registry && registry.undocumented_gates) || []
  const unexplained = undocumented.filter((a) => !unreg.some((u) => u.alias === a.name
    && !reasonDefects(u.alias, u.reason).length))
  push('D5', unexplained.length === 0, 'D5 门禁类 alias 不得"在册却无人知晓"（反向对账，未提须逐条具名理由）',
    undocumented.length ? `门禁别名 ${aliases.filter((a) => /^(verify|check):/.test(a.name)).length} 条里 ${undocumented.length} 条任何 durable 文档都没提：`
      + `${undocumented.map((a) => a.name).join(', ')}；其中没有合格在册理由的 ${unexplained.length} 条`
      + (unexplained.length ? ` ⇒ ${unexplained.map((a) => a.name).join(', ')}` : '')
      : `门禁类 alias 全部在文档里出现过（"存在但没人知道"是 R41-H3 欠到现在的那半）`)

  // D6：门禁一览是**生成物**，所以它自己也要对账（"派生表 ⇄ 真相源"双向，别留第二份手抄名单）。
  const readme = docs.find((d) => d.path === 'README.md')
  const block = readme ? /<!-- gate-table:begin -->([\s\S]*?)<!-- gate-table:end -->/.exec(readme.src) : null
  const declaredInTable = block ? [...new Set([...block[1].matchAll(/npm run ([a-zA-Z0-9:._-]+)/g)].map((m) => m[1]))].sort() : []
  const gateAliasNames = aliases.filter((a) => /^(verify|check):/.test(a.name)).map((a) => a.name).sort()
  const missingInTable = gateAliasNames.filter((n) => !declaredInTable.includes(n))
  const ghostInTable = declaredInTable.filter((n) => !gateAliasNames.includes(n))
  push('D6', !!block && missingInTable.length === 0 && ghostInTable.length === 0,
    'D6 README「门禁一览」块 ⇄ package.json 双向对账（生成物不许漂，缺行/多行都点名）',
    !block ? `README 里没有 <!-- gate-table:begin -->…<!-- gate-table:end --> 块 ⇒ 跑 \`node ${SELF} --update\` 生成（不手抄）`
      : `表内 ${declaredInTable.length} 条 ⇄ 在册 ${gateAliasNames.length} 条`
      + (missingInTable.length ? `；缺行: ${missingInTable.join(', ')}` : '')
      + (ghostInTable.length ? `；幽灵行（表里有、package.json 已无）: ${ghostInTable.join(', ')}` : '')
      + (!missingInTable.length && !ghostInTable.length ? '（逐条相等）' : ''))

  return { rows, counts: { docs: docs.length, aliases: aliases.length, mentions: all.length, claim: claim.length, template: tpl.length, archive: arch.length, broken: broken.length } }
}

export function verdictOf(rows) {
  const failed = rows.filter((r) => r.ok === false)
  return { verdict: failed.length ? 'RED' : 'GREEN', rc: failed.length ? 1 : 0, failed: failed.map((r) => r.id) }
}

/** 生成 README 的「门禁一览」块：**内容全部来自 package.json**，一个字的散文都不写 ⇒ 不会漂。 */
export function renderGateTable(aliases) {
  const rows = aliases.filter((a) => /^(verify|check):/.test(a.name))
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((a) => {
      const files = [...a.cmd.matchAll(/scripts\/([A-Za-z0-9._-]+\.(?:mjs|py|js))/g)].map((m) => m[1])
      const chained = [...a.cmd.matchAll(/npm run ([a-zA-Z0-9:._-]+)/g)].map((m) => m[1])
      const what = files.length ? files.join(' + ') : chained.length ? `→ ${chained.join(', ')}` : '(内联命令)'
      return `| \`npm run ${a.name}\` | ${what} |`
    })
  return ['<!-- gate-table:begin -->',
    '## 门禁一览（生成物，勿手改）',
    '',
    '`node scripts/check-doc-commands.mjs --update` 从 package.json 现取，改别名即整块重生；',
    '漂没漂由该判据的 D6 双向对账（缺行/幽灵行都点名），不靠任何人记得来改表。',
    '',
    '| 命令 | 它跑的是 |', '| --- | --- |', ...rows, '<!-- gate-table:end -->', ''].join('\n')
}

export function syncGateTable(readmeSrc, table) {
  if (/<!-- gate-table:begin -->[\s\S]*?<!-- gate-table:end -->/.test(readmeSrc)) {
    return { src: readmeSrc.replace(/<!-- gate-table:begin -->[\s\S]*?<!-- gate-table:end -->\n?/, table + '\n'), action: 'replaced' }
  }
  const at = readmeSrc.indexOf('## 功能一览')
  if (at === -1) return { src: null, action: 'no-anchor' }
  return { src: readmeSrc.slice(0, at) + table + '\n\n' + readmeSrc.slice(at), action: 'inserted' }
}

function main() {
  const argv = process.argv.slice(2)
  const update = argv.includes('--update')
  const inj = argv.includes('--inject-red')
  const fxIdx = argv.indexOf('--fixture')
  const alIdx = argv.indexOf('--aliases')
  let docs, aliases, registry, fileExists
  if (fxIdx !== -1) {
    docs = JSON.parse(readFileSync(argv[fxIdx + 1], 'utf8'))
    aliases = alIdx !== -1 ? JSON.parse(readFileSync(argv[alIdx + 1], 'utf8')) : []
    registry = { archive_faces: [], observed_utc: new Date().toISOString() }
    fileExists = () => true
  } else {
    docs = collectDocs()
    aliases = readAliases()
    fileExists = (p) => existsSync(join(ROOT, p))
    const regPath = join(ROOT, REGISTRY)
    registry = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : { archive_faces: [] }
    if (update) {
      const { rows, counts } = evaluate({ docs, aliases, fileExists, registry })
      const body = {
        schema: 'chaoshi-doc-commands-v1',
        note: '由 `node scripts/check-doc-commands.mjs --update` 生成；archive_faces 是人填的"历史归档面"声明，--update 保留已填值。每条必须带 exempt_until（到期即重新按现行主张判，历史不是永久豁免）。D2 拿它与真实别名/文件面对账，改文档不改册不会红，改册不改文档会红。',
        observed_utc: new Date().toISOString(), counts,
        archive_faces: registry.archive_faces || [],
      }
      void rows
      writeFileSync(join(ROOT, REGISTRY), JSON.stringify(body, null, 2) + '\n', 'utf8')
      console.log(`[doc-commands] 已重写 ${REGISTRY}（提及 ${counts.mentions} 条 / 不成立 ${counts.broken} 条）`)
      const rp = join(ROOT, 'README.md')
      const before = readFileSync(rp, 'utf8')
      const { src, action } = syncGateTable(before, renderGateTable(aliases))
      if (!src) { console.error(`[doc-commands] BLOCKED README 里没有 "## 功能一览" 锚点 ⇒ 无处插生成块，拒绝硬塞`); process.exit(2) }
      writeFileSync(rp, src, 'utf8')
      console.log(`[doc-commands] README 门禁一览块 ${action}（${aliases.filter((a) => /^(verify|check):/.test(a.name)).length} 条，全部取自 package.json）`)
    }
  }
  const injected = inj ? [{ kind: 'npm', target: 'no-such-alias-injected', file: 'INJECTED.md', line: 1, placeholder: false }] : null
  const { rows, counts } = evaluate({ docs, aliases, fileExists, registry, injected })
  for (const r of rows) console.log(`${r.ok === true ? 'PASS' : 'FAIL'} ${r.id} ${r.label} (${r.detail})`)
  const v = verdictOf(rows)
  const matched = rows.filter((r) => r.ok === true).length
  console.log(`==== 提及 ${counts.mentions} 条｜claim ${counts.claim} / template ${counts.template} / archive ${counts.archive}｜不成立 ${counts.broken} ｜ verdict=${v.verdict} ====`)
  console.log(`${v.rc === 0 ? 'GATE-PASS' : 'GATE-FAIL'} doc-commands :: 检查 ${matched}/${rows.length} 通过，${v.failed.length} 失败${v.failed.length ? `（${v.failed.join(',')}）` : ''}`)
  process.exit(v.rc)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(join(ROOT, 'scripts', 'check-doc-commands.mjs'))) {
  try { main() } catch (e) { console.error(`[doc-commands] 未预期异常：${e && e.stack ? e.stack : e}`); process.exit(2) }
}
