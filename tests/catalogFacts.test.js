/**
 * 目录事实对账的夹具（第十一轮 R11-H3）。
 * 网络一律不碰：CLI 只验"取不到 ⇒ BLOCKED"这条最容易被写错的路径。
 */
// @vitest-environment node
// ↑ 这三份测的是节点级门禁脚本（会 import node:sqlite），必须跑在 node 环境：
//   jsdom 环境下 Vite 会尝试 bundle `node:sqlite` ⇒ ubuntu runner 直接报错（本机侥幸通过，
//   CI 首跑抓到，第十一轮）。判据类测试不需要 DOM，声明 node 既更快也更诚实。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSqlValue, parseSeedProducts, judgeCatalogFacts, diffSeedVsLive } from '../scripts/check-catalog-facts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const item = (over = {}) => ({ _id: 'p001', name: '测试汽水', price: 3, enabled: 1, subcategories: ['soda'], ...over })

describe('parseSqlValue：seed.sql 里出现的四种形态', () => {
  it("字符串去引号并把 '' 还原成 '", () => {
    expect(parseSqlValue("'无/低糖'")).toBe('无/低糖')
    expect(parseSqlValue("'it''s'")).toBe("it's")
  })
  it('数字与 NULL', () => {
    expect(parseSqlValue('3.66')).toBe(3.66)
    expect(parseSqlValue('-1')).toBe(-1)
    expect(parseSqlValue('NULL')).toBe(null)
  })
  it('带逗号的 JSON 文本整块取出（列值里有逗号是常态）', () => {
    expect(parseSqlValue('\'["tea","sweet"]\'')).toBe('["tea","sweet"]')
  })
})

describe('parseSeedProducts：直接吃本仓真相源', () => {
  const rows = parseSeedProducts(readFileSync(join(ROOT, 'db', 'seed.sql'), 'utf8'))
  it('解得出 50+ 行，且每行有 _id/name/有限价格', () => {
    expect(rows.length).toBeGreaterThanOrEqual(50)
    for (const r of rows) {
      expect(r._id).toMatch(/^p\d+$/)
      expect(String(r.name).trim()).toBeTruthy()
      expect(Number.isFinite(Number(r.price))).toBe(true)
    }
  })
  it('enabled 解成数字（1/0），不是字符串', () => {
    for (const r of rows.slice(0, 5)) expect(typeof r.enabled).toBe('number')
  })
  it('解不出任何行时必须让主程序 exit 2（夹具自证：空 SQL 得 0 行）', () => {
    expect(parseSeedProducts('-- 只有注释\n')).toEqual([])
  })
})

describe('judgeCatalogFacts：硬不变量七条各判各的', () => {
  it('正常目录 ⇒ 零问题', () => {
    expect(judgeCatalogFacts([item(), item({ _id: 'p002', name: '另一款' })])).toEqual([])
  })
  it('空目录 ⇒ 判红（顾客端白屏）', () => {
    expect(judgeCatalogFacts([]).join()).toContain('公开目录为空')
  })
  it('_id 重复 ⇒ 判红并点名', () => {
    expect(judgeCatalogFacts([item(), item({ name: '另一个' })]).join()).toContain('p001：_id 重复')
  })
  it('name 空 ⇒ 判红', () => {
    expect(judgeCatalogFacts([item({ name: '  ' })]).join()).toContain('name 为空')
  })
  it('价格为负 / 非数字 ⇒ 判红', () => {
    expect(judgeCatalogFacts([item({ price: -1 })]).join()).toContain('price 非法')
    expect(judgeCatalogFacts([item({ price: 'abc' })]).join()).toContain('price 非法')
  })
  it('公开接口里混进下架项 ⇒ 判红（越权可见面）', () => {
    expect(judgeCatalogFacts([item({ enabled: false })]).join()).toContain('下架项')
  })
  it('subcategories 未解码成数组 ⇒ 判红', () => {
    expect(judgeCatalogFacts([item({ subcategories: '["tea"]' })]).join()).toContain('不是数组')
  })
})

describe("judgeCatalogFacts(items, 'db')：种子行是**未解码**的 JSON 文本，形状与 API 面不同", () => {
  const dbRow = (over = {}) => ({ _id: 'p001', name: '测试汽水', price: 3, enabled: 1, subcategories: '["soda","tea"]', ...over })
  it('JSON 文本数组与 enabled=0 在 db 形状下都合法', () => {
    expect(judgeCatalogFacts([dbRow(), dbRow({ _id: 'p002', enabled: 0 })], 'db')).toEqual([])
  })
  it('非法 JSON 文本 ⇒ 判红', () => {
    expect(judgeCatalogFacts([dbRow({ subcategories: '["tea"' })], 'db').join()).toContain('不是合法 JSON')
  })
  it('解出来不是数组 ⇒ 判红', () => {
    expect(judgeCatalogFacts([dbRow({ subcategories: '{"a":1}' })], 'db').join()).toContain('不是数组')
  })
  it('enabled 不是 0/1 ⇒ 判红', () => {
    expect(judgeCatalogFacts([dbRow({ enabled: 'yes' })], 'db').join()).toContain('enabled 不是 0/1')
  })
  it('真实 db/seed.sql 用 db 形状判必须零问题（用 api 形状判会 54 行全红——本轮就是这么抓到的）', () => {
    const rows = parseSeedProducts(readFileSync(join(ROOT, 'db', 'seed.sql'), 'utf8'))
    expect(judgeCatalogFacts(rows, 'db')).toEqual([])
    expect(judgeCatalogFacts(rows, 'api').length).toBeGreaterThan(0)
  })
})

describe('diffSeedVsLive：漂移只报告不判红', () => {
  const seed = [{ name: '甲', price: 3 }, { name: '乙', price: 4 }, { name: '甲', price: 3 }]
  const live = [{ name: '甲', price: 3.5 }, { name: '丙', price: 5 }]
  it('三类漂移 + 同名重复数各归各', () => {
    const d = diffSeedVsLive(seed, live)
    expect(d.onlySeed).toEqual(['乙'])
    expect(d.onlyLive).toEqual(['丙'])
    expect(d.priceDiff.join()).toContain('甲：seed 3 → 线上 3.5')
    expect(d.dupSeed).toBe(1)
  })
})

describe('CLI：取不到数据的形状必须是 BLOCKED 而不是绿', () => {
  it('指向不可达端点 ⇒ exit 2', () => {
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-catalog-facts.mjs')], {
        encoding: 'utf8', env: { ...process.env, DEPLOY_URL: 'http://127.0.0.1:9/' },
      })
      return Promise.reject(new Error('本该失败，却 exit 0'))
    } catch (e) {
      expect(e.status).toBe(2)
      expect(String(e.stderr) + String(e.stdout)).toContain('BLOCKED')
    }
  })
})
