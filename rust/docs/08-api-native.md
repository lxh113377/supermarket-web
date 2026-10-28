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

## 2d. 管理端第二批：4 个单表只读（2026-10-27 第 7 轮）

鉴权层（§2c）就位后，这批只差「SQL + 映射」。一次加 4 个：

| 动作 | SQL 来源 | 形状要点 |
|---|---|---|
| getAllReviews | reviews.js:50 | **直接回原始行**（不映射、不裁剪），只回 6 列（不含 images） |
| getSubmissions | submissions.js:77 | spread + formData 走 jparse（**缺省是对象 {}，不是数组**）+ imageCount = Number(..) \|\| 0；SQL 里的 imageCount 是 json_array_length 算出来的 |
| getSubmissionImages | submissions.js:93 | payload.submissionId **真值判定**（空串/0 都算缺）⇒ 缺则 400 missing_submission_id；查不到 ⇒ 404 submission_not_found；形状 { code:0, data:{ images } } |
| getEventLog（= getEventTimeline） | events.js:31 | orderId 先 sanitizeTrace 清洗；limit 默认 50、钳 [1,100]；形状 { code:0, data:{ orderId, events } } |

### 2d.1 这条批里两处「我修的是判据、不是实现」

1. **SQL 判据不会读拼接串**：events.js:31 的 SQL 是「模板串 + 单引号串」拼出来的，判据原先拿整串去 JS 文件里找，永远找不到 ⇒ 判据红得没道理。
   修法：归一化时**先折叠空白、再剥掉 JS 的字符串拼接胶水**（反引号 / 单引号 / 双引号 与 + 的组合），只剥胶水、不碰 SQL 记号。
   顺带记一笔踩坑：第一版按字符逐个把空白换成空格（没先折叠），于是换行+缩进变成一串空格，胶水模式匹配不上 —— **判据红得对，是我的归一化写错了**。
2. **sanitizeTrace 只实现可证的那段**：现网那一段背后是 IP 正则脱敏（logger.js:52 的 IP_PATTERNS）。Rust 侧没有 regex 依赖、也不打算猜正则语义 ⇒
   本实现只做「白名单 + 截断 64」，并且**一旦输入看起来像 IP 就回落透传**（4 段点分十进制 / 含 :: / 3 段以上冒号分隔的十六进制组）。
   宁可不原生，也不猜脱敏结果。这条边界由 core 单测 `looks_like_ip` 钉住。

### 2d.2 端到端读数（19 个用例全绿：公开面 8 + 管理面 11）

| 新增用例 | 原生 | 与现网 | HTTP | 数据 |
|---|---|---|---|---|
| getAllReviews | ✅ | ✅ 逐字段相同 | 200 | 真实 20 条评价 |
| getSubmissions | ✅ | ✅ | 200 | 真实 22 条提交 |
| getSubmissionImages（真实 id） | ✅ | ✅ | 200 | 真图集 |
| getSubmissionImages（缺 submissionId） | ✅ | ✅ | 400 / 400 | — |
| getEventLog（未知订单号） | ✅ | ✅ | 200 | 空事件数组 |
| getEventLog（缺 orderId） | ✅ | ✅ | 400 / 400 | — |

审计写入条数依旧逐条对齐（读动作**全部 +0**：现网只对登录与写动作留痕）。
SQL 判据现已覆盖 **11 条语句 / 6 个文件**（products.js、reviews.js、orders.js、security.js、submissions.js、events.js）。

### 2d.3 还没做的（点名）

- **getStockMovements**：动态 WHERE（productId/kind）+ LEFT JOIN products + **第二条 COUNT 查询**，还有 kind 白名单与分页钳制；
  它值得单独一批（判据要能验「两条查询的参数一致」），本批不赶。
- 其余带依赖的读（getOrders/getOrder 的 LEFT JOIN、getDashboardStats 的 KV 分键缓存、getPromotions 的聚合）与全部写动作仍未动。

## 2e. 管理端第三批：getStockMovements（双查询 + 动态 WHERE，第 8~9 轮）

这个动作是前面几批刻意留出来的，因为它有一条**别处没有的风险**：现网要跑**两条查询**
（主查询 + `COUNT(*)`），两条必须用**同一个 WHERE 子句与同一批参数**。

### 2e.1 把「两条参数一致」变成类型保证

现网（stock.js:101 的 `queryMovements`）手工拼 `where[]` 与 `params[]`，再分别拼进两条 SQL。
抄成 Rust 时如果也手写两遍，最容易犯的错不是写不出来，而是**两条的参数不一致** ——
于是 `items` 与 `total` 说的是两套筛选条件（列表 3 条、总数 17 条），而功能测试通常抓不到。

所以抽了 `crates/core/src/stock_query.rs`：一次构造出

    pub struct MovementQuery { clause: String, params: Vec<Value>, limit: i64, offset: i64 }

两条 SQL 都从**同一个值**取 ⇒ 「参数不一致」在类型上不可能发生。它还是纯函数，由 5 条用例钉住：

| 用例 | 钉住什么 |
|---|---|
| d_empty_payload_means_no_where_and_default_paging | 空载荷 / 无载荷同义：clause 空、limit 30、offset 0 |
| d_both_filters_share_one_clause_and_param_order | 两条件同时给时 **clause 与参数顺序固定**（productId 在前、kind 在后）；数字也按 String(...) 绑定 |
| d_falsy_filters_are_ignored_like_js | 真值判定：空串/0/null/false 都算「没给」 |
| d_invalid_kind_returns_the_live_envelope | `invalid_kind` 封套逐字节（含清洗后的 kind 与在册清单文案） |
| d_limit_and_offset_follow_js_coercion | `Number(x) || 30` 在 clamp **之内**：0 / "abc" / null 落 30、负数落 1、101 落 100、30.9 落 30；offset 负数落 0 |

### 2e.2 SQL 侧仍逐字验

