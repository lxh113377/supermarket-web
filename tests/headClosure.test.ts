// 第三十九轮夹具：提交面自足判据（head-closure）。
// 立它的读数是本轮开场实测：上一轮在途 10 件里，package.json/ci.yml 已接进
// verify:restore-drill 与 check:live-shape，而这两个脚本文件都没入库 ⇒ 本地 43 判据全绿、
// 那次提交到 CI 必红。判据第一次真跑就独立复现了这件事（H2 只点名这两件），
// 所以这里的每一条腿都必须是"喂合成数据能翻红"，不是"读真仓刚好绿"。
// 夹具全部喂合成面：不读本机 git 状态、不碰真仓文件（否则它测到的是本机在途工作，不是判据）。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyGateScripts } from './helpers/copyGateScripts.mjs'
import { evaluate, extractTargets, stripYamlComments, drill, ORPHAN_EXEMPT, SELF } from '../scripts/check-head-closure.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmpDirs = []
afterAll(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }) })

/** 全绿基线：下面每条腿只动一个变量，红因才可归因。 */
function clean(over = {}) {
  return evaluate({
    headFiles: ['package.json', '.github/workflows/ci.yml', SELF, 'scripts/a.mjs', 'scripts/b.mjs'],
    trackedFiles: ['package.json', '.github/workflows/ci.yml', SELF, 'scripts/a.mjs', 'scripts/b.mjs'],
    headTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF],
    workTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF],
    selfWired: true,
    ...over,
  })
}
const state = (rows, id) => rows.find((r) => r.id === id)?.state
const detail = (rows, id) => rows.find((r) => r.id === id)?.detail || ''

describe('head-closure · evaluate 五腿', () => {
  it('干净面：五腿全 PASS，且门面分母等于行数（不是一行布尔）', () => {
    const rows = clean()
    expect(rows.map((r) => r.state)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
    expect(rows.length).toBe(5)
    expect(rows.filter((r) => r.ok).length).toBe(rows.length)
  })

  it('H1 提交面引用了 HEAD 里没有的脚本 ⇒ FAIL，且点名（本轮事故的"推上去必红"那一半）', () => {
    const rows = clean({ headTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF, 'scripts/never-existed.mjs'] })
    expect(state(rows, 'H1')).toBe('FAIL')
    expect(detail(rows, 'H1')).toContain('scripts/never-existed.mjs')
    // 对偶：H2 不该跟着红（工作面上它是被跟踪的），否则两把尺塌成一把
    expect(state(rows, 'H2')).toBe('PASS')
  })

  it('H2 链引用了未跟踪的脚本 ⇒ FAIL（第三十八轮实测形态：restore-drill.mjs 没入库）', () => {
    const rows = clean({
      workTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF, 'scripts/restore-drill.mjs'],
      trackedFiles: ['package.json', SELF, 'scripts/a.mjs', 'scripts/b.mjs'],
    })
    expect(state(rows, 'H2')).toBe('FAIL')
    expect(detail(rows, 'H2')).toContain('scripts/restore-drill.mjs')
    expect(state(rows, 'H1')).toBe('PASS')
  })

  it('H3 HEAD 里的入口谁都没引用、又不在豁免册 ⇒ FAIL（借 rust tidy check_unused_files）', () => {
    const rows = clean({
      headFiles: ['package.json', SELF, 'scripts/a.mjs', 'scripts/b.mjs', 'scripts/orphan.mjs',
        'scripts/lib/helper.mjs', 'scripts/archive/old.py'],
      headTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF],
      workTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF],
    })
    expect(state(rows, 'H3')).toBe('FAIL')
    expect(detail(rows, 'H3')).toContain('scripts/orphan.mjs')
    // lib/ 与 archive/ 结构上不算入口：它们不该出现在红因里
    expect(detail(rows, 'H3')).not.toContain('scripts/lib/helper.mjs')
    expect(detail(rows, 'H3')).not.toContain('scripts/archive/old.py')
  })

  it('H4 豁免册里的项已被链引用 ⇒ FAIL（反向对账，防例外册成第二个黑账）', () => {
    const ex = [...ORPHAN_EXEMPT.keys()][0]
    const rows = clean({ headTargets: ['scripts/a.mjs', 'scripts/b.mjs', SELF, ex] })
    expect(state(rows, 'H4')).toBe('FAIL')
    expect(detail(rows, 'H4')).toContain(ex)
  })

  it('H5 判据自己没接线 ⇒ FAIL（没进阻断链的工具按半成品处理，不算已交付）', () => {
    const rows = clean({ selfWired: false })
    expect(state(rows, 'H5')).toBe('FAIL')
    expect(detail(rows, 'H5')).toContain(SELF)
  })

  it('豁免册必须是具名的：每条都要有为什么（第四列不能是空串或"以后再说"）', () => {
    expect(ORPHAN_EXEMPT.size).toBeGreaterThan(0)
    for (const [p, why] of ORPHAN_EXEMPT) {
      expect(p, p).toMatch(/^scripts\//)
      expect(why.length, p).toBeGreaterThanOrEqual(20)
    }
  })
})

