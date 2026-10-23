import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 中文正文可读性闸（2026-10-23 新增，排版轴 —— 此前十五轮从未正面量过）。
 *
 * 立它的理由（两条都是实测，不是审美偏好）：
 *  ① 行高：tailwind 的 text-xs / text-sm 默认 lineHeight 是 1rem / 1.25rem，
 *     对 12px / 14px 中文分别是 **1.33 / 1.43 倍**。西文这么排没问题（字母有升部降部、
 *     行与行之间天然有气口），中文是方块字、字面撑满 em box，同比例下上下笔画几乎相贴。
 *     本轮实测抓到 3 处会换行的中文正文落在这个区间（CategoryPage 的 text-xs、
 *     OrderConfirmPage 的 text-sm 错误提示）。WCAG 1.4.12 对正文行距的要求也是 1.5 倍。
 *  ② 字号：tailwind.config.js 里 2xs 的注释原文写着「11px 密集标签/角标」、3xs「10px
 *     下限：极紧凑徽章」—— 也就是这两个档的**设计意图是标签级**。但实测有 3 处 32~61 字
 *     的说明段落用了 text-2xs（VariantPicker 的数据说明、ProductDetailPage /
 *     ProductInfoSections 的演示声明）。让 11px 承载 61 字正文，是拿标签档当正文档用，
 *     违反 token 自己的定义。⇒ 本判据是**兑现既有定义**，不是新引入一条规矩。
 *
 * 口径（只判「真的会换行的中文正文」，避免误伤单行标签）：
 *   元素自己直接承载 >=14 个汉字 + 渲染后 >=2 行 + 可见 ⇒ 必须 fontSize >=12px 且
 *   lineHeight/fontSize >= 1.5。单行标签、角标、按钮文字一律不判（它们不换行，
 *   1.0 的行高比例不构成可读性问题）。
 *
 * 为什么按渲染判而不是扫 class 名：本轮实测 —— 同样是 text-2xs，「示意图 · 非商品实拍」
 * （10 字，单行）没问题，而 61 字的数据说明有问题；class 名完全一样，只有渲染后的
 * 行数与字数能区分。这与 contrast / warm-foreground 那几轮的结论一致。
 */

const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
  ['390', { width: 390, height: 844 }],
  ['1280', { width: 1280, height: 900 }],
]

const ROUTES = [
  '/#/', '/#/shop', '/#/shop/drinks', '/#/product/p_46', '/#/cart',
  '/#/service/delivery', '/#/assistant', '/#/order-query', '/#/category/life', '/#/order-confirm',
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

interface Violation { route: string; tag: string; fontSize: number; ratio: number; lines: number; cjk: number; cls: string; text: string }

/**
 * 取样面口径说明（本轮实测纠正过一次）：本判据**不能**要求"每条路由都必须有会换行的中文正文"。
 * /#/shop、/#/cart 这类页面本来就没有 —— 商品名是短标签、空购物车只有一行提示，
 * 用 cjk>=14 且 >=2 行的口径去要求它们，报的是"这页没有长正文"而不是"页面坏了"。
 * 所以每条路由只断言**页面确实渲染了**（ownTextEls 足够多），把"取样面非空"这件事
 * 交给下面那条聚合腿统一判 —— 它才是防空集化的正确位置。
 */

/** 取页面上所有「会换行的中文正文」元素，返回违反字号/行高门槛的那些 */
async function collectViolations(page: Page): Promise<{ checked: number; v: Violation[] }> {
  const raw = await page.evaluate(() => {
    const out: Array<{ tag: string; fontSize: number; ratio: number; lines: number; cjk: number; cls: string; text: string; route: string }> = []
    for (const el of Array.from(document.querySelectorAll('p, li, dd, dt, blockquote, span, div'))) {
      // 只算「自己直接承载文字」的元素，避免父容器把子元素的文字重复计入
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && /[\u4E00-\u9FFF]/.test(n.textContent || ''))
      if (!own) continue
      const txt = (el.textContent || '').replace(/\s+/g, '')
      const cjk = (txt.match(/[\u4E00-\u9FFF]/g) || []).length
      if (cjk < 14) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue
      const r = el.getBoundingClientRect()
      if (r.width < 60 || r.height < 6) continue
      const fontSize = parseFloat(cs.fontSize)
      const lh = parseFloat(cs.lineHeight)
      if (!isFinite(lh) || lh <= 0) continue
      const lines = Math.max(1, Math.round(r.height / lh))
      if (lines < 2) continue          // 单行不判（标签/角标不换行时不构成可读性问题）
      out.push({
        tag: el.tagName.toLowerCase(), fontSize, ratio: +(lh / fontSize).toFixed(2), lines, cjk,
        cls: String(el.className).slice(0, 34), text: txt.slice(0, 18), route: location.hash,
      })
    }
    return out
  })
  const v: Violation[] = raw.filter((x) => x.fontSize < 12 || x.ratio < 1.5)
  return { checked: raw.length, v }
}

/**
 * 页面渲染信号：用「有 h1 且正文有实质内容」判，而不是数元素个数。
 * 第一版这里写的是「承载中文的可见元素 > 5」，实测把 /#/cart（5 个）与 /#/order-query
 * （4 个）误判成"没渲染"—— 空购物车和查单页本来就字少。魔法阈值既误伤又说不清理由。
 * 第二版改成「h1 非空 + body 文本量」，其中 h1 那条又抓出一个**真缺陷**（/#/shop 窄屏分支
 * 把分类名渲染成 <span> 而非 <h1> ⇒ 手机上整页无标题），但那是 heading-structure 的活，
 * 已移过去；本判据只留 body 文本量这一条纯渲染信号。
 */
