/**
 * 满减促销最小闭环单测（2026-09-30 对标 P2）。
 * 用 node:sqlite 真库 + schema.sql（非 stub）：不断言 stub 行为，只断言落库事实。
 * 口径：默认种子关闭⇒零优惠（老行为）；启用后按小计自动选最优档；recalculate 保持折后价。
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMeteredD1 } from '../scripts/lib/metered-d1.mjs'
import { handlePublic, handleAdmin } from '../functions/lib/backend.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function freshEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'))
  const D1 = createMeteredD1(db)
  const env = { DB: D1, ADMIN_KEY: 'test-key' }
  db.prepare(`INSERT INTO products (_id, name, price, enabled, stock, createdAt, updatedAt)
    VALUES ('p_tea', '茉莉花茶', 30, 1, -1, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')`).run()
  return { db, env }
}

const items2 = [{ productId: 'p_tea', quantity: 2 }]

describe('满减默认关闭：零优惠，老行为不变', () => {
  it('小计 60 → 实付 60，discount 0，无明细行', async () => {
    const { db, env } = freshEnv()
    const r = await handlePublic(env, 'createOrder', { roomNumber: 'R1', items: items2 })
    expect(r.code).toBe(0)
    expect(r.data.totalAmount).toBe(60)
    expect(r.data.discountAmount).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM order_discounts').get().n).toBe(0)
    db.close()
  })
})

describe('启用后自动选最优档', () => {
  it('满50减5：小计60→实付55，明细行锁定规则', async () => {
    const { db, env } = freshEnv()
    db.prepare(`INSERT INTO promotions (_id, name, threshold, discount, enabled) VALUES ('promo_t', '满50减5', 50, 5, 1)`).run()
    const r = await handlePublic(env, 'createOrder', { roomNumber: 'R2', items: items2 })
    expect(r.code).toBe(0)
    expect(r.data.totalAmount).toBe(55)
    expect(r.data.discountAmount).toBe(5)
    expect(r.data.promotionId).toBe('promo_t')
    const row = db.prepare('SELECT discountAmount, promotionId FROM order_discounts WHERE orderId = ?').get(r.data.id)
    expect(row.discountAmount).toBe(5)
    // 读侧带出优惠
    const g = await handlePublic(env, 'getOrderStatus', { orderId: r.data.id })
    expect(g.code).toBe(0)
    db.close()
  })
  it('未达门槛：小计30→无优惠', async () => {
    const { db, env } = freshEnv()
    db.prepare(`INSERT INTO promotions (_id, name, threshold, discount, enabled) VALUES ('promo_t', '满50减5', 50, 5, 1)`).run()
    const r = await handlePublic(env, 'createOrder', {
      roomNumber: 'R3', items: [{ productId: 'p_tea', quantity: 1 }],
    })
    expect(r.code).toBe(0)
    expect(r.data.totalAmount).toBe(30)
    expect(r.data.discountAmount).toBe(0)
    db.close()
  })
  it('recalculateOrders 不把折后价"修正"回原价', async () => {
    const { db, env } = freshEnv()
    db.prepare(`INSERT INTO promotions (_id, name, threshold, discount, enabled) VALUES ('promo_t', '满50减5', 50, 5, 1)`).run()
    const r = await handlePublic(env, 'createOrder', { roomNumber: 'R4', items: items2 })
    expect(r.data.totalAmount).toBe(55)
    const rec = await handleAdmin(env, 'recalculateOrders', 'test-key', {})
    expect(rec.code).toBe(0)
    const row = db.prepare('SELECT totalAmount FROM orders WHERE _id = ?').get(r.data.id)
    expect(row.totalAmount).toBe(55)
    db.close()
  })
})