两条 SQL 常量**保留现网模板串里的 `${clause}` 标记**（不是提前拼好再抄一份）——
判据才能拿它去 `stock.js` 里逐字对；运行时用 `replace(marker, clause)` 注入。
踩坑记一笔：第一版写成 `format!("${clause}")`，Rust 把 `{clause}` 当格式化占位符解析，
编译直接报 cannot find value `clause`；改成普通字符串字面量即可（**别用 format! 拼含花括号的模板标记**）。

SQL 判据现覆盖 **13 条语句 / 7 个文件**（新增两条流水查询）。

### 2e.3 端到端读数（管理面新增 5 个用例，总数 8 + 16 = 24）

| 用例 | 原生 | 与现网 | HTTP |
|---|---|---|---|
| getStockMovements（默认分页） | ✅ | ✅ 逐字段相同 | 200 |
| getStockMovements（productId 过滤） | ✅ | ✅ | 200 |
| getStockMovements（kind=sale） | ✅ | ✅ | 200 |
| getStockMovements（kind 非法） | ✅ | ✅ | 400 / 400 |
| getStockMovements（limit=5 & offset=2 钳制） | ✅ | ✅ | 200 |

夹具侧同步加了一条腿：**每个 clause 变体都要有自己的行集**（mock 按「替换后的完整 SQL」为键），
于是「实现偷偷换了语句」会当场 400，而不是悄悄回空表。

### 2e.4 还没做的（点名）

- `getOrders` / `getOrder`（orders LEFT JOIN order_discounts）、`getDashboardStats`（KV 分键缓存）、
  `getPromotions`（按档聚合）、`stalePendingReport`（双表读）仍未端口；全部写动作与 `login`/两个 AI 动作也未动。

## 2f. 管理端第四批：getOrders / getOrder（第 10 轮）

| 动作 | SQL 来源 | 形状要点 |
|---|---|---|
| getOrders | orders.js:533（orders LEFT JOIN order_discounts） | **四处派生同源**：`whereClause` / `orderByCol` / 方向 / 参数前缀都由同一个 `since` 判定派生；响应是 `{code,data,hasMore,page,pageSize}`，**data 是数组、无 total**；`LIMIT = pageSize+1`（多取一条判 hasMore），`hasMore = rows.length > pageSize`，`data = hasMore ? rows.slice(0,pageSize) : rows` |
| getOrder | orders.js:546（`o.*` + LEFT JOIN 两列） | 查不到 ⇒ **`{code:0,data:null}`**（不是 404：`order_not_found` 只用于别的动作）；`data` 是**对象或 null**；行映射 `{...row, items: jparse, paymentScreenshot: row.paymentScreenshot || ''}` |

### 2f.1 新增的两条判据腿（都是被红逼出来的）

1. **mock 改成参数感知**（键 = `SQL|params`，回落纯 SQL 键）：同一条 SQL 在不同分页参数下会回不同的行
   （LIMIT/OFFSET 在参数里），只用 SQL 当键会让两个分页用例互相覆盖 ⇒ 判据变成假绿/假红。
2. **夹具喂「原始行窗口」而不是现网的已裁切视图**：现网 `data` 已被 `slice(0,pageSize)` 裁到 50 条（多余那条被丢去判 hasMore），
   而 Rust 侧 SQL 的 LIMIT 是 `pageSize+1` ⇒ 直接喂现网 data 会让两边在 `hasMore` 上**天然不同**（第一版 4 条 getOrders 全红就是这个原因）。
   正确做法：先取同排序的大页（`pageSize=100`，需要时拼两页凑够 101 条原始行），再按 offset/fetch 切出 SQL 真正会返回的那几行。
   这两条都不是实现缺陷 —— 是**夹具在说谎**，而判据把它抓了出来。

### 2f.2 端到端读数（新增 6 条，总数 8 + 22 = 30）

| 用例 | 原生 | 与现网 | HTTP |
|---|---|---|---|
| getOrders（默认分页 50） | ✅ | ✅ 逐字段相同（含 hasMore/page/pageSize） | 200 |
| getOrders（page=2 & pageSize=5） | ✅ | ✅ | 200 |
| getOrders（pageSize=101 ⇒ 钳 100） | ✅ | ✅ | 200 |
| getOrders（since 增量：updatedAt ASC） | ✅ | ✅ | 200 |
| getOrder（未知 id ⇒ data:null） | ✅ | ✅ | 200 / 200 |
| getOrder（真实 id） | ✅ | ✅ | 200 / 200 |

SQL 判据现覆盖 **15 条语句 / 7 个文件**；核心侧新增 `crates/core/src/orders_query.rs`（5 条用例钉住分页归一、since 真值判定、
四处派生同源、`hasMore`/slice 语义、两处行映射）。

### 2f.3 还没做的（点名）

- `getDashboardStats`（KV 分键缓存 + 三表聚合）、`getPromotions`（按档聚合）、`stalePendingReport`（双表读）、`verifyKey`（纯鉴权语义，可并入鉴权层）；
- `getOrder` 的 **`orderId=undefined` 边界**：现网会把 undefined 直接绑进 SQL（仓内无测试），本实现**明确回落透传**而不是猜；
  这条要现网复核，已在 docs/09 登记为待办（子代理侦察时也点名过）。
- 全部写动作与 `login`/两个 AI 动作仍未动。

## 2g. 管理端第五批：verifyKey / stalePendingReport（第 11 轮）

| 动作 | SQL 来源 | 形状要点 |
|---|---|---|
| verifyKey | 无 SQL（纯鉴权语义，backend.js:109） | `{ code: 0, role }` —— role 由鉴权阶段解析（`admin` / `readonly`）。这是**鉴权闭环**：两档密钥各自能取回自己的角色 |
| stalePendingReport | orders.js:369 + :378（orders + products 两条查询） | `minutes` 钳 [1, 7 天]；`cutoff = now - minutes*60000`（ISO）；**空结果早退**（连商品查询都不做）；否则按商品集合查库存（`IN` 的占位符个数动态）→ 组装 `{thresholdMinutes, count, orders, stockReserved}` |

