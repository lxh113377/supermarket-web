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
  outputDir: 'playwright-report-visual',
  use: {
    baseURL: BASE,
    /**
     * 浏览器时区必须钉死，不能跟随 runner（2026-10-23 一手：main run 39815735065 的 visual job 红）。
     *
     * 根因：contrast.spec.ts 的钉钟用例钉的是【瞬间】（Date.parse 带 +08:00 后 super(ms) 覆盖 Date），
     * 而断言读的是【由浏览器本地时区推导出来的 UI】—— utils/businessHours.ts 用 date.getHours()
     * 判营业区间（工作日 17:37-23:00）。runner 是 UTC ⇒ 钉 2026-10-22T19:00:00+08:00 在浏览器里
     * 读成 11:00 ⇒ 判非营业 ⇒ 「营业中」不渲染 ⇒ 报错 element(s) not found。
     * 本机时区就是 Asia/Shanghai ⇒ 结构上复现不出来（我一开始用 $env:TZ 试，绿了，是假验证：
     * Windows 上 Chromium 不看进程 TZ 环境变量，必须用 CDP 的 timezoneId 才真覆盖）。
     *
     * 双向差分实测（本机，CDP timezoneId 覆盖）：
     *   timezoneId=UTC           → 逐字复现 CI 的「home-open-pinned 钉的时刻下应当出现「营业中」，没出现」
     *   timezoneId=Asia/Shanghai → 3 passed
     * 判 Asia/Shanghai 而非别的：营业时间文案本身就是北京时间口径（getBusinessHoursText() 写死
     * 「工作日 17:37-23:00」），测它就得用那个时区；这也让判据不再依赖 runner 配置。
     */
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // env-empty 目录屏蔽本机 .env（VITE_CB_API_BASE 会切到云端模式，演示断言会全失效）
    command: `vite build --config vite.config.e2e.js --outDir ${OUT_DIR} --emptyOutDir && vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: BASE,
    // 恒 false（第八轮 M4 顺手治第七轮记的本机盲区）：true 时上一会话遗留、伺服**过期 dist-e2e**
    // 的进程会被静默复用 ⇒ 视觉判据跑在旧产物上全绿（第七轮实测踩到，netstat 抓不到 PID 但端口 200）。
    // 宁可响亮报"端口被占"，也不测旧产物。CI 下本来就是 false，此项只影响本机。
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
