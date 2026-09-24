// @vitest-environment node
// 静态断言只需读文件，不需要 DOM；默认 jsdom 环境下 import.meta.url 是 http 协议，
// fileURLToPath 会抛 "The URL must be of scheme file"（本轮实测）。
// 看板图表 XSS 汇点静态断言（2026-09-24 对标第二轮 A3；GHSA-fgmj-fm8m-jvvx，影响 echarts <6.1.0）
// 与既有"断言 dist 无 <style> 标签"同族：这类安全不变量靠 code review 守不住，
// 新增一张图忘了带 renderMode 就会静默回到可注入状态，因此做成门禁。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// 两处都要扫：option 构造（含 tooltip）在六轮抽到 chartOptions.ts，生命周期/深路径 import 留在 hook。
// 只读单文件会让门禁在重构后静默失去判据（R263「判据自身坏了」同族）。
const files = ['../src/utils/chartOptions.ts', '../src/hooks/useDashboardCharts.ts'] as const
const sources = files.map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'))
const src = sources.join('\n')

describe('看板 echarts 配置 XSS 收口', () => {
  it('存在 tooltip 配置（判据本身不能是空的）', () => {
    expect(src).toContain('tooltip: {')
  })

  it('每个 tooltip 都展开 TOOLTIP_BASE（renderMode: plainText）', () => {
    const lines = src.split('\n').filter((l) => l.includes('tooltip: {'))
    expect(lines.length).toBeGreaterThan(0)
    const missing = lines.filter((l) => !l.includes('TOOLTIP_BASE'))
    expect(missing, `以下 tooltip 未收口：\n${missing.join('\n')}`).toEqual([])
  })

  it('四张图的 tooltip 一个都不能少（防重构中漏搬某张图）', () => {
    const optionTooltips = sources[0].split('\n').filter((l) => l.includes('tooltip: {')).length
    expect(optionTooltips).toBe(4)
  })

  it('TOOLTIP_BASE 必须是 plainText', () => {
    expect(src).toMatch(/TOOLTIP_BASE\s*=\s*\{\s*renderMode:\s*'plainText'/)
  })

  it('formatter 不返回 HTML 标签（plainText 下也无意义，且属旧汇点形态）', () => {
    expect(src).not.toMatch(/<br\s*\/>/i)
    expect(src).not.toMatch(/formatter:[^\n]*<[a-zA-Z]/)
  })

  it('echarts 只按深路径引入（barrel 会整包拖入，历史实测 gz 452→331K）', () => {
    expect(src).not.toMatch(/from ['"]echarts['"]/)
    expect(src).toContain("import('echarts/lib/component/tooltip')")
  })
})
