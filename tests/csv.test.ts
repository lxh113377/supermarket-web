import { describe, it, expect } from 'vitest'
import { csvEscape, buildCsvText } from '../src/utils/csv'

describe('csvEscape', () => {
  it('普通值原样返回', () => {
    expect(csvEscape('abc')).toBe('abc')
    expect(csvEscape(123)).toBe('123')
  })

  it('含逗号/引号/换行加引号包裹，内部引号翻倍', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    expect(csvEscape('a"b,c')).toBe('"a""b,c"')
  })
})

describe('buildCsvText', () => {
  it('带 BOM + CRLF 行结尾 + 表头转义', () => {
    const csv = buildCsvText(['房号', '商品'], [['A1', '可乐,冰'], ['B2', '薯片"大包"']])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('"可乐,冰"')
    expect(csv).toContain('"薯片""大包"""')
  })
})