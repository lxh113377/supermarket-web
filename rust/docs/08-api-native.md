# 08 · API 原生化第一批（P3 起步）：/pub 三个公开读动作

> 这是「45 个动作逐个原生化」的第一步。**默认关闭**：不设开关时全部动作仍走上游透传，
> 线上行为与今天逐字节相同。本轮端口的是三个公开读：`getPublicProducts` /
> `getPublicCategories` / `getCatalogOrders`。

## 1. 落地了什么

| 件 | 位置 | 说明 |
|---|---|---|
| 行 → JSON 形状映射 | `crates/core/src/api_shapes.rs` | `row_to_product` / `row_to_category` / `catalog_orders` / `jparse`，逐条对齐 `functions/lib/actions/products.js`（含脏值语义），**字段顺序也一致**（serde_json `preserve_order`） |
| 三个动作的原生实现 | `crates/edge/src/api_native.rs` | SQL 字面量三条（来源行号写在注释里）+ D1 查询 + 映射 + `{code:0,data:…}` 封套 |
| D1 取行 | `crates/edge/src/d1.rs` 的 `query_rows` | 抽 `result[0].results`；形状不对返回 Err（**宁可回落，也不把「没取到行」当「表里没有行」**） |
| 网关接线 | `crates/edge/src/api.rs` 的 `handle_gateway` | 位置在「微缓存之后、透传之前」：原生命中吃同一套 60s 微缓存；没配 `FUNCTIONS_ORIGIN` 时原生动作也能独立服务；取不到就落透传 |
| 开关 | `NATIVE_PUBLIC_ACTIONS` | 未设 = 全关；`all` 或逗号分隔动作名（大小写无关） |

**降级语义**：原生路径返回 `None`（未配 D1 / 查询失败 / 形状不对）时不编错误响应，
而是继续走上游透传 —— 客户端拿到的仍是正确数据，只是慢了。这一条是刻意的：
迁移期最危险的形态是「换了一种错误形状」，而它不会被功能测试抓到。

## 2. 判据（三条，都在本轮真跑过）

| 判据 | 命令 | 读数 |
|---|---|---|
| SQL 必须与 JS 源码逐字一致 | `cargo test -p supermarket-edge` 的 `sql_matches_js_source` | 读 `functions/lib/actions/products.js` 原文，归一化空白后断言三条 SQL 逐字出现 —— **JS 改了 SQL 而 Rust 没跟，当场判红** |
| 映射语义与字段顺序 | `cargo test -p supermarket-core --test api_shapes` | 5 条用例：完整 JSON 文本断言（含键序）+ 脏值（`spec` 缺省、`enabled` 字符串 "1" 判 false、`stock` null ⇒ -1、`-2.7` ⇒ -2、`specOptions` 出对象 ⇒ []）+ `catalog_orders` 去重与 `needsLocalImage` |
| 与现网键集/键序对账 | `node rust/scripts/check-api-parity.mjs` | **三个动作全部逐位一致**：`getPublicProducts` 14 键、`getPublicCategories` 5 键、`getCatalogOrders` `{order,needsLocalImage}`；原始读数落 `rust/docs/api-live-shapes.json` |

## 3. 本轮**没验到**的（点名，不装成验过）

- **值级对账**：本机 `.dev.vars` 只有 `ADMIN_KEY / PRINT_ADMIN_PASSWORD / BACKUP_PASSPHRASE /
  ADMIN_READONLY_KEY`，**没有 D1 的 account/db/api token** ⇒ 原生动作在本机起不来，
  「同一个查询两边取值是否逐字相同」**未验**。补法：在有 D1 凭据的机器上给 `EDGE_BASE`
  与 `NATIVE_PUBLIC_ACTIONS=all`，对账脚本会走值级分支。
- **原生路径的线上流量**：开关默认关 ⇒ 线上跑的仍是透传。开关打开后的灰度与回滚见 §4。
- **写动作**：`createOrder` 等 36 个管理动作与 6 个公开写动作**一个都没动**（下一批）。
- `getReviews` / `getOrderStatus` / `aiChat` 等其余公开读也还没端口。

## 4. 开关怎么开（以及怎么回退）

```bash
# 打开（单机或部署环境）：
NATIVE_PUBLIC_ACTIONS=all          # 或在册动作名的逗号列表
# 观察：响应头 `x-edge: native`（原生）vs `x-edge: passthrough`（透传）
# 回退：去掉这个环境变量并重启（零残留：原生只是一条分支，不写任何状态）
```

## 5. 下一批（按风险从低到高）

1. 其余公开读：`getReviews` / `getOrderStatus`（读、可缓存）；
2. 管理端只读：`getAdminProducts` / `getOrders` / `getOrder` / `getDashboardStats`（后者现网有 60s KV 缓存，需同步 `DASHBOARD_WRITE_ACTIONS` 语义）；
3. 写动作：`createOrder`（幂等指纹 + 库存占用 + 并发校验）——**这批必须逐动作带值级对账与回滚演练**，不能靠本次的键序判据。
