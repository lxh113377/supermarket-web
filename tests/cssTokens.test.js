// CSS 令牌「引用⇄定义」对账闸（scripts/check-css-tokens.mjs）的测试面。
// 立它的动因见该件头注：forest 族自 v3 起被引用而 :root 从未定义，v4 换 to-forest 后
// 线上两条封面带透明 —— 构建不报错、对比度闸抓不到，只有这把尺能量。
// 腿形同 memoryVolume：真入口子进程（rc 断言）+ 纯函数变异（证明红因是那次比较）。
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectRefs, collectDefs, evaluate, stripComments, ROOT } from '../scripts/check-css-tokens.mjs'
import { assertCliRan } from './helpers/cliLeg.js'

const SELF = join(ROOT, 'scripts', 'check-css-tokens.mjs')

function runCli(args = []) {
  // 接 cliLeg 守卫（第五十四轮 R54-H4）：并行负载把 spawnSync 打断时 status=null，
  // 空 stdout 不得当结论继续断言；守卫先证跑成了再交回。
  return assertCliRan(spawnSync(process.execPath, [SELF, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 }), { label: 'css-tokens CLI 腿' })
}

describe('css-tokens：引用⇄定义双向对账', () => {
  it('真面：本仓 src 的 76 个引用全部有 :root 定义（forest 补漏后零缺）', () => {
    const r = runCli()
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GATE-PASS css-tokens')
    expect(r.stdout).toMatch(/缺定义 0/)
  })

  it('T1 零输入不得 PASS：引用面空 ⇒ rc=2（取数面坏了不是"没引用"）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'csstok-empty-'))
    const refs = collectRefs(empty, [join(empty, 'nope.js')])
    const { rc, rows } = evaluate({ refs, defs: new Set(['--t-forest']) })
    expect(rc).toBe(2)
    expect(rows[0].id).toBe('T1')
    expect(rows[0].unverified).toBe(true)
  })

  it('T2 变异：摘掉 forest 定义 ⇒ 同一引用面必须红并点名（证明红因是缺定义）', () => {
    const refs = collectRefs()
    const defs = collectDefs()
    expect(defs.has('--t-forest'), '前置：真面定义里必须有 forest（补漏已生效）').toBe(true)
    const mutated = new Set([...defs].filter((k) => k !== '--t-forest'))
    const { rc, rows } = evaluate({ refs, defs: mutated })
    expect(rc).toBe(1)
    const t2 = rows.find((x) => x.id === 'T2')
    expect(t2.pass).toBe(false)
    expect(t2.detail).toContain('--t-forest')
  })

  it('T4 定义面取不到 ⇒ rc=2（未观测不是通过）', () => {
    const refs = collectRefs()
    const { rc } = evaluate({ refs, defs: null })
    expect(rc).toBe(2)
  })

  it('stripComments：tailwind 头注里的示例 var(--t-x) 不算引用（首跑误报的形态）', () => {
    const src = '/* rgb(var(--t-x) / <alpha-value>) 是文档 */\nconst a = "rgb(var(--t-real) / 1)"\n// var(--t-line-comment)\nconst u = "https://x.dev/var(--t-url)"\n'
    const stripped = stripComments(src)
    const names = [...stripped.matchAll(/var\((--t-[a-z0-9-]+)/g)].map((m) => m[1])
    // 块注释里的示例与行注释都被剥；URL 行**保留**（:// 不许被当注释起点）⇒ --t-url 在面内
    expect(names).toEqual(['--t-real', '--t-url'])
  })

  it('T3 死槽只报不拦：定义无人引用 ⇒ WARN 且 rc 仍 0（删存量死槽是另一个决定）', () => {
    const refs = new Map([['--t-a', new Set(['x.css'])]])
    const defs = new Set(['--t-a', '--t-dead'])
    const { rc, rows } = evaluate({ refs, defs })
    expect(rc).toBe(0)
    const t3 = rows.find((x) => x.id === 'T3')
    expect(t3.warn).toBe(true)
    expect(t3.detail).toContain('--t-dead')
  })
})
