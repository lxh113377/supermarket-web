// 打印页地址的解析判据（2026-10-22 重写：从「可跳外部域名」改成「只准同源路径」）。
//
// 为什么这一层现在只测「拒」：上一版允许 http(s) 绝对地址，结果顾客端在微信里被
// location.replace 跳到另一个域名，撞上微信「无法确认本次跳转是否安全」拦截页 ——
// 打印功能对微信用户直接消失（一手：老大手机截图）。所以外部域名本身就是要堵的形态，
// 不再给它任何合法入口。正向腿（默认值可用）与反向腿（外部域名/可执行协议必拒）成对。
import { describe, it, expect } from 'vitest'
import { DROPPED_HEADERS, forwardHeaders } from '../functions/lib/print-proxy.js'
import {
  CAMPUS_PRINT_PATH,
  CAMPUS_PRINT_BUILD,
  normalizeCampusPrintPath,
  resolveCampusPrintUrl,
} from '../src/pages/print/printApp'

describe('normalizeCampusPrintPath', () => {
  it('同源路径放行：纯路径补斜杠，带 hash/query 的原样（补斜杠会把 #print 挪位）', () => {
    expect(normalizeCampusPrintPath('/print')).toBe('/print/')
    expect(normalizeCampusPrintPath('/print/#print')).toBe('/print/#print')
    expect(normalizeCampusPrintPath('/print/?from=home')).toBe('/print/?from=home')
  })

  it('跨域与可执行协议一律拒（这两类就是微信拦截页与 XSS 出口的成因）', () => {
    for (const bad of [
      'https://supermarket-web.pages.dev/print/#print', // 一手事故里那个跳转目标
      '//print.example.edu/',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///C:/x',
      'print.example.edu',
      '',
      '   ',
    ]) {
      expect(normalizeCampusPrintPath(bad), bad).toBeNull()
    }
    expect(normalizeCampusPrintPath(undefined)).toBeNull()
    expect(normalizeCampusPrintPath(4328)).toBeNull()
  })
})

describe('resolveCampusPrintUrl', () => {
  it('配置合法用配置；非法（含任何外部域名）一律回落同源默认入口，绝不返回空串', () => {
    expect(resolveCampusPrintUrl('/print/#print')).toBe('/print/#print')
    expect(resolveCampusPrintUrl('https://evil.example.com/')).toBe(CAMPUS_PRINT_PATH)
    expect(resolveCampusPrintUrl('javascript:alert(1)')).toBe(CAMPUS_PRINT_PATH)
    expect(resolveCampusPrintUrl(undefined)).toBe(CAMPUS_PRINT_PATH)
  })

  it('默认入口是同源静态面且直达打印下单视图（两端部署都落同一个站内路径）', () => {
    expect(CAMPUS_PRINT_PATH).toBe('/print/#print')
    // 结构性断言：默认值必须以 '/' 开头 —— 不是同源路径的默认值就是这次事故的复发形态。
    expect(CAMPUS_PRINT_PATH.startsWith('/')).toBe(true)
  })

  it('版本常量在册（print-parity 的 P3 腿拿它跟上游 package.json、登记册三处对账）', () => {
    expect(typeof CAMPUS_PRINT_BUILD).toBe('string')
    expect(CAMPUS_PRINT_BUILD).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('forwardHeaders（/api 反代的核心判断）', () => {
  const incoming = () => {
    const h = new Headers()
    h.set('cookie', 'cp_session=abc')
    h.set('x-cp-surface', 'student')
    h.set('content-type', 'application/json')
    h.set('origin', 'https://supermarket-web.pages.dev')
    h.set('sec-fetch-site', 'cross-site')
    h.set('sec-fetch-mode', 'cors')
    h.set('host', 'supermarket-web.pages.dev')
    h.set('content-length', '42')
    return h
  }

  it('该丢的丢了：同源守卫项与出网重算项一个不留（留着必被上游判 FORBIDDEN_ORIGIN）', () => {
    const out = forwardHeaders(incoming())
    for (const name of DROPPED_HEADERS) expect(out.get(name), name).toBeNull()
  })

  it('不该丢的一个没丢：cookie / 面标识 / content-type 原样保留（丢多了会话与 CSRF 全断）', () => {
    const out = forwardHeaders(incoming())
    expect(out.get('cookie')).toBe('cp_session=abc')
    expect(out.get('x-cp-surface')).toBe('student')
    expect(out.get('content-type')).toBe('application/json')
  })

  it('逐项对账：出去的头 = 进来的头 − 丢掉的头（防"顺手清空"这种假绿）', () => {
    const input = incoming()
    const out = forwardHeaders(input)
    const kept = [...input.keys()].filter((k) => !DROPPED_HEADERS.includes(k))
    expect([...out.keys()].sort()).toEqual(kept.sort())
  })
})
