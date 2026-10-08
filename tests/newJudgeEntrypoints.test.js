// @vitest-environment node
/**
 * 第七十二轮两个新判据的**入口通道**覆盖（`verify:entrypoints` G2/G8 的牙齿面）。
 *
 * 为什么要单独一个文件而不是并进各自的纯函数测试：`verify:entrypoints` 判的是
 * 「这条门禁的**入口**有没有被真起过子进程」，纯函数 import 走不到入口守卫那一行，
 * 也不证明 `process.exitCode` 那条路径通。两件事都只由"真 spawn 一次"回答。
 *
 * 两条腿各自的 `--selftest` 是**设计上的自证面**（不联网、不读真仓契约），
 * 所以在这里以子进程跑它，既证明入口通、又证明自证面真的全绿 ——
 * 后者是关键：如果哪天有人把自证面改成恒绿，这两条会先红。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCliRan } from './helpers/cliLeg.js'

const ROOT = join(__dirname, '..')

/**
 * 以真子进程跑一个 scripts/*.mjs，附 90s 超时。
 *
 * 必须接 `assertCliRan`（`verify:cli-legs` 硬要求，unguardedMax=0 且只准降不准升）：
 * status=null 时 stdout 是空串，而"空串"与"它判了个空"长得一模一样 ——
 * 不接守卫就会在并行负载把这条腿打断时，把一次**没跑成**读成一次**判过**。
 * 那个坑本仓已实付过代价（R54-H4：单跑全绿、全链红、下一轮全绿）。
 */
function runScript (name, args = []) {
  const r = assertCliRan(spawnSync(process.execPath, [join(ROOT, 'scripts', name), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 90_000,
  }), { label: `newJudgeEntrypoints ${name} ${args.join(' ')}`, budgetMs: 90_000 })
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), all: `${r.stdout || ''}${r.stderr || ''}` }
}

describe('check-contract-diff 的入口通道（第七十二轮 I-72-3）', () => {
  it('--selftest 子进程真跑 ⇒ rc=0 且自证 10/10', () => {
    const r = runScript('check-contract-diff.mjs', ['--selftest'])
    expect(r.all, `rc=${r.status}\n${r.all}`).toContain('自证 10/10')
    expect(r.status, r.all).toBe(0)
    // 门面行必须点名分母，否则"扫到 0 个对象"与"真判过 10 条腿"读起来一样
    expect(r.all).toMatch(/自证 \d+\/\d+/)
    expect(r.all).not.toMatch(/有腿没咬住/)
  })

  it('真面入口：跑一次 rc=0 且印出可复算的分母（基线 + 两侧 action 数）', () => {
    const r = runScript('check-contract-diff.mjs')
    expect(r.status, r.all).toBe(0)
    expect(r.all).toContain('基线=HEAD')
    // 分母非零是硬要求：0/0 也可能 rc=0，那就是零输入折算
    const m = /openapi (\d+)→(\d+) action、api-contract (\d+)→(\d+) action/.exec(r.all)
    expect(m, `门面行必须带两侧 action 分母：${r.all}`).toBeTruthy()
    expect(Number(m[1])).toBeGreaterThan(0)
    expect(Number(m[3])).toBeGreaterThan(0)
  })

  it('基线取不到 ⇒ rc=2 而不是 0（"缺证据"不得折算成"无破坏"）', () => {
    const r = runScript('check-contract-diff.mjs', ['--base', 'refs/heads/__no_such_ref__'])
    expect(r.status, `取不到的基线必须 rc=2，实得 ${r.status}：${r.all}`).toBe(2)
    expect(r.all).toContain('UNVERIFIED')
    expect(r.all).toContain('基线面取不到')
  })

  it('五类破坏各有一条自证腿（真面判红时必须有人证过它能判红）', () => {
    const r = runScript('check-contract-diff.mjs', ['--selftest'])
    // 断言腿名（门面印的是腿名，不是分类名）—— 分类名的完整性由脚本文档与纯函数侧保证。
    for (const leg of ['③ 反例：删一个 action', '⑤ 反例：新增必填字段', '⑥ 反例：删请求字段',
      '⑦ 反例：字段改类型', '⑧ 反例：只读 action 变写']) {
      expect(r.all, `自证面必须实跑过「${leg}」这条腿`).toContain(leg)
    }
    expect(r.all).toContain('PASS  ③ 反例：删一个 action')
    expect(r.all).toContain('PASS  ⑧ 反例：只读 action 变写')
    expect(r.status).toBe(0)
  })
})

describe('check-gate-parity 的入口通道（第七十二轮 I-72-4）', () => {
  it('--selftest 子进程真跑 ⇒ rc=0 且自证 7/7', () => {
    const r = runScript('check-gate-parity.mjs', ['--selftest'])
    expect(r.all, `rc=${r.status}\n${r.all}`).toContain('自证 7/7')
    expect(r.status, r.all).toBe(0)
    expect(r.all).not.toMatch(/有腿没咬住/)
  })

  it('真面入口：rc=0 且印出 CI 判据 step 数与本地形态数（分母都必须非零）', () => {
    const r = runScript('check-gate-parity.mjs')
    expect(r.status, r.all).toBe(0)
    const m = /CI 判决面判据 step (\d+) 条.*摊出可执行形态 (\d+) 种/.exec(r.all)
    expect(m, `门面行必须带两侧分母：${r.all}`).toBeTruthy()
    expect(Number(m[1]), 'CI 判据面分母为 0 ⇒ 这条判据在真面上退化成空转真').toBeGreaterThan(0)
    expect(Number(m[2]), '本地形态分母为 0 ⇒ 同上').toBeGreaterThan(0)
  })

  it('对齐方向必须写在门面上（单向：CI ⊆ 本地），否则读的人会以为漏了反向', () => {
    const r = runScript('check-gate-parity.mjs')
    expect(r.all).toContain('对齐方向：CI ⊆ 本地')
  })

  it('变异体：把 CI 判据面删空 ⇒ 必须返回 null（零分母不折算成"已对齐"）', async () => {
    // 判据的 ROOT 取自身位置，所以这里不复制仓，只调纯函数并喂一个"判据面被清空"的合成 ci.yml。
    const { gateParity } = await import('../scripts/check-gate-parity.mjs')
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const zeroFace = ['name: CI', 'jobs:', '  renamed_gates:', '    runs-on: ubuntu-latest',
      '    steps:', '      - name: Build', '        run: npm run build', ''].join('\n')
    expect(gateParity({ ciText: zeroFace, pkg }),
      'gates job 改名/挪位后判据面会空；此时必须返回 null（⇒ rc=2），不能返回 {misalign: []}').toBeNull()
    // 反向自证：真面必须非 null，否则这条腿就退化成"永远通过"
    expect(gateParity({ ciText: readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'), pkg }),
      '真面不得为 null（分母被清空或 job 改名了）').not.toBeNull()
  })
})
