import { defineConfig } from '@playwright/test'

/**
 * 「真实布局」e2e 配置 —— 跑生产构建，不跑 dev。
 *
 * 与 playwright.config.ts 的分工：
 *   playwright.config.ts        → dev server（无 CSP 放行，页面无样式）：只测功能与 DOM 结构
 *   playwright.visual.config.ts → 生产构建（CSS 独立文件，样式生效）：测几何布局、重排、焦点环、对比度
 *
 * 根因：index.html 的 CSP `style-src 'self'` 会拦掉 Vite dev 注入的 <style>，
 * 导致 dev 下所有几何断言必然失败（详见 tests/e2e-visual/layout.spec.ts 头注释）。
 */
const PORT = 4176
const BASE = `http://localhost:${PORT}`
const OUT_DIR = 'dist-e2e'

export default defineConfig({
  testDir: 'tests/e2e-visual',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // env-empty 目录屏蔽本机 .env（VITE_CB_API_BASE 会切到云端模式，演示断言会全失效）
    command: `vite build --config vite.config.e2e.js --outDir ${OUT_DIR} --emptyOutDir && vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
