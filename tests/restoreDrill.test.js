// 第三十八轮夹具：恢复演练闭环（合成 dump → 加密 → 解密 → 恢复）与它的退出码矩阵。
// 立它的实测：在册 part44 写"verify:restore 需 CF 凭据 ⇒ 两项恒红"，本轮本机实跑判 OK ⇒
// 演练不依赖云凭据；依赖的只有"取到现网 dump"，那一步没做就必须记 UNVERIFIED 而不是绿。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { assertCliRan } from './helpers/cliLeg.js'
import { evaluate, synthesizeDump, DRILL_PASSPHRASE } from '../scripts/restore-drill.mjs'
import { encryptBuffer } from '../scripts/backup-crypto.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'restore-drill.mjs')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'smrd-')); tmpDirs.push(d); return d }
const run = (args = [], cwd = REPO) => {
  const r = assertCliRan(spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: 'utf8', timeout: 120_000 }), { label: `restore-drill ${args.join(' ') || '默认'}` })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}
const row = (rows, id) => rows.find((r) => r.id === id)

describe('合成 dump 的结构（先证明对象是真的，再谈加解密）', () => {
  it('schema + seed 合成的 dump 含全部建表语句与逐行 INSERT，且注释是 SQL 的 --（本轮两次栽在 # 与 MySQL 的 SET 上）', () => {
    const dump = synthesizeDump(readFileSync(join(REPO, 'db', 'schema.sql'), 'utf8'), readFileSync(join(REPO, 'db', 'seed.sql'), 'utf8'))
    const tables = [...readFileSync(join(REPO, 'db', 'schema.sql'), 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS "?([a-z_]+)"?/gi)].map((m) => m[1])
    expect(tables.length, '真相源表数（第五十六轮 E7 起含 stock_movements）').toBe(10)
    for (const t of tables) expect(dump.includes(`INSERT INTO "${t}"`) || dump.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `dump 里没有表 ${t}`).toBe(true)
    expect(dump).not.toMatch(/^#/)
    expect(dump).not.toContain('SET FOREIGN_KEY_CHECKS')
    expect(dump.split('\n').filter((l) => l.startsWith('--')).length).toBeGreaterThan(0)
  })
})

describe('evaluate：未验证不许折算成通过', () => {
  const steps = [
    { id: 'D1', state: 'PASS', label: 'x', detail: 'y' },
    { id: 'D2', state: 'PASS', label: 'x', detail: 'y' },
  ]
  it('不给产物 ⇒ D5 是 UNVERIFIED，且 matched + mismatched + unver == declared', () => {
    const v = evaluate({ steps, artifactVerified: false, dumpBytes: 10, containerBytes: 20 })
    expect(row(v.rows, 'D5').state).toBe('UNVERIFIED')
    expect(v.summary.matched + v.summary.mismatched + v.summary.unver).toBe(v.summary.declared)
    expect(v.summary.matched).toBeLessThan(v.summary.declared)
  })
  it('给产物 ⇒ D5 转 PASS 且未验证归零（方向相反的一条腿）', () => {
    const v = evaluate({ steps, artifactVerified: true, dumpBytes: 10, containerBytes: 20 })
    expect(row(v.rows, 'D5').state).toBe('PASS')
    expect(v.summary.unver).toBe(0)
  })
  it('任一步 FAIL ⇒ mismatched 记账（不因"其它都绿"而抹平）', () => {
    const v = evaluate({ steps: [...steps, { id: 'D3', state: 'FAIL', label: 'x', detail: '口令错' }], artifactVerified: false })
    expect(v.summary.mismatched).toBe(1)
  })
})

describe('CLI 真跑（子进程 + 退出码矩阵）', () => {
  it('默认：rc=0、闭环全绿、取回链路照实印未验证', () => {
    const { rc, out } = run()
    expect(rc, out.slice(-600)).toBe(0)
    expect(out).toContain('GATE-PASS restore-drill')
    expect(out).toContain('未验证 1')
    expect(out).toContain('PASS D1')
  })
  it('--artifact 指向真解密产物：D5 转绿且未验证归零（跨机取回这一腿确实能判）', () => {
    const d = tmp()
    const dump = synthesizeDump(readFileSync(join(REPO, 'db', 'schema.sql'), 'utf8'), readFileSync(join(REPO, 'db', 'seed.sql'), 'utf8'))
    const cnr = join(d, 'art.smbk')
    writeFileSync(cnr, encryptBuffer(Buffer.from(dump), DRILL_PASSPHRASE))
    const { rc, out } = run(['--artifact', cnr])
    expect(rc, out.slice(-600)).toBe(0)
    expect(out).toContain('未验证 0')
    expect(out).toContain('D5 现网产物的跨机取回')
  })
  it('产物被翻一位 ⇒ rc=1、GATE-FAIL、点名 GCM（这份产物不能当备份）', () => {
    const d = tmp()
    const dump = synthesizeDump(readFileSync(join(REPO, 'db', 'schema.sql'), 'utf8'), readFileSync(join(REPO, 'db', 'seed.sql'), 'utf8'))
    const good = encryptBuffer(Buffer.from(dump), DRILL_PASSPHRASE)
    const bad = Buffer.from(good); bad[bad.length - 3] ^= 0x01
    const cnr = join(d, 'bad.smbk')
    writeFileSync(cnr, bad)
    const { rc, out } = run(['--artifact', cnr])
    expect(rc, out.slice(-600)).toBe(1)
    expect(out).toContain('GATE-FAIL restore-drill')
    expect(out).toContain('GCM 校验失败')
  })
  it('--artifact 指向不存在的文件 ⇒ rc=2（不是"跳过"）', () => {
    const { rc } = run(['--artifact', join(tmp(), 'nope.smbk')])
    expect(rc).toBe(2)
  })
  it('--json 出结构，rows 的 id 序列含 D1..D5', () => {
    const { rc, out } = run(['--json'])
    expect(rc, out.slice(-600)).toBe(0)
    const start = out.split('\n').findIndex((l) => l.startsWith('{'))
    expect(start, 'JSON 段找不到起点（门面行污染了 stdout？）').toBeGreaterThan(-1)
    const j = JSON.parse(out.split('\n').slice(start).join('\n'))
    expect(j.rows.map((r) => r.id).join(',')).toContain('D1,D2,D3,D4,D4b,D5')
    expect(j.summary.declared).toBe(j.rows.length)
  })
  it('缺输入面：只有脚本、没有 db/ 的假仓 ⇒ rc=2 且点名取不到（不得静默 0）', () => {
    const dir = tmp()
    copyGateScripts(REPO, dir, 'restore-drill.mjs', 'backup-crypto.mjs', 'verify-backup-restore.mjs')
    const r = assertCliRan(spawnSync(process.execPath, [join(dir, 'scripts', 'restore-drill.mjs')], { cwd: dir, encoding: 'utf8', timeout: 120_000 }), { label: 'restore-drill 缺输入面假仓' })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(2)
    expect(`${r.stderr}${r.stdout}`).toMatch(/schema|seed/)
  })
})
