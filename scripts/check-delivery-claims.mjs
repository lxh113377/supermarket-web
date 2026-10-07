#!/usr/bin/env node
/**
 * delivery-claims —— 报告里凡是说"已经交付/上线/推送了"，同一段必须带**可复算的远端回执**（第六十八轮 M-67-3）。
 *
 * 一手动因（不是猜，是上一轮自己撞的）：第六十六轮 §9 写着「待实测回填」，正文 §4 却把同一件事
 * 标成「本轮已做」——两处相隔 40 分钟，没有任何机制拦。本轮开工回填才发现：那一次远端 run
 * `37146129990` = `completed/failure`、`deploy` **skipped**、线上 `/_health` 的 `deploy` 仍是 `2e950ed`
 * ⇒ "已交付"是假的。第六十七轮靠**人**手写对了回执，但"靠人写对"不是判据。
 *
 * 第二条腿（D3）来自本轮抓到的一处更隐蔽的同类病：第 67 轮 §6 断言「UTF-16LE 日志 ⇒ **普通文本搜索**
 * 搜不到 `VERIFY_RC`」。本机三把尺实测：GNU `grep -c` **命中 1（rc=0）**、`rg -c` **0（rc=1）**、
 * PowerShell `Select-String` **0**。⇒ 那句绝对断言的取数面只有一把尺。规则因此是：
 * **凡"实测/搜不到/命中/找不到"这类测量句，必须点名是哪把尺**，否则换一个工具就是另一种"事实"。
 *
 * 三态（同 `check-memory-pointer-sync.mjs` 的口径，绝不把"看不见"记成"通过"）：
 *   PASS        取数面非空，且每条交付主张都带回执
 *   FAIL        有主张没回执（或有测量句不点名取数器）
 *   UNVERIFIED  `../deliverables/` 不在（CI 只检出代码仓）⇒ 这是"未观测"，**不是**"已核对"，rc=0
 *
 * 用法：node scripts/check-delivery-claims.mjs [--dir <路径>] [--limit=N] [--json] [--inject-red]
 *                                     [--advisory] [--update-baseline] [--baseline <路径>]
 * 退出码：0=PASS 或 UNVERIFIED（取数面不在）/ 1=判红 / 2=取数面或基线册指定了却取不到
 * 档位：**阻断（第七十一轮升）**。升档前置＝第七十轮 I-70-5 的「先量一轮误报率」，本轮实测口径：
 *   回执面 commit 候选 186、幽灵 21（其中 20 是前约定时代存量、1 是第七十轮自己的 `f5b22d2`）、
 *   未定位仅 4 ⇒ 假阳面极窄，故存量进 `docs/delivery-claims-baseline.json` 指纹册、
 *   判据只拦「新增」与「基线死行」两个方向（后者＝册上还挂着、当次读数里已取不到的豁免行，
 *   与「幽灵 sha」是两件事，故意不共用一个词）。**不接进 `.githooks/pre-commit`**：它的红可由外层
 *   散文文件造成，那会连坐一次与此无关的内层提交（同 `ci.yml` 对 cron-health 的处置）。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bail } from './lib/preflight.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SELF = 'scripts/check-delivery-claims.mjs'
export const DEFAULT_DIR = join(root, '..', 'deliverables')

/** 交付类主张的词面。注意**不**收「已做/已完成」——那是本轮工作项的状态词，不是对外交付声明。 */
export const CLAIM_RE = /已上线|已交付|已推送|已部署|已发布/
/**
 * 引用跨度：报告里**讨论这些词本身**（第 67 轮 §3 就写着「"已交付"的判定从来没有被机器管住」）
 * 不是交付主张。不加这一层，一条讲"回执判据该怎么立"的段落会被自己的词面判红 ——
 * 门禁拒真话却放行自相矛盾的写法，那就是判据缺陷，不是内容缺陷。
 * 成对跨度用「」『』“”（）与反引号；ASCII 双引号按开合切换配对（Markdown 里 `"已推送"当"已上线"` 就是这种）。
 */