async function renderSignal(page: Page): Promise<{ chars: number }> {
  return page.evaluate(() => ({
    chars: (document.body.textContent || '').replace(/\s+/g, '').length,
  }))
}

for (const [label, vp] of VIEWPORTS) {
  for (const route of ROUTES) {
    test(label + 'px ' + route + '：换行的中文正文不得小于 12px 或行高低于 1.5', async ({ page }) => {
      await page.setViewportSize(vp)
      await page.goto(route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1300)
      // 逐屏滚过整页，折叠区里的正文也要判
      const all = new Map<string, Violation>()
      for (let step = 0; step < 6; step++) {
        const more = await page.evaluate((s) => {
          const doc = document.scrollingElement as HTMLElement | null
          let anyMore = false
          if (doc) {
            doc.scrollTop = s * Math.max(120, doc.clientHeight - 40)
            if (doc.scrollTop + doc.clientHeight < doc.scrollHeight - 4) anyMore = true
          }
          return anyMore
        }, step)
        await page.waitForTimeout(200)
        const r = await collectViolations(page)
        for (const x of r.v) { const k = x.cls + '|' + x.text; if (!all.has(k)) all.set(k, x) }
        if (!more) break
      }
      const v = Array.from(all.values())
      const rendered = await renderSignal(page)
      // 只判"页面确实渲染出内容"；h1 有无属 heading-structure 判据的职责，不在此重复
      expect(rendered.chars, route + '（' + label + 'px）body 文本仅 ' + rendered.chars + ' 字 ⇒ 页面是空的，别把空集读成通过').toBeGreaterThan(20)
      expect(
        v,
        route + '（' + label + 'px）有 ' + v.length + ' 处换行中文正文低于可读性门槛（>=12px 且行高>=1.5）：\n' +
          v.map((x) => '  ' + x.tag + ' ' + x.fontSize + 'px 行高' + x.ratio + ' ' + x.lines + '行 ' + x.cjk + '字 [' + x.cls + '] «' + x.text + '»').join('\n'),
      ).toEqual([])
    })
  }
}

/**
 * 聚合腿：把「取样面非空」放在这里判，而不是逐路由判。
 * 全站合计若连 8 处会换行的中文正文都采不到，说明口径写坏了（比如选择器漏了、
 * 或汉字正则被转义搞坏）—— 那会让上面所有逐路由断言集体变成"零违规"的假绿。
 */
test('聚合：全站确实采到足量「会换行的中文正文」（防空集化）', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0][1])
  let total = 0
  const sample: string[] = []
  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const r = await collectViolations(page)
    total += r.checked
    for (const x of r.v) sample.push('  ' + x.fontSize + 'px 行高' + x.ratio + ' [' + x.cls + '] «' + x.text + '»')
  }
  expect(total, '全站合计只采到 ' + total + ' 处会换行的中文正文 ⇒ 取数面/口径坏了，本判据的其它断言都不可信').toBeGreaterThanOrEqual(8)
})

/**
 * 自证：注入一处 11px 多行中文正文 + 一处 12px 但行高 1.0 的正文，两者都必须被点名；
 * 同时注入一处合规的（12px / 1.63）不得被报。缺这条，判据可能只是"阈值写成永远成立"。
 */
test('判据自证：注入低于门槛的正文必须被点名，合规的不得误伤', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0][1])
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1300)
  const base = await collectViolations(page)
  expect(base.v.length, '对照组：首页本应无违规，若非零则下面的断言没有意义').toBe(0)
  await page.evaluate(() => {
    // adoptedStyleSheets 而非 inline style：本页 CSP 是 style-src self，inline 会被拦
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(
      '#tp-tiny{position:fixed;left:8px;top:60px;width:200px;z-index:99999;font-size:11px;line-height:1.6}' +
      '#tp-tight{position:fixed;left:8px;top:140px;width:200px;z-index:99999;font-size:12px;line-height:1.0}' +
      '#tp-ok{position:fixed;left:8px;top:230px;width:200px;z-index:99999;font-size:12px;line-height:1.63}',
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const probe = '这是一段用于验证判据是否真的有牙齿的中文正文它必须足够长以便在给定宽度下换成两行以上'
    for (const id of ['tp-tiny', 'tp-tight', 'tp-ok']) {
      const p = document.createElement('p')
      p.id = id
      p.className = 'probe'
      p.textContent = probe
      document.body.appendChild(p)
    }
  })
  await page.waitForTimeout(300)
  const r = await collectViolations(page)
  const hit = (frag: string) => r.v.find((x) => x.cls === 'probe' && x.text.slice(0, 8) === frag)
  expect(hit('这是一段用于验证'), '注入 11px 多行中文正文没被点名 ⇒ 字号那半边判据失效')
    .toBeTruthy()
  expect(r.v.some((x) => x.cls === 'probe' && x.fontSize === 12 && x.ratio === 1.0), '注入 12px 行高 1.0 的正文没被点名 ⇒ 行高那半边判据失效').toBe(true)
  expect(r.v.some((x) => x.cls === 'probe' && x.fontSize === 12 && x.ratio === 1.63), '合规探针（12px/1.63）被误报 ⇒ 判据在误伤正确写法').toBe(false)
})
