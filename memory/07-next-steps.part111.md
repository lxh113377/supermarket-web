# 07 分卷 111 —— 第五十六轮的现网落账与一条新增欠账（R57-H7）

## 现网 D1 迁移已执行（本轮唯一一次动线上数据）

- 通道：`node scripts/migrate.mjs apply --remote --yes` ⇒ `APPLIED migrate-stock-movements.sql`、
  `1 新应用 / 8 已是最新`。**没有用裸 `d1 execute --file`**——裸执行不写 `schema_migrations`，
  账目永缺此行，下次有人重放该文件必 duplicate column（`chaoshi-web-deploy` §4 的前置铁律）。
- 前置备份：`wrangler d1 export supermarket --remote` ⇒ `1,470,430B`，
  **并载回 node:sqlite 做恢复演练**：products 55 / orders 59 / reviews 20 / submissions 14
  与线上当场读数逐项相等 ⇒ `RESTORE-DRILL-PASS`。只导出不载回的备份不算备份。
- 执行后复核：`movement_rows=0 / tbl=1 / idx=2 / ledger_row=1 / products=55 未变 / orders=59 未变 / tracked=0`。
- 现网只读清单：`getPublicProducts=30`(code=0) / `getPublicCategories=2` / `_health=200` /
  `github.io=200` / 跨源带 `Origin: lxh113377.github.io` 同样 30 / CORS 预检精确回显该源。

## 一条被实测推翻的判断（为什么差点误报生产事故）

我按代码推出"Functions 已上线而库里没 `stock_movements` ⇒ 顾客下单必炸"，并据此准备按生产事故处置。
实测 `tracked_products = 0`（生产 55 件商品**全部** `stock < 0`，即"不限售"）⇒
`createOrder` 里 `stockItems = verified.filter(stock >= 0)` **恒为空**，`reserveStock` 直接 `return null`，
根本不碰流水表 ⇒ **现网下单没有坏**，风险是**潜伏**的：只在下一次把某个商品改成有限库存时才炸
（那条路径 = `applyProductUpdate` 的 `'stock' in data` 分支）。
⇒ 教训：**`file:line` 上写着写路径 ≠ 该路径可达**；判"上线即事故"之前要把过滤条件一起算进去。

## R57-H7（高）· 流水写入侧第一次在现网被真实走一遍

- 现状：`stock_movements` 在生产是**空表**；本轮所有背书都来自本地（`verify:backend` 185 条 + 迁移重放 A3/A5）。
- 动作：选一件商品把库存设成有限值（这是**真实业务动作**，会改在售库存 ⇒ **必须用户点头或由店主自己操作**，
  agent 不擅自改线上商品数据），随后 `getStockMovements?productId=…` 应看到那条 `adjust/+N`，
  且 `LEDGER_CHECK_SQL` 对该商品返回空集。
- 免凭据、免真实库存的替代通道（可先做）：`npm run build:stub && npm run serve:stub` → `localhost:5182`
  （skill §6 ⑩ 的隔离通道，假接口、不碰生产库），它只能验前端接线，**验不到 D1 真语义**——
  两者不互相顶替，记账时要分开写。
- 前提 = 一条真面读数：`SELECT COUNT(*) FROM stock_movements` 从 0 变成 ≥1 且不变式判据仍空集。
