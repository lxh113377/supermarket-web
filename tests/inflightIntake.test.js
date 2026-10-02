// inflight-intake 的常驻夹具（第六十四轮 M-60-3）。
//
// 立它的实测：第六十轮诊断「五十九轮全部判据都建立在『已提交』这一前提上，没有一条判据读工作树」，
// 当时只接管不落机制；第六十四轮同一形态第二次发生（`src/components/OrdersTab.tsx` 在途 86 行，
// 正是第六十二轮 §8 那条 P0）。所以本夹具要证的不是"脚本能跑"，而是
// **它真的能区分「无人认领的在途件」与「已被本轮认领」** —— 那条 P0 若能被这道闸看见，前两轮就不会白接一次。
// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(import.meta.url), '../..')
const SELF = join('scripts', 'check-inflight-intake.mjs')
const BUDGET = 60_000
const dirs = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const run = (args, env) => {
  const r = spawnSync(process.execPath, [SELF, ...args], {
    cwd: REPO, encoding: 'utf8', timeout: BUDGET, ...(env ? { env } : {}),
  })
  return assertCliRan(r, { label: `check:inflight ${args.join(' ') || '(默认面)'}`, budgetMs: BUDGET })
}

const git = (dir, args) => {
  const r = spawnSync('git.exe', ['-C', dir, ...args], { encoding: 'utf8', timeout: BUDGET })
  if (r.status !== 0) {
    const alt = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: BUDGET })
    if (alt.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(alt.stderr || r.stderr || '').trim()}`)
    return alt.stdout || ''
  }
  return r.stdout || ''
}

const read = (p) => readFileSync(p, 'utf8')

/** 一次性 git 仓：主卷带一个轮次节 + 一个已提交的源文件（认领面与被审面都在磁盘上真实存在）。 */
function mkRepo() {
  const d = mkdtempSync(join(tmpdir(), 'infl64-'))
  dirs.push(d)
  git(d, ['init', '-q', '--initial-branch=main'])
  git(d, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'config', 'user.email', 't@t'])
  mkdirSync(join(d, 'memory'), { recursive: true })
  mkdirSync(join(d, 'src'), { recursive: true })
  writeFileSync(join(d, 'memory', '07-next-steps.md'),
    '# 07 - 下一步\n\n## 2026-10-03 — 第六十四轮（夹具）\n\n- 本轮 P0：写一条可执行的开工判据\n\n## 分卷目录\n\n- 卷 1\n')
  writeFileSync(join(d, 'src', 'Panel.tsx'), 'export default 1\n')
  git(d, ['add', 'memory/07-next-steps.md', 'src/Panel.tsx'])
  git(d, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'])
  return d
}

describe('check:inflight（在途未提交件的开工采集）', () => {
  it('入口真跑：--selftest 被子进程跑起来，且必须 N/N 全过（只 import 纯函数不算覆盖）', () => {
    const r = run(['--selftest'])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    const m = /inflight-selftest :: (\d+)\/(\d+) 通过，(\d+) 失败/.exec(r.stdout)
    expect(m, r.stdout).not.toBeNull()
    expect([Number(m[1]), Number(m[2]), Number(m[3])], r.stdout).toEqual([Number(m[2]), Number(m[2]), 0])
  })

  it('确凿在途件：内容面认它为 differs，且本轮没点名 ⇒ unclaimed', () => {
    const d = mkRepo()
    writeFileSync(join(d, 'src', 'Panel.tsx'), 'export default 2\n')
    const r = run([`--root=${d}`])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('src/Panel.tsx :: ')
    expect(r.stdout).toContain('内容=differs')
    expect(r.stdout).toContain('认领=unclaimed')
    expect(r.stdout).toMatch(/unclaimed=1/)
  })

  it('认领翻转：把文件名写进该仓主卷的最新轮次节 ⇒ 同一件立刻由 unclaimed 变 claimed', () => {
    const d = mkRepo()
    writeFileSync(join(d, 'src', 'Panel.tsx'), 'export default 2\n')
    expect(run([`--root=${d}`]).stdout).toContain('src/Panel.tsx :: 态=M 内容=differs 龄=after-HEAD(0h) 认领=unclaimed')
    const p = join(d, 'memory', '07-next-steps.md')
    writeFileSync(p, read(p).replace(
      '本轮 P0：写一条可执行的开工判据',
      '接管 `src/Panel.tsx`（本轮 P0：写一条可执行的开工判据）'))
    const r = run([`--root=${d}`])
    expect(r.stdout, r.stdout).toContain('src/Panel.tsx :: 态=M 内容=differs 龄=after-HEAD(0h) 认领=claimed(命中 1)')
    // 自指这一条是**设计如此**，不是缺陷：写下认领这句话的动作本身就把它依赖的那个文件改成未提交态，
    // 所以主卷自己会同时出现在在途集里且判无主（它自己的 basename 不在那一节内）。
    // 期望值取的是本轮实测形状（files=2 claimed=1 unclaimed=1），不是作者心算 —— 心算的那版写成
    // `claimed=1 unclaimed=0`，被这条夹具当场否证（户内：期望值必须由被测对象自报）。
    expect(r.stdout, r.stdout).toMatch(/files=2 claimed=1 unclaimed=1/)
    expect(r.stdout).toContain('memory/07-next-steps.md :: ')
  })

  it('未跟踪件走 untracked 档，且两面分母（status 的 ?? 与 ls-files --others）合上', () => {
    const d = mkRepo()
    writeFileSync(join(d, 'src', 'New.tsx'), 'export const x = 1\n')
    const r = run([`--root=${d}`])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('内容=untracked')
    expect(r.stdout).toContain('未跟踪 A1/B1 合')
  })

  it('干净树 ⇒ files=0 且 GATE-PASS（"量到零"必须读得出零）', () => {
    const r = run([`--root=${mkRepo()}`])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('GATE-PASS inflight-intake')
    expect(r.stdout).toMatch(/files=0 claimed=0 unclaimed=0/)
  })

  it('取不到 git ⇒ rc=2 UNVERIFIED，与上一例的 rc=0 files=0 不得同形（量不到 ≠ 达标）', () => {
    const r = run([], { ...process.env, PATH: '/nonexistent-dir-for-inflight', GIT_EXE: 'definitely-not-git-xyz' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2)
    expect(r.stdout).toContain('GATE-UNVERIFIED inflight-intake')
    expect(r.stdout).toContain('rc=2')
    expect(r.stderr).toContain('取数面未通')
  })

  it('主卷读不到 ⇒ 同样 rc=2，绝不退化成"工作树干净"', () => {
    const d = mkRepo()
    rmSync(join(d, 'memory', '07-next-steps.md'))
    const r = run([`--root=${d}`])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2)
    expect(r.stderr).toContain('读不到')
  })

  it('--json 通道：stdout 只有一个门面行，其余是 JSON（诊断走 stderr，不许把 JSON 挤坏）', () => {
    const r = run([`--root=${mkRepo()}`, '--json', '--quiet'])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    const face = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('[GATE:inflight'))
    expect(face).toHaveLength(1)
    const payload = JSON.parse(r.stdout.slice(0, r.stdout.indexOf('[GATE:inflight')).trim() || 'null')
    expect(Array.isArray(payload.rows), r.stdout).toBe(true)
    expect(payload.faces).toHaveProperty('aUntracked')
  })
})
