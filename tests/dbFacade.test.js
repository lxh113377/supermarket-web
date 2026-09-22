/**
 * db.js 拆分后门面完整性校验（defence in depth）
 *
 * db.js 从 285 行上帝模块按职责拆到 src/db/*.js，原文件退化为再导出 barrel。
 * 本测试确认所有既有调用方依赖的导出项仍然存在且为函数，
 * 一旦 barrel 漏 re-export 或子模块命名冲突导致导出丢失，立即报错。
 */
import { describe, it, expect } from 'vitest'
import * as db from '../src/db'

const EXPECTED = [
  // products.js
  'getCategories', 'getProducts', 'getAdminProducts',
  // orders.js
  'createOrder', 'getOrderById', 'getAllOrders',
  // reviews.js
  'addReview', 'getLocalProductReviews', 'getCloudReviews',
  'addCloudReview', 'deleteCloudReview', 'getAllReviews',
  // submissions.js
  'flushPendingSubmissions', 'initSubmissionSync', 'createSubmission', 'getSubmissions',
  // cloudInit.js
  'seedCloudData',
  // 由 catalogCache 再导出
  'clearCatalogCache',
]

describe('db facade 再导出完整性（拆分后调用方不破）', () => {
  it('所有原导出项仍存在且为函数', () => {
    expect(EXPECTED.length).toBeGreaterThan(0)
    for (const name of EXPECTED) {
      expect(typeof db[name], `db.${name} 应为函数`).toBe('function')
    }
  })

  it('未意外暴露内部 helper（cloud / ensure / IS_CLOUD 不应再导出）', () => {
    expect(db.cloud).toBeUndefined()
    expect(db.ensure).toBeUndefined()
    expect(db.IS_CLOUD).toBeUndefined()
  })
})
