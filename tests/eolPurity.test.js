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
import { assertCliRan } from './helpers/cliLeg.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = join('scripts', 'check-eol-purity.mjs')

const run = (args = [], cwd = REPO) => assertCliRan(spawnSync(process.execPath, [SELF, ...args], {
  cwd, encoding: 'utf8', timeout: 120_000,
}), { label: `check-eol-purity ${args.join(' ') || '真面'}` })

/** 造一份合成仓：只有 .gitattributes + 一个 .py + 一个 .webp，够判 E1/E2/E3 三条腿。 */
const entry = (path, binary, iEol = 'i/lf') => ({ path, binary, iEol })
const ATTR = '* text=auto eol=lf\n*.webp binary\n'
// E5 比的是**两处写侧声明**是否同向，所以夹具默认带一份"同向的" .editorconfig，
// 让其余各条腿的 want/got 只归因到自己那条（否则整面会被 E5 判成 UNVERIFIED，红因全在夹具）。
const EC = 'root = true\n[*]\nend_of_line = lf\n'
const ec = (text = EC, present = true) => ({ editorconfigText: text, editorconfigPresent: present })
// —— E7/E8（第五十八轮 R58-H5 落子时补）：evaluate() 现在要求这两维也有输入面。
// 桩只给"全真"的解析结果（真解析路径由真面覆盖），声明键默认与夹具文本对齐。
const RES_STUB = () => ({ charset: 'utf-8', indent_style: 'space', insert_final_newline: 'true', trim_trailing_whitespace: 'true' })
const res = (decl = ['end_of_line']) => ({ resolveProps: RES_STUB, resolveNote: 'test 内联桩', declaredKeys: decl })

describe('check-eol-purity 的入口通道（真跑 + 三档相位）', () => {
  it('--selftest 必须真跑且**全部通过**（判据自带正例/反例/边界，不许恒绿）', () => {
    const r = run(['--selftest'])
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    const m = /\[GATE:eol-selftest-pass\] (\d+)\/(\d+)/.exec(r.stdout)
    expect(m, `汇总行形状不对：${r.stdout.split('\n').slice(-1)[0]}`).toBeTruthy()
    expect(Number(m[1]), '通过数必须等于分母（自相矛盾的 6/10 不算绿）').toBe(Number(m[2]))
    expect(Number(m[2]), '判别条数不许低于第五十四轮的 10 条（掉档＝有人删腿不删账）').toBeGreaterThanOrEqual(10)
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
    const attrs = assertCliRan(spawnSync('git', ['-C', REPO, 'check-attr', 'binary', 'text', 'eol', '--',
      'public/images/1.webp', 'scripts/verify_images.py'], { encoding: 'utf8', timeout: 30_000 }), { label: 'git check-attr 属性生效回执' })
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
  const clean = { attrText: ATTR, attrPresent: true, ...ec(), ...res(),
    blobs: new Map([['a.py', Buffer.from('x\n')]]),
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
    const out = evaluate({ attrText: ATTR, attrPresent: true, ...ec(), entries: [], blobs: new Map() })
    expect(out.verdict).toBe('RED')
  })

  // —— 第五十四轮 R54-H1：三把尺分档印 + 写侧声明这条**可自愈**的闸。
  it('E5 是**拦提交**的一条（advisory=false）：两处声明矛盾 ⇒ RED 且逐处点名', () => {
    const out = evaluate({ ...clean, ...ec('root = true\n[*]\nend_of_line = crlf\n') })
    expect(out.verdict, out.rows.map((r) => `${r.id}=${r.ok}/${r.unverified}`).join(' ')).toBe('RED')
    const e5 = out.rows.find((r) => r.id === 'E5')
    expect(e5.advisory, 'E5 若被降成 advisory，就等于把这条闸摘掉而没人看得见').toBe(false)
    expect(e5.detail).toContain('矛盾')
    expect(e5.detail).toContain('crlf')
  })

  it('E5 零输入：.editorconfig 读不到 ⇒ UNVERIFIED，**不得**读成"没有声明也就没有矛盾"（盲区≠零）', () => {
    const out = evaluate({ ...clean, ...ec('', false), declaredKeys: null })
    expect(out.verdict).toBe('UNVERIFIED')
    expect(out.rc).toBe(2)
    expect(out.rows.find((r) => r.id === 'E5').detail).toContain('不判"一致"')
  })

  it('E4/E6 必须**只报不拦**（本机是 CRLF 检出机器：拿工作树当闸＝要求提交一笔不存在的改动）', () => {
    const out = evaluate({ ...clean, worktreeCrlf: 268, worktreeTotal: 742, worktreeGitCrlf: 178, autocrlf: 'true' })
    expect(out.verdict).toBe('GREEN')
    for (const id of ['E4', 'E6']) {
      const r = out.rows.find((x) => x.id === id)
      expect(r.advisory, `${id} 必须是 advisory`).toBe(true)
      expect(r.detail).toContain('拦提交=否')
    }
    expect(out.rows.find((r) => r.id === 'E6').detail).toContain('w/crlf 178 件')
    expect(out.rows.find((r) => r.id === 'E6').detail).toContain('core.autocrlf=true')
  })

  it('E7 漏报侧：缺末行换行 ⇒ RED 且点名 insert_final_newline', () => {
    const out = evaluate({ ...clean, blobs: new Map([['a.py', Buffer.from('x')]]) })
    expect(out.verdict).toBe('RED')
    expect(out.rows.find((r) => r.id === 'E7').detail).toContain('insert_final_newline')
  })

  it('E8 漏报侧：声明了没人核的键 ⇒ RED 且点名该键', () => {
    const out = evaluate({ ...clean, declaredKeys: ['end_of_line', 'max_line_length'] })
    expect(out.verdict).toBe('RED')
    expect(out.rows.find((r) => r.id === 'E8').detail).toContain('max_line_length')
  })

  it('真面输出必须把"哪些拦提交、哪些只报"写进结论行（读者不必自己数行）', () => {
    const r = run()
    const m = /拦提交=([\w,]+)｜只报不拦=([\w,]+)/.exec(r.stdout)
    expect(m, `结论行缺分档段：${r.stdout.split('\n').slice(-1)[0]}`).toBeTruthy()
    expect(m[1].split(',')).toEqual(['E1', 'E2', 'E3', 'E5', 'E7', 'E8'])
    expect(m[2].split(',')).toEqual(['E4', 'E6'])
  })
})
