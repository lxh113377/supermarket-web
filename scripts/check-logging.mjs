// 第五十九轮 H-59-1：结构化日志的出口闸（对账代码 ⇄ docs/logging.md，五腿）。
//
// 为什么要有这条闸（不是"多一个脚本"）：本轮把 functions/ 的 20 处裸 console 收进 logger.js，
// 如果只靠"我改完了"这句话，下一轮任何人在任何文件里再写一句 console.error(...) 就静默回到旧形态
// —— 与 errors.js 当初"55 个失败出口各自裸写信封"是同一件事的出生方式。
// 对标先例：rust-lang/rust 的 tidy 要求"例外必须点名"，medusa 的 logger 注入制（模块不直接触 console）。
//
// 真相源：functions/ 的代码本身（mod 名、console 位点、fields 写法一律现算，本脚本不写死计数）。
// 登记册：docs/logging.md（豁免表 / mod 表 / PII 补充册）+ docs/pii-inventory.md（列名口径复用其解析器，不另写一份）。
// 用法：node scripts/check-logging.mjs          真仓全量校验
//       node scripts/check-logging.mjs --emit   打印缺登记行的骨架（带 TODO，见 TODO 即红）
//       node scripts/check-logging.mjs --selftest  跑内置正反例（含 5 条反例，缺反例即本闸未成立）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { requireInputs } from './lib/preflight.mjs'
import { reasonDefects } from './lib/registry-reason.mjs'
import { parseInventory } from './check-pii-inventory.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const REG = 'docs/logging.md'
const PII_REG = 'docs/pii-inventory.md'
const LOGGER = 'functions/lib/logger.js'
const SELF = 'scripts/check-logging.mjs'
const BARE_RE = /\bconsole\s*\.\s*(?:error|warn|log|info|debug|trace)\s*\(/g
const CALLERS = ['logError', 'logWarn']

export function collectJs(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) collectJs(p, out)
    else if (e.endsWith('.js')) out.push(p)
  }
  return out
}

/** 逐行扫 `console.*` 位点；纯注释行（`//` 或 `*` 开头）不计，避免文档串写成判据。 */
export function findConsoleSites(rel, src) {
  const sites = []
  src.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    const hits = line.match(BARE_RE)
    if (hits) for (const h of hits) sites.push({ file: rel, line: i + 1, text: h })
  })
  return sites
}

/** 从 `idx`（指向调用名左括号后的第一个字符）起，按顶层逗号切出实参；括号/花括号/字符串内的逗号不算。 */
export function splitArgs(src, idx) {
  const args = []
  let depth = 0
  let cur = ''
  let quote = ''
  for (let i = idx; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      cur += c
      if (c === '\\') { cur += src[++i]; continue }
      if (c === quote) quote = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; continue }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) { if (cur.trim()) args.push(cur.trim()); return args }
      depth--
      cur += c
      continue
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  return args
}

/** 枚举 functions/ 里所有 log* 调用：返回 { file, line, mod, fields }。 */
export function findLogCalls(fileMap) {
  const calls = []
  for (const [rel, src] of fileMap) {
    if (rel === LOGGER) continue
    for (const name of CALLERS) {
      const re = new RegExp(`\\b${name}\\s*\\(`, 'g')
      let m
      while ((m = re.exec(src))) {
        const args = splitArgs(src, m.index + m[0].length)
        const modRaw = args[0] || ''
        const mod = /^'([^']*)'$/.exec(modRaw)
        calls.push({
          file: rel,
          line: src.slice(0, m.index).split('\n').length,
          mod: mod ? mod[1] : '',
          modDynamic: !mod,
          fields: args[2] || '',
        })
      }
    }
  }
  return calls
}

/** L3：字段里整包塞 payload/body/request 的三种写法（简写、恒等赋值、展开）。 */
export function payloadLeaks(fields) {
  const bad = []
  const names = ['payload', 'body', 'request']
  for (const n of names) {
    if (new RegExp(`[{,]\\s*${n}\\s*[,}]`).test(fields)) bad.push(`${n}(简写整包)`)
    if (new RegExp(`\\.\\.\\.\\s*${n}\\b`).test(fields)) bad.push(`${n}(展开整包)`)
    if (new RegExp(`\\b${n}\\s*:\\s*${n}\\b`).test(fields)) bad.push(`${n}(同名整包)`)
  }
  return bad
}

