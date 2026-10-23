// 打印页地址的解析判据（2026-10-22 重写：从「可跳外部域名」改成「只准同源路径」）。
//
// 为什么这一层现在只测「拒」：上一版允许 http(s) 绝对地址，结果顾客端在微信里被
// location.replace 跳到另一个域名，撞上微信「无法确认本次跳转是否安全」拦截页 ——
// 打印功能对微信用户直接消失（一手：老大手机截图）。所以外部域名本身就是要堵的形态，
// 不再给它任何合法入口。正向腿（默认值可用）与反向腿（外部域名/可执行协议必拒）成对。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { DROPPED_HEADERS, forwardHeaders } from '../functions/lib/print-proxy.js'
import {
  CAMPUS_PRINT_PATH,
  CAMPUS_PRINT_BUILD,
  normalizeCampusPrintPath,
  resolveCampusPrintUrl,
} from '../src/pages/print/printApp'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

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

// ── 入口地址的口径对账（2026-10-23 一手）─────────────────────────────────────
// 起因：`CategoryPage.tsx` 的打印卡当初写成 `window.location.assign('/print/')`，
// **绕过了上面这层解析器**。后果两条都是真的：① 运营在 CI 里配 `VITE_CAMPUS_PRINT_URL`
// 对分类页完全失效（同一件事两处口径，`docs/env-vars.md` 只描述了其中一处）；
// ② 少带 `#print` ⇒ 顾客落在应用**首页**而不是下单表单，必须再点一次「上传文件去打印」。
// 上面的单测能证明解析器**算得对**，证明不了**有人用它** —— 所以这条按源码面钉：
// 入口写死字面量即红。代价是它读源文件、重构时会跟着红，那是想要的行为（改地址口径
// 本就该过一次人评审），不是脆弱。
describe('打印入口必须走解析器（不许写死跳转目标）', () => {
  const consumers = ['src/pages/CategoryPage.tsx', 'src/pages/print/PrintPage.tsx'] as const
  for (const rel of consumers) {
    it(rel + '：应调用解析器，且不得出现写死的 /print 跳转', () => {
      const src = readFileSync(join(REPO, rel), 'utf8')
      expect(src, '地址应来自 resolveCampusPrintUrl()，否则 VITE_CAMPUS_PRINT_URL 对这条路径失效').toMatch(/resolveCampusPrintUrl\(\)/)
      const hard = /location\.(assign|replace)\(\s*['"`]\/print/.exec(src)
      expect(hard, `发现写死的跳转目标：${hard?.[0] ?? ''}`).toBeNull()
    })
  }
})
