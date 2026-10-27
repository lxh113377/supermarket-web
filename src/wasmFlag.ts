// WASM 商城索引的灰度开关判定（**独立小模块**）。
//
// 为什么单独一个文件：判定要被商城页**静态**引用（每个访客都会跑），
// 而加速器本体（loader + 门面，约 3 KB gz）必须是**动态**chunk —— 开关关着时不该付那份字节。
// 两者放在同一模块里，静态 import 那个判定就把整包拉了进来（第一版就是这样，把 CustomerPage
// 的产出从 6.2KB 顶到 9.2KB，直接撞了页体积门禁）。分开后：判定几十字节，重活按需。

/** 开关的三处入口（任一即可）：window.__SM_WASM__=1 / localStorage.sm_wasm='1' / ?wasm=1（search 或 hash） */
export function wasmCatalogEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if ((window as unknown as { __SM_WASM__?: number }).__SM_WASM__ === 1) return true
  try {
    if (window.localStorage?.getItem('sm_wasm') === '1') return true
  } catch {
    // 隐私模式 / 配额异常下 localStorage 会抛：读不到就当没开，绝不因此中断页面
  }
  // HashRouter：query 通常落在 hash 里（#/shop/food?q=糖），所以 search 与 hash 一起探
  return /[?&]wasm=1(&|$)/.test(`${window.location.search}${window.location.hash}`)
}
