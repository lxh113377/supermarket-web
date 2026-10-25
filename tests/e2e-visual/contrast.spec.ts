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
 * 豁免口径（2026-10-23 更正）：只豁免**肉眼不可感知**的东西（display:none /
 * visibility:hidden / opacity<0.05）与**不含信息字符**的纯装饰图形（★ ✓ → ⚠️）。
 * 原先把 aria-hidden 当装饰代理判据是错的 —— 它对视力正常用户完全可见，
 * 而对比度管的正是肉眼看见的东西（一手漏网：进度条序号 gray-500 压 gray-100 = 4.39:1）。
 * 404 那个水印级巨大数字靠的应是"它自己就是装饰图形"，不是"它挂了 aria-hidden"。
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

/**
 * 展开「新增评价」表单。
 *
 * 为什么要单独一条路由：评分星（未选中的那几颗）在 <button> 里，属**功能性状态图形**，
 * WCAG 1.4.11 要 3:1 —— 但它默认折叠，不点开就永远扫不到。
 * 2026-10-23 实测：未选星用 text-gray-400 只有 2.54:1，正是靠"点开再扫"这条路由抓出来的。
 * 按钮可见文案是「+ 新增评价」（带前缀加号），所以用正则而不是精确名匹配。
 */
const openReviewForm = async (page: import('@playwright/test').Page) => {
  await page.getByRole('tab', { name: '评价' }).click()
  await page.getByRole('button', { name: /新增评价/ }).click()
  await expect(page.getByRole('heading', { name: '新增评价' })).toBeVisible({ timeout: 8_000 })
  /**
   * 必须先把点评到 1 星，否则**扫不到未选中态**。
   * 默认值是 `useState(5)` ⇒ 五颗星全部满足 `n <= formRating` 走 amber-600 分支
   * （3.19:1，本来就合格），`text-gray-*` 那一支在默认态下**根本不执行**。
   * 第一版没点星，导致"把 gray-500 变异成 gray-400"判据毫无反应 ——
   * 不是判据坏，是它扫的那个状态里没有未选中星。点成 1 星后 2–5 星进入未选中态，
   * 这条腿才有对象可量。
   */
  await page.getByRole('radio', { name: '1星' }).click()
  await expect(page.getByRole('radio', { name: '1星' })).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(500)
}

/**
 * 关掉「温馨提示」模态后再扫表单字段。
 *
 * 为什么需要这一条而不是只靠遮挡判定豁免：加了 isOccluded 之后，被模态盖住的
 * 12 个表单文字会被正确跳过（它们隔着遮罩的颜色不是用户实际会读到的颜色）——
 * 但那批字段标签/hint/上传区文字就**彻底没人扫了**。豁免只能解决"量错东西"，
 * 解决不了"没东西被量"，所以必须再有一条把模态关掉的路由把覆盖面补回来。
 */
const dismissServicePopup = async (page: import('@playwright/test').Page) => {
  const btn = page.getByRole('button', { name: '我知道了' })
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await expect(page.getByRole('heading', { name: '温馨提示' })).toBeHidden({ timeout: 5_000 })
  }
  await page.waitForTimeout(600)
}

/**
 * 订单查询「有结果」态（2026-10-23 补）。
 *
 * 为什么单独一条：order-query 此前只扫到 3 个含字元素 —— 那是**空表单态**，
 * 而顾客真正盯着看的是查出来之后那条四步进度条（订单号、状态标签、时间戳、
 * 去支付按钮全在有结果态里）。
 *
 * 一处需要更正的自我声称（本条注释第一版写错了，留在这里当反面教材）：
 * 我原本写"这条路由是为了扫进度条里 `{done ? '✓' : i + 1}` 那个字符图标"。
 * 实测那个 span 是 `aria-hidden="true"` 且**不在任何交互控件里**
 * ⇒ 图标腿按设计边界不扫它（语义由旁边的文字标签承载）⇒ 那句话是**没验证就写下的**，
 * 属于本仓禁止的"宣称了但没量"。这条路由的真实价值是**文字层**：
 * 有结果态里 `订单号 / 待支付…已送达 / 时间戳` 这批文字此前从未被扫过。
 *
 * 播种走演示模式自己的数据通路（getOrderStatus 在 IS_CLOUD=false 时读
 * localStorage 的 sm_orders_local），因此**不需要改 local-api-stub.mjs**
 * （那文件正被并行会话编辑，为一条判据去动它风险不对等）。
 *
 * 必须 reload：localStore 有模块级 parseCache，路由循环先前那次 goto 可能已把
 * "没有订单"缓存住；整文档重载才会带着我播种的数据重新起算。
 */
