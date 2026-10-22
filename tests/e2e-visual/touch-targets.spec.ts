import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 触控目标尺寸闸（WCAG 2.5.8 Target Size (Minimum)，AA 级）。
 *
 * 为什么必须有：本站主入口是微信内置浏览器 + 单手持机，误触的代价就是
 * 「顾客本来想点 3 星结果点到 4 星」。而仓库里 .tap-44 有 20 处使用、
 * index.css 还写明「使用处需保证相邻控件的水平间距 ≥ (2 × --tap-x)，否则命中区会重叠导致误触」
 * —— 那句话此前没有任何判据核过，正是本仓反复抓的「配置写了不等于在用」。
 *
 * 一手触发（2026-10-23）：实测评分星的按钮布局盒只有 19x32、相邻间距 2~4px，
 * 按 2.5.8 的 spacing 例外（以中心画 24x24 方框、不得与邻目标相交）算，
 * 24 宽 > 21 的中心距 ⇒ 例外不成立，是真违规。此前没有任何一把尺在看这件事。
 *
 * 判据口径（刻意只做几何、不做 hit-test）：
 *   有效框 = rect 与「以 rect 中心画的 24x24 方框」的并集；
 *   任两个有效框相交 ⇒ 违规（严格 > 0 才算相交，边对边合规）。
 *   这一个式子同时覆盖 2.5.8 本体与 spacing 例外：
 *     - rect 本身 ≥24 时并集就是 rect ⇒ 大目标之间只要不重叠就通过；
 *     - rect <24 时并集撑到 24 ⇒ 邻居太近就会相交 ⇒ 正是例外不成立的情形。
 *   不用 elementFromPoint 量命中区：实测那会把「视口外 / 被弹层遮挡」读成 0px，
 *   与「目标真的小」无法区分（本轮在同一批数据上踩过这个坑）。
 *   .tap-44 的伪元素外扩也不必计入 —— 它撑的是 36x36 这类本来就 ≥24 的目标。
 *
 * 滚动覆盖：本站多个页面用内部滚动容器（div.flex-1.overflow-y-auto），
 * 只看初始视口会漏掉折叠区里的目标（对比度闸就因此漏过评分星）。
 */

const VIEWPORT = { width: 390, height: 844 }   // 微信内最常见的窄屏
const MIN = 24

interface Violation { a: string; b: string; overlap: number; sizeA: string; sizeB: string }

