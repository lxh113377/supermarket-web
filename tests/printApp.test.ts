// 打印页跳转目标的解析判据（2026-10-21：打印页整体替换为 CampusPrint-V1 应用）。
//
// 这一层的风险不是"跳错了好看不好看"，而是**把不可信输入变成跳转目标**：
// env 是构建期注入的字符串，一旦放行 `javascript:` 这类协议，等于给了 XSS 一条现成的出口。
// 所以下面三条腿都是"拒"的形态，且与"默认值可用 / 顾客端另有去处"两条正向腿成对。
import { describe, it, expect } from 'vitest'
import { DROPPED_HEADERS, forwardHeaders } from '../functions/lib/print-proxy.js'
import {
  DEFAULT_CAMPUS_PRINT_URL,
  NO_API_PROXY_HOSTS,
  PAGES_REMOTE_PRINT_URL,
  normalizeCampusPrintUrl,
  resolveCampusPrintUrl,
} from '../src/pages/print/printApp'

describe('normalizeCampusPrintUrl', () => {
  it('http(s) 绝对地址原样放行（URL 自己补空路径斜杠）', () => {
    expect(normalizeCampusPrintUrl('https://print.example.edu')).toBe('https://print.example.edu/')
    expect(normalizeCampusPrintUrl('http://127.0.0.1:4328/')).toBe('http://127.0.0.1:4328/')
  })

  it('同源路径放行：纯路径补斜杠，带 hash/query 的原样（补斜杠会把 #print 挪位）', () => {
    expect(normalizeCampusPrintUrl('/print')).toBe('/print/')
    expect(normalizeCampusPrintUrl('/print/#print')).toBe('/print/#print')
    expect(normalizeCampusPrintUrl('/print/?from=home')).toBe('/print/?from=home')
    expect(normalizeCampusPrintUrl('//print.example.edu/')).toBeNull()
  })

  it('可执行协议与非地址输入一律拒绝（不给 XSS 留跳转出口）', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///C:/x', 'print.example.edu', '', '   ']) {
      expect(normalizeCampusPrintUrl(bad)).toBeNull()
    }
    expect(normalizeCampusPrintUrl(undefined)).toBeNull()
    expect(normalizeCampusPrintUrl(4328)).toBeNull()
  })
})

describe('resolveCampusPrintUrl', () => {
  it('配置合法用配置，缺失/非法回落到默认入口（绝不返回空串）', () => {
    expect(resolveCampusPrintUrl('https://print.example.edu', 'localhost')).toBe('https://print.example.edu/')
    expect(resolveCampusPrintUrl('javascript:alert(1)', 'localhost')).toBe(DEFAULT_CAMPUS_PRINT_URL)
    expect(resolveCampusPrintUrl(undefined, 'localhost')).toBe(DEFAULT_CAMPUS_PRINT_URL)
  })

  it('默认入口是同源静态面且直达打印下单视图（本机与 Pages 都要能落同一页）', () => {
    expect(DEFAULT_CAMPUS_PRINT_URL).toBe('/print/#print')
  })

  it('顾客端主机（无 Functions、/api 无从代理）指向 Pages 部署；其它主机仍走同源', () => {
    for (const host of NO_API_PROXY_HOSTS) {
      expect(resolveCampusPrintUrl(undefined, host)).toBe(PAGES_REMOTE_PRINT_URL)
    }
    expect(resolveCampusPrintUrl(undefined, 'supermarket-web.pages.dev')).toBe(DEFAULT_CAMPUS_PRINT_URL)
    expect(resolveCampusPrintUrl(undefined, undefined)).toBe(DEFAULT_CAMPUS_PRINT_URL)
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
