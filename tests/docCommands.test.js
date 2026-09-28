// 第四十三轮夹具①：**文档里印的命令有没有跟现实对过账**（D1~D6）。
// 立它的读数（本机实测 @2026-09-28）：durable 文档里 code-span 命令 **90 条提及、3 条不成立**
// （`docs/implementation-plan-2026-08-08.md:11/113/223` 的 `npm run predeploy` = CloudBase 时代死命令），
// 另有 1 条 `node scripts/X.mjs` 是**用法骨架占位符**、1 条在册门禁别名先前无人提及。
// 难点不是抓到，而是**不把历史与模板误判成缺陷** ⇒ 本文件对三类面各钉一条方向相反的断言。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { evaluate, extractCommands, collectDocs, readAliases, renderGateTable, syncGateTable, registryBody, normalizeEol } from '../scripts/check-doc-commands.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const SCRIPT = join('scripts', 'check-doc-commands.mjs')
const DIR = mkdtempSync(join(tmpdir(), 'dcom-'))
const state = (rows, id) => rows.find((r) => r.id === id)

const doc = (path, src) => ({ path, src })
const AL = [{ name: 'verify:ok', cmd: 'node scripts/ok.mjs' }, { name: 'lint', cmd: 'oxlint' }]
const REG = { archive_faces: [], observed_utc: '2026-09-28T00:00:00Z' }
const run = (docs, extra = {}) => evaluate({
  docs, aliases: extra.aliases || AL, registry: extra.registry || REG,
  fileExists: extra.fileExists || (() => true), entryMd: extra.entryMd === undefined ? defaultEntryMd() : extra.entryMd,
})
function defaultEntryMd() {
  try { return readFileSync(join(ROOT, 'docs', 'cli-entrypoints.md'), 'utf8') } catch { return '' }
}

describe('文档命令对账 · 正例与分母', () => {
  it('全部命令成立 ⇒ D1~D6 齐绿，且 D1 把三类面的计数都印出来', () => {
    const readme = renderGateTable(AL) + '\n另见 `npm run verify:ok`'
    const { rows } = run([doc('README.md', readme)])
    expect(rows.filter((r) => r.ok !== true).map((r) => r.id)).toEqual([])
    expect(state(rows, 'D1').detail).toMatch(/claim \d+ \/ template \d+ \/ archive \d+/)
  })

  it('真仓面非空（禁"零输入=通过"），且抽取只认真实文档目录', () => {
    const docs = collectDocs(ROOT)
    const aliases = readAliases(ROOT)
    expect(docs.length).toBeGreaterThan(10)
    expect(aliases.length).toBeGreaterThan(30)
    const reg = JSON.parse(readFileSync(join(ROOT, 'docs', 'doc-commands.json'), 'utf8'))
    const { counts } = evaluate({ docs, aliases, registry: reg, fileExists: (f) => existsReal(f), entryMd: defaultEntryMd() })
    expect(counts.mentions).toBeGreaterThan(50)
    // 真面必须已经全绿：这条断言的意义是"报告里写的绿"当场可复算，不是我相信它绿
    expect(counts.broken).toBe(0)
  })
})

function existsReal(f) {
  try { readFileSync(join(ROOT, f)); return true } catch { return false }
}

