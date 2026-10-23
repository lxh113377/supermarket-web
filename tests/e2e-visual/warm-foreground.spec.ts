import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 暖色前景闸（2026-10-23 新增，量的是「原创性 / 色彩一致性」）。
 *
 * 立它的理由：本站的底色与主文字都是**暖**的 —— 页底 --paper #fafaf9（CIELab b*=+0.47）、
 * 主文字 --ink #1c1917（b*=+1.93），index.css 里那句原话是「冷黑文字在暖底上会显出轻微的
 * 蓝灰边」—— 但这条原则当时只用在了主文字上。次级文字全站用的是 Tailwind 默认灰板
 * gray-500/600/700，实测 b* = -8.60 / -9.41 / -10.97，**明显偏蓝**：暖底上压冷灰字，
 * 正是那句话描述的那个缺陷，只是发生在次要文字上没人管。
 *
 * 更硬的理由：站点其实早就有暖灰体系，而且就是 Tailwind 的 stone 系 ——
 *   --paper / surface = stone-50、--ink-mute 与 --chart-text = stone-600、ink-soft = stone-800。
 * 也就是说 gray→stone 不是引入新色板，而是**回到站点自己已在用的那一套**（同族问题：
 * 有正确模式但没统一，与 alert()、aria-invalid 那两轮一模一样）。
 *
 * 为什么必须按渲染判、不能 grep 源码：本轮实测踩过 —— 我先用源码扫描 src 下的 .tsx 文件，
 * 以为改干净了，渲染实测仍剩 2 处偏蓝，根因是 index.css 里 .pill/.seg/.eyebrow/placeholder
 * 这些**共享类**也在输出冷灰，而源码扫描面根本没包含 CSS。⇒ 这个维度的真相在渲染后。
 *
 * 口径：
 *   取页面上所有**自己承载文字**的元素，算其 computed color 的 CIELab b*；
 *   |b*| < 1.2 视为中性（纯黑/纯白/灰阶中性的品牌色不算）；b* < -2 判为「冷前景」。
 *   只判**前景**：bg-gray-* / border-gray-* 保留不动 —— 实测 stone-50 与页底 #fafaf9
 *   是同一个值，把背景也换过去会让图标托、分隔线跟页底糊成一片（分离度 1.00）。
 *
 * 只判顾客端路由：管理端（/#/admin）仍有 139 处冷灰，是本轮登记的欠账，不在此面。
 */

const VIEWPORT = { width: 390, height: 844 }

const CUSTOMER_ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['shop-drinks', '/#/shop/drinks'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-query', '/#/order-query'],
  ['category-life', '/#/category/life'],
  ['service-form', '/#/service/delivery'],
  ['not-found', '/#/definitely-not-a-page'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

/** sRGB → CIELab（D65）。b* > 0 偏黄（暖），< 0 偏蓝（冷） */
function labB(hex: string): { L: number; b: number } {
  const h = hex.replace('#', '')
  if (h.length !== 6) throw new Error('非 6 位 hex: ' + hex)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const R = f(r), G = f(g), B = f(b)
  const q = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  // 只需要 Y、Z：b* = 200(Y-Z)、L* = 116Y-16。X 只参与 a*（本件不判 a*），
  // 留着就是 oxlint 的 no-unused-vars —— 它的报错顺带说明我抄了个用不上的分量。
  const Y = q(R * 0.2126 + G * 0.7152 + B * 0.0722)
  const Z = q((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883)
  return { L: 116 * Y - 16, b: 200 * (Y - Z) }
}

interface Cold { hex: string; b: number; text: string; cls: string }

/** 收集页面上所有「自己承载文字」元素的前景色，返回偏蓝的那些 */
async function collectColdForeground(page: Page): Promise<{ checked: number; cold: Cold[] }> {
  const colors = await page.evaluate(() => {
    const INFO = /[\u4E00-\u9FFF\u3040-\u30FFA-Za-z0-9]/
    const out: Array<{ color: string; text: string; cls: string }> = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && INFO.test(n.textContent || ''))
      if (!own) continue
      if (el.closest('[data-decorative="true"]')) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      out.push({ color: cs.color, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22), cls: String(el.className).slice(0, 40) })
    }
    return out
  })
  const seen = new Set<string>()
  const cold: Cold[] = []
  for (const c of colors) {
    const m = c.color.match(/[\d.]+/g)
    if (!m || m.length < 3) continue
    if (Number(m[3]) === 0) continue           // 完全透明不算
    const hex = '#' + [0, 1, 2].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')
    const key = hex + '|' + c.text
    if (seen.has(key)) continue
    seen.add(key)
    const { b } = labB(hex)
    if (b < -2) cold.push({ hex, b: +b.toFixed(2), text: c.text, cls: c.cls })
  }
  return { checked: seen.size, cold }
}

/** 逐屏滚过整页（含内部滚动容器）—— 只看首屏会漏折叠区里的元素 */
async function scanWithScroll(page: Page) {
  const cold = new Map<string, Cold>()
  let checked = 0
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
    await page.waitForTimeout(240)
    const r = await collectColdForeground(page)
    checked = Math.max(checked, r.checked)
    for (const c of r.cold) {
      const k = c.hex + '|' + c.text
      if (!cold.has(k)) cold.set(k, c)
    }
    if (!more) break
  }
  return { checked, cold: Array.from(cold.values()) }
}

