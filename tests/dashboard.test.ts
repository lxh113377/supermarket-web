import { describe, it, expect } from 'vitest'
import { buildCsv } from '../src/components/DashboardTab'

// H1-2（2026-09-05）：聚合纯函数已迁移 functions/lib/actions/stats.js（见 stats.test.js），
// DashboardTab 侧仅保留 CSV 生成纯函数（无服务端依赖，供导出用）。

describe('buildCsv', () => {
  it('含 BOM、表头齐全、顺序与标签一致', () => {
    const csv = buildCsv({ labels: ['8/27', '8/28'], orderCounts: [1, 2], revenues: [10, 20] })
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace('\uFEFF', '').split('\r\n')
    expect(lines[0]).toBe('日期,订单数,营收(¥)')
    expect(lines[1]).toBe('8/27,1,10')
    expect(lines[2]).toBe('8/28,2,20')
  })

  it('含逗号/引号的内容正确转义', () => {
    const csv = buildCsv({ labels: ['a,b', 'x"y'], orderCounts: [1, 2], revenues: [0, 0] })
    const lines = csv.replace('\uFEFF', '').split('\r\n')
    expect(lines[1]).toBe('"a,b",1,0')
    expect(lines[2]).toBe('"x""y",2,0')
  })
})