const QUOTE_PAIRS = [['「', '」'], ['『', '』'], ['“', '”'], ['‘', '’']]
export function quotedSpans(text) {
  const spans = []
  for (const [o, c] of QUOTE_PAIRS) {
    let from = -1
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === o) from = from < 0 ? i : from
      else if (text[i] === c && from >= 0) { spans.push([from, i]); from = -1 }
    }
  }
  // 反引号跨度（代码体里的词面一律算引用）
  for (const m of text.matchAll(/`[^`\n]+`/g)) spans.push([m.index, m.index + m[0].length - 1])
  // ASCII 双引号：开合切换
  let open = -1
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"') continue
    if (open < 0) open = i
    else { spans.push([open, i]); open = -1 }
  }
  return spans
}
export function insideAnySpan(spans, idx) {
  return spans.some(([a, b]) => idx > a && idx <= b)
}
/** 取一段文本里**真正被主张**的交付词（排除引用式提及）。 */
export function claimHits(text) {
  const spans = quotedSpans(text)
  const hits = []
  for (const m of text.matchAll(new RegExp(CLAIM_RE.source, 'g'))) {
    if (!insideAnySpan(spans, m.index)) hits.push(m[0])
  }
  return hits
}
/** 测量类断言：动词表（搜/检索/命中/匹配/找不到）∩ 断言表（实测/测得/读数/普通文本/任何）。 */
export const MEASURE_VERB_RE = /搜|检索|命中|匹配|找不到|搜不到|无输出|零输出/
export const MEASURE_CLAIM_RE = /实测|测得|读数|普通文本|任何工具|搜不到|找不到/
/** 必须点名取数器，否则同一句话换个工具就会变成相反的"事实"。 */
export const TOOL_RE = /\b(?:grep|rg|ripgrep|Select-String|findstr|PowerShell|pwsh|curl|gh\b|node\b|wc\b|git\b|Read\b|Grep\b)\b/

/** `.ci/contract.json` 的 requiredJobs 是唯一权威 —— 这里**导入**而不是重抄一份，
 *  否则改契约的人只需改一处，而本判据会在没人注意的地方悄悄换标准（derive-not-duplicate）。 */
export function requiredJobsOf(contractPath) {
  if (!existsSync(contractPath)) return { jobs: [], error: `读不到 ${contractPath}` }
  try {
    const j = JSON.parse(readFileSync(contractPath, 'utf8'))
    const jobs = Array.isArray(j.requiredJobs) ? j.requiredJobs.filter((x) => typeof x === 'string') : []
    if (!jobs.length) return { jobs: [], error: 'contract.requiredJobs 为空或不是字符串数组' }
    return { jobs, error: null }
  } catch (e) {
    return { jobs: [], error: `contract.json 解析失败：${String(e.message || e).split('\n')[0]}` }
  }
}

/** 按 markdown 标题切段：一段 = 一个标题到下一个标题之前。"同段"是本判据的粒度。 */
export function sectionsOf(md) {
  const out = []
  let cur = { heading: '(文件头)', lines: [] }
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{1,6} (.*)$/.exec(line)
    if (h) { if (cur.lines.some((l) => l.trim())) out.push(cur); cur = { heading: h[1], lines: [line] } }
    else cur.lines.push(line)
  }
  if (cur.lines.some((l) => l.trim())) out.push(cur)
  return out
}

/** 回执三件套：run 号 + 结论 + （必需 job 全点名 或 线上 deploy 锚）。 */
export function receiptsOf(text, requiredJobs) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hasRun = /\brun\D{0,12}\d{8,}/i.test(text)
  const hasConclusion = /completed\s*\/\s*(?:success|failure|cancelled)|conclusion[^\n]{0,12}(?:success|failure)/i.test(text)
  const named = requiredJobs.filter((j) => new RegExp(`\\b${esc(j)}\\b`).test(text))
  const deployAnchor = /["']?deploy["']?\s*[:=]\s*["']?[0-9a-f]{7,40}/i.test(text)
  return {
    hasRun, hasConclusion,
    missingJobs: requiredJobs.filter((j) => !named.includes(j)),
    deployAnchor,
    ok: hasRun && hasConclusion && (named.length === requiredJobs.length || deployAnchor),
  }
}

/**
 * ── D5「幽灵 SHA」：回执里点名的那个提交，必须真在链上（第七十一轮）。
 *
 * 一手动因：第七十轮 §7 写「内层提交：`f5b22d2`」，而 `git merge-base --is-ancestor f5b22d2 HEAD`
 * 实测 rc=1 —— 它被同轮的 `git commit --amend` 顶掉了（reflog：`f5b22d2` → `96679fb`）。
 * ⇒ D1~D4 全过：那句话确实带了 run 号、结论、必需 job 全名和线上 deploy 锚。**回执的每一半都是真的，
 * 只有"本轮交付物本体"这一半是幻影**，而它恰恰是下一轮唯一能复算的锚。
 * 一个引用了幽灵 sha 的回执，比一份空白的回执更坏：空白的会被下一轮追着填，幻影的会被当真读。
 *
 * 三条口径（都是量出来的，不是拍的）：
 * ① **结构性分类，不写豁免名单**：回执面反引号 token 实测 run-id 64／commit 186／点号形 7。
 *    纯十进制一律判 run-id（`37503202951` 是合法十六进制串，按字面判会把 run 号当 commit），
 *    带 `.` 的判 Pages 部署 id 或 `a..b` 区间。被排除的三类**计数照印**。
 * ② **只有"对象存在但不在链上"才判红**：两根（内层/外层）都取不到该对象 ⇒ `未定位`，只计数不判红。
 *    报告里引用对手仓/焚诀仓的 sha 属正常，判它红就是在逼作者别写引用。
 * ③ **更正必须写得出来**：一行若同时(a)带 幽灵/作废/顶掉/不在链上/orphan 标注 且(b)同一行另有
 *    一个**可达**的 commit token，则该幽灵算「已就地更正」，不判红、单独计数。
 *    反例腿钉住：光有标注而没有真锚 ⇒ 照判红（否则"补个词"就能绕过，等于把闸拆了）。
 *    这条的存在理由与本判据 D-提及腿同族：**门禁拒真话却放行自相矛盾的写法，那就是判据缺陷**。
 *
 * @param token 反引号里的原文
 * @returns {'run-id'|'dotted'|'other-set'|'commit'}
 */
export const SHA_TOKEN_RE = /`([0-9a-fA-F][0-9a-fA-F._-]{6,60})`/g
export const RECEIPT_HEAD_RE = /^#{1,6} .*(回执|交付)/
export const RECEIPT_LINE_RE = /(?:内层|外层|本轮)\s*(?:提交|HEAD|head|锚|回执)|(?:提交|HEAD|head)\s*[:：]/
export const GHOST_ANNOTATION_RE = /幽灵|作废|顶掉|不在链上|孤儿|orphan|dangling/i
export function classifyShaToken (token) {
  if (/^\d+$/.test(token)) return 'run-id'
  if (token.includes('.')) return 'dotted'
  if (!/^[0-9a-f]+$/i.test(token)) return 'other-set'
  return 'commit'
}
/** 归一化整行：trim + 内部空白折叠。fp 只锚这个，不锚行号（行号锚法会让没改东西的人也变不了绿）。 */
export function normalizeLine (line) {
  return String(line || '').trim().replace(/\s+/g, ' ').slice(0, 240)
}
export function fpOf ({ kind, file, heading, needle }) {
  let h = 0
  const key = `${kind}\u0001${file}\u0001${heading}\u0001${needle}`
  // FNV-1a 32bit ×2 拼 16 hex：判据不能依赖 node:crypto 的具体版本形态，且这个值只要稳定可比。
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  let g = 0x811c9dc5
  for (let i = key.length - 1; i >= 0; i -= 1) { g ^= key.charCodeAt(i); g = Math.imul(g, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + g.toString(16).padStart(8, '0')
}

/**
 * 扫回执面取 sha 主张。`resolveFn(sha) => 'reachable'|'ghost'|'unknown'` 由调用方注入：
 * 生产传双根 git 探针，夹具传表 —— 测试因此不 shell、不联网（沿用 `check-escape-hatch-log.mjs` 的纪律）。
 * 不注入 ⇒ D5 整条不参与判定，并在返回值里明写 `ran:false`（**绝不把"没跑"记成"没幽灵"**）。
 */
export function shaFindings (sections, resolveFn) {
  const out = { ran: !!resolveFn, ghosts: [], annotated: [], unknown: [], census: { 'run-id': 0, dotted: 0, 'other-set': 0, commit: 0 } }
  if (!resolveFn) return out
  const memo = new Map()
  const resolve = (s) => { if (!memo.has(s)) memo.set(s, resolveFn(s)); return memo.get(s) }
  for (const sec of sections) {
    let inReceipt = false
    const seen = new Set()
    for (const line of sec.lines) {
      if (/^#{1,6} /.test(line)) inReceipt = RECEIPT_HEAD_RE.test(line)
      if (!(inReceipt || RECEIPT_LINE_RE.test(line))) continue
      const shasOnLine = []
      for (const m of line.matchAll(SHA_TOKEN_RE)) {
        const kind = classifyShaToken(m[1])
        out.census[kind] += 1
        if (kind !== 'commit') continue
        shasOnLine.push(m[1])
      }
      for (const sha of shasOnLine) {
        const dk = `${sec.heading}@@${sha}`
        if (seen.has(dk)) continue
        seen.add(dk)
        const st = resolve(sha)
        if (st === 'reachable') continue
        if (st === 'ghost') {
          const hasRealAnchor = shasOnLine.some((o) => o !== sha && resolve(o) === 'reachable')
          const row = { file: sec.file, heading: sec.heading, sha, line: normalizeLine(line) }
          if (GHOST_ANNOTATION_RE.test(line) && hasRealAnchor) out.annotated.push(row)
          else out.ghosts.push(row)
        } else out.unknown.push({ file: sec.file, heading: sec.heading, sha, line: normalizeLine(line) })
      }
    }
  }
  return out
}

/**
 * 纯判据。files = [{ name, text }]，requiredJobs = 字符串数组。
 * 返回 { state, matched, mismatched, badClaims[], badMeasures[], ghosts[], faceSize }。
 * matched = 带齐回执的交付主张条数；mismatched = 缺回执的条数。**两个数都要印**——
 * 只印"问题清单"会让人分不清"没问题"与"没看到问题"（本仓 R-CURRENT 第 9 条同族）。
 *
 * `baseline` = 存量在册指纹数组（[{fp}]）。三类不合格一律先与基线做**双向差集**：
 * 不在基线上的 = 新增（判红），基线上已不存在的 = 幽灵豁免（也判红，死豁免不许留在册上）。
 */
export function judgeDeliveries({ files, requiredJobs, limit = 6, resolveFn = null, baseline = null }) {
  const badClaims = []
  const badMeasures = []
  let matched = 0
  let mismatched = 0
  if (!Array.isArray(files)) return { state: 'FAIL', matched, mismatched, badClaims: [{ file: '(取数面)', why: 'files 不是数组' }], badMeasures, faceSize: 0 }
  // 零输入的检查放在**纯函数**里，不放 CLI 外面：只把洞堵在 main() 上，
  // 下一个调用方（CI 门面、别的脚本、测试）import 到的是那条会报 PASS 的空尺。
  if (!files.length) return { state: 'FAIL', matched, mismatched, badClaims: [{ file: '(取数面)', why: '取数面 0 份文件 ⇒ 零输入不折算通过' }], badMeasures, faceSize: 0 }
  if (!requiredJobs.length) return { state: 'FAIL', matched, mismatched, badClaims: [{ file: '(取数面)', why: 'requiredJobs 取不到 ⇒ 回执的"必需 job"那一半无从判，不允许按"不需要"放过' }], badMeasures, faceSize: files.length }

  for (const f of files) {
    const secs = sectionsOf(f.text).map((s) => ({ ...s, file: f.name }))
    for (const s of secs) {
      const body = s.lines.join('\n')
      const hits = claimHits(body)
      if (hits.length) {
        const r = receiptsOf(body, requiredJobs)
        if (r.ok) matched += 1
        else {
          mismatched += 1
          const miss = []
          if (!r.hasRun) miss.push('缺 run 号')
          if (!r.hasConclusion) miss.push('缺 status/conclusion（completed/success 之类）')
          if (!r.deployAnchor && r.missingJobs.length) miss.push(`必需 job 未全点名（缺 ${r.missingJobs.join('、')}），且没有线上 "deploy":"<sha>" 锚`)
          const firstClaimLine = s.lines.find((l) => claimHits(l).length) || ''
          badClaims.push({ file: f.name, heading: s.heading, claim: [...new Set(hits)].join('/'), why: miss.join('；'), line: normalizeLine(firstClaimLine) })
        }
      }
      for (const line of s.lines) {
        if (MEASURE_VERB_RE.test(line) && MEASURE_CLAIM_RE.test(line) && !TOOL_RE.test(line)) {
          badMeasures.push({ file: f.name, heading: s.heading, line: line.trim().slice(0, 150) })
        }
      }
    }
  }

  const d5 = shaFindings(files.flatMap((f) => sectionsOf(f.text).map((s) => ({ ...s, file: f.name }))), resolveFn)
  for (const g of d5.ghosts) {
    badClaims.push({ file: g.file, heading: g.heading, claim: `幽灵 sha \`${g.sha}\``, why: '该对象在两个 git 根里都取得到，但都不在当前 HEAD 的祖先链上 ⇒ 它已被 amend/rebase 顶掉，回执指向的交付物不存在', line: g.line, ghost: true })
  }

  const fpRows = (kind) => {
    const src = kind === 'ghost' ? d5.ghosts : kind === 'measure' ? badMeasures : badClaims.filter((b) => !b.ghost)
    return src.map((b) => ({
      ...b, kind,
      fp: fpOf({ kind, file: b.file, heading: b.heading, needle: kind === 'ghost' ? `${b.line}@@${b.sha}` : b.line }),
    }))
  }
  const findings = [...fpRows('claim'), ...fpRows('ghost'), ...fpRows('measure')]
  const baseFps = baseline && Array.isArray(baseline.rows) ? new Set(baseline.rows.map((r) => r.fp)) : null
  let fresh = findings
  let stale = []
  if (baseFps) {
    fresh = findings.filter((b) => !baseFps.has(b.fp))
    const liveFps = new Set(findings.map((b) => b.fp))
    stale = baseline.rows.filter((r) => !liveFps.has(r.fp))
  }
  const state = fresh.length || stale.length ? 'FAIL' : 'PASS'
  return {
    state, matched, mismatched,
    badClaims: findings.filter((b) => b.kind === 'claim'),
    badMeasures: findings.filter((b) => b.kind === 'measure'),
    ghosts: findings.filter((b) => b.kind === 'ghost'),
    d5, fresh, stale, baselineRows: baseline && Array.isArray(baseline.rows) ? baseline.rows.length : null,
    faceSize: files.length, limit,
  }
}

