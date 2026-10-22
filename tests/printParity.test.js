// 第二十八轮：打印页 ⇄ 上游仓库（CampusPrint-V1）一致性判据的常驻夹具。
// 分工：静态规则与入口三态在这里测；真面的逐字节对账由 CI 的 checkout + `npm run verify:print` 跑。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, normSha, readSources, REGISTRY_REL } from '../scripts/print-parity.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'print-parity.mjs')
const cli = (args) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000 }), { label: 'print-parity ' + args.join(' ') })

const reg = { sourceVersion: '1.4.0', sourceCommit: 'a'.repeat(40), syncedUtc: '2026-10-22T00:00:00.000Z' }
const NOW = Date.parse(reg.syncedUtc)

describe('print-parity：静态判定核（合成面，逐腿双向）', () => {
  it('判据自证 8/8（正例 + 缺件/多件/漂移/版本/登记/龄期/空集七条反例各自点名）', () => {
    const r = cli(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('[print-parity] selftest 8/8')
  })

  it('真面：本站打印页静态面与上游逐文件一致（P1）+ 三处版本同值（P3）⇒ rc=0', () => {
    const s = readSources()
    expect(s.missing, '取数面缺失就是环境坏了，先修链路不许跳：' + s.missing).toBeUndefined()
    const r = evaluate({ ...s, now: Date.parse(s.registry.syncedUtc) })
    expect(r.rc, JSON.stringify(r.rows.filter((x) => !x.ok))).toBe(0)
    expect(r.compared, 'P1 的分母 = 上游 frontend/{shared,user} + print/index.html 的文件数').toBeGreaterThanOrEqual(20)
  })

  it('P2 缺 syncedUtc ⇒ 只 P2 红（P4 是 advisory：算不出龄期也只印不拦）', () => {
    const base = { 'shared/a.js': 'x' }
    const v = evaluate({ expected: base, actual: base, registry: { sourceVersion: '1.4.0', sourceCommit: 'a'.repeat(40) }, upstreamVersion: '1.4.0', buildConst: '1.4.0', now: NOW })
    expect(v.rows.filter((x) => !x.ok).map((x) => x.id).sort()).toEqual(['P2'])
    expect(v.rows.find((x) => x.id === 'P4').detail, '龄期算不出时要说清是谁拦的').toContain('P2 已拦')
  })

  it('P4 不随日历变红（一手坑复发防护：第 31 天那种「没人改动却到点红」只能靠刷时间戳消）', () => {
    const base = { 'shared/a.js': 'x' }
    const stale = { ...reg, syncedUtc: new Date(Date.now() - 31 * 86400000).toISOString() }
    const v = evaluate({ expected: base, actual: base, registry: stale, upstreamVersion: '1.4.0', buildConst: '1.4.0', now: Date.now() })
    expect(v.rc, '龄期超阈不得让 rc 变红').toBe(0)
    expect(v.rows.find((x) => x.id === 'P4').warn, '超阈仍要印出来（只报不拦≠不报）').toBe(true)
  })

  it('P3 反向：产物常量漂了也要红（三处任意两处不等都拦）', () => {
    const base = { 'shared/a.js': 'x' }
    const v = evaluate({ expected: base, actual: base, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.3.0', now: NOW })
    const p3 = v.rows.find((x) => x.id === 'P3')
    expect(p3.ok, p3.detail).toBe(false)
    expect(p3.detail).toContain('CAMPUS_PRINT_BUILD')
  })

  it('尺的口径：CRLF 与 LF 同哈希（vendored 只做过行尾归一，判据必须同尺）', () => {
    const a = normSha(Buffer.from('line1\r\nline2\n', 'utf8'))
    const b = normSha(Buffer.from('line1\nline2\n', 'utf8'))
    expect(a).toBe(b)
    expect(normSha(Buffer.from('line1\nlineX\n', 'utf8'))).not.toBe(a)
  })
})

describe('print-parity：入口三态（子进程真跑，不看 stdout 好看）', () => {
  it('--json 出结构且四行在册（CI 消费面）', () => {
    const r = cli(['--json'])
    expect([0, 1, 2], r.stdout + r.stderr).toContain(r.status)
    if (r.status === 0) {
      const j = JSON.parse(r.stdout)
      expect(j.rows.map((x) => x.id).sort()).toEqual(['P1', 'P2', 'P3', 'P4'])
      expect(j.compared).toBeGreaterThan(0)
    }
  })

  it('取数面缺失（--src 指向空目录）⇒ rc=2 且印 UNVERIFIED，绝不印 GREEN', () => {
    const d = mkdtempSync(join(tmpdir(), 'cpp-miss-'))
    try {
      const r = cli(['--src', d, '--json'])
      expect(r.status).toBe(2)
      expect(r.stderr + r.stdout).toContain('UNVERIFIED')
      expect(r.stdout).not.toContain('GREEN')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })

  it('端到端正向：合成权威源 + 落地一致 ⇒ P1 绿且分母=2', () => {
    const d = mkdtempSync(join(tmpdir(), 'cpp-ok-'))
    try {
      mkdirSync(join(d, 'shared'), { recursive: true })
      mkdirSync(join(d, 'user'), { recursive: true })
      writeFileSync(join(d, 'shared', 'a.js'), 'A\n', 'utf8')
      writeFileSync(join(d, 'user', 'index.html'), 'B\n', 'utf8')
      const s = readSources(d)
      expect(s.missing).toBeUndefined()
      const r = evaluate({ ...s, expected: { 'shared/a.js': 'x', 'user/index.html': 'y' }, actual: { 'shared/a.js': 'x', 'user/index.html': 'y' }, registry: reg, upstreamVersion: '1.4.0', buildConst: '1.4.0', now: NOW })
      expect(r.rows.find((x) => x.id === 'P1').ok).toBe(true)
      expect(r.compared).toBe(2)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})

describe('登记册：docs/campus-print.json 是真在册的', () => {
  it('文件在盘面且字段够判据消费（漏登记 = CI 当场红，这条是本仓本地先验）', () => {
    const s = readSources()
    if (s.missing) return // 本机没有上游 ⇒ 这条在 CI 上跑（checkout step 保证那边有）
    expect(s.registry, REGISTRY_REL + ' 读不到').not.toBeNull()
    expect(s.registry.source).toBe('k01055119509-lang/CampusPrint-V1')
    expect(s.registry.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
  })
})