const seedOrderQueryResult = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => {
    localStorage.setItem('sm_orders_local', JSON.stringify([
      { _id: 'o_contrast_probe', status: 'paid', updatedAt: '2026-10-22T18:00:00.000Z', roomNumber: '36栋-501', items: [] },
    ]))
    // 页面自己写了这条兜底：带单号进来就自动查一次，顾客零输入
    sessionStorage.setItem('sm_query_order', 'o_contrast_probe')
  })
  await page.reload({ waitUntil: 'networkidle' })
  // 区分性证据：进度条真渲染出来了（不是空表单、也不是"未查到"提示）
  await expect(page.getByText('已支付')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('未查到该订单')).toHaveCount(0)
  await page.waitForTimeout(600)
}

/**
 * 购物车「清空」按钮的**待确认态**（armed）（2026-10-24 补，随内联两步确认改造一起立）。
 *
 * 为什么必须单独一条路由：armed 态只在**点过第一下之后**才存在 —— 红底白字的
 * 「确认清空」按钮平时根本不在 DOM 里，contrast 扫默认渲染面时永远看不见它。
 * 这与本文件 openReviewForm 那条立的同一课（原话：「第一版没点星 ⇒ 变异毫无反应，
 * 不是判据坏，是它扫的那个状态里没有未选中星」）：一个只在交互后出现的态，
 * 判据必须自己走过去，否则等于没扫。
 *
 * 走真加购而不是直接 seed localStorage：清空按钮的前提是 cart.items.length > 0，
 * 用页面自己的通路（点商品卡的加号）最不容易和实现细节脱钩。
 */