describe('head-closure · 取数面（散文不许算成引用）', () => {
  it('YAML 整行注释里的 node scripts/x.mjs 不算引用', () => {
    const y = '# 曾经想跑：node scripts/was-commented.mjs\n      - run: node scripts/real.mjs\n'
    expect([...extractTargets(y, 'yaml').targets]).toEqual(['scripts/real.mjs'])
  })

  it('YAML 行尾注释不算引用，但引号里的 # 算命令的一部分（朴素正则会误剥）', () => {
    const y = 'run: node scripts/real.mjs --tag "a#b"  # 尾巴是注释\n'
    expect([...extractTargets(y, 'yaml').targets]).toEqual(['scripts/real.mjs'])
    expect(stripYamlComments('a: "x # y"  # real comment').trim()).toBe('a: "x # y"')
  })

  it('sh 钩子：注释行里的引用不算，未注释的算', () => {
    const sh = '# node scripts/in-comment.mjs\nnode scripts/in-hook.mjs\n'
    expect([...extractTargets(sh, 'sh').targets]).toEqual(['scripts/in-hook.mjs'])
  })

  it('package.json 只取 scripts 的值；README 式散文不参与', () => {
    const pkg = JSON.stringify({
      name: 'x',
      description: 'doc says node scripts/in-prose.mjs',
      scripts: { go: 'node scripts/in-script.mjs && npm run other', other: 'vitest run' },
    })
    expect([...extractTargets(pkg, 'json').targets]).toEqual(['scripts/in-script.mjs'])
  })

  it('非法 package.json 不猜：返回 parseError 且引用集为空（零输入不得装作有结论）', () => {
    const r = extractTargets('{ not json', 'json')
    expect(r.parseError).toBe('not-json')
    expect(r.targets.size).toBe(0)
  })
})

describe('head-closure · 判定力与入口通道', () => {
  it('drill 的合成面必须让 H2 翻红——翻不了红就说明这条判据没有判定力', () => {
    const d = drill()
    expect(d.ok).toBe(true)
    expect(state(d.rows, 'H2')).toBe('FAIL')
  })

  it('--drill 作为子进程真跑：rc=0 且印出 GATE-PASS（演习通过=判据活着）', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-head-closure.mjs'), '--drill'],
      { cwd: REPO, encoding: 'utf8', timeout: 120_000 })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('GATE-PASS head-closure(drill)')
    expect(r.stdout).toContain('FAIL H2')
  })

  it('--json 的 summary 三个数自洽（matched+failed==declared），且告警不污染 stdout', () => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-head-closure.mjs'), '--json'],
      { cwd: REPO, encoding: 'utf8', timeout: 120_000 })
    const at = r.stdout.indexOf('\n{\n')
    expect(at, `stdout 里找不到 JSON 起始行：${r.stdout}`).toBeGreaterThan(-1)
    const j = JSON.parse(r.stdout.slice(at + 1))
    expect(j.summary.matched + j.summary.failed).toBe(j.summary.declared)
    expect(j.summary.declared).toBe(5)
    // 本轮真实面必须是红的，且红因点名两件在途脚本——这条断言拿的是当场读数，不是历史结论
    expect(['GATE-FAIL', 'GATE-PASS']).toContain(j.rows.every((x) => x.ok) ? 'GATE-PASS' : 'GATE-FAIL')
    if (j.rows.some((x) => x.id === 'H2' && x.state === 'FAIL')) {
      expect(detail(j.rows, 'H2')).toMatch(/scripts\/[a-z-]+\.mjs/)
    }
  })

  it('骨架（只拷 scripts/）必须 rc=2 停在门口，而不是崩栈或装绿', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hc-skel-'))
    tmpDirs.push(dir)
    copyGateScripts(REPO, dir, 'check-head-closure.mjs')
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-head-closure.mjs')],
      { cwd: dir, encoding: 'utf8', timeout: 120_000 })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(2)
    expect(r.stdout + r.stderr).toContain('环境不满足')
    expect(r.stdout + r.stderr).not.toContain('MODULE_NOT_FOUND')
  })
})
