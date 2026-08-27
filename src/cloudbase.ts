// 后端已迁移到 Cloudflare Pages Functions（HTTP API），不再使用 CloudBase JS SDK。
// IS_CLOUD 由 API 地址是否配置决定（同域 /web、/pub 即视为远端模式）。

const API_BASE = import.meta.env.VITE_CB_API_BASE || ''

export const IS_CLOUD = Boolean(API_BASE)

// P1-7：getApp / ensureAuth / getDatabase 三个旧 SDK 兼容导出已无任何调用方（grep 实测），删除。
// 原 db/cloud.ts 模块（cloud()/ensure()）同样无调用方，已移除。
