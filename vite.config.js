import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync, writeFileSync } from 'fs'

// 自动注入 SW 缓存版本号（build 时替换 sm-v* 为时间戳）
function swVersionPlugin() {
  return {
    name: 'sw-version-inject',
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js')
      try {
        let content = readFileSync(swPath, 'utf-8')
        const version = `sm-v${Date.now()}`
        content = content.replace(/const CACHE_VERSION = '[^']*'/, `const CACHE_VERSION = '${version}'`)
        writeFileSync(swPath, content, 'utf-8')
        console.log(`[sw-version] CACHE_VERSION → ${version}`)
      } catch {
        // sw.js 可能不在 dist（首次 build 前），忽略
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  base: './',
  test: {
    // vitest 4 读取本字段；setup 统一注册 RTL cleanup（非 globals 模式不自动清理）
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // e2e（Playwright）用例由 `npm run test:e2e` / `npm run test:visual` 单独跑：它们需要真实
    // 浏览器与 server，若被 vitest 收集会因缺少 browser fixture 而失败。
    // e2e-visual 是跑生产构建的那一套（CSP 会拦 dev 注入的 <style>，几何判据只能在 prod 下成立），
    // 新增 e2e* 目录时记得一并加进来。
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**', 'tests/e2e-visual/**', 'tests/e2e-stub/**'],
    // 天花板必须两两对齐（第四十六轮一手：一次 `Test timed out in 5000ms` 抓出来的系统性缺陷）：
    // tests/ 里 17 个文件在用子进程真跑入口，**每一条**的 spawnSync 预算是 30s/60s/120s，
    // 却没有一条给测试本身设超时 ⇒ 全部跑在 vitest 默认 5s 上。判据慢于 5s 时红的是夹具，
    // 不是代码；而"忽绿忽红"在共享工作树里还会被误判成并发问题（本轮单跑该文件实测 1.37s、
    // 判据自身 0.36s ⇒ 争用抖动，不是缺陷）。取"最大被调方预算 120s + 10s 余量"，
    // 并由 `tests/testCeilings.test.js` 钉住这个不等式：改小这里或改大那里的预算，都会红。
    testTimeout: 130_000,
    hookTimeout: 130_000,
    // 覆盖率棘轮（2026-09-24 对标第二轮 B1，补上一轮"暂不设阈值"的欠账）。
    // 分母钉死为 src/**：上一轮记的 43.72% 是"仅被测试加载到的文件"口径，新增未测文件不会
    // 让数字下降，可被绕过；钉死后的真实口径是 **19.68%**（页面层基本没测）。
    // 阈值取当前实测下取整（Vendure 的 reset-coverage-thresholds 做法）：只允许上升，
    // 让覆盖率下滑的改动必须显式改这里，逼出一次评审。functions/ 由 verify:backend 的
    // 101 条契约断言负责，不计入本口径。
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**'],
      exclude: ['src/**/*.d.ts', 'src/**/index*'],
      thresholds: {
        // 棘轮历史（statements）19.5 → 23 → 35 → 47 → 57 → 74 → 76 → 78 → 79（第九轮：
        // apiClient/localStore 门面专项后再加 CI 与门禁自测两文件，实测 81.11%）。
        // 第九轮按「连跑 5 次全量 --coverage」定档（台账 N4 要求的测量法，也是本轮的收工证据）：
        //   Statements 81.11 ×5 逐位一致 / Functions 76.74 ×5 一致 / Lines 82.79 ×5 一致，
        //   Branches 在 74.44 ↔ 74.48 抖 0.04pt（同一 5s 轮询时序分支，非新引入）。
        // 阈值 = 实测 −2pp 下取整，且 **branches 用最小观测值**（74.44−2→72）：
        // CI 跑 node22/ubuntu、本机 node24，历史上 branches 曾因 1 条轮询分支双跑差 0.05pt。
        // 只允许上升：让覆盖率下滑的改动必须显式改这里，逼出一次评审。
        // 第四十九轮复测（@2026-09-28，`npx vitest run --coverage` 单次，107 文件全绿）：
        //   Statements 80.50% (2329/2893)｜Branches 73.52% (1697/2308)｜Functions 76.19% (653/857)｜Lines 82.26% (2009/2442)
        //   ⇒ headroom = 1.50 / 1.52 / 2.19 / 2.26pp，比第九轮的 ~2.1pp 收窄，原因不是覆盖率掉了，
        //   而是**分母涨了**（新增门禁脚本把语句数推到 2,893）。本轮**不动地板**：并行会话在同一棵树上提交，
        //   抬地板会把别人的合法改动拦成红；把读数写在这里而不是改判据，是"棘轮要有余量"的既有口径。
        statements: 79,
        branches: 72,
        functions: 74,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // 已移除 CloudBase JS SDK（后端迁至 Pages Functions），不再有 cloudbase-sdk 大块。
    // 保持 800KB 阈值仅作首屏相关 bundle 超限的告警。
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // 路由：与 React 运行时分离，router 升级不会让 react 块的长缓存失效
          // 注意：此判断必须在 react 之前，否则会被 includes('react') 误吞
          if (id.includes('react-router')) return 'router'
          // React 运行时：最稳定的一层，适合长缓存
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor'
        },
      },
    },
  },
})
