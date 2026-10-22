import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 按压反馈覆盖率闸（2026-10-23 新增，量的是「微交互」维度）。
 *
 * 为什么必须有：本站主入口是微信内置浏览器 = 触屏。触屏上没有 hover，用户判断
 * 「我这一下点到了没有」的唯一即时确认就是按压态（active）。
 * 而 2026-10-23 实测：108 个按钮类控件里只有 38 个（35%）有按压反馈 —— 包括商品行
 * 操作、管理端页签、AI 快捷问题、药丸筛选这些高频控件。更糟的是尺度也乱：同一件事
 * 全站用了 7 种值（0.90/0.94/0.95/0.97/0.98/0.99 等）。本轮统一成两档：短边 <40px 的
 * 小控件用 0.90、其余用 0.98（沿用既有主档，不发明新尺度）；宽行（商品名整行）与大面积
 * 虚线框（上传区）改用背景反馈 —— 那种尺寸下 scale 要么横向漂要么看不出来。
 *
 * 口径（刻意只认 CSSOM 里真实存在的 :active 规则）：
 *   控件可见（>=20px、完整在视口内）且未 disabled ⇒ 必须匹配到至少一条 :active 规则。
 *   不要求一定是 scale —— active:bg-* 这类背景反馈同样算（宽行用 scale 会横向漂，
 *   所以商品名整行用的是 active:bg-brand-50）。
 *   为什么用 CSSOM 而不是读 className 里的 active: 字样：Tailwind 的 active: 会编译成
 *   .active\:scale-90:active 这样的规则，从 CSSOM 反查才等于「浏览器真的会响应」；
 *   只读 class 名会把「写了但 Tailwind 没生成」和「生成了但被更高优先级覆盖」都算成合规。
 *
 * 阈值取「零缺失」而不是留余量：留余量等于允许缓慢流失。新控件若真不需要按压反馈
 * （纯展示 / disabled），已被上面的过滤排除。
 */

const VIEWPORT = { width: 390, height: 844 }

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['shop-drinks', '/#/shop/drinks'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-confirm', '/#/order-confirm'],
  ['order-query', '/#/order-query'],
  ['category-life', '/#/category/life'],
  ['admin', '/#/admin'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

interface Missing { label: string; cls: string }

/** 当前视口内：有多少交互控件缺按压反馈 */
async function scanOnce(page: Page): Promise<{ total: number; missing: Missing[] }> {
  return page.evaluate(() => {
    const activeSel: string[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // 跨源表读不到：跳过，而不是把「读不到」当成「没有规则」
      }
      for (const r of Array.from(rules)) {
        const st = (r as CSSStyleRule).selectorText
        if (st && st.includes(':active')) {
          for (const one of st.split(',')) {
            const t = one.trim()
            if (t.includes(':active')) activeSel.push(t)
          }
        }
      }
    }
    const baseOf = (sel: string) => sel.replace(/:active/g, '')
    const SEL = 'button, a[href], [role="button"], [role="radio"]'
    const els = Array.from(document.querySelectorAll(SEL)).filter((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width < 20 || r.height < 20) return false
      if (cs.visibility === 'hidden' || cs.display === 'none') return false
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return false
      // disabled 的控件点不动，要求按压反馈没有意义
      if ((el as HTMLButtonElement).disabled) return false
      if (el.getAttribute('aria-disabled') === 'true') return false
      return true
    })
    const missing = els
      .filter((el) => !activeSel.some((s) => {
        try {
          return el.matches(baseOf(s))
        } catch {
          return false
        }
      }))
      .map((el) => ({
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24),
        cls: String(el.className).trim().slice(0, 64),
      }))
    return { total: els.length, missing }
  })
}

/** 逐屏滚过整页（含内部滚动容器），合并去重 —— 只看首屏会漏掉折叠区里的控件 */
async function scanWithScroll(page: Page) {
  let total = 0
  const seen = new Map<string, Missing>()
  for (let step = 0; step < 8; step++) {
    const more = await page.evaluate((s) => {
      const list: HTMLElement[] = []
      const doc = document.scrollingElement as HTMLElement | null
      if (doc && doc.scrollHeight > doc.clientHeight + 4) list.push(doc)
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const cs = getComputedStyle(el)
        if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) list.push(el)
      }
      let anyMore = false
      for (const el of list) {
        el.scrollTop = s * Math.max(120, el.clientHeight - 40)
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 4) anyMore = true
      }
      return anyMore
    }, step)
    await page.waitForTimeout(220)
    const r = await scanOnce(page)
    total = Math.max(total, r.total)
    for (const m of r.missing) seen.set(m.cls + '|' + m.label, m)
    if (!more) break
  }
  return { total, missing: Array.from(seen.values()) }
}

