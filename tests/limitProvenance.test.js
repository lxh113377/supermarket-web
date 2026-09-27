// 对标第十七轮：上限溯源判据的反向验证。
// 每条反例只绑一条判据 id，并保留"真仓全绿"对照 —— 否则不知道红是机制还是永真。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  census, evaluate, parseRegistry, loadAll, PLATFORM_FACTS,
} from '../scripts/check-limit-provenance.mjs'

const real = () => loadAll()
const RED = (v, id) => v.filter((x) => x.id === id && !x.ok).map((x) => x.label)
const withRows = (src, mutate) => {
  const rows = JSON.parse(JSON.stringify(src.rows))
  mutate(rows)
  return rows
}

describe('对照与零输入', () => {
  it('真仓现状 ⇒ 9 条判据全绿（C8 由第十八轮 M6 新增）', () => {
    const s = real()
    const v = evaluate(s)
    expect(v.length).toBeGreaterThanOrEqual(9)
    expect(v.filter((x) => !x.ok).map((x) => x.label)).toEqual([])
  })

  it('L1 普查面为空 ⇒ C1 判红（取数链断了绝不记 PASS）', () => {
    const s = real()
    expect(RED(evaluate({ ...s, items: [] }), 'C1')).toHaveLength(1)
  })

  it('L2 登记册为空 ⇒ C1 判红', () => {
    const s = real()
    expect(RED(evaluate({ ...s, rows: [] }), 'C1')).toHaveLength(1)
  })
})

describe('双向对账：漏登与死行', () => {
  it('L3 新增一个未登记的上限 ⇒ C2 点名它', () => {
    const s = real()
    const v = evaluate({ ...s, items: [...s.items, { key: 'functions/x.js#分页#777', file: 'functions/x.js', shape: '分页', value: 777, line: 1 }] })
    expect(v.find((x) => x.id === 'C2' && !x.ok).detail).toContain('functions/x.js#分页#777')
  })

  it('L4 登记册里留着一行代码已不存在的上限 ⇒ C4 判红（防潜伏死行）', () => {
    const s = real()
    const rows = [...s.rows, { file: 'functions/lib/actions/products.js', shape: '分页', value: '9999', kind: 'perf', basis: '代码里早就没有这个数了，行还留着'.padEnd(20, '字') }]
    const v = evaluate({ ...s, rows })
    expect(RED(v, 'C4')).toHaveLength(1)
    expect(v.find((x) => x.id === 'C4' && !x.ok).detail).toContain('9999')
  })
})

describe('来源类别与依据', () => {
  it('L5 类别写成 magic ⇒ C3 判红', () => {
    const s = real()
    const rows = withRows(s, (r) => { r[0].kind = 'magic' })
    expect(RED(evaluate({ ...s, rows }), 'C3')).toHaveLength(1)
  })

  it('L6 依据是 --emit 的 TODO 骨架 ⇒ C3b 判红（不许自动生成冒充已论证）', () => {
    const s = real()
    const rows = withRows(s, (r) => { r[1].basis = 'TODO：追到哪个真实约束' })
    expect(RED(evaluate({ ...s, rows }), 'C3b')).toHaveLength(1)
  })

  it('L7 依据空洞（少于 14 字）⇒ C3b 判红', () => {
    const s = real()
    const rows = withRows(s, (r) => { r[2].basis = '就这么大' })
    expect(RED(evaluate({ ...s, rows }), 'C3b')).toHaveLength(1)
  })
})

