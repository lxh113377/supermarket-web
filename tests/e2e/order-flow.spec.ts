import { test, expect } from '@playwright/test'
import { watchErrors, DEV_CSP_NOISE, type ErrorWatch } from './helpers/watchErrors'

/**
 * 下单主链路 + 订单状态机 e2e（2026-09-24 对标 P0-A3 扩充）
 * 跑在本地演示模式（localStorage），不依赖后端；商品 id 规则 = `p_` + order（乐事薯片 order 33）。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page, DEV_CSP_NOISE)
})
test.afterEach(() => errs.assertClean())

async function placeDemoOrder(page: import('@playwright/test').Page) {
  await page.goto('/#/product/p_33')
  const addBtn = page.getByRole('button', { name: '加入购物车' })
  // 详情页异步加载（骨架屏→内容），先等按钮出现再点
  await expect(addBtn).toBeVisible({ timeout: 15_000 })
  // 加 3 件：乐事薯片 40g 单价 ¥2.66 ⇒ 3 件 7.98 元，落在**起送门槛**（¥6.00，
  // 2026-10-22 老大立规「总价低于六元不配送」）之上。1 件会被确认页的同源闸门拦下，
  // 那条负路径由下面「未达起送门槛」这一条用例专门守，不靠这里顺带覆盖。
  await page.getByRole('button', { name: '增加购买数量' }).click()
  await page.getByRole('button', { name: '增加购买数量' }).click()
  await addBtn.click()
  await page.goto('/#/cart')
  const payBtn = page.getByRole('button', { name: '去支付' })
  await expect(payBtn).toBeVisible({ timeout: 15_000 })
  await payBtn.click()
  await expect(page.getByLabel(/楼栋号/)).toBeVisible()
  await page.getByLabel(/楼栋号/).fill('36栋')
  await page.getByLabel(/房间号/).fill('501')
  // 营业时间按钮文案随时间变化，两者皆视为提交入口
  await page.getByRole('button', { name: /确认支付|仍要下单/ }).click()
  // 等成功页挂载：其 useEffect 写入 sm_query_order（查询页自动回填依赖此），防"点完立刻 goto"竞态
  await expect(page.getByText('下单成功')).toBeVisible()
}

test('下单链路：加购 → 填写地址 → 提交 → 下单成功（含房间号回显）', async ({ page }) => {
  await placeDemoOrder(page)
  await expect(page.getByText('下单成功')).toBeVisible()
  await expect(page.getByText(/36栋[-—]?501|501/).first()).toBeVisible()
})

test('未达起送门槛（总价低于 ¥6.00）：购物车不出现结算入口并提示差额', async ({ page }) => {
  // 这是老大本轮立规的**屏上承诺**：1 件薯片 = ¥2.66，必须当场看到"不配送"，
  // 而不是填完楼栋房间号才被拦。守的是提示本身，不是服务端（服务端另有 verify-backend 探针）。
  await page.goto('/#/product/p_33')
  await expect(page.getByRole('button', { name: '加入购物车' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '加入购物车' }).click()
  await page.goto('/#/cart')
  // 定位器必须落在**购物车那一条**文案上：/#/cart 是覆盖在详情页之上的抽屉，
  // 详情页「配送说明」的两条 <li>（同样写着 ¥6.00 不配送）仍在 DOM 里，
  // 直接 getByText(/不满 ¥6\.00 不配送/) 会命中 3 个元素撞 strict mode（本轮实测）。
  // 「再挑 ¥X 即可下单」这句只在购物车横幅里，用它锚定元素再核全文。
  // 「再挑 ¥3.34 即可下单」这句只存在于购物车横幅（详情页没有），用它锚定；
  // .first() 是因为横幅文案在 span + 父 p 两层都会命中（getByText 不剪祖先）。
  const hint = page.getByText(/再挑 ¥3\.34 即可下单/).first()
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('不满 ¥6.00 不配送')
  // 结算入口换成"去凑单"，且点它不会把人带进确认页死胡同
  await expect(page.getByRole('button', { name: '去支付' })).toHaveCount(0)
  await page.getByRole('button', { name: /起送，去凑单/ }).click()
  await expect(page).toHaveURL(/#\/shop/)
})

test('未达起送门槛时深链直接进确认页：横幅告知 + 提交被阻止', async ({ page }) => {
  await page.goto('/#/product/p_33')
  await expect(page.getByRole('button', { name: '加入购物车' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '加入购物车' }).click()
  await page.goto('/#/order-confirm')
  // 同上：确认页横幅与身后详情页共用「¥6.00 不配送」字面 ⇒ 锚在只属于本页的「还差 ¥3.34 起送」上，
  // 再在**横幅容器**（role=status）内核标题文案（那句在兄弟 <p> 里，锚在文案节点上会漏）。
  const banner = page.getByText(/还差 ¥3\.34 起送/).first()
  await expect(banner).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '不配送' }).first()).toBeVisible()
  await page.getByLabel(/楼栋号/).fill('36栋')
  await page.getByLabel(/房间号/).fill('501')
  await page.getByRole('button', { name: /确认支付|仍要下单/ }).click()
  await expect(page.locator('#order-error')).toContainText(/不满 ¥6\.00 不配送/)
})

test('下单防误：楼栋/房间未填时阻止提交并播报', async ({ page }) => {
  await page.goto('/#/order-confirm')
  await page.getByRole('button', { name: /确认支付|仍要下单/ }).click()
  await expect(page.getByRole('alert')).toContainText(/楼栋|房间/)
})

/**
 * 支付页 chooser 态必须当场显示金额（2026-10-24 补）。
 *
 * 一手缺陷：改之前 PaymentPage 只在**选完支付方式之后**才渲染金额 ——  chooser 那一屏
 * 只有「请选择支付方式完成付款」+ 两个按钮。用户站在"要不要现在付"的决策点上不知道
 * 自己付多少钱，这是交易页的信息架构缺陷。
 * 为什么这条走真实下单链路而不是 sessionStorage 兜底：兜底路径测的是「页面读得到
 * 存储」，测不到「金额从确认页一路传到支付页」这条真链（confirm → success → payment
 * 三段 state 里任何一段丢了 totalAmount，兜底测试都发现不了）。
 * 断言金额相等而不是只断"有金额"：只断存在性会放过"传丢了显示 ¥0.00"这一类。
 */
