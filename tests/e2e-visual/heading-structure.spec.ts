import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 标题层级闸（2026-10-23 新增，量的是「视觉层级 + 语义结构」维度）。
 *
 * 为什么必须有：读屏用户靠 heading 导航整页（NVDA/VoiceOver 都有"标题列表"），
 * 屏幕外的结构错了，页面对他们就是没有目录的一坨文本。而 2026-10-23 实测：
 *   - detail 页的 h1 只有 14px（与正文同尺寸），真正的商品名却是 h2 —— h1 不是主标题；
 *   - 购物车 / 订单查询 / 支付 / 确认订单 / 两个结果页 **全站没有 h1**（页标题写成 h2）；
 *   - AI 导购页 **0 个标题**（页头是 span）；
 *   - 商城与服务页 h1→h3 **跳级**（分区标题全用 h3，中间空了 h2 这一层）。
 * 此前没有任何判据看过这件事：grep tests/ 里 heading 相关断言只有 16 处，
 * 且全部是「某个具体标题在不在」，没有一处管**层级结构**。
 *
 * 钉的三件事（都是客观的、有规范依据的）：
 *   ① 每页恰好一个 h1 = 该页主标题（0 个 = 没有目录锚点；2 个 = 读屏分不清哪个是标题）；
 *   ② 不跳级（h1 之后直接 h3）—— WCAG 2.4.6/1.3.1 的实践口径；
 *   ③ 取数面本身非空（扫不到任何标题 ⇒ 页面没渲染，不能读成"结构没问题"）。
 *
 * **刻意不钉的一件事**（写在这里，免得下一个人"顺手加个合理阈值"把全站判红）：
 *   不钉「标题字号必须大于正文」。本站分区标题走 .section-title = 14px/600 + 字距，
 *   与正文同尺寸而靠**字重与字距**分层 —— 这是编辑排版的合法选择（印刷里极常见），
 *   实测 detail 页 7 个、服务页 1 个属此类。把它判红等于逼着把分区标题放大，
 *   反而破坏刚建立的字号体系（见 CHANGELOG 字号收编那条）。
 *
 * 视口取桌面 1280：窄屏的商城页**有意不渲染**桌面刊头（两套布局是条件渲染，
 * 由 layout.spec.ts:356 与 customerPage.test.tsx:280 钉着），在窄屏量"每页一个 h1"
 * 会和那个设计决策打架。本判据不重复钉那个决策，只量桌面面。
 */

const VIEWPORT = { width: 1280, height: 900 }

/**
 * 视口必须测两档（2026-10-23 一手补上的维度缺口）。
 * 本判据从前只有 1280×900，而本站不少页面按 useIsNarrow 渲染**两棵不同的树** ——
 * 实测 /#/shop：1280 下有 h1「饮品」，390 下 h1 数量 0、整页零标题（窄屏分支把分类名
 * 渲染成了 <span>）。也就是说桌面合规完全不能推出移动合规，而微信内（390 这一档）
 * 恰恰是本站主战场。⇒ 只测宽屏的标题判据，对一半的真实使用场景是瞎的。
 */
const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
  ['桌面 1280', { width: 1280, height: 900 }],
  ['手机 390', { width: 390, height: 844 }],
]

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['shop-drinks', '/#/shop/drinks'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-query', '/#/order-query'],
  ['order-confirm', '/#/order-confirm'],
  ['payment', '/#/payment'],   // 需 seed：PaymentPage 无 orderId 会 navigate('/') 并 return null
  ['category-life', '/#/category/life'],
  ['service-form', '/#/service/delivery'],
  ['not-found', '/#/definitely-not-a-page'],
  ['admin', '/#/admin'],
]

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

interface Structure {
  total: number
  h1: number
  h1Text: string
  jumps: string[]
  sizes: Array<{ tag: string; size: number; text: string }>
}