describe('C5 平台预算对账（本轮真正抓到 200 的那条）', () => {
  it('L8 把 batchUpdate 的上限改回 200 ⇒ C5 判红并给出 200 > 50', () => {
    const s = real()
    const rows = withRows(s, (r) => {
      const hit = r.find((x) => x.key === 'functions/lib/actions/products.js#常量#BATCH_UPDATE_MAX=40'
        || `${x.file}#${x.shape}#${x.value}` === 'functions/lib/actions/products.js#常量#BATCH_UPDATE_MAX=40')
      hit.value = 'BATCH_UPDATE_MAX=200'
    })
    const v = evaluate({ ...s, rows, items: [...s.items.map((i) => (i.key.endsWith('BATCH_UPDATE_MAX=40') ? { ...i, value: 200, key: i.key.replace('=40', '=200') } : i))] })
    const bad = v.find((x) => x.id === 'C5' && !x.ok)
    expect(bad, '值 200 必须撞 d1_queries_per_invocation_free=50').toBeTruthy()
    expect(bad.detail).toContain('200')
  })

  it('L9 声称 platform 却不点名任何平台事实 ⇒ C5 判红（不许拿"平台有限制"含糊过去）', () => {
    const s = real()
    const rows = withRows(s, (r) => {
      const hit = r.find((x) => x.kind === 'platform')
      hit.basis = '平台有某种限制，具体哪条忘了写'
    })
    expect(RED(evaluate({ ...s, rows }), 'C5')).toHaveLength(1)
  })

  it('平台事实表自身可核：50 是免费档、1000 是付费档、单语句 100000 bytes', () => {
    expect(PLATFORM_FACTS.d1_queries_per_invocation_free.max).toBe(50)
    expect(PLATFORM_FACTS.d1_queries_per_invocation_paid.max).toBe(1000)
    expect(PLATFORM_FACTS.d1_statement_bytes.max).toBe(100_000)
    expect(PLATFORM_FACTS.sqlite_bound_params.max).toBe(999)
  })
})