test('下单后进支付页：选方式之前就能看到应付金额', async ({ page }) => {
  await placeDemoOrder(page)
  // 确认页合计（3 件 × ¥2.66 = ¥7.98）—— 先拿它当基准，再核支付页显示同一个数
  const expect798 = /7\.98/
  await expect(page.getByText('去支付')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '去支付' }).click()
  await expect(page.getByRole('heading', { name: '选择支付方式' })).toBeVisible({ timeout: 15_000 })
  // chooser 态：金额必须在屏上（改之前这里必红）
  const amount = page.locator('.price-num').first()
  await expect(amount).toBeVisible({ timeout: 10_000 })
  await expect(amount).toContainText(expect798)
  // 两个支付按钮也在（金额不能把按钮挤出视口）
  await expect(page.getByRole('button', { name: '微信支付' })).toBeVisible()
  await expect(page.getByRole('button', { name: '支付宝付款' })).toBeVisible()
  // 点进微信后仍是同一个数（两态共用一个金额块，不许一边对一边错）
  await page.getByRole('button', { name: '微信支付' }).click()
  await expect(page.locator('.price-num').first()).toContainText(expect798, { timeout: 10_000 })
})
test('订单查询页：下单后凭 sessionStorage 单号自动查出「待支付」进度', async ({ page }) => {
  await placeDemoOrder(page)
  await page.goto('/#/order-query')
  await expect(page.getByText('订单查询')).toBeVisible()
  // 自动查询（成功页写入 sm_payment_order）：5 步进度第一步高亮
  await expect(page.getByText('订单号', { exact: true })).toBeVisible()
  await expect(page.locator('ol li')).toHaveCount(4)
  await expect(page.getByText('待支付').first()).toBeVisible()
})

test('管理端订单：新单以待支付出现，状态流转选项符合状态机', async ({ page }) => {
  await placeDemoOrder(page)
  await page.goto('/#/admin')
  await page.getByRole('tab', { name: /订单/ }).click()
  await expect(page.getByText('房间号：36栋-501')).toBeVisible()
  const statusSelect = page.getByLabel('订单 36栋-501 的状态')
  // pending 的合法下一步 = 当前(待支付) + 已支付 + 已取消；不得出现跨态（配送中/已送达）
  await expect(statusSelect.locator('option')).toHaveText(['待支付', '已支付', '已取消'])
  await statusSelect.selectOption('paid')
  await expect(page.getByRole('status').filter({ hasText: '订单状态已更新为「已支付」' })).toBeVisible()
  // 迁移后该行下拉刷新为 paid 的合法集合
  await expect(statusSelect.locator('option')).toHaveText(['已支付', '配送中', '已取消'])
})