/**
 * D5 的反向腿：幽灵必须判红，就地更正过的必须不判红，而"只有标注没有真锚"必须仍判红。
 * 三条打在一起才叫有牙齿 —— 只测拒绝侧会把真话永久拦死，只测接受侧等于没闸。
 */
export function selfCheckGhost () {
  const table = { f5b22d2: 'ghost', '96679fb': 'reachable', deadbeef: 'unknown' }
  const fn = (s) => table[s] || 'unknown'
  const cases = [
    { name: 'ghost.md', text: '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`（工作树干净）\n' },
    { name: 'fixed.md', text: '## 7. 交付回执\n\n- **内层提交**：~~`f5b22d2`~~ 系被 `--amend` 顶掉的幽灵 sha，真身在链上的是 `96679fb`\n' },
    { name: 'naked-annotation.md', text: '## 7. 交付回执\n\n- **内层提交**：`f5b22d2`（幽灵）\n' },
    { name: 'unknown.md', text: '## 7. 交付回执\n\n- 对手仓锚点：`deadbeef`（medusa）\n' },
  ]
  const secs = []
  for (const c of cases) for (const s of sectionsOf(c.text)) secs.push({ ...s, file: c.name })
  const r = shaFindings(secs, fn)
  return {
    rejectsGhost: r.ghosts.some((g) => g.sha === 'f5b22d2' && g.file === 'ghost.md'),
    admitsCorrection: r.annotated.length === 1 && r.annotated[0].file === 'fixed.md',
    rejectsNakedAnnotation: r.ghosts.some((g) => g.file === 'naked-annotation.md'),
    ignoresUnknown: r.unknown.length === 1 && r.unknown[0].sha === 'deadbeef' && r.ghosts.every((g) => g.sha !== 'deadbeef'),
  }
}

