# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

## [未发布]

### 2026-09-25 追加十七（order 20 生产品名去促销语：一次带双向空跑的生产写）

- **改了什么**：`UPDATE products SET name='猎兽功能饮料' WHERE "order"=20` —— 线上正式品名原为「猎兽功能饮料（亏本卖）」，促销语进了品名，会被阶段二的大图卡片放大展示。只动 `name`。
- **为什么不能走 seed**：`src/data/products-seed.ts:61` 的 name 本来就是干净的，但 `price` 是 2.33，而生产 `price=1.5` 是真实售价 —— 任何"用 seed 重灌"都会把售价改错，所以这次是一次**只动名称的受控写**。
- **写入过程**：先只读回捞原值（`_id=p020, name='猎兽功能饮料（亏本卖）', price=1.5, enabled=1`）→ 落 `db/adhoc-rename-order20.sql` 与 `db/rollback-rename-order20.sql`（沿用仓内既有 `migrate-*/rollback-*` 成对约定）→ 在**本地 D1 副本**上双向往返空跑（改→新名、滚→原名，price 两次都仍 1.5）→ 才 `--remote` 执行。
- **空跑抓到的自己的错**：第一次 rollback 空跑 `exit 1` —— 我当时只在计划里写了"回滚文件先落盘"，实际根本没建那个文件。**先写后验**这条纪律在这里救了一次：否则直到真出事要回滚时才会发现回滚是空的。
- **复验**：`total=55`（行数未变）、`name LIKE '%猎兽%'` 命中数 `=1`（无越界改行）、`n20='猎兽功能饮料'`、`p20=1.5`、`e20=1`；顾客端实际调用的 `POST /pub getPublicProducts` 返回 `{"name":"猎兽功能饮料","price":1.5}`（28 件上架数不变）—— 名称运行时取自 D1，**无需重新部署即已对外生效**。
- **过程中的工具坑（观测为真、成因未定，勿当规律引用）**：一次 `grep -n "猎兽" src/data/products-seed.ts` 返回 0 命中，而紧随其后用 ASCII 模式（`order: 20` 加 `-B4`）看到该串确实在第 61 行；事后再单独复跑同一条中文 grep 又正常命中（rc=0）。**即这是一次未归因的偶发空结果，不是"中文 grep 必然失效"的稳定规律**（成因候选：多字节模式经工具链传输被截断，未证实）。可复用的结论只有一条判据：**任何以"0 命中"为前提的结论，必须换一个 ASCII 锚点复核后才允许下**，尤其是中文模式与 `| head` 组合时（管道还会顺带吃掉退出码，见坑 #9 同源）。

### 2026-09-25 追加十六（阶段二三项遗留的处置：图区统一底板 / 商品地址跨环境可寻址 / 品名促销语）
- **① 素材底色不一致 → 纯 CSS 统一图区**：新增 `.gallery-figure`（中性暖灰 `#f6f5f2` 底板 + 顶部高光 + 底部内阴影），图片改 `mix-blend-mode: multiply`。原理是白底素材的白色部分与底板相乘后等于底板色，白边直接消失；深色/场景底素材则被同一块台面"接住"，不再形成硬边黑方块。实测截图确认整排卡片明度基调一致，且**未裁切任何包装信息**（仍 `object-contain`）。代价是极暗素材略微更沉，换来整排一致性。新增一条视觉判据钉住"全站共用同一块底板 + 图片确实参与 multiply"，防止以后被改回逐卡 `bg-white`。
- **② `/product/p_16` 线上打不开 → 三级寻址**：`_id` 命名按数据来源不同（本地模式 `p_<order>`、D1 种子 `p001` 三位补零、管理端新建 `p_<36时间戳><随机>`），从某一环境复制出的链接在另一环境必然 404。`ProductDetailPage` 的寻址改为：① `_id` 精确 → ② `order` 十进制串 → ③ **仅当形如 order 时**归一（`p16`/`p_16`/`p-16`/`p016`/零填充裸数字）。
  - **第 ③ 级必须收窄，不能一律剥非数字**：`p_mufyndudcyu1ji` 剥掉非数字会得到 `"1"`，若直接按它匹配会**静默渲染出 order 1 的另一个商品** —— 比干净地报「商品不存在」糟糕得多。已加一条反向用例专门钉这个：目录里同时放 order 1 与 order 12，喂随机 id 必须落到「商品不存在」，两个商品都不许出现。这条用例对"朴素剥数字"实现是**会失败**的，属真回归锁。
  - 归一在第 ① 级之后才生效，所以同环境内的正常链接（商城卡片、相关推荐都由 `product._id` 生成）行为完全不变。
- **③ `order 20` 品名含促销语「（亏本卖）」→ 本轮不改，只登记**：这**不是前端能修的**，也不是 seed 能改的 —— 实测线上该行 `name='猎兽功能饮料（亏本卖）'`、`price=1.50`，而 `products-seed.ts` 是 `'猎兽功能饮料'`、`2.33`。**D1 与 seed 在名称和价格两处都已漂移，且线上价格才是实际在卖的价格**。用 seed 去"纠正"线上会把真实售价改错，属数据破坏。
  - 正确路径是一次受控的生产库更新：`UPDATE products SET name='猎兽功能饮料' WHERE "order"=20;`（**只动 name，绝不动 price**）。按项目红线，任何 `d1 execute` 前必须先加载 `chaoshi-web-deploy` skill，且这是对在营门店商品记录的写操作，**等用户明确点头再执行**，本轮不擅自写生产库。
  - 前端侧已做的兜底：卡片品名是 `line-clamp-2`，长名会折两行而非撑破卡片，不会把网格挤坏。
- 用例 551 → **560**（`+` 归一参数化 7 例、随机 id 反向锁 1 例、裸数字命中 1 例）；`test:visual` 15 → **16**。覆盖率 statements 77.1%、branches 70.9%、functions 72.8%、lines 78.6%，棘轮 76/70/72/78 未动。
- 门禁：`npm run verify` 全链绿、`test:visual` 16/16、`test:e2e` 20/20。**后端与数据层零改动**（本文件 ③ 项只是登记待办，未执行任何 D1 写）。