### 2g.1 这个动作的时间面（为什么单独抽一层纯函数）

它是唯一**依赖当前时间**的读动作：`cutoff` 与每单的 `ageMinutes` 都含 `now`。抽了 `crates/core/src/stale.rs`：

| 纯函数 | 钉住什么 |
|---|---|
| `parse_iso_ms` / `iso_from_ms` | 固定宽度 ISO 双向可逆；**epoch 参考值不是手算的**，每个都先用 JS `Date.parse` 现算再写进用例（含闰年 2024-02-29、跨世纪 2000-01-01） |
| `stale_minutes` | `Number(x)||60` 在 clamp 之内：0/"abc"/null 落 60、负数落 1、10081 落 10080、60.9 落 60 |
| `age_minutes` | `Math.max(0, Math.round(...))`：未来时间落 0、29.5 分钟 → 30 |
| `stale_product_ids` | 按**首次出现顺序**去重（对应 JS 的 `[...new Set(flatMap)]`） |
| `stale_report` | 空行集早退（键序 `thresholdMinutes,count,orders,stockReserved`）、`stock<0` 不计占用、缺商品跳过、`hasPaymentProof` 的 falsy 判定、orders 元素键序 |

**一处已知差异**（写在文件头，也在用例里点名）：现网用 `Date.parse`，时间串坏掉得 NaN → 该字段被序列化成 `null`；
Rust 侧没有 NaN 这种 JSON 值 ⇒ **解析失败落 0**。差异只出现在「createdAt 坏掉」这一种输入上。

### 2g.2 端到端读数（新增 3 条，总数 8 + 25 = 33）

| 用例 | 原生 | 与现网 | HTTP |
|---|---|---|---|
| verifyKey（正确密钥 ⇒ role:admin） | ✅ | ✅ 逐字段相同 | 200 |
| verifyKey（只读密钥 ⇒ role:readonly） | ✅ | ✅ | 200 |
| stalePendingReport（minutes=10080，**非空窗**） | ✅ | ✅ **96 条真实超时单** + 50 个商品 id 的反推行集合 | 200 |

非空窗能做逐字节对比，靠的是**换个取数面**：现网响应只有 `ageMinutes`（没有 `createdAt`、没有 `items`），
所以改从 `getOrders` 取回同一条单的原始行（含 `items` 文本与 `createdAt`），再按现网同样的
`status`/`createdAt < cutoff`/升序/`LIMIT 200` 筛一遍 ⇒ 喂给 mock 的就是 SQL 真正会返回的那 96 行。

### 2g.3 夹具本轮又暴露一条纪律（第二次同类）

行集必须在 `rows.json` **落盘之前**登记：第一版把这段写在管理端用例段里（落盘之后），
于是键根本没进文件 → mock 按「未预期 SQL」回 400 → 边缘查询失败 → 回落透传 → 线上表现是 **HTTP 500**。
从现象上看像实现缺陷，实际是夹具顺序错。**处置：登记行集的代码与用例登记分开写，前者必须在 mock 启动前。**

### 2g.4 本轮顺带记下的上游缺陷（来自委派侦察，未在本仓修）

`getDashboardStats` 的写失效只 `del` 了 9 个整数区间键（`DASHBOARD_RANGES = [1,3,7,14,30,60,90,180,365]`），
**非表内区间（如 5、7.5）不会被失效** ⇒ 写操作后最长脏 60s。这是现网既有行为，不是本轮引入；
原生化该动作时必须显式决定「复刻还是修正」，不能默默改语义（已登记进下一批的判据清单）。

## 2h. 管理端第六批：getPromotions（第 12 轮）

| 件 | 位置 | 要点 |
|---|---|---|
| 两条 SQL | orders.js:134 / :138 | 档位定义（按 threshold 升序）+ 每档命中（`GROUP BY promotionId`，无 WHERE） |
| 纯映射 | `core::api_shapes::promotion_tiers_to_json` | `name`/`updatedAt` 空值落空串；`threshold/discount` 走 `Number(x)||0`；
| | | **`enabled` 是 `Number(t.enabled) === 1`** —— 数字 1 ✓、字符串 "1" ✓、布尔 true ✓（`Number(true)===1`）、而 "true"/2/0/null ✗；
| | | `hits` 按 `promotionId === _id` 配对，配不上 ⇒ `{orders:0,totalDiscount:0}`（不是缺键） |
| 边缘实现 | `crates/edge/src/api_admin.rs` | **镜像现网的防御式语义**：外层 try 把任何异常（含缺 promotions 表）吞成 `{code:0,data:[]}`（成功信封！）；hits 查询单独 try，失败 ⇒ 全零命中 |
| | | 这一条与我惯用的「失败就回落透传」**不同**，是刻意的：现网契约就是这个形状（页面显示「未配置满减」而不是报错） |
| 缓存 | —— | **不进微缓存**（现网也没缓存它；进了就是行为改变） |

端到端：新增 1 条用例（现网 1 档 / 0 档有命中），逐字节相同；总数 **33**（公开面 8 + 管理面 25），两种 JSON 列模式各跑一遍全绿。
SQL 判据现覆盖 **19 条语句 / 7 个文件**。

## 2i. 上游缺陷登记（下一批必须显式裁决，不许默默改语义）

两个都是**现网既有行为**，不是本轮引入；原生化时必须先决定「复刻还是修正」，并把决定写进判据：

### 2i.1 `getDashboardStats`：缓存失效只覆盖 9 个整数区间

写操作后 `invalidateDashboard` 只 `del` 了 `DASHBOARD_RANGES=[1,3,7,14,30,60,90,180,365]` 这 9 个键 ⇒
**非表内区间（如 5、7.5）不会被失效**，最长脏 60s（TTL 到期才自愈）。

### 2i.2 `getDashboardStats`：日期标签比桶的 UTC+8 日历日**早一天**（委派侦察实测）

