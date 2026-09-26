import { test, expect } from '@playwright/test'
import { watchErrors, DEV_CSP_NOISE, type ErrorWatch } from './helpers/watchErrors'

/**
 * 商品详情页「功能」e2e —— 跑 dev server（本地演示模式，无后端）。
 *
 * 与 tests/e2e-visual/layout.spec.ts 的分工：本文件只断言**与 CSS 无关**的行为
 * （换图、改价、回落播报、购物袋入账、演示摘要不跳转、链接可达）。
 * 双栏并排 / 响应式重排 / 焦点环 / 是否裁切这类几何判据必须跑生产构建：
 * index.html 的 CSP `style-src 'self'` 会拦掉 Vite dev 注入的 <style>，
 * dev 下页面完全无样式，几何断言结构上不可能通过（已实测确认，非推测）。
 *
 * 商品 id 规则 = `p_` + order。本轮口径下只剩两条规格来源（真实目录行）：
 *   白象方便面 46 帮泡 ¥3.66 / 47 零售 ¥1.88 —— 跨记录聚合，选规格会换真实记录与单价；
 *   乐事薯片 33 40g ¥2.66 —— 商品自带口味（specOptions），选口味不改价、不换图。
 * 其余商品（含全部饮品）既无聚合组也无口味清单，页面不得长出选择器。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page, DEV_CSP_NOISE)
})
test.afterEach(() => errs.assertClean())

async function open(page: import('@playwright/test').Page, order: number, vp = { width: 1440, height: 900 }) {
  await page.setViewportSize(vp)
  await page.goto(`/#/product/p_${order}`)
  await expect(page.getByLabel('购买数量', { exact: true })).toBeVisible({ timeout: 20_000 })
}


/**
 * 选择器轴名（口味/版本/包装/容量）只认 fieldset>legend。
 * 裸 getByText('口味') 会撞上「商品参数」区那一行同样叫「口味」的标签
 * （详情页参数区第 3 行），那会让"没有选择器"的断言假红、"有选择器"的断言假绿。
 */
function axis(page: import('@playwright/test').Page, name: string) {
  return page.locator('fieldset > legend', { hasText: name })
}

/** 标题旁的主价 —— 必须与「同类商品」区里其他商品的标价区分开，否则子串会撞 */
const mainPrice = (page: import('@playwright/test').Page) =>
  page.locator('p.text-3xl').first()

test('缩略图列：点第 N 张真的换主图，并同步规格与价格', async ({ page }) => {
  await open(page, 46)
  const nav = page.getByRole('navigation', { name: /图片缩略图/ })
  await expect(nav.locator('button')).toHaveCount(2)
  const main = page.locator('[data-main-image] img')
  await expect(main).toHaveAttribute('src', /\/images\/46\.webp/)
  await nav.locator('button').nth(1).click()
  await expect(main).toHaveAttribute('src', /\/images\/47\.webp/, { timeout: 5_000 })
  await expect(page.getByRole('button', { name: '零售装', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(mainPrice(page)).toHaveText('¥1.88')
})

test('选规格改价：帮泡 3.66 → 零售 1.88 随真实单价变化，不出现编造价格', async ({ page }) => {
  await open(page, 46)
  await expect(mainPrice(page)).toHaveText('¥3.66')
  await page.getByRole('button', { name: '零售装', exact: true }).click()
  await expect(mainPrice(page)).toHaveText('¥1.88')
})

test('零售装不含口味：点它时口味自动清空并如实播报，不静默改用户规格', async ({ page }) => {
  await open(page, 46)
  await page.getByRole('button', { name: '山西老陈醋', exact: true }).click()
  await expect(mainPrice(page)).toHaveText('¥3.66')
  await page.getByRole('button', { name: '零售装', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '没有可售组合' }))
    .toContainText('口味已自动切为')
  await expect(mainPrice(page)).toHaveText('¥1.88')
})

test('口味不改价：乐事薯片选到烤虾味仍是 40g 的真实单价 2.66', async ({ page }) => {
  await open(page, 33)
  await expect(mainPrice(page)).toHaveText('¥2.66')
  await page.getByRole('button', { name: '烤虾味', exact: true }).click()
  await expect(mainPrice(page)).toHaveText('¥2.66')
  await expect(page.getByText('口味：40g · 烤虾味')).toBeVisible()
})

test('所选口味写进购物袋与订单金额（商家要知道要哪一包）', async ({ page }) => {
  await open(page, 33)
  await page.getByRole('button', { name: '黄瓜味', exact: true }).click()
  await page.getByRole('button', { name: '增加购买数量' }).click() // 数量 2
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已把 2 件「乐事薯片」加入购物袋')).toBeVisible()
  await page.goto('/#/cart')
  await expect(page.getByText('乐事薯片').first()).toBeVisible()
  await expect(page.getByText('40g · 黄瓜味').first()).toBeVisible()
  // 2.66 × 2 = 5.32：口味不改价，走的就是这条商品记录自己的真实单价
  await expect(page.getByText(/5\.32/).first()).toBeVisible()
})

test('加入购物袋按规格对应的那条真实记录入账（白象零售 1.88 × 2）', async ({ page }) => {
  await open(page, 46)
  await page.getByRole('button', { name: '零售装', exact: true }).click()
  await page.getByRole('button', { name: '增加购买数量' }).click() // 数量 2
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已把 2 件「白象方便面」加入购物袋')).toBeVisible()
  await page.goto('/#/cart')
  await expect(page.getByText(/3\.76/).first()).toBeVisible() // 1.88 × 2
})

test('「立即购买」只弹演示摘要：不跳转、不建单、不发起支付', async ({ page }) => {
  await open(page, 46)
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
  await open(page, 46, { width: 1440, height: 900 })
  await expect(page.getByRole('button', { name: '加入购物车' })).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '加入购物车' })).toHaveCount(1)
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已把 1 件「白象方便面」加入购物袋')).toBeVisible()
})

test('无规格数据的商品不长出规格选择器（不编造规格）', async ({ page }) => {
  await open(page, 22) // 有糖可乐 罐装330ml：既无聚合组也无口味清单
  await expect(axis(page, '版本')).toHaveCount(0)
  await expect(axis(page, '口味')).toHaveCount(0)
  await expect(axis(page, '包装')).toHaveCount(0)
  await expect(axis(page, '容量')).toHaveCount(0)
})

test('饮品的规格选择器已下线（东鹏不再有包装/容量，康师傅茶饮不再有口味色块）', async ({ page }) => {
  await open(page, 16) // 盒装东鹏特饮
  await expect(axis(page, '包装')).toHaveCount(0)
  await expect(axis(page, '容量')).toHaveCount(0)
  await open(page, 6) // 康师傅冰红茶
  await expect(axis(page, '口味')).toHaveCount(0)
  await expect(page.getByText(/数据说明：/)).toHaveCount(0)
})

test('演示数据如实标注：规格聚合是演示交互、售后整块是演示文案', async ({ page }) => {
  await open(page, 46)
  await expect(page.getByText(/数据说明：/)).toBeVisible()
  await expect(page.getByText(/演示交互/)).toBeVisible()
  await expect(page.getByText(/不构成任何真实承诺/)).toBeVisible()
  await open(page, 33)
  await expect(page.getByText(/口味清单由商家在管理后台维护/)).toBeVisible()
})

test('参数表存在且标明字段未经加工', async ({ page }) => {
  await open(page, 46)
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
