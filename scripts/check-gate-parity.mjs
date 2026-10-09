#!/usr/bin/env node
// check-gate-parity.mjs —— 本地快门禁 ⇄ CI 快门禁的**判据面对齐**（第七十二轮 I-72-4）
//
// 立它的理由是本轮挖到的一条**因果链**，不是又一条"覆盖率报告"：
//   ① 逃生门账本 27 条绕过里，判决面真红的 **9 条中有 4 条**红在 CI 的
//      `Test (vitest, with v8 coverage)` 这一步 —— 实测 run 37667074618 的原文：
//      `ERROR: Coverage for lines (76.84%) does not meet global threshold (80%)`
//      （statements 74.67/79、functions 70.9/74、branches 69.83/72 四条阈值同时被顶破）。
//   ② 本地快门禁 `npm run verify` 里跑的是 **`npm test` = `vitest run`，不带 `--coverage`**
//      ⇒ **覆盖率棘轮在本地根本不生效**，只有 CI 那一侧会算它。
//   ③ 于是"本地绿、CI 红"成了常态，作者要修覆盖率就得先推上去（推不上去被绿契约挡）⇒ 走逃生门。
//   换句话说：**绕过台账里 9 条 RED 的成因链，有一条就长在这个缝里。**
//
// 与既有判据的分界（one-fact-one-judge，不许重复立）：
//   · `verify:coverage`/`vite.config.js` 管阈值**是多少**、能不能升降 → 本件不碰；
//   · `cliEntrypoints` 管每条门禁**跑不跑得通** → 本件只比对"**是不是同一条**"；
//   · `ciWorkflow.test.ts` 管 ci.yml **内部**自洽（needs / 钉 SHA / step 名单） → 本件管 ci.yml ⇄ 本地链的**跨文件**对账；
//   · `verify:functions` 报"未纳入 verify 的 npm 脚本"是**报告型清单** → 本件把它变成**阻断**，且只对 CI 判决面里的那几条判。
//
// 方向是**单向**的：CI 判据面 ⊆ 本地可达面。理由：本地链比 CI 宽是合法的（本地-only 判据很多），
// 反过来（本地有、CI 没有）在"绿契约以远端为准"的架构里才是问题，而那条已由
// `check-head-closure`（链引用的脚本必须在提交面里）与 `.ci/contract.json` 的 requiredJobs 覆盖。
//
// 三态退出码：0 = 对齐 / 1 = 有未登记的错位 / 2 = 某一面读不到（不折算成"对齐"）。
import { readFileSync, existsSync } from 'node:fs'
import { reasonDefects } from './lib/registry-reason.mjs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REGISTRY = '.ci/contract.json'
export const LOCAL_CHAINS = ['verify', 'preflight', 'preflight:ci']

