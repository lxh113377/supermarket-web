// 第二十轮夹具：个人数据登记册判据的双向变异审计。
// 每条判据都要"正例不误伤 + 反例真会红"，且**分母禁由手抄清单得出**（P0 的自证靠 schema 解析）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  evaluate, loadAll, parseInventory, parseSchemaTables, parseExportAllowlist,
  CATEGORIES, VISIBILITY, EXPORT_TABLE,
} from '../scripts/check-pii-inventory.mjs'

const real = loadAll()
const baseRows = real.rows.map((r) => ({ ...r }))
const ev = (over = {}) => evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols,
  mdText: real.mdText, aiSlice: real.aiSlice, difySlice: real.difySlice, ...over })

describe('分母自证（判据的人口由 schema 得出，不靠人记）', () => {
  it('正向：解析到 12 张表、62 列行、4 张豁免；真仓 12 条判据全绿', () => {
    // 分母 9→10 张表 / 47→58 列：第五十六轮 E7 加 `stock_movements`（11 列整张进覆盖表，
    // 含自由文本 note，所以是覆盖而不是豁免）。本行数值由解析器当场给出，判据不抄第二份清单。
    // 分母 10→12 张表 / 58→62 列 / 3→4 豁免：第五十八轮 P2 满减轨加 `order_discounts`（4 列进覆盖表，
    // orderId 删单成孤儿故缺口挂账）与 `promotions`（商家配置表进豁免）。R58-H1 收尾补登记。
    expect(real.tables.size).toBe(12)
    expect(real.rows.length).toBe(62)
    expect(real.exempt.size).toBe(4)
    const failed = ev().filter((v) => !v.ok).map((v) => `${v.id} ${v.detail}`)
    expect(failed).toEqual([])
    expect(ev().map((v) => v.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'])
  })
  it('归因纠正：schema.sql 单独建出全部 12 张表（满减轨两表已回填，不再是"只活在迁移里"）', () => {
    const onlySchema = parseSchemaTables([{ rel: 'db/schema.sql', sql: readFileSync('db/schema.sql', 'utf8') }])
    // 第一版漏表是我 grep 窗口截断，不是文件范围；R58-H1 核实：promotions/order_discounts
    // 已由第五十八轮回填进 schema.sql（migrate-promotions.sql 保留作迁移重放），故相等形仍然成立
    expect([...onlySchema.keys()].sort()).toEqual([...real.tables.keys()].sort())
    // 全量文件仍是必要设计：迁移可以建出 schema.sql 尚未回填的表，那种表躲不过本判据
    const extra = parseSchemaTables([
      { rel: 'db/schema.sql', sql: readFileSync('db/schema.sql', 'utf8') },
      { rel: 'db/migrate-future.sql', sql: 'CREATE TABLE IF NOT EXISTS audit_trail (\n  id INTEGER PRIMARY KEY,\n  phone TEXT\n);' },
    ])
    expect([...extra.keys()]).toContain('audit_trail')
    expect(extra.get('audit_trail')).toEqual(['id', 'phone'])
  })
  it('边界：空分母不许被读成通过（P1 必须红）', () => {
    expect(evaluate({ tables: new Map(), rows: [], exempt: new Map(), exportCols: null, mdText: '' }).find((v) => v.id === 'P1').ok).toBe(false)
  })
})

describe('P3/P4 列级穷举与死行', () => {
  it('反例：删掉 orders.wechat 一行 ⇒ P3 立刻点名该列', () => {
    const rows = baseRows.filter((r) => !(r.table === 'orders' && r.column === 'wechat'))
    expect(evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P3').detail).toContain('orders.wechat')
  })
  it('反例：加一条 schema 里不存在的列 ⇒ P4 红（删行只会触发 P3，两者必须分得开）', () => {
    const rows = [...baseRows, { table: 'orders', column: 'ghost_col', category: '运营', visibility: 'admin', egress: '否', retention: 'x', deletion: 'y', exported: '否', basis: '这是一条不存在的列，用来验死行判据', line: '' }]
    const v = evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
    expect(v.find((x) => x.id === 'P4').ok).toBe(false)
    expect(v.find((x) => x.id === 'P4').detail).toContain('ghost_col')
  })
  it('反例：新建一张表而册里既无覆盖也无豁免 ⇒ P3 红', () => {
    const tables = new Map(real.tables); tables.set('customer_notes', ['id', 'phone'])
    expect(evaluate({ tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P3').detail).toContain('customer_notes')
  })
  it('反例：同一张表既进豁免又有列行 ⇒ P3 红（双向都算不一致）', () => {
    const exempt = new Map(real.exempt); exempt.set('orders', '仅为验证判据临时豁免：订单表其实 11 列都在册，这种自相矛盾必须被 P3 抓到')
    expect(evaluate({ tables: real.tables, rows: baseRows, exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P3').ok).toBe(false)
  })
})

describe('P5/P6 依据质量与豁免可信度', () => {
  it('反例：把某行依据换成 TODO ⇒ P5 红', () => {
    const rows = baseRows.map((r) => (r.table === 'orders' && r.column === 'wechat')
      ? { ...r, basis: 'TODO：追到哪个流程会读它' } : r)
    expect(evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P5').ok).toBe(false)
  })
  it('反例：类别写成非法枚举 ⇒ P5 红（"敏感"这种自造词不许蒙混）', () => {
    const rows = baseRows.map((r) => (r.column === 'ip' ? { ...r, category: '敏感' } : r))
    expect(evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P5').detail).toContain('敏感')
  })
  it('反例：豁免只写"非个人数据"四个字 ⇒ P6 红（空话不算豁免）', () => {
    const exempt = new Map(real.exempt); exempt.set('products', '非个人数据')
    const v = evaluate({ tables: real.tables, rows: baseRows, exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((x) => x.id === 'P6')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('products')
  })
})

describe('P7 与导出面判据互锁（派生值不手填）', () => {
  it('正向：导出白名单反推出的列集合与册内标"是"的一致', () => {
    const claimed = baseRows.filter((r) => r.table === EXPORT_TABLE && r.exported === '是').map((r) => r.column).sort()
    expect(claimed).toEqual(['createdAt', 'items', 'roomNumber', 'status'])
  })
  it('反例：把 orders.roomNumber 改成"否" ⇒ P7 红（册与白名单脱钩即不一致）', () => {
    const rows = baseRows.map((r) => (r.table === 'orders' && r.column === 'roomNumber' ? { ...r, exported: '否' } : r))
    expect(evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P7').ok).toBe(false)
  })
  it('反例：导出白名单加一列"微信号"而映射表没有它 ⇒ P7 红（加列必须来这里表态）', () => {
    const cols = [...real.exportCols, '微信号']
    expect(evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: cols, mdText: real.mdText })
      .find((v) => v.id === 'P7').detail).toContain('微信号')
  })
  it('边界：解析不到导出白名单 ⇒ P1 红而不是"空集合=通过"', () => {
    expect(parseExportAllowlist('export const OTHER = []')).toBeNull()
    expect(evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: null, mdText: real.mdText })
      .find((v) => v.id === 'P1').ok).toBe(false)
  })
})

describe('P8/P9 出境凭据与无通道挂账', () => {
  it('反例：出境列去掉行号 ⇒ P8 红（不许只写"会送给第三方"）', () => {
    // 第二十四轮起 wechat 在册是"否"（它从没真的出境），所以这条反例必须**同时**把它标回"是"，
    // 否则测的是"一列都不出境"那条对偶分支（见下方 P8 零输入对偶），不是行号凭据分支。
    const rows = baseRows.map((r) => (r.table === 'orders' && r.column === 'wechat'
      ? { ...r, egress: '是', basis: '微信标识会被带到外部服务里使用' } : r))
    expect(evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText, aiSlice: real.aiSlice, difySlice: real.difySlice })
      .find((v) => v.id === 'P8').detail).toContain('orders.wechat')
  })
  it('反例：整篇删掉「已知缺口」节 ⇒ P9 红（无通道的账不许悄悄存在）', () => {
    const trimmed = real.mdText.split('## 已知缺口')[0]
    expect(evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols, mdText: trimmed })
      .find((v) => v.id === 'P9').detail).toContain('已知缺口')
  })
  it('反例：缺口节点名了 ai_calls 但漏了 rate_limits ⇒ P9 只点名漏的那张', () => {
    // 两条 replace 都必须**全局**：上一版无 /g，只抹掉第一次出现。第五十六轮 E7 之后
    // stock_movements 那条缺口在散文里又提了一次 rate_limits ⇒ 非全局版抹不干净，P9 照样点名不到，
    // 这条反例就此变成"测的是夹具里剩下的那句提及"而不是"测 P9 有没有牙齿"（实测 expected true to be false）。
    const md = real.mdText.replace(/`rate_limits\.bucket` 里的 IP 无清理通道/g, 'X').replace(/`rate_limits\.bucket`/g, 'X')
      .replace(/rate_limits/g, 'X')
    const v = evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols, mdText: md })
      .find((x) => x.id === 'P9')
    expect(v.ok, '缺口节点里已无 rate_limits 字样，P9 却放行 ⇒ 这条反例没有对象了').toBe(false)
    expect(v.detail).toContain('rate_limits')
    expect(v.detail).not.toContain('ai_calls')
  })
})

describe('枚举与自面排除', () => {
  it('类别/可见性枚举集合固定（加一类必须先改判据并说明理由）', () => {
    expect([...CATEGORIES]).toEqual(['个人数据', '凭证', '派生', '运营'])
    expect([...VISIBILITY]).toEqual(['pub', 'admin', 'internal'])
  })
  it('正向：登记册里没有任何 scripts/docs/tests 表名（判据不给自己登记）', () => {
    expect(baseRows.some((r) => /scripts|docs|tests/.test(r.table))).toBe(false)
  })
  it('parseInventory 对混合表头不误收（散文里的竖线行不算数据行）', () => {
    const p = parseInventory('| 列 | 类别 | 可见性 | 出境 | 保留 | 删除通道 | 进导出 | 依据 |\n|---|---|---|---|---|---|---|---|\n散文 | 文字\n')
    expect(p.rows).toEqual([])
  })
})

describe('P12 出境链投影 ⇄ 引用集互锁（第二十四轮 H7 的守门人）', () => {
  it('正向：真仓投影三列全部被下游引用，零白读', () => {
    const v = ev().find((x) => x.id === 'P12')
    expect(v.ok).toBe(true)
    expect(v.detail).toContain('items')
  })
  it('反例：把 wechat 塞回投影 ⇒ 判红并点名（"加一列微信号"当场变红）', () => {
    const v = ev({ aiSlice: real.aiSlice.replace('SELECT items, totalAmount, createdAt', 'SELECT items, totalAmount, createdAt, wechat') }).find((x) => x.id === 'P12')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('白读列: wechat')
  })
  it('反例：引用的列被从投影里删掉 ⇒ 判红（防止改形把判据修瞎）', () => {
    const v = ev({ aiSlice: real.aiSlice.replace('SELECT items, totalAmount, createdAt', 'SELECT items, totalAmount') }).find((x) => x.id === 'P12')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('引用了却没投影')
  })
  it('边界：解析不到投影（SELECT 改形）⇒ 判红而不是"空集合=通过"', () => {
    const v = ev({ aiSlice: '' }).find((x) => x.id === 'P12')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('未解析到')
  })
})

describe('P8 零输入对偶（一列都不出境时必须有点名第三方调用的声明）', () => {
  it('正向：0 列出境 + 「出境面」节点名 pubAiChat ⇒ 绿', () => {
    const v = ev().find((x) => x.id === 'P8')
    expect(v.ok).toBe(true)
    expect(v.detail).toContain('0 列出境')
  })
  it('反例：把出境列全标否**并**抹掉零出境声明 ⇒ 判红（"标否即清白"不成立）', () => {
    const noDecl = real.mdText.replace(/^##\s*出境面[\s\S]*?(?=^##\s*已知缺口)/m, '')
    const v = ev({ mdText: noDecl }).find((x) => x.id === 'P8')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('不接受')
  })
  it('反例：恢复一列出境但去掉行号 ⇒ 判红（旧那条判据仍然有效）', () => {
    const rows = real.rows.map((r) => (r.table === 'orders' && r.column === 'wechat' ? { ...r, egress: '是', basis: '会送给第三方（无凭据）' } : { ...r }))
    const v = ev({ rows }).find((x) => x.id === 'P8')
    expect(v.ok).toBe(false)
    expect(v.detail).toContain('orders.wechat')
  })
})
