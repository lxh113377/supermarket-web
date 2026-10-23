// 纯文件系统扫描（不碰 DOM、不起浏览器）：66ms 量级，放 unit 层而非 visual 层。
// @vitest-environment node
import { test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 原生对话框棘轮（2026-10-23 新增，量「原创性 / 精致度」里最直观的一类痕迹）。
 *
 * 为什么 alert() 判零、confirm() 只登记欠账而不一起清零：
 *   · alert() 是纯展示：阻塞整条线程、样式完全由浏览器决定（与本站暖色品牌毫无关系），
     而且原先三处直接把内部异常串糊在用户脸上（alert('删除失败：' + e.message)）。
     仓库里本来就有正确做法（ReviewsTab 的 formError + role=alert 内联提示），所以那
     4 处属「没统一」，改掉零风险 ⇒ 直接判零。
 *   · confirm() 是同步阻塞式二次确认，换成内联两步确认要改 8 处调用点的控制流；而且
     本仓有硬红线：后台禁弹窗/禁抽屉，唯一交互是内联展开 ⇒ 既不能上自定义 modal，也
     不该在本轮顺手大改控制流。做法是登记为棘轮：现值 8、只准降不准升，将来清一处就
     把上限同步下调。假装它不存在才是问题。
 *
 * 取数口径三处易错（都实测过）：
 *   ① 先剥注释再匹配 —— 本文件注释里就写着 alert( 字样，不剥会自判红；
 *   ② 排除 role="alert" 这类属性值（它们是无障碍设施，不是原生对话框）；
 *   ③ 排除 deferred.prompt() —— 那是 PWA beforeinstallprompt 的 API，不是 window.prompt。
 * 实现刻意用字符状态机而不是正则：可读、且不会被转义层级坑（本会话踩过多次）。
 */

const SRC = join(process.cwd(), 'src')
const FN = join(process.cwd(), 'functions')

/** 把注释替换成空格（保留行号与列位置，便于报出原始行号） */
function blankComments(text: string): string {
  const out: string[] = []
  let i = 0
  let quote = ''
  let inBlock = false
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; out.push(' ', ' '); i += 2; continue }
      out.push(ch === '\n' ? '\n' : ' ')
      i++
      continue
    }
    if (quote) {
      out.push(ch)
      if (ch === '\\') { out.push(next || ''); i += 2; continue }
      if (ch === quote) quote = ''
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out.push(ch); i++; continue }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out.push(' '); i++ }
      continue
    }
    if (ch === '/' && next === '*') { inBlock = true; out.push(' ', ' '); i += 2; continue }
    out.push(ch)
    i++
  }
  return out.join('')
}

const isWord = (c: string) => /[A-Za-z0-9_$]/.test(c)

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p2 = join(dir, e.name)
    if (e.isDirectory()) { out.push(...listFiles(p2)); continue }
    if (!/\.(tsx|ts|js)$/.test(e.name)) continue
    out.push(p2)
  }
  return out
}

interface Hit { file: string; line: number; text: string }

function findNativeDialogs(files: string[], kind: string): Hit[] {
  const hits: Hit[] = []
  for (const f of files) {
    const raw = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    const code = blankComments(raw)
    // 属性值整体抹掉：role="alert" / aria-live="assertive" 不是原生对话框
    const noAttrs = code.replace(/(role|aria-[a-z]+|className)=(["'][^"']*["'])/g, 'x=EMPTY')
    noAttrs.split('\n').forEach((l, idx) => {
      let from = 0
      for (;;) {
        const at = l.indexOf(kind + '(', from)
        if (at < 0) break
        from = at + 1
        const prev = at === 0 ? ' ' : l[at - 1]
        // 前面是标识符字符或点号 ⇒ 是 obj.alert() / beforeinstallprompt( 之类，不算
        if (isWord(prev) || prev === '.') continue
        if (/beforeinstall/i.test(l.slice(Math.max(0, at - 24), at + kind.length + 2))) continue
        hits.push({ file: f.slice(SRC.length + 1).replace(/\\/g, '/'), line: idx + 1, text: l.trim().slice(0, 92) })
        break
      }
    })
  }
  return hits
}