/**
 * D4：反向腿 —— 三件套齐全的主张**不得**被判红。
 * 只测拒绝侧的判据会把真话永久拦死，逼人改用绕法；这条每次运行都自证一次（零外部依赖）。
 */
export function selfCheckAdmission() {
  const jobs = ['gates', 'deploy']
  const good = [{
    name: 'good.md',
    text: '## 9. 远端回执\n\n| 事 | 回执 |\n|---|---|\n| 本轮 H-1 **已上线** | run `37228542182` `completed/success`；`gates` success、`deploy` success；`/_health` 返回 {"deploy":"ecdc92d"} |\n',
  }]
  const bad = [
    { name: 'bad.md', text: '## 4. 改进建议\n\n| # | 状态 |\n|---|---|\n| H-1 | **本轮已上线** |\n' },
  ]
  // 第三个方向：**引用式提及不是主张**。第 67 轮 §3 原句是「"已交付"的判定从来没有被机器管住」——
  // 它在讨论这个词，没有宣称任何事。尺若把讨论判成谎报，下一轮就没人敢写这句话了（逼出绕法）。
  const mention = [{
    name: 'mention.md',
    text: '## 3. 逐项差距\n\n- 「已交付」的判定从来没有被机器管住；把"已推送"当"已上线"是上一轮的病。\n',
  }]
  const pass = judgeDeliveries({ files: good, requiredJobs: jobs })
  const fail = judgeDeliveries({ files: bad, requiredJobs: jobs })
  const mentionOnly = judgeDeliveries({ files: mention, requiredJobs: jobs })
  // 正例必须**真的被判成正例**：admitsHonest 不只看 state，还要看它确实数到了一条带回执的主张，
  // 否则"夹具里根本没有主张"也会让这条腿假绿（夹具不成立 ≠ 判据通过）。
  return {
    admitsHonest: pass.state === 'PASS' && pass.matched === 1 && pass.badClaims.length === 0,
    rejectsEmpty: fail.state === 'FAIL' && fail.mismatched === 1 && fail.badClaims.length === 1,
    admitsMention: mentionOnly.state === 'PASS' && mentionOnly.matched === 0 && mentionOnly.mismatched === 0,
  }
}