describe('C6/C7 与枚举器边界', () => {
  it('L10 删掉 WORKERS_PLAN 行 ⇒ C6 判红（引用了档位相关事实却没登记档位）', () => {
    const s = real()
    expect(s.planRegistered).toBeTruthy()
    expect(RED(evaluate({ ...s, planRegistered: '' }), 'C6')).toHaveLength(1)
  })

  it('L11 判据自己进了普查面 ⇒ C7 判红（否则 PLATFORM_FACTS 的 50/999 自证成上限）', () => {
    const s = real()
    const v = evaluate({ ...s, items: [...s.items, { key: 'scripts/check-limit-provenance.mjs#分页#999', file: 'scripts/check-limit-provenance.mjs', shape: '分页', value: 999, line: 1 }] })
    expect(RED(v, 'C7')).toHaveLength(1)
  })

  it('枚举器双向验：注释里的数字不算上限，代码里的算', () => {
    const code = [
      "// 远低于 SQLite 999 参数上限，这里 LIMIT 12345 只是注释",
      "export async function f(DB) { return await qAll(DB, 'SELECT 1 FROM products LIMIT 6', []) }",
    ].join(String.fromCharCode(10))
    const items = census([{ rel: 'functions/lib/probe.js', code }])
    const vals = items.map((i) => i.value)
    expect(vals).toContain(6)
    expect(vals).not.toContain(12345)
  })

  it('块注释（JSDoc）里的数字也不算上限 —— 第三十七轮一手反例：我在 shared.js 的 JSDoc 里写对比说明，被普查当成第 8 个上限', () => {
    const code = [
      '/**',
      ' * 改前全仓有 5 处各说各话：submissions `2 * 1024 * 1024`、orders `800 * 1024`。',
      ' * 这些是散文里的数字，不是会砍东西的数。',
      ' */',
      'export const MAX_STATEMENT_PAYLOAD_CHARS = 90_000',
      "export async function f(DB, xs) { if (xs.length > 5) return null; return xs }",
    ].join(String.fromCharCode(10))
    const items = census([{ rel: 'functions/lib/prose.js', code }])
    const vals = items.map((i) => i.value)
    expect(vals, '散文里的 2/800 被当成了上限 ⇒ 取数面把注释当数据').not.toContain(2)
    expect(vals).not.toContain(800)
    expect(vals).toContain(90000)
    expect(vals).toContain(5)
    // 剥注释必须**保行号**：否则登记册/告警指到的行是错的。期望值由同一份原文自己数出来，
    // 不靠手数（手数是第 ㉑ 形态：期望集被实测扩大/缩小后照样打 HIT）。
    const rawLines = code.split('\n')
    const want = rawLines.findIndex((l) => l.includes('xs.length > 5')) + 1
    const five = items.find((i) => i.value === 5)
    expect(want, '夹具自身的行号事实').toBe(6)
    expect(five.line, `块注释被剥掉后行号漂移（期望 ${want}）`).toBe(want)
  })

  it('六类形态各自能被枚举到（漏一类就是一整族上限隐身）', () => {
    const code = [
      'export const MAX_THING = 42',
      "export async function f(DB, xs) {",
      "  if (xs.length > 7) return null",
      "  const a = xs.slice(0, 8)",
      "  const b = 3 * 1024",
      "  DB.prepare(\"DELETE FROM t WHERE ts < datetime('now', '-9 days')\").run()",
      "  return DB.prepare('SELECT 1 FROM t LIMIT 11').all()",
      '}',
    ].join(String.fromCharCode(10))
    const shapes = new Set(census([{ rel: 'functions/lib/probe2.js', code }]).map((i) => i.shape))
    for (const want of ['拒绝型', '截断型', '体积型', '保留期', '分页', '常量']) {
      expect(shapes.has(want), `形态 ${want} 未被枚举到`).toBe(true)
    }
  })

  it('登记册解析器自证：只认声明前缀（functions/ + src/）的数据行，表头与分隔行不算', () => {
    const md = readFileSync('docs/limit-provenance.md', 'utf8')
    const rows = parseRegistry(md)
    expect(rows.length).toBeGreaterThan(30)
    // 第十八轮 M6 把 src/ 纳入面 ⇒ 旧断言"全部以 functions/ 开头"变成**错的界**，
    // 这里重新划界并同时留对偶断言：src/ 必须真在里面（扩面不是只改了句声明），
    // 而面外目录（scripts//docs//tests/）一件都不许被认进来（否则判据自己给自己登记）。
    expect(rows.every((r) => /^(functions|src)\//.test(r.file))).toBe(true)
    expect(rows.some((r) => r.file.startsWith('src/'))).toBe(true)
    expect(rows.some((r) => /^(scripts|docs|tests|db)\//.test(r.file))).toBe(false)
    expect(rows.some((r) => r.file.includes('来源类别') || r.shape === '类型')).toBe(false)
  })
})

// 第三十八轮 R38-H3：行尾注释按解析器区间剥除（R37 只剥了块注释，册上还写着"行尾未覆盖"）。
describe('取数面第二半：行尾注释精确剥除，且不伤含 // 的字符串', () => {
  it('真上限在代码里、注释里另有一个数 ⇒ 只算真的那个（含 URL 的行不被误剥）', () => {
    const code = [
      "export async function f(DB, xs) {",
      "  if (xs.length > 7) return null // 曾经写成 999，见 docs/limit-provenance.md",
      "  const y = xs.slice(0, 9) // 文档站 https://example.com/a//b 里也有双斜杠",
      "  const url = 'https://developers.cloudflare.com/x' // 平台事实来源",
      "  return DB.prepare('SELECT 1 FROM t LIMIT 13').all()",
      '}',
    ].join(String.fromCharCode(10))
    const vals = census([{ rel: 'functions/lib/tail.js', code }], (m) => { throw new Error(`不该有解析失败：${m}`) }).map((i) => i.value)
    expect(vals).toEqual(expect.arrayContaining([7, 9, 13]))
    expect(vals, '注释里的 999 被当成上限 ⇒ 行尾剥除没生效').not.toContain(999)
    expect(vals, 'URL 字符串被误剥会连带吃掉同行代码里的数').toContain(9)
  })
  it('反向对照：把注释放最前也照样只算代码（防"只测了一种位置"）', () => {
    const code = '// 说明：这里曾有 800 * 1024 的假上限\nexport const MAX_X = 42\n'
    const vals = census([{ rel: 'functions/lib/head.js', code }]).map((i) => i.value)
    expect(vals).toContain(42)
    expect(vals).not.toContain(800)
  })
  it('解析失败 ⇒ 降级朴素剥除并**点名**（静默退回弱口径就是假覆盖面）', () => {
    const errs = []
    const broken = 'export const o = { 坏语法 (((( }'
    census([{ rel: 'functions/lib/broken.js', code: broken }], (m) => errs.push(m))
    expect(errs.join(' '), '降级没被报告').toContain('降级')
  })
})
