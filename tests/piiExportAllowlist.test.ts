// 对标第十九轮 H4：把"顾客端/后台的对外数据出口不含个人敏感列"从**当前恰好如此**
// 升级成**改动时必须做一次有意识的决定**。
//
// 为什么是白名单而不是黑名单（本轮实测的起点）：
//   `grep wechat|paymentScreenshot src/components/OrdersTab.tsx src/utils/csv.ts` 命中 0
//   ⇒ 导出面今天干净。但这是**没被钉住的事实**：谁在表头里加一列"微信号"方便对账，
//   全链没有任何一道闸会拦，而 orders 表里 `wechat`/`paymentScreenshot` 两列确实存着
//   （db/schema.sql:37,39），`getOrders` 还把它们原样发给后台（actions/orders.js SELECT 未做投影裁剪）。
//   黑名单只能挡住已知的名字；白名单会让"多加一列"这件事当场判红，逼人来登记册表态。
//
// 形态沿用本仓先例：两侧同值用**等号**而不是 <=（tests/batchChunkContract.test.ts），
// 且判据自身要有会红的反例（下面「反例」那组用例就是负向对照）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const ORDERS_TAB = readFileSync('src/components/OrdersTab.tsx', 'utf8').replace(/\r\n/g, '\n')
const CSV_LIB = readFileSync('src/utils/csv.ts', 'utf8').replace(/\r\n/g, '\n')

/**
 * 允许出现在**对外文件**（CSV 下载、剪贴板）里的列。
 * 加一列的唯一正当路径：先确认它不是个人数据，再把名字写进这里并说明理由。
 */
const EXPORT_HEADER_ALLOWLIST = ['房间号', '商品', '口味', '数量', '单价', '小计', '优惠', '状态', '时间']

/** 任何情况下都不许离开数据库的列（个人数据 / 支付凭证）。 */
const NEVER_EXPORT = ['wechat', 'paymentScreenshot', '微信号', '截图', 'adminKey', 'idempotencyKey']

const headerMatch = /buildCsvText\(\[([^\]]*)\]/.exec(ORDERS_TAB)

describe('R19-H4 导出面个人数据白名单', () => {
  it('接线：CSV 表头确实解析到了（改名/换写法会让本判据静默失效）', () => {
    expect(headerMatch, '没解析到 buildCsvText([...]) 的表头数组').toBeTruthy()
    const cols = headerMatch![1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    expect(cols.length).toBeGreaterThan(0)
  })

  it('正向：CSV 表头集合 == 白名单（等号，多一列少一列都红）', () => {
    const cols = headerMatch![1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    expect(cols).toEqual(EXPORT_HEADER_ALLOWLIST)
  })

  it('对偶：表头里一件敏感列都不许出现（双向独立核，不是只比白名单）', () => {
    const headerLine = headerMatch ? headerMatch[0] : ''
    for (const bad of NEVER_EXPORT) expect(headerLine).not.toContain(bad)
  })

  it('导出取值行不引用 wechat / paymentScreenshot（含剪贴板 copyOrder 那条出口）', () => {
    // exportCSV 的 rows 构造 + copyOrder 的 text 模板：两处都是"离开浏览器"的出口
    const exportBlock = /const exportCSV[\s\S]*?\n  \}/.exec(ORDERS_TAB)
    const copyBlock = /const copyOrder[\s\S]*?\n  \}/.exec(ORDERS_TAB)
    expect(exportBlock, '没解析到 exportCSV 函数体').toBeTruthy()
    expect(copyBlock, '没解析到 copyOrder 函数体').toBeTruthy()
    for (const block of [exportBlock![0], copyBlock![0]]) {
      for (const bad of ['o.wechat', 'order.wechat', 'paymentScreenshot']) expect(block).not.toContain(bad)
    }
  })

  it('反例 a（负向对照）：往表头塞一列"微信号" ⇒ 白名单断言必须翻红', () => {
    const tampered = ORDERS_TAB.replace(
      /buildCsvText\(\[([^\]]*)\]/,
      "buildCsvText([$1, '微信号']",
    )
    const cols = /buildCsvText\(\[([^\]]*)\]/.exec(tampered)![1]
      .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    expect(cols).not.toEqual(EXPORT_HEADER_ALLOWLIST)
    expect(cols).toContain('微信号')
  })

  it('反例 b：取值行引用 o.paymentScreenshot ⇒ 出口断言必须翻红', () => {
    const tampered = ORDERS_TAB.replace(
      /const exportCSV[\s\S]*?statusLabel\(o\.status\),/,
      '$&\n          o.paymentScreenshot,',
    )
    const block = /const exportCSV[\s\S]*?\n {2}\}/.exec(tampered)![0]
    expect(block).toContain('paymentScreenshot')
  })

  it('边界：判据自身与被扫文件都在仓内可读（防"0 命中=通过"的假绿）', () => {
    // 这条存在的理由：如果 ORDERS_TAB 被读成空串，上面所有 not.toContain 都会静默通过。
    expect(ORDERS_TAB.length).toBeGreaterThan(1000)
    expect(CSV_LIB.length).toBeGreaterThan(100)
    expect(ORDERS_TAB).toContain('buildCsvText')
  })

  it('白名单本身不含敏感名（登记册写错也要红）', () => {
    for (const col of EXPORT_HEADER_ALLOWLIST) {
      for (const bad of NEVER_EXPORT) expect(col).not.toContain(bad)
    }
    expect(new Set(EXPORT_HEADER_ALLOWLIST).size).toBe(EXPORT_HEADER_ALLOWLIST.length)
  })
})
