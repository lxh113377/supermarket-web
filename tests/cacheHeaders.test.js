// 第七十五轮 I-75-3：缓存声明面判据的常驻夹具。
// 为什么单独有它：这道闸的取数面是一个**配置文件**，纯函数判据若只在自证里跑，
// 就永远碰不到 CLI（读文件、rc 三态、--json）。本仓第二十四轮一手教训：只 import 纯函数不算覆盖。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, parseHeaders, REQUIRED } from '../scripts/check-cache-headers.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-cache-headers.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 清理失败不改结论 */ } } })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'smch-')); tmpDirs.push(d); return d }
const cli = (args) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'cache-headers ' + args.join(' ') })

const GOOD = [
  '/*', '  X-Frame-Options: DENY',
  '/assets/*', '  Cache-Control: public, max-age=31536000, immutable',
  '/images/*', '  Cache-Control: public, max-age=600, stale-while-revalidate=86400',
  '/sw.js', '  Cache-Control: public, max-age=0, must-revalidate',
  '/index.html', '  Cache-Control: public, max-age=0, must-revalidate',
].join('\n')

describe('静态资源缓存语义判据：/assets/* 该长缓存、/images/* 绝不许长缓存', () => {
  it('真面：仓库里的 public/_headers 必须过（这是运行时的真相源）', () => {
    const r = cli([])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GATE-PASS');
    for (const req of REQUIRED) expect(r.stdout).toContain(req.pattern)
  })

  it('零输入：声明面缺失 ⇒ rc=2 且不许印 GATE-PASS（没有对象 ≠ 缓存语义正确）', () => {
    const r = cli(['--file', join(tmp(), 'nope', '_headers')])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('UNVERIFIED')
    expect(r.stdout).not.toContain('GATE-PASS')
  })

  it('入口真跑：把改前形态（/assets/* max-age=0）喂进去 ⇒ rc=1 且点名', () => {
    const d = tmp()
    const f = join(d, '_headers')
    writeFileSync(f, GOOD.replace('max-age=31536000, immutable', 'max-age=0, must-revalidate'), 'utf8')
    const r = cli(['--file', f])
    expect(r.status, r.stdout).toBe(1)
    expect(r.stdout).toContain('GATE-FAIL')
    expect(r.stdout).toContain('/assets/*')
  })

  it('对偶：同一份文件把 /assets/* 改回长缓存 ⇒ 同一条腿必须翻绿（证明上一条不是写死的红）', () => {
    const d = tmp()
    const f = join(d, '_headers')
    writeFileSync(f, GOOD, 'utf8')
    expect(cli(['--file', f]).status).toBe(0)
  })

  it('--json 腿：机器可读输出里 checks 与 problems 都要在（远程/CI 消费面）', () => {
    const r = cli(['--json'])
    expect(r.status).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(Array.isArray(j.checks)).toBe(true)
    expect(Array.isArray(j.problems)).toBe(true)
    expect(j.checks.length).toBe(REQUIRED.length)
  })

  it('解析器（纯函数）：重复声明被记下来而不是后者静默覆盖前者', () => {
    const blocks = parseHeaders('/x\n  Cache-Control: public, max-age=1\n  Cache-Control: public, max-age=2')
    expect(blocks.length).toBe(1)
    expect(blocks[0].duplicate).toEqual(['cache-control'])
    expect(blocks[0].headers['cache-control']).toBe('public, max-age=1')
  })

  it('变异体：把 immutable 的 minMaxAge 判断摘掉 ⇒ ② 必须翻红（探针有牙）', () => {
    // 不可逆注入：只调纯函数参数不碰文件，证明「最长缓存时长」这一腿真的在被判
    const loose = evaluate({ text: GOOD.replace('max-age=31536000, immutable', 'max-age=31536000') })
    expect(loose.rc, '把 immutable 去掉仍判绿 ⇒ 这条腿没在判').toBe(1)
    expect(loose.problems.join('\n')).toContain('immutable')
  })
})
