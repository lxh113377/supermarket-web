// 第四十五轮夹具：**被审对象之外，还要审"审它的那双眼睛"** —— 采集层（词法扫描）自己的正例 + 变异体。
// 立它的一手事实（本机 @2026-09-28，第四十四轮）：`scanBrackets()` 进字符串时写 `state = c`（引号字符本身），
// 分支判的却是 `state === 'sq' | 'dq' | 'tpl'` ⇒ 两边永不相等，**字符串内容从来没被跳过过**；
// 于是 `tests/docCommands.test.js:96` 理由串里的 `.github/workflows/*` 被当成块注释起点，吞掉该行之后整段，
// `spawnSync(` 配不上对 ⇒ 覆盖采集少记一个入口 ⇒ 一道**已有真跑夹具**的门禁被报成"未登记缺口"。
// 同行做法（本轮 gh api 取回原文核对）：`golang/go :: src/cmd/compile/internal/syntax/scanner_test.go`
// 共 767 行 / 22,462B，含 `TestScanErrors`(:587) 与按 issue 号命名的词法回归件 `TestIssue21938`(:735)
// —— 那个用例的输入正是"块注释 + 空白 + */"这类扫描边角。⇒ 本文件按同一惯例把事故面钉成具名回归件。
// 已知盲区（不做完整词法分析）：模板串 `${}` 插值里的括号**不计数**、正则字面量里的括号**会被计数**
// —— 两条都在下面写成"实测形状"的断言，而不是留给下一轮去猜。
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanBrackets, collectCovered } from '../scripts/check-cli-entrypoints.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
/** 取包住某个 needle 的那对括号里的原文（覆盖采集就是拿这段文本找脚本名的）。 */
const textAround = (src, needle) => scanBrackets(src).parens
  .map(([a, b]) => src.slice(a, b + 1)).filter((t) => t.includes(needle))

/** 第四十四轮修复**之前**的写法，原样复制一份进来当变异体对照：赋值用引号字符、判断用名字。 */
function scanBracketsBuggy(src) {
  const parens = []
  const stack = []
  let state = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1]
    if (state === 'line') { if (c === '\n') state = null; continue }
    if (state === 'block') { if (c === '*' && d === '/') { i++; state = null }; continue }
    if (state === 'sq' || state === 'dq' || state === 'tpl') { if (c === '\\') { i++; continue }; if (c === state) state = null; continue }
    if (c === '/' && d === '/') { state = 'line'; i++; continue }
    if (c === '/' && d === '*') { state = 'block'; i++; continue }
    if (c === "'" || c === '"' || c === '`') { state = c; continue }
    if (c === '(' || c === '[') { stack.push([c, i]); continue }
    if (c === ')' || c === ']') {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k][0] === (c === ')' ? '(' : '[')) { const p = stack.splice(k, 1)[0]; if (c === ')') parens.push([p[1], i]); break }
      }
    }
  }
  return { parens, brackets: [] }
}

describe('采集层正例：结构已知的输入必须给出手算得出的配对数', () => {
  it("串里的括号不计数：spawnSync(node, [f('a(b'), g(']')]) ⇒ 括号 3 对、方括号 1 对", () => {
    const src = "spawnSync(node, [f('a(b'), g(']')])\n"
    const r = scanBrackets(src)
    expect(r.parens.length).toBe(3)
    expect(r.brackets.length).toBe(1)
  })

  it("注释里的括号不计数，块注释里的引号也不得起字符串：// ( ) [ ] 与 /* \"hi\" */ 之后只剩 baz() 一对", () => {
    const src = '// foo( [ bar\n/* he said "hi" then ] ) */\nbaz()\n'
    const r = scanBrackets(src)
    expect(r.parens.length).toBe(1)
    expect(r.brackets.length).toBe(0)
  })

  it("转义引号不得提前闭合字符串：a('it\\'s (b', c()) ⇒ 只有 2 对（串里的 ( 不算）", () => {
    const src = "a('it" + "\\" + "'s (b', c())"
    expect(scanBrackets(src).parens.length).toBe(2)
  })

  it('每对配对的原文能取回 needle（覆盖采集靠的就是这段文本）', () => {
    const src = "spawnSync(process.execPath, ['scripts/z.mjs'], { cwd })\n"
    expect(textAround(src, 'scripts/z.mjs').length).toBe(1)
  })
})

