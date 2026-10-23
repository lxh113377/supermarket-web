// 第七十五轮 I-75-5：可访问性静态判据的常驻夹具。
// 分工写死在这里：本文件只测**静态规则**；浏览器里的可见性/可聚焦性在 tests/e2e-visual/a11y.spec.ts。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { assertCliRan } from './helpers/cliLeg.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditSources, checkImgAlt, checkInputName, checkClickableSemantics, readJsxTag, isInsideLabel } from '../scripts/lib/a11y-rules.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join(REPO, 'scripts', 'check-a11y-static.mjs')
const cli = (args) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], { cwd: REPO, encoding: 'utf8', timeout: 60_000 }), { label: 'a11y-static ' + args.join(' ') })

describe('a11y 静态规则：img/alt、input 可访问名字、可点击元素语义', () => {
  it('判据自证：全过且条数不倒退（条数动态解析，不写死）', () => {
    const r = cli(['--selftest'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    // 从前这里写死 toContain('selftest 8/8') —— 于是给判据加一条腿就必须同时来改这个数，
    // 而"改测试才能过"会让加腿的成本看起来比不加还高（本轮实测：我扩到 12 条它当场红）。
    // 现在解析 N/M：M 是条数（下界锁倒退，加腿不必再动这里），N 必须等于 M（不许有失败腿）。
    const m = /\[a11y-static\] selftest (\d+)\/(\d+)/.exec(r.stdout)
    expect(m, '没打印 selftest 计数行 ⇒ --selftest 可能压根没跑（别把 rc=0 当它跑了）').toBeTruthy()
    const passed = Number(m[1])
    const total = Number(m[2])
    expect(passed, 'selftest 有失败腿').toBe(total)
    expect(total, 'selftest 条数倒退（当前在册 12 条：8 条原腿 + 4 条注释免疫腿）').toBeGreaterThanOrEqual(12)
  })

  it('真面：src 下全部 tsx 零违规（条数由 CLI 自报，这条会随新增页面一起变严）', () => {
    const r = cli([])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('GATE-PASS');
    expect(r.stdout).toMatch(/scanned \d+ tsx files/);
  })

  it('零输入：--dir 指向空目录 ⇒ rc=2（空集不是"没有违规"）', () => {
    const r = cli(['--dir', join(REPO, 'docs')])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stdout).toContain('UNVERIFIED')
  })

  it('入口真跑：--json 输出 files/problems 两字段（CI 消费面）', () => {
    const r = cli(['--json'])
    expect(r.status).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.files).toBeGreaterThan(0)
    expect(Array.isArray(j.problems)).toBe(true)
  })

  it('装饰图 alt="" 是合法写法（对比"缺 alt"才是违规"），两条腿成对', () => {
    expect(checkImgAlt('<img src={a} alt="" />')).toEqual([])
    expect(checkImgAlt('<img src={a} />').length).toBe(1)
  })

  it('placeholder 不是可访问名字；aria-label 与 htmlFor 两条路都认', () => {
    expect(checkInputName('<input placeholder="备注" />').length).toBe(1)
    expect(checkInputName('<input aria-label="备注" />')).toEqual([])
    expect(checkInputName('<label htmlFor="a">A</label><input id="a" />')).toEqual([])
    // 模板串形态（本仓 ServiceFormPage 的真实写法）：id 与 htmlFor 必须认成同一个
    const tpl = '<label htmlFor={`sf-${field.key}`}>姓名</label>\n<input id={`sf-${field.key}`} />'
    expect(checkInputName(tpl), '模板串 id 与 htmlFor 认不上的话，正确的写法会被误报').toEqual([])
  })

  it('包裹式 <label> 也算可访问名字（本仓 PrintForm 的真实写法）', () => {
    const wrapped = '<label className="block">\n  <span>楼栋号</span>\n  <input value={x} />\n</label>'
    expect(checkInputName(wrapped)).toEqual([])
  })

  it('readJsxTag 必须读到**完整**开标签（属性里的 {...} 不能被截断）——本件首版在这里误报过', () => {
    const text = '<input aria-label={`选择 ${name}`} value={v} />'
    const tag = readJsxTag(text, 0)
    expect(tag).toContain('aria-label=')
    expect(tag.endsWith('/>')).toBe(true)
  })

  it('isInsideLabel：在 <label> 内为真、闭合后为假（成对，防"永远为真"的假判据）', () => {
    const src = '<label>\n<input id="a" />\n</label>\n<input id="b" />'
    const a = src.indexOf('<input id="a"')
    const b = src.indexOf('<input id="b"')
    expect(isInsideLabel(src, a)).toBe(true)
    expect(isInsideLabel(src, b)).toBe(false)
  })

  it('可点击语义：div+onClick 无 role ⇒ 报；带 role/tabIndex/onKeyDown ⇒ 不报', () => {
    expect(checkClickableSemantics('<div onClick={go}>x</div>').length).toBe(1)
    expect(checkClickableSemantics('<div role="button" tabIndex={0} onKeyDown={k} onClick={go}>x</div>')).toEqual([])
    // presentation 是显式声明"不是控件"：遮罩这类鼠标便利面用它，键盘等价路径另需实现
    expect(checkClickableSemantics('<div role="presentation" onClick={close}>x</div>')).toEqual([])
  })

  it('变异体：把 img 规则放宽成"有 alt 或没有 src 都行"⇒ 反例必须翻红（探针有牙）', () => {
    // 用一个明显错误的实现跑同一批输入，证明本件的反例不是写死的：
    const loose = (src) => checkImgAlt(src).filter((p) => !p.detail.includes('img'));
    expect(loose('<img src={a} />').length, '放宽后仍然报 ⇒ 这条腿没在判 alt').toBe(0)
    expect(auditSources({ 'x.tsx': '<img src={a} />' }).length).toBe(1)
  })

  // 2026-10-23：注释里的 JSX 不得触发任何规则。一手起因是并行会话的 WIP 注释
  // 「两个 <input> 会抢同一个 ref」被报成 ServiceFormPage.tsx:39 缺可访问名 ——
  // 指向注释行的违规就是哭狼，下一轮会被静音（本文件头注写明的原则）。
  describe('auditSources 对注释免疫（stripComments）', () => {
    it('行注释 / 块注释 / JSX 注释三种形态都不报', () => {
      const cases = {
        line: 'const x = 1\n// 两个 <input> 会抢同一个 ref\nconst y = 2',
        block: 'const x = 1\n/* 说明：<input> 需要名字 */\nconst y = 2',
        jsx: 'const x = 1\n{/* 这里曾有 <input type="text" placeholder="q" /> */}\nconst y = 2',
      }
      for (const [k, src] of Object.entries(cases)) {
        expect(auditSources({ 'a.tsx': src }), k + ' 注释里的 markup 被误判').toEqual([])
      }
    })
    it('反向腿：注释与真实代码各有一个无名 input 时，只报真实那一个（行号不位移）', () => {
      const src = '// <input type="text" placeholder="q" />\n<input type="text" placeholder="q" />'
      const r = auditSources({ 'a.tsx': src })
      expect(r.length, '剥注释把真违规一起吞掉了').toBe(1)
      expect(r[0].rule).toBe('input-name')
      expect(r[0].line, '剥注释改变了行号（必须逐字符等长替换）').toBe(2)
    })
    it('URL 字符串里的 // 不被当行注释（否则其后整行代码全部失明）', () => {
      const src = 'const u = "http://x/a"\n<input type="text" placeholder="q" />'
      const r = auditSources({ 'a.tsx': src })
      expect(r.length, '"http://" 被误判成注释，导致第 2 行的真缺陷漏判').toBe(1)
      expect(r[0].line).toBe(2)
    })
  })
})
