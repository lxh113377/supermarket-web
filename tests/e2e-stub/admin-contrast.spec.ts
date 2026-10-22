import { test, expect, type Page } from '@playwright/test'
import { watchErrors, type ErrorWatch } from '../e2e/helpers/watchErrors'
import { auditPage } from '../e2e/helpers/contrastAudit'

/**
 * 管理端「看板有数据」态的对比度闸（2026-10-23 新增，跑在 tests/e2e-stub 的假桩后端上）。
 *
 * 为什么视觉套件那 5 条 admin-* 不够：playwright.visual.config.ts 用 vite.config.e2e.js
 * 构建（envDir = env-empty 屏蔽 .env）⇒ IS_CLOUD=false ⇒ 演示模式，而 getDashboardStats
 * 在演示模式下没有本地实现 ⇒ 看板页签渲染的是**错误态**（实测含字元素 11、canvas=0）。
 * 也就是说 KPI 数字、四张图表这些**数字最密的地方**从来没被任何对比度判据扫过。
 *
 * 本件为什么只覆盖看板、不覆盖商品/订单/服务/评价：桩的 dispatch 对 getProducts /
 * getOrders 直接回空数组，且没有 getAllReviews / getSubmissions 两个 action
 * （落到 default ⇒ 「stub: 未实现 action」）。在桩里测那四个页签 = 测空态，
 * 挂「有数据态」的名就是撒谎。列表页签的数据态覆盖面在视觉套件（demo 构建有真种子数据）。
 *
 * 与 dashboard-cloud.spec.ts 的分工：那件钉「图有没有真渲染出来」（canvas 尺寸、未捕获
 * 异常），本件钉「渲染出来的文字与图形墨色看不看得见」。两件事不同，不合并。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page)
})
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

test('看板有数据态：KPI 与图表文字全部过 WCAG AA', async ({ page }) => {
  await login(page)
  await page.getByRole('tab', { name: '看板' }).click()
  // 数据态的**语义标记**（不是拍脑袋的元素数）：四张 echarts 必须真出来。
  // 演示模式下这里是 0 张 —— 用它当「扫到的是数据态而不是空态」的证据。
  await expect
    .poll(() => page.locator('canvas').count(), { timeout: 20_000, message: '看板 canvas 没出现 ⇒ 扫的是空态' })
    .toBeGreaterThanOrEqual(4)
  // KPI 数字（¥ 开头）也只在数据态才存在
  await expect(page.getByText(/^¥[\d,]+$/).first(), 'KPI 营收数字没出现 ⇒ 数据没落到卡上').toBeVisible()
  await page.waitForTimeout(1200)

  const res = await auditPage(page)
  expect(res.checked, '一个含字元素都没扫到 ⇒ 页面没渲染').toBeGreaterThan(10)
  expect(
    res.problems,
    `看板有 ${res.problems.length} 处文字对比度不足（走查 ${res.checked} 个含字元素）：\n` +
    res.problems.slice(0, 14).map((x) =>
      `  ${x.ratio}:1 (需 ${x.need}:1) ${x.size}px/${x.weight} 「${x.text}」 ${x.sel} fg=${x.fg}`).join('\n'),
  ).toEqual([])
})

/**
 * 自证（成对判据的负向那一半）：未登录时不得出现数据面。
 * 钉住「登录闸本身还在」，免得有人为了让 canvas/元素数达标而把登录步骤删掉
 * —— 那等于把管理端裸奔当通过。
 */
test('自证：未登录停在密钥闸，且登录页自身无不合格文字', async ({ page }) => {
  await page.goto('/#/admin')
  await expect(page.getByLabel('管理密钥'), '未登录必须停在密钥闸').toBeVisible()
  expect(page.locator('canvas'), '未登录不该看到任何图表').toHaveCount(0)
  const res = await auditPage(page)
  expect(res.checked, '登录页一个含字元素也没扫到 ⇒ 页面没渲染').toBeGreaterThan(1)
  expect(res.problems, '登录页自己就不该有不合格文字').toEqual([])
})