现网 `label(k) = String(new Date(k*DAY - TZ).getUTCMonth()+1) + "/" + getUTCDate()`（stats.js:32）。
实测：`nowMs=2026-03-10T04:00:00Z`（东八区 3/10 12:00）时，**今天那个桶的 label 是 "3/9"**，
`rangeData.labels = ["3/7","3/8","3/9"]`；若按真·东八区日期（`new Date(k*DAY)` 取 UTC 段）应为 `["3/8","3/9","3/10"]`。

**更值得记的是判据本身抓不到它**：`tests/stats.test.js:20` 的 `utc8TodayLabel()` 用了**完全相同的式子**，
于是「实现与测试同错」⇒ 这套测试永远不会因为标签漂移而红。原生化时的两条路：

1. **对齐线上行为**：照抄 `stats.js:32` 的字面式子（标签早一天），并在 Rust 侧用例里把「早一天」写成**断言**；
2. **以注释为准修 bug**：同时改 `stats.js:32` 与 `tests/stats.test.js:20`（行为=所有标签 +1 天，前端会看到日期变化）。

我倾向 **1**（原生化不允许顺带改线上行为），并把 2 作为独立工单登记 —— 但这条要等 `getDashboardStats` 真正原生化时按当时证据复核。

## 2j. 管理端第七批：getDashboardStats（六聚合 + UTC+8 分桶 + 缓存，第 13 轮）

这是剩余只读里最大的一块：三张表 + 六个聚合。抽了 `crates/core/src/stats.rs`（**10 条用例**）。

### 2j.1 期望值不是我自己算的

六段聚合的期望值来自**另一路独立侦察**（逐行读 stats.js + 手算例子），与我自己的读数逐字一致；
把它们写进 Rust 用例后**全部逐字节吻合** —— 这才是交叉验证，而不是「我写实现、我写期望、我通过」。
时间参考值也用 node 的 `Date.parse` 现算（不做手算）。

### 2j.2 被独立例子逼出来的一处修正（我原先的假设是错的）

第一版 `parse_iso_ms` **只认带毫秒的形态**；而独立例子里用的是秒级时间戳（`...T02:00:00Z`）⇒ 4 条日期用例全红。
JS 的 `Date.parse` 两种都吃 ⇒ 修解析器（小数秒可选、必须带 Z 后缀），并把 `tests/stale.rs` 里
原先「把秒级串当坏输入」的那条断言改正 —— **判据红了不是实现错，是我的假设错**。

### 2j.3 一处**刻意照抄的上游缺陷**

`localDayLabel(k)` 取的是 `new Date(k*DAY - TZ)` 那一刻的 UTC 日期 ⇒ **比桶的 UTC+8 日历日早一天**；
`tests/stats.test.js:20` 用了**同一个式子** ⇒ 实现与测试同错、判据永远抓不到漂移。
本实现**照抄**（原生化不允许顺带改线上行为），并用 `h_label_is_one_day_earlier_than_the_bucket` 把「早一天」写成**断言**。
修不修由独立工单决定（见 §2i.2）。

### 2j.4 与 JS 的几处易错对齐（都写进了注释）

· `Math.round` 是向 +∞ 取整（Rust 的 `f64::round` 是远离 0）⇒ 用 `js_round(x) = floor(x+0.5)`；
· `buildPieSegments` 的 quantity **不做 Number 强转**（与 `computeGrossMargin` 不同）⇒ 非数字让该桶变 NaN，`NaN > 0` 为假 → 该段被过滤（Rust 用 `f64::NAN` 复现同结果）；
· `buildTopRevenue` 用**稳定**排序（同营收保持首次插入序）；
· `computeGrossMargin` 的 `costPrice == null` 要**跳过**（不是当 0），而 `totalItems` 已经先加过 qty；
· `rangeDays` 非整数：现网会在 `new Array(7.5)` 抛 RangeError ⇒ 500，本实现交回落透传（不猜）。

### 2j.5 端到端读数（新增 1 条，总数 8 + 26 = 34）

| 用例 | 原生 | 与现网 | 数据 |
|---|---|---|---|
| getDashboardStats（六聚合 + 缓存） | ✅ | ✅ **逐字节相同**（含 labels/delta/margin/pie/topRevenue） | **116 真实订单 + 67 商品**（评价 0 条：现网近 14 天无新评价） |

缓存语义：现网用 KV（键 `cache:dashboard:stats:<rangeDays>`，TTL 60s）包着这个动作；
边缘侧把它加进**同一套微缓存**（`ADMIN_READ_CACHEABLE`，TTL 取 `cfg.api_cache_ttl_ms`），用例断言第二发命中。
SQL 判据现覆盖 **22 条语句 / 8 个文件**。

## 2k. 写动作第一条：deleteReview + 写路径机器（第 14~15 轮）

### 2k.1 硬边界：写动作**绝不对现网做对账**

读动作可以拿现网当真值面逐字节比；**写动作不行** —— 那会真改生产数据（订单/评价/库存）。
所以写动作的判据换成长这样：

| 腿 | 判什么 | 怎么判 |
|---|---|---|
| SQL 逐字 | 语句与现网 JS 里那句**逐字一致** | `sql_matches_js_source`（现覆盖 **23 条语句 / 8 个文件**） |
| 语句序列与参数形状 | 该动作到底发了哪些语句、顺序、参数个数与类型 | mock D1 的 `--record`（**只记形状不记原值**；审计参数含 IP 与密钥指纹） |
| 纯逻辑 | 载荷校验、错误封套、字段映射 | core 单测 |
| **不做** | 与现网写接口的字节对比 | 明确不做（会污染生产数据） |

### 2k.2 写路径机器的顺序（照抄现网 backend.js:196-206）

一次管理端写动作的完整顺序：**鉴权 → 只读档判定 → 派发（写库）→ 失效 → 审计 → 响应**。三条要点：

1. **先失效、后审计**（现网就是这个顺序）：失效在 `code === 0` 且动作 ∈ `DASHBOARD_WRITE_ACTIONS` 时发生；
   审计对 `login` 或全部 `ADMIN_WRITE_ACTIONS` 发生，且**无论成败**都落 `'ok'`/`'fail'`；
