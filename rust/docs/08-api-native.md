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
