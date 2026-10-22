import { test, expect } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 全站「渲染像素」对比度闸（2026-10-22 设计升级随附判据）。
 *
 * 为什么需要新判据：本仓此前只锁过**一处**对比度（layout.spec.ts 的商城价格，
 * 且是"读 computed color ⇄ 读某个 .bg-surface 背景色"）。而 2026-10-22 实测发现
 * 全站 86 处前景/背景组合不过 WCAG AA，最大一类是「白字压柿子黄 #eab308 = 1.92:1」
 * —— 它藏在 .btn-primary / .pill-active 这类**复用组件类**里，一处写错、24 个控件同时
 * 不合格。源码级正则扫不到：底色来自 CSS 类、来自 theme 渐变、来自祖先元素，
 * 三者在源码里根本不同行。
 *
 * 度量口径 = "前景取 computed color，底色取该元素框内像素众数"：
 *   前景用浏览器算好的精确值（含 rgba，半透明时再与底色合成）；
 *   底色必须实测 —— 只有真实渲染的像素能反映渐变、祖先背景、半透明叠加这三类情况。
 * 首版曾用"直方图 top-2 分别当文字色与底色"，实测**不可用**：抗锯齿把字形边缘混成
 * 大量互不相同的中间色，"第二众数"常是很淡的光晕，把 gray-600/白（真值 7.56:1）
 * 报成 1.17:1，13 条用例被假阳性拖红。
 *
 * 豁免只有一条且必须声明式：aria-hidden 的纯装饰文字（404 页那个水印级巨大数字）。
 * 它不承载信息，低对比是设计意图；任何"看着像装饰但其实给人读"的文字都躲不掉。
 *
 * 文件末尾配一条**自证**用例：注入已知 1.92:1 的元素，断言本件必须报红。
 * 这条自证在首版就抓到一次致命缺陷 —— 漏写 ctx.drawImage()，canvas 全透明，
 * 于是每个元素都采样不到颜色、直接 continue、零违规、13 条全部假绿。
 * 一把从不报警的尺子等于没有尺子（本仓「零输入不得记 PASS」同族）。
 */

const VIEWPORT = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

interface RouteSpec {
  name: string
  route: string
  vp?: typeof VIEWPORT
  prepare?: (page: import('@playwright/test').Page) => Promise<void>
}

/** 走查面：顾客端主要路由 + 需要交互才出内容的两个态（满车、搜索展开） */
const ROUTES: RouteSpec[] = [
  { name: 'home', route: '/#/' },
  { name: 'shop', route: '/#/shop' },
  { name: 'shop-drinks', route: '/#/shop/drinks' },
  { name: 'detail', route: '/#/product/p_46' },
  { name: 'cart-empty', route: '/#/cart' },
  { name: 'assistant', route: '/#/assistant' },
  { name: 'order-query', route: '/#/order-query' },
  { name: 'category-life', route: '/#/category/life' },
  { name: 'category-game', route: '/#/category/entertainment' },
  { name: 'not-found', route: '/#/definitely-not-a-page' },
  { name: 'admin-login', route: '/#/admin' },
  { name: 'home-mobile', route: '/#/', vp: MOBILE },
  { name: 'shop-mobile', route: '/#/shop', vp: MOBILE },
  {
    name: 'cart-filled',
    route: '/#/cart',
    prepare: async (page) => {
      await page.goto('/#/shop')
      await page.waitForTimeout(700)
      const btns = page.locator('button[aria-label^="添加"]')
      const n = Math.min(3, await btns.count())
      for (let i = 0; i < n; i++) { await btns.nth(i).click(); await page.waitForTimeout(120) }
      await page.goto('/#/cart')
      await page.waitForTimeout(800)
    },
  },
  {
    name: 'shop-search-open',
    route: '/#/shop',
    prepare: async (page) => {
      await page.getByRole('button', { name: '搜索商品' }).click()
      await page.getByLabel('搜索商品名称或口味').fill('矿泉水')
      await page.waitForTimeout(600)
    },
  },
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

interface Problem {
  sel: string; text: string; ratio: number; need: number
  fg: string; size: number; weight: number
}

/** 页内执行：前景 = computed color，底色 = 框内像素众数 */
async function auditPage(page: import('@playwright/test').Page): Promise<{ checked: number; problems: Problem[] }> {
  const png = await page.screenshot({ type: 'png' })
  const dataUrl = 'data:image/png;base64,' + png.toString('base64')

  return page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = img.naturalWidth
    cv.height = img.naturalHeight
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    // 命门：漏了 drawImage，canvas 就是全透明空图 ⇒ 每个元素都采样不到颜色
    // ⇒ 零违规 ⇒ 全站假绿。首版正是如此，被文件末尾的自证用例抓到。
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data

    const parseRGB = (s: string) => {
      const m = s.match(/[\d.]+/g)
      if (!m) return [0, 0, 0, 1]
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])]
    }
    const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratio = (a: number[], b: number[]) => {
      const l1 = lum(a), l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b
    const unkey = (k: number) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]
    // 半透明前景（如 text-ink/70）先与底色合成，否则会把"70% 墨压黄底"错算成"墨压黄底"
    const over = (f: number[], a: number, bg: number[]) => f.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))
    const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 12
    // 承载信息的文字：含中日韩、拉丁字母或数字；纯 emoji/几何符号（装饰）不算
    const INFORMATIVE = /[\u4E00-\u9FFF\u3040-\u30FFA-Za-z0-9]/

    const problems: Problem[] = []
    const seen = new Set<string>()

    const candidates = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      if (el.closest('[aria-hidden="true"]')) return false
      if (!INFORMATIVE.test(el.textContent || '')) return false
      // 只看"自己直接持有文字节点"的元素：否则容器会把整片子树混成一张直方图
      const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && INFORMATIVE.test(n.textContent || ''))
      if (!ownsText) return false
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return false
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
      return true
    })

    for (const el of candidates) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const [fr, fg, fb, fa] = parseRGB(cs.color)
      if (fa < 0.05) continue // 完全透明的文字（占位点号那类）不参与判定

      // 图像像素 ⇄ CSS 像素：截图按 deviceScaleFactor 放大，而 rect 永远是 CSS 像素
      const s = cv.width / (document.documentElement.clientWidth || innerWidth)
      const x0 = Math.max(0, Math.round(r.left * s)), y0 = Math.max(0, Math.round(r.top * s))
      const x1 = Math.min(cv.width, Math.round(r.right * s)), y1 = Math.min(cv.height, Math.round(r.bottom * s))
      if (x1 - x0 < 4 || y1 - y0 < 4) continue

      const hist = new Map<number, number>()
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * cv.width + x) * 4
          if (px[i + 3] < 250) continue
          const k = key(px[i], px[i + 1], px[i + 2])
          hist.set(k, (hist.get(k) || 0) + 1)
        }
      }
      if (hist.size === 0) continue
      const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1])
      let bg = unkey(ranked[0][0])
      // 众数恰好等于文字色（框内几乎只有字、底被字形盖住）⇒ 退到第二众数当底色
      if (near(bg, [fr, fg, fb]) && ranked[1]) bg = unkey(ranked[1][0])

      const fontSize = parseFloat(cs.fontSize) || 16
      const weight = parseInt(cs.fontWeight, 10) || 400
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700)
      const need = isLarge ? 3 : 4.5
      const fgFinal = fa >= 0.999 ? [fr, fg, fb] : over([fr, fg, fb], fa, bg)
      const got = ratio(fgFinal, bg)
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
      const dedupe = text + '|' + Math.round(got * 10)
      if (seen.has(dedupe)) continue
      seen.add(dedupe)

      if (got < need) {
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
        problems.push({
          sel: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
          text, ratio: Math.round(got * 100) / 100, need,
          fg: cs.color, size: Math.round(fontSize), weight,
        })
      }
    }
    return { checked: candidates.length, problems }
  }, dataUrl)
}