2. **两套失效面不是一套**（委派侦察点出来的）：目录面（create/update/deleteProduct、batch*、adjustStock ⇒ 3 个公开 KV 键）
   与看板面（`DASHBOARD_WRITE_ACTIONS` ⇒ 9 个区间键 + aiAdvice）；`adjustStock` 只在目录面、**不在**看板面 —— 别合并成一套；
3. **/pub 的写路径零审计**（只有 `handleAdmin` 审计），且公开写有自己的 `rate:write:<ip>` 限流（20/60s）。

边缘侧实现：`call_admin` 把 dispatch 结果接住，统一做「失效 → 审计」；微缓存按动作名清理（语义等价于现网删那 9 个键）。

### 2k.3 判据抓出来的一处**真实偏离**（我写错了，不是夹具错）

第一版 `deleteReview` 在「缺 reviewId」时**提前 return** 失败封套，于是绕过了统一后处理 ⇒ **失败没有审计**；
而现网「写动作无论成败都审计」。判据当场抓到：`语句条数 0，期望 1`。
修法：失败封套也交给后处理（不提前 return）。这条记下来是因为**读动作也有一堆提前 return**（缺参数就 `fail`），
它们现在没问题（读动作不审计），但**下一批写动作抄的时候必须小心同一个坑**。

### 2k.4 一条给多语句写动作的纪律（createOrder 之前必须读）

现在的实现里 D1 失败走 `.ok()?` ⇒ 回落透传，这对**单语句**写是安全的（要么没发生、要么已提交）；
但 `createOrder` 是「查库存 → 扣库存 → 写流水 → 插订单 → 插折扣」，**第一条语句生效后回落会让上游重放**；
所以下一批必须把多语句写改成**显式错误路径**（不回落），并把每一步的失败补偿（`releaseStock`）写清。

### 2k.5 端到端读数（写用例只打本地边缘）

| 用例 | 原生 | HTTP | 语句序列（mock 录制） |
|---|---|---|---|
| deleteReview（成功形态） | ✅ | 200 | `DELETE FROM reviews WHERE _id = ?` → `INSERT INTO security_events`（result 长度 2 = ok） |
| deleteReview（缺 reviewId） | ✅ | 400 | `INSERT INTO security_events`（result 长度 4 = fail） |

总数 **36 个用例**（公开面 8 + 管理读 26 + 写 2）；写用例在夹具里有一条顺着代码就能看出来的保证：
它只对 `base`（本地边缘）发请求，**一次都不打现网**。

## 2l. 写动作第二条：adjustStock（第 16~17 轮）

库存域写动作：`SELECT _id, name, stock FROM products WHERE _id = ?` → `UPDATE products SET stock = ?, updatedAt = ? WHERE _id = ?` →
`INSERT INTO stock_movements (...)`（kind=adjust / refType=manual / actor=admin）→ 目录面失效 → 审计。

### 2l.1 中间态才是这个动作的难点（不是 SQL）

`products.stock` 是 SQLite 动态类型列，库里真出现过 null / 字符串 / 小数。现网对每一种都有不同结局，全部照抄进 `core::stock_ops`（8 条用例）：

| 读出来的 stock | Number 后 | 结局 |
|---|---|---|
| 无行 | —— | `product_not_found` |
| 负数（-1 不限售，-5 也算） | 负数 | `stock_untracked` |
| null / 空串 | 0 | **静默当 0 记账**（最隐蔽的一条） |
| "12" | 12 | 正常按整数走 |
| 12.5 | 12.5 | UPDATE 照样写库，但**不落流水**、`recorded=false`、`delta=0` |
| "abc" | NaN | UPDATE 写 NaN，不落流水，响应 `before/after` 序列化成 `null` |

### 2l.2 判据抓出的两件事

1. **mock 被我改坏了**：负控分支里我写了 `state` / `params` 两个不存在的变量名（真实是 `table` / `parsed.params`）⇒ 每次写都抛 ReferenceError ⇒
   **审计静默全丢**，端到端一次红 **66 项**。这类「批量红」的根因往往在夹具自己身上 —— 先看 mock 的 stderr 比逐个用例看差异快得多。
2. **同一个坑第二次**：`adjustStock` 的四个失败出口又用提前 `return` 绕过了写后处理（失败没审计）；判据报「语句条数 1，期望 2」。
   修法：把整个动作抽成独立 `async fn adjust_stock`（函数内的 return 只结束自己，外层「失效 → 审计」照常执行）。
   **这条现在是硬纪律**：写动作一律抽独立函数，不许写在 match 分支里直接 return。

### 2l.3 一个被我改成容差的地方（诚实记录）

`stalePendingReport` 的 `ageMinutes` 取决于**两侧各自的当前时刻**，用逐字节比它等于让两个时钟比大小；
本轮实测 flaky 一次（count 相同、前三单相同，某一单的 ageMinutes 差 1）。处置：把该字段放进 `stripFields`，
其余字段仍逐字节比 —— 判据保留牙齿，但不再对时钟过敏。

### 2l.4 端到端读数（写用例 2 → 6 条）

| 写用例 | HTTP | 语句序列（mock 录制） |
|---|---|---|
| deleteReview（成功） | 200 | DELETE → 审计(ok) |
| deleteReview（缺 reviewId） | 400 | 审计(fail) |
| **adjustStock（+4 成功）** | 200 | SELECT → UPDATE → INSERT stock_movements → 审计(ok) |
| **adjustStock（-10 ⇒ stock_insufficient）** | 409 | SELECT → 审计(fail)（**不写库**） |
| **adjustStock（UPDATE 命中 0 行 ⇒ product_not_found）** | 404 | SELECT → UPDATE → 审计(fail) |
| **adjustStock（缺 productId）** | 400 | 审计(fail) |

写用例还各自断言响应字段逐字（含 `data` 与手算一致：`{productId,before:5,after:9,delta:4,recorded:true}`）与错误消息逐字
（`调整后库存为负（现 5，本次 -10）`）。SQL 判据 **26 条语句 / 9 个文件**。

