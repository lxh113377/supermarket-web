import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'
import { auditPage } from '../e2e/helpers/contrastAudit'

/**
 * 后台「评价」与「服务提交」两个页签的有数据态对比度闸（2026-10-24 新增，
 * 跑在 tests/e2e-stub 的假桩后端上）。
 *
 * 为什么必须有（一手核对，不是推测）：admin-contrast.spec.ts 的头注自己写着
 * 「桩没有 getAllReviews / getSubmissions 两个 action」，并据此得出「本件只覆盖
 * 看板」。那个推理漏了一格 —— 它说「商品/订单列表的数据态在视觉套件有真种子
 * 数据」，可**评价页签在 demo 模式下也永远空**：db/reviews.ts 的 getAllReviews
 * 第一行是 if (!IS_CLOUD) return [] ⇒ 视觉套件那五条 admin-* 路由扫到的全是
 * 空态。提交页签的 getSubmissions 在非云模式会 safeParse 本地 sm_submissions，
 * 但 demo 构建里没人往里写，实测同样是空。⇒ 这两个页签的有数据态此前一行都
 * 没被任何判据扫过。
 *
 * 而它们恰好是小字最密的地方：状态徽章实测 10px（text-3xs）压黄/绿彩色底，正是
 * 本站出过缺陷的形态（2026-10-23 首页打烊提示实测 4.44:1，差 0.06 不过 AA）。
 *
 * ⚠️ 一段必须留下的自我纠正：本轮立项前我"手算"过这两枚徽章，算出 4.42:1 并写下
 * 「两枚都不过 AA」。那是**错的** —— 我用的 yellow-100 是凭记忆写的
 * rgb(254,243,199)，浏览器实测是 rgb(254,249,195)；用实测值重算得 4.584 / 4.567，
 * 两枚都过 AA。⇒ 教训不是"别手算"，而是**手算用的常量必须来自实测**；而本件跑起来
 * 之后这件事根本不需要人算 —— 这正是把这块面永久纳进自动闸的理由。
 *
 * 与 admin-contrast.spec.ts 的分工：那件量看板（KPI + 四张图），本件量这两个列表
 * 页签；桩数据在 scripts/local-api-stub.mjs 的 REVIEWS / SUBMISSIONS 两个常量。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => { errs = watchErrors(page) })
test.afterEach(() => errs.assertClean())

async function login(page: Page) {
  await page.goto('/#/admin')
  const keyInput = page.getByLabel('管理密钥')
  // 桩模式必须是云端模式：静默降级成演示模式的话，本件就扫不到真数据（假绿）
  await expect(keyInput, '桩模式下必须出现密钥闸（没降级成本地演示模式）').toBeVisible()
  await keyInput.fill('stub-any-key')
  await page.getByRole('button', { name: '进入后台' }).click()
  await expect(keyInput).toBeHidden()
}

test('评价页签有数据态：文字全部过 WCAG AA', async ({ page }) => {
  await login(page)
  await page.getByRole('tab', { name: '评价' }).click()
  // 前置条件（防空集假绿）：getAllReviews 在非云模式返回空数组是**成功**，那样
  // auditPage 会扫到一个空态页并给出「零违规」，看着全绿其实什么都没量。
  await expect(page.getByText('共 4 条评价')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('第二天送到寝室楼下')).toBeVisible()
  await page.waitForTimeout(600)
  const res = await auditPage(page)
  expect(res.checked, '一个含字元素都没扫到 ⇒ 页面没渲染').toBeGreaterThan(15)
  expect(
    res.problems,
    '评价页签有 ' + res.problems.length + ' 处对比度不足：' + JSON.stringify(res.problems.slice(0, 6))
  ).toEqual([])
})

test('服务提交页签有数据态：状态徽章与小字元信息全部过 WCAG AA', async ({ page }) => {
  await login(page)
  await page.getByRole('tab', { name: '服务' }).click()
  await expect(page.getByText('快递代拿')).toBeVisible({ timeout: 15_000 })
  // 两种状态徽章都必须在：配色按 status 分支，只扫一种等于没扫另一种。
  // 必须 exact 匹配 —— 默认是子串匹配，「已处理」会同时命中徽章与另一条提交上的
  // 「标记已处理」按钮 ⇒ strict mode violation（本轮实测撞上的）。
  await expect(page.getByText('待处理', { exact: true })).toBeVisible()
  await expect(page.getByText('已处理', { exact: true })).toBeVisible()
  await page.waitForTimeout(600)
  const res = await auditPage(page)
  expect(res.checked, '一个含字元素都没扫到 ⇒ 页面没渲染').toBeGreaterThan(15)
  expect(
    res.problems,
    '提交页签有 ' + res.problems.length + ' 处对比度不足：' + JSON.stringify(res.problems.slice(0, 6))
  ).toEqual([])
})
