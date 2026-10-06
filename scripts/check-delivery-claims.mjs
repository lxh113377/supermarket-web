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
 * 退出码：0=PASS 或 UNVERIFIED（本轮为 advisory，不阻断）/ 1=判红 / 2=取数面指定了却不存在
 * 档位：**报告型起步**（第六十八轮老大拍板）。下一轮按 matched/mismatched 的误报率决定是否升阻断位。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
 * 纯判据。files = [{ name, text }]，requiredJobs = 字符串数组。
 * 返回 { state, matched, mismatched, badClaims[], badMeasures[], faceSize }。
 * matched = 带齐回执的交付主张条数；mismatched = 缺回执的条数。**两个数都要印**——
 * 只印"问题清单"会让人分不清"没问题"与"没看到问题"（本仓 R-CURRENT 第 9 条同族）。
 */
export function judgeDeliveries({ files, requiredJobs, limit = 6 }) {
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
    const secs = sectionsOf(f.text)
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
          badClaims.push({ file: f.name, heading: s.heading, claim: [...new Set(hits)].join('/'), why: miss.join('；') })
        }
      }
      for (const line of s.lines) {
        if (MEASURE_VERB_RE.test(line) && MEASURE_CLAIM_RE.test(line) && !TOOL_RE.test(line)) {
          badMeasures.push({ file: f.name, heading: s.heading, line: line.trim().slice(0, 150) })
        }
      }
    }
  }
  const state = badClaims.length || badMeasures.length ? 'FAIL' : 'PASS'
  return { state, matched, mismatched, badClaims, badMeasures, faceSize: files.length, limit }
}

/**
 * D4：反向腿 —— 三件套齐全的主张**不得**被判红。
 * 只测拒绝侧的判据会把真话永久拦死，逼人改用绕法；这条每次运行都自证一次（零外部依赖）。
 */
export function selfCheckAdmission() {
  const jobs = ['build-and-test', 'deploy']
  const good = [{
    name: 'good.md',
    text: '## 9. 远端回执\n\n| 事 | 回执 |\n|---|---|\n| 本轮 H-1 **已上线** | run `37228542182` `completed/success`；`build-and-test` success、`deploy` success；`/_health` 返回 {"deploy":"ecdc92d"} |\n',
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
    files = files.concat([{
      name: '(注入演习) synthetic.md',
      text: '## 99. 远端回执（INJECTED）\n\n本轮 H-99 **已上线**，无任何 run 号与结论。\n',
    }])
  }
  const r = judgeDeliveries({ files, requiredJobs: cj.jobs, limit })
  const self = selfCheckAdmission()
  // D4 自证失败 ⇒ 本判据自己不可信，直接判红：不允许"尺没牙但报绿"。
  const selfOk = self.admitsHonest && self.rejectsEmpty && self.admitsMention

  if (asJson) {
    console.log(JSON.stringify({ state: r.state, faceSize: r.faceSize, matched: r.matched, mismatched: r.mismatched, badClaims: r.badClaims, badMeasures: r.badMeasures, selfCheck: self, injected: inject }, null, 2))
  } else {
    console.log(`[delivery-claims] 取数面 ${dir}｜md ${r.faceSize} 份｜requiredJobs ${cj.jobs.join(',')}（来源 .ci/contract.json）`)
    console.log(`[delivery-claims] 交付主张 matched=${r.matched} mismatched=${r.mismatched}`
      + `｜测量句缺尺 ${r.badMeasures.length} 条`
      + `｜D4 自证 admitsHonest=${self.admitsHonest} rejectsEmpty=${self.rejectsEmpty} admitsMention=${self.admitsMention}`
      + `${inject ? '｜--inject-red 已注入一条假主张' : ''}`)
    for (const b of r.badClaims.slice(0, limit)) console.error(`  ✗ ${b.file} §${b.heading}：主张「${b.claim}」但${b.why}`)
    for (const b of r.badMeasures.slice(0, limit)) console.error(`  ✗ ${b.file} §${b.heading}：测量句未点名取数器 → ${b.line}`)
    if (r.badClaims.length > limit || r.badMeasures.length > limit) {
      console.error(`  …（各限 ${limit} 行，总数见上面 matched/mismatched 两个数；调 --limit 看全量）`)
    }
  }
  if (!selfOk) { console.error('[delivery-claims] GATE-FAIL D4 反向腿不成立 ⇒ 这条尺本身不可信，先修尺再谈判别人'); process.exit(1) }
  if (r.state === 'FAIL') {
    console.error(`[delivery-claims] GATE-FAIL ${r.badClaims.length + r.badMeasures.length} 处不合格`
      + '（本轮档位=报告型：印出来并计入台账，但不拦提交。升阻断位需按 matched/mismatched 的误报率由用户拍板）')
    process.exit(1)
  }
  console.log(`[delivery-claims] GATE-PASS delivery-claims ${inject ? '（注入态本应判红，见上）' : ''}`)
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main()
}
