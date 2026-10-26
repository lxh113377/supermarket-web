import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 焦点环覆盖率闸（第 91 轮新增，量的是「微交互 × 可访问性」的交叉面）。
 *
 * 一手动因（本轮实测，不是假想）：index.css 里那条让位规则
   [class*='focus-visible:outline']:focus-visible { outline: none }
 * 用属性选择器（特异性 0,2,0）压过全局环 (0,1,0)，而 Tailwind 3 的 outline-2 只产出
 * outline-width / outline-color、**不产出 outline-style**（dist 实测 outline-style 出现 0 次）
 * ⇒ 挂了该类名的 8 处控件（商品卡 role=button、口味选择、图集 prev/next、分类栏滚动区、
 * 相关推荐、管理端行）键盘聚焦时**完全没有焦点环**。
 *
 * 为什么既有判据没发现（这条比缺陷本身更重要）：layout.spec.ts 早就有一条「键盘焦点环
 * 真实可见」，但它只测「加入购物车」那**一个**按钮 —— 而那个按钮恰好没挂该类名。
 * 于是判据全绿、缺陷长期隐身。⇒ **取样面不等于缺陷面**：一条只测一个样本的几何判据，
 * 等于给其余样本发了免检票。本件把口径从「测一个」改成「扫遍 Tab 序列」。
 *
 * 口径：
 *  - 按**键盘 Tab** 走（不是 el.focus()）：CSS 的 :focus-visible 只在键盘导航下匹配，
 *    用 focus() 量会得到假阴性（本轮实测踩过：那样连挂环的元素都报 outlineStyle none）。
 *  - 判 outlineStyle 为 none **且**没有等效 box-shadow 环才算缺失 —— 有些控件用
 *    box-shadow 画环（合法实现），只量 outline 会误伤。
 *  - 每路由必须量到 5 个以上停靠点，否则判「取数面坏了」而不是「没问题」。
 */

const VIEWPORT = { width: 1280, height: 900 }
const TABS = 22

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-query', '/#/order-query'],
  ['category-life', '/#/category/life'],
  ['service-form', '/#/service/delivery'],
  ['not-found', '/#/definitely-not-a-page'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

interface Stop { label: string; style: string; width: string; shadow: boolean; cls: string }

/** 沿键盘 Tab 序列逐站取焦点环读数 */
async function walkRings(page: Page): Promise<{ seen: number; stops: Stop[] }> {
  const stops: Stop[] = []
  let seen = 0
  for (let i = 0; i < TABS; i++) {
    await page.keyboard.press('Tab')
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body || el === document.documentElement) return null
      const cs = getComputedStyle(el)
      return {
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 20),
        style: cs.outlineStyle,
        width: cs.outlineWidth,
        shadow: cs.boxShadow !== 'none' && /rgb/.test(cs.boxShadow),
        cls: String(el.className).slice(0, 40),
      }
    })
    if (!s) continue
    seen++
    if (s.style === 'none' && !s.shadow) stops.push(s)
  }
  return { seen, stops }
}

for (const [name, route] of ROUTES) {
  test(name + '：键盘 Tab 序列上每个停靠点都有可见焦点环', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1400)
    const r = await walkRings(page)
    expect(r.seen, name + ' 只量到 ' + r.seen + ' 个停靠点 ⇒ 取数面坏了（别把空集读成通过）').toBeGreaterThanOrEqual(5)
    const fmt = r.stops.map((s) => '  ' + s.label + '  [' + s.cls + ']').join('\n')
    expect(r.stops, name + ' 有 ' + r.stops.length + ' 个停靠点既无 outline 也无 box-shadow 环（共量 ' + r.seen + ' 站）：\n' + fmt +
      '\n修法：补 outline 2px solid rgb(var(--focus-ring)) + offset 3px；若是为让位组件自定义环而摘全局环，' +
      '那条让位规则必须自带环并用 :where() 归零特异性。').toEqual([])
  })
}

/**
 * 自证（成对判据的负向那一半）：造一个明知零焦点环的元素，本件必须能识别它。
 * 没有这条，本件可能只是「永远返回空数组」的装饰 —— 而它要防的恰恰是上一轮那种
 * 「判据只测一个样本、其余八个静默免检」的形态。
 */
test('判据自证：无焦点环的元素必须被识别（探针自身条件不成立时先喊探针坏了）', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const base = await walkRings(page)
  expect(base.stops.length, '对照组：首页本应零缺失，若非零则下面的断言没有意义').toBe(0)
  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self，inline style 会被拦
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(
      '#fr-probe{position:fixed;left:8px;top:8px;z-index:99999;width:80px;height:30px;' +
        'background:#1c1917;color:#f4efe7;border:0;outline:none !important;box-shadow:none !important}',
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const b = document.createElement('button')
    b.id = 'fr-probe'
    b.setAttribute('aria-label', '故意没有焦点环')
    // 插到 body 最前 = 抢在 #root 之前 ⇒ 它必然落在 Tab 序列第一站。
    // 第一版写的是 appendChild（挂在末尾，22 次 Tab 根本走不到），那样 walkRings
    // 报零缺失、自证却以为自己验过了 —— 正是本件要防的「写了不生效」。
    document.body.insertBefore(b, document.body.firstChild)
  })
  await page.waitForTimeout(200)
  const r = await walkRings(page)
  const hit = r.stops.find((s) => s.label.indexOf('故意没有焦点环') >= 0)
  expect(hit, '注入的无焦点环控件没被 walkRings 抓出来 ⇒ 本判据已失效（要么探针不在 Tab 序列里，要么判定口径写错）').toBeTruthy()
})
