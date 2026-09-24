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
    // e2e（Playwright）用例由 `npm run test:e2e` 单独跑：它们需要真实浏览器与 dev server，
    // 若被 vitest 收集会因缺少 browser fixture 而失败。
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
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
        statements: 35,
        branches: 32,
        functions: 31,
        lines: 36,
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
