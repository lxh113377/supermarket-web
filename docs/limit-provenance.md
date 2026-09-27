# 数值上限登记册（唯一真相源，受 `npm run verify:limits` 双向对账）

> 本表由 `scripts/check-limit-provenance.mjs` 校验：**代码里每个「会砍东西」的数值上限**（六类形态：
> 拒绝型 `x.length > N` / 截断型 `.slice(0, N)` / 体积型 `N * 1024` / 保留期 `-N days` / 分页 `LIMIT N` /
> 命名常量 `MAX_*`·`BATCH`·`_MS`）必须有行、有行必须对得上现状、类别必须合法、依据不得是 TODO。
> **取数面 = `functions/**.js` + `src/**.ts|.tsx`**（第十八轮 M6 起含前端；单点定义在判据的
> `SURFACE_PREFIXES`，C7 会把「面内文件是否都落在声明前缀里 + src/ 是否真在里面」当正向对照跑）。
> 扩面当轮即暴露两处度量器自身的缺陷，都已修机制而非调阈值：
> ① `x.length > 0` / `< 1` 是**非空判断**不是上限（在 functions/ 里恰好一次都没出现，一进 src/ 就造出
> 12 行假上限）⇒ 由 `EMPTY_TEST` 排除；② 同一表达式 `length <= 2 * 1024 * 1024` 会被拒绝型按第一个
> 数字切中，与体积型重复 ⇒ 如实登记并在依据里写明"与体积型同源"，不悄悄改正则把它藏掉。
> 新增一个上限而不登记 = 门禁判红。取值类别：`platform`（外部平台硬约束，必须点名 `PLATFORM_FACTS`
> 里的事实且值不超过它）/ `schema`（列定义逼出来的 —— 本仓 55 个 TEXT 列**无一处列宽约束**，
> 故这类实际是「应用层替列定宽」）/ `product`（产品决定）/ `perf`（性能与配额余量）/ `self`
> （说不出外部约束、纯自定 —— 允许存在，但必须承认自己是拍的）。
>
> 为什么要有这张表（一手动因）：`batchUpdateProducts` 与 `batchDeleteProducts` 挂着同一个 200，
> 但前者语句数 = 1 + n（n=200 => 201 条，撞 D1 免费档每调用 50 查询），后者已在 2026-09-18 压成常数
> （受 SQLite 999 绑定参数约束，200 => 400 参数，安全）。
> **同一个数字、两种命运，且没有一处写着它是从哪来的。**