describe('文档命令对账 · 三类面各一正一反', () => {
  it('现行主张里印了不存在的别名 ⇒ D2 红并带 文件:行号', () => {
    const { rows } = run([doc('README.md', '先跑一行说明\n然后 `npm run gone:alias`')])
    expect(state(rows, 'D2').ok).toBe(false)
    expect(state(rows, 'D2').detail).toContain('README.md:2')
    expect(state(rows, 'D2').detail).toContain('npm run gone:alias')
  })

  it('历史归档面内：同一条死命令不判缺陷，但**必须带未过期的 exempt_until**', () => {
    const src = doc('docs/plan-2026-08-08.md', '`npm run predeploy` 已随迁移消失')
    const green = run([src], { registry: { archive_faces: [{ path: 'docs/plan-2026-08-08.md', exempt_until: '2099-01-01' }], observed_utc: '2026-09-28T00:00:00Z' } })
    expect(state(green.rows, 'D2').ok).toBe(true)
    expect(state(green.rows, 'D1').detail).toContain('archive 1')
    const expired = run([src], { registry: { archive_faces: [{ path: 'docs/plan-2026-08-08.md', exempt_until: '2026-09-01' }], observed_utc: '2026-09-28T00:00:00Z' } })
    expect(state(expired.rows, 'D2').ok).toBe(false)
    expect(state(expired.rows, 'D4').ok).toBe(false)
  })

  it('模板占位不判红，且反向腿证明**真文件名不会被占位形状吞掉**', () => {
    const tpl = run([doc('docs/x.md', '用法骨架：`node scripts/X.mjs --fixture F`')])
    expect(state(tpl.rows, 'D2').ok).toBe(true)
    expect(state(tpl.rows, 'D3').ok).toBe(false) // 面里一个真名样本都没有 ⇒ 本腿无对象，判未成立不判通过
    const both = run([doc('docs/x.md', '骨架 `node scripts/X.mjs`；真跑 `node scripts/ok.mjs`')],
      { fileExists: (p) => p === 'scripts/ok.mjs' })
    expect(state(both.rows, 'D3').ok).toBe(true)
    const eaten = run([doc('docs/x.md', '`node scripts/okX.mjs` 是真实存在的文件')], { fileExists: () => true })
    expect(state(eaten.rows, 'D3').ok).toBe(false)
    expect(state(eaten.rows, 'D3').detail).toContain('被占位形状误吞')
  })
})

describe('文档命令对账 · 反向对账与生成物', () => {
  it('门禁别名在册却任何文档都不提 ⇒ D5 红；补一条具名理由即绿', () => {
    // verify:quiet 与它指向的 quiet.mjs 都不在文档里 ⇒ "有闸没人知道"
    const { rows } = run([doc('README.md', renderGateTable([{ name: 'verify:loud', cmd: 'node scripts/loud.mjs' }]) + '\n跑 `npm run verify:loud`')],
      { aliases: [{ name: 'verify:loud', cmd: 'node scripts/loud.mjs' }, { name: 'verify:quiet', cmd: 'node scripts/quiet.mjs' }] })
    expect(state(rows, 'D5').ok).toBe(false)
    expect(state(rows, 'D5').detail).toContain('verify:quiet')
    const ok = run([doc('README.md', '跑 `npm run verify:loud`' + '\n')], {
      aliases: [{ name: 'verify:loud', cmd: 'node scripts/loud.mjs' }, { name: 'verify:quiet', cmd: 'node scripts/quiet.mjs' }],
      registry: { archive_faces: [], observed_utc: '2026-09-28T00:00:00Z', undocumented_gates: [{ alias: 'verify:quiet', reason: '只在 e2e 前置用，实测 3 处调用点（`grep -c verify:quiet .github/workflows/*` = 3）' }] },
    })
    expect(state(ok.rows, 'D5').ok).toBe(true)
  })

  it('README 门禁块 ⇄ package.json 双向：缺行/幽灵行/没有块 各红一次', () => {
    const aliases = [{ name: 'verify:a', cmd: 'node scripts/a.mjs' }, { name: 'check:b', cmd: 'node scripts/b.mjs' }]
    const table = renderGateTable(aliases)
    const good = run([doc('README.md', table)], { aliases })
    expect(state(good.rows, 'D6').ok).toBe(true)
    const missing = run([doc('README.md', table.replace('| `npm run check:b` | b.mjs |', ''))], { aliases })
    expect(state(missing.rows, 'D6').ok).toBe(false)
    expect(state(missing.rows, 'D6').detail).toContain('缺行')
    // 幽灵行必须**插在块内**（表外塞一行本就不该被认——那正是块边界的作用，顺带钉住它）
    const ghostSrc = table.replace('<!-- gate-table:end -->', '| `npm run check:gone` | gone.mjs |\n<!-- gate-table:end -->')
    expect(ghostSrc).not.toBe(table)
    const ghost = run([doc('README.md', ghostSrc)], { aliases })
    expect(state(ghost.rows, 'D6').ok).toBe(false)
    expect(state(ghost.rows, 'D6').detail).toContain('幽灵行')
    expect(state(ghost.rows, 'D6').detail).toContain('check:gone')
    const outside = run([doc('README.md', table + '\n| `npm run check:out` | out.mjs |')], { aliases })
    expect(state(outside.rows, 'D6').ok).toBe(true)
    const noblock = run([doc('README.md', '没有生成块')], { aliases })
    expect(state(noblock.rows, 'D6').ok).toBe(false)
  })

  it('syncGateTable 有锚点就插、有块就换、没锚点就拒（不硬塞）', () => {
    const t = '<!-- gate-table:begin -->\nX\n<!-- gate-table:end -->\n'
    expect(syncGateTable('## 功能一览\n内容', t).action).toBe('inserted')
    expect(syncGateTable('前\n' + t + '\n## 功能一览', t.replace('X', 'Y')).action).toBe('replaced')
    expect(syncGateTable('什么锚点都没有', t).action).toBe('no-anchor')
  })

  it('抽取只认 code-span：散文里的 npm run 不入面（否则"叙述"会被当指令判红）', () => {
    const got = extractCommands('我们常说 npm run verify:ok，但真正要跑的是 `npm run lint`')
    expect(got.length).toBe(1)
    expect(got[0].target).toBe('lint')
  })
})