const armCartClear = async (page: import('@playwright/test').Page) => {
  await page.goto('/#/shop')
  await page.waitForTimeout(700)
  const btns = page.locator('button[aria-label^="添加"]')
  for (let i = 0; i < Math.min(4, await btns.count()); i++) {
    await btns.nth(i).click()
    await page.waitForTimeout(120)
  }
  await page.goto('/#/cart')
  await page.waitForTimeout(900)
  // 第一下：进入待确认态（不点第二下 —— 那会真清空，页面就换态了）
  await page.getByLabel('清空购物车').click()
  await expect(page.getByLabel('确认清空购物车')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(400)
}

/** 走 UI 真加购（凑过起送门槛，避免落在「差 ¥X 起送」的改版面上），再进目标路由 */
const seedCartThen = (route: string) => async (page: import('@playwright/test').Page) => {
  await page.goto('/#/shop')
  await page.waitForTimeout(700)
  const btns = page.locator('button[aria-label^="添加"]')
  for (let i = 0; i < Math.min(4, await btns.count()); i++) {
    await btns.nth(i).click()
    await page.waitForTimeout(120)
  }
  await page.goto(route)
  await page.waitForTimeout(900)
}

/**
 * 从确认页填完必填项并点提交走到成功页。
 * 不能直接 goto /#/order-success：那一页只读 useLocation().state，硬进 = 空壳，
 * 扫出来的是「什么字段都没有」的版面，等于没扫。
 * 楼栋号/房间号必填（未填会拦提交），所以必须先填。
 */
async function walkToSuccess(page: import('@playwright/test').Page) {
  await seedCartThen('/#/order-confirm')(page)
  await page.locator('#order-building').fill('36栋')
  await page.locator('#order-room').fill('501')
  await page.getByRole('button', { name: /确认支付|仍要下单/ }).click()
  // 落点必须是成功页：expectText 选的「楼栋号」在确认页也有，光靠它区分不了两页，
  // 所以这里用 URL 当**唯一有区分度**的证据（提交被拦、或跳去别处都会在这里红）。
  await expect.poll(() => page.url(), { timeout: 10_000, message: '提交后没落到下单成功页' })
    .toContain('/order-success')
  await page.waitForTimeout(800)
}

/**
 * 支付页 chooser 态（选哪种支付方式那一屏）。走页面自己的 sessionStorage 兜底路径
 * （PaymentPage 读 sm_payment_order / sm_payment_amount）。
 *
 * ⚠️ 本注释第一版写着「稳定渲染金额与二维码区」—— 那是**没验证就写下的假声称**：
 *   helper 停在 chooser 态（不点任何方式），二维码根本不渲染。2026-10-24 修支付页
 *   金额时才发现，顺手把「金额」与「二维码」两件事拆开：chooser 态由本条扫，
 *   二维码态由下面 seedPaymentQr 那条扫。
 *   （讽刺的是「chooser 有金额」这半句在改之前也是假的 —— 当时金额只在选完之后才出。
 *    一句话没量过就写进注释，迟早变成假的。）
 *
 * 两个时序坑（第一版就栽在这里，表现为 checked=0）：
 *   ① addInitScript 只对**之后**的导航生效 —— 路由循环已经 goto 过一次，
 *      所以这里必须再 goto 一次，否则注入等于没做；
 *   ② 没有 orderId 时 PaymentPage 会 navigate('/', { replace: true }) 跳回首页，
 *      扫到的就是首页而不是支付页 —— 所以必须等内容真出现再返回。
 */
const seedPayment = async (page: import('@playwright/test').Page) => {
  // 直接写 sessionStorage，不用 addInitScript：路由循环先前已经 goto 过一次，
  // 而 /#/ → /#/payment 只是 **同文档的 hash 变化**，不会新建文档 ⇒ init script 根本不跑
  // （第一版就栽在这里：表现为 heading 等不到、checked=0）。
  // sessionStorage 是同源同会话级持久的，写完之后 HashRouter 切到 payment 时页面自己就能读到。
  await page.evaluate(() => {
    sessionStorage.setItem('sm_payment_order', 'stub-order-0001')
    sessionStorage.setItem('sm_payment_amount', '10.94')
  })
  await page.goto('/#/payment')
  // 断言落点而不是断言"我导航过了"：没有 orderId 时 PaymentPage 会 replace 跳回首页，
  // 那种情况下扫到的是首页版面 —— 没有这条断言，本用例就会安静地扫错页。
  await expect(page.getByRole('heading', { name: '选择支付方式' })).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(600)
}

/**
 * 支付页二维码态（选完方式之后那一屏）：金额 + 满减行 + 琥珀色「请截图扫码付款」
 * 提示条 + 返回按钮。这屏文字此前从未被 contrast 扫过（chooser 那条不点进去）。
 * 琥珀提示条是本站出过对比度缺陷的那一类底色（2026-10-23 首页打烊提示实测 4.44:1
 * 差 0.06 不过 AA），必须扫到。
 */
const seedPaymentQr = async (page: import('@playwright/test').Page) => {
  await seedPayment(page)
  await page.getByRole('button', { name: '微信支付' }).click()
  // 落点断言：二维码态特有的那句提示必须在，否则等于还在扫 chooser
  await expect(page.getByText('请截图扫码付款')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(600)
}

/**
 * 走查面：顾客端主要路由，外加一批**必须交互才出现**的态（满车、搜索展开、购物车待确认、
 * 管理端行内/批量待确认、支付二维码）。这类态不自己走一遍交互就永远扫不到，
 * 规矩见 armCartClear 那条注释：判据得自己走过去。
 */
const ROUTES: RouteSpec[] = [
  { name: 'home', route: '/#/' },
  { name: 'shop', route: '/#/shop' },
  { name: 'shop-drinks', route: '/#/shop/drinks' },
  { name: 'detail', route: '/#/product/p_46' },
  { name: 'cart-empty', route: '/#/cart' },
  // 待确认态（armed）：红底白字的「确认清空」只在点过第一下后才进 DOM，
  // 不单独走一遍交互就永远扫不到它。expectText 是前置条件 —— 万一 armed 态
  // 没出现，扫描会对着默认态给出「零违规」的假绿。
  { name: 'cart-clear-armed', route: '/#/cart', prepare: armCartClear, expectText: '确认清空' },
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
  /**
   * 商品行的删除按钮「待确认态」（2026-10-24 补，随内联两步确认改造）。
   * 与 cart-clear-armed 同一条规矩：armed 的红底白字只在点过第一下之后才进 DOM，
   * 不自己走一遍交互就永远扫不到。行内按钮刻意保持 36px 方形、只换文字为「确认」，
   * 所以这里同时是在守「armed 态不换尺寸 ⇒ 版面不跳」那条设计决定。
   */
  {
    name: 'admin-row-delete-armed',
    route: '/#/admin',
    prepare: async (page) => {
      const btn = page.getByLabel('删除商品').first()
      await expect(btn).toBeVisible({ timeout: 8_000 })
      await btn.click()
      await expect(page.getByLabel('确认删除该商品（不可撤销）')).toBeVisible({ timeout: 5_000 })
      await page.waitForTimeout(400)
    },
    expectText: '确认',
  },
  /**
   * 批量操作栏的「批量删除」与「应用改价」待确认态。
   * 批量条本身也是交互后才出现（勾选任意商品才有），armed 又是二次交互后才出现，
   * 所以这条路由要走两步：勾选 → 点亮。
   *
   * 本条路由只保证 armed 态那批新文字（「确认」「确认改价」）过对比度 —— contrast 的
   * 口径就是对比度，它不量尺寸；armed 换文案会不会撑动版面由 armed-stability.spec.ts 管。
   *
   * 这条路由的文案改过三次，每次都是判据先红、人才去读文案（值得记）：
   *   ① 「确认改为统一设为 ¥5.00」—— 两个动词叠在一起的语病，被对比度变异打印文案时暴露；
   *   ② 收成「确认改为 ¥5.00」后仍不对：按钮从 47.7px 涨到 103.1px，把同排输入框挤窄；
   *   ③ 最终「应用改价 / 确认改价」两态等字数 ⇒ 恒宽。
   * 每次 expectText 都会因文案变更而红（它写的是「应当出现 X，没出现 ⇒ 本用例扫的是错的
   * 状态」），这正是它作为前置条件的价值：改文案的人被迫回答「判据还在量它想量的东西吗」。
   */
  {
    name: 'admin-batch-armed',
    route: '/#/admin',
    prepare: async (page) => {
      await page.getByRole('button', { name: /全选/ }).click()
      const del = page.getByLabel('批量删除选中商品')
      await expect(del).toBeVisible({ timeout: 5_000 })
      await del.click()
      await expect(page.getByLabel(/确认删除选中的/)).toBeVisible({ timeout: 5_000 })
      // 退掉删除的待确认态必须用 Esc，不能点第二下 —— 那会真的批量删除，
      // 批量条随 selectedIds 清空而消失，后面就点不到改价按钮了。
      // 顺带这也是在验 hook 的 Esc 通路真的生效。
      await page.keyboard.press('Escape')
      await expect(page.getByLabel(/确认删除选中的/)).toHaveCount(0, { timeout: 5_000 })
      await page.waitForTimeout(200)
      // 必须精确匹配 input 的 label：正则 /批量改价/ 会同时命中我给按钮起的
      // 可访问名「应用批量改价：…」⇒ strict mode violation。这也是一条真实信号：
      // 我给按钮加的名字与输入框的名字有共同前缀，读屏用户听到的是同一串关键词。
      const priceInput = page.getByLabel('批量改价：数字表示统一价，数字加百分号表示打折')
      await priceInput.fill('5')
      await page.getByLabel(/应用批量改价/).click()
      await expect(page.getByLabel(/确认把选中的/)).toBeVisible({ timeout: 5_000 })
      await page.waitForTimeout(400)
    },
    expectText: '确认改价',
  },
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
  /**
   * 下单主链路三页（2026-10-23 补）。
   *
   * 此前对比度闸完全没覆盖确认订单 / 下单成功 / 支付 —— 而它们恰恰是转化漏斗的最后
   * 三屏，也是上一轮手工改过对比度（琥珀按钮、金额展示体）却没有判据兜着的地方。
   * 手工改完没闸 = 下一轮必然回归。
   *
   * 三页数据来源不同，注入方式也不同（不是随手 goto 就能扫到内容）：
   *   - order-confirm：读 localStorage 的 sm_cart ⇒ 先走 UI 真加购；
   *   - order-success：只读 location.state ⇒ 必须从确认页点过去；
   *   - payment：orderId 有 sessionStorage 兜底（页面自己写了这条 fallback 路径），
   *     注入两个键即可稳定渲染，不依赖上一步。
   */
  // 评价表单展开态：评分星、必填标记、图片上传区都在这里（折叠时扫不到）
  { name: 'admin-review-form', route: '/#/admin', prepare: openReviewForm, expectText: '发布' },
  // 有结果态：四步进度条 + ✓ 字符图标（空表单态扫不到这些）
  { name: 'order-query-result', route: '/#/order-query', prepare: seedOrderQueryResult, expectText: '订单号' },
  /**
   * 服务表单（带动态字段的那一类，2026-10-23 补）。
   *
   * 此前对比度闸没覆盖服务表单：17 个服务里 15 个带 fields（姓名/电话/图片上传…），
   * 字段标签、hint 微文案、上传区、至少N张/最多N张 这类约束文字全在这一页，从未被扫过。
   * 数据来自静态 data/services.ts（不走后端），所以 demo 构建里能直接渲染。
   * 选 delivery（外卖帮拿）：字段含 tel 与 image 两类，覆盖面最广。
   */
  { name: 'service-form', route: '/#/service/delivery', expectText: '填写信息' },
  // 关掉模态后的表单字段（标签/hint/上传区/约束文字）——遮挡判定把它们从上一条里豁免了
  { name: 'service-form-fields', route: '/#/service/delivery', prepare: dismissServicePopup, expectText: '电话号' },
  { name: 'order-confirm', route: '/#/order-confirm', prepare: seedCartThen('/#/order-confirm'), expectText: '确认订单' },
  /**
   * 打烊态确认页（2026-10-25 补，CI 实证立此条）。
   *
   * 由来：本轮 CI 在北京时间凌晨跑，contrast 扫到 order-confirm 的打烊按钮
   * 「非营业时间 - 仍要下单」= bg-amber-600 + text-ink ⇒ 实测 2.2:1 不过 AA；
   * 而本地营业时段跑同一条判据时这个按钮**根本不渲染** ⇒ 绿。这正是本文件头注里
   * 批评过的「看运气才生效的判据」：缺陷不会只在凌晨出现，但判据只在凌晨看得见它。
   * 处置两步（缺一不可）：① 修色（铜底配深褐字，amber-600 上 6.7:1）；
   * ② 把该态**钉钟**成常驻路由，让判据每天任何时刻都必然扫到它。
   * 钉 03:00 沿用 home-closed-pinned 的口径（工作日深夜打烊）。
   */
  { name: 'order-confirm-closed', route: '/#/order-confirm', clock: '2026-10-22T03:00:00+08:00', prepare: seedCartThen('/#/order-confirm'), expectText: '仍要下单' },
  // 「查询订单状态」只在成功页出现（确认页没有），且不受网络态改写标题影响
  { name: 'order-success', route: '/#/order-confirm', prepare: walkToSuccess, expectText: '查询订单状态' },
  // expectText 从「选择支付方式」改成「本次应付」—— 钉的是 2026-10-24 这次修复的
  // 产品语义（选之前就得看见金额），不只是「页面活着」。
  { name: 'payment', route: '/#/payment', prepare: seedPayment, expectText: '本次应付' },
  // 二维码态单独一条：金额与琥珀提示条都在选完方式之后才渲染的那一屏上，此前从未被扫。
  { name: 'payment-qr', route: '/#/payment', prepare: seedPaymentQr, expectText: '请截图扫码付款' },
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