/** 不参与对齐的 CI step：不是判据（构建/上传/开关/注释/登录）。 */
const NON_JUDGE = /^(Build|Upload|Set up|Dependency audit \(full|Secret scan$|Checkout|Complete|Install)/

/**
 * 从 ci.yml 的 `gates` job 里抽出判据型 step 的 (stepName, command)。
 * 只认 `run:` 里真正跑判据的形态：`npm run X` / `npx vitest ...` / `node scripts/check-*.mjs`。
 */
export function ciJudgeSteps (ciText, jobName = 'gates') {
  const m = new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|$)`).exec(String(ciText).replace(/\r\n/g, '\n'))
  if (!m) return []
  const block = m[1]
  const out = []
  const lines = block.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const nm = /^[ \t]*-[ \t]+name:[ \t]*(.+?)[ \t]*$/.exec(lines[i])
    if (!nm) continue
    const name = nm[1]
    // step 体：从 name 行到下一个 `- name:` / `- uses:` 行之前
    let e = i + 1
    while (e < lines.length && !/^[ \t]*-[ \t]+(name|uses):/.test(lines[e])) e += 1
    const body = lines.slice(i, e).join('\n')
    const run = /^[ \t]*run:[ \t]*(.+)$/m.exec(body)?.[1]?.trim()
    if (!run || NON_JUDGE.test(name)) continue
    // advisory step（continue-on-error: true）**永远不可能把 CI 判红** ⇒ 它不属于
    // "CI 的阻断面 ⊆ 本地链"这个事实的取数面。把它纳入分母就是造一条永远修不好的假阳。
    const advisory = /^[ \t]*continue-on-error:[ \t]*true[ \t]*$/m.test(body)
    if (advisory) continue
    // 判据型 run 的三种形态。`npm test` / `npm run verify` 是裸 `npm`，不带 `run ` ——
    // 只写 /npm run / 会把整条测试面漏出分母（本轮自证①当场抓到：3 条 step 只认出 2 条）。
    if (/npm run /.test(run) || /^npm (test|verify)\b/.test(run)
      || /^npx (vitest|playwright)/.test(run) || /^node scripts\//.test(run)) {
      out.push({ name, run })
    }
  }
  return out
}

/** 把本地链摊平成一条命令串（本地链是 `a && b && c`，判据可能在任意位置）。 */
export function localChainsOf (pkg) {
  const out = {}
  for (const c of LOCAL_CHAINS) out[c] = String(pkg.scripts?.[c] || '')
  return out
}

/**
 * 归一化成"这条判据在本地的可执行形态"集合。
 * 关键：`npm test` 必须按 package.json 里 test 的**定义**展开，而不是当成一个原子的名字 ——
 * 否则 `npm test`（= `vitest run`）会被拿去和 CI 的 `npx vitest run --coverage` 比，
 * 比出"本地有 vitest、形态不同"这种读不懂的话。
 */
export function localForms (pkg, chains) {
  const forms = new Set()
  const add = (s) => { if (s) forms.add(String(s).replace(/\s+/g, ' ').trim()) }
  for (const c of LOCAL_CHAINS) {
    for (const seg of String(chains[c] || '').split('&&')) {
      const t = seg.trim()
      if (!t) continue
      if (t === 'npm test') { add(pkg.scripts?.test); continue }
      if (t === 'npm run verify') { add(pkg.scripts?.verify); continue }
      add(t)
    }
  }
  return forms
}

/** 把一条 CI 命令压成可比对的"形态键"：别名本身，或它展开后的底层命令。 */
export function shapeKey (run) {
  const t = String(run).replace(/\s+/g, ' ').trim()
  const alias = /^npm run ([A-Za-z0-9:_-]+)$/.exec(t)
  if (alias) return `alias:${alias[1]}`
  const bare = /^npm (test|verify)$/.exec(t)
  if (bare) return `alias:${bare[1]}`
  return `cmd:${t}`
}

/** alias → 它在本仓 package.json 里的定义（用于判断形态是否真的等价）。 */
function aliasTarget (run, pkg) {
  const t = String(run).replace(/\s+/g, ' ').trim()
  const alias = /^npm run ([A-Za-z0-9:_-]+)$/.exec(t)
  if (alias) return { name: alias[1], def: String(pkg.scripts?.[alias[1]] ?? '') }
  const bare = /^npm (test|verify)$/.exec(t)
  if (bare) return { name: bare[1], def: String(pkg.scripts?.[bare[1]] ?? '') }
  return null
}

/** 一条 CI 命令的"归一形态"：别名展开到最终脚本调用，剥掉路径前缀。 */
function normalizeCmd (def, pkg) {
  let t = String(def || '').replace(/\s+/g, ' ').trim()
  const alias = /^npm run ([A-Za-z0-9:_-]+)$/.exec(t)
  if (alias) return normalizeCmd(pkg.scripts?.[alias[1]], pkg)
  t = t.replace(/^node\s+(scripts\/)?/, '').replace(/^npx\s+/, '')
  // `vitest run --coverage` 与 `npm test`(=vitest run) 要能比出差异，就保留全部 flag
  return t.replace(/^dotenv\s+-\s+/, '')
}

/**
 * 纯判据。返回 { misalign, checked }；ci.yml 里取不到判据 step 时返回 **null**（零分母不折算）。
 *
 * 错位分两类，分类判据是「基命令是否相同」而不是「别名是否相同」：
 *   SAME_NAME_DIFFERENT_FORM：本地存在**基命令相同、flag 不同**的形态。
 *       这一类才是本轮要治的那一半 —— 读的人以为本地跑了，跑的却不是同一个东西
 *       （CI 的 `vitest run --coverage` vs 本地 `vitest run`：覆盖率棘轮只在 CI 生效）。
 *       按别名名分类会漏掉它：`npx vitest run --coverage` 根本没有别名。
 *   NOT_IN_LOCAL_CHAIN：本地连基命令都没有。
 */
/**
 * 按 token 剥 flag 取基命令。规则：词首是 `-x` / `--xxx` 的 token 剥掉；
 * 若该 flag 不带 `=` 且下一个 token 既不是 flag 也不像路径/命令（无 `/` 无 `.`），
 * 视为它的取值一并剥掉（`--base main` / `--limit 6`）。
 * 文件名里的连字符不受影响：`check-cron-health.mjs` 的 `-health` 不在词首。
 */
export function baseCommandOf (cmd) {
  const toks = String(cmd || '').trim().split(/\s+/).filter(Boolean)
  const out = []
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]
    const isFlag = t === '--' || (/^-/.test(t) && t.length > 1 && !/^-[\d.]/.test(t))
    if (!isFlag) { out.push(t); continue }
    const next = toks[i + 1]
    if (!t.includes('=') && next && !/^-/.test(next) && !/[/.]/.test(next)) i += 1
  }
  return out.join(' ')
}

export function gateParity ({ ciText, pkg, deepText = null }) {
  // 分母（第七十三轮 I-73-4）：从"只读 ci.yml 的 gates"扩到 **ci.yml:gates + ci-deep.yml:deep-gates**。
  // 旧版硬编码单文件单 job（:290 `join(ROOT, '.github', 'workflows', 'ci.yml')` + :135 `ciJudgeSteps(ciText, 'gates')`），
  // 而 `check:gate-parity` 自己的名字就叫"门禁面对齐" —— 它对齐的从来只是**一半门禁面**：
  // ci-deep.yml 的 24 条判据 step 从没进过对账。一把尺的名字比它的取数面大，就是虚判。
  const sources = [{ file: 'ci.yml', job: 'gates', text: ciText }]
  if (deepText) sources.push({ file: 'ci-deep.yml', job: 'deep-gates', text: deepText })
  const steps = sources.flatMap((src) => ciJudgeSteps(src.text, src.job).map((x) => ({ ...x, file: src.file })))
  // 零分母守卫放在纯函数里：job 一旦改名/挪位，`steps` 会空，
  // 而"0 条判据要对齐"会被读成"已对齐"—— 那是一次长得和真绿一模一样的假绿。
  if (!steps.length) return null
  const chains = localChainsOf(pkg)
  const forms = localForms(pkg, chains)
  const misalign = []
  const seen = new Set()
  /** 基命令 = 剥掉全部 flag 后的命令本体（`vitest run --coverage` → `vitest run`）。
   *  旧实现那条 `--?[A-Za-z][\w-]*` 的**可选单连字符**会把文件名里的 `-health` / `-case`
   *  当 flag 剥掉 ⇒ `check-cron-health.mjs` 与 `check-case-collision.mjs` 双双归一成
   *  `check.mjs`，两条毫不相干的判据被报成「同名不同物」（第七十三轮把分母扩到 ci-deep.yml
   *  时实测出 4 条错位，逐条核下来只有 1 条是真的）。改成按空白切 token、只剥词首 flag。 */
  const baseOf = (c) => baseCommandOf(c)
  const allForms = [...forms].map((f) => ({ raw: f, norm: normalizeCmd(f, pkg) }))
  for (const s of steps) {
    const key = shapeKey(s.run)
    const at = aliasTarget(s.run, pkg)
    const target = at ? normalizeCmd(at.def, pkg) : normalizeCmd(s.run, pkg)
    const literal = forms.has(String(s.run).replace(/\s+/g, ' ').trim())
    const exact = allForms.some((f) => f.norm === target)
    if (literal || exact) continue
    // 同基命令、flag 不同 ⇒ 同名不同物（把两条形态一起印出来，让人一眼看出差在哪）
    const base = baseOf(target)
    const sib = base ? allForms.find((f) => baseOf(f.norm) === base) : null
    if (sib) {
      const id = `form:${key}`
      if (!seen.has(id)) {
        seen.add(id)
        misalign.push({
          id, kind: 'SAME_NAME_DIFFERENT_FORM',
          detail: `CI「${s.file || 'ci.yml'}:${s.name}」跑 \`${s.run}\`（形态 \`${target}\`），本地同基命令的形态是 \`${sib.norm}\` —— 同名不同物：CI 侧生效的那半本地不生效`,
        })
      }
      continue
    }
    const id = `missing:${key}`
    if (!seen.has(id)) {
      seen.add(id)
      misalign.push({
        id, kind: 'NOT_IN_LOCAL_CHAIN',
        detail: `CI「${s.file || 'ci.yml'}:${s.name}」跑 \`${s.run}\`，本地 ${LOCAL_CHAINS.join(' / ')} 三条链里连基命令都没有（形态键 = ${key}）`,
      })
    }
  }
  return { misalign, checked: { ciJudgeSteps: steps.length, localForms: forms.size, chains: LOCAL_CHAINS.length } }
}