负控：`rows.json` 里的 `__metaMissingIds` 命中参数时 mock 回 `changes=0` —— 这是「守卫式 UPDATE 命中 0 行」唯一可判的地方。

## 2m. createOrder 的纯计算层（第 19 轮；**动作未完成**，只落了前半段）

createOrder 是全仓最长的写动作（20 步），其中**只有最后 6 步碰 SQL**。这一轮把前半段（校验 / 计价 / 指纹 / 幂等 / 最优档 / 规格解析）
抽成 `crates/core/src/order_intake.rs`（**10 条用例**）；SQL 层下一批再做 —— 所以完成计数**不动**（仍 19 / 37）。

### 2m.1 为什么先做纯计算层

这些函数抄错**不会报错**，只会让两类事故静默发生：

| 抄错的地方 | 后果 |
|---|---|
| 指纹漏了 `items[].spec` | 同房间 90 秒内改口味被判成重复单、复用旧单（**现网 2026-09-26 真出过**） |
| 指纹少一段 / 连接符写错 | 同一单被判成两单（重复下单）或不同单被判成同一单 |
| fnv1a 用字节而不是 UTF-16 码元 | 中文房号/备注的键全错，幂等失效且**只在中文输入时**失效 |
| 最优档比较用原始 dc 而不是 clamp 后的值 | 满减金额在高门槛小计下选错档 |

### 2m.2 参考值全部先用 node 现算（含三个公开向量）

`fnv1a` 对上 FNV-1a 的公开测试向量：空串 `811c9dc5`、`"a"` `e40c292c`、`"foobar"` `bf9cf968`；
指纹串、幂等键（`36-1116@req-1#1a47e90b`）、体积字符数（150）都是 node 按现网同一段逻辑算出来的，不手算。

### 2m.3 两处照抄的反直觉行为（都写进了用例注释）

1. `bestPromotion` 的比较用的是**已经被 clamp 的** `best.discountAmount` ⇒ 小计不足优惠额时，
   同额档位**后到者胜**（我第一版期望写成先到者胜，判据把它抓了出来）；
2. `Number(x).toFixed(2)` 对 `-0` 给 `"0.00"`（负零不带负号），而对 `-0.001` 给 `"-0.00"` ⇒ 只特判真正的 0。

### 2m.4 已落地的函数清单（对应现网行号）

| 函数 | 现网位置 | 要点 |
|---|---|---|
| `fnv1a` | orders.js:33 | UTF-16 码元 + `Math.imul` 环绕 + 8 位 hex |
| `order_fingerprint` | :53 | 六段 NUL 连接；截图段只取长度 |
| `idempotency_key` | :45 | requestId 非字符串/过滤后为空 ⇒ None |
| `allowed_order_specs` / `resolve_order_spec` | :90 / :106 | 目录 spec + 启用口味组合；非法回落真值 |
| `best_promotion` | :110 | 防御式（缺表零优惠）；`min(dc, subtotal)` |
| `is_safe_image_url` | security.js:135 | 三段白名单：`data:image/(jpeg|png|webp|gif);base64` / `r2:` / https |
| `statement_payload_chars` | orders.js:214 | 按 UTF-16 码元统计，与 `JSON.stringify(...).length` 对齐 |
| `round2` / `line_total` / `valid_quantity` / `below_min_delivery` | :219 / :203 / 守卫 | 计价与门槛 |

**下一批（SQL 层）要处理的**：`products IN` 查询、两条去重查询、护栏式扣减 batch（看 `meta.changes`）、
流水 batch、`INSERT INTO orders` / `order_discounts`、失败补偿 `releaseStock`，
以及侦察件点名的**一处不确定分支**（扣减 batch 成功而流水 batch 抛错时，现网该分支**不回补**）。

## 2n. createOrder 的 SQL 层（第 20 轮；**已实现但默认关、判据未就位**）

`/pub createOrder` 的 20 步全序已落 `crates/edge/src/api_pub_order.rs`：写限流（D1 回退路径）→ 入参/截图/体积/起送四道守卫 →
`products IN` → 护栏式扣减（逐条看 `meta.changes`）→ 售出流水 → 插单 → 优惠明细 → 失败补偿 `releaseStock` → 响应。

**它现在默认不生效**：开关 = 环境变量 `NATIVE_PUB_WRITE`（逗号分隔动作名），与 admin 侧同风格。理由写在代码注释里：
`createOrder` 是顾客可见的关键路径，而**写动作不能拿现网做对账**（会真下单）—— 在 mock 侧的语句序列判据就位之前，
让它默认生效等于把未验证的写路径推到线上。**所以本轮不动完成计数（仍 19 / 37）。**

### 2n.1 步骤对照（现网 orders.js:166-320）

| 步骤 | 现网 | 要点 |
|---|---|---|
| ① 入参守卫 | :168 | `roomNumber` 假值 / `items` 非数组 / 空数组 ⇒ `invalid_order_payload` |
| ② 截图守卫 | :173-177 | 先体积（>90000 ⇒ `image_too_large`）后 scheme（⇒ `invalid_image`）；空串跳过校验 |
| ③ 取商品 | :179 | `IN` 占位符个数 = items 行数，顺序即请求序 |
| ④ 逐行校验 + 计价 | :182-204 | 缺商品 / 已下架 / 数量非正整数 / >99；规格走白名单回落；`price × qty` 累加 |
| ⑤ 归一 | :208-218 | `room` trim；wechat 50 / remark 200 按 UTF-16 截断；体积守卫（键序 room,wechat,remark,items,shot） |
| ⑥ 计价收口 | :219-226 | `round2` 后判起送门槛（**折前**） |
| ⑦ 最优档 | :230-232 | 缺表 ⇒ 零优惠；`discountRounded` / `payableRounded` 各自 round2 |
| ⑧ 指纹 + 幂等键 | :233-237 | 指纹用**折后实付**；键非空才走键路径 |
| ⑨ 去重 | :240-252 | 键路径无时间/状态约束；指纹路径 90 秒窗口 + 状态集 `{pending,paid}`；命中 ⇒ `deduplicated:true`、**不动库存** |
| ⑩ 扣减 | :303-320 | 护栏式 `UPDATE ... WHERE _id=? AND stock>=0 AND stock>=?` |
| ⑪ 流水 | :315 | delta 为负、`kind=sale`/`refType=order`/`actor=pub` |
| ⑫ 插单 | :270 | 列序 = 现网 doc 键序；有键时**追加在末尾** |
| ⑬ 优惠明细 | :274 | 仅 `discount>0` |
| ⑭ 补偿 | :278-291 / :325 | 落库失败 ⇒ 回补全部已扣项；扣减中途失败 ⇒ 回补**前面已扣的**（`bad>0` 才回补） |

