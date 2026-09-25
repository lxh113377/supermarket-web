import { defineConfig } from '@playwright/test'

/**
 * 「云端模式 + 假桩后端」e2e 配置（防线轮 K2）。
 *
 * 三个配置各管一段，别混：
 *   playwright.config.ts        → dev server + 演示模式（无密钥、无图表分支）
 *   playwright.visual.config.ts → 生产构建 + 几何布局断言
 *   本文件                       → 生产构建 + 云端模式 + 假 /web /pub，专打「图真的渲染出来了」
 *
 * 为什么必须有这一层：2026-09-24 的 P0 是看板四张图在生产包里静默空白 19 天，
 * 而当时单测/e2e/契约全绿。根因是 echarts 的 lib/* 深路径模块零 export，被当成
 * core.use() 的入参 → use(undefined) → async IIFE 内抛 TypeError 且无 catch，
 * 页面连错误都不弹。这类缺陷只有"真浏览器 + 真生产包 + 真 echarts"才看得见，
 * 而此前这条路径只有人工开 localhost:5182 走过一次。
 */
const PORT = 5182
// 桩只 listen 在 127.0.0.1；CI 上 localhost 常被解析成 ::1，轮询会永远不通
const BASE = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'tests/e2e-stub',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  outputDir: 'playwright-report-stub',
  use: {
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // 产物自建：dist-stub 是 gitignored 的派生件，CI 上没有可复用的上游 artifact
    command: `npm run build:stub && node scripts/local-api-stub.mjs --dir dist-stub --port ${PORT}`,
    url: BASE,
    // 故意恒为 false（与 visual 配置不同）：复用在服 = 跳过 build:stub = 可能测到过期产物。
    // 端口被占时宁可响亮地失败，也不要静默地测旧构建。
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
