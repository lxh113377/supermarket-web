// 第五十一轮 R51-H6：`.gitattributes` 的行为回执 —— 判据自己必须被真跑过。
//
// 为什么单独一份夹具（而不是只靠脚本里的 --selftest）：`verify:entrypoints` 的 G2/G8 把
// "门禁类入口有没有被测试当子进程真跑过"按 tests/ 里的字面量枚举 —— 只写 --selftest 而不接
// 一条真跑腿，就等于"配了但没人跑"，正是既有规「配置在册·行为未证」不允许计入优势的那一型。
//
// 这里同时把本轮**判据自己踩的两个坑**钉成断言：
//   ① 只报不判的 E4 曾被置成 unverified ⇒ 全绿正例被它判成 UNVERIFIED（一条永不消失的假未验证）；
//   ② 批读把 249 个二进制一起要 ⇒ spawnSync 超 maxBuffer 被杀、rc=null、stderr 全空，
//      表现成"扫到 0 件 CRLF"。E3 的第二条通道（git `i/*`）当场抓出 60≠0，才没让它变成假绿。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate } from '../scripts/check-eol-purity.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join('scripts', 'check-eol-purity.mjs')

const run = (args = [], cwd = REPO) => spawnSync(process.execPath, [SELF, ...args], {
  cwd, encoding: 'utf8', timeout: 120_000,
})

/** 造一份合成仓：只有 .gitattributes + 一个 .py + 一个 .webp，够判 E1/E2/E3 三条腿。 */
const entry = (path, binary, iEol = 'i/lf') => ({ path, binary, iEol })
const ATTR = '* text=auto eol=lf\n*.webp binary\n'

describe('check-eol-purity 的入口通道（真跑 + 三档相位）', () => {
  it('--selftest 必须真跑出 6/6（判据自带正例/反例/边界，不许恒绿）', () => {
    const r = run(['--selftest'])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    expect(r.stdout).toMatch(/\[GATE:eol-selftest-pass\] 6\/6/)
    expect(r.stdout).not.toContain('FAIL ')
  })

  it('真面回执：跑真仓 ⇒ 结论行点名分母，且 verdict 与 rc 一一对应（不许"判红却 rc=0"）', () => {
    const r = run()
    expect([0, 1, 2], `未预期的退出码 ${r.status}：${r.stderr.slice(0, 400)}`).toContain(r.status)
    const m = /\[verify:eol\] verdict=(\w+) rc=(\d+)｜跟踪 (\d+)（文本 (\d+) \/ 二进制 (\d+)）/.exec(r.stdout)
    expect(m, `结论行形状不对：${r.stdout.split('\n').slice(-2).join(' / ')}`).toBeTruthy()
    expect(Number(m[2])).toBe(r.status)
    expect(Number(m[3]), '分母恒等式：跟踪 = 文本 + 二进制').toBe(Number(m[4]) + Number(m[5]))
    expect(Number(m[3]), '本仓跟踪件不为零（零分母不得判绿）').toBeGreaterThan(0)
  })

  it('真面必须已经在绿态：blob 侧零 CRLF（本轮 --renormalize 的成品，掉回红就当场报）', () => {
    const r = run()
    expect(r.stdout, r.stdout.split('\n').slice(0, 3).join(' / ')).toContain('verdict=GREEN')
    expect(r.stdout).toMatch(/CRLF -bearing \*\*0 件\*\*/)
    expect(r.stdout).toContain('两侧一致')
  })

  it('属性表**被 git 解析生效**的行为回执：真面 E1 绿，且 `git check-attr` 对 .webp 回 binary、对 .py 回 eol=lf', () => {
    // 「写了 .gitattributes」不等于「git 按它办」—— 被 info/attributes 覆盖、模式写错都会让表变成装饰。
    // 所以这里问 git 本人，而不是再解析一遍我自己写的表（一处一判）。
    const attrs = spawnSync('git', ['-C', REPO, 'check-attr', 'binary', 'text', 'eol', '--',
      'public/images/1.webp', 'scripts/verify_images.py'], { encoding: 'utf8', timeout: 30_000 })
    expect(attrs.status, attrs.stderr).toBe(0)
    const out = attrs.stdout.replace(/\r\n/g, '\n')
    expect(out).toMatch(/1\.webp: binary: set/)
    expect(out).toMatch(/verify_images\.py: eol: lf/)
    expect(out).toMatch(/verify_images\.py: text: (auto|set)/)
    const face = run()
    expect(face.stdout).toContain('属性表在册且被 git 解析生效')
  })
})

describe('evaluate() 的相位与分母（本轮两个自伤形状的常驻回归）', () => {
  const clean = { attrText: ATTR, attrPresent: true, blobs: new Map([['a.py', Buffer.from('x\n')]]),
    entries: [entry('a.py', false), entry('b.webp', true, 'i/-text')] }

  it('坑①回归：E4 只报不判 ⇒ 全绿面必须 GREEN，且 E4 不得进 unver', () => {
    const out = evaluate(clean)
    expect(out.verdict, out.rows.map((r) => `${r.id}=${r.ok}/${r.unverified}`).join(' ')).toBe('GREEN')
    expect(out.rc).toBe(0)
    expect(out.rows.find((r) => r.id === 'E4').advisory).toBe(true)
  })

  it('坑②回归：二进制不进批读面 ⇒ 少读一件文本就必须 UNVERIFIED，不凭"剩下的都干净"判绿', () => {
    const half = { ...clean, blobs: new Map([['a.py', Buffer.from('x\n')]]) }
    expect(evaluate(half).verdict).toBe('GREEN')
    const missing = { ...clean, entries: [entry('a.py', false), entry('c.py', false), entry('b.webp', true, 'i/-text')],
      blobs: new Map([['a.py', Buffer.from('x\n')]]) }
    expect(evaluate(missing).verdict).toBe('UNVERIFIED')
  })

  it('双通道对账：字节扫到 1 件、git i/* 报 0 件 ⇒ 判红并点名（第二把尺不许被沉默）', () => {
    const disagree = { ...clean, blobs: new Map([['a.py', Buffer.from('x\r\n')]]) }
    const out = evaluate(disagree)
    expect(out.verdict).toBe('RED')
    expect(out.rows.find((r) => r.id === 'E3').detail).toContain('不一致')
  })

  it('零分母：entries 为空 ⇒ 不许 PASS（恒等式先塌，空集 ≠ 干净）', () => {
    const out = evaluate({ attrText: ATTR, attrPresent: true, entries: [], blobs: new Map() })
    expect(out.verdict).toBe('RED')
  })
})
