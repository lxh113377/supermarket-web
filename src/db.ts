// 数据访问门面（facade）
//
// 原 db.js 是 285 行上帝模块，混装了商品/分类、订单、评价、服务表单提交、云端初始化
// 等互不相干的职责。现按单一职责拆分到 ./db/ 下的子模块：
//   - products.js    商品与分类读取（getCategories / getProducts / getAdminProducts）
//   - orders.js      订单读写（createOrder / getOrderById / getOrders）
//   - reviews.js     评价读写（addReview / getCloudReviews / addCloudReview / ...）
//   - submissions.js 服务表单提交 + 离线队列（createSubmission / getSubmissions / initSubmissionSync / flushPendingSubmissions）
//   - cloudInit.js   云端初始化与种子导入（seedCloudData）
//   - cloud.js       共享云数据库访问 helper（cloud / ensure，仅内部复用，不在此再导出）
//
// 本文件仅做再导出，保持既有 `import { ... } from '../db.js` 的全部调用方不破。
export * from './db/products'
export * from './db/orders'
export * from './db/reviews'
export * from './db/submissions'
export * from './db/cloudInit'

// 只读目录缓存实现见 ./catalogCache.js（独立模块，避免与 auth.js 循环依赖）。
// 这里再导出一次，保持既有 `import { clearCatalogCache } from './db.js` 的调用方不破。
export { clearCatalogCache } from './catalogCache'
