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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // 体积基线（raw / gzip）：cloudbase-sdk ≈ 734KB / 176KB —— 该块由 src/cloudbase.js
    // 动态 import 懒加载，不进首屏，且 SDK 3.6.4 的 ./database 子路径 exports 指向的
    // 入口文件缺失（上游打包缺陷）、子包也不导出 registerDatabase，无法按需引入，
    // 故其体积为当前不可再拆的固有下限。阈值设 800 使该块不再误报，
    // 同时保留对其余块（首屏相关）超限的告警能力。
    // 复查条件：SDK 升级后若 ./database 子路径修复，应改回按需引入并下调此阈值。
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // CloudBase SDK：独立具名块，便于在产物中辨识（原名为无语义的 index.esm）
          if (id.includes('@cloudbase')) return 'cloudbase-sdk'
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
