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
## 2b. 第二轮扩充：getReviews / getOrderStatus（2026-10-27 第 5 轮）

| 件 | 位置 | 与原实现的对齐点 |
|---|---|---|
| 评价行映射 | `crates/core/src/api_shapes.rs` 的 `review_row_to_json` | 照搬 JS 的 spread 语义（`{ ...r, images: jparse(r.images, []) }`）：**按行自己的键序原样拷**，再覆盖 `images`；不写死字段清单（SQL 加列时不会静默漏字段） |
| 订单状态映射 | 同文件的 `order_status_data` | `{ orderId, status, updatedAt }`，键序一致；**data 是对象不是数组**（前端读 `data.status` 的写法直接依赖它） |
| 两个动作的原生实现 | `crates/edge/src/api_native.rs` | 新增 `SQL_GET_REVIEWS`（reviews.js:12）与 `SQL_ORDER_STATUS`（orders.js:441）；载荷取自请求体的 `payload` |
| 错误路径 | 同上 | `missing_product_order`（reviews.js:9）/ `missing_order_id`（orders.js:439）/ `order_not_found`（orders.js:442）——全部走 core 的 42 条登记码，不自造 |
| 缓存语义 | `api.rs` 的 `PUBLIC_READ_CACHEABLE` | 这两个动作**不进微缓存**：现网也没给它们 KV 缓存，多缓存一次就是行为改变（新评价可能 60 秒看不见） |

两处**刻意的「回落而不是猜」**：

- `getReviews` 的 `productOrder` 是「非空但取不出有限数」（例如 `NaN`）时：JS 会把 NaN 当参数发给 D1（SQL 匹配不到 ⇒ 空数组）。
  Rust 侧**不回原生**，直接落透传 —— 让上游照旧处理，比猜一个「大概等价」的答案安全。
- `getOrderStatus` 的 `orderId` 非字符串（数字/布尔）时按 `missing_order_id` 处理（现网 `typeof orderId !== 'string'` 的语义），不靠类型宽松去「帮忙修好」。

### 2b.1 判据读数（`check-api-native-e2e.mjs`，8 个用例）

| 用例 | 原生分支 | 与现网 | HTTP | 缓存第二发 |
|---|---|---|---|---|
| getPublicProducts | ✅ | ✅ 逐字段相同 | 200 | hit（可缓存） |
| getPublicCategories | ✅ | ✅ | 200 | hit |
| getCatalogOrders | ✅ | ✅ | 200 | hit |
| getReviews（productOrder=6，真实 1 条） | ✅ | ✅ | 200 | 无头（**不可缓存**） |
| getOrderStatus（未知订单号 → 错误路径） | ✅ | ✅ | 404 | 无头 |
| getOrderStatus（缺 orderId → 错误路径） | ✅ | ✅ | 400 | 无头 |
| getOrderStatus（**不给 payload** → 边界） | ✅ | ✅ | 400 | 无头 |
| getReviews（缺 productOrder → 错误路径） | ✅ | ✅ | 400 | 无头 |

「不给 payload」这条是**替委派审计核实的一处疑虑**：它的读码结论是「handlers 里 `payload.orderId` 在 payload 为 undefined 时会先抛」；
实测现网 **400 `missing_order_id`（不是 500）**，原生同值 —— 说明 `/pub` 的入口把 payload 归一化过。结论按**线上实测**记，不按读码推断记。

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

- **D1 自身的 SQL 执行**：mock 只回预设行，所以「这些 SQL 在真 D1 上跑出来的行」这一步仍是未知（现已覆盖 5 条 SQL）；
  它的替代保障是 `sql_matches_js_source`（SQL 与现网 JS 逐字一致）+ 现网响应反推的行的形状一致；
  真值级复核需要 D1 凭据，命令：给 `EDGE_BASE` 后跑 `check-api-parity.mjs` 的值级分支。
- **线上流量**：开关默认关 ⇒ 线上仍跑透传（灰度与回退见 §4）。
- **写动作**：一个都没动（下一批；清单与风险分级见 [docs/09](09-api-inventory.md)）。
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

## 2c. 管理端第一批：鉴权层 + getProducts + 审计（2026-10-27 第 6 轮）

公开读那两条路（§2b）免鉴权；管理端不一样：**先鉴权、再只读档、最后派发**。这层一次解锁 9 个只读动作，
所以值得单独一批做，而不是捆在某个具体动作上。

