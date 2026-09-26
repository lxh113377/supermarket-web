import { test, expect } from '@playwright/test'
import { watchErrors, DEV_CSP_NOISE, type ErrorWatch } from './helpers/watchErrors'

/**
 * 顾客端 + 后台冒烟（对标 P0-A3）
 *
 * 跑在 vite dev server 的**本地演示模式**（无 .env 时数据存 localStorage，
 * 商品种子见 src/data/products-seed.ts，演示 id 规则 = `p_` + order，见 localStore.ts），
 * 因此不依赖后端 / D1 / 网络，CI 里也能稳定复现。
 *
 * 已知 dev 模式噪音：index.html 的 CSP 会拦掉 vite 注入的 inline style（页面无样式但功能正常），
 * 该告警仅存在于 dev，线上构建无 inline style，不构成用例失败因素。
 */

let errs: ErrorWatch
test.beforeEach(async ({ page }) => {
  errs = watchErrors(page, DEV_CSP_NOISE)
})
test.afterEach(() => errs.assertClean())

test('首页：服务平台入口与 AI 导购浮钮', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('一站式校园生活服务平台').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '打开 AI 导购助手' })).toBeVisible()
})

test('商城：搜索框过滤商品', async ({ page }) => {
  // 商城路由是 /shop（App.tsx:61），不是 /customer
  await page.goto('/#/shop')
  await expect(page.getByRole('navigation', { name: '商品分类导航' })).toBeVisible()
  // 搜索框默认收起，需先点 TopNav 的搜索按钮展开
  await page.getByRole('button', { name: '搜索商品' }).click()
  const search = page.getByLabel('搜索商品名称')
  await expect(search).toBeVisible()
  await search.fill('矿泉水')
  await expect(page.getByText('农夫山泉矿泉水').first()).toBeVisible()
  // 过滤后不应再出现无关商品
  await expect(page.getByText('乐事薯片')).toHaveCount(0)
})

test('商品详情：加购后在购物车可见', async ({ page }) => {
  // 演示模式商品 id = p_ + order（乐事薯片 order 33），见 src/localStore.ts:13
  await page.goto('/#/product/p_33')
  await expect(page.getByRole('button', { name: '加入购物车' })).toBeVisible()
  await page.getByRole('button', { name: '加入购物车' }).click()
  await page.goto('/#/cart')
  await expect(page.getByText('乐事薯片').first()).toBeVisible()
})

test('后台：演示模式下直接进入管理界面', async ({ page }) => {
  // 演示模式（IS_CLOUD=false）时 AdminGuard 直接放行，不出现密钥登录表单
  await page.goto('/#/admin')
  await expect(page.getByLabel('管理功能')).toBeVisible()
})
