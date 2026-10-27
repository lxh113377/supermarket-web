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
## 3. 端到端对账（本轮把上一轮的 UNVERIFIED 缺口补上了）

上一轮只能说清「键集/键序一致」，因为本机没有 D1 凭据 ⇒ 值级对账验不了。本轮用 **mock D1**
把**除 D1 自身的 SQL 执行之外**的一切都跑真了（`rust/scripts/check-api-native-e2e.mjs`）：

```
现网响应 → 反推 D1 行（只覆盖 SQL 真正 SELECT 的列，JSON 列按 TEXT 给）
        → mock D1（只认 Rust 源码里那三条 SQL，不认识就 400，绝不回空表）
        → 真边缘（serve + NATIVE_PUBLIC_ACTIONS=all + D1_API_BASE 指向 mock）
        → 与现网响应逐字段比（JSON.stringify 全等 ⇒ 含键序）
```

**读数**（`rust/docs/api-native-e2e.json`、`-parsed.json`）：

| 动作 | 原生分支 | 与现网逐字段相同 | 第二发微缓存 | 件数 |
|---|---|---|---|---|
| getPublicProducts | ✅ `x-edge: native` | ✅ 全等（含键序） | ✅ hit | 45 / 45 |
| getPublicCategories | ✅ | ✅ | ✅ hit | 3 / 3 |
| getCatalogOrders | ✅ | ✅ | ✅ hit | 67 / 67 |

两个刻意的加严：
  1. **JSON 列的两种形态都跑**：TEXT（走 `jparse`）与已解析值（走 jparse 的非字符串直通）——两种都必须与现网全等；
  2. **给 catalogOrders 多喂两条重复 + 一条 `order=0` 非法行**：输出仍须与现网相同 ⇒ 去重/过滤是活证据，而不是「碰巧没触发」。

### 仍然没验到的（点名）

- **D1 自身的 SQL 执行**：mock 只回预设行，所以「这三条 SQL 在真 D1 上跑出来的行」这一步仍是未知；
  它的替代保障是 `sql_matches_js_source`（SQL 与现网 JS 逐字一致）+ 现网响应反推的行的形状一致；
  真值级复核需要 D1 凭据，命令：给 `EDGE_BASE` 后跑 `check-api-parity.mjs` 的值级分支。
- **线上流量**：开关默认关 ⇒ 线上仍跑透传（灰度与回退见 §4）。
- **写动作**：36 个管理动作与 6 个公开写动作一个都没动（下一批，见 §5）。
- `getReviews` / `getOrderStatus` 等其余公开读也还没端口。

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