| 件 | 位置 | 与现网的对齐点 |
|---|---|---|
| 鉴权语义（纯函数） | `crates/core/src/auth.rs` | 密钥**只走 body**（`web.js:21`；全仓无 `x-admin-key` / `Authorization` 通道）；常时比较（`security.js:17`：长度不等即 false、逐字节 XOR 累加）；角色解析（`security.js:201`：先全权限、再只读、否则 None）；只读档**白名单默认拒**（`backend.js:91`） |
| 三张动作表 | 同文件（PUBLIC 9 / ADMIN_READ 18 / ADMIN_WRITE 17） | 逐字抄自 `security.js:9` 与 `backend.js:39,56`；**同步性由用例钉住**（见下） |
| 管理端实现 | `crates/edge/src/api_admin.rs` | `SQL_GET_PRODUCTS`（products.js:88 的 `SELECT *`）；审计 INSERT（security.js:113 逐字）+ sha256 前 8 hex 指纹（security.js:98） |
| 网关接线 | `crates/edge/src/api.rs` | 位置在微缓存之后、透传之前；开关**独立**（`NATIVE_ADMIN_ACTIONS`，默认关）——管理端爆炸半径更大，不该被公开读的开关带上 |

### 2c.1 判据

| 判据 | 命令 | 读数 |
|---|---|---|
| 鉴权语义 + 信封 | `cargo test -p supermarket-core --test auth` | 5 条：常时比较（长度不等 / 空串 / 中文）、角色优先级、`auth_failed` 封套**逐字节**、只读白名单「未登记即拒」（含一个假想的未来动作）、只读拒绝文案 |
| **动作表与现网同步** | 同上（`b_action_sets_match_js_source`） | 去读 `security.js` / `backend.js`，把三张 `new Set([...])` 解出来与 Rust 常量逐条比 —— 现网增删一个动作而边缘没跟，当场判红 |
| SQL 逐字一致 | `cargo test -p supermarket-edge` | 判据从 5 条扩到 **7 条 / 4 个文件**（新增管理端 `SELECT *` 与审计 INSERT） |
| 端到端（含审计） | `node rust/scripts/check-api-native-e2e.mjs` | 管理面 5 个用例全绿（见 2c.2） |

### 2c.2 端到端读数（管理面 5 个用例）

| 用例 | 原生分支 | 与现网 | HTTP | 审计写入 |
|---|---|---|---|---|
| getProducts（正确密钥） | ✅ | ✅ 逐字段相同（67 件） | 200 / 200 | **+0**（读动作不写审计，与现网一致） |
| getProducts（错密钥） | ✅ | ✅ | 401 / 401 | **+1**（auth_failed） |
| getProducts（无密钥） | ✅ | ✅ | 401 / 401 | **+1** |
| getProducts（只读密钥，白名单内） | ✅ | ✅ | 200 / 200 | +0 |
| createProduct（只读密钥，应拒） | ✅ | ✅ | 403 / 403 | **+0**（只读拒绝在写审计之前早退，且**根本没有尝试写库**） |

审计条数不是靠「看日志」断言的：mock D1 新增 `--record`，把收到的每条语句按**形状**记下来
（只记 SQL 前缀、参数个数/类型/长度，**不记参数原值** —— 审计参数里有 IP 与密钥指纹）。
另外 mock 现在对写语句（INSERT/UPDATE/DELETE）**原样接受**：挡写路径会让审计静默丢失，
而现网恰恰吞掉审计错误 ⇒ 那会变成「看着一切正常、其实没留痕」。

管理端密钥从本仓 gitignore 的 `.dev.vars` **现读现用**（与 `scripts/uptime-check.mjs` 的日常用法一致），
只进环境变量，**不写进任何打印或读数文件**；读数里只记「密钥是否存在」。

### 2c.3 本轮没做的（点名）

- **审计的 5% 采样清理**（`security.js:118`：每次写入 5% 概率删 90 天前记录）**没有复刻**：
  它是随机数驱动的表体积管理、不是契约；原生路径只写不裁。必须记住，否则长期跑审计表会长大。
- `login` 的登录限流（`rate:login`，在鉴权**之前**执行）与写动作的审计（`ok`/`fail`）都没做 ——
  `login` 与两个 AI 动作按 [docs/09](09-api-inventory.md) §3 归入写动作档（它们有 D1 写副作用）。
- 管理端只读的其余 8 个动作尚未端口，但**它们的鉴权与只读判定已经生效**（开关打开时先过本层）。
