// 第七十六轮：治理登记册判据（scripts/check-governance-framework.mjs）的常驻夹具。
// 为什么要有它：这道闸的取数面是**一个登记册 + 五份人读文档**，纯函数判据只在 --selftest 里跑，
// 就永远碰不到 CLI（读文件、三态退出码、判红时点名到键）。本仓第二十四轮一手教训：只 import 纯函数不算覆盖。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, collectRegistryIds, sourcePathsOf, DOC_FILES, DOC_DIR } from '../scripts/check-governance-framework.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-governance-framework.mjs')
const tmpDirs = []
const mkTmp = (tag) => { const d = mkdtempSync(join(tmpdir(), 'gov-' + tag + '-')); tmpDirs.push(d); return d }
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

function run(args, opts = {}) {
  return assertCliRan(spawnSync(process.execPath, args, Object.assign({
    cwd: opts.cwd || REPO, encoding: 'utf8', timeout: 60_000,
  }, opts.spawn || {})), { label: 'governance-framework ' + args.slice(1).join(' ') })
}

describe('治理登记册判据：入口真跑（三态 + 点名）', () => {
  it('--selftest：正例/违规/边界/两条方向相反的变异腿齐全，且 N==M', () => {
    const r = run([SELF, '--selftest'])
    expect(r.status, r.stderr).toBe(0)
    const m = /selftest: (\d+)\/(\d+)/.exec(r.stdout)
    expect(m, '没打出 N/M 自证行 ⇒ 自证腿不可核').not.toBeNull()
    expect(Number(m[1]), '自证腿未全过').toBe(Number(m[2]))
    expect(Number(m[2])).toBeGreaterThanOrEqual(10)
  })

  it('真仓默认面：跑到判据本身（rc 0/1/2 皆可，但 rc=2 必须点名是哪条未验）且印出结果行', () => {
    const r = run([SELF])
    expect([0, 1, 2], `真仓取数面应可读；rc=${r.status} 既不是绿/红也不是未验：${r.stderr}`).toContain(r.status)
    expect(r.stdout).toContain('[governance-framework]')
    expect(/结果: \d+ 通过 \/ \d+ 失败 \/ \d+ 未验/.test(r.stdout), '缺门面结果行（分母必须印出来）').toBe(true)
    // CI 检出（无外层仓、无 git 历史）上 F2/F10 会 legitimately UNVERIFIED ⇒ rc=2。
    // 这里要守的不是「恒绿」，而是「未验不许沉默」：rc=2 时必须至少有一行 UNVERIFIED 且点名腿号。
    if (r.status === 2) {
      const unv = r.stdout.split('\n').filter((l) => l.startsWith('UNVERIFIED'))
      expect(unv.length, `rc=2 却没有一行 UNVERIFIED ⇒ 未验被沉默：${r.stdout.slice(-400)}`).toBeGreaterThan(0)
      expect(unv.join('\n')).toMatch(/F\d+/)
    }
  })

  it('零输入面：取数面缺失 ⇒ rc=2 且首行是自家诊断（不是裸栈）', () => {
    const empty = mkTmp('empty')
    writeFileSync(join(empty, 'package.json'), '{"name":"x","scripts":{}}')
    const r = run([SELF, '--fixture', empty])
    expect(r.status, '缺输入却非 2 ⇒ 把"没对象"读成了结论').toBe(2)
    const first = String(r.stdout || r.stderr).split(/\r?\n/).find(Boolean) || ''
    expect(first, '首行不是自家诊断：' + first).toContain('[governance-framework]')
    expect(String(r.stderr)).not.toMatch(/node:internal|\bat Object\./)
  })

  it('变异体 M1：把登记值改错 ⇒ rc=1 且点名到键（证明红来自对账而非恒真）', () => {
    const dir = mkTmp('drift')
    for (const f of ['package.json', 'docs', 'db', 'memory', 'scripts', '.ci', '.github']) {
      cpSync(join(REPO, f), join(dir, f), { recursive: true })
    }
    const regPath = join(dir, DOC_DIR, 'registry.json')
    const reg = JSON.parse(readFileSync(regPath, 'utf8'))
    reg.facts.contractActions.web = 999
    writeFileSync(regPath, JSON.stringify(reg, null, 2))
    const r = run([SELF, '--fixture', dir])
    expect(r.status, '篡改登记值却未判红').toBe(1)
    expect(r.stdout, '判红必须点名到键与两侧值').toContain('contractActions.web')
    expect(r.stdout).toMatch(/册 999 ⇄ 实测 35/)
  })

  it('变异体 M2：文档面清空 ⇒ rc=1（零引用/零字节两腿同时点名）', () => {
    const dir = mkTmp('nodoc')
    for (const f of ['package.json', 'docs', 'db', 'memory', 'scripts', '.ci', '.github']) {
      cpSync(join(REPO, f), join(dir, f), { recursive: true })
    }
    for (const f of DOC_FILES) { mkdirSync(join(dir, DOC_DIR), { recursive: true }); writeFileSync(join(dir, DOC_DIR, f), '') }
    const r = run([SELF, '--fixture', dir])
    expect(r.status, '人读文档全空却没有红').toBe(1)
    expect(r.stdout).toContain('0 字节')
  })

  it('纯函数：幽灵引用与核心 id 零引用是两个方向的红（反向腿）', () => {
    const reg = { facts: { a: { v: 1 } }, volume: { indicators: [] }, linkage: { joinKey: { id: 'ld-join-key', definition: '<endpoint>::<action>' }, rules: [] }, lifecycle: { nodes: [{ id: 'lc-x' }] } }
    const ids = collectRegistryIds(reg)
    const base = { registry: reg, facts: { a: { v: 1 } }, docs: [], registryIds: ids, docRefs: [], sources: [{ path: 'package.json', bytes: 1 }], quotedPaths: [] }
    expect(evaluate(base).rows.find((x) => x.id === 'F3').pass, '合成面零引用却记绿').toBe(false)
    const ok = Object.assign({}, base, { docRefs: ids })
    expect(evaluate(ok).rows.find((x) => x.id === 'F3').pass).toBe(true)
    const phantom = Object.assign({}, base, { docRefs: ids.concat(['lc-not-real']) })
    expect(evaluate(phantom).rows.find((x) => x.id === 'F3').pass, '幽灵引用却记绿').toBe(false)
  })

  it('F10/F11/F12 纯函数：三腿各自都有"红"和"方向相反"的一条（不许恒真也不许恒红）', () => {
    const reg = {
      facts: { a: { v: 1 } },
      volume: { consumers: [{ id: 'op-x', path: 'scripts/x.mjs', states: ['FAIL', 'PASS', 'UNVERIFIED'], noLineStates: ['UNVERIFIED'] }], indicators: [] },
      linkage: { joinKey: { id: 'ld-join-key', definition: '<endpoint>::<action>' }, rules: [] },
    }
    const ids = collectRegistryIds(reg)
    const base = {
      registry: reg, facts: { a: { v: 1 } }, docs: [{ path: 'docs/governance/README.md', text: 'x', bytes: 1 }],
      registryIds: ids, docRefs: ids, sources: [{ path: 'package.json', bytes: 1 }], quotedPaths: [],
      linkage: {
        contractDelta: { state: 'ok', baseSha: 'x', newActions: [], raised: [] },
        quota: { dailyRows: 100000, callsPerDayAtPeak: 100, peakRowsWritten: 5, remainingPct: 99.5, red: false },
        addedRows: 0, treeClean: true,
      },
      consumerSrc: { 'op-x': '// @consumer-states: FAIL,PASS,UNVERIFIED\n// @consumer-no-line: 不得读成通过\n' },
      copiedValues: [],
    }
    const row = (ctx, id) => evaluate(ctx).rows.find((r) => r.id === id)
    // F10：正例绿 / 双侧命中红 / 基线取不到 ⇒ 未验（不是绿也不是红）
    expect(row(base, 'F10').pass, 'F10 正例应绿').toBe(true)
    const both = Object.assign({}, base, { linkage: Object.assign({}, base.linkage, { contractDelta: { state: 'ok', baseSha: 'x', newActions: ['A:new'], raised: [] }, quota: Object.assign({}, base.linkage.quota, { red: true, remainingPct: 0.019 }), addedRows: 21 }) })
    expect(row(both, 'F10').pass, 'F10 双侧命中应红').toBe(false)
    const nobase = Object.assign({}, base, { linkage: Object.assign({}, base.linkage, { contractDelta: { state: 'unavailable', why: '合成' } }) })
    expect(row(nobase, 'F10').pass, 'F10 基线取不到不得记绿').toBe(null)
    // F11：抄错红 / 抄对绿
    expect(row(Object.assign({}, base, { copiedValues: [{ doc: 'd.md', line: 1, label: 'verify 段数', value: 42, actual: 43 }] }), 'F11').pass).toBe(false)
    expect(row(Object.assign({}, base, { copiedValues: [{ doc: 'd.md', line: 1, label: 'verify 段数', value: 43, actual: 43 }] }), 'F11').pass).toBe(true)
    // F12：缺自声明红 / 状态集不符红 / 正例绿
    expect(row(Object.assign({}, base, { consumerSrc: { 'op-x': '// 无声明\n' } }), 'F12').pass).toBe(false)
    expect(row(Object.assign({}, base, { consumerSrc: { 'op-x': '// @consumer-states: GREEN,RED\n// @consumer-no-line: 不得读成通过\n' } }), 'F12').pass).toBe(false)
    expect(row(base, 'F12').pass).toBe(true)
  })

  it('纯函数：册内源路径抽取不漏（sourcePathsOf 至少含 package.json）', () => {
    const reg = JSON.parse(readFileSync(join(REPO, DOC_DIR, 'registry.json'), 'utf8'))
    const paths = sourcePathsOf(reg)
    expect(paths.length).toBeGreaterThanOrEqual(5)
    // 抽的是**登记册里以 path 字段登记的源件**（facts 里的 source 是字符串，不属这一面）
    expect(paths.some((p) => p.includes('item-budgets'))).toBe(true)
    expect(paths.some((p) => p === 'db/seed.sql')).toBe(true)
    expect(paths.every((p) => /\.(json|md|js|mjs|sql|yml)$/.test(p))).toBe(true)
  })
})
