/**
 * 静态 CSP 门禁的夹具（第十一轮 R11-H2）。
 * 好样本照 index.html 的真实形状写，坏样本逐个只破一条 ⇒ 红了能归因到那一条。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cspDirective, judgeStaticHtml, findStaticHtml } from '../scripts/check-csp-static.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STRICT = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:"
const doc = (csp = STRICT, body = '<div id="root"></div>') =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${body}</body></html>`

describe('cspDirective：取值与缺失都要说清楚', () => {
  it('取到 style-src 的完整取值', () => {
    expect(cspDirective(doc(), 'style-src')).toEqual({ value: "'self'" })
  })
  it('指令不存在 ⇒ error 而不是静默空值', () => {
    expect(cspDirective(doc(), 'connect-src').error).toContain('没有 connect-src 指令')
  })
  it('整份文档没有 CSP meta ⇒ error', () => {
    expect(cspDirective('<html><head></head></html>', 'style-src').error).toContain('没找到 CSP meta')
  })
})

describe('judgeStaticHtml：四条各判各的', () => {
  it('严格 CSP + 无内联 ⇒ 通过', () => {
    expect(judgeStaticHtml('t.html', doc())).toEqual([])
  })
  it('style-src 放回 unsafe-inline ⇒ 判红并点名 F2', () => {
    const p = judgeStaticHtml('t.html', doc("script-src 'self'; style-src 'self' 'unsafe-inline'"))
    expect(p.join()).toContain('F2')
  })
  it("style-src 用 unsafe-hashes 蒙混 ⇒ 同样判红", () => {
    expect(judgeStaticHtml('t.html', doc("script-src 'self'; style-src 'self' 'unsafe-hashes'")).join())
      .toContain('unsafe-hashes')
  })
  it('静态 HTML 里写 style 属性 ⇒ 判"死样式"', () => {
    expect(judgeStaticHtml('t.html', doc(STRICT, '<p style="color:red">x</p>')).join())
      .toContain('被 style-src')
  })
  it('静态 HTML 里带 <style> 元素 ⇒ 判红', () => {
    expect(judgeStaticHtml('t.html', doc(STRICT, '<style>.a{color:red}</style>')).join())
      .toContain('<style> 元素')
  })
  it('script-src 放宽 ⇒ 判红（比样式面更危险）', () => {
    expect(judgeStaticHtml('t.html', doc("script-src 'self' 'unsafe-inline'; style-src 'self'")).join())
      .toContain('script-src')
  })
  it('CSP meta 整个消失 ⇒ 判红而不是"没有违规所以通过"', () => {
    expect(judgeStaticHtml('t.html', '<html><body>x</body></html>').join()).toContain('没找到 CSP meta')
  })
})

describe('真实仓对账（当场读盘）', () => {
  it('扫得到 index.html，且现状自洽', () => {
    const files = findStaticHtml(ROOT)
    expect(files).toContain('index.html')
    for (const f of files) expect(judgeStaticHtml(f, readFileSync(join(ROOT, f), 'utf8')), f).toEqual([])
  })
})