| 文件 | 类型 | 值 | 来源类别 | 依据 |
|---|---|---|---|---|
| functions/_health.js | 截断型 | 7 | perf | 探活响应只回短版本串：slice(0,7) 取 git 短 SHA 长度，避免把完整 SHA 或异常长值塞进高频探活响应体 |
| functions/lib/actions/ai.js | 分页 | 2000 | perf | aiAdvice 全量取近 N 单做规则兜底分析：2000 = 店内订单量级（实测存量 49 单）约 40 倍余量，取「一次拿完且不打爆行数配额」的上界 |
| functions/lib/actions/ai.js | 截断型 | 40 | product | 匿名访客标识 pub-<ip 前 40> ：Dify 侧只需稳定不冲突，40 容得下 IPv6 全文且远小于 Dify 字段上限 |
| functions/lib/actions/orders.js | 常量 | BATCH=200 | perf | recalculateOrders 每页行数（while + LIMIT/OFFSET）：200 行 JSON items 远低于 d1_statement_bytes（100000 bytes/语句），再大就要担心单语句体积撞墙 |
| functions/lib/actions/orders.js | 分页 | 10 | product | 90 s 去重窗内同房间最多取 10 张单做指纹比对：正常连点只产生 1~2 张，10 是同一房间短时间连点的经验上界 |
| functions/lib/actions/orders.js | 分页 | 200 | perf | stalePendingReport 超时单盘点页大小 200：与 BATCH 同值同因，看板一次读完不触发二次分页 |
| functions/lib/actions/orders.js | 截断型 | 200 | schema | remark 入库前截 200 字：schema.sql 里 remark 是 TEXT，全仓 55 个 TEXT 列无一处列宽约束（grep VARCHAR( 命中 0）=> 长度实由应用层定；200 对齐后台备注框可视高度 |
| functions/lib/actions/orders.js | 截断型 | 40 | schema | roomNumber 截 40：幂等键格式「房间号@reqId#指纹」，40 保证键长可控且容得下「楼-单元-房号」最长写法 |
| functions/lib/actions/orders.js | 截断型 | 50 | schema | wechat 截 50：微信号官方上限 5~20 字符，50 给备注型长串留余量，防粘贴整段文本入库 |
| functions/lib/actions/orders.js | 截断型 | 64 | schema | requestId 清洗后截 64：客户端给的是 uuid 形态，64 足够；同处已剔除非 [\w:.-] 字符，防用户输入直接进索引列 |
| functions/lib/actions/orders.js | 拒绝型 | 800 | platform | 付款截图 base64 长度上限 800 * 1024 字符（约 600 KB 原图）。登记时核出的真问题：D1 单语句上限 d1_statement_bytes = 100000 bytes，600 KB 的参数会先撞平台预算再撞这条应用层校验 => 该值形同虚设，已登记第十七轮 M5 待修 |
| functions/lib/actions/orders.js | 体积型 | 800 | platform | 800 * 1024 字符，对照 d1_statement_bytes：本行如实记「应用层体积与平台单语句 100 KB 未对齐」，不当已论证处理 |
| functions/lib/actions/products.js | 分页 | 1000 | perf | 全量取商品 1000 行：店内 SKU 量级（实测 54）20 倍余量，1000 行窄字段远低于 100 KB/语句 |
| functions/lib/actions/products.js | 分页 | 200 | perf | 分类下商品预览 200：后台单分类可见上界，超出即应搜索而非继续翻 |
| functions/lib/actions/products.js | 截断型 | 20 | product | 口味 label 截 20 字：SPEC_OPTION_LIMIT=20 管个数、20 字管单条宽度，两者合起来让后台口味 chips 不换行 |
| functions/lib/actions/products.js | 常量 | BATCH_UPDATE_MAX=40 | platform | 本轮由 200 改为按 d1_queries_per_invocation_free 推导：本 action 语句数 = 1 + n（第十四轮实测斜率 1），40 => 41 条 < 50，留 9 条给鉴权/限流/审计；前端 BATCH_UPDATE_CHUNK 必须等值，由 tests/batchChunkContract.test.js 钉住 |
| functions/lib/actions/reviews.js | 分页 | 1000 | perf | 评价全量导出 1000 条：与商品导出同族上界 |
| functions/lib/actions/reviews.js | 分页 | 500 | product | 单商品评价展示 500：顾客端评价区上限，超出走「没有更多」 |
| functions/lib/actions/reviews.js | 截断型 | 20 | schema | 评价用户名截 20：微信昵称常见长度上限 |
| functions/lib/actions/reviews.js | 截断型 | 500 | schema | 评价正文截 500 字：UGC 入库长度上界，防长文撑爆列表（TEXT 无列宽约束，同 orders.remark） |
| functions/lib/actions/reviews.js | 拒绝型 | 3 | product | 每条评价最多 3 张图：产品决定（顾客实拍场景），不是技术约束 |
| functions/lib/actions/reviews.js | 拒绝型 | 800 | platform | 评价图 base64 上限 800 * 1024 字符，同 orders.js 付款截图：同样落在 d1_statement_bytes（100000）之外，见第十七轮 M5 |
| functions/lib/actions/reviews.js | 体积型 | 800 | platform | 对照 d1_statement_bytes：与平台单语句预算未对齐，记为待修而非已论证 |
| functions/lib/actions/stats.js | 分页 | 1000 | perf | 看板聚合取数上界 1000 行/查询：与商品导出同族 |
| functions/lib/actions/stats.js | 分页 | 5000 | perf | 订单趋势聚合 5000：看板一次算完 30 日曲线不做分片，5000 是当前量级乘百倍余量，超出即须改为 SQL 侧聚合 |
| functions/lib/actions/stats.js | 截断型 | 10 | product | Top10 榜单截 10：看板卡片高度决定的展示上界 |
| functions/lib/actions/submissions.js | 分页 | 1 | perf | 取单条详情用 LIMIT 1：语义就是只要一行 |
| functions/lib/actions/submissions.js | 分页 | 500 | product | 服务申请列表展示 500：后台一屏可滚上限，超出需筛选 |
| functions/lib/actions/submissions.js | 截断型 | 200 | schema | 表单备注类字段截 200：与 orders.remark 同族（TEXT 无列宽约束） |
| functions/lib/actions/submissions.js | 截断型 | 50 | schema | 联系方式/姓名等短字段截 50：与 orders.wechat 同族 |
| functions/lib/actions/submissions.js | 拒绝型 | 2 | product | 每条服务申请最多 2 张图：产品决定 |
| functions/lib/actions/submissions.js | 体积型 | 2 | platform | 2 * 1024（KB 口径）图体量上限：对照 d1_statement_bytes 须先统一量纲（KB→bytes→base64 膨胀 4/3），本轮如实登记为待核而非已论证 |
| functions/lib/actions/products.js | 常量 | BATCH_DELETE_MAX=200 | platform | 删除件语句数是常数（1 存在性 + 1 批量删），受的是 sqlite_bound_params（999 绑定参数/语句）：N=200 => 单语句 200 参数，余量充分。与上面 40 不同值是有原因的，不是笔误 |
| functions/lib/dify.js | 截断型 | 3 | product | 给 Dify 的规则问答取前 3 条命中：提示词实测够用的最小值 |
| functions/lib/dify.js | 截断型 | 5 | product | 给 Dify 的商品候选取前 5 条：导购一轮推荐的产品上界 |
| functions/lib/security.js | 保留期 | 90 | product | security_events 保留 90 天后裁剪：审计留痕窗口为安全侧拍定，配合 5% 概率裁剪控表体积（2026-08-28 注释） |
| functions/lib/security.js | 截断型 | 16 | schema | IP/指纹派生短字段截 16：够放 IPv4 全文 |
| functions/lib/security.js | 截断型 | 500 | schema | detail 列截 500：审计明细上界，防一条异常长串把表撑大（TEXT 无列宽约束） |
| functions/lib/security.js | 截断型 | 64 | schema | keyFingerprint 相关串截 64：哈希/uuid 形态长度，与 orders.requestId 同族 |
| functions/lib/security.js | 截断型 | 8 | schema | 结果码/前缀类短字段截 8 字：与同文件 detail 截 500、fingerprint 截 64 同族，审计表列宽由应用层自定 |

| src/auth.ts | 常量 | BATCH_UPDATE_CHUNK=40 | platform | 前端批量改价分片大小，必须等于服务端 BATCH_UPDATE_MAX=40（那边按 d1_queries_per_invocation_free=50 推导：语句数 1+n ⇒ 41<50）；两侧等值由 tests/batchChunkContract.test.ts 钉住 |
| src/components/admin/ProductInlineEditForm.tsx | 截断型 | 9 | product | 商品图册保存前只提交前 9 张：一屏约 3×3，再多没人翻到。**第三十五轮起服务端 createProduct/updateProduct 对 >9 直接拒（too_many_images）**，前端截断不再独自承担上限 |
| functions/lib/actions/submissions.js | 拒绝型 | 5 | product | 第三十五轮补的服务端条数 cap，与 ServiceFormPage 的 ≤5 同值（此前只有前端有 cap，直接 POST 可塞任意多张）。不用 d1_statement_bytes 反推：线上实测单条提交 images 最大 442KB（本文件 :37 注释）仍写成功 ⇒ 100KB 只管语句文本、不含绑定参数，拿它当图片上限会得出错误结论 |
| functions/lib/actions/products.js | 拒绝型 | 9 | product | 第三十五轮补：与 ProductInlineEditForm 的 slice(0,9) 同值。服务端从"只查 scheme"升到"也查条数"，两处出口（createProduct/updateProduct）同笔加，缺一侧就会被另一侧绕过 |
| functions/lib/actions/orders.js | 常量上限 | BATCH | perf | 全表扫描的分页批大小（定义 :304 = 200）；`rows.length < BATCH` 只是"取到底了"的提前退出，不是用户可感上限 ⇒ 记 perf 不记 platform |
| functions/lib/actions/products.js | 常量上限 | BATCH_UPDATE_MAX | platform | 定义 :153 = 40。更新链是 1+n 条语句（第十四轮实测斜率），n=40 ⇒ 41 条，压在 d1_queries_per_invocation_free（免费档 50 查询/调用）之内；与下面 200 不同值是有原因的，不是笔误 |
| functions/lib/actions/products.js | 常量上限 | BATCH_DELETE_MAX | platform | 定义 :174 = 200。删除件语句数是常数（1 存在性 + 1 批量删），受的是 sqlite_bound_params（999 绑定参数/语句）⇒ 单语句 200 参数，余量充分 |
| functions/lib/actions/products.js | 常量上限 | SPEC_OPTION_LIMIT | product | 定义 :88 = 20，一条商品的可选口味上限（后台一屏药丸按钮的可视容量 + 订单快照 spec 串长度一起定的）。第三十六轮才进普查面：右侧是常量名，旧「拒绝型」形状只认数字 ⇒ 这条以前结构性隐形 |
| src/components/admin/ProductInlineEditForm.tsx | 常量上限 | SPEC_OPTION_LIMIT | product | 同一上限的前端侧（定义 :10 = 20）。两条构建链不能共享模块 ⇒ 常量必然双写，同值由 tests/limitCapParity.test.ts 钉住（改了任一侧另一侧不跟 ⇒ 契约红） |
| src/components/product/ReviewForm.tsx | 常量上限 | MAX_REVIEW_IMAGES | product | 前端评价张数上限（定义 :14 = 3），必须等于服务端 reviews.js 的 `clean.images.length > 3`。第十八轮的教训：当时前端与文案都是 5、服务端退 3 ⇒ 顾客照屏上指示操作必然失败 |
| src/db/orders.ts | 常量上限 | PAGE_SIZE | perf | 定义 :89 = 100，订单增量拉取的页大小；`rows.length < PAGE_SIZE` 是停止条件而非业务上限（与 OrdersTab 的 UI 分页 20 是两个不同的数，别混） |
| src/components/admin/ProductInlineEditForm.tsx | 截断上限 | FLAVOR_MAX_LEN | product | 口味名输入截到 20 字（定义 :11，输入框 `maxLength` 同用这个常量）。对侧是服务端 `sanitizeSpecOptions` 的 `slice(0, 20)`（products.js:96）——**前端常量、后端字面量**，以前两侧都扫不到；同值由 tests/limitCapParity.test.ts 钉住 |
| src/components/product/ReviewForm.tsx | 截断上限 | MAX_REVIEW_IMAGES | product | 批量压缩选图并入时按上限截断（:41 与 :42 两处，同一常量）。值必须等于服务端 reviews.js 的 `> 3`，否则"选了 4 张只留 3 张"与"整条被退"两种命运取决于哪侧先跑 ⇒ 契约见 tests/reviewImageCapContract.test.ts |
| src/components/DashboardTab.tsx | 截断型 | 10 | product | 看板"日期"标签取 ISO 串前 10 位（YYYY-MM-DD）：日历日粒度，不是容量上限；与 src/localStore.ts 的 date 同源同形 |
| src/components/OrdersTab.tsx | 截断型 | 10 | product | 导出 CSV 文件名里的日期戳截 10 位（YYYY-MM-DD）：命名粒度，不参与数据裁剪 |
| src/components/product/ProductGallery.tsx | 拒绝型 | 1 | product | 不是容量上限，是"有没有第二张"的可用性阈值：>1 才渲染上一张/下一张箭头。登记它的唯一目的是让普查面不留洞 |
| src/components/product/ProductGallery.tsx | 拒绝型 | 2 | product | 同上阈值的反向写法（<2 时禁用滑动切换）。两张图以下退化成单图展示 |
| src/components/product/ReviewForm.tsx | 常量 | MAX_REVIEW_IMAGES=3 | product | 评价配图张数上界，必须等于服务端 reviews.js 的 >3；第十八轮把 src/ 纳入普查面时才发现前端写 5、文案也印"最多 5 张" ⇒ 顾客按提示选到第 4 张整条被退回。等值由 tests/reviewImageCapContract.test.ts 钉住 |
| src/components/product/ReviewForm.tsx | 拒绝型 | 2 | product | 与下面「体积型 2」同源：`dataUrl.length <= 2 * 1024 * 1024` 被拒绝型形状按第一个数字切中，不是独立上限。记在这里是为了让形状重叠这件事本身可见，而不是悄悄调正则把它藏掉 |
| src/components/product/ReviewForm.tsx | 体积型 | 10 | product | 原图文件大小门槛 10MB：超过就不进压缩队列（再压也压不进 base64 上传），前端侧决定，服务端不重复查原图体积 |
| src/components/product/ReviewForm.tsx | 体积型 | 2 | product | 压缩后 dataUrl ≤2MB 才保留：与服务端 submissions 侧 2 * 1024 * 1024 同值同因（Reviews 侧服务端是 800*1024 字符，见第十七轮 M5 未对齐项） |
| src/components/product/ReviewList.tsx | 截断型 | 10 | product | 评价日期展示 YYYY-MM-DD：与 DashboardTab 同形同因 |
| src/components/product/ReviewList.tsx | 截断型 | 5 | product | 评价列表每张卡最多渲染 5 张缩略图。**注意**：提交侧上限是 3，展示侧留 5 是给历史数据（早期前端允许 5）留可视面，不是新的写入许可 |
| src/components/ProductsTab.tsx | 截断型 | 2 | product | 行内分类标签最多显示 2 个（"饮品 · 低糖"这种），多了把行撑爆；数据侧不裁剪，仅展示 |
| src/components/ReviewsTab.tsx | 截断型 | 10 | product | 后台评价表日期列 YYYY-MM-DD：与 DashboardTab 同形同因 |
| src/db/orders.ts | 常量 | MAX_PAGES=20 | perf | 管理端增量拉单最多 20 页（每页 100 ⇒ 2000 单）：防服务端 hasMore 异常时前端死循环；店内订单量级实测 49 单，20 页是 40 倍余量的硬止损 |
| src/db/orders.ts | 截断型 | 64 | schema | requestId 送服务端前截 64：与服务端 orders.js 的 requestId 截 64 同值同因（uuid 形态），防粘贴长串进幂等键 |
| src/localStore.ts | 截断型 | 10 | product | 本地演示模式评价日期 YYYY-MM-DD |
| src/localStore.ts | 截断型 | 5 | product | 本地演示模式每张评价最多存 5 图：与 ReviewList 展示侧同值（写入侧真实上限已收敛成 3，见 MAX_REVIEW_IMAGES） |
| src/localStore.ts | 截断型 | 500 | schema | 本地演示模式评价正文截 500 字：对齐服务端 checkPublicText(clean.text, 500)，两侧不一致会出现"云端收、本地丢一半" |
| src/pages/CustomerPage.tsx | 截断型 | 5 | product | 搜索建议下拉最多 5 条：再长就超出下拉可视区，且顾客本可以直接回车进结果页 |
| src/pages/OrderConfirmPage.tsx | 体积型 | 5 | product | 付款截图原图 ≤5MB 才进压缩：下单必附凭证的场景实拍常见 2~4MB，5MB 是"明显误传大文件"的分界 |
| src/pages/ServiceFormPage.tsx | 拒绝型 | 5 | product | 服务提交图片总数 ≤5 张：产品决定。**第三十五轮起服务端 createSubmission 同值拒绝（too_many_images）**，这一行不再是全链唯一 cap ⇒ 两侧同值的契约已成立 |
| src/pages/ServiceFormPage.tsx | 体积型 | 10 | product | 单张原图 ≤10MB 门槛：与 ReviewForm 的 10MB 同因（压不动就别上传） |
## 平台档位假设（C6 读取本节）

- 当前档位登记：**Free** ⇒ D1「每调用查询数」预算取 `d1_queries_per_invocation_free = 50`。
- 为什么必须登记：Free 50 与 Paid 1000 差 20 倍，同一个上限在一个档位下安全、在另一个档位下必然半途抛错。
- 本仓无 Cloudflare 凭据 ⇒ 判不出实际档位，按**最坏情况（Free）**设防；改档位时须同步复核 
  `BATCH_UPDATE_MAX`（当前 40 由 50 推导）与所有 `platform` 类登记行。
- 未登记本节 ⇒ `npm run verify:limits` 的 C6 判红（引用了档位相关事实却不写取哪个数）。
