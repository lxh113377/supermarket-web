// 第四十三轮夹具①：**文档里印的命令有没有跟现实对过账**（D1~D6）。
// 立它的读数（本机实测 @2026-09-28）：durable 文档里 code-span 命令 **90 条提及、3 条不成立**
// （`docs/implementation-plan-2026-08-08.md:11/113/223` 的 `npm run predeploy` = CloudBase 时代死命令），
// 另有 1 条 `node scripts/X.mjs` 是**用法骨架占位符**、1 条在册门禁别名先前无人提及。
// 难点不是抓到，而是**不把历史与模板误判成缺陷** ⇒ 本文件对三类面各钉一条方向相反的断言。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, extractCommands, collectDocs, readAliases, renderGateTable, syncGateTable } from '../scripts/check-doc-commands.mjs'

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
