// 后端已迁移到 Cloudflare Pages Functions（HTTP API），不再使用 CloudBase JS SDK。
// IS_CLOUD 由 API 地址是否配置决定（同域 /web、/pub 即视为远端模式）。

const API_BASE = import.meta.env.VITE_CB_API_BASE || ''

export const IS_CLOUD = Boolean(API_BASE)

// 兼容旧调用方：新架构下不再需要 CloudBase SDK 实例。
export async function getApp(): Promise<any> { return null }
export async function ensureAuth(): Promise<void> {}
export async function getDatabase(): Promise<any> { return null }
