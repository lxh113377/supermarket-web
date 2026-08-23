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
