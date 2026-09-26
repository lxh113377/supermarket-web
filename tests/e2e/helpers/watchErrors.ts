/* oxlint-disable no-console -- 浏览器错误需同时进 CI 日志与断言，只 log 不 assert 是第八轮 H3 要修的缺陷 */
import { expect, type Page } from '@playwright/test'

/**
 * 浏览器错误的统一观察器（第八轮 H3，收 N3）。
 *
 * 修复前实况：`tests/e2e/*` 与 `tests/e2e-visual/*` 的 beforeEach 只把 pageerror /
 * console error `console.log` 到 stdout —— 页面真的抛异常时用例照样绿，
 * CI 里那 15/54/9/57 处 expect 全过也拦不住（第六轮"单测全绿、线上空白"同族）。
 * 唯一正确形态此前只存在于 `tests/e2e-stub/dashboard-cloud.spec.ts`，
 * 本文件把它提成全站共用出口，四个 spec 与桩 spec 都改走这里，只留一份实现。
 *
 * 白名单只锚定**具体串**（R236：泛化词会误伤真实缺陷）：
 * 新增条目必须写清它为什么不是应用缺陷。
 */

/** 资源加载类噪声：SPA 回退外来的资源请求会打 4xx，浏览器自己报 resource load failed */
const COMMON_NOISE = [/Failed to load resource/i, /favicon/i, /status of [45]\d\d/i]

/**
 * dev server 专有噪声。index.html 的 CSP `style-src 'self'` 会拦掉 Vite dev 注入的
 * inline style（页面无样式但功能正常，三个 spec 文件头的注释里都记着这条既有事实）。
 * 生产构建里没有 inline style ⇒ **只允许 dev 类 spec 传进来**，
 * 跑生产构建的 visual/stub 不传，真出现 CSP 违规照样变红。
 */
export const DEV_CSP_NOISE = [/Content Security Policy/i]

export interface ErrorWatch {
  /** 供用例内追加断言（如"预期恰好 1 条"）时读取 */
  pageErrors: string[]
  consoleErrors: string[]
  assertClean: () => void
}

/** 监听器必须在任何导航之前挂上，否则抛错发生在注册之后就抓不到 */
export function watchErrors(page: Page, extraNoise: RegExp[] = []): ErrorWatch {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const noise = [...COMMON_NOISE, ...extraNoise]

  page.on('pageerror', (e) => {
    pageErrors.push(e.message)
    console.log('PAGEERROR:', e.message)
  })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    consoleErrors.push(text)
    console.log('BROWSER-ERR:', text.slice(0, 200))
  })

  return {
    pageErrors,
    consoleErrors,
    assertClean() {
      expect(pageErrors, `未捕获页面异常：${pageErrors.join(' | ')}`).toEqual([])
      const appErrors = consoleErrors.filter((m) => !noise.some((re) => re.test(m)))
      expect(appErrors, `应用级 console 错误：${appErrors.join(' | ')}`).toEqual([])
    },
  }
}
