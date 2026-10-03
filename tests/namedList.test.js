import { describe, it, expect } from 'vitest'
import { capped } from '../scripts/lib/named-list.mjs'

// 第六十五轮 M-64-4：判据的展示缺陷。V4 修完后逐根扫同族抓到 8 处
// 「.slice(0,K) 折叠掉具名、分母也不印」的出口 —— 一处红和四十处红长得一模一样。
describe('capped() 点名必须有界且必印分母', () => {
  it('未越展示上限：逐条点名并印总数', () => {
    expect(capped(['a', 'b'], 8)).toBe('a, b（共 2 处）')
  })

  it('越上限：截断处必须自带「共 N 处」，否则第 K+1 条永久隐形', () => {
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`)
    const s = capped(many, 5)
    expect(s).toContain('只展示前 5')
    expect(s).toContain('共 40 处')
    expect(s.startsWith('k0, k1, k2, k3, k4')).toBe(true)
    expect(s).not.toContain('k5')
  })

  it('同名多计先去重再数（点名数与分母必须一致）', () => {
    expect(capped(['a', 'a', 'b'], 8)).toBe('a, b（共 2 处）')
  })

  it('空清单不印成"（共 0 处）"以外的形状；分隔符可换', () => {
    expect(capped([], 8)).toBe('（共 0 处）')
    expect(capped(['x', 'y'], 8, ' ; ')).toBe('x ; y（共 2 处）')
  })

  it('非字符串元素按 String 计入，不静默丢项', () => {
    expect(capped([1, 2, 3], 8)).toBe('1, 2, 3（共 3 处）')
  })
})