const TARGETS: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['shop-drinks', '/#/shop/drinks'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-query', '/#/order-query'],
  ['category-life', '/#/category/life'],
  ['not-found', '/#/definitely-not-a-page'],
  ['admin', '/#/admin'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

/** 单次快照：当前视口内所有交互目标，算相交对 */
async function scanOnce(page: Page): Promise<{ targets: number; violations: Violation[] }> {
  return page.evaluate(([sel, min]) => {
    const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width < 1 || r.height < 1) return false
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false
      // 只量完整落在视口内的：视口外那一批此刻不是用户能点的
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
    })
    // 规范原文（2.5.8 的 Spacing 例外）是：「以每个目标为中心画 min×min 方框，
      // 该方框不得与**其他目标的实际 bounding box** 相交」。两个要点：
      //   ① 只约束短边 < min 的小目标 —— 大目标本身已经合规，不必为它扩张；
      //   ② 比较的另一侧用**实际 rect**，不是它也撑大后的框。
      // 首版把两侧都撑到 24 再判相交，于是「36x36 的加购按钮嵌在 173x267 的商品卡里」
      // 被算成 88 对违规 —— 那是**嵌套**，不是相邻挤压，用户点到子按钮就是要点它。
      // 同时排除 DOM 祖先/后代关系（嵌套的另一种形态）。
      const info = els.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          el, r,
          name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 22),
          size: Math.round(r.width) + 'x' + Math.round(r.height),
        }
      })
      const small = info.filter((x) => Math.min(x.r.width, x.r.height) < min)
      // 中心 24 方框（只对短边 <24 的目标计算；大目标本身已合规，不必扩张）
      const halo = (x: { r: DOMRect }) => {
        const cx = x.r.left + x.r.width / 2
        const cy = x.r.top + x.r.height / 2
        const half = min / 2
        return { left: cx - half, right: cx + half, top: cy - half, bottom: cy + half }
      }
      const inter = (a: { left: number; right: number; top: number; bottom: number },
                     b: { left: number; right: number; top: number; bottom: number }) => {
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        // 严格 > 0 才算相交：边对边（gap 恰好为 0）合规
        return ox > 0 && oy > 0 ? Math.round(Math.min(ox, oy)) : 0
      }
      const out: Array<{ a: string; b: string; overlap: number; sizeA: string; sizeB: string }> = []
      for (const a of small) {
        const ah = halo(a)
        for (const b of info) {
          if (b === a) continue
          // 嵌套（祖先/后代）不是「两个独立目标互相挤压」：
          // 商品卡里嵌着加购按钮，用户点到子按钮就是要点它
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue
          // 规范原文（Understanding 2.5.8 Spacing）要求 A 的方框既不得与
          // **另一目标的实际 bounding box** 相交，也不得与**另一个同尺寸方框**相交。
          // 首版只比了前者 ⇒ 16x16 + 4px 间距的注入对恰好"边对边"逃过（实测 ox=0），
          // 自证腿当场把它抓成"判据失效"。两侧都比才闭合。
          const overlap = Math.max(
            inter(ah, b.r),
            Math.min(b.r.width, b.r.height) < min ? inter(ah, halo(b)) : 0,
          )
          if (overlap > 0) {
            const key = [a.name, b.name].sort().join('|')
            if (out.some((v) => [v.a, v.b].sort().join('|') === key)) continue
            out.push({ a: a.name, b: b.name, overlap, sizeA: a.size, sizeB: b.size })
          }
        }
      }
    return { targets: els.length, violations: out }
  }, [
    'button, a[href], [role="button"], [role="radio"], input:not([type=hidden]), select, textarea',
    MIN,
  ] as [string, number])
}

/** 逐屏滚过整页（含内部滚动容器），合并去重 */
async function scanWithScroll(page: Page) {
  let targets = 0
  const seen = new Map<string, Violation>()
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
    targets = Math.max(targets, r.targets)
    for (const v of r.violations) {
      const k = [v.a, v.b].sort().join('|')
      if (!seen.has(k)) seen.set(k, v)
    }
    if (!more) break
  }
  await page.evaluate(() => {
    const doc = document.scrollingElement as HTMLElement | null
    if (doc) doc.scrollTop = 0
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el)
      if (/auto|scroll/.test(cs.overflowY)) el.scrollTop = 0
    }
  })
  return { targets, violations: Array.from(seen.values()) }
}

async function login(page: Page) {
  const keyInput = page.getByLabel('管理密钥')
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill('stub-any-key')
    await page.getByRole('button', { name: '进入后台' }).click()
    await expect(keyInput).toBeHidden()
  }
}