for (const [name, route] of CUSTOMER_ROUTES) {
  test(name + '：顾客端前景不带冷灰偏蓝（暖色体系一致性）', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1400)
    const r = await scanWithScroll(page)
    expect(r.checked, name + ' 一个前景色都没采到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(3)
    expect(
      r.cold,
      name + ' 有 ' + r.cold.length + ' 个冷色前景（CIELab b* < -2，即偏蓝），与暖白页底 #fafaf9（b*=+0.47）不同色温：\n' +
        r.cold.slice(0, 10).map((c) => '  ' + c.hex + ' b*=' + c.b + '  [' + c.cls + '] «' + c.text + '»').join('\n'),
    ).toEqual([])
  })
}

/**
 * 自证：注入一个 Tailwind gray-500（b*=-8.60）的元素，必须被点名。
 * 没有这条，本判据可能只是「labB 算错方向」的装饰 —— 比如把 b* 的符号写反，
 * 那会把所有冷色当暖色、所有暖色当冷色，而"零冷色"看起来和真通过一模一样。
 */
/**
 * 源码棘轮腿：补上面渲染判据的**取样盲区**。
 *
 * 一手（2026-10-23）：渲染判据按路由取样，而 ErrorBoundary 只在子组件抛错时才渲染 ——
 * 正常路由永远不会渲染它，于是它里面的 4 处冷灰**判据看不见**，却确实会被顾客看到
 * （任何页面崩了都是这个界面）。⇒ 光有渲染判据会给出"全绿"的假安全感。
 *
 * 做法：对「顾客端会渲染的源码面」（顾客端页面 + 全站共享组件，含 ErrorBoundary）
 * 扫 text-gray-*，上限 0、只准降不准升。它不是替代渲染判据 —— CSS 里的冷灰渲染判据
 * 能抓到、源码扫描抓不到（本轮就踩过：index.css 的 .pill/.seg 在 .tsx 扫描面之外）；
 * 两条腿方向相反，合起来才闭合。
 */
test('源码棘轮：顾客端会渲染的组件里不得有冷灰前景（补渲染判据的取样盲区）', () => {
  const srcRoot = join(process.cwd(), 'src')
  // 顾客端页面 + 全站共享组件（ErrorBoundary 在列：崩溃界面顾客也会看到）
  const PAGES = ['HomePage', 'CustomerPage', 'ProductDetailPage', 'CartPage', 'CategoryPage', 'ServiceFormPage',
    'OrderConfirmPage', 'OrderSuccessPage', 'OrderQueryPage', 'PaymentPage', 'AssistantPage', 'NotFoundPage',
    'ErrorBoundary', 'TopNav', 'EmptyState', 'Skeleton', 'CartItem', 'ProductCard', 'OrderItem', 'InstallPrompt']
  const DIRS = ['components/product/', 'components/service/']
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p2 = join(d, e.name)
      if (e.isDirectory()) { walk(p2); continue }
      if (!/\.tsx$/.test(e.name)) continue
      files.push(p2.slice(srcRoot.length + 1).replace(/\\/g, '/'))
    }
  }
  walk(srcRoot)
  const inScope = files.filter((rel) =>
    (rel.startsWith('pages/') && PAGES.some((x) => rel.includes(x)))
    || (rel.startsWith('components/') && (PAGES.some((x) => rel.includes(x)) || DIRS.some((d) => rel.startsWith(d)))))
  expect(inScope.length, '一个顾客端文件都没圈进来 ⇒ 取数面坏了（别把空集读成通过）').toBeGreaterThan(15)
  const hits: string[] = []
  for (const rel of inScope) {
    const src = readFileSync(join(srcRoot, rel), 'utf8').replace(/\r\n/g, '\n')
    src.split('\n').forEach((l, i) => {
      if (/\btext-gray-(?:400|500|600|700)\b/.test(l)) hits.push(rel + ':' + (i + 1) + '  ' + l.trim().slice(0, 90))
    })
  }
  expect(hits, '顾客端会渲染的源码面出现冷灰前景 text-gray-{400..700}（应改用同序号 stone 暖灰；\n' +
    '注意 bg-gray-* / border-gray-* 不在此列 —— stone-50 与页底 #fafaf9 同值，换了会让\n' +
    '图标托与分隔线跟页底糊成一片）：\n  ' + hits.join('\n  ')).toEqual([])
})

test('判据自证：注入 gray-500 前景，必须被判为冷色', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const base = await collectColdForeground(page)
  expect(base.cold.length, '对照组：首页本应零冷色前景，若非零则下面的断言没有意义').toBe(0)
  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self，inline style 会被拦
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('#warm-cold{position:fixed;left:8px;top:8px;z-index:99999;color:#6b7280}' +
      '#warm-stone{position:fixed;left:8px;top:40px;z-index:99999;color:#78716c}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const a = document.createElement('p')
    a.id = 'warm-cold'
    a.className = 'probe'
    a.textContent = '故意用冷灰探针'
    const b = document.createElement('p')
    b.id = 'warm-stone'
    b.className = 'probe'
    b.textContent = '故意用暖灰探针'
    document.body.appendChild(a)
    document.body.appendChild(b)
  })
  await page.waitForTimeout(250)
  const r = await collectColdForeground(page)
  const hit = r.cold.find((c) => c.text.indexOf('故意用冷灰探针') >= 0)
  expect(hit, '注入 gray-500(#6b7280, b*=-8.60) 没被点名 ⇒ 本判据已失效（方向或阈值写错）').toBeTruthy()
  // 反向半边：同亮度的暖灰 stone-500 不该被报（否则判据是在"一律报红"）
  const falseHit = r.cold.find((c) => c.text.indexOf('故意用暖灰探针') >= 0)
  expect(falseHit, 'stone-500(#78716c, b*=+3.74) 是暖色，被误报说明判据在误伤正确写法').toBeFalsy()
})