/** 取 markdown 里某个二级标题下的表格数据行（跳过表头与分隔行）。 */
export function tableRows(md, sectionRe) {
  const lines = md.split(/\r?\n/)
  const out = []
  let inSec = false
  for (const l of lines) {
    if (/^##\s/.test(l)) { inSec = sectionRe.test(l.trim().replace(/^##\s+/, '')); continue }
    if (!inSec || !l.trim().startsWith('|')) continue
    const c = l.split('|').slice(1, -1).map((s) => s.replace(/\*\*/g, '').trim())
    if (c.length < 2) continue
    if (/^[-\s|:]+$/.test(c.join('|')) || c[0] === '文件' || c[0] === 'mod' || c[0] === '键') continue
    out.push(c)
  }
  return out
}

/** PII_KEYS 的字面量集合（从 logger.js 现算，不在本脚本抄一份名单）。 */
export function parsePiiKeys(src) {
  const m = /export const PII_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src)
  if (!m) return null
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
}

export function evaluate({ fileMap, regMd, piiMd, loggerSrc }) {
  const out = []
  const check = (id, desc, ok, detail) => out.push({ id, desc, ok: !!ok, detail })

  // —— 在册侧分母先取：任何一张表解析成空，后面几条腿会"双向都空 ⇒ 全绿"，那叫失明不叫通过 ——
  const exempt = tableRows(regMd, /裸 console 豁免表/)
  const exemptFiles = new Set(exempt.map((r) => r[0]))
  const regMods = new Set(tableRows(regMd, /mod 登记册/).map((r) => r[0]))
  const suppRows = tableRows(regMd, /PII 补充册/)
  const supplement = new Set(suppRows.map((r) => r[0]))
  const piiCols = new Set(
    parseInventory(piiMd).rows
      .filter((r) => r.category === '个人数据' || r.category === '凭证')
      .map((r) => r.column))

  // —— 代码侧分母：先证"我看到了什么"，再判"它对不对" ——
  const consoleSites = []
  for (const [rel, src] of fileMap) consoleSites.push(...findConsoleSites(rel, src))
  const calls = findLogCalls(fileMap)
  const files = [...fileMap.keys()]

  // L4 分母非零（放在最前：分母为空时 L1 的"0 处违规"没有意义）
  const emptyFaces = [
    files.length ? null : 'functions/ 零文件',
    calls.length ? null : 'log 调用零处',
    regMods.size ? null : 'mod 登记册零行',
    piiCols.size ? null : '个人数据登记册零列',
  ].filter(Boolean)
  check('L4', '采集面与在册侧分母全部非零（任一面读空=失明，禁折算成全绿）',
    emptyFaces.length === 0,
    `functions/ ${files.length} 个 .js｜log 调用 ${calls.length}（mod 为动态实参 ${calls.filter((c) => c.modDynamic).length} 处，L2 看不见）｜裸 console 位点 ${consoleSites.length}｜mod 在册 ${regMods.size}｜在册敏感列 ${piiCols.size}｜不可用面：${emptyFaces.length ? emptyFaces.join('、') : '无'}`)

  // L1 裸 console ⇄ 豁免表（双向）
  const seenFiles = new Set(consoleSites.map((s) => s.file))
  const missingExempt = [...seenFiles].filter((f) => !exemptFiles.has(f))
  const deadExempt = [...exemptFiles].filter((f) => !seenFiles.has(f))
  const badReason = exempt.filter(([, why]) => reasonDefects('豁免', why).length)
  check('L1', 'functions/ 的每处裸 console 都被豁免表点名（双向：漏登=红，幽灵=也红）',
    missingExempt.length === 0 && deadExempt.length === 0 && badReason.length === 0,
    `位点 ${consoleSites.length} 处 / 涉及 ${seenFiles.size} 文件｜漏登 ${missingExempt.length ? missingExempt.join(',') : '无'}｜幽灵 ${deadExempt.length ? deadExempt.join(',') : '无'}｜理由不合规 ${badReason.length || '无'}`)

  // L2 mod 双向
  const codeMods = new Set(calls.filter((c) => c.mod).map((c) => c.mod))
  const modMissing = [...codeMods].filter((m) => !regMods.has(m))
  const modGhost = [...regMods].filter((m) => !codeMods.has(m))
  check('L2', '代码里的 mod 名 ⇄ 登记册集合相等（新 mod 必须登记；登记了没人用=幽灵）',
    modMissing.length === 0 && modGhost.length === 0,
    `代码 ${codeMods.size} 个｜在册 ${regMods.size} 个｜漏登 ${modMissing.length ? modMissing.join(',') : '无'}｜幽灵 ${modGhost.length ? modGhost.join(',') : '无'}`)

  // L3 整包载荷禁入 fields
  const leaks = []
  for (const c of calls) {
    const bad = payloadLeaks(c.fields)
    if (bad.length) leaks.push(`${c.file}:${c.line} ${bad.join('+')}`)
  }
  check('L3', '日志 fields 不得整包塞 payload/body/request（简写/同名/展开三形态）',
    leaks.length === 0,
    leaks.length ? leaks.join(' ｜ ') : `${calls.length} 处 log 调用的字段面逐条扫过，0 处整包`)

  // L5 PII_KEYS ⇄ 登记册 + 补充册（双向）
  const keys = parsePiiKeys(loggerSrc)
  const badSupp = suppRows.filter(([, why]) => reasonDefects('补充键', why).length)
  if (!keys) {
    check('L5', 'logger.js 的 PII_KEYS ⇄ 个人数据登记册 + 补充册（双向）', false,
      `未能在 ${LOGGER} 里解析出 PII_KEYS —— 解析失败不折算成"没有键"`)
  } else {
    const uncovered = [...piiCols].filter((c) => !keys.has(c))
    const ghost = [...keys].filter((k) => !piiCols.has(k) && !supplement.has(k))
    check('L5', 'logger.js 的 PII_KEYS ⇄ 个人数据登记册 + 补充册（双向）',
      uncovered.length === 0 && ghost.length === 0 && badSupp.length === 0 && keys.size > 0,
      `在册列名 ${piiCols.size}｜补充册 ${supplement.size}｜PII_KEYS ${keys.size}｜未洗 ${uncovered.length ? uncovered.join(',') : '无'}｜幽灵 ${ghost.length ? ghost.join(',') : '无'}｜补充理由不合规 ${badSupp.length || '无'}`)
  }

  return { out, meta: { files: files.length, consoleSites: consoleSites.length, calls: calls.length } }
}

