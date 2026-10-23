import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 「跳到主要内容」端到端闸（2026-10-23 新增，量的是键盘可达性）。
 *
 * 为什么必须有：没有 skip link 时，键盘用户从商城页 Tab 进主内容要**先穿过几十个
 * 商品卡按钮**（实测 /#/shop 一屏内交互目标 26 个、整页 73 个）。而搬进来的打印应用
 * （public/print/index.html）本来就有 skip-link —— 外部资产比自研部分更规范。
 *
 * 这条判据同时钉住四件事，缺一件都会静默退化：
 *   ① 每页恰好一个 main landmark，且带 id=main-content 与 tabIndex=-1
 *      （main 本身不可聚焦时 focus() 会被浏览器忽略，读屏不会从那里开始读）；
 *   ② main 不嵌在别的 landmark 里 —— role="main" 若是 banner/navigation/
 *      complementary/contentinfo 的后代，ARIA 规范下它的 landmark 身份不成立，
 *      读屏的"区域列表"里就找不到它，等于没加；
 *   ③ Tab 第一次就落在 skip link 上（它必须在文档最前，否则起不到"跳过"作用）；
 *   ④ **激活后路由地址不变** —— 这条是本站架构特有的坑：HashRouter 把路由住在
 *      location.hash 里，常规写法 <a href="#main-content"> 会把 hash 改成
 *      "#main-content" ⇒ react-router 找不到该路由 ⇒ 整页跳到 404。
 *      实测踩过（点一次就从 /#/shop/drinks 掉到 404 页），所以必须钉住。
 *
 * 隐藏方式也钉一下：未聚焦时它必须**不在视口内**。此前试过"收成 1px + clip-path"，
 * 结果 1×1 的盒子仍占在左上角、被触控判据按 WCAG 2.5.8 的 24×24 中心框算出与返回
 * 按钮重叠 9px —— 那条判据是对的，所以正解是移出视口而不是给它开豁免。
 */

const VIEWPORT = { width: 1280, height: 900 }

const ROUTES: Array<[string, string]> = [
  ['home', '/#/'],
  ['shop', '/#/shop'],
  ['shop-drinks', '/#/shop/drinks'],
  ['detail', '/#/product/p_46'],
  ['cart', '/#/cart'],
  ['assistant', '/#/assistant'],
  ['order-query', '/#/order-query'],
  ['order-confirm', '/#/order-confirm'],
  ['category-life', '/#/category/life'],
  ['service-form', '/#/service/delivery'],
  ['admin', '/#/admin'],
  ['not-found', '/#/definitely-not-a-page'],
]

/**
 * 为什么清单里没有 /print：它不是"漏了"，而是**不该在这里判**。
 * PrintPage 是 return null 的零内容跳板 —— 挂载即 window.location.replace 到同源静态
 * 面 /print/（public/print/index.html），而**那个页面自带** skip-link 与 #content 目标
 * （见其第 13 行）。给它补一份 React 侧的 main 既无意义（页面根本不渲染），也会与
 * tests/e2e-visual/print-entry.spec.ts 钉住的「打开就是打印应用本体、不要跳转页」冲突。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

async function login(page: Page) {
  const keyInput = page.getByLabel('管理密钥')
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill('stub-any-key')
    await page.getByRole('button', { name: '进入后台' }).click()
    await expect(keyInput).toBeHidden()
  }
}

for (const [name, route] of ROUTES) {
  test(name + '：main landmark 唯一、不被嵌套、且是 Tab 的第一站', async ({ page }) => {
    await page.setViewportSize(VIEWPORT)
    await page.goto(route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1300)
    await login(page)
    const out = await page.evaluate(() => {
      const mains = Array.from(document.querySelectorAll('[role="main"], main'))
      const m = mains[0] || null
      const chain: string[] = []
      let n = m ? m.parentElement : null
      while (n && n !== document.body) {
        const role = n.getAttribute('role')
          || (({ header: 'banner', footer: 'contentinfo', nav: 'navigation', aside: 'complementary', form: 'form' } as Record<string, string>)[n.tagName.toLowerCase()] || null)
        if (role) chain.push(role)
        n = n.parentElement
      }
      const skip = document.querySelector('a.skip-link')
      const sr = skip ? skip.getBoundingClientRect() : null
      return {
        mains: mains.length,
        hasId: !!m && m.id === 'main-content',
        focusable: !!m && m.tabIndex === -1,
        nestedIn: chain,
        skipExists: !!skip,
        skipInViewport: !!sr && sr.top >= 0 && sr.bottom <= innerHeight && sr.left >= 0 && sr.right <= innerWidth,
      }
    })
    expect(out.skipExists, name + ' 没有 skip link 元素').toBe(true)
    expect(out.mains, name + ' 的 main landmark 数量是 ' + out.mains + '（应恰好 1 个）').toBe(1)
    expect(out.hasId, name + ' 的 main 缺 id="main-content"，skip link 将找不到目标').toBe(true)
    expect(out.focusable, name + ' 的 main 没有 tabIndex=-1 ⇒ focus() 无效、读屏不会从那里开始读').toBe(true)
    expect(out.nestedIn, name + ' 的 main 嵌在其他 landmark 内（' + out.nestedIn.join('>') + '）⇒ ARIA 下它的 landmark 身份不成立').toEqual([])
    expect(out.skipInViewport, name + ' 的 skip link 未聚焦时仍占在视口内 ⇒ 会与相邻控件的触控区重叠').toBe(false)
  })
}

/**
 * 激活链路：Tab → 可见 → Enter → 焦点落到 main 且**路由地址一字未变**。
 * 单独一条用例而不是塞进上面的循环：它测的是"跳转"这个动作的后果，
 * 而 404 退化正是由动作引起的（静态结构全对也会中招）。
 */