### 2n.2 两处必须知道的差异（都写进了代码注释）

1. **顺序执行 vs batch 原子性**：现网用 D1 batch（一次往返、某条抛错整批不生效）；本边缘走 D1 REST 接口一次一条语句，
   于是批量是**顺序多次往返**。逐条语句、逐条参数、逐条 `meta.changes` 判定都与现网一致，但**原子性不同** ——
   靠现网本来就有的 `releaseStock` 补偿覆盖大半。
2. **现网点名的不回补分支**：`orders.js:259-320` 没有 try 包裹 —— 扣减成功而紧接着的流水抛错时，**库存已减、流水缺失且不回补**
   （回补只挂在插单的 catch 内）。本实现**照抄**，并在注释里点名，不擅自"修好"。

### 2n.3 还没做的（下一批）

- **mock 只打本地的写用例**：成功（7 条语句序列 + 响应 data）、去重命中（**不动库存**）、库存不足（补偿序列）、
  限流（429 + `retryAfterMs`）—— 这四条就位后才谈"打开开关"与完成计数；
- `event_log` sink 与下单通知（现网 endpoint 收尾，另属一类）；
- 限流桶在判据里的固定方式：让夹具带 `cf-connecting-ip` 请求头，把桶键变成可预期值（本轮已把 `postPub` 改成支持额外请求头）。

### 2n.4 四条写用例就位 —— 动作**完成**（第 21 轮）

| 用例 | HTTP | 语句序列（mock 录制；写用例只打本地边缘） |
|---|---|---|
| 成功 | 200 | 限流读 → 起桶 → products IN → promotions → 幂等键查 → **护栏扣减** → 售出流水 → 插单 |
| 指纹去重命中 | 200 | 限流读 → 起桶 → products IN → promotions → 指纹窗口查 → 老单优惠查（**订单域零写**） |
| 库存不足 | 409 | …→ 护栏扣减（0 变更）→ 拒；消息逐字 `库存不足: 牛奶`（索引 0 ⇒ 无需补偿） |
| 限流 | 429 | 只有限流读一条（桶满） |

判据里两处「我第一版期望写错、判据纠正」的记录：
1. 空限流桶会走**起桶 UPSERT**（现网同款）⇒ 语句多一条；
2. 「不动库存」这句要**限定在订单域** —— 起桶本身也是写，但它不属于下单链路。

### 2n.5 SQL 逐字判据扩到 40 条（含 13 条下单链路）

两条动态 SQL 的占位符在现网有两种写法（内联表达式 `${ids.map(() => '?').join(',')}` 与局部变量 `${ph}`）——
判据给两种标记分别展开再逐字比，**比「跳过这两条」强得多**：列序或条件改了一样红（本轮就真的抓到
`SQL_RELEASE_STOCK` 用了错的那种写法）。

### 2n.6 开关现状

夹具里已设 `NATIVE_PUB_WRITE=createOrder`（判据就位后显式打开）；**生产侧默认仍关** —— 开不开是独立决定，
要的是「实现与判据都在、开关由人决定」，不是「悄悄把公开写切到新实现」。

## 2o. 商品域三个写动作（第 22 轮；createProduct / updateProduct / deleteProduct）

三者共用一份字段白名单（现网 shared.js:9 的 PRODUCT_FIELDS，**出现序即 INSERT 列序**）与同一套归一；
核心抽 `crates/core/src/product_writes.rs`。它们都在目录失效面里 ⇒ 复用已有的「写后失效 → 审计」收口。

| 动作 | 语句序列 | 要点 |
|---|---|---|
| deleteProduct | `DELETE FROM products WHERE _id = ?` → 审计 | 单语句；删不存在的 id 也走成功路径（幂等），不级联删流水（留孤儿账） |
| updateProduct | 可选 `SELECT stock`（先读后改）→ 动态 `UPDATE products SET "c" = ? …` → 可选流水 → 审计 | `meta.changes` 为 0 ⇒ `product_not_found`（**早退前不写流水**）；`updatedAt` 无条件追加 |
| createProduct | 动态 `INSERT INTO products` → 可选期初流水 → 审计 | 期初流水 kind=init/refType=ledger；**stock=0 时不发**（现网 normalizeMovement 拒 delta=0） |

### 2o.1 判据抓出的一处真偏差（键序）

`enabled` 是**无条件写入**的键，但位置讲究：入参带了它 ⇒ 保持白名单里的**原位**；入参没带 ⇒ **追加到末尾**。
我第一版一律挪到末尾，判据报「data 键序不符」——这正是「键序也是接口契约」的例子。
另外我自己的断言也写错了一处：商品类响应回的是 `_id`（整份 doc），不是订单类的 `id` ⇒ 断言改成两种都认。

### 2o.2 写用例（新增 4 条，总写用例 14）

| 用例 | HTTP | 断言 |
|---|---|---|
| deleteProduct（成功） | 200 | DELETE + 审计(ok) |
| deleteProduct（缺 productId） | 400 | 只有审计(fail) |
| updateProduct（改价 + 改库存） | 200 | 预读 → UPDATE → 流水 → 审计(ok) |
| createProduct（成功） | 200 | INSERT products → 期初流水 → 审计(ok)；**响应键序** `_id,name,price,subcategories,enabled,image,images,stock,specOptions,createdAt,updatedAt` |

