// 预取总线（零依赖）：页面 hover/focus 意图 → chunk 预取。
//
// 从 routeLoaders 拆出——原先预取函数与路由表同模块，页面 import 预取即反向依赖
// 路由表，而路由表又 import 页面（import 工厂），形成 3 处真实循环依赖
//（check-import-cycles 在补上 .ts/.tsx 后实测检出，2026-09-23）。
// 本模块不 import 任何 src 内模块：路由表启动时单向注册工厂，页面单向调用
// 预取函数，环彻底断开。App 的 React.lazy 与预取仍共用同一份工厂
//（注册即同一引用），预取过的 chunk 点击时无需再下载。

type Factory = () => Promise<unknown>

const factories = new Map<string, Factory>()

/** 已发起过预取/加载的 key，避免重复触发同一个 chunk 请求 */
const requested = new Set<string>()

export function registerRouteFactory(key: string, factory: Factory): void {
  if (!factories.has(key)) factories.set(key, factory)
}

/** 空闲时执行回调（requestIdleCallback 不可用时退回 setTimeout） */
function onIdle(fn: () => void, timeout = 2000) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof ric === 'function') ric(fn, { timeout })
  else setTimeout(fn, 200)
}

function load(key: string) {
  if (requested.has(key)) return
  const factory = factories.get(key)
  // 工厂未注册（如单测只引本模块）：静默跳过，真正导航时 lazy() 会正常加载
  if (!factory) return
  requested.add(key)
  factory().catch(() => {
    // 预取失败不处理：用户真正导航时 lazy() 会重新发起并走 Suspense 兜底
    requested.delete(key)
  })
}

/**
 * 预取单个路由的 chunk。
 * 用于 hover / focus 等「用户意图已出现但尚未点击」的时机——延迟必须短，
 * 否则用户点击先于预取到达，预取形同虚设（原 1200ms idle 基本等不到点击）。
 */
export function prefetchRoute(key: string) {
  onIdle(() => load(key), 150)
}

/**
 * 首屏就绪后空闲预取高频路由。
 * 只在窗口空闲时执行，不抢占首屏的带宽与主线程； chunk 间用 setTimeout
 * 错峰（原嵌套 onIdle 双重等待最长 4.8s，低端机首屏后久无预取）。
 */
export function prefetchHotRoutes(keys: string[] = ['category', 'shop', 'product', 'cart']) {
  onIdle(() => {
    keys.forEach((k, i) => {
      setTimeout(() => load(k), i * 300)
    })
  }, 3000)
}