/** 错位登记册（`.ci/contract.json` 的 `gateParityExceptions`）。半张的登记册比没有更坏。 */
export function registryOf (contractPath) {
  if (!existsSync(contractPath)) return { items: [], error: `读不到 ${contractPath}` }
  try {
    const j = JSON.parse(readFileSync(contractPath, 'utf8'))
    const raw = j.gateParityExceptions
    if (raw === undefined) return { items: [], error: null }
    if (!Array.isArray(raw)) return { items: [], error: 'contract.gateParityExceptions 不是数组 ⇒ 宁可不判也不猜' }
    const items = []
    for (const [i, a] of raw.entries()) {
      const bad = !a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id
        || typeof a.why !== 'string' || !a.why.trim()
        || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.untilUtc))
      if (bad) return { items: [], error: `contract.gateParityExceptions[${i}] 缺 id/why，或 untilUtc 不是 YYYY-MM-DD` }
      const rd = reasonDefects(`gateParityExceptions[${i}]（${a.id}）`, a.why)
      if (rd.length) return { items: [], error: `contract.gateParityExceptions[${i}] 的理由不合格 ⇒ ${rd.join('；')}` }
      items.push(a)
    }
    return { items, error: null }
  } catch (e) {
    return { items: [], error: `contract.json 解析失败：${String(e.message || e).split('\n')[0]}` }
  }
}