动态 SQL（INSERT 的列由入参决定、UPDATE 的 SET 由字段决定）**进不了逐字判据**（没有静态文本可比）——
它们的正确性由「语句条数 + 参数个数 + 响应键序」这三条用例腿覆盖，这一点在 docs/09 §3 里点名。

## 2p. 批量商品写（第 23 轮；batchUpdateProducts / batchDeleteProducts）

| 动作 | 语句序列 | 要点 |
|---|---|---|
| batchUpdateProducts | 可选批量预读 `SELECT _id, stock … IN`（1 条，只取「updates 带 stock」的项）→ 逐件复用单条 UPDATE/流水 → 审计 | 上限 **20**（现网 `BATCH_UPDATE_MAX`）；**恒回 code 0**，逐件失败进 `data.failed`；缺 productId 的项回 `{id:"?", message:"缺少 productId"}` |
| batchDeleteProducts | `SELECT _id … IN`（存在集合）→ `DELETE … IN` → 审计 | 上限 **200**；先去重（只留非空字符串）；`deleted` 以**存在集合**为准（现网明确不看驱动 `meta.changes`——各环境口径不一甚至为 null） |

**复用**：批量更新逐件调用的就是单条 `applyProductUpdate`（我这边抽成 `update_product_with`，把批量预读到的「改前库存」传进去）——
这正是现网的做法：**先一条 IN 拿全，再逐件应用**，避免 n 倍语句数。语句序列因此与现网一致（预读 1 条 + 每件 1~2 条 + 审计）。

### 2p.1 本轮判据抓出的两处（都是**我方判据自身**的问题，不是实现）

1. **mock 键的占位符个数写错**：3 个 id 的 SQL 是 `IN (?,?,?)`，我按单个 `?` 登记 ⇒ mock 认不出 ⇒ 边缘查询失败 ⇒ 该用例红。
   修法：登记键的占位符个数必须与**去重后**的 id 数一致。
2. **SQL 判据的数组长度写错（43 vs 44）** ⇒ `cargo test -p supermarket-edge` 的**测试目标根本没编译**，
   而 `cargo build --release`（二进制）照常通过 —— 于是「判据绿」这句话会变成**假的**。
   这是我第一次在提交前主动复跑判据目标才发现：**二进制绿 ≠ 判据绿**。已在下一批沿用「提交前显式跑一次判据目标」。

### 2p.2 写用例（新增 3 条，总写用例 17 / 用例 51）

| 用例 | HTTP | 断言 |
|---|---|---|
| batchUpdateProducts（1 成功 + 1 缺 id） | 200 | 预读 IN → UPDATE → 流水 → 审计(ok)；`data={updated:1,failed:[{id:"?",message:"缺少 productId"}],total:2}` |
| batchDeleteProducts（去重 + 存在集合 + 失败清单） | 200 | 存在 IN(3 参数) → DELETE IN(3 参数) → 审计；`data={deleted:2,failed:[p_missing],total:4}` |
| batchUpdateProducts（缺 items） | 400 | 只有审计(fail) |


## 2q. 订单状态机两件（第 24 轮；updateOrderStatus / deleteOrder）

### 2q.1 迁移表是单点强制（逐字照抄现网 orders.js:399）

| 当前态 | 允许去到 |
|---|---|
| pending | paid / cancelled |
| paid | delivering / cancelled |
| delivering | completed / cancelled |
| completed | （终态，无处可去） |
| cancelled | pending（**误取消恢复**） |

status 列是 TEXT、**没有 CHECK 约束**（扩态零迁移）⇒「哪些流转合法」只存在于这张表里。抽到 `core::order_state`（3 条用例）。

### 2q.2 updateOrderStatus：两条库存路径 + 乐观锁

顺序（照抄现网 orders.js:410-441）：校验（`invalid_params`）→ 读当前状态（缺行 ⇒ `order_not_found`）→
迁移合法性（非法 ⇒ `invalid_transition`，文案逐字 `不允许的状态流转: 旧 → 新`）→
**取消** ⇒ `releaseStock(actor=admin)` → **误取消恢复**（cancelled→pending）⇒ `reserveStock(actor=admin)`（库存被占走 ⇒ 直接返回库存不足、状态不动）→
**乐观锁** `UPDATE … WHERE _id = ? AND status = ?`（把读到的状态写进 WHERE）→ 0 变更 ⇒
（若刚才为恢复扣过库存）先 `releaseStock(actor=system)` 回补，再回 `concurrent_update`。

乐观锁这一段是「两个管理员同时点同一单」的唯一防线：合法性判定基于读到的状态，两个人都会通过校验，
但只有一个人能把状态**从旧值**改掉。

### 2q.3 deleteOrder：删除时按状态决定是否回补

`missing_order_id` → 先读（状态 + items）→ `DELETE` → 若状态**不在** {cancelled, completed} 且 items 非空 ⇒ `releaseStock(admin)`。
口径：cancelled 已在取消时释放、completed 视为已交付消耗 —— 都不回补（**防删除历史单凭空加库存**）。

### 2q.4 写用例（新增 4 条，总写用例 22 / 用例 56）

| 用例 | HTTP | 断言 |
|---|---|---|
| updateOrderStatus（pending→paid） | 200 | 读状态 → UPDATE(4 参数,含旧状态) → 审计(ok) |
| updateOrderStatus（pending→completed） | 409 | 读状态 → 审计(fail)；**文案逐字** `不允许的状态流转: pending → completed` |
| deleteOrder（pending 单） | 200 | 读状态 → DELETE → 回补 SELECT IN → 回补 UPDATE(CASE) → void 流水 → 审计(ok) |
| deleteOrder（缺 orderId） | 400 | 只有审计(fail) |

SQL 逐字判据 **44 → 47 条**（新增读状态 / 乐观锁 UPDATE / 删单三条）。

