import { describe, it, expect } from 'vitest'
import { pickExhibits } from '../src/data/pick-exhibits'

const POOL = Array.from({ length: 20 }, (_, i) => ({ name: 'P' + (i + 1), order: i + 1 }))

describe('pickExhibits（开屏三件随机）', () => {
  it('注入固定 random ⇒ 结果可复算且三件不重复、档位齐全', () => {
    const seq = [0.1, 0.5, 0.9, 0.2, 0.7, 0.3, 0.6, 0.8][Symbol.iterator]()
    const r = pickExhibits(POOL, () => seq.next().value ?? 0.5)
    expect(r).toHaveLength(3)
    const orders = r.map((x) => x.order)
    expect(new Set(orders).size).toBe(3)
    expect(r.map((x) => x.className)).toEqual(['exhibit-back', 'exhibit-front', 'exhibit-side'])
  })

  it('随机性活体腿：不同 random 流给出不同组合（20 组抽样 ≥ 2 种排列）', () => {
    const seen = new Set<string>()
    let state = 42
    const lcg = () => { state = (state * 48271) % 2147483647; return state / 2147483647 }
    for (let k = 0; k < 20; k++) {
      const r = pickExhibits(POOL, lcg)
      seen.add(r.map((x) => x.order).join(','))
    }
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })

  it('池子 < 3 ⇒ 按池子大小给，不硬凑；空池 ⇒ 空数组', () => {
    expect(pickExhibits(POOL.slice(0, 2))).toHaveLength(2)
    expect(pickExhibits([])).toEqual([])
  })
})
