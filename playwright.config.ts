import { defineConfig } from '@playwright/test'

/**
 * 端到端冒烟（对标 P0-A3）
 * 跑在 vite dev server 上：无 .env 时前端自动降级为本地演示模式（数据存 localStorage），
 * 因此冒烟不依赖后端与 D1，CI 里也能稳定跑。
 */
const PORT = 5174
const BASE = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    actionTimeout: 10_000,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx vite dev --port ${PORT} --strictPort --config vite.config.e2e.js`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
