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
const ev = (over = {}) => evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText, ...over })

describe('分母自证（判据的人口由 schema 得出，不靠人记）', () => {
  it('正向：解析到 9 张表、47 列行、3 张豁免；真仓 11 条判据全绿', () => {
    expect(real.tables.size).toBe(9)
    expect(real.rows.length).toBe(47)
    expect(real.exempt.size).toBe(3)
    const failed = ev().filter((v) => !v.ok).map((v) => `${v.id} ${v.detail}`)
    expect(failed).toEqual([])
    expect(ev().map((v) => v.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'])
  })
  it('归因纠正：schema.sql 单独也建了全部 9 张表 —— 第一版漏表是我 grep 窗口截断，不是文件范围', () => {
    const onlySchema = parseSchemaTables([{ rel: 'db/schema.sql', sql: readFileSync('db/schema.sql', 'utf8') }])
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
    const rows = baseRows.map((r) => (r.table === 'orders' && r.column === 'wechat' ? { ...r, basis: '微信标识会被带到外部服务里使用' } : r))
    expect(evaluate({ tables: real.tables, rows, exempt: real.exempt, exportCols: real.exportCols, mdText: real.mdText })
      .find((v) => v.id === 'P8').detail).toContain('orders.wechat')
  })
  it('反例：整篇删掉「已知缺口」节 ⇒ P9 红（无通道的账不许悄悄存在）', () => {
    const trimmed = real.mdText.split('## 已知缺口')[0]
    expect(evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols, mdText: trimmed })
      .find((v) => v.id === 'P9').detail).toContain('已知缺口')
  })
  it('反例：缺口节点名了 ai_calls 但漏了 rate_limits ⇒ P9 只点名漏的那张', () => {
    const md = real.mdText.replace(/`rate_limits\.bucket` 里的 IP 无清理通道/, 'X').replace(/`rate_limits\.bucket`/, 'X')
    const v = evaluate({ tables: real.tables, rows: baseRows, exempt: real.exempt, exportCols: real.exportCols, mdText: md })
      .find((x) => x.id === 'P9')
    expect(v.ok).toBe(false)
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
