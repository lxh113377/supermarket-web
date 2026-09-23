import { test, expect } from '@playwright/test'

/**
 * 顾客端 + 后台入口冒烟（对标 P0-A3）
 *
 * 跑在 vite dev server 的**本地演示模式**（无 .env 时数据存 localStorage），
 * 因此不依赖后端 / D1 / 网络，CI 里也能稳定复现。
 */

test.describe('顾客端冒烟', () => {
  test('首页渲染分类导航与商品入口', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: '商品分类导航' })).toBeVisible()
    await expect(page.getByRole('button', { name: /切换到.+分类/ }).first()).toBeVisible()
  })

  test('商城搜索能过滤商品', async ({ page }) => {
    await page.goto('/#/customer')
    const search = page.getByLabel('搜索商品名称')
    await expect(search).toBeVisible()
    await search.fill('矿泉水')
    await expect(page.getByText('农夫山泉矿泉水').first()).toBeVisible()
    // 过滤后不应再出现无关商品
    await expect(page.getByText('乐事薯片')).toHaveCount(0)
  })

  test('商品详情可加购并在购物车可见', async ({ page }) => {
    await page.goto('/#/product/p033')
    await expect(page.getByRole('button', { name: '加入购物车' })).toBeVisible()
    await page.getByRole('button', { name: '加入购物车' }).click()
    await page.goto('/#/cart')
    await expect(page.getByText('乐事薯片').first()).toBeVisible()
  })
})

test.describe('后台入口', () => {
  test('未登录访问后台停留在密钥登录态', async ({ page }) => {
    await page.goto('/#/admin')
    // AdminGuard：未持有密钥时不渲染管理界面，只出现密钥输入
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '商品' })).toHaveCount(0)
  })
})
