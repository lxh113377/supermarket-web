import { test, expect } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'
import { auditPage } from '../e2e/helpers/contrastAudit'

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
  /**
   * 钉死页面看到的"当前时间"（ISO 串，含 +08:00 偏移）。
   *
   * 为什么必须有：营业时间只认 new Date()（工作日 17:37–23:00 营业），
   * 而"非营业时间"那条琥珀提示**只在打烊后渲染**。不钉时间的话，
   * 白天跑 CI 就永远扫不到它 —— 本轮实测正是这样漏掉一个真缺陷：
   * text-amber-700 压 bg-amber-50/95 实测 4.44:1，差 0.06 不过 AA，
   * 只在 23:00 之后跑才暴露。一个"看运气才生效"的判据等于没有判据。
   * 所以这里成对钉两个时刻：营业中 / 已打烊，两种状态各扫一遍。
   */
  clock?: string
  /**
   * 该路由态下**必须出现**的文案（子串匹配）。
   * 为什么必须有：钉了打烊时刻，但若因为某种原因提示根本没渲染，
   * 对比度扫描就会"没东西可扫 ⇒ 零违规 ⇒ 通过"—— 空集读成通过，
   * 本仓明令禁止的假绿形态。这条断言把"状态确实渲染了"变成前置条件。
   */
  expectText?: string
}

/** 切到管理端某个页签（demo 模式直进后台，无需密钥） */
const openAdminTab = (label: string) => async (page: import('@playwright/test').Page) => {
  await page.getByRole('tab', { name: label }).click()
  await page.waitForTimeout(1200)
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
  /**
   * 管理端（2026-10-23 更正 + 扩面）。
   *
   * 原先这条叫 `admin-login`，但**名字是假的**：本套件跑的是
   * `vite.config.e2e.js` 构建（envDir 指向 env-empty 屏蔽 .env）⇒ IS_CLOUD=false ⇒
   * AdminGuard 直接放行、根本不渲染密钥框。实测 `/#/admin` 落在「商品」页签
   * （AdminPage 的 useState('products') 默认值，且不持久化）。
   * 也就是说这条一直在审商品列表页，却挂着一个"登录页"的名字 ——
   * 而登录页真正的覆盖面在 `tests/e2e-stub/dashboard-cloud.spec.ts`（云端模式才出密钥闸）。
   * 判据的名字必须说清它量的是什么，否则下一次"看着有覆盖其实没有"还会重演。
   *
   * 这五条量的是**演示构建下的管理端界面**（商品页签有真种子数据；订单/服务/评价
   * 与看板在演示模式下是空态/错误态）。空态与错误态本身也是商家天天看的界面，
   * 值得扫 —— 只是不许管它叫「有数据态」。
   * 看板**有数据**那一面（KPI 数字 + 四张 echarts）由 tests/e2e-stub/admin-contrast.spec.ts
   * 覆盖：只有假桩后端会返回 getDashboardStats，演示模式下它没有本地实现。
   */
  { name: 'admin-products', route: '/#/admin' },
  { name: 'admin-dashboard', route: '/#/admin', prepare: openAdminTab('看板') },
  { name: 'admin-orders', route: '/#/admin', prepare: openAdminTab('订单') },
  { name: 'admin-reviews', route: '/#/admin', prepare: openAdminTab('评价') },
  { name: 'admin-services', route: '/#/admin', prepare: openAdminTab('服务') },
  { name: 'home-mobile', route: '/#/', vp: MOBILE },
  // 周四 19:00（营业中）与周四 03:00（已打烊）成对钉死：
  // 打烊态才有"非营业时间"提示与"仍要下单"分支，必须也过 AA。
  { name: 'home-open-pinned', route: '/#/', clock: '2026-10-22T19:00:00+08:00', expectText: '营业中' },
  { name: 'home-closed-pinned', route: '/#/', clock: '2026-10-22T03:00:00+08:00', expectText: '非营业时间' },
  { name: 'category-life-closed', route: '/#/category/life', clock: '2026-10-22T03:00:00+08:00', expectText: '非营业时间' },
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

for (const r of ROUTES) {
  test(r.name + '：承载信息的文字全部过 WCAG AA', async ({ page }) => {
    await page.setViewportSize(r.vp || VIEWPORT)
    if (r.clock) {
      // 覆盖 Date 而不是改业务代码：判据测的是"页面在某个时刻长什么样"，
      // 为此在生产代码里留一个测试开关是本末倒置。
      const fixed = Date.parse(r.clock)
      await page.addInitScript((ms) => {
        const Real = Date
        class FakeDate extends Real {
          constructor(...args: any[]) {
            if (args.length === 0) super(ms)
            // @ts-expect-error 透传给原生 Date 构造器
            else super(...args)
          }
          static now() { return ms }
        }
        // @ts-expect-error 有意替换全局 Date
        window.Date = FakeDate
      }, fixed)
    }
    if (r.prepare) {
      await page.goto(r.route)
      await r.prepare(page)
    } else {
      await page.goto(r.route)
      await page.waitForTimeout(900)
    }
    if (r.expectText) {
      // 前置条件：这个态特有的内容必须真的在屏上（否则后面的"零违规"是空集假绿）
      await expect(page.getByText(r.expectText).first(),
        r.name + ' 钉的时刻下应当出现「' + r.expectText + '」，没出现 ⇒ 本用例扫的是错的状态')
        .toBeVisible({ timeout: 8000 })
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
 *
 * 另一次实测教训（记在这里，免得下一个人误判判据失效）：验判据灵敏度时
 * 变异必须打在**被判据覆盖的那一处**。本轮把 text-amber-800 退回 700 时先改了
 * HomePage，判据不报 —— 一度误判"判据是空的"；实测两个页面的合成底色根本不同：
 *   首页提示压在 bg-amber-50/95 卡上 ⇒ amber-700 实测 4.85:1（本来就合格，不该报）；
 *   分类页提示压在深绿头部上 ⇒ amber-700 实测 4.44:1（真违规，判据如实报红）。
 * 变异改到分类页后判据立刻报出 4.44:1 并点名元素 —— 灵敏度没问题，是变异打错了地方。
 * 同一色值在不同底上就是不同结论，这正是"量渲染像素而不是读源码"的价值。
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
