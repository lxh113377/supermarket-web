/**
 * CloudBase 文档库索引创建脚本（超市web / supermarket-web）
 * --------------------------------------------------------------------------
 * 用途：补齐缺失的索引。云开发文档库的组合查询（where + orderBy + limit）
 *       必须建对应索引，否则会全集合扫描 —— 这是本项目查询慢的根本原因。
 *
 * 运行方式（本地，二选一）：
 *   A. 控制台手动建（推荐，无需任何密钥）：见 docs/db-index-guide.md
 *   B. 本脚本自动建：
 *      1) 进入有 @cloudbase/node-sdk 的目录，例如：
 *           cd cloudfunctions/admin-api
 *         或在项目根执行： npm i @cloudbase/node-sdk
 *      2) 设置环境变量（⚠️ 密钥属于敏感凭证，切勿提交/公开）：
 *           export ENV_ID=你的云环境ID
 *           export TENCENT_SECRET_ID=你的腾讯云API密钥ID
 *           export TENCENT_SECRET_KEY=你的腾讯云API密钥Key
 *      3) 运行：
 *           node ../../scripts/create-cloudbase-indexes.mjs
 *         （若放在项目根且已 npm i，则： node scripts/create-cloudbase-indexes.mjs）
 *
 * 说明：索引已存在时 createIndex 会报错/警告，脚本已捕获并跳过，属正常。
 */
import cloudbase from '@cloudbase/node-sdk'

const ENV_ID = process.env.ENV_ID
const SECRET_ID = process.env.TENCENT_SECRET_ID
const SECRET_KEY = process.env.TENCENT_SECRET_KEY

if (!ENV_ID || !SECRET_ID || !SECRET_KEY) {
  console.error('缺少环境变量：需要 ENV_ID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY')
  process.exit(1)
}

const app = cloudbase.init({ env: ENV_ID, secretId: SECRET_ID, secretKey: SECRET_KEY })
const db = app.database()

// keys 顺序必须匹配查询的 where 字段 → orderBy 字段 顺序（组合查询只能用单个索引）
const INDEXES = [
  // 公开商品列表：where({enabled:true}).orderBy('order','asc')
  {
    coll: 'sm_products',
    spec: { name: 'idx_products_enabled_order', unique: false,
      keys: [{ name: 'enabled', direction: 'asc' }, { name: 'order', direction: 'asc' }] },
  },
  // 管理商品列表：orderBy('order','asc')
  {
    coll: 'sm_products',
    spec: { name: 'idx_products_order', unique: false,
      keys: [{ name: 'order', direction: 'asc' }] },
  },
  // 订单分页/排序：orderBy('createdAt','desc')
  {
    coll: 'sm_orders',
    spec: { name: 'idx_orders_createdAt', unique: false,
      keys: [{ name: 'createdAt', direction: 'desc' }] },
  },
  // 按商品查评价：where({productOrder}).orderBy('createdAt','desc')
  {
    coll: 'sm_reviews',
    spec: { name: 'idx_reviews_productOrder_createdAt', unique: false,
      keys: [{ name: 'productOrder', direction: 'asc' }, { name: 'createdAt', direction: 'desc' }] },
  },
  // 管理全部评价：orderBy('createdAt','desc')
  {
    coll: 'sm_reviews',
    spec: { name: 'idx_reviews_createdAt', unique: false,
      keys: [{ name: 'createdAt', direction: 'desc' }] },
  },
  // 分类列表：orderBy('order','asc')
  {
    coll: 'sm_categories',
    spec: { name: 'idx_categories_order', unique: false,
      keys: [{ name: 'order', direction: 'asc' }] },
  },
  // 服务提交列表：orderBy('createdAt','desc')
  {
    coll: 'sm_submissions',
    spec: { name: 'idx_submissions_createdAt', unique: false,
      keys: [{ name: 'createdAt', direction: 'desc' }] },
  },
]

async function createOne(coll, spec) {
  try {
    const res = await db.collection(coll).createIndex(spec)
    console.log(`✅ ${coll} <- ${spec.name}`, JSON.stringify(res))
  } catch (e) {
    // 索引已存在 / 权限不足等情况，记录但不中断
    console.warn(`⚠️  ${coll} <- ${spec.name} 失败(可能已存在):`, e?.message || e)
  }
}

async function main() {
  for (const { coll, spec } of INDEXES) {
    await createOne(coll, spec)
  }
  console.log('\n索引创建完成。已存在的会跳过或报警告，属正常。')
  console.log('验证：云开发控制台 → 数据库 → 对应集合 → 索引管理，确认上述索引状态为「正常」。')
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