describe('事故面回归件（golang/go TestIssue21938 的同形做法）', () => {
  const ACCIDENT = "const x = { reason: 'grep -c verify:quiet .github/workflows/* = 3' }\n"
    + "spawnSync(process.execPath, ['scripts/check-doc-commands.mjs'], { cwd: ROOT })\n"

  it('串里的 /* 不得起块注释：该行之后必须还看得见 spawnSync 的配对', () => {
    expect(scanBrackets(ACCIDENT).parens.length).toBe(1)
    expect(textAround(ACCIDENT, 'check-doc-commands.mjs').length).toBe(1)
  })

  it('变异体对照：同一份输入喂修复前的写法 ⇒ 配对归零（证明这套断言咬得住那条缺陷）', () => {
    expect(scanBracketsBuggy(ACCIDENT).parens.length).toBe(0)
  })

  it('变异体对照②：串里的 `//` 在旧写法下起假行注释 ⇒ 同一输入配对数 2 掉到 0（第二个判别面）', () => {
    const Q = String.fromCharCode(39)
    const src = `a(${Q}//${Q}, spawnSync(y))\n`
    expect(scanBrackets(src).parens.length).toBe(2)
    expect(scanBracketsBuggy(src).parens.length).toBe(0)
  })

  it('反向诚实：转义引号那一例**没有**判别力（fixed 与 buggy 都是 2）⇒ 不许把它算作"证到了修复"', () => {
    const src = "a('it" + "\\" + "'s (b', c())"
    expect(scanBrackets(src).parens.length).toBe(2)
    expect(scanBracketsBuggy(src).parens.length).toBe(2)
  })
})

describe('已知盲区写成实测形状，不留给下一轮猜', () => {
  it('模板串 ${} 插值里的括号不计数（少记方向）：run(`x ${f(1)} y`, g()) ⇒ 2 对而不是 3 对', () => {
    expect(scanBrackets('run(`x ${f(1)} y`, g())\n').parens.length).toBe(2)
  })

  it('正则字面量里的括号**会**被当代码计数 ⇒ 会让 needle 掉出采集范围（方向仍是少记，但必须在册）', () => {
    const Q = String.fromCharCode(39)
    const withRe = `f(/)/, ${Q}scripts/z.mjs${Q})`
    const withoutRe = `f(q, ${Q}scripts/z.mjs${Q})`
    const needleIn = (src) => scanBrackets(src).parens.filter(([a, b]) => src.slice(a, b + 1).includes('scripts/z.mjs')).length
    expect(needleIn(withoutRe)).toBe(1) // 对照组：正常配对能取回脚本名
    expect(needleIn(withRe)).toBe(0)    // 正则里那个 ) 提前闭合外层 ⇒ 采集面被截断
  })
})

