/* oxlint-disable no-console -- 浏览器错误需要打印到 stdout 才能进 CI 日志 */
import { test, expect } from '@playwright/test'

/**
 * 商品详情页「功能」e2e —— 跑 dev server（本地演示模式，无后端）。
 *
 * 与 tests/e2e-visual/layout.spec.ts 的分工：本文件只断言**与 CSS 无关**的行为
 * （换图、改价、回落播报、购物袋入账、演示摘要不跳转、链接可达）。
 * 双栏并排 / 响应式重排 / 焦点环 / 是否裁切这类几何判据必须跑生产构建：
 * index.html 的 CSP `style-src 'self'` 会拦掉 Vite dev 注入的 <style>，
 * dev 下页面完全无样式，几何断言结构上不可能通过（已实测确认，非推测）。
 *
 * 商品 id 规则 = `p_` + order。东鹏特饮三条真实记录：
 *   16 盒装250ml ¥2.33 / 17 瓶装250ml ¥2.66 / 18 瓶装500ml ¥4.66
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('BROWSER-ERR:', m.text().slice(0, 200))
  })
})

async function open(page: import('@playwright/test').Page, order: number, vp = { width: 1440, height: 900 }) {
  await page.setViewportSize(vp)
  await page.goto(`/#/product/p_${order}`)
  await expect(page.getByLabel('购买数量', { exact: true })).toBeVisible({ timeout: 20_000 })
}

/** 标题旁的主价 —— 必须与「同类商品」区里其他商品的标价区分开，否则子串会撞 */
const mainPrice = (page: import('@playwright/test').Page) =>
  page.locator('p.text-3xl').first()

test('缩略图列：点第 N 张真的换主图，并同步规格与价格', async ({ page }) => {
  await open(page, 16)
  const nav = page.getByRole('navigation', { name: /图片缩略图/ })
  await expect(nav.locator('button')).toHaveCount(3)
  const main = page.locator('[data-main-image] img')
  await expect(main).toHaveAttribute('src', /\/images\/16\.webp/)
  await nav.locator('button').nth(2).click()
  await expect(main).toHaveAttribute('src', /\/images\/18\.webp/, { timeout: 5_000 })
  await expect(page.getByRole('button', { name: '瓶装', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '500ml', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(mainPrice(page)).toHaveText('¥4.66')
})

test('选规格改价：2.33 → 4.66 随真实单价变化，不出现编造价格', async ({ page }) => {
  await open(page, 16)
  await expect(mainPrice(page)).toHaveText('¥2.33')
  await page.getByRole('button', { name: '瓶装', exact: true }).click()
  await page.getByRole('button', { name: '500ml', exact: true }).click()
  await expect(mainPrice(page)).toHaveText('¥4.66')
})

test('不存在的组合（盒装 + 500ml）自动回落并如实播报，不静默改用户规格', async ({ page }) => {
  await open(page, 18) // 初始：瓶装 + 500ml
  await expect(mainPrice(page)).toHaveText('¥4.66')
  await page.getByRole('button', { name: '盒装', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '没有可售组合' }))
    .toContainText('容量已自动切为「250ml」')
  await expect(mainPrice(page)).toHaveText('¥2.33')
})

test('口味色块的内联上色生效（React 走 CSSOM，不受 style-src 限制）', async ({ page }) => {
  await open(page, 6) // 康师傅冰红茶 → 8 口味色块轴
  const bg = await page.getByRole('button', { name: '绿茶', exact: true }).locator('span[aria-hidden="true"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(76, 122, 52)')
})

test('加入购物袋后本地购物袋可见，数量可调，价格按所选规格入账', async ({ page }) => {
  await open(page, 16)
  await page.getByRole('button', { name: '500ml', exact: true }).click() // 切到瓶装 500ml ¥4.66
  await page.getByRole('button', { name: '增加购买数量' }).click() // 数量 2
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已把 2 件「东鹏特饮」加入购物袋')).toBeVisible()
  await page.goto('/#/cart')
  await expect(page.getByText('东鹏特饮').first()).toBeVisible()
  // 4.66 × 2 = 9.32：走的是所选规格的真实单价，不是默认那条记录的 2.33
  await expect(page.getByText(/9\.32/).first()).toBeVisible()
  await page.getByRole('button', { name: '减少东鹏特饮' }).click()
  await expect(page.getByText(/4\.66/).first()).toBeVisible()
})

test('「立即购买」只弹演示摘要：不跳转、不建单、不发起支付', async ({ page }) => {
  await open(page, 16)
  const before = page.url()
  await page.getByRole('button', { name: '立即购买（演示摘要）' }).click()
  const dialog = page.getByRole('dialog', { name: '演示订单摘要' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('不产生真实订单、不发起任何支付')).toBeVisible()
  expect(page.url()).toBe(before)
  // 购物袋没被写入：证明确实只是摘要，没有偷偷建单
  const cart = await page.evaluate(() => localStorage.getItem('sm_cart'))
  expect(cart === null || /"items":\[\]/.test(cart ?? '')).toBe(true)
  await dialog.getByRole('button', { name: /我知道了/ }).click()
  await expect(dialog).toHaveCount(0)
})

test('任何视口下都只渲染一个「加入购物车」主按钮（宽屏右栏 / 窄屏吸底栏二选一）', async ({ page }) => {
  await open(page, 16, { width: 1440, height: 900 })
  await expect(page.getByRole('button', { name: '加入购物车' })).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '加入购物车' })).toHaveCount(1)
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已把 1 件「盒装东鹏特饮」加入购物袋')).toBeVisible()
})

