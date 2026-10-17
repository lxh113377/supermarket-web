// 第七十五轮 I-75-4：供应链清单（SBOM）判据的常驻夹具。
// 重点不在"文件在不在"，而在两件会被时间慢慢侵蚀的事：**清单与依赖面是否同步**、**清单是否过期**。
// 所以每条腿都成对：正向（同步 ⇒ 绿）+ 反向（漂/过期 ⇒ 红），再补一条"取不到当次面"的退化腿。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, componentKeys, diffKeys, ageDaysOf, isPlatformSpecific, MAX_AGE_DAYS } from '../scripts/check-sbom.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-sbom.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 清理失败不改结论 */ } } })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'smsbom-')); tmpDirs.push(d); return d }
const cli = (args) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000 }), { label: 'sbom ' + args.join(' ') })
const mk = (keys, ts = '2026-10-17T00:00:00Z') => ({ bomFormat: 'CycloneDX', metadata: { timestamp: ts }, components: keys.map((k) => ({ name: k.split('@')[0], version: (k.split('@')[1] || '0'), purl: k })) })
const A = mk(['pkg:npm/react@19.0.0', 'pkg:npm/vite@8.0.0'])

describe('SBOM 可复现登记：清单必须与依赖面同步，且不能过期', () => {
  it('判据自证 10/10（含三条反向腿、一条退化腿、两条跨平台腿）', () => {
    const r = cli(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('[sbom] 自证 10/10')
  })

  it('真面：仓库里的 docs/sbom.cdx.json 必须与当次依赖面逐项一致且未过期', () => {
    const r = cli([])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GATE-PASS')
    expect(r.stdout).toContain('只在当次 0');
    expect(r.stdout).toContain('只在册 0');
  })

  it('入口真跑（注入腿）：在册件少一项 ⇒ rc=1 且点名那一项（不调 npm 的合成面对账）', () => {
    const d = tmp()
    const file = join(d, 'sbom.cdx.json')
    const expected = join(d, 'expected.json')
    writeFileSync(file, JSON.stringify(mk(['pkg:npm/react@19.0.0'])), 'utf8')
    writeFileSync(expected, JSON.stringify(A), 'utf8')
    const r = cli(['--file', file, '--expected', expected])
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toContain('GATE-FAIL')
    expect(r.stdout).toContain('vite');
  })

  it('对偶（注入腿）：同一对文件把在册件补全 ⇒ 同一条腿必须翻绿', () => {
    const d = tmp()
    const file = join(d, 'sbom.cdx.json')
    const expected = join(d, 'expected.json')
    writeFileSync(file, JSON.stringify(A), 'utf8')
    writeFileSync(expected, JSON.stringify(A), 'utf8')
    expect(cli(['--file', file, '--expected', expected]).status).toBe(0)
  })

  it('零输入：--expected 不是合法 JSON ⇒ rc=2（取数面坏了不判绿）', () => {
    const d = tmp()
    const file = join(d, 'sbom.cdx.json')
    writeFileSync(file, JSON.stringify(A), 'utf8')
    const bad = join(d, 'bad.json')
    writeFileSync(bad, '{not json', 'utf8')
    const r = cli(['--file', file, '--expected', bad])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('BLOCKED')
  })

  it('纯函数：componentKeys 用 purl 作身份（bom-ref 在 npm 版本间变格式，拿它当身份会把升级误报成依赖变更）', () => {
    const j = { components: [
      { name: 'react', version: '19.0.0', purl: 'pkg:npm/react@19.0.0' },
      { name: 'no-purl', version: '1.2.3' },
    ] }
    expect(componentKeys(j)).toEqual(['no-purl@1.2.3', 'pkg:npm/react@19.0.0'])
  })

  it('纯函数：diffKeys 双向（少了/多了都要点名），且 same 只数交集', () => {
    const d = diffKeys(['a', 'b'], ['b', 'c']);
    expect(d.onlyInFile).toEqual(['a']);
    expect(d.onlyInFresh).toEqual(['c']);
    expect(d.same).toBe(1);
  })

  it('纯函数：ageDaysOf 解不出时刻返回 null（不折算成 0 天）', () => {
    expect(ageDaysOf('not-a-date', '2026-10-17T00:00:00Z')).toBe(null)
    expect(ageDaysOf('2026-10-17T00:00:00Z', '2026-10-20T00:00:00Z')).toBe(3)
  })

  it('跨平台同一性：平台专属二进制两侧同时剥（否则 CI 的 ubuntu 与本机 Windows 必红）', () => {
    // 一手：CI 第一次跑就红在 13 进 7 出，全是 @esbuild//@rollup//sharp 的 win32 vs linux 变体
    expect(isPlatformSpecific('pkg:npm/%40esbuild/win32-x64@0.28.1')).toBe(true)
    expect(isPlatformSpecific('pkg:npm/%40esbuild/linux-x64@0.28.1')).toBe(true)
    expect(isPlatformSpecific('pkg:npm/react@19.0.0')).toBe(false)
    const win = { bomFormat: 'CycloneDX', metadata: { timestamp: '2026-10-17T00:00:00Z' }, components: [
      { name: 'react', version: '19.0.0', purl: 'pkg:npm/react@19.0.0' },
      { name: '%40esbuild/win32-x64', version: '0.28.1', purl: 'pkg:npm/%40esbuild/win32-x64@0.28.1' },
    ] }
    const linux = { bomFormat: 'CycloneDX', metadata: { timestamp: '2026-10-17T00:00:00Z' }, components: [
      { name: 'react', version: '19.0.0', purl: 'pkg:npm/react@19.0.0' },
      { name: '%40esbuild/linux-x64', version: '0.28.1', purl: 'pkg:npm/%40esbuild/linux-x64@0.28.1' },
    ] }
    const r = evaluate({ file: win, fresh: linux, nowIso: '2026-10-17T12:00:00Z' })
    expect(r.rc, r.problems.join(' | ')).toBe(0)
    expect(r.check.components).toBe(1)
  })

  it('变异体：把"同步"那一腿摘掉（只比文件名不比组件集）⇒ 注入腿必须翻红', () => {
    // 不可逆注入：直接喂两个组件集不同的对象，判据必须判红。若它只比 bomFormat 就会绿 ——
    // 这正是「清单在，但说的是旧依赖」这类假账的形状。
    const r = evaluate({ file: mk(['pkg:npm/left@1.0.0']), fresh: mk(['pkg:npm/right@1.0.0']), nowIso: '2026-10-17T12:00:00Z' })
    expect(r.rc).toBe(1)
    expect(r.problems.join('\n')).toContain('left')
    expect(r.problems.join('\n')).toContain('right')
    expect(MAX_AGE_DAYS).toBeGreaterThan(0)
  })
})
