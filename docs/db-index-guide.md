# 超市web 数据库性能优化 — 索引与改动指南

> 你们的"数据库"是 **CloudBase 云开发文档库（MongoDB 兼容）**，不是传统关系库。
> 查询慢的根因不是机器性能，而是**缺少索引 + 查询设计问题**。本文给出索引补齐方案（必做）与已落地的代码改动。

---

## 一、为什么必须建索引（云开发铁律）

云开发文档库规定：**组合查询（同时含 `where` + `orderBy` + `limit`）必须建对应索引**，否则会 **全集合扫描**——数据一多就慢，且可能直接报错（`sort field not indexed`）。

- `_id` 由云开发**自动建索引**，所以 `.doc(id).get()` / `.update()` 没问题。
- 凡是"按条件筛选 + 排序 + 翻页"的列表查询，都**必须**有覆盖 `where` 字段 → `orderBy` 字段的索引。
- 一个组合查询**只能用单个索引**，因此索引的字段顺序要严格匹配 `where` 字段在前、`orderBy` 字段在后。

---

## 二、需要补齐的索引清单

| 集合 | 索引名 | 字段与方向 | 命中的查询 | 备注 |
|---|---|---|---|---|
| sm_products | idx_products_enabled_order | `enabled` 升序, `order` 升序 | 公开商品列表 `getPublicProducts` | 组合索引 |
| sm_products | idx_products_order | `order` 升序 | 管理商品列表 `getProducts` | 单字段 |
| sm_orders | idx_orders_createdAt | `createdAt` 降序 | 订单分页 `getOrders`、`recalculateOrders` | 单字段 |
| sm_reviews | idx_reviews_productOrder_createdAt | `productOrder` 升序, `createdAt` 降序 | 按商品查评价 `getReviews` | 组合索引 |
| sm_reviews | idx_reviews_createdAt | `createdAt` 降序 | 管理全部评价 `getAllReviews` | 单字段 |
| sm_categories | idx_categories_order | `order` 升序 | 分类列表 `getPublicCategories` | 单字段 |
| sm_submissions | idx_submissions_createdAt | `createdAt` 降序 | 服务提交列表 `getSubmissions` | 单字段 |

> 方向说明：与查询 `orderBy` 的 `asc/desc` 保持一致可获得最佳性能。

---

## 三、控制台手动建索引（推荐，无需密钥）

1. 打开 **云开发控制台** → 进入你的环境。
2. 左侧 **数据库** → 选择集合（如 `sm_products`）。
3. 顶部切到 **索引管理** 标签 → 点击 **新建索引**。
4. 按上表逐项填写：
   - **索引名称**：填"索引名"列的值（如 `idx_products_enabled_order`）。
   - **索引字段**：点"添加字段"，按"字段与方向"列顺序添加（组合索引顺序不能错）。
     - 方向：`enabled`/`order`/`productOrder` 选 **升序(asc)**；`createdAt` 选 **降序(desc)**。
   - **唯一值**：**不勾选**（这些都不是唯一约束）。
5. 点 **保存/确定**，等待索引状态变为「正常」（大集合可能需要片刻）。
6. 对 **7 个集合** 全部重复上述步骤（sm_products 要建 2 个索引）。
7. 验证：随便打开顾客端首页/分类页，观察响应是否明显变快；控制台「索引管理」显示状态正常即成功。

> 也可改用脚本自动建：见 `scripts/create-cloudbase-indexes.mjs`（需腾讯云 API 密钥，见下方安全提示）。

---

## 四、安全提示（重要）

- **不要公开分享任何 Token / 密钥**。控制台密钥、API 密钥、ADMIN_KEY 都属敏感凭证。
- 脚本方式用到的 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 是**腾讯云 API 密钥**，请仅在本地环境变量中设置，**切勿写入代码或提交到仓库**。
- 控制台方式不需要任何密钥，是最安全的补齐路径。

---

## 五、本次已落地的代码优化

| 文件 | 改动 | 收益 |
|---|---|---|
| `cloudfunctions/shared.js` | `createOrderHandler`：逐件串行 `.doc(id).get()` → 单次 `where(_id: db.command.in(ids))` 批量拉取（修 N+1） | 下单 DB 往返从 N 次→1 次 |
| `cloudfunctions/shared.js` | `getReviewsHandler` 增加 `.field()` 投影 | 评价查询只取必要字段 |
| `cloudfunctions/admin-api/index.js` | `getPublicProducts` 增加 `.field()` 投影（含顾客端用到的 `description`） | 减少传输字段 |
| `cloudfunctions/admin-api/index.js` | `recalculateOrders`：`.limit(1000)` 一次性 → 按 `_id` 分页循环 | 修复超 1000 条订单漏算 |
| `cloudfunctions/public-api/index.js` | `getPublicProducts` 增加 `.field()` 投影 | 与 admin 一致 |
| `src/db.js` | `getProducts()` / `getCategories()` 增加 60s TTL 内存缓存 | 砍掉重复云函数+DB 请求，顾客端体感提速最明显 |
| `cloudfunctions/shared.js` 副本 | 已通过 predeploy 同步到 `admin-api/shared.js`、`public-api/shared.js` | 避免 admin/public 行为分裂 |

> 注：`src/db.js` 额外导出了 `clearCatalogCache()`，管理端改完商品/分类后调用可立即失效缓存（当前未强制接入，依赖 60s TTL 兜底）。

---

## 六、部署与验证

1. 索引：按第三节在控制台建好（状态「正常」）。
2. 云函数：把改动后的 `cloudfunctions/` 重新部署（admin-api、public-api）。
   - 注意 `shared.js` 改动已同步到两个函数目录的副本，部署时直接部署函数即可。
3. 前端：`src/db.js` 改动随前端构建部署。
4. 回归：打开顾客端首页/分类页（应更快）、下单（应正常且更快）、管理端订单/评价列表（应正常）。

---

## 七、附：顺手发现的一个潜在 Bug（非本次优化范围，供参考）

`src/auth.js` 的 `updateProduct()` 在云端分支直接 `return adminCall('updateProduct', clean)`，但该函数内**未定义 `clean` 变量**（应为 `const clean = pickProductFields(data)`），云端更新商品会抛 `ReferenceError`。如需要可一并修复：在云端分支先 `const clean = pickProductFields(data)` 再调用。
