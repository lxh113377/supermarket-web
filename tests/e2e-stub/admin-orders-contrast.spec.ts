import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'
import { auditPage } from '../e2e/helpers/contrastAudit'

/**
 * 后台订单页签的有数据态对比度闸（2026-10-24 新增，跑在 tests/e2e-stub 的假桩后端上）。
 *
 * 为什么必须有：这是上一轮补「评价 / 服务提交」两个页签时剩下的**同一形状的最后一块**。
 * 桩此前对 getOrders 直接回空数组，而 getAllOrders 在非云模式读本地（demo 里同样空）
 * ⇒ 订单页签的有数据态此前一行都没被任何判据扫过。
 *
 * 而它不只有一个面：订单页在拿到列表之后还会自动去拉 stalePendingReport（超时未确认
 * 面板）与 getPromotions（满减档位面板），两者**默认收起**、事件时间线**要逐单点击**才
 * 展开 ⇒ 光补列表数据仍然扫不到那三块，而它们恰好是本页小字最密的地方（实测含
 * text-2xs 11px 与 text-3xs 10px 两级，压的是 amber-50 / emerald-50 / 白 70% 半透明底）。
 * 所以本件分两条腿：一条扫默认视图，一条把三块全展开后再扫。
 *
 * 桩数据在 scripts/local-api-stub.mjs 的 ORDERS / STALE_REPORT / PROMOTIONS / EVENT_LOG，
 * 形状逐条核对过源码（含 SPEC_FLAVOR_SEP 实测是「空格+间隔号+空格」，口味徽章只有
 * 按这个分隔符写的 spec 才会出现）。
 *
 * 前置条件一律钉**具体文案**而不是"loading 消失"：getOrders 返回空数组是**成功**，
 * 只等 loading 会扫到一个空态页并给出「零违规」，看着全绿其实什么都没量。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

async function openOrders(page: Page) {
  await page.goto('/#/admin')
  const keyInput = page.getByLabel('管理密钥')
  // 桩模式必须是云端模式：静默降级成演示模式的话，本件就扫不到真数据（假绿）
  await expect(keyInput, '桩模式下必须出现密钥闸（没降级成本地演示模式）').toBeVisible()
  await keyInput.fill('stub-any-key')
  await page.getByRole('button', { name: '进入后台' }).click()
  await expect(keyInput).toBeHidden()
  await page.getByRole('tab', { name: '订单' }).click()
  // 列表落点：房间号 + 口味徽章 + 满减角标各钉一条，证明数据真的渲染出来了
  await expect(page.getByText('房间号：36栋-501')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('口味 黄瓜味')).toBeVisible()
  await expect(page.getByText('已优惠 ¥1.00')).toBeVisible()
  await page.waitForTimeout(600)
}

test('订单列表有数据态：房间号/口味徽章/满减角标全部过 WCAG AA', async ({ page }) => {
  await openOrders(page)
  const res = await auditPage(page)
  // 阈值依据（实测，不是拍的）：把两处阈值临时抬到 99999 让判据自己报数 —— 默认视图
  // 走查 41 个含字元素。这里取下限，防的是"取数面塌了"而不是精确计数。
  expect(res.checked, '一个含字元素都没扫到 ⇒ 页面没渲染').toBeGreaterThan(20)
  expect(
    res.problems,
    '订单列表有 ' + res.problems.length + ' 处对比度不足：' + JSON.stringify(res.problems.slice(0, 6))
  ).toEqual([])
})

test('订单页三块折叠面板展开后：超时未确认、满减档位、事件时间线全部过 AA', async ({ page }) => {
  await openOrders(page)
  // ① 超时未确认面板（amber 底 + text-2xs 占用明细 + 已传付款截图角标）
  await page.getByRole('button', { name: /展开超时未确认订单/ }).click()
  await expect(page.getByText('占用明细：')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('已传付款截图')).toBeVisible()
  // ② 满减档位面板（emerald 底 + 命中数）
  await page.getByRole('button', { name: /展开满减档位/ }).click()
  await expect(page.getByText('满¥8.00减¥1.00 · 满 8 减 1')).toBeVisible({ timeout: 8_000 })
  // ③ 事件时间线（逐单展开；type 与状态标签同行、时间戳是 text-2xs）
  await page.getByRole('button', { name: '订单 36栋-501 的事件时间线' }).click()
  await expect(page.getByText('proof · 待支付')).toBeVisible({ timeout: 8_000 })
  await page.waitForTimeout(600)
  const res = await auditPage(page)
  // 实测读数：默认视图 41 个含字元素、三块面板全展开后 50 个（把阈值临时抬到 99999
  // 让判据自己报出来的，不是估的）。阈值取 45 —— 高于默认读数 ⇒ "以为点了其实没展开"
  // 会直接红；又留 5 个余量，不至于因为一处文案合并元素就假红。
  expect(res.checked, '展开后面板元素没进面 ⇒ 面板可能没真展开').toBeGreaterThan(45)
  expect(
    res.problems,
    '折叠面板展开后有 ' + res.problems.length + ' 处对比度不足：' + JSON.stringify(res.problems.slice(0, 8))
  ).toEqual([])
})
