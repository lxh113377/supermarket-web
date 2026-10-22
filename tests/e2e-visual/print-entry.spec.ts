import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'

/**
 * 打印入口的「就地打开」判据 —— 钉住老大的原话：「我要打开就是打印的页面，不要跳转，不要提示」。
 *
 * 为什么放本目录（跑生产构建）而不是 tests/e2e（跑 dev）：一手实测边界就一条线。
 *   dev：GET /print/ → 200 但返回的是 **React 入口壳**（Vite 的 SPA 回退），页面里的
 *        <script type=module src=/user/bootstrap.js> 在 dev 下只回 19B ⇒ 浏览器报
 *        「The script has an unsupported MIME type ('text/html')」⇒ 应用根本不起来；
 *   生产构建：GET /print/ → 200 且 2423B 真含「校园打印」，/admin/ 同理含「经营后台」
 *        （public/{print,admin} 是构建期拷进 dist 的静态目录，只有静态托管才会按目录索引）。
 * 也就是说：把这条判据放进 dev 套件，它会**永远测一个不存在的行为**（或在回退壳上打转）。
 * 线上两端（Cloudflare Pages / GitHub Pages）都是静态托管 ⇒ 生产构建才是与线上一致的面。
 *
 * 为什么必须有它：/print 已整体换成搬进来的校园打印应用，而这条要求先后被两种缺陷破坏过 ——
 *   ① 早期 PrintPage 会 location.replace 到**外部域名**，微信里表现为一张拦截说明页；
 *   ② 入口页只剩空白，看起来像死页。
 * 两种修法都改过代码，但此前**没有任何测试**钉住「从本站点进去 = 直接看到打印应用本体」，
 * 每次回归只能靠人肉在手机里点（grep 全仓 tests/e2e* 里 'print' 命中 0 处，一手）。
 *
 * 不传 DEV_CSP_NOISE：本套件跑生产构建，没有 dev 注入的 inline style，真出现 CSP 违规就该红。
 */

let errs: ErrorWatch
test.beforeEach(({ page }) => {
  errs = watchErrors(page)
})
test.afterEach(() => errs.assertClean())

/** 应用本体的指纹：搬进来的 index.html 里的品牌与导航，缺一个就说明静态面被换掉了。 */
const APP_MARKERS = ['校园打印', '打印下单', '我的订单'] as const

/** 任何「提示页/跳转页/说明页」形态都算回归 —— 逐字锚定，不用泛化词（R236 同规）。 */
const INTERSTITIAL_RE = /校园打印 · 说明|说明页|即将跳转|正在跳转|去打印页面|后端暂不可用|页面不存在|404/

async function expectAppInPlace(page: Page) {
  // 先等换页再断言：跳板是在 useEffect 里调 location.replace 的，goto 返回时它还没走
  await page.waitForURL(/\/print\/(#print)?$/, { timeout: 25_000 })
  const host = new URL(page.url()).host
  expect(host, `不得离开本站域名，实际落在 ${page.url()}`).toBe(new URL(test.info().project.use.baseURL ?? '').host)
  for (const m of APP_MARKERS) {
    await expect(page.getByText(m).first(), `应用本体应渲染「${m}」`).toBeVisible({ timeout: 25_000 })
  }
  const body = await page.locator('body').innerText()
  expect(body, '不应出现任何提示/跳转/说明类文案').not.toMatch(INTERSTITIAL_RE)
  // 页面标题必须是应用自己的，不是 React 壳的 —— 这是「返回的是哪份 HTML」的最省判据
  await expect(page).toHaveTitle(/校园打印/)
}

test('A 路由板 #/print ⇒ 直接落在打印应用里，无提示页', async ({ page }) => {
  await page.goto('/#/print')
  await expectAppInPlace(page)
})

test('B 真实路径：分类页点「打印」服务 ⇒ 同样直接进应用', async ({ page }) => {
  await page.goto('/#/category/study')
  const card = page.getByRole('button', { name: /打印/ }).first()
  await expect(card, '学习分类下应有「打印」服务卡').toBeVisible({ timeout: 25_000 })
  await card.click()
  await expectAppInPlace(page)
})

test('C 全程不离开本站域名（跨域跳转正是当年微信拦截的成因）', async ({ page }) => {
  const hosts = new Set<string>()
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) hosts.add(new URL(f.url()).host)
  })
  await page.goto('/#/print')
  await expectAppInPlace(page)
  await page.waitForTimeout(2500)
  const seen = [...hosts]
  expect(seen.length, `主框架只应停在一个域名，实际走过 ${seen.join(' → ')}`).toBe(1)
})

/**
 * D 判的是**静态面在不在**，不是后台能不能干活，所以一律读 HTML 而不是等 JS 跑完：
 * 本套件在 CI 里没有打印后端（那服务跑在老大本机 + 隧道），后台的 bootstrap 会因 /api 拿不到
 * 而提前停下 —— 实测本机 preview 下 document.title 停在 i18n 写的「校园打印」，线上才补成
 * 「校园打印 · 经营后台」。拿运行时标题当判据 = 把判据绑在后端存活上，CI 必红且红得没意义。
 * 与线上探活 uptime-check.mjs 的 adminPage() 同口径：标题 + 是否真引 /admin/bootstrap.js。
 */
test('D 经营后台静态面在册（搬进来的 11 件不是构建产物，最易被误删）', async ({ page, request }) => {
  // 取**原始字节**而不是 page.content()：后者序列化的是当前 DOM，而 shared/i18n.js 会在运行时
  // 把 document.title 改写成 t('brand')（本机实测停在「校园打印」，线上 bootstrap 跑完才补成
  // 「校园打印 · 经营后台」）⇒ 用 page.content() 判标题等于又绑回后端存活，正是本条要避免的。
  const raw = await (await request.get('/admin/')).text()
  await page.goto('/admin/')
  expect(raw, '后台 HTML 的 title 应含「经营后台」⇒ 伺服的不是 React 壳').toMatch(/<title>[^<]*经营后台/)
  expect(raw, '后台应引 /admin/bootstrap.js ⇒ 入口脚本没掉').toMatch(/\/admin\/bootstrap\.js/)
  await expect(page.locator('#brand-suffix'), '品牌后缀应渲染「经营后台」').toBeVisible({ timeout: 25_000 })
  const body = await page.locator('body').innerText()
  expect(body, '后台首屏不应是提示页').not.toMatch(INTERSTITIAL_RE)
})