describe('入口通道真跑（只 import 纯函数不算跑过入口）', () => {
  const cli = (args, env = {}) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 })
    return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
  }
  const f = (name, obj) => { const p = join(DIR, name); writeFileSync(p, JSON.stringify(obj), 'utf8'); return p }

  it('--fixture 喂一份不成立的命令 ⇒ rc=1 且 D2 红', () => {
    const BADE = [{ name: 'lint', cmd: 'oxlint' }]
    const p = f('bad.json', [{ path: 'README.md', src: renderGateTable(BADE) + '\n跑 `npm run nope-not-here`' }])
    const a = f('aliases.json', BADE)
    const { rc, out } = cli(['--fixture', p, '--aliases', a])
    expect(rc, out.slice(-500)).toBe(1)
    expect(out).toContain('GATE-FAIL')
    expect(out).toContain('nope-not-here')
  })

  it('--fixture 喂全绿面 ⇒ rc=0，门面行印 claim/template/archive 三个数', () => {
    const ALIAS = [{ name: 'verify:lint', cmd: 'node scripts/lint-wrap.mjs' }, { name: 'lint', cmd: 'oxlint' }]
    const p = f('good.json', [{ path: 'README.md', src: renderGateTable(ALIAS) + '\n跑 `npm run lint` 与 `npm run verify:lint`' }])
    const a = f('aliases.json', ALIAS)
    const { rc, out } = cli(['--fixture', p, '--aliases', a])
    expect(rc, out.slice(-500)).toBe(0)
    expect(out).toContain('GATE-PASS doc-commands')
  })

  it('--inject-red 演习 ⇒ rc=1，注入行带 INJECTED 可与真产物区分', () => {
    const GAL = [{ name: 'verify:lint', cmd: 'node scripts/lint-wrap.mjs' }]
    const p = f('inj.json', [{ path: 'README.md', src: renderGateTable(GAL) + '\n`npm run verify:lint`' }])
    const a = f('aliases.json', GAL)
    const { rc, out } = cli(['--fixture', p, '--aliases', a, '--inject-red'])
    expect(rc, out.slice(-500)).toBe(1)
    expect(out).toContain('INJECTED.md')
  })
})

/**
 * 第四十九轮 R49-H2：生成件里的 `counts` 到底是"现值"还是"快照"。
 * 一手事实（@2026-09-28 本机）：`docs/doc-commands.json` 记 mentions=196，而当场跑判据印 202 ——
 * 漂了 6 条却没有任何一条判据报错，因为**没有任何判据读 counts**。上一轮我据此否证了"加一条 D7 逼 --update 同步"，
 * 本轮把那个判断变成**会红的证据**：第 1 条钉措辞、第 2 条证"无消费者"、第 3 条防它 vacuous。
 */