### 2026-09-25 追加十五（/shop 阶段二「暖白画廊」：图片当主角，两端各自设计）
- **主张**：把商城从"带小图的清单"改成"图注式画廊"。旧卡是 56px 缩略图 + 文字横排，图只是个符号；新卡 1:1 满幅白底图占卡片约七成高度，文字退成图注。用户口径为「大改视觉风格 + 两端各自设计 + 连带详情页」。
- **两端各自设计，且是 JS 条件渲染不是 CSS 隐藏**：手机（<1024）顶部横条 + **双列**大图；桌面（≥1024）**左侧竖排分类栏 + 刊头 + 四列画廊**。沿用详情页那条已验证教训 —— 同名操作在 DOM 里留两份会让读屏念出重复主操作、Playwright 严格模式直接失败。断点判定抽为 `src/hooks/useMediaQuery.ts`（详情页的本地 `useIsNarrow` 一并迁入，两页共用一份实现）。
- **一个由真实数据逼出来的设计决定**：上架 28 件里「农夫山泉矿泉水」和「怡宝矿泉水」**各出现两次，只有 `spec` 能区分**（1.5L vs 550ml / 2.08L vs 550ml）。所以规格从旧版的品名括号附注**提升为独立一行**，并加一条视觉断言钉住"规格不得退回括号"。
- **修掉一个真实的对比度缺陷**：价格原先用 `brand-600` (#ca8a04)，对白底只有 **2.82:1**，连 AA 大字标准 3:1 都不过。改 `brand-700` (#a16207) 后 **4.79:1**，正文级也达标；商城与详情页两处价格同步改，并新增机器判据（读实际计算样式算相对亮度，不靠肉眼）。
- **顺手修掉阶段一列过但当时没动的 G2 面包屑**：详情页原先硬编码「首页 › 生活 › 零食饮料」，而 `categories` 早就加载了却没用。改成按商品真实分类派生后，实测 order 16 → `首页 › 饮品 › 提神`、order 24 → `首页 › 饮品 › 矿泉水`，两级链接直接指向阶段一做好的 `/shop/:categoryId/:subId` 深链 —— **面包屑第一次真的能点回去**。生产构建产物里 `零食饮料` 字符串命中数归零。
- **测试契约的刻意变更**（不是回归）：`productDetailVariants.test.tsx` 面包屑断言由 `['/', '/category/life', '/shop']` 改为 `['/', '/shop/drinks', '/shop/drinks/energy']`，并反向断言 `零食饮料` 不再出现；`e2e/product-detail.spec.ts` 那条「可导航回 生活 › 零食饮料」改为验证真实分类 + 落地后子类筛选按钮 `aria-pressed=true`（防止深链跳过去却没过筛）。
- **补了一个"判据假安全感"的洞**：jsdom 没有 `matchMedia`，`useIsNarrow()` 恒为 false ⇒ 原 548 条用例**全部只跑到桌面那一套 JSX，手机端布局零覆盖**，而这个项目的主战场恰恰是微信内手机。新增 3 条打桩 `matchMedia` 的窄屏用例（无桌面刊头、只有一个导航实例、双列网格、子类滑轨全量渲染）。
- **我自己写错又改掉的一条判据**：桌面侧栏"不喧宾夺主"最初写成 `nav.width < firstCard.x * 0.6`，但 `firstCard.x` 含页面左内边距，等于把 padding 算进侧栏宽度（实测 208px 侧栏在 1440 屏只占 14%，却被判失败）。改为直接量侧栏占视口比例 `< 25%`。**这是改判据不是放宽判据** —— 原度量本身是错的。
- 用例 548 → **551**；覆盖率 statements 77.04%、branches 70.86%、functions 72.77%、lines 78.59%（棘轮 76/70/72/78 未动，四项仍在上）。
- 门禁全绿：`npm run verify` 全链、`test:e2e` 20/20、`test:visual` **10 → 15** 例（新增 5 条 /shop 判据：桌面并排、手机双列无溢出、平板三列、价格对比度过 AA、同名商品靠规格可区分）。**后端与数据层零改动**。
- **遗留（如实记，未处理）**：新画廊把**素材底色的不一致**放大了 —— 部分商品图是白底抠图（熊博士、好多鱼、彩虹糖），部分是深色或场景底（士力架黑底、乐事深灰底、呀土豆红底、卫龙木纹），四列并排时深浅方块交错。这是商品图本身的问题而非布局缺陷，`object-contain` 无法在不裁切包装信息的前提下统一它。要根治只能换白底抠图素材或做统一底板，属阶段三候选。

### 2026-09-25 追加十四（商品名错别字修正 + 纠正上一条对线上数据的误判）
- **错别字**：`src/data/products-seed.ts:88` 「光头**哇**一根葱」→「光头**娃**一根葱」。依据是本轮搜图时拿到的实物包装图，袋上印「光头娃」注册商标。以 seed 文案去搜会漏，以包装实际字样才搜得到。
- **`db/seed.sql` 未同步改**：该文件由 `db/gen-seed.mjs` 生成且**早已过期**（`_id` 用 `p001` 三位补零、缺 order 53–54），单独手改一行只会让它与 seed.ts 的偏差更难察觉。要重生成就得整文件重生，属另一件事，本轮不动。
- **线上同名行未改**：D1 里 `p041` 的 name 仍是「光头哇一根葱」，改它是一次**生产库写入**（须先加载 `chaoshi-web-deploy` skill）。且该商品 `enabled=0` **已下架**，顾客端看不到，所以本轮不单独为它跑一次生产写，留待与后续批量数据整理合并。
- **⚠️ 纠正追加十三里我的一处误判**：追加十三之后我在会话中一度报告「线上从 49 个商品掉到 28 个，疑似数据漂移」——**该说法错误**。实测 `_backup/d1/supermarket-2026-09-24-round2.sql`：products 表共 **55 行、order 1~55 无缺口，其中 `enabled=1` 28 行、`enabled=0` 27 行**。那 27 个「线上查不到」是**主动下架**，不是数据丢失。教训：`/pub getPublicProducts` 的 SQL 带 `WHERE enabled = 1`，**用它反推"商品不存在"必然得出错误结论**，判断存在性必须看全量转储或管理端 `getProducts`。
- **该误判对追加十三的直接影响（如实记账）**：本轮替换的 9 张图里，`9 13 21 36 41 54` **六个对应商品均已下架**，顾客端当前看不到；真正线上生效的只有 `6 17 53` 三张。图本身仍是净收益（换成了规格体检通过的干净单件图，重新上架即可用），但**追加十三「商品图治理」的实际对外效果被高估了**，在此更正。
- **两个待办的收敛**：`order 51`（东鹏补水啦 900ml）经查 D1 `enabled=0` 已下架，**无需再找图**，该待办关闭；`order 20`（猎兽，上架，线上商品名为「猎兽功能饮料（亏本卖）」）三轮共 24 张候选全部为手持实拍/背标成分表/「100%赢现金红包」促销图/标签展开图，**全网确无干净白底素材**，维持原图。
- 门禁：`npm run verify` 全链绿（seed 商品名变更不影响 `variants.test.ts` 的逐字段对账，该组断言覆盖的是 order 16-18/1-6/24/27/25/29/46/47，不含 41）。

### 2026-09-25 追加十三（商品图治理：11 张问题图重做 9 张，检索链路换源后跑通）
- **问题重新定性（比"水印"更严重）**：逐张目检 11 张后确认，真正的对外风险只有 2 张竞对平台标识（`6` 京东狗+「近30天官方直补超低价」、`36`「苏宁超市 suning.com」）；**占多数的是「图文与售卖单位冲突」6 张** —— 图上印着 `500ml*15瓶`/`1L*12整箱`/`到手共4瓶`/`12瓶`，而商品按单件 ¥2.33~4.88 售卖，顾客看图无法判断买的是箱还是瓶。这属于"文案与实际行为一致"的违反，优先级高于美观。余 3 张（`13/20/41`）是品牌自家广告语，无单位冲突。
- **纠正一条错误记录（追加不改写，故在此更正）**：追加十一第 21 行称「仓库 `public/images/` 那 55 张是商家自拍实拍图」——实测不成立。抽查 5 张即见 `6` 带京东促销横幅、`36` 带苏宁水印、`20` 是带「可口可乐」logo 的品牌海报、`41` 带「色泽金黄 清新诱人」广告语。这批图本身即取自别家电商详情页，**版权暴露早于"再去找图"**。原文保留不改，因其在记录当时为撰写者的真实认知。
- **换检索源后跑通**：追加十一放弃联网搜图，是因为只试了 Wikimedia Commons（只命中街拍）与通用检索（全是素材站）。本轮改走 `chaoshi-image-optimization` Step 3 的**必应图片 `murl` 提原图**链路，实测每个商品可取 8 张 ≥750px 候选，其中确有干净的单件白底图。
- **规格体检拦下 4 类串图（缩略图上看不出来，必须全尺寸读净含量）**：① `9` 首轮最佳候选放大后是 **250ml**（商品 500ml），换关键词重搜第三轮才拿到 500ml 版；② `6` 候选标 `330ml*6瓶`、`54` 候选标 `330ml*6瓶`、`51` 候选标 `555ml`——同品牌同口味不同规格；③ `36` 候选是「浓香茄汁味」（商品是蜜香鸡翅味）、`54` 两条候选串成「茉莉**清**茶」（那是 order 53）、`9` 候选串成「康师傅 蜜桃乌龙茶」（品牌都不对）；④ `41` 有 3 张是**另一个厂家「甘师傅」的一根葱**（同品名不同厂）。
- **竞对平台标识做进检索层**：候选过滤直接拉黑 `suning` / `360buy` / `imgservice.suning.cn` 等 host，`6/9/53` 三处命中被自动排除，不再依赖事后目检兜底。
- **结果**：11 张中 **9 张已替换**（`6 9 13 17 21 36 41 53 54`），全部经全尺寸体检确认品牌/产品线/口味/净含量与 `products-seed.ts` 的 `spec` 逐字一致。**`20`（猎兽）与 `51`（东鹏补水啦 900ml）两轮检索仍无合格候选**——猎兽全网只有手持实拍与背标成分图，补水啦主流素材是 555ml/1L 且普遍带「¥34.95 起」「多种口味畅快补水」等广告构成，**按"宁可保留现状也不引入错图"原则维持原图**，不降级用生成图顶替。
- **产物口径**：新源图统一 `scale=800:800:force_original_aspect_ratio=decrease` + 白底 pad（**只缩不放**：`9`/`54` 原生 658px 保留原生清晰度补边，不放大），整图 `-quality 80`、`sm/` 400×400 `-quality 75`，与既有 corpus 实测参数（顶层全 800×800 VP8、`sm/` 全 400×400）对齐。
- **回滚**：9 张旧图含 `sm/` 副本共 18 个文件已移出 `public/`，落在 `archive/images-replaced-2026-09-25/`（`{order}_old.webp` + `sm/sm_{order}_old.webp`）；`public/` 内不留 `_old` 副本（否则零引用旧图照样被打包分发）。
- **顺带发现的数据质量问题（未改，待裁决）**：`products-seed.ts` 的 order 41 写作「光头**哇**一根葱」，包装实物印的是「光头**娃**」——商品名错别字，会直接影响顾客搜索命中。
- 门禁：`verify:images` **54/54、100%、0 无效**；`npm run verify` 全链绿（548 用例 / lint 0 警告 / `verify:backend` 102/102）；`test:e2e` 20/20、`test:visual` 10/10。**代码层除追加十二的结构重构外，图片替换本身零代码改动**（URL 由 `order` 派生，换文件即换图）。

### 2026-09-25 追加十二（/shop 阶段一：筛选态收进 URL，顺带修掉「零食页根本没有地址」）
- **范围**：用户点名重构 `/shop`，口径为「分阶段全要 / 整个 /shop / 路径参数深链 / 两端各自设计 / 大改视觉」。本条只记**阶段一（结构重构，视觉与下单链路一行未动）**；阶段二（杂志式大图 + 连带详情页）待本阶段复核后另记。
- **根因（不是"代码不好看"，是功能缺失）**：`activeTop / activeSub / search / sortBy` 四个筛选态全散在 `CustomerPage` 的 `useState`，而 `TopNav` 又自存一份 `activeTop`（原 `TopNav.tsx:14`），两边靠 `onTopChange` 单向同步。后果是**「食品›零食」这个页面在网络上根本不存在**——没有地址、刷新即回默认分类、返回丢筛选、无法分享无法收藏。
- **改法**：新增 `src/hooks/useShopFilters.ts`，分类走路径段、搜索与排序走 query（`/shop/:categoryId?/:subId?` + `?q=&sort=`）。`App.tsx` 的 `/shop` 换成 `/shop/:categoryId?/:subId?`，`routeLoaders.ts` / `prefetchBus.ts` 零改动（chunk key 不变）。`TopNav` 改**纯受控**组件，内部 `useState` 删除。
- **归一优先于报错**：URL 是可被手输的，所以三条回落写进 hook 并各配一条用例——未知 `categoryId` 回落第一个分类、不属于该分类的 `subId` 按「全部」处理、非法 `sort` 归零为 `default`。**刻意不渲染空列表**：空列表会被用户读成「这个类没货」，而真实原因是地址写错了。
- **真实缺陷①（潜伏）：loading 期整条分类导航会消失再重新挂载**。`CustomerPage` 的骨架分支传 `categories={[]}`，而 `TopNav` 遇空数组 `return null` ⇒ 数据到达后导航栏重新挂载、选中态归零，用户看到「分类条闪一下跳回第一个」。改为渲染骨架 pill + `aria-busy="true"`。
- **真实缺陷②：页头与导航高亮说的是两件事**。`CategoryPage.tsx:15` 只 `navigate('/shop', { state: { fromCategory: true } })`，**从未传过 `title`**，而页头读的是 `location.state?.title` ⇒ 恒 undefined ⇒ 回落「全部商品」，同时下方 `TopNav` 高亮的是「饮品」。现页头标题直接取 URL 命中的真实分类，并加一条断言钉住「两处文字必须一致」。
- **真实缺陷③：55 个 `aria-live` 区域**。`ProductCard` 每张卡的数量 `<span aria-live="polite">`，加一次购读屏会连播一屏数字。移除后整页收敛到 2 个（结果计数区 + 页面级 toast），并给「减数量」补上此前完全缺失的播报（原实现减数量对读屏静默）。
- **搜索框保留本地编辑缓冲**：直接把受控 `value` 绑到 URL 派生的 `q` 会让中文输入法在组合输入未完成时被回写覆盖而丢字。`draftQ` 只是编辑缓冲，URL 仍是筛选唯一真相，外部改地址（返回键/深链）由 effect 对齐。
- **`FlyDot` 拆出 `src/components/shop/`**（对齐既有 `components/product/` 约定），逐字搬运不改行为。
- **测试契约的刻意变更**（不是回归）：`customerPage.test.tsx` 不再 mock `useNavigate/useLocation`——mock 掉路由就测不到深链，改走真实 `MemoryRouter` + 与生产同形的路由表，「点浮球进购物车」由断言 `navigate('/cart')` 改为断言真路由渲染出购物车页。用例 8 → **16**；新增 `topNav.test.tsx` 8 例（该组件此前**零覆盖**）、`shopFilters.test.tsx` 14 例。
- **后端与数据层零改动**（`functions/`、`db/`、action 契约 23 个均未触碰），`npm run verify:backend` 保持 102/102。

### 2026-09-25 追加十一（「生活 → 零食饮料」两页改造：详情页变体层 + 双栏布局，顺带炸出两个潜伏缺陷）
- **范围**：用户点名「只改生活里的零食页面」，实测入口链为 `HomePage → /category/life → services.ts 的 id=snacks（type=supermarket）→ navigate('/shop') → CustomerPage → /product/:id → ProductDetailPage`；经确认落点为**两个页都改**。全程不接后端、不加登录/支付/数据库，变体走本地演示层。
- **变体层（新增 `src/utils/variants.ts` + `src/data/variants-demo.ts`）**：`pickCombo` 用「硬钉刚改动的轴」而非纯打分——实测反例：白象方便面从「帮泡装+十三香」点「零售装」时，零售装的口味段为空得 0 分、而「帮泡装+十三香」得 1 分，纯打分算法会**把用户刚点的零售装吃掉、悄悄改回帮泡装**。不存在的组合（盒装 500ml）不编造价格，标 `available:false` 并由 `pickCombo` 回落到最近可售项 + `aria-live` 如实播报。
- **诚实性判据上机器**：`tests/variants.test.ts` 有一条反向校验——每个可售组合的 `order/price/productName` 必须与 `products-seed.ts` 的真实行**逐字段相等**，另含「available:false 不得带非零价」「同一 order 不得属两个组」「memberOrder 必须有对应可售组合（否则进该商品详情页选不中自己）」。于是「价格取自真实目录」不再是注释自称。
- **真实缺陷①（潜伏，非本轮引入）：`.tap-44` 写在裸 CSS 区，把 Tailwind 的 `absolute` 顶掉了**。裸 CSS 优先级高于所有 `@layer`，`.tap-44{position:relative}` 因此压过 utilities 层的 `absolute` ⇒ 所有 `tap-44 absolute` 角标按钮退化成流式排布。生产构建实测坐标：轮播 prev/next 落在 (288,533) 与 (272,565)（`next` 的 x 竟小于 `prev`），且把 group 高度从 420 撑到 484（= 图 420 + 32 + 32，数字自洽）。受影响共 4 处：`ProductGallery` 箭头×2、`ReviewForm` 晒图删除角标、`ServiceFormPage` 图片删除角标。修法＝`.tap-44` 收进 `@layer components`，修完 prev/next 回到 (288,323)/(708,323)、`position: absolute`、group 高 420。已加常驻回归锁。
- **真实缺陷②：详情页 `selection` 用独立 effect 事后回填 ⇒ 首帧规格全未选中**。表现为「进页面时规格闪一下才跳成正确值」；单测里以「瓶装 aria-pressed 期望 true 实为 false」暴露。改为派生（`selectionOverride ?? initialSelection(group, orderNum)`）并把瞬时态重置并入 `load()` 与 `setProduct` 同批更新，effect 删除。
- **e2e 结构性发现（决定验收怎么跑）**：`index.html` 的 CSP 是 `style-src 'self'`，**dev 模式下 Vite 用 `<style>` 注入 CSS 会被整块拦掉 ⇒ 页面完全无样式**，所以双栏并排/焦点环/响应式重排这类几何判据在既有 dev harness 里结构上不可能通过（实测 1440 下信息栏 x=8，两栏退化成堆叠）。据此拆两套：`tests/e2e/product-detail.spec.ts` 跑 dev 只测与 CSS 无关的行为；新增 `playwright.visual.config.ts` + `tests/e2e-visual/layout.spec.ts` 跑**生产构建**（CSS 出独立文件，`style-src 'self'` 放行）测几何，脚本 `npm run test:visual`。同时证实 React 走 CSSOM 写内联样式不受该 CSP 影响（色块 `rgb(76,122,52)` 在 dev/prod 都真）。
- **详情页改造**：桌面 `lg:grid` 双栏（左 1.25fr 图集含缩略图列 / 右标题·规格·评分·价格·变体选择·数量·购买入口·配送说明），平板手机单列堆叠。左栏必须加 `lg:items-start`——网格默认 `align-items:stretch` 会把左栏卡片拉到与右栏等高，图片下方留大片空白（截图可见，已加判据 `card < img + 80`）。缩略图列**取代**原匿名小圆点（圆点只能表达"第几张"，缩略图能表达"这是哪个规格"），点缩略图与选规格由同一份 `selection` 双向驱动。新增面包屑（首页›生活›零食饮料，真 `<Link>`）、商品参数 `<dl>`（全真实字段）、配送说明（营业时间取 `utils/businessHours` 真实口径；目录里没有配送时长与起送金额，故**不写具体数字**，只说明以群内约定为准）、售后说明（商家从未提供 ⇒ 整块标「演示文案」+「不构成任何真实承诺」）、同类商品（取真实目录同 subcategory，用 `<Link>` 不用 div+onClick；措辞是「同类商品」而非"爆款/热销推荐"——那需要销量或人工背书，目录里没有）。
- **不要广告框架（用户明确要求）**：无主推/爆款/限时等措辞；不编造销量、评分背书或品牌承诺；演示聚合关系（把目录里多条独立记录聚成同一商品的变体轴）在每个变体组下方以 `disclosure` 如实标注。
- **「立即购买」只弹演示订单摘要**：复用 `Overlay`（焦点陷阱/Esc/滚动锁/焦点归还都是现成的），明确写「不产生真实订单、不发起任何支付」，e2e 断言 URL 不变且 `sm_cart` 未被写入。真实下单链路（购物袋→确认订单→支付）一行未动。
- **加购数量入账修了一个隐患**：`useCart.add` 读的 `cartRef` 在 effect 里才同步，**循环调用 `add()` 加多件只会加 1 件**（第二次读到同一个旧 cart 并覆盖）。改为 `addToCart(cart, product, qty=1)` 一次入账，向后兼容（`CustomerPage`/`CartPage` 的 `add(product)` 调用不受影响）。
- **同名主按钮收敛**：右栏与吸底栏各放一个「加入购物车」时，Playwright 严格模式直接报 4 例既有 e2e 失败（`resolved to 2 elements`），读屏也会读到两个同名主操作。改为**按视口条件渲染**（`matchMedia('(max-width:1023.98px)')`，jsdom 无 matchMedia 时按桌面处理）：宽屏只有右栏那一个，窄屏只有吸底栏那一个。
- **列表页（`CustomerPage`）三处真实缺口**：排序药丸只有 `pill-active` 视觉着色、辅助技术读不到当前排序 ⇒ 补 `role=group` + `aria-pressed`；筛选/搜索/排序改写列表却无任何反馈 ⇒ 新增 `共 N 件` 计数区；商品属于变体组时卡片加「N 种规格」角标（**卡面价仍显示本条记录的真实单价**，不用「¥x 起」——那样点进详情默认选中的正是这一条，价格会对不上）。`TopNav` 经核查语义本已到位（nav 地标 + `role=group` + 全量 `aria-pressed`），未动。
- **测试契约的两处刻意变更**（不是回归）：① `productDetailPage.test.tsx` 的 `¥3.50` 出现次数由 2→3→**2**（吸底栏改条件渲染后 jsdom 里不再出现）；② `productGallery.test.tsx` 里 `container.querySelector('img')` 全部收窄到 `[data-main-image] img`——缩略图列也渲染 `<img>`，原来的宽泛查询会误取缩略图。另：详情页测试补 `getCategories` mock（少一个会让 `Promise.all` 整批抛错被 catch ⇒ 页面直接判「商品不存在」）并加 `MemoryRouter` 包裹（页面开始用 `<Link>`）。
- **官方宣传图这条路查证后放弃（如实记录）**：按"仓库真实图 + 联网官方宣传图"的要求检索，Wikimedia Commons 只命中街拍（电车车身广告、店里摆的瓶子、公交车），通用检索命中的全是素材站（pngsucai / photophoto / aigei / 淘宝列表页 / 百度百科），**无一是品牌官方且可自由使用的来源**，抓进自营商店属于版权负债而非改进。仓库 `public/images/` 那 55 张是商家自拍实拍图，本就是需求里的优先源，故商品图全部维持真实图；仅在图片加载失败的降级占位里加了「示意图 · 非商品实拍」标注（绝不用抽象几何冒充商品照）。
- 用例 453 → **517**（56 → 58 文件：新增 `variants.test.ts` 34、`productDetailVariants.test.tsx` 16、`productGallery` 11→18、`productDetailPage` 15→18、`customerPage` 5→8）；覆盖率四项全部上升 statements 74→**76.5%**、branches 68→**70.67%**、functions 69→**72.09%**、lines 76→**78.14%**；棘轮上调 **76/70/72/78**。另新增 Playwright 用例：功能 e2e 8→**20**、视觉 e2e **9→10**（跑生产构建）。
- 门禁全绿：`verify:backend` 102/102、`npm test` 517/517、`lint`（oxlint --max-warnings 0，185 文件）0 错、`typecheck`（前后端两套 tsconfig）通过、`test:e2e` 20/20、`test:visual` 10/10、`verify:changelog` 本条即为其判据。**后端与数据层零改动**（`functions/`、`db/`、action 契约 23 个均未触碰）。

### 2026-09-25 追加十（对标第七轮：H1 管理端两 Tab + H2 顾客端详情链，覆盖率 74.71%）

- **顺带修掉一个真实缺陷**：`ProductGallery` 在 `gallery` 只有一张图时走的是"按 order 拼路径"的分支，**忽略调用方传入的那张图** ⇒ 商品只挂一张自定义图（`product.images.length === 1`）时详情页显示错图。改为 `singleSrc = gallery.length === 1 ? gallery[0] : imgSrc`，且 `srcSet` 仅在该图确为 order 路径图时才挂（外链/上传图没有 sm/ 版本）。新增用例锁死（`/uploads/real-photo.jpg` 必须赢过 `/images/12.webp`）
- **H1 管理端两大件**（原 44%/48%）：`ordersTab.test.tsx` 16 例（骨架/空态/搜索与状态筛选/分页 20 条一页与边界禁用/合法迁移下拉与终态单选项/状态更新成功-拒绝-抛错三态/删除二次确认与失败/复制文本四要素/CSV 表头与逐商品行 + BOM **字节层**断言）+ `productsTab.test.tsx` 24 例（**批量改价取整口径**：数字=统一价、`33%`=按原价四舍五入到分、非数字拦截且不发请求；部分失败必须 warn 不得吞 failed 明细；未选中不渲染批量栏；新增/编辑一律内联展开且全程 `role=dialog` 为空；含并回的旧 4 例）
- **H2 顾客端与基础设施**：`productDetailPage.test.tsx` 15（骨架语言统一/未找到与接口抛错同一空态/order 与 _id 双寻址/云端+本地合并与低分高分排序/发布后 refreshReviews/云端失败降级/快速切商品 cancelled 守卫/加购与件数）+ `reviewForm.test.tsx` 13（晒图三道闸：张数上限、类型与 10MB、压缩后 2MB；**上传失败不提交评价**）+ `reviewList.test.tsx` 13 + `productGallery.test.tsx` 11 + `overlay.test.tsx` 11（焦点陷阱/遮罩与 Esc 开关语义/滚动锁与焦点归还；jsdom 需把 `offsetParent` 定义为"有父元素即可见"才测得到过滤分支）+ `adminGuard.test.tsx` 11（会话续登三分支/空钥与纯空格/错钥与网络异常文案区分）+ `prefetchBus.test.ts` 10（工厂不覆盖、去重、**失败后撤销标记允许重试**、150ms 与 idle 回退、300ms 错峰）+ `imageCompress.test.ts` 8（横竖图与"只缩不放"、四类失败面）+ `reviewImagesUtil.test.ts` 6
- 用例 319 → **453**（46 → 56 文件：新增 11 个文件，其中 productsTab 与旧 ProductsTab 同名合并为 1 个）；覆盖率 statements 57.25→**74.71%**、branches **68.76%**（双跑 68.71/68.76，差 1 条 5s 轮询时序分支）、functions **69.81%**、lines **76.39%**；棘轮上调 **74/68/69/76**
- **⚠️ 本轮我自己踩到并纠正的回归（大小写文件名冲突）**：新建 `tests/productsTab.test.tsx` 与已存在的 `tests/ProductsTab.test.tsx`（第三轮的 4 条批量操作用例）在 Windows 大小写不敏感文件系统上是**同一个文件**——`Write` 静默覆盖旧内容，`git status` 只表现为 `M` 而非 `??`。发现时已丢 4 例；已把这 4 例（含"部分失败绝不回退原生 alert"这条第三轮不变量）**并入新文件并复跑通过**（该文件 20→24 例，总数由 449→453）。**纪律补一条**：新建测试文件前必须先 `git status`/`ls` 核对同名（大小写不敏感）文件，`M` 状态的"新文件"＝覆盖事故而非新增
- 后端与数据层零改动；`verify:backend` 102/102、契约 44/schema 16/license/changelog 全绿


### 2026-09-24 追加九（**P0 修复**：看板四张图在生产包里静默空白——真库渲染测试把它炸了出来）
- **缺陷**：`useDashboardCharts` 把 9 个 `echarts/lib/chart|component/*` 深路径模块的 `.default` 收进 `core.use([...])`。这些模块是**纯 side-effect 自注册**文件（`line.js` 末尾自己 `use(install)`，全文件零 export），`X.default` 恒 undefined → echarts `extension.js:109 ext.install(...)` 抛 TypeError → 发生在 async IIFE 内且无 catch → **init 链整体中断：四张图永久空白、页面不弹任何错**。实测生产包证据：`dist/assets/line-*.js` 的 module namespace `keys=[] / hasDefault=false`；浏览器内 `import()` 该 chunk 同样拿不到 default
- **影响窗口**：hook 拆分自 2026-09-05（H1-2）起；此前所有单测把 echarts 整包 mock、e2e 又只跑演示模式（demo 下 `getDashboardStats` 无本地实现，看板直接显示"加载失败"），**两层判据都摸不到这段代码**——所以它活了 19 天
- **修复**：9 个模块改为"只 import 不塞 use()"，`core.use([renderers.CanvasRenderer])`（renderers 是唯一只导出不自注册的模块）；并把成因写进代码注释，防止后人"顺手加回 use"
- **判据补三道（缺一都会再犯）**：① 新增 `tests/chartRealRender.test.ts` 用 echarts 官方 SSR（`init(null,null,{renderer:'svg',ssr:true})`）在 node 里**真渲染**，不依赖 canvas/浏览器/密钥，并含一条"深路径模块无 default 导出、仅 import 即注册"的判据自证；② `tests/dashboardChartsHook.test.tsx` 的 mock 改具**真库语义**——`use` 复刻 `ext.install` 校验、9 个深路径 mock 保持"零导出"同形，于是 `X.default` 写法当场炸（原 mock 是空 vi.fn()，正是它掩盖了这个 P0）；③ 新增本地云端模式验收桩 `scripts/local-api-stub.mjs` + `vite.config.stub.js` + `tests/env-stub/.env.stub`（`npm run build:stub && npm run serve:stub`），**假密钥 + 假 /web** 打通"登录→看板→真 echarts 出图"的浏览器路径，绕开"用生产密钥做验收=密钥进日志"的禁忌
- **对照实证（正反例双向）**：同一 harness、同一脚本，修复后构建 → 看板 4 个 canvas（687×392 / 687×308 / 687×392 / 687×448）；回退到 `bcaba62` 版 hook 重新构建 → 已登录、9 个 tab 在、`看板数据加载失败` 未出现，但 **canvas 数 0**（与线上症状完全一致，且控制台无可见报错=当初漏检的原因）
- 顺带定性一条噪声：e2e 里每例打印的 `Applying inline style violates CSP style-src 'self'` 经定位来自 **`@vite/client` 注入的 dev 覆盖层样式**，生产构建页面控制台零消息 ⇒ 顾客端/管理端真实样式不受影响，M4 观察项关闭
- 本轮附带发现（**未修，登记待办**）：演示模式下看板永远显示"看板数据加载失败"——H1-2 把聚合下沉到 `stats.js` 后本地模式没有对应实现。要么补本地聚合（与服务端有漂移风险），要么把错误文案改成明确"演示模式无看板聚合"；后者零风险，待用户裁决


### 2026-09-24 追加七（对标第六轮：图表 option 抽纯函数 + 看板/商品行/评价门面测试，覆盖率 57.25%）
- **F1 小重构（行为不变）**：`useDashboardCharts` 的 4 张图 option 构造逐字段搬到 `src/utils/chartOptions.ts`（主题/动效改为入参，`readChartTheme` 与 `TOOLTIP_BASE` 一并外移），hook 只剩"实例生命周期 + setOption 触发"。**为什么**：原写法只有真挂 echarts/canvas 才走到，等于 4 张图的全部配置零测试；抽出后 chartOptions 与 hook 双双 100% 覆盖
- **F1 新增测试 3 文件 32 用例**：`chartOptions.test.ts`（16：tooltip 运行时 plainText、rangeDays>=90 才挂 dataZoom、TOP 倒序+前 3 名强调色、reducedMotion 关动画、非 hex 变量退兜底色）、`dashboardChartsHook.test.tsx`（6：echarts 全模块 mock——10 个按需模块注册、晚出现容器补建实例、resize 联动、卸载 dispose+监听注销、import 未回即卸载不建实例）、`dashboardTab.test.tsx`（10：KPI/日均/毛利三态/三处空态/区间点击与方向键/CSV 导出 Blob 内容/加载失败两种降级）；DashboardTab 68.83→**92.2%**
- **XSS 静态门禁随重构扩展**：`chartXss.test.ts` 改为**并扫** hook 与 chartOptions 两个文件（只读单文件会让门禁在重构后静默失焦），并补"四张图 tooltip 一个都不能少"计数判据
- **F2 确认/支付页剩余分支 +13 用例**：非营业时间强制下单、空购物车拦截、aria-invalid 与错误节点关联、截图三道闸（未选/超 5MB/压缩失败）、截图随单字段、支付页无单号重定向、sessionStorage 续单号、支付宝提示弹窗、轮询到 cancelled、轮询失败不误报已付、0 金额不渲染价格行；PaymentPage 80→**97.5%**
- **G 批（零成本高价值面）+39 用例**：`productRow.test.tsx`（12，35.71→92.85%：库存角标三态、上下架开关文案与 aria-pressed、内联展开回调时序、键盘等价点击）、`dbReviews.test.ts`（11，src/db/reviews.ts 1.81→100%：字段白名单裁剪、云端失败降级本地、60s 缓存与精确失效、管理端写删抛错口径）、`smallUtils.test.ts`（10，format/images/rovingTabs 全 100%）、`successAndNotFound.test.tsx`（6，成功页复制/查询/跨导航兜底 + 404 页，两文件原 0%）
- 覆盖率 statements 47.63→**57.25%**、branches **53.87%**、functions **50.76%**、lines **59.66%**（313 用例 / 45 文件）；棘轮上调 **57/53/50/59**
- 后端与数据层零改动；`verify:backend` 仍 102/102、契约/schema/license/changelog 全绿、首屏体积 86.4KB 无变化（图表代码在管理端 chunk）、e2e 8/8

### 2026-09-24 追加八（**定性纠偏 + 门禁自修**：CHANGELOG 门禁在 CI 浅克隆里必红）
- **事实纠正（重要）**：上一轮记录的"CI `70ca0b9` completed success"**不成立**——GitHub API 实测 run #114 与本轮 #115 均 `failure`，失败步都是 `CHANGELOG entry gate`。连带后果：70ca0b9/bcaba62 两次 push 的 **pages.dev deploy job 未执行**（生产仍是 6a726ca 的构建；两轮改动均为测试/门禁类，运行时行为无差异，但"已上线"的说法此前是错的）；github.io 的 dispatch 与 CI 相互独立，故顾客端照常构建
- **根因**：`actions/checkout` 默认 `fetch-depth: 1` → CI 里没有 `HEAD~1` 对象 → 门禁的 fail-closed 分支（取不到 diff 就拒绝放行）被浅克隆触发。**本地全历史永远复现不出来**，属"判据自身坏了/环境变了判据没变"同族（R263）
- **两处治本（缺一不算修完）**：① `ci.yml` build-and-test 的 checkout 加 `fetch-depth: 0`（仓库仅 117 提交 / 13MB，成本可忽略），并写明原因；② `check-changelog.mjs` 内置**浅克隆自愈**——缺 rev 时 `git fetch --no-tags --deepen=3 origin` 后重试，仍失败才拒绝，且在拒绝日志里直接指出"给 checkout 加 fetch-depth: 0"
- **对照实证（正反例都跑）**：`git clone --depth 1` 出的浅克隆里，旧脚本 exit 1（原样复现 CI 报错），换上新脚本 exit 0 且历史自动加深到 4 提交；同仓库再造一个"只改 src 不改 CHANGELOG"的提交 → 新脚本仍 exit 1（自愈没有把门禁改成假绿）。临时克隆实测后已删除



### 2026-09-24 追加六（对标第五轮：管理壳/商城页/内联编辑表单测试，覆盖率 47.63%）
- **E1/E2** 新增 3 个测试文件 15 用例（228/228，37 文件）：`adminPage.test.tsx`（tablist 键盘流转、订单增量首拉、商品错误横幅禁静默回退、云端空态种子、本地徽标）、`customerPage.test.tsx`（真实 useProducts/useCart：加载/排序/搜索空态/加购 toast+浮球/错误重试）、`inlineEditForm.test.tsx`（stock '' 不发送、非法值行内拦截、costPrice 归一、create/update 双出口、服务端拒绝行内展示）
- 覆盖率 statements 35.68→**47.63%**、branches 43.52、functions 41.39、lines **50.14%**；棘轮上调 47/43/41/50（双跑数值一致，确定性强）
- **E3 如实顺延**：useDashboardCharts 拉起需 canvas 桩或抽纯函数小重构，性价比让位，仍列 P1
- **F2 CHANGELOG 门禁（同轮直接落地）**：`scripts/check-changelog.mjs`——PR 对目标分支 / push 对 HEAD~1 取 diff，触及 `src|functions` 而 CHANGELOG 无新增内容行 → CI 红；`--relaxed` hotfix 逃生门（warning 留痕）；diff 取不到时**拒绝放行不静默跳过**。正/反例双向实测（反例经临时分支验证 exit 1 后无痕清理）。进 `npm run verify` 链与 CI
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第五轮-2026-09-24.md`；后端/UI 零改动

### 2026-09-24 追加五（对标第四轮：覆盖率破 30% + extraneous 定性纠偏）
- **D1** `src/db` 三门面（orders/products/submissions，含云端失败→持久缓存→本地兜底、离线队列、分页去重、重入锁）+ ReviewsTab/SubmissionsTab 组件测试共 **+18 用例（213/213）**；覆盖率 statements 23.65→**35.68%**、branches **32.47%**、functions **31.04%**、lines **37.43%**，阈值棘轮上调 35/32/31/36
- **D3 结论纠偏（重要）**：清装（`npm ci`）后 `@img/sharp-wasm32` **仍然出现**——它不是"镜像安装残留"，而是 wrangler(dev)→sharp 的**合法 dev 树平台可选二进制**；license 门禁按 `--omit=dev` 生产树过滤的语义因此被实证正确（prod 树 10/10 白名单）。上一轮报告"残留信号弹"的定性作废，以本条为准
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四轮-2026-09-24.md`；后端与 UI 代码零改动（纯测试/配置轮）

### 2026-09-24 追加四（对标第三轮：覆盖率棘轮 + 超时单工作台 + SQL/license 门禁）
- **B4** 页面层测试 +13（OrderQueryPage 6 / CartPage 4 / OrdersTab 超时面板 3；195/195），覆盖率 19.68→**23.65%**（stmts），`vite.config` 阈值棘轮上调 23/21/20/24（只升不降）
- **B5** `stalePendingReport` 接 OrdersTab：超时未确认订单**内联面板**（汇总/占用明细/"已传付款截图"徽标/逐单"取消并释放库存"复用状态机+回补路径；只读密钥静默不显示；遵守禁弹窗铁律）
- **C1** 单 action SQL 语句峰值基线：verify-backend 内置计数器，`docs/sql-baseline.json` 30 action（6 次采样并集；审计/限流写路径 +1 吸收 60s 真实窗分支抖动，读路径精确）——N+1/循环语句回归从此 CI 红
- **C2** `scripts/check-licenses.mjs` 生产依赖 license 白名单（GPL/LGPL/AGPL/SSPL/Elastic 与未知许可一律拦），过滤 extraneous（本机实测揪出历史镜像残留 `@img/sharp-wasm32`，含 LGPL 复合条款但**非 lock 依赖**）；已进 `npm run verify` 与 CI
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第三轮-2026-09-24.md`

### 2026-09-24 追加三（对标第二轮：幂等 / 迁移账目 / 供应链门禁 / XSS 收口）
- **下单幂等（A1）**：`orders.idempotencyKey` + **部分唯一索引**（`WHERE ... IS NOT NULL`，历史单零影响）；键 = `房间号@requestId#fnv1a(载荷指纹)`；不带 requestId 的调用方（顾客端 SW 长缓存下的旧包）走 90s 内容指纹兜底；去重判定在扣库存之前，真并发撞唯一索引时回补本请求库存再返回既有单；响应新增 `deduplicated` 标记。对标纠偏：**litemall 实际没有任何幂等**（`order_sn` 无唯一索引），做幂等的是 Medusa / Saleor
- **状态流转乐观锁（A4）**：`UPDATE ... WHERE _id = ? AND status = 读到的旧值`，并发迁移只有一个胜出，落败方收到"订单已被他人更新，请刷新后重试"；抢占失败时回补"误取消恢复"刚扣的库存
- **超时未支付单只读盘点（A5）**：新增 `/web stalePendingReport`（不进写操作集合）——按账龄列 pending 单、标记是否附付款截图、统计被占用的有限库存。**有意不做**定时自动砍单（本项目线下确认制下 pending 可能是"已转账待确认"），见 `docs/adr/0003`
- **D1 迁移账目与漂移门禁（A2）**：`schema_migrations` 表 + `scripts/migrate.mjs`（`status|apply|baseline|mark`；默认 `--local`，生产须显式 `--remote` 且逐字确认，非交互环境拒执行；checksum 防改历史）+ `scripts/check-schema-drift.mjs`（迁移引入的表/索引/列必须已在 `schema.sql`，未识别 DDL 判 FAIL）+ `db/rollback-*.sql` 回滚脚本；`verify:schema` 已进 `npm run verify` 与 CI
- **echarts XSS 收口（A3）**：`npm audit`（官方源）命中 GHSA-fgmj-fm8m-jvvx（echarts <6.1.0），真实汇点是营收柱 tooltip 把入库文本拼成 HTML → 统一 `renderMode: 'plainText'`（不升 major 版本，理由见 `docs/adr/0004`）；新增 `tests/chartXss.test.ts` 静态不变量断言
- **依赖漏洞审计进 CI**：`npm run audit:deps`（固定 `--registry=https://registry.npmjs.org`，因 npmmirror 实测未实现 audit 端点会静默无数据；high+ 阻断，端点故障非 0 退出）
- **覆盖率棘轮（B1）**：`vite.config.js` 钉死 `include: ['src/**']` 后阈值 19.5/18/17.5/21。**口径纠偏**：此前记的 45.8%/43.72% 是"仅被测试加载文件"口径，src 全域真实值为 **19.68%**（页面层基本没测），棘轮只升不降
- **首屏预算按归因重设（B2）**：77.9KB → 86.4KB 的增量逐块归因为 `react-vendor` 66.0KB gz（占首屏 76%，react 19.3 + vite 8.3 抬基线），预算 90 → 95KB（实测 ×1.10），门禁新增"首屏构成 top3"输出
- **文档（B3）**：`docs/adr/0001-0005` 五条决策记录（状态机 / 幂等 / 库存与不自动砍单 / 预算与 XSS / 迁移账目）；`scripts/gen-api-doc.mjs` 由契约渲染人读版 `docs/API.md`（39 action，`npm run docs:api`）；README 的 CI/契约/迁移段落回写为实测数字
- 门禁终态：lint 0/0（140 文件）｜tsc 双配置 0 错｜vitest **182/182**（29 文件）｜verify-backend **101/101**｜契约 **44**｜schema 漂移 **16/16**｜e2e **8/8**｜体积 **3/3**
- 核验纪律：子代理初稿两条高危主张（workflow 未锁 SHA、`dify.js` 密钥可被客户端外发）经逐文件实测**驳回**——15 处 `uses:` 全部锁 SHA、`DIFY_BASE_URL` 只来自服务端 env

### 2026-09-24 追加二（用户裁决轮：库存 + 订单查询 + D1 备份）
- **库存管理与防超卖**（对标 C1）：`products.stock`（-1=不限售，存量商品迁移后行为不变）；下单即占用（守卫式条件 UPDATE 防并发超卖，任一失败同请求内补偿回补）；取消/删除进行中单回补、误取消恢复重新占用；管理端内联编辑新增库存字段 + 行内「缺货/低库存」角标；顾客端公开接口下发 stock
- **订单查询页** `#/order-query`（对标 litemall 订单跟踪）：输单号看 5 步进度；成功页展示订单号 + 复制 + 查询入口（sessionStorage 兜底跨导航找回单号）
- **D1 每日备份**：`.github/workflows/d1-backup.yml`（cron 04:00 北京；缺 `CF_D1_BACKUP_TOKEN` 显式 warning 跳过不假绿；导出物进私有仓 artifact 保留 30 天）；本轮已手动全量导出留档 `_backup/d1/supermarket-2026-09-24.sql`（1.44MB）
- 生产迁移：`db/migrate-stock.sql`（ALTER 加列，**先迁移后部署**顺序铁律写在文件头）
- 门禁：lint 0/0 ｜ tsc 0 错 ｜ vitest 176/176 ｜ verify-backend **84/84**（+18 库存断言）｜ e2e **8/8** ｜ build + 体积 3/3

### 2026-09-24 追加（GitHub 开源对标轮：履约闭环 + 门禁加深）
- **订单履约状态机**（对标 litemall 订单域）：3 态扩为 5 态 `pending→paid→delivering→completed` + 旁路 `cancelled`；服务端 `ORDER_TRANSITIONS` 单点强制非法迁移（status 列 TEXT 无 CHECK，**零 D1 迁移**）；管理端行内下拉只呈现合法下一步
- **顾客侧订单进度**：新增 `/pub getOrderStatus`（只回 status/updatedAt，订单号即凭证）；支付页轮询改走该公开接口——**顺带修复真实缺陷**：旧实现用 `adminCall('getOrder')`，顾客端无会话密钥必然鉴权失败，"付款已确认"轮询在顾客侧从未生效
- **前后端迁移表 parity 锁**：`src/utils/orderStatus.ts` ↔ `functions/lib/actions/orders.js` 深度相等由 `tests/orderStatus.test.ts` 断言
- **e2e 3→7 用例**：新增下单主链路、空表单防误、管理端状态流转三链路；`vite.config.e2e.js`（空 envDir）隔离本机 `.env`，使本地 e2e 与 CI 行为一致（此前本机跑必然进云端模式全挂）
- **CI 门禁加深**：Test 步骤并产 v8 覆盖率（artifact，非阈值门禁）；新增 `check:cycles` 与 `verify:contract` 阻断步骤（此前二者只在手动 `npm run verify`）
- **文档**：新增 `docs/ARCHITECTURE.md`（系统图/关键不变式/门禁链表）；README 架构入口
- 门禁：oxlint 0/0 ｜ tsc 双配置 0 错 ｜ vitest **176/176**（28 文件）｜ verify-backend **66/66** ｜ 契约 /web 30 + /pub 8 ｜ e2e 7/7 ｜ 覆盖率本机可用（旧"worker 崩溃"结论作废，vitest 5 + coverage-v8 已修复）

### 待办
- ~~覆盖率阈值门禁~~ → 本机已可跑（全量 45.8% lines），阈值门禁暂缓：页面层覆盖低，先补再卡

### 2026-09-24 追加
- **e2e 冒烟转正式门禁**：4 条用例在 CI 实跑全绿（首页/搜索过滤/加购/后台），移除 `continue-on-error` 使 `e2e` job 具备阻断力
- 期间修复：oxlint `no-console`（e2e 文件级豁免）、商城路由实为 `/#/shop`、演示模式商品 id 为 `p_{order}`、演示模式后台直接放行
- 三个 workflow（ci/dispatch/uptime）全部固定 Actions 到提交 SHA 并加 `permissions: contents: read`
- CI 状态查询通路：仓库为私有，未认证 API 404；可用本机 gh 凭据（凭据管理器 `git:https://github.com`）走 API 查询与触发 workflow_dispatch


## [0.1.0] - 2026-09-23

### 新增
- 商品图内容修正：40 号错图（呀！土豆 → 好友趣）与 18 号参数表图换实物图（`ce51d77`）
- `aiAdvice` 独立限流（60s/10 次，分桶 `rate:aiadv:{ip}`，位于鉴权之后）（`22b5e90`）
- 社区标准文件：`LICENSE`（MIT）、`SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md`
- 产物体积预算门禁：`scripts/check-bundle-size.mjs`（从 dist/index.html 解析首屏资源，按 gzip 卡阈值：首屏 JS ≤90KB / CSS ≤11KB / 单 chunk ≤90KB；实测 77.9 / 8.7 / 58.1），CI 在 build 后执行
- 端到端冒烟骨架：`playwright.config.ts` + `tests/e2e/smoke.spec.ts`（商品浏览/搜索/加购/后台登录 4 条），跑在 dev server 的本地演示模式；CI 新增 `e2e` job（首轮试跑）
- 接口契约外化：`docs/api-contract.json`（`/web` 29 + `/pub` 7 = 36 个 action，含写操作/缓存键/限流桶属性）；`npm run gen:api-contract` 生成，`npm run verify:contract` 校验漂移（41 断言，已接入 `npm run verify`）
- CI 加固：三个 workflow 全部加最小权限 `permissions: contents: read`；所有 GitHub Actions（`checkout` / `setup-node` / `upload-artifact` / `download-artifact` / `github-script`）固定到提交 SHA

### 修复
- 商品图 HTTP 强缓存 7 天 → 10 分钟 + SWR，换图最快 10 分钟可见（`b2b94af`）
- 只读密钥越权口：`ADMIN_WRITE_ACTIONS` 白名单 8 → 16 项（`2b73fbc`）
- `cache:ai:advice` 写后不失效 → 补 `invalidateAiAdvice`（`2b73fbc`）
- 3 处真循环依赖（routeLoaders ↔ 页面）用 `src/prefetchBus.ts` 拆断（`2b73fbc`）
- 浮层层级重排：安装引导遮罩 `z-[90]` → `z-[70]`（`75b5f5e`）
- `scripts/verify_images.py` 路径硬编码导致的静默假失败

### 优化
- 前端六维深度优化（性能 / 体验 / 响应式 / 代码质量 / 可访问性 / 浏览器兼容），响应式同口径复测 53 → 约 91 分（`91c4fad`）
- 二轮优化：商品图全量重编码（体积 -15%）、AI 建议会话缓存、轮询感知页面可见性、批量写合并、CSP 收紧、死代码清理（`a399cbf`）
- 第三轮全栈优化：I/O 与渲染减负、缓存失效补全（`2b73fbc`）
- 顾客端轻量视觉打磨：列表入场动画、详情页骨架屏（`22b5e90`）

### 文档
- README 校正测试数量（82 → 实测 168）与 CI 描述