const ALL = [...listFiles(SRC), ...listFiles(FN)]
const fmt = (h: Hit[]) => h.map((x) => '  ' + x.file + ':' + x.line + '  ' + x.text).join('\n')

test('src/functions 不得有原生 alert()', () => {
  const hits = findNativeDialogs(ALL, 'alert')
  expect(hits, '原生 alert() 阻塞整页、样式由浏览器决定，还会把内部异常串直接糊给用户。\n'
    + '正确做法是仓库已有的内联提示（role=alert + aria-live + 品牌色），见 ReviewsTab / SubmissionsTab：\n'
    + fmt(hits)).toEqual([])
})

test('src/functions 不得有原生 prompt()', () => {
  const hits = findNativeDialogs(ALL, 'prompt')
  expect(hits, '原生 prompt() 不属于本站设计语言（PWA 的 deferred.prompt() 已排除）：\n' + fmt(hits)).toEqual([])
})

/**
 * confirm() 棘轮：现值 8（2026-10-23 实测）。只准降不准升 —— 新增处必须改成内联
 * 两步确认（后台禁弹窗红线，不许引入自定义 modal）。清零要改 8 处控制流，属独立
 * 一轮工作；本轮如实登记而不是假装没有。
 */
const CONFIRM_CEILING = 8
test('原生 confirm() 不得超过棘轮上限 ' + CONFIRM_CEILING + '（只准降不准升）', () => {
  const hits = findNativeDialogs(ALL, 'confirm')
  expect(hits.length, '原生 confirm() 从 ' + CONFIRM_CEILING + ' 涨到 ' + hits.length
    + '：新增处必须改成内联两步确认。\n' + fmt(hits)).toBeLessThanOrEqual(CONFIRM_CEILING)
  // 用 warn 不用 log：本仓 lint 是 --max-warnings 0 且 no-console 只放行 warn/error
  // （既有先例见 layout.spec.ts 里量开关几何的那段）
  console.warn('[native-dialogs] confirm() 现值 ' + hits.length + ' / 上限 ' + CONFIRM_CEILING)
})

/**
 * 自证：取数口径必须真有牙齿。若哪天剥注释或属性排除写坏了，上面三条会集体变成
 * 「零命中」的假绿 —— 所以用合成面双向验证（该认出的要认出、不该算的不许算）。
 */
test('判据自证：合成面里该认出的都认出、注释与属性里的不算', () => {
  const probe = [
    'const a = 1',
    "// alert('行注释里的不算')",
    "/* alert('块注释里的也不算') */",
    "alert('真的调用')",
    "if (!confirm('真的确认')) return",
    'deferred.prompt()',
    '<div role="alert" aria-live="assertive">',
  ].join('\n')
  const count = (kind: string) => {
    const noAttrs = blankComments(probe).replace(/(role|aria-[a-z]+|className)=(["'][^"']*["'])/g, 'x=EMPTY')
    let n = 0
    noAttrs.split('\n').forEach((l) => {
      const at = l.indexOf(kind + '(')
      if (at < 0) return
      const prev = at === 0 ? ' ' : l[at - 1]
      if (isWord(prev) || prev === '.') return
      if (/beforeinstall/i.test(l.slice(Math.max(0, at - 24), at + kind.length + 2))) return
      n++
    })
    return n
  }
  expect(count('alert'), '行注释/块注释里的 alert( 不该算，真的调用要算').toBe(1)
  expect(count('confirm'), '真的 confirm( 要算').toBe(1)
  expect(count('prompt'), 'deferred.prompt() 与 role=alert 都不该算').toBe(0)
})