describe('活体腿：采集层必须把真仓里的真文件读对一次（正向断言，不是只靠"方向安全"的承诺）', () => {
  const real = (p) => readFileSync(join(ROOT, p), 'utf8')

  it('一手事故文件 tests/docCommands.test.js：spawnSync 的配对原文现在取得回来（修前是 0）', () => {
    const src = real('tests/docCommands.test.js')
    // 变化探测器按**它自己写的程序**更新（"再增一处 spawnSync 就会红，届时按新形状改断言，不是放宽成 ≥1"）：
    // 第五十轮 R50-H3 在该文件加了 `--check` 的真入口腿 ⇒ 调用点 1 → 2，同时含两词的配对原文 2 → 5
    // （新腿把 `cli` 助手定义在 `it(...)` 回调里 ⇒ 外层 `it(` 的那一对也同时含 `process.execPath` 与 `SCRIPT`）。
    // 第五十三轮 E1 又在该文件加了"牙齿腿"（git archive / tar / ls-files 三处真起子进程）⇒ 调用点 2 → 6，
    // 而含两词的配对原文仍是 5（新那三处不含 `SCRIPT` 标识符，没落进这一档）。复算命令（不依赖任何临时脚本）：
    //   node --input-type=module -e "import('./scripts/check-cli-entrypoints.mjs').then(m=>{const s=require('fs').readFileSync('tests/docCommands.test.js','utf8');const t=m.scanBrackets(s).parens.map(([a,b])=>s.slice(a,b+1));console.log((s.match(/spawnSync\\(/g)||[]).length, t.filter(x=>x.includes('process.execPath')&&x.includes('SCRIPT')).length)})"
    // 第六十七轮 E2 又在该文件加了"牙齿腿"（git archive / tar / 拆钩子腿跑真进程三处起子进程）
    // ⇒ 调用点 6 → 9；含两词的配对原文仍是 5（新增三处都不含 `SCRIPT` 标识符，没落进这一档）。
    // 第六十八轮又加了一组（`--update` 一趟到位的三条腿：基线/主腿/变异腿，共用一个 `runIn` 助手）
    // ⇒ 调用点 9 → 10；配对原文仍是 5（`runIn` 里传的是 `join(dir,'scripts',…)`，不含 `SCRIPT` 标识符）。
    // ⚠️ 本轮同时否证了下面那条"复算命令"：它在 `--input-type=module` 里用 `require` ⇒ Node 24 直接
    //    `ReferenceError: require is not defined`，也就是说照着它跑会得到"没数"而不是"数变了"。
    //    换成 ESM 可用的形态（下面两行），并且这条命令本身从此由本用例的输出对账。
    // 复算：node --input-type=module -e "import {readFileSync} from 'node:fs';
    //   const m = await import('./scripts/check-cli-entrypoints.mjs');
    //   const s = readFileSync('tests/docCommands.test.js','utf8');
    //   const t = m.scanBrackets(s).parens.map(([a,b]) => s.slice(a,b+1));
    //   console.log((s.match(/spawnSync\(/g)||[]).length, t.filter(x=>x.includes('process.execPath')&&x.includes('SCRIPT')).length)"
    // 数值仍然写死而不改成 ≥：这条腿的全部价值就是"形状变了必须有人来看一眼"。
    expect((src.match(/spawnSync\(/g) || []).length).toBe(10)
    const texts = scanBrackets(src).parens.map(([a, b]) => src.slice(a, b + 1))
    expect(texts.filter((t) => t.includes('process.execPath') && t.includes('SCRIPT')).length).toBe(5)
    expect(texts.some((t) => t.includes('--check')), '新腿的 CLI 调用必须也在采集面里（否则采集又漏了一次）').toBe(true)
  })

  it('判据自己的源码能读对：main() 里每个左括号都有配对右括号（无残留 ⇒ 状态机没被中文/引号骗走）', () => {
    const src = real('scripts/check-cli-entrypoints.mjs')
    const opens = (src.match(/\(/g) || []).length
    const closes = (src.match(/\)/g) || []).length
    expect(closes).toBeLessThanOrEqual(opens)
    expect(scanBrackets(src).parens.length).toBeGreaterThan(150)
  })

  it('端到端：这条修复在采集器上的后果是可复算的 —— 事故件里的脚本名算"已覆盖"', () => {
    const covered = collectCovered(ROOT)
    expect([...covered.keys()]).toContain('check-doc-commands.mjs')
    expect(covered.get('check-doc-commands.mjs').size).toBeGreaterThan(0)
  })
})