function listMd(dir) {
  const out = []
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, `${rel}${e.name}/`)
      else if (e.name.endsWith('.md')) out.push({ name: `${rel}${e.name}`, text: readFileSync(full, 'utf8') })
    }
  }
  walk(dir, '')
  return out
}

/** 生产侧 sha 探针：两个 git 根都试。判不到 = `unknown`，**不是** `ghost`（少一次 spawn 都不许升级为红）。 */
export function makeGitShaResolver (roots, { spawn = spawnSync } = {}) {
  const live = roots.filter((r) => r && existsSync(r))
  if (!live.length) return null
  return (sha) => {
    let sawObject = false
    for (const r of live) {
      const anc = spawn('git', ['-C', r, 'merge-base', '--is-ancestor', `${sha}^{commit}`, 'HEAD'], { stdio: 'pipe', timeout: 15_000 })
      if (anc && anc.status === 0) return 'reachable'
      const obj = spawn('git', ['-C', r, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe', timeout: 15_000 })
      if (obj && obj.status === 0) sawObject = true
    }
    return sawObject ? 'ghost' : 'unknown'
  }
}

export const BASELINE_PATH = join(root, 'docs', 'delivery-claims-baseline.json')
export function loadBaseline (p) {
  if (!existsSync(p)) return { baseline: null, error: `基线册不存在：${p}` }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    if (!j || !Array.isArray(j.rows)) return { baseline: null, error: `基线册没有 rows 数组：${p}` }
    const bad = j.rows.filter((r) => !r || typeof r.fp !== 'string' || !r.fp)
    if (bad.length) return { baseline: null, error: `基线册有 ${bad.length} 行缺 fp ⇒ 拒绝按"没有存量"跑` }
    return { baseline: j, error: null }
  } catch (e) {
    return { baseline: null, error: `基线册解析失败：${String(e.message || e).split('\n')[0]}` }
  }
}

function main() {
  const argv = process.argv.slice(2)
  // 两种形态都要认：`--limit 8` 和 `--limit=8`。只认空格式时，`--limit=8` 会被**静默忽略**
  // 并回落到默认值 —— 使用者看到的是"我设了 8，它只印 6 行"，而判据一声不吭（同"注释冒充配置"一族）。
  const argOf = (k) => {
    const eq = argv.find((a) => a.startsWith(`${k}=`))
    if (eq) return eq.slice(k.length + 1)
    const i = argv.indexOf(k)
    return i >= 0 ? argv[i + 1] : null
  }
  const dir = argOf('--dir') || DEFAULT_DIR
  const limitRaw = argOf('--limit')
  const limit = limitRaw === null ? 6 : Number(limitRaw)
  const inject = argv.includes('--inject-red')
  const asJson = argv.includes('--json')
  const advisory = argv.includes('--advisory')
  const updateBaseline = argv.includes('--update-baseline')
  const baselinePath = argOf('--baseline') || BASELINE_PATH
  const isDefaultDir = !argOf('--dir')
  if (limitRaw !== null && !(Number.isFinite(limit) && limit > 0)) {
    bail('delivery-claims', `--limit=${limitRaw} 解不出正整数 ⇒ 不按默认值悄悄跑`)
  }

  const cj = requiredJobsOf(join(root, '.ci', 'contract.json'))
  if (cj.error) { console.error(`[delivery-claims] BLOCKED 取不到 requiredJobs：${cj.error} ⇒ 没有标准就不许判"通过"`); process.exit(2) }

  if (!existsSync(dir)) {
    // 指定了却不存在 = 用法错（rc=2）；默认面不存在 = CI 只检出代码仓（UNVERIFIED，rc=0，但必须说人话）
    if (isDefaultDir) {
      console.log(`[delivery-claims] UNVERIFIED 取数面 ${dir} 不在（CI 只检出代码仓 ⇒ 这是"未观测"，不是"已核对"）`)
      process.exit(0)
    }
    bail('delivery-claims', `--dir 指向不存在的路径 ${resolve(dir)}`)
  }
  let files = listMd(dir)
  if (!files.length) {
    console.error(`[delivery-claims] FAIL 取数面 ${dir} 存在但 0 份 .md ⇒ 零输入不折算通过（本判据的 D1 腿）`)
    process.exit(1)
  }
  if (inject) {
    files = files.concat([
      {
        name: '(注入演习) synthetic.md',
        text: '## 99. 远端回执（INJECTED）\n\n本轮 H-99 **已上线**，无任何 run 号与结论。\n',
      },
      // 第二处注入用的是**真的孤儿** f5b22d2：它此刻就不在链上，演习不需要造假对象。
      {
        name: '(注入演习) ghost.md',
        text: '## 99. 远端回执（INJECTED）\n\n- **内层提交**：`f5b22d2`（工作树干净）\n',
      },
    ])
  }

  // 两个 git 根默认 = 代码仓 + 其同级工作区仓。`DELIVERY_CLAIMS_ROOTS` 是**测试注入口**：
  // CI 的 `actions/checkout` 缺省 depth=1，本机才有的孤儿对象在那儿根本不存在（第七十一轮 CI 一手：
  // `f5b22d2` 在 CI 上判 unknown 而非 ghost，于是"幽灵必须判红"那条 CLI 腿在 CI 上静默空过）。
  // 夹具自带一棵真 git 仓，两条通道才真的同形。
  const rootsEnv = String(process.env.DELIVERY_CLAIMS_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const roots = rootsEnv.length ? rootsEnv : [root, join(root, '..')]
  const resolveFn = makeGitShaResolver(roots)
  // 存量册是**版面**的：它按默认取数面（../deliverables）建行。夹具面（--dir 指到别处）拿来对账，
  // 会把册上 51 行全部读成"死行"⇒ 每个夹具测试当场误判。所以非默认面默认不装载，并在门面行说清为什么。
  const baselineExplicit = argOf('--baseline') !== null
  const loadBase = resolveFn && (baselineExplicit || isDefaultDir)
  let baseline = null
  if (loadBase) {
    const lb = loadBaseline(baselinePath)
    if (lb.error && !updateBaseline) {
      console.error(`[delivery-claims] BLOCKED ${lb.error} ⇒ 存量与新增无从区分，不允许按"没有存量"跑过去（--update-baseline 可重建）`)
      process.exit(2)
    }
    baseline = lb.baseline
  }

  const r = judgeDeliveries({ files, requiredJobs: cj.jobs, limit, resolveFn, baseline })
  const self = selfCheckAdmission()
  const ghost = selfCheckGhost()
  // D4 自证失败 ⇒ 本判据自己不可信，直接判红：不允许"尺没牙但报绿"。
  const selfOk = self.admitsHonest && self.rejectsEmpty && self.admitsMention
  const ghostOk = ghost.rejectsGhost && ghost.admitsCorrection && ghost.rejectsNakedAnnotation && ghost.ignoresUnknown

  if (updateBaseline) {
    const rows = [...r.badClaims, ...r.ghosts, ...r.badMeasures].map((b) => ({
      fp: b.fp, kind: b.kind, file: b.file, heading: b.heading,
      needle: b.kind === 'ghost' ? `${b.line}@@${b.sha}` : b.line,
    }))
    const payload = {
      schema: 'chaoshi-delivery-claims-baseline-v1',
      note: '`node scripts/check-delivery-claims.mjs --update-baseline` 生成；判据拿它与当次读数做**双向差集**：不在册=新增判红，在册而当次取不到=幽灵豁免判红。手改即红。存量修法＝改报告正文再重跑本命令，禁直接往 rows 里加行消音。',
      generatedUtc: new Date().toISOString(),
      rows,
    }
    writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    console.log(`[delivery-claims] 基线册已写入 ${baselinePath}｜主张 ${r.badClaims.length}｜幽灵 sha ${r.ghosts.length}｜测量句 ${r.badMeasures.length}｜合计 ${rows.length}`)
    process.exit(0)
  }

  if (asJson) {
    console.log(JSON.stringify({
      state: r.state, faceSize: r.faceSize, matched: r.matched, mismatched: r.mismatched,
      badClaims: r.badClaims, badMeasures: r.badMeasures, ghosts: r.ghosts,
      d5: { ran: r.d5.ran, census: r.d5.census, annotated: r.d5.annotated.length, unknown: r.d5.unknown.length },
      fresh: r.fresh.length, stale: r.stale.length, baselineRows: r.baselineRows,
      selfCheck: self, ghostCheck: ghost, injected: inject, tier: advisory ? 'advisory' : 'blocking',
    }, null, 2))
  } else {
    console.log(`[delivery-claims] 取数面 ${dir}｜md ${r.faceSize} 份｜requiredJobs ${cj.jobs.join(',')}（来源 .ci/contract.json）`)
    const d5face = !r.d5.ran
      ? 'D5 sha 面未参与本轮判定（两根 git 都取不到 ⇒ 这是"没跑"，不是"没幽灵"）'
      : `D5 sha 引用候选 ${Object.values(r.d5.census).reduce((a, b) => a + b, 0)}（commit ${r.d5.census.commit}／run-id ${r.d5.census['run-id']}／点号形 ${r.d5.census.dotted}／非十六进制 ${r.d5.census['other-set']}，后三类结构性不判）｜未定位 ${r.d5.unknown.length}｜已就地更正 ${r.d5.annotated.length}`
    console.log(`[delivery-claims] 交付主张 matched=${r.matched} mismatched=${r.mismatched}`
      + `｜测量句缺尺 ${r.badMeasures.length} 条｜幽灵 sha ${r.ghosts.length} 条`
      + `｜${d5face}`
      + (r.baselineRows === null
        ? `｜基线未装载${resolveFn ? '（取数面不是默认版面 ⇒ 拿默认面存量册对账会把整册读成死行，故不载）' : '（两个 git 根都取不到 ⇒ D5 未参与）'}`
        : `｜双向差集 新增 ${r.fresh.length}｜基线死行 ${r.stale.length}｜存量在册 ${r.baselineRows}`)
      + `｜D4 自证 admitsHonest=${self.admitsHonest} rejectsEmpty=${self.rejectsEmpty} admitsMention=${self.admitsMention}`
      + `｜D5 自证 判红=${ghost.rejectsGhost} 认更正=${ghost.admitsCorrection} 拒裸标注=${ghost.rejectsNakedAnnotation} 容未知=${ghost.ignoresUnknown}`
      + `｜档位=${advisory ? '报告型(不拦)' : '阻断'}${inject ? '｜--inject-red 已注入两处假' : ''}`)
    // 明细只列 **新增**（r.fresh）与**基线死行**（r.stale）：存量在册的 51 条已在门面行给出计数，
    // 把它们一起刷出来会把本轮真正要看的那一条顶出 limit 窗口 —— 第七十一轮一手：注入演习的
    // 两条假在 --limit=6 下**一行都没印出来**，只有门面行说"新增 2"，等于红了但没法归因。
    for (const b of r.stale.slice(0, limit)) console.error(`  ✗ 基线死行：${b.kind} ${b.file || ''} §${b.heading || ''}（needle=${String(b.needle || '').slice(0, 60)}）⇒ 当次读数里已取不到这个 fp，该处已修好；把册里这行摘掉（跑 --update-baseline），留着＝基线成第二真相源`)
    for (const b of r.fresh.slice(0, limit)) {
      if (b.kind === 'ghost') console.error(`  ✗ ${b.file} §${b.heading}：回执点名幽灵 sha \`${b.sha}\` —— 该对象在两个 git 根里都取得到，但都不在当前 HEAD 的祖先链上 ⇒ 回执指向的交付物不存在（多为 --amend/rebase 顶掉）`)
      else if (b.kind === 'measure') console.error(`  ✗ ${b.file} §${b.heading}：测量句未点名取数器 → ${b.line}`)
      else console.error(`  ✗ ${b.file} §${b.heading}：主张「${b.claim}」但${b.why}`)
    }
    if (r.fresh.length > limit || r.stale.length > limit) {
      console.error(`  …（新增共 ${r.fresh.length} 条、基线死行共 ${r.stale.length} 条，各限 ${limit} 行；存量在册 ${r.baselineRows} 条不刷明细，看上面的 matched/mismatched/幽灵 sha 三个数）`)
    }
  }
  if (!selfOk) { console.error('[delivery-claims] GATE-FAIL D4 反向腿不成立 ⇒ 这条尺本身不可信，先修尺再谈判别人'); process.exit(1) }
  if (!ghostOk) { console.error(`[delivery-claims] GATE-FAIL D5 反向腿不成立（判红=${ghost.rejectsGhost} 认更正=${ghost.admitsCorrection} 拒裸标注=${ghost.rejectsNakedAnnotation} 容未知=${ghost.ignoresUnknown}）⇒ 幽灵尺本身有洞`); process.exit(1) }
  if (r.state === 'FAIL') {
    const advice = r.stale.length
      ? '先跑 `node scripts/check-delivery-claims.mjs --update-baseline` 把已修好的存量摘掉（摘册是正当动作，留着才是欠账）'
      : '改报告正文补真回执或补取数器点名，**禁止往基线册里加行消音**（P3 同规：新增缺失 ⇒ 补一卷真记录）'
    console.error(`[delivery-claims] GATE-FAIL 新增 ${r.fresh.length}｜基线死行 ${r.stale.length}（当次不合格合计 ${r.badClaims.length + r.ghosts.length + r.badMeasures.length} = 主张 ${r.badClaims.length} + 幽灵 sha ${r.ghosts.length} + 测量句 ${r.badMeasures.length}，其中 ${r.baselineRows === null ? '未装载基线' : `存量在册 ${r.baselineRows}`}）`
      + `｜档位=${advisory ? '报告型：印出来但不拦（--advisory）' : '阻断'}`
      + `｜处置=${advice}`)
    if (advisory) process.exit(0)
    process.exit(1)
  }
  console.log(`[delivery-claims] GATE-PASS delivery-claims :: 新增 0｜基线死行 0｜存量在册 ${r.baselineRows === null ? '未装载' : r.baselineRows}`
    + `（其中幽灵 sha ${r.ghosts.length} 条按整行指纹挂册）｜已就地更正 ${r.d5.annotated.length}｜未定位 ${r.d5.unknown.length}${inject ? '｜注入态本应判红，见上' : ''}`)
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main()
}
