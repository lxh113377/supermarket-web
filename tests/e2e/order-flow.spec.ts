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

test('下单防误：楼栋/房间未填时阻止提交并播报', async ({ page }) => {
  await page.goto('/#/order-confirm')
  await page.getByRole('button', { name: /确认支付|仍要下单/ }).click()
  await expect(page.getByRole('alert')).toContainText(/楼栋|房间/)
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