function selftest () {
  /** 自证里的前置断言：条件不成立就直接让该腿红（比 return false 更能指出是哪一步塌了）。 */
  const expectLike = (cond) => { if (!cond) throw new Error('前置断言不成立') }
  const pkg = {
    scripts: {
      'verify:a': 'node scripts/a.mjs',
      'verify:b': 'node scripts/b.mjs',
      'test': 'vitest run',
      verify: 'npm run verify:a && npm run verify:b && npm test',
      preflight: 'npm run verify:a',
      'preflight:ci': 'npm run verify:b && npx vitest run --coverage',
    },
  }
  const ciWith = (lines) => ['name: CI', 'permissions:', '  contents: read', 'jobs:', '  gates:', '    runs-on: ubuntu-latest', '    steps:', ...lines, ''].join('\n')

  const cases = [
    ['① 正向：CI 判据面与本地链逐条对齐 ⇒ 0 错位（分母非零）', () => {
      const ci = ciWith([
        '      - name: A', '        run: npm run verify:a',
        '      - name: B', '        run: npm run verify:b',
        '      - name: Test', '        run: npm test',
      ])
      const r = gateParity({ ciText: ci, pkg })
      return r !== null && r.misalign.length === 0 && r.checked.ciJudgeSteps === 3
    }],
    ['② 形态可展开：CI 写 `npm run verify:a`，本地链里是同一条 ⇒ 认得（别名不是原子的）', () => {
      const ci = ciWith(['      - name: A', '        run: npm run verify:a'])
      return gateParity({ ciText: ci, pkg }).misalign.length === 0
    }],
    ['③ 反例（**本轮要治的那一半**）：CI 跑 --coverage，本地只有不带 flag 的形态 ⇒ SAME_NAME_DIFFERENT_FORM，且两条形态都印出来', () => {
      const ci = ciWith(['      - name: Test (vitest, with v8 coverage)', '        run: npx vitest run --coverage'])
      // preflight:ci 里有同形态 ⇒ 本仓其实覆盖到了；这一腿先证"覆盖时不报"
      expectLike(gateParity({ ciText: ci, pkg }).misalign.length === 0)
      // 把 preflight:ci 里的同形态摘掉 ⇒ 只剩 `vitest run` ⇒ 必须点名"同名不同物"
      const pkg2 = { scripts: { ...pkg.scripts, 'preflight:ci': 'npm run verify:b' } }
      const r = gateParity({ ciText: ci, pkg: pkg2 })
      return r.misalign.length === 1
        && r.misalign[0].kind === 'SAME_NAME_DIFFERENT_FORM'
        && r.misalign[0].detail.includes('vitest run --coverage')
        && r.misalign[0].detail.includes('同名不同物')
    }],
    ['④ 反例：CI 有一条判据本地连基命令都没有 ⇒ NOT_IN_LOCAL_CHAIN 且指名形态键', () => {
      const ci = ciWith([
        '      - name: A', '        run: npm run verify:a',
        '      - name: Bundle size budget (gzip, first-load)', '        run: node scripts/check-bundle-size.mjs',
      ])
      const r = gateParity({ ciText: ci, pkg })
      return r.misalign.length === 1 && r.misalign[0].kind === 'NOT_IN_LOCAL_CHAIN'
        && r.misalign[0].detail.includes('check-bundle-size.mjs')
    }],
    ['⑤ 非判据 step 不参与：Build / Upload / Set up / 只报不拦的审计腿都不算错位', () => {
      // 必须带一条真判据，否则分母为 0 会走零输入守卫（那是另一条腿要测的东西）
      const ci = ciWith([
        '      - name: A', '        run: npm run verify:a',
        '      - name: Build', '        run: npm run build',
        '      - name: Upload dist artifact', '        run: echo hi',
        '      - name: Set up Python (product image assets gate)', '        uses: actions/setup-python@v7',
        '      - name: Dependency audit (full tree incl. dev toolchain) — 只报不拦', '        run: npm run audit:deps:full',
        '      - name: Upload coverage report', '        uses: actions/upload-artifact@v7',
      ])
      const r = gateParity({ ciText: ci, pkg })
      return r !== null && r.checked.ciJudgeSteps === 1 && r.misalign.length === 0
    }],
    ['⑥ 零输入不折算：ci.yml 里 gates 只有非判据 step ⇒ 返回 null 而不是"0 错位"', () => {
      const ci = ciWith(['      - name: Build', '        run: npm run build'])
      return gateParity({ ciText: ci, pkg }) === null
    }],
    ['⑦ 变异体：把"形态比较"退化成"名字比较"的实现会在③上翻红 ⇒ 自证有牙', () => {
      const ci = ciWith(['      - name: Test (vitest, with v8 coverage)', '        run: npx vitest run --coverage'])
      const pkg2 = { scripts: { ...pkg.scripts, 'preflight:ci': 'npm run verify:b' } }
      const r = gateParity({ ciText: ci, pkg: pkg2 })
      return r.misalign.length === 1 && r.misalign[0].kind === 'SAME_NAME_DIFFERENT_FORM'
    }],
    ['⑧ 基命令归一化不得把两个不同文件认成同一个（第七十三轮修掉的那族假阳）', () => {
      // 旧正则 `--?[A-Za-z][\w-]*` 里那个**可选的单连字符**会把文件名中的 `-health` / `-case`
      // 当 flag 剥掉 ⇒ 两条毫不相干的判据双双归一成 `check.mjs`，被报成「同名不同物」。
      const a = baseCommandOf('node scripts/check-cron-health.mjs --json')
      const b = baseCommandOf('node scripts/check-case-collision.mjs')
      return a === 'node scripts/check-cron-health.mjs' && b === 'node scripts/check-case-collision.mjs' && a !== b
    }],
    ['⑨ 带空格的 flag 取值一起剥掉，但路径型参数不许被误剥', () =>
      baseCommandOf('npm run check:contract-diff --base main') === 'npm run check:contract-diff'
      && baseCommandOf('node x.mjs --limit 6') === 'node x.mjs'
      && baseCommandOf('node x.mjs --json docs/a.json') === 'node x.mjs docs/a.json'],
    ['⑩ advisory step（continue-on-error: true）不进分母 —— 它永远不可能把 CI 判红', () => {
      const ci = ciWith([
        '      - name: A', '        run: npm run verify:a',
        '      - name: Advisory-only gate', '        continue-on-error: true', '        run: npm run verify:zzz',
      ])
      // 排除若回归，那条本地根本不存在的 verify:zzz 会立刻变成第 2 条 step ⇒ 本腿翻红
      return ciJudgeSteps(ci, 'gates').length === 1 && gateParity({ ciText: ci, pkg }).misalign.length === 0
    }],
    ['⑪ 分母真的含 ci-deep.yml:deep-gates；且旧版"只认 gates 这一个 job 名"的失明可复现', () => {
      const ci = ciWith(['      - name: A', '        run: npm run verify:a'])
      const deep = ['name: CI Deep', 'jobs:', '  deep-gates:', '    runs-on: ubuntu-latest', '    steps:',
        '      - name: D', '        run: npm run verify:b', ''].join('\n')
      const withDeep = gateParity({ ciText: ci, pkg, deepText: deep })
      const without = gateParity({ ciText: ci, pkg })
      // 把深链正文喂给旧口径（job 名写死 'gates'）⇒ 取到 0 条 step ⇒ 返回 null。
      // 这一行就是"第 72 轮那版为什么量不到深链"的可复现证据：不是漏跑，是**根本看不见**。
      const blind = gateParity({ ciText: deep, pkg })
      return withDeep.checked.ciJudgeSteps === 2 && without.checked.ciJudgeSteps === 1
        && withDeep.misalign.length === 0 && blind === null
    }],
  ]
  let bad = 0
  for (const [label, check] of cases) {
    let ok = false
    let note = ''
    try { ok = check() === true } catch (e) { ok = false; note = `（崩：${e.message}）` }
    if (!ok) bad += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${note}`)
  }
  console.log(`[check:gate-parity] 自证 ${cases.length - bad}/${cases.length}${bad ? ' ⇒ 有腿没咬住' : ''}`)
  return bad ? 1 : 0
}

function main (argv = process.argv.slice(2)) {
  if (argv.includes('--selftest')) return selftest()
  const advisory = argv.includes('--advisory')
  const ciPath = join(ROOT, '.github', 'workflows', 'ci.yml')
  const deepPath = join(ROOT, '.github', 'workflows', 'ci-deep.yml')
  const pkgPath = join(ROOT, 'package.json')
  let ciText
  let deepText = null
  let pkg
  try {
    ciText = readFileSync(ciPath, 'utf8')
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    console.error(`[gate-parity] UNVERIFIED 取数面读不动（ci.yml / package.json）：${String(e.message || e).split('\n')[0]} ⇒ 不折算成"已对齐"`)
    return 2
  }
  // 深链读不到 ⇒ 分母退回单文件，但**必须把"只量了一半"印出来**：
  // 静默按 ci.yml 报 GREEN 就是拿半面的读数冒充全面的结论（本仓「失明不等于零」同族）。
  try { deepText = readFileSync(deepPath, 'utf8') } catch { deepText = null }
  const reg = registryOf(join(ROOT, REGISTRY))
  if (reg.error) { console.error(`[gate-parity] UNVERIFIED ${reg.error}`); return 2 }

  const r = gateParity({ ciText, pkg, deepText })
  if (r === null) {
    console.error('[gate-parity] UNVERIFIED ci.yml 里取不到 gates job（分母为 0）⇒ 不折算成"已对齐"。处置＝同步本判据的 job 名，或确认 ci.yml 结构变了')
    return 2
  }
  const registered = new Map(reg.items.map((x) => [x.id, x]))
  const fresh = r.misalign.filter((m) => !registered.has(m.id))
  const covered = r.misalign.filter((m) => registered.has(m.id)).map((m) => ({ ...m, ...registered.get(m.id) }))

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ checked: r.checked, misalign: r.misalign.length, fresh: fresh.length, covered: covered.length, findings: fresh }, null, 2))
  } else {
    const faces = deepText ? 'ci.yml:gates + ci-deep.yml:deep-gates' : '仅 ci.yml:gates'
    console.log(`[gate-parity] CI 判决面判据 step ${r.checked.ciJudgeSteps} 条（取数面 = ${faces}）`
      + `｜本地三条链（${LOCAL_CHAINS.join(' / ')}）摊出可执行形态 ${r.checked.localForms} 种｜对齐方向：CI ⊆ 本地`)
    if (!deepText) console.error('[gate-parity] ⚠ 半面读数：ci-deep.yml 取不到 ⇒ 本轮只对上了一半门禁面，这个 GREEN 不等于"门禁面已对齐"')
    console.log(`[gate-parity] 错位 ${r.misalign.length} 条 = 未登记 ${fresh.length} + 在册 ${covered.length}（登记册 ${reg.items.length} 条）`)
    for (const f of fresh) console.log(`  FAIL    ${f.kind} :: ${f.detail}`)
    for (const c of covered) console.log(`  PASS    ${c.kind} :: ${c.detail}（在册至 ${c.untilUtc}：${c.why}）`)
  }
  if (fresh.length) {
    console.error(`[gate-parity] GATE-FAIL gate-parity :: ${fresh.length} 条错位未登记。`
      + `处置二选一：**真的该本地跑**就把同形态接进 \`npm run verify\`（别接成另一个形态）；`
      + `**本地确实跑不了**（要联网/要平台凭据）就在 ${REGISTRY} 的 \`gateParityExceptions\` 里具名登记 + why + untilUtc。`
      + `**不要**把 CI 那一步删掉来求绿 —— 那是削闸，不是对齐。`)
    if (advisory) return 0
    return 1
  }
  console.log(`[check:gate-parity] verdict=GREEN rc=0｜档位=${advisory ? '报告型（--advisory）' : '阻断'}｜错位 0 条新增`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exit(main())
}

export { pathToFileURL }