/** 反例：每条都必须让对应腿判红。新尺没有反例 = 这条腿从没被证明会红（E3 纪律同源）。 */
export function mutations() {
  const reg = `# t
## 裸 console 豁免表

| 文件 | 理由 |
|---|---|
| functions/a.js | ${'真实理由：本文件按设计直连 console，实测 grep 命中 1 处，位点见 a.js:2（超过二十字的说明）'} |

## mod 登记册

| mod | 出处 | 记什么 |
|---|---|---|
| admin | functions/a.js | 说明 |

## PII 补充册

| 键 | 理由 |
|---|---|
| adminKey | ${'非入库键：`grep -c adminKey functions/web.js` 实测 1 处解构，落日志等于把后台口令写进日志面'} |
`
  const pii = `# t
## 覆盖表：orders

| 列 | 类别 | 可见性 | 出境 | 保留 | 删除 | 导出 | 依据 |
|---|---|---|---|---|---|---|---|
| roomNumber | 个人数据 | admin | 否 | 无 | 人工 | 是 | 住址 |
`
  const okLogger = "export const PII_KEYS = new Set(['roomNumber', 'adminKey'])\n"
  const okCode = "import { logError } from './logger.js'\nconsole.log('boot')\nlogError('admin', 'x', { err: e })\n"
  const run = (code, logger, md) => evaluate({
    fileMap: new Map([['functions/a.js', code], [LOGGER, logger]]),
    regMd: md, piiMd: pii, loggerSrc: logger,
  })

  return [
    ['正例：在册 mod + 在册豁免 + PII 全覆盖 ⇒ 五腿全绿', run(okCode, okLogger, reg), true],
    ['裸 console 未登记 ⇒ L1 红', run(okCode + "console.error('x')\n", okLogger, reg.replace('functions/a.js |', 'functions/ghost.js |')), false],
    ['mod 未登记 ⇒ L2 红', run("logError('brandNew', 'x', {})\n", okLogger, reg), false],
    ['整包 payload 入 fields ⇒ L3 红', run("logError('admin', 'x', { payload })\n", okLogger, reg), false],
    ['展开整包 request ⇒ L3 红', run("logError('admin', 'x', { ...request })\n", okLogger, reg), false],
    ['登记册新增个人数据列而 PII_KEYS 未跟 ⇒ L5 红',
      run(okCode, "export const PII_KEYS = new Set(['adminKey'])\n", reg), false],
    ['PII_KEYS 里塞幽灵键 ⇒ L5 红',
      run(okCode, "export const PII_KEYS = new Set(['roomNumber', 'adminKey', 'notARealColumn'])\n", reg), false],
    ['采集面读空（functions/ 零文件）⇒ L4 红',
      evaluate({ fileMap: new Map(), regMd: reg, piiMd: pii, loggerSrc: okLogger }), false],
  ]
}