describe('registry 的 counts 是快照不是现值（R49-H2）', () => {
  const face = [{ path: 'docs/old.md', exempt_until: '2099-01-01T00:00:00Z' }]
  const docsA = [doc('README.md', renderGateTable(AL) + '\n`npm run verify:ok`'), doc('docs/old.md', '死命令 `npm run predeploy` 只在归档面里')]
  const regWith = (over) => ({ archive_faces: face, observed_utc: '2026-09-28T00:00:00Z', ...over })
  const verdictOf = (res) => res.rows.map((r) => `${r.id}|${r.ok}|${r.detail}`).sort()

  it('registryBody 的 note 必须写明"as-of 快照 + 禁止当现值引用"，observed_utc 透传（防 --update 重写时丢字）', () => {
    const body = registryBody({ mentions: 1, claim: 1, broken: 0 }, face, '2026-09-28T00:00:00Z')
    expect(body.schema).toBe('chaoshi-doc-commands-v1')
    expect(body.note).toContain('as-of 快照')
    expect(body.note).toContain('禁止当现值用')
    expect(body.observed_utc).toBe('2026-09-28T00:00:00Z')
    expect(body.archive_faces).toEqual(face)
  })

  it('无消费者证明：垃圾 counts 不得改变 D1~D6 任何一项；D7 的 ok 同样不变，但 detail 必须点名漂移', () => {
    // R49 立这条时说的是"六条判定的 id/ok/detail 全不变"。第五十轮加了 D7 之后，`counts` **多了一个读者**，
    // 所以断言面要按事实改写：判定（ok）仍与 counts 无关，只有"报不报"变了 —— 这正是"只报不拦"的可证形式。
    const six = (reg) => run(docsA, { registry: reg }).rows.filter((r) => /^D[1-6]$/.test(r.id)).map((r) => `${r.id}|${r.ok}|${r.detail}`).sort()
    const junkCounts = { docs: 0, aliases: 0, mentions: 99999, claim: -1, template: 'x', archive: null, broken: 42 }
    expect(six(regWith({ counts: junkCounts }))).toEqual(six(regWith({})))
    const clean = run(docsA, { registry: regWith({}) }).rows.find((r) => r.id === 'D7')
    const dirty = run(docsA, { registry: regWith({ counts: junkCounts }) }).rows.find((r) => r.id === 'D7')
    expect(dirty.ok, '登记册漂了不许把 D7 判红（零消费者的生成件不拦路；要拦请用 --check）').toBe(clean.ok)
    expect(dirty.detail).toContain('mentions 册上 99999 → 现算')
  })

  it('对偶（防上一条空转）：同一 registry 只改 observed_utc 让归档面到期 ⇒ 判定必须变（registry 确实被读，只是 counts 不被读）', () => {
    const live = run(docsA, { registry: regWith({}) })
    const expired = run(docsA, { registry: regWith({ observed_utc: '2099-02-01T00:00:00Z' }) })
    expect(verdictOf(live)).not.toEqual(verdictOf(expired))
    expect(state(expired.rows, 'D2').ok).not.toBe(true)
    expect(state(expired.rows, 'D2').detail).toContain('不成立 1 条')
    expect(state(expired.rows, 'D4').detail).toContain('已过期仍挂着')
  })
})

/**
 * 第四十九轮 R49-H2 的第二条：`--update` 生成的 README 块**必须幂等**。
 * 一手测量（@2026-09-28 本机）：连跑三次 `--update` ⇒ README 三个不同 sha，
 * `<!-- gate-table:end -->` 与 `## 功能一览` 之间的空行从 4 涨到 7。根因在字符串层：
 * `renderGateTable()` 返回值自带尾换行，而写回又加一个 `'\n'`、正则只吃一个 ⇒ 每次净增一行。
 * D6 判的是**内容**（缺行/幽灵行），空行漂移它看不见 ⇒ 幂等性必须由本夹具钉住。
 */
describe('README 生成块幂等（R49-H2）', () => {
  const table = renderGateTable(AL)
  const src = `# t\n\n<!-- gate-table:begin -->\n旧块\n<!-- gate-table:end -->\n\n\n## 功能一览\n\n正文\n`
  const gaps = (s) => /\n*/.exec(s.slice(s.indexOf('<!-- gate-table:end -->') + '<!-- gate-table:end -->'.length))[0].length

  it('正向：连写两次必须逐字节相同，且块后的空行数一格不多不少', () => {
    const once = syncGateTable(src, table).src
    const twice = syncGateTable(once, table).src
    expect(twice).toBe(once)
    expect(gaps(once)).toBe(gaps(twice))
    expect(gaps(once), '尾换行归一后应恰好留一个换行再接原空行').toBeLessThanOrEqual(3)
  })

  it('反向自证（夹具自己要有牙齿）：按缺陷写法 table + 换行 再跑一次 ⇒ 必须真的多出一行', () => {
    const buggy = (s) => s.replace(/<!-- gate-table:begin -->[\s\S]*?<!-- gate-table:end -->\n?/, table + '\n' + '\n')
    const one = buggy(src)
    expect(gaps(one)).toBeGreaterThan(gaps(src))
    expect(gaps(buggy(one))).toBeGreaterThan(gaps(one))
    expect(gaps(twiceOf(syncGateTable)(src, table))).toBe(gaps(src))
  })
})

