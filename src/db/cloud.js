// 共享云数据库访问（原 db.js 内部 helper，抽为独立模块供 orders / cloudInit 复用）
import { getDatabase, IS_CLOUD, ensureAuth } from '../cloudbase.js'

let _db = null
export async function cloud() {
  if (!_db) _db = await getDatabase()
  return _db
}

export async function ensure() {
  await ensureAuth()
}

export { IS_CLOUD }