function printResults(res) {
  let pass = 0
  for (const r of res.out) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.desc} (${r.detail})`)
    if (r.ok) pass++
  }
  const fail = res.out.length - pass
  console.log(`==== 结果: ${pass} 通过 / ${fail} 失败 ====`)
  return fail
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--selftest')) {
    let bad = 0
    for (const [name, res, expectGreen] of mutations()) {
      const failing = res.out.filter((r) => !r.ok).map((r) => r.id)
      const ok = expectGreen ? failing.length === 0 : failing.length > 0
      if (!ok) bad++
      console.log(`${ok ? 'PASS' : 'FAIL'}  mut :: ${name} :: ${expectGreen ? '应全绿' : '应有腿红'} → ${failing.length ? failing.join(',') : '全绿'}`)
    }
    const n = mutations().length
    console.log(`==== selftest: ${n - bad}/${n} 通过 ====`)
    console.log(bad ? '[GATE:logs-selftest-fail]' : '[GATE:logs-selftest-pass] 反例覆盖 L1,L2,L3,L4,L5')
    process.exit(bad ? 1 : 0)
  }

  requireInputs('LOG', [REG, PII_REG, LOGGER, SELF])
  const files = collectJs(join(root, 'functions'))
  const fileMap = new Map(files.map((p) => [relative(root, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]))
  const regMd = readFileSync(join(root, REG), 'utf8')
  const res = evaluate({
    fileMap,
    regMd,
    piiMd: readFileSync(join(root, PII_REG), 'utf8'),
    loggerSrc: readFileSync(join(root, LOGGER), 'utf8'),
  })

  if (argv.includes('--emit')) {
    const regMods = new Set(tableRows(regMd, /mod 登记册/).map((r) => r[0]))
    const missing = [...new Set(findLogCalls(fileMap).map((c) => c.mod).filter(Boolean))]
      .filter((m) => !regMods.has(m))
    console.log('// --emit：以下 mod 在代码里出现但未在册，粘进 docs/logging.md 后把 TODO 换成真话：')
    for (const m of missing) console.log(`| ${m} | TODO出处 | TODO记什么 |`)
    if (!missing.length) console.log('（无缺登记 mod）')
  }

  const fail = printResults(res)
  const line = `GATE-${fail ? 'FAIL' : 'PASS'} logging :: functions ${res.meta.files} 件｜裸 console ${res.meta.consoleSites} 处｜log 出口 ${res.meta.calls} 处｜检查 ${res.out.length - fail}/${res.out.length} 通过，${fail} 失败`
  console.log(line)
  process.exit(fail ? 1 : 0)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error('[check-logging] 崩溃:', e); process.exit(2) })
}
