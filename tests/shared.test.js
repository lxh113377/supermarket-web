import { describe, it, expect } from 'vitest'

// 共享契约模块（functions/lib/shared.js）：CloudBase 遗留函数
// （normalizeEvent/createRateLimiter/getClientIp/pickFields）已于 2026-09-05 随 H2 清理删除，
// 本测试改为守护仍在使用中的字段白名单常量——它们是服务端写操作的信任边界，
// 任何增删字段都需与前端白名单（src/api/fields.ts）与 schema（db/schema.sql）保持对称。

const { PRODUCT_FIELDS, ORDER_FIELDS, REVIEW_FIELDS, SUBMISSION_FIELDS } = await import('../functions/lib/shared')

// 与前端 src/api/fields.ts 导出的白名单逐项对齐（防御纵深：双端对称防字段漂移）
const frontend = await import('../src/api/fields')

describe('shared - 字段白名单契约', () => {
  it('商品白名单与前端对称', () => {
    expect(PRODUCT_FIELDS).toEqual(frontend.PRODUCT_FIELDS)
  })

  it('订单白名单与前端对称', () => {
    // 前端 ORDER_FIELDS 只含客户端输入字段，服务端 ORDER_FIELDS 是完整存储文档字段
    // （totalAmount/status/createdAt/updatedAt 由服务端生成），故用子集断言而非相等。
    expect(frontend.ORDER_FIELDS).toEqual(['roomNumber', 'items', 'wechat', 'remark', 'paymentScreenshot'])
    expect(frontend.ORDER_FIELDS.every((f) => ORDER_FIELDS.includes(f))).toBe(true)
    expect(ORDER_FIELDS.length).toBeGreaterThan(frontend.ORDER_FIELDS.length)
  })

  it('评价白名单与前端对称', () => {
    expect(REVIEW_FIELDS).toEqual(frontend.REVIEW_FIELDS)
  })

  it('服务提交白名单与前端对称', () => {
    expect(SUBMISSION_FIELDS).toEqual(frontend.SUBMISSION_FIELDS)
  })
})