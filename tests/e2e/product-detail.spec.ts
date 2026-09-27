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
 * 商品 id 规则 = `p_` + order。规格只剩一条来路（后台写进 D1 的 specOptions）：
 *   白象方便面 46 帮泡 ¥3.66（三个口味，选口味不改价不换图）/ 47 零售 ¥1.88（无口味清单）；
 *   乐事薯片 33 40g ¥2.66 —— 商品自带口味（specOptions），选口味不改价、不换图。
 * 其余商品（含全部饮品）无口味清单，页面不得长出选择器。
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

/**
 * 白象 46/47 的口径变更（2026-09-28）：跨记录演示层退役后，帮泡与零售就是目录里两条独立记录，
 * 详情页不再在两者间切换；46 的三种口味改由后台 specOptions 承载 ⇒ 选口味不改价、不换图。
 * 原来那三条（点缩略图换 47、选规格改价 3.66↔1.88、零售装清空口味并播报）失去被测量对象，
 * 按新口径重写而不是删掉——留空的判据等于没装。
 */
test('白象帮泡：口味选择器出三个真实口味，单图且选口味不改价', async ({ page }) => {
  await open(page, 46)
  await expect(page.getByRole('button', { name: '十三香', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '麻辣香', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '山西老陈醋', exact: true })).toBeVisible()
  await expect(page.locator('[data-main-image] img')).toHaveAttribute('src', /\/images\/46\.webp/)
  await expect(mainPrice(page)).toHaveText('¥3.66')
  await page.getByRole('button', { name: '山西老陈醋', exact: true }).click()
  await expect(mainPrice(page)).toHaveText('¥3.66')
  await expect(page.getByText('已选口味：山西老陈醋')).toBeVisible()
})

test('白象帮泡：口味轴上不再有「版本」轴，零售装那张图不混进帮泡详情页', async ({ page }) => {
  await open(page, 46)
  // 选择器的轴名只从 fieldset>legend 取；参数区也有一行标签叫「口味」，查文本会假绿
  const legends = page.locator('fieldset > legend')
  await expect(legends.filter({ hasText: '版本' })).toHaveCount(0)
  await expect(legends.filter({ hasText: '口味' })).toHaveCount(1)
  // 演示组在时这里会渲染出 2 张缩略图（46+47）；现在口味共用 46 的一张实拍图
  await expect(page.getByRole('navigation', { name: /图片缩略图/ })).toHaveCount(0)
  await expect(page.locator('img[src="/images/47.webp"]')).toHaveCount(0)
})

test('白象零售（47）：没有口味清单就不渲染选择器，价格是自己的 1.88', async ({ page }) => {
  await open(page, 47)
  await expect(mainPrice(page)).toHaveText('¥1.88')
  await expect(page.getByRole('button', { name: '十三香', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '帮泡装', exact: true })).toHaveCount(0)
})

test('【口味落库链】选口味加购 → 购物袋那一行带的就是口味文案', async ({ page }) => {
  // 这一条守的是老大报的原缺陷：顾客选了口味而后台看不见。
  // 前端把 specText 写进行 → 下单原样送 → 服务端 allowedOrderSpecs 放行 → 后台拆出口味。
  // 组件层已有判据直接调用服务端 allowedOrderSpecs 对账（tests/productDetailVariants.test.tsx），
  // 这里补的是真实浏览器里"加购后行上确实带着口味"这一段。
  await open(page, 46)
  await page.getByRole('button', { name: '麻辣香', exact: true }).click()
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText(/已把 1 件「白象方便面」加入购物袋/)).toBeVisible()
  await page.goto('/#/cart')
  await expect(page.getByText('帮泡 · 麻辣香').first()).toBeVisible()
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
  // 直接进 47 那条记录：跨记录演示层退役后，帮泡页不再能把用户切到零售行
  await open(page, 47)
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

test('演示文案如实标注：售后整块仍标为演示；白象口味已升为真实数据不再自称演示聚合', async ({ page }) => {
  await open(page, 46)
  // 售后说明是演示文案，与规格无关，退役演示层不影响它 —— 必须仍然如实标注
  await expect(page.getByText(/不构成任何真实承诺/)).toBeVisible()
  // 「数据说明：」是 VariantPicker 渲染 disclosure 的标签，46 现在讲的是后台维护口径，
  // 不再自称"聚合属演示交互"（那句是退役掉的 variants-demo 的 disclosure）
  await expect(page.getByText(/数据说明：/)).toBeVisible()
  await expect(page.getByText(/管理后台维护/)).toBeVisible()
  await expect(page.getByText(/演示交互/)).toHaveCount(0)
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
