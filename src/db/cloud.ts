// 共享云数据库访问（原 db.js 内部 helper，抽为独立模块供 orders / cloudInit 复用）
import { getDatabase, IS_CLOUD, ensureAuth } from '../cloudbase'

// SDK 数据库实例，类型宽松（平台边界）
let _db: any = null
export async function cloud(): Promise<any> {
  if (!_db) _db = await getDatabase()
  return _db
}

export async function ensure(): Promise<void> {
  await ensureAuth()
}

export { IS_CLOUD }
