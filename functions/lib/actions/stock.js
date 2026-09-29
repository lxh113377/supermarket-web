// 库存域（第五十六轮 E7 新增）：流水只读视图 + 手工调整写入口。
//
// 为什么单独立一个域而不是往 products.js 里加两个 case：这一轮的对标结论是
// 「缺的是采购—库存—对账这条闭环，不是模块数少」（报告 §3 功能维）。把它做成一个域，
// 下一轮加采购单/供应商时**加域**而不是继续往商品域里堆字段——
// 参照形状：Medusa 的模块注册面（一个模块一个目录）、ERPNext 的 `erpnext/stock/` 顶层域目录。
import { fail } from '../errors.js'
import { queryMovements, readStockRow, applyStockSnapshot } from '../stock.js'

/** 只读视图：GET 语义，不改任何状态，所以不进 ADMIN_WRITE_ACTIONS */
export async function getStockMovements(DB, payload = {}) {
  return queryMovements(DB, payload)
}

/**
 * 手工调整库存（出入库/盘点纠错的唯一显式入口）。
 *
 * 语义选的是**增量**（delta）而不是绝对值：后台商品编辑那个绝对值入口保留原样
 * （改它要动 BATCH_UPDATE_MAX 的推导链，见报告 §5 E7-b），但手工记账必须能说清"这次进了几件"——
 * 增量形态下即使两个管理员同时改同一商品，流水之和仍等于最终账面（绝对值形态会互相盖掉）。
 *
 * 只服务**有限库存**商品：stock=-1 表示"不限售"，对它记流水没有账面可对 ⇒ 明确拒绝而不是静默成功。
 */
export async function adjustStock(DB, payload = {}) {
  const productId = String(payload.productId || '')
  if (!productId) return fail('missing_product_id', '缺少 productId')
  const delta = Math.trunc(Number(payload.delta))
  if (!Number.isFinite(delta) || delta === 0) return fail('invalid_delta', 'delta 必须是非零整数')
  if (Math.abs(delta) > 100000) return fail('invalid_delta', '单次调整数量过大（|delta| ≤ 100000）')
  const cur = await readStockRow(DB, productId)
  if (!cur) return fail('product_not_found', '商品不存在')
  const before = Number(cur.stock)
  if (before < 0) return fail('stock_untracked', '该商品按"不限售"管理（stock=-1），没有账面可记；请先在商品编辑里填入实际库存')
  const after = before + delta
  if (after < 0) return fail('stock_insufficient', `调整后库存为负（现 ${before}，本次 ${delta}）`)
  const r = await applyStockSnapshot(DB, {
    productId, before, after, kind: 'adjust', refType: 'manual',
    refId: '', actor: 'admin', note: String(payload.note || '').slice(0, 200),
  })
  // 用 `=== false` 而不是 `!r.ok`：本仓 tsconfig.backend 是 strict:false（关 strictNullChecks），
  // 假值窄化在该档下不生效，`!r.ok` 分支里 r 仍是整个联合（实测 TS2339）。等值比较才走判别式窄化。
  if (r.ok === false) return fail(r.errorCode, r.message)
  return { code: 0, data: { productId, before, after, delta: r.delta, recorded: r.recorded } }
}