for (const r of ROUTES) {
  test(r.name + '：承载信息的文字全部过 WCAG AA', async ({ page }) => {
    await page.setViewportSize(r.vp || VIEWPORT)
    if (r.prepare) {
      await page.goto(r.route)
      await r.prepare(page)
    } else {
      await page.goto(r.route)
      await page.waitForTimeout(900)
    }
    const res = await auditPage(page)
    // 防空集：一个含字元素都没扫到 ⇒ 页面根本没渲染，此时"零违规"是假的。
    // 阈值取 1 而非更大：404 这类极简页面本来就只有几个可读数元素。
    expect(res.checked, r.name + ' 一个含字元素都没扫到 ⇒ 页面没渲染（别把空集读成通过）').toBeGreaterThan(1)
    expect(
      res.problems,
      r.name + ' 有 ' + res.problems.length + ' 处文字对比度不足（走查 ' + res.checked + ' 个含字元素）：\n' +
      res.problems.slice(0, 14).map((p) =>
        '  ' + p.ratio + ':1 (需 ' + p.need + ':1) ' + p.size + 'px/' + p.weight + ' 「' + p.text + '」 ' + p.sel + ' fg=' + p.fg).join('\n'),
    ).toEqual([])
  })
}

/**
 * 自证（成对判据的负向那一半）：注入一个已知不合格的形态，断言本件必须报红。
 * 首版正是靠这条抓到"漏 drawImage ⇒ 全站假绿"。
 */
test('判据自证：注入已知 1.92:1 的白字压柿子黄，必须被报出来', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/')
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const d = document.createElement('div')
    d.id = 'contrast-canary'
    d.textContent = '故意不合格的白字压柿子黄'
    d.style.cssText = 'position:fixed;left:24px;top:24px;z-index:99999;background:#eab308;color:#ffffff;font-size:16px;font-weight:400;padding:10px 14px'
    document.body.appendChild(d)
  })
  await page.waitForTimeout(200)
  const res = await auditPage(page)
  const canary = res.problems.find((p) => p.text.indexOf('故意不合格') >= 0)
  expect(canary, '注入 1.92:1 都没报 ⇒ 本判据已失效，必须修判据而不是信它').toBeTruthy()
  expect(canary!.ratio).toBeLessThan(2.5)
  expect(canary!.need).toBe(4.5)
})