/** 用被测函数本身做一次幂等复跑，给上一条反向自证当对照组。 */
function twiceOf(fn) {
  return (s, t) => fn(fn(s, t).src, t).src
}

/**
 * D7 / `--check`（第五十轮 R50-H3）：**写侧要有读侧**。
 * 上游形状三处对照（本轮 gh api 取原文）：`django/django` `makemigrations --check`
 * （help："Exit with a non-zero status if model changes are missing migrations and don't actually write them.
 * Implies --dry-run."，实现 `:117-119` 置 dry_run、`:263-264` `if check_changes: sys.exit(1)`）；
 * `sqlalchemy/alembic` 干脆把 `check` 做成独立命令（`alembic/command.py:320`，diff 非空抛
 * `AutogenerateDiffsDetected` 并把 diffs 印进消息）；`eslint/eslint` 的 `--fix-dry-run`（`lib/options.js:34`）。
 * 分工要说清：README 那块**有读者**（它就是给人看的门禁表）⇒ 逐字节相等进 ok；
 * 登记册零消费者 ⇒ 只报不拦（第四十九轮已实测否证"逼每次改动都补一笔重生提交"那条闸的形状），
 * 要连它一起判 ⇒ 显式 `--check`。
 */
describe('D7 生成块逐字节 + --check 读侧（写侧的读侧）', () => {
  const AL2 = [{ name: 'verify:a', cmd: 'node scripts/a.mjs' }, { name: 'check:b', cmd: 'node scripts/b.mjs' }]
  const tableOf = (aliases) => renderGateTable(aliases)
  const readmeWith = (aliases) => {
    const head = '# x\n\n## 功能一览\n\n正文\n'
    return doc('README.md', syncGateTable(head, tableOf(aliases)).src)
  }
  const d7 = (rows) => rows.find((r) => r.id === 'D7')
  const regFor = (docs, aliases) => {
    const { counts } = evaluate({ docs, aliases, fileExists: () => true, registry: { archive_faces: [], counts: {}, note: '', schema: 'x' } })
    return registryBody(counts, [])
  }

  it('正例：README 就是生成器现在会写出的那块 ⇒ D7 绿且印"逐字节相等"', () => {
    const docs = [readmeWith(AL2)]
    const reg = regFor(docs, AL2)
    const { rows } = evaluate({ docs, aliases: AL2, fileExists: () => true, registry: reg })
    const r = d7(rows)
    expect(r.ok, r.detail).toBe(true)
    expect(r.detail).toContain('逐字节相等')
    expect(r.detail).toContain('counts/note 与生成器输出一致')
  })

  it('反例：手改一个字符（多一个空格）⇒ D7 判红并点名跑哪条命令重生（内容对得上、字节对不上，正是 D6 看不见的那半）', () => {
    const clean = readmeWith(AL2)
    const tampered = doc('README.md', clean.src.replace('| `npm run verify:a` |', '| `npm run verify:a`  |'))
    expect(tampered.src).not.toBe(clean.src)
    const { rows } = evaluate({ docs: [tampered], aliases: AL2, fileExists: () => true, registry: REG })
    const r = d7(rows)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('漂了')
    expect(r.detail).toContain('check-doc-commands.mjs --update')
  })

  it('反例：README 缺席 / 锚点丢失 ⇒ 两种形状分别点名，不得与"已同步"同形', () => {
    const noReadme = d7(evaluate({ docs: [doc('SECURITY.md', 'x')], aliases: AL2, fileExists: () => true, registry: REG }).rows)
    expect(noReadme.ok).toBe(false)
    expect(noReadme.detail).toContain('没有 README.md')
    const noAnchor = d7(evaluate({ docs: [doc('README.md', '# 只有标题\n')], aliases: AL2, fileExists: () => true, registry: REG }).rows)
    expect(noAnchor.ok).toBe(false)
    expect(noAnchor.detail).toContain('无处可插')
  })

  it('登记册漂移：counts 少一条 ⇒ 只在 detail 里点名到子键，**不**翻转 D7 的 ok（零消费者的生成件不拦路）', () => {
    const docs = [readmeWith(AL2)]
    const reg = regFor(docs, AL2)
    const stale = { ...reg, counts: { ...reg.counts, mentions: reg.counts.mentions - 2 } }
    const r = d7(evaluate({ docs, aliases: AL2, fileExists: () => true, registry: stale }).rows)
    expect(r.ok, 'README 没漂 ⇒ 登记册那一半只报不拦').toBe(true)
    expect(r.detail).toContain('counts{mentions 册上')
    expect(r.detail).toContain('现算')
  })

  it('真入口回执：`--check` 对真面跑 ⇒ rc=0 且两个生成物都报一致；与 `--update` 同时给必须 rc=2', () => {
    const cli = (args) => {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
      return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
    }
    const ok = cli(['--check'])
    expect(ok.rc, ok.out.slice(-600)).toBe(0)
    expect(ok.out).toContain('--check OK 两个生成物都等于生成器输出')
    const both = cli(['--check', '--update'])
    expect(both.rc, both.out.slice(-400)).toBe(2)
    expect(both.out).toContain('互斥')
  })

  it('变异体：把 D7 的逐字节比较恒置 false ⇒ 同一份手改 README 必须被读成绿（证明红因真是那次比较）', async () => {
    const clean = readmeWith(AL2)
    const tampered = [doc('README.md', clean.src.replace('| `npm run verify:a` |', '| `npm run verify:a`  |'))]
    const before = d7(evaluate({ docs: tampered, aliases: AL2, fileExists: () => true, registry: REG }).rows)
    expect(before.ok, '对照组：未变异时必须判红').toBe(false)
    const dir = mkdtempSync(join(tmpdir(), 'dcom-mut-'))
    const local = copyGateScripts(ROOT, dir, 'check-doc-commands.mjs')
    const p = join(local, 'check-doc-commands.mjs')
    const src = readFileSync(p, 'utf8')
    const mutated = src.replace(
      'const drifted = !!readme && synced.src !== null && synced.src !== readme.src',
      'const drifted = false')
    expect(mutated, '变异锚点已失效（脚本改形，夹具必须同步）').not.toBe(src)
    writeFileSync(p, mutated, 'utf8')
    const mod = await import(pathToFileURL(p).href)
    const after = mod.evaluate({ docs: tampered, aliases: AL2, fileExists: () => true, registry: REG }).rows.find((r) => r.id === 'D7')
    expect(after.ok, '摘掉比较后仍判红 ⇒ 这条腿没打在被告分支上（红因来自别处）').toBe(true)
    expect(after.detail).toContain('逐字节相等')
    rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * 取数面必须与机器无关（第五十轮：本机全绿、CI 判红的一手根因）。
 * 读数：本机 `mentions=205`，CI（Linux/LF）同一份提交算出 **224**，差 19 条。
 * 机制：`CODE_SPAN_RE` 的围栏分支要求代码块标签后紧跟 LF；本机 `core.autocrlf=true` 的检出是 CRLF
 * ⇒ **整块围栏代码里的命令主张在 Windows 侧从来不可见**（不是 CI 多事，是本机长期漏判 19 条）。
 * 正解：读来判的那一侧归一行尾（`collectDocs` 内的 `normalizeEol`），写回的那一侧保持文件原有形态（见 main 的 eol 分支）。
 */
describe('行尾不得改变判定（本机 205 / CI 224 那次红的根因面）', () => {
  const LF = String.fromCharCode(10)
  const CRLF = String.fromCharCode(13, 10)
  it('同一段围栏命令：CRLF 原文抽不到（旧漏判面），归一后抽得到', () => {
    const md = ['标题', '', '```bash', 'npm run verify:docs', '```', ''].join(LF)
    const crlf = md.split(LF).join(CRLF)
    expect(extractCommands(crlf).map((c) => c.target)).not.toContain('verify:docs')
    expect(extractCommands(normalizeEol(crlf)).map((c) => c.target)).toContain('verify:docs')
  })

  it('真面取数已经是 LF（一个 CR 都不许留），且台账 counts 等于当场重算的值', () => {
    const docs = collectDocs()
    expect(docs.length).toBeGreaterThan(20)
    expect(docs.filter((d) => d.src.includes(String.fromCharCode(13))).length, 'collectDocs 没归一行尾 ⇒ 台账又是机器相关的量').toBe(0)
    const mentions = docs.reduce((n, d) => n + extractCommands(d.src).length, 0)
    const reg = JSON.parse(readFileSync(join(ROOT, 'docs', 'doc-commands.json'), 'utf8'))
    expect(mentions, '册上 counts 与当场重算不符 ⇒ --update 没跑或判据又变成机器相关').toBe(reg.counts.mentions)
  })
})
