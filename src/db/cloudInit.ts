// 云端初始化（建集合 + 导入种子，仅管理端）
import { IS_CLOUD } from '../cloudbase'
import { cloud, ensure } from './cloud'
import { categories as seedCategories, products as seedProducts } from '../data/products-seed'

export async function seedCloudData() {
  if (!IS_CLOUD) throw new Error('仅云端模式可初始化')
  await ensure()
  const db = await cloud()
  const cols = ['sm_categories', 'sm_products', 'sm_orders']
  for (const c of cols) {
    try {
      await db.createCollection(c)
    } catch (e) {
      if (!/exist/i.test(e instanceof Error ? e.message : String(e))) throw e
    }
  }

  const cc = await db.collection('sm_categories').count()
  if (cc.total === 0) {
    for (const c of seedCategories) await db.collection('sm_categories').add(c)
  }

  const pc = await db.collection('sm_products').count()
  if (pc.total === 0) {
    for (const p of seedProducts) await db.collection('sm_products').add({ ...p, enabled: true })
  }

  const after = await db.collection('sm_products').count()
  return { categories: cc.total, products: after.total }
}