/** 读当前视口内的标题结构（只数**自己有文字**的标题，避免空壳标题混进分母） */
async function readStructure(page: Page): Promise<Structure> {
  return page.evaluate(() => {
    const INFO = /[\u4E00-\u9FFF\u3040-\u30FFA-Za-z0-9]/
    const own = (el: Element) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && INFO.test(n.textContent || ''))
    const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(own)
    const seq = heads.map((h) => Number(h.tagName.slice(1)))
    const jumps: string[] = []
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] > seq[i - 1] + 1) jumps.push('h' + seq[i - 1] + ' → h' + seq[i])
    }
    return {
      total: heads.length,
      h1: seq.filter((n) => n === 1).length,
      h1Text: (heads.find((h) => h.tagName === 'H1')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      jumps,
      sizes: heads.map((h) => ({
        tag: h.tagName.toLowerCase(),
        size: Math.round(parseFloat(getComputedStyle(h).fontSize) * 10) / 10,
        text: (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18),
      })),
    }
  })
}

/**
 * 支付页没有订单号会立刻 navigate('/') 并 return null ⇒ 直接 goto 测的是首页（假覆盖）。
 * 与 contrast.spec.ts 的 seedPayment 同一手法：先写 sessionStorage 再进页面。
 */
async function seedPayment(page: Page) {
  await page.goto('/#/payment', { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    sessionStorage.setItem('sm_payment_order', 'HEADLESS-SEED-1')
    sessionStorage.setItem('sm_payment_amount', '12.5')
  })
  await page.goto('/#/payment', { waitUntil: 'networkidle' })
}

async function login(page: Page) {
  const keyInput = page.getByLabel('管理密钥')
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill('stub-any-key')
    await page.getByRole('button', { name: '进入后台' }).click()
    await expect(keyInput).toBeHidden()
  }
}

for (const [name, route] of ROUTES) {
  for (const [vpName, vp] of VIEWPORTS) {
  test(name + '：' + vpName + ' 标题层级合规（恰好一个 h1、不跳级）', async ({ page }) => {
    await page.setViewportSize(vp)
    if (name === 'payment') {
      await seedPayment(page)
    } else {
      await page.goto(route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1300)
    }
    await login(page)
    const s = await readStructure(page)
    expect(s.total, name + ' @' + vpName + ' 一个标题都没扫到 ⇒ 页面没渲染（别把空集读成"结构没问题"）').toBeGreaterThan(0)
    expect(s.h1, name + ' @' + vpName + ' 的 h1 数量是 ' + s.h1 + '（应恰好 1 个 = 该页主标题）；当前标题：\n  ' +
      s.sizes.map((x) => x.tag + ' ' + x.size + 'px 「' + x.text + '」').join('\n  ')).toBe(1)
    expect(s.jumps, name + ' 有跳级（父标题直接跳到子子级，中间层缺失）：\n  ' + s.jumps.join('\n  ')).toEqual([])
  })
  }
}

/**
 * 自证：注入第二个 h1 与一次跳级，两种破坏都必须被点名。
 * 没有这条，本判据可能只是「读不到就返回合规」的装饰。
 */
test('判据自证：注入多余 h1 与跳级，必须都被报出来', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1100)
  const base = await readStructure(page)
  expect(base.h1, '对照组：首页本应恰好一个 h1，若这里就不是 1，下面的断言没有意义').toBe(1)

  await page.evaluate(() => {
    // adoptedStyleSheets 而不是 style 属性：本页 CSP 是 style-src self，inline style 会被拦
    const sheet = new CSSStyleSheet()
    sheet.replaceSync('#hs-probe-a,#hs-probe-b{display:block;font-size:16px}')
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    const a = document.createElement('h1')
    a.id = 'hs-probe-a'
    a.textContent = '故意的第二个主标题'
    const b = document.createElement('h4')
    b.id = 'hs-probe-b'
    b.textContent = '故意的跳级子标题'
    document.body.appendChild(a)
    document.body.appendChild(b)
  })
  await page.waitForTimeout(200)
  const s = await readStructure(page)
  expect(s.h1, '注入第二个 h1 后 h1 数应变成 2 并被判红（实得 ' + s.h1 + '）').toBeGreaterThan(1)
  expect(s.jumps.length, '注入 h1→h4 跳级后必须被报出（实得 jumps=' + JSON.stringify(s.jumps) + '）').toBeGreaterThan(0)
})