test('跳到主要内容：Tab 唤出后回车，焦点进 main 且 hash 路由不被改写', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/shop/drinks', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const hashBefore = await page.evaluate(() => location.hash)
  expect(hashBefore, '前置条件：应当停在 /#/shop/drinks').toContain('/shop/drinks')

  // 复位焦点到文档开头（页面加载后 activeElement 是 body，第一次 Tab 才从最前开始）
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => {
    const el = document.activeElement
    const r = el ? el.getBoundingClientRect() : null
    return {
      isSkip: !!el && el.classList.contains('skip-link'),
      text: el ? (el.textContent || '').trim() : null,
      inViewport: !!r && r.top >= 0 && r.bottom <= innerHeight,
    }
  })
  expect(first.isSkip, '第一次 Tab 应落在 skip link 上（实测落在 ' + first.text + '）⇒ 它不在文档最前，起不到跳过作用').toBe(true)
  expect(first.text, 'skip link 文案').toBe('跳到主要内容')
  expect(first.inViewport, '聚焦后 skip link 必须出现在视口内（否则键盘用户看不见自己在哪）').toBe(true)

  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => ({
    hash: location.hash,
    body: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 60),
    active: document.activeElement ? document.activeElement.tagName.toLowerCase() + '[role=' + (document.activeElement.getAttribute('role') || '') + ']' : null,
  }))
  expect(after.hash, '回车后 hash 变成 ' + after.hash + '（前 ' + hashBefore + '）⇒ 锚点默认行为没被拦住，HashRouter 会把它当路由跳走').toBe(hashBefore)
  expect(after.active, '回车后焦点没落到 main（实得 ' + after.active + '）').toContain('[role=main]')
  expect(after.body, '页面内容不应变成 404').not.toContain('页面走丢了')
})

/**
 * 自证：把 skip link 换成常规 href 锚点写法（不设 preventDefault），
 * 必须复现出"路由被改写 + 掉进 404"—— 证明上面那条断言真的有牙齿，
 * 而不是恰好通过。
 */
test('判据自证：换成裸锚点写法，必须把用户踢进 404', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/#/shop/drinks', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  await page.evaluate(() => {
    const old = document.querySelector('a.skip-link')
    if (old) old.remove()
    const a = document.createElement('a')
    a.href = '#main-content'          // 常规写法：不拦默认行为
    a.className = 'skip-link'
    a.textContent = '裸锚点探针'
    document.body.prepend(a)
  })
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.focus('a.skip-link')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => ({ hash: location.hash, body: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 60) }))
  expect(after.hash, '裸锚点没改写 hash ⇒ 本站可能不再是 HashRouter，本自证的前提已失效，须重估').not.toBe('#/shop/drinks')
  expect(after.body, '裸锚点写法应当把用户带进 404（这正是判据要防的事）').toContain('页面走丢了')
})