async function login(page: Page) {
  const keyInput = page.getByLabel('管理密钥')
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill('stub-any-key')
    await page.getByRole('button', { name: '进入后台' }).click()
    await expect(keyInput).toBeHidden()
  }
}

const fmt = (list: Missing[]) => list.slice(0, 12).map((m) => '  ' + m.label + '  [' + m.cls + ']').join('\n')

for (const [name, route] of ROUTES) {
  test(name + '：可见控件都有按压反馈（触屏唯一的点击确认）', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1300)
    await login(page)
    if (name === 'admin') {
      // 管理端逐页签：每个页签控件集合不同，只扫默认页签等于漏扫
      let total = 0
      const all = new Map<string, Missing>()
      for (const tab of ['看板', '商品', '订单', '服务', '评价']) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(900)
        const r = await scanWithScroll(page)
        total = Math.max(total, r.total)
        for (const m of r.missing) all.set(tab + '|' + m.cls + '|' + m.label, { ...m, label: tab + ':' + m.label })
      }
      expect(total, '管理端一个可见控件都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(5)
      expect(Array.from(all.values()), '管理端有缺按压反馈的控件：\n' + fmt(Array.from(all.values()))).toEqual([])
      return
    }
    const r = await scanWithScroll(page)
    expect(r.total, name + ' 一个可见控件都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(1)
    expect(r.missing, name + ' 有 ' + r.missing.length + ' 个控件缺按压反馈（扫到 ' + r.total + ' 个）：\n' + fmt(r.missing)).toEqual([])
  })
}

/**
 * 自证（成对判据的负向那一半）：注入一个明知没有按压反馈的控件，必须被点名。
 * 没有这条，本判据可能只是「永远返回空数组」的装饰。
 * 本轮实测覆盖率时做过等价变异：把 .pill 的 active 摘掉，108 立刻变 97（正是那 11 个药丸）。
 */
test('判据自证：注入一个无按压反馈的控件，必须被点名', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1100)
  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self（无 unsafe-inline），
    // inline style 会被当场拦掉并触发应用级 console 错误 —— 那样注入失败会被误读成
    // 「判据没牙齿」。CSP 是被测对象的一部分，不为测试放宽它，换通道。
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('#pf-probe{position:fixed;left:8px;top:8px;z-index:99999;width:80px;height:36px}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const b = document.createElement('button')
    b.id = 'pf-probe'
    b.setAttribute('aria-label', '故意没有按压反馈')
    document.body.appendChild(b)
  })
  await page.waitForTimeout(200)
  const r = await scanOnce(page)
  const hit = r.missing.find((m) => m.label.indexOf('故意没有按压反馈') >= 0)
  expect(hit, '注入的无反馈控件没被点名 ⇒ 本判据已失效，必须修判据而不是信它').toBeTruthy()
})

/**
 * 静态腿：抓「hover 写了等于没写」这一类。
 * 一手案例（2026-10-23 实测两处）：text-gray-500 + hover:text-gray-500、
 * text-red-600 + hover:text-red-600 —— 同一元素的基础态与 hover 态是同一个工具类，
 * 悬停时没有任何变化，是「以为做了交互反馈其实没做」的典型。
 *
 * 实现：把整行切成工具类 token 收成集合，命中条件是「X 与 hover:X 同时作为**完全同名**
 * 的独立 token 出现在同一行」。因此 hover 换别的属性或别的色（正常写法）不会误报，
 * sm:text-xs 这类带变体前缀的 token 与 text-xs 也不同名。
 * 已知局限：若同一行恰好给两个不同元素分别写了 X 与 hover:X，会误报 —— 本轮实测
 * 零命中，出现误报时按行号人工确认即可，不预先放宽（放宽等于让这类缺陷继续漏）。
 */
test('静态：不得出现 hover 与基础态完全相同的无效工具类对', () => {
  const srcRoot = join(process.cwd(), 'src')
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx$/.test(e.name)) files.push(p)
    }
  }
  walk(srcRoot)
  expect(files.length, '一个 tsx 都没扫到 ⇒ 取数面坏了（别把空集读成通过）').toBeGreaterThan(20)
  const hits: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    src.split('\n').forEach((line, i) => {
      if (!line.includes('hover:')) return
      const tokens = new Set(line.match(/[A-Za-z][\w:./[\]-]*/g) || [])
      for (const t of tokens) {
        if (!t.startsWith('hover:')) continue
        const base = t.slice(6)
        if (!base || base.includes(':')) continue
        if (tokens.has(base)) hits.push(f.slice(srcRoot.length + 1).replace(/\\/g, '/') + ':' + (i + 1) + '  ' + base + ' 与 ' + t + ' 同名')
      }
    })
  }
  expect(hits, '存在 hover 与基础态完全相同的无效反馈（悬停无变化）：\n  ' + hits.join('\n  ')).toEqual([])
})