test('无变体数据的商品不长出规格选择器（不编造规格）', async ({ page }) => {
  await open(page, 22) // 有糖可乐 罐装330ml，不在演示变体组
  await expect(page.getByRole('button', { name: '包装', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '容量', exact: true })).toHaveCount(0)
})

test('演示数据如实标注：变体聚合是演示交互、售后整块是演示文案', async ({ page }) => {
  await open(page, 16)
  await expect(page.getByText(/数据说明：/)).toBeVisible()
  await expect(page.getByText(/演示交互/)).toBeVisible()
  await expect(page.getByText(/不构成任何真实承诺/)).toBeVisible()
})

test('参数表存在且标明字段未经加工', async ({ page }) => {
  await open(page, 16)
  await expect(page.getByRole('heading', { name: '商品参数' })).toBeVisible()
  await expect(page.getByText('目录编号')).toBeVisible()
  await expect(page.getByText(/取自商品目录真实记录/)).toBeVisible()
})

test('面包屑取真实分类，点子类深链可回到商城对应视图', async ({ page }) => {
  await open(page, 16)
  const crumb = page.getByRole('navigation', { name: '面包屑' })
  // 商品 16 = 盒装东鹏特饮，真实归类在 饮品 › 提神（energy）
  await expect(crumb.getByRole('link', { name: '饮品' })).toHaveAttribute('href', /#\/shop\/drinks/)
  await expect(crumb.getByRole('link', { name: '提神' })).toHaveAttribute('href', /#\/shop\/drinks\/energy/)
  await expect(crumb.getByRole('link', { name: '零食饮料' })).toHaveCount(0)
  await crumb.getByRole('link', { name: '提神' }).click()
  await expect(page.getByRole('navigation', { name: '商品分类导航' })).toBeVisible()
  await expect(page).toHaveURL(/#\/shop\/drinks\/energy/)
  // 深链落地后必须真的按子类过滤，而不是回到默认分类
  await expect(page.getByRole('button', { name: '切换到提神分类' })).toHaveAttribute('aria-pressed', 'true')
})

test('列表页筛选有真实行为：搜索后结果数与卡片同步变化', async ({ page }) => {
  await page.goto('/#/shop')
  await expect(page.getByRole('navigation', { name: '商品分类导航' })).toBeVisible()
  const counter = page.getByText(/^共 \d+ 件/)
  await expect(counter).toBeVisible()
  const before = await counter.textContent()
  await page.getByRole('button', { name: '搜索商品' }).click()
  await page.getByLabel('搜索商品名称').fill('矿泉水')
  await expect(counter).not.toHaveText(before ?? '')
  await expect(page.getByText('农夫山泉矿泉水').first()).toBeVisible()
  await expect(page.getByText('乐事薯片')).toHaveCount(0)
})
