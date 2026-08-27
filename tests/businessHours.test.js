import { describe, it, expect } from 'vitest'
import { isBusinessHours, getBusinessHoursText, getClosedMessage } from '../src/utils/businessHours'

describe('businessHours', () => {
  describe('isBusinessHours - 工作日', () => {
    it('工作日 17:37 应营业', () => {
      // 2026-07-27 是周一
      const d = new Date(2026, 6, 27, 17, 37)
      expect(isBusinessHours(d)).toBe(true)
    })

    it('工作日 17:36 不营业', () => {
      const d = new Date(2026, 6, 27, 17, 36)
      expect(isBusinessHours(d)).toBe(false)
    })

    it('工作日 22:59 应营业', () => {
      const d = new Date(2026, 6, 27, 22, 59)
      expect(isBusinessHours(d)).toBe(true)
    })

    it('工作日 23:00 不营业', () => {
      const d = new Date(2026, 6, 27, 23, 0)
      expect(isBusinessHours(d)).toBe(false)
    })

    it('工作日 12:00 不营业', () => {
      const d = new Date(2026, 6, 27, 12, 0)
      expect(isBusinessHours(d)).toBe(false)
    })
  })

  describe('isBusinessHours - 周末', () => {
    it('周六 13:00 应营业', () => {
      // 2026-07-25 是周六
      const d = new Date(2026, 6, 25, 13, 0)
      expect(isBusinessHours(d)).toBe(true)
    })

    it('周六 12:59 不营业', () => {
      const d = new Date(2026, 6, 25, 12, 59)
      expect(isBusinessHours(d)).toBe(false)
    })

    it('周六 23:59 应营业', () => {
      const d = new Date(2026, 6, 25, 23, 59)
      expect(isBusinessHours(d)).toBe(true)
    })

    it('周日 0:30 应营业（次日凌晨）', () => {
      // 2026-07-26 是周日
      const d = new Date(2026, 6, 26, 0, 30)
      expect(isBusinessHours(d)).toBe(true)
    })

    it('周日 1:00 不营业', () => {
      const d = new Date(2026, 6, 26, 1, 0)
      expect(isBusinessHours(d)).toBe(false)
    })

    it('周日 15:00 应营业', () => {
      const d = new Date(2026, 6, 26, 15, 0)
      expect(isBusinessHours(d)).toBe(true)
    })
  })

  describe('文本输出', () => {
    it('getBusinessHoursText 返回非空字符串', () => {
      expect(getBusinessHoursText().length).toBeGreaterThan(0)
    })

    it('getClosedMessage 返回非空字符串', () => {
      expect(getClosedMessage().length).toBeGreaterThan(0)
    })
  })
})