for (const [name, route] of TARGETS) {
  test(name + '：触控目标满足 WCAG 2.5.8（24px 中心框不得互相压到）', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await login(page)
    if (name === 'admin') {
      // 管理端逐页签扫：每个页签的控件集合不同，只扫默认页签等于漏扫
      let total = 0
      const all = new Map<string, Violation>()
      for (const tab of ['看板', '商品', '订单', '服务', '评价']) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(900)
        const r = await scanWithScroll(page)
        total = Math.max(total, r.targets)
        for (const v of r.violations) {
          const k = tab + '|' + [v.a, v.b].sort().join('|')
          if (!all.has(k)) all.set(k, { ...v, a: tab + ':' + v.a })
        }
      }
      expect(total, '管理端一个交互目标都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(3)
      expect(Array.from(all.values()), '管理端 5 个页签合计 ' + total + ' 个目标里有相交对：\n'
        + Array.from(all.values()).slice(0, 12).map((v) =>
          '  ' + v.a + '(' + v.sizeA + ') × ' + v.b + '(' + v.sizeB + ') 重叠 ' + v.overlap + 'px').join('\n')).toEqual([])
      return
    }
    const r = await scanWithScroll(page)
    expect(r.targets, name + ' 一个交互目标都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(0)
    expect(
      r.violations,
      name + ' 有 ' + r.violations.length + ' 对触控目标的有效框互相压到（扫到 ' + r.targets + ' 个目标）：\n' +
      r.violations.slice(0, 12).map((v) =>
        '  ' + v.a + '(' + v.sizeA + ') × ' + v.b + '(' + v.sizeB + ') 重叠 ' + v.overlap + 'px').join('\n'),
    ).toEqual([])
  })
}

/** 注入一对已知违规的紧凑目标，断言本件必须报红（否则它可能只是永远返回空数组的装饰） */
test('判据自证：注入两个 16x16 且间距 4px 的目标，必须被报出来', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    // 用 adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src 'self'，
    // inline style 会被当场拦掉（实测报「Applying inline style violates …」，
    // 于是注入的按钮拿不到尺寸、自证腿变成假失败）。adoptedStyleSheets 是 CSSOM API，
    // 不属于 inline style，实测零 CSP 报错且按钮确实渲染成 16x16。
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('#ttprobe-bad{position:fixed;left:8px;top:8px;z-index:99999;display:flex;gap:4px}'
      + '#ttprobe-bad button{width:16px;height:16px;padding:0;border:0;background:#1c1917}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const wrap = document.createElement('div')
    wrap.id = 'ttprobe-bad'
    for (const label of ['故意太近A', '故意太近B']) {
      const b = document.createElement('button')
      b.setAttribute('aria-label', label)
      wrap.appendChild(b)
    }
    document.body.appendChild(wrap)
  })
  await page.waitForTimeout(200)
  const r = await scanOnce(page)
  const hit = r.violations.find((v) => v.a.indexOf('故意太近') >= 0 && v.b.indexOf('故意太近') >= 0)
  expect(hit, '注入 16x16 + 4px 间距都没报 ⇒ 本判据已失效，必须修判据而不是信它').toBeTruthy()
  expect(hit!.overlap).toBeGreaterThan(0)
})

/** 反向自证：合规的紧凑目标不该被报（防判据退化成一律报红，也防有人为了绿去撑大一切） */
test('判据自证：16x16 但间距 44px 的合规目标，不得被误报', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    // 用 adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src 'self'，
    // inline style 会被当场拦掉（实测报「Applying inline style violates …」，
    // 于是注入的按钮拿不到尺寸、自证腿变成假失败）。adoptedStyleSheets 是 CSSOM API，
    // 不属于 inline style，实测零 CSP 报错且按钮确实渲染成 16x16。
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('#ttprobe-ok{position:fixed;left:8px;top:8px;z-index:99999;display:flex;gap:44px}'
      + '#ttprobe-ok button{width:16px;height:16px;padding:0;border:0;background:#1c1917}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const wrap = document.createElement('div')
    wrap.id = 'ttprobe-ok'
    for (const label of ['间距够A', '间距够B']) {
      const b = document.createElement('button')
      b.setAttribute('aria-label', label)
      wrap.appendChild(b)
    }
    document.body.appendChild(wrap)
  })
  await page.waitForTimeout(200)
  const r = await scanOnce(page)
  const hit = r.violations.find((v) => v.a.indexOf('间距够') >= 0 && v.b.indexOf('间距够') >= 0)
  expect(hit, '16x16 + 44px 间距按 WCAG 2.5.8 合规，被误报说明判据过严').toBeFalsy()
})