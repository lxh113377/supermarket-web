// SDK 动态加载：仅管理后台需要 SDK 直连数据库时才加载（746KB 不进首屏 bundle）
const ENV_ID = import.meta.env.VITE_CB_ENV_ID || ''
const REGION = import.meta.env.VITE_CB_REGION || 'ap-shanghai'

export const IS_CLOUD = Boolean(ENV_ID)

// SDK 实例类型来自动态 import，边界处保持宽松（网络/平台边界）
let app: any = null
let authReady = false

export async function getApp(): Promise<any> {
  if (!IS_CLOUD) return null
  if (!app) {
    const { default: cloudbase } = await import('@cloudbase/js-sdk')
    app = cloudbase.init({
      env: ENV_ID,
      region: REGION,
      auth: { detectSessionInUrl: true },
    })
  }
  return app
}

export async function ensureAuth(): Promise<void> {
  const a = await getApp()
  if (!a || authReady) return
  try {
    await a.auth().signInAnonymously()
    authReady = true
  } catch {
    throw new Error('匿名登录失败，请检查 CloudBase 控制台是否已开启匿名登录')
  }
}

export async function getDatabase(): Promise<any> {
  const a = await getApp()
  if (!a) return null
  return a.database()
}
