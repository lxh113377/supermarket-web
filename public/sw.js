// Service Worker: 只缓存静态资源，不缓存 API 响应
const CACHE_VERSION = 'sm-v6'
const CACHE_NAME = `sm-static-${CACHE_VERSION}`

// App Shell 预缓存（离线首屏可用）
const PRECACHE_URLS = ['./', './favicon.svg', './manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {
      // manifest.json 可能不存在，不阻塞安装
      return caches.open(CACHE_NAME).then((cache) => cache.addAll(['./', './favicon.svg']))
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('sm-')).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // API 请求（同域 /web /pub）不缓存，直接放行
  if (url.pathname.startsWith('/web') || url.pathname.startsWith('/pub')) return
  // index.html → network-first（确保入口始终最新）
  if (url.pathname === '/' || url.pathname.endsWith('index.html') || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone))
        }
        return res
      }).catch(() => caches.match(e.request))
    )
    return
  }
  // 带 hash 的静态资源 → cache-first（文件名变则URL变，不会冲突）
  if (/\.(js|css|svg|png|jpg|webp|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((c) => c.put(e.request, res.clone()))
        return res
      }))
    )
  }
})
