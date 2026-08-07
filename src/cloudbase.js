// SDK 动态加载：仅管理后台需要 SDK 直连数据库时才加载（746KB 不进首屏 bundle）
const ENV_ID = import.meta.env.VITE_CB_ENV_ID || ''
const REGION = import.meta.env.VITE_CB_REGION || 'ap-shanghai'

export const IS_CLOUD = Boolean(ENV_ID)

let app = null
let authReady = false

export async function getApp() {
  if (!IS_CLOUD) return null
  if (!app) {
    const { default: cloudbase } = await import('@cloudbase/js-sdk')
    app = cloudbase.init({
      env: ENV_ID,
      region: REGION,
      auth: { detectSessionInUrl: true, persistence: 'local' },
    })
  }
  return app
}

export async function ensureAuth() {
  const a = await getApp()
  if (!a || authReady) return
  try {
    await a.auth().signInAnonymously()
    authReady = true
  } catch {
    throw new Error('匿名登录失败，请检查 CloudBase 控制台是否已开启匿名登录')
  }
}

export async function getDatabase() {
  const a = await getApp()
  if (!a) return null
  return a.database()
}
