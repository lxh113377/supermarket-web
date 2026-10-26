// 对照臂：把现有 dist 按「现网静态托管」的方式发出去（GitHub Pages / Cloudflare Pages 的形态）。
//
// 为什么必须自己写一个对照臂，而不是直接跟线上比：
//   线上读数里混了「托管商的地域延迟、CDN、TLS 协商」等与本次重写无关的变量
//   （2026-10-24 的两份真实回执：customer TTFB 1582 ms、admin TTFB 195 ms）。
//   要在同一台机器、同一套 Lighthouse 参数下回答「Rust 边缘到底快多少」，
//   就必须让两臂只差**服务端实现**这一个变量。
//
// 本臂刻意复刻现网静态托管的三个特征：
//   1. **gzip**（不是 brotli）——GitHub Pages 只给 gzip；
//   2. **Cache-Control: max-age=600**（GH Pages 默认值，不是 immutable）；
//   3. 弱 ETag（size+mtime），不内联样式、不预载首屏路由、不做 Early Hints。
//
// 用法：node rust/scripts/static-baseline-server.mjs --dir dist --port 5181

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const dir = path.resolve(argOf('--dir', 'dist'))
const port = Number(argOf('--port', '5181'))
const host = argOf('--host', '127.0.0.1')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt'])

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.join(dir, rel)
  // 目录逃逸防护：解析后必须仍在 dist 里（对照臂也要是个正经服务端）。
  if (!path.resolve(file).startsWith(path.resolve(dir))) {
    res.writeHead(403).end('forbidden')
    return
  }
  let stat
  try {
    stat = fs.statSync(file)
    if (stat.isDirectory()) throw new Error('dir')
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404')
    return
  }
  const ext = path.extname(file).toLowerCase()
  const etag = 'W/"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"'
  const headers = {
    'content-type': TYPES[ext] || 'application/octet-stream',
    // 现网静态托管的口径（见文件头第 2 条）
    'cache-control': 'max-age=600',
    etag,
    vary: 'Accept-Encoding',
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end()
    return
  }
  const body = fs.readFileSync(file)
  const accepts = String(req.headers['accept-encoding'] || '')
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(accepts)) {
    const gz = zlib.gzipSync(body, { level: 6 })
    headers['content-encoding'] = 'gzip'
    headers['content-length'] = String(gz.length)
    res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : gz)
    return
  }
  headers['content-length'] = String(body.length)
  res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : body)
})

server.listen(port, host, () => {
  console.log('baseline（静态托管口径：gzip + max-age=600）监听 http://' + host + ':' + port + '  dir=' + dir)
})
