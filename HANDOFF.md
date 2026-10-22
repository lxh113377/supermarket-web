# 超柿 - 项目交接文档

> 最后更新：2026-10-17（架构：Cloudflare Pages + D1，README 为准；CloudBase 历史记录见文末存档）
>
> ✅ **最后实测验证：2026-10-17**（UTC 日；本地已过 08:00 才算新的一天，本仓取数口径同 live-perf） —— main@ef56f1f（第 75 轮：阈值消费 + 静态长缓存 + SBOM 跨平台可复现 + a11y 静态闸 + 分支保护 ENFORCED）（第 74 轮：逃生门对偶 + cron 豁免换理由 + 性能重采），CI run 39078182648 `completed/success`（六个必需 job 全 success：gates / browser-install / e2e / e2e-cloud-stub / visual / deploy），线上 `/_health` 回 `deploy=ef56f1f` **与本仓 HEAD 逐字相同**；`npm run verify` VERIFY_RC=0、`verify:backend` **204 通过 / 0 失败**、vitest **140 文件**（用例条数以 `npm test` 当场输出为准）；`check-live-shape` 3/3 PASS、漂移 0。复算三通道：`node scripts/ci-status.mjs`（run 终态与部署判定）、`node scripts/check-live-shape.mjs`（线上 sha ⇄ HEAD）、`npm run verify`（本机全链）。**ADMIN_KEY 已回退固定值**：09-05 轮换为随机串后用户拍板恢复 `supermarket-admin-****（掩码；真值见 .dev.vars / Pages secret）`（线上 secret + .dev.vars 同值，login code 0 实测通过）。**本轮新增交付面判据**：`verify:cache`（静态资源缓存语义，读 `public/_headers` 声明面）、`verify:sbom`（跨平台可复现组件清单）、`verify:a11y`（可访问性静态规则）。
>
> **事故记录**：5 提交推送触发 CI 自动部署，因 ci.yml 缺 VITE_CB_API_BASE 注入产出未烘焙版（坑 27 复发）→ 已修 ci.yml（两处 Build step 注入 env）并手动部署烘焙版救火。本文档中早于该日期的状态描述若与本戳冲突，**以本戳和磁盘实测为准**。

## 一、项目概述

"超柿"是一个面向宿舍/小区场景的在线超市购物系统，支持顾客浏览商品、加购下单、扫码支付，以及管理员后台管理商品、订单、看板、评价与服务表单。

- 管理后台 + API：`https://supermarket-web.pages.dev`（`/#/admin`）

- 微信顾客端：`https://lxh113377.github.io`

- 健康探活：`https://supermarket-web.pages.dev/_health`

## 二、当前技术栈

| 层级   | 技术                                                            |
| ---- | ------------------------------------------------------------- |
| 前端框架 | React 19 + Vite 8 + TypeScript（strict）                        |
| 样式   | Tailwind CSS 3                                                |
| 路由   | react-router-dom 7（HashRouter，页面全部懒加载）                        |
| 后端   | Cloudflare Pages Functions（`/web` 管理、`/pub` 公开、`/_health` 探活） |
| 数据库  | D1（SQLite，7 表）+ Workers KV（限流计数）                              |
| 双前端  | Cloudflare Pages（同源）/ GitHub Pages（dispatch CI 双发）            |
| Lint | oxlint                                                        |
| 测试   | vitest（140 文件；**用例条数以 `npm test` 当场输出为准，本文不写死**——写死即第二真相源，此处原记的 631/126 已落后十余轮）+ `scripts/verify-backend.mjs`（断言数以 `npm run verify:backend` 当场输出为准，原记 102 已过期）+ Playwright 三层（`tests/e2e` 演示模式 / `tests/e2e-visual` 生产构建几何 / `tests/e2e-stub` 云端模式真渲染，条数以各自命令输出为准） |

## 三、项目结构

```
supermarket-web/
├── functions/              # Cloudflare Pages Functions
│   ├── web.js              # 管理 API：POST /web { action, adminKey, payload }
│   ├── pub.js              # 公开 API：POST /pub { action, payload }
│   ├── _health.js          # 探活：GET /_health
│   └── lib/
│       ├── backend.js      # 核心业务（鉴权/限流/审计/CORS/各 handler）
│       └── shared.js       # 前端/后端共用契约（字段白名单）
├── db/                     # D1 schema.sql / seed.sql / 迁移 SQL
├── src/
│   ├── main.tsx            # 入口，HashRouter + SW 注册 + 离线队列初始化
│   ├── App.tsx             # 路由表（全部懒加载 + Suspense）
│   ├── cloudbase.ts        # IS_CLOUD 判定（是否配置后端端点）
│   ├── db.ts               # 数据访问门面（再导出 db/ 子模块）
│   ├── auth.ts             # 管理端调用 + 字段白名单 + 缓存失效
│   ├── cart.ts             # 购物车纯函数（localStorage）
│   ├── localStore.ts       # 本地演示模式数据层
│   ├── catalogCache.ts     # 目录内存缓存（60s TTL）
│   ├── db/                 # products/orders/reviews/submissions/cloud/cloudInit
│   ├── hooks/              # useCart / useProducts
│   ├── utils/              # businessHours / reviewImages（评价图压缩+base64）
│   ├── components/         # UI 组件（含管理端 InlineEditForm 内联编辑）
│   └── pages/              # 顾客端 + 管理端页面
├── tests/                  # vitest 单测（140 文件；用例条数以 `npm test` 当场输出为准）
├── public/                 # 商品图 webp + sm/ 小图、sw.js、manifest、收款码
├── .github/workflows/      # ci.yml（门禁）+ dispatch.yml（github.io 双发）
├── wrangler.toml           # Pages 构建输出 + D1/KV 绑定
└── package.json
```

## 四、路由表

| 路径                        | 页面                | 说明                   |
| ------------------------- | ----------------- | -------------------- |
| `/#/`                     | HomePage          | 首页                   |
| `/#/shop`                 | CustomerPage      | 顾客商品列表               |
| `/#/category/:categoryId` | CategoryPage      | 分类页                  |
| `/#/service/:serviceId`   | ServiceFormPage   | 服务表单                 |
| `/#/product/:id`          | ProductDetailPage | 商品详情（多图+评价+写评价）      |
| `/#/cart`                 | CartPage          | 购物车                  |
| `/#/order-confirm`        | OrderConfirmPage  | 确认订单                 |
| `/#/order-success`        | OrderSuccessPage  | 下单成功                 |
| `/#/payment`              | PaymentPage       | 支付（扫码+轮询）            |
| `/#/admin`                | AdminPage         | 管理后台（需密钥，AdminGuard） |

## 五、本地开发

```bash
cd supermarket-web
npm install
cp .env.example .env   # 后端端点；本地密钥写 .dev.vars
npm run dev            # http://localhost:5173
npm run typecheck      # tsc --noEmit
npm run test           # vitest
npm run build          # 产物 dist/
node scripts/verify-backend.mjs   # 后端契约验证（mock D1）
```

无 `.env` 的 `VITE_CB_API_BASE` 时自动降级为本地演示模式（数据存 localStorage，不入库）。

## 六、部署

### Cloudflare Pages（管理后台 + API）

```bash
npm run build
npx wrangler pages deploy dist --project-name supermarket-web
```

- 密钥：Dashboard → Pages → supermarket-web → Variables and Secrets 新增 secret 型 `ADMIN_KEY`（与本地 `.dev.vars` 同值）；可选 `ADMIN_READONLY_KEY`（只读）

- D1/KV 绑定见 `wrangler.toml`

- **部署铁律**：任何 wrangler/deploy 操作前先加载 `chaoshi-web-deploy` skill，禁止裸跑；部署后用户需 `Ctrl+Shift+R` 强刷（SW 缓存，HTML 缓存 max-age=600 + SW 缓存最长 10min+）

### GitHub Pages（微信顾客端双发）

push main 后 `.github/workflows/dispatch.yml` 经 `GH_DISPATCH_TOKEN`（repo 权限 PAT）触发 `lxh113377.github.io` 的 Actions 重新构建发布（Pages 源 = GitHub Actions）。缺该 secret 时 dispatch job 失败。

### 部署冒烟（npm run smoke）

`scripts/smoke-deploy.mjs`（零依赖 Node fetch）：静态站 200 + `/web` getProducts + `/pub` getPublicProducts + `/_health`，全部 PASS 视为上线成功。

## 七、关键设计决策

### 7.1 安全

- 管理密钥不在前端代码；走 Pages secret（`ADMIN_KEY`）+ HTTP `/web` 校验

- AdminGuard 纯走接口验证，无本地哈希兜底

- `auth.ts` + 后端 `shared.js` 双端字段白名单（纵深防御）

- 订单金额服务端重算，前端不传 totalAmount

- 图片 scheme 白名单 `isSafeImageUrl`（拒绝 javascript:/data:text/html 注入）

- 限流优先 Workers KV（跨实例、可故障转移），KV 瞬时异常优雅回退 D1

- 登录限流在鉴权前计数（防暴力破解）；认证失败落 `security_events` 审计（仅密钥指纹）

- 双密钥角色：admin（全权限）/ readonly（禁止 `ADMIN_WRITE_ACTIONS`）

- CORS 精准白名单（pages.dev + github.io + 本地开发），`Vary: Origin`，可经 env 追加

### 7.2 数据层

- Cloudflare Pages Functions + D1（SQLite）；公开接口 `/pub`，管理 `/web`

- **库存流水（2026-09-30 第五十六轮起）**：D1 现有 **10 张表**，第 10 张是 `stock_movements`（出入库/盘点/取消回补的
  唯一记账面，快照 `products.stock` 仍是当前真相源）。不变式「有限库存商品 SUM(delta) == products.stock、
  不限售项（stock=-1）恒为 0」由 `npm run verify:backend` 的 L 组当场判。**生产迁移已执行**（走 `scripts/migrate.mjs`
  账目表通道，非裸 `d1 execute`），执行前后 `products=55 / orders=59` 未变，恢复演练载回断言通过。
  ⚠️ 现网 55 件商品**全部** `stock < 0`（不限售）⇒ 这张表目前是空的，"把某商品改成有限库存"那条写路径
  **尚未在现网走过**（本地有 204 条后端断言背书 —— 2026-10-17 实测 `npm run verify:backend` 结果 204 通过 / 0 失败；该轮原记的 185 已过期）。详见 `memory/07-next-steps.part111.md` 与 R57-H7。

- 顾客端读取带 60s 内存缓存（`catalogCache`），云端失败回退本地数据并 warn

- 商品/评价/服务查询 LIMIT 上限（1000/500/500）；订单分页（默认 50/页）

- 评价晒图 base64 dataURL 入 D1（≤3 图 × ≤800KB；技术债，量大后建议迁 R2 对象存储）

### 7.3 购物车

- 纯函数 + localStorage 持久化；useRef 解决 stale closure；storage 事件跨 tab 同步

### 7.4 商品图片

- `public/images/{order}.webp`（49 张原图）+ `sm/` 400w 响应式小图（srcset 接入）

- 管理后台可设自定义图片 URL（优先级高于本地编号图）；加载失败降级品牌色占位

### 7.5 评价系统

- 顾客提交（评分 1-5 钳制、昵称/文本截断、图片≤3×≤800KB、限流）+ 管理端增删

- 详情页合并云端 + 本地评价，fallback 种子评价

### 7.6 PWA

- Service Worker 仅缓存静态资源（JS/CSS/HTML/图片），API 请求不缓存

- build 时 `sw-version-inject` 自动 bump `CACHE_VERSION`（`dist/sw.js`）

- 发布后旧缓存最长 10min+ 影响验证，需新浏览器 profile + 强刷

## 八、Cloudflare 环境信息

| 项目         | 值                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Pages 项目   | supermarket-web（`supermarket-web.pages.dev`）                                                              |
| D1 数据库     | supermarket（id `4bfc0283-...`，binding `DB`）                                                               |
| Workers KV | RATE\_KV（id `47242e45-...`，限流计数）                                                                          |
| 管理密钥       | `ADMIN_KEY` = 短语型固定值（**2026-09-26 第三次回退为当前值**：09-25 转 public 前曾轮换为随机串，用户拍板换回便于手机输入的固定值并接受"该值明文在公开仓历史"的风险；生产 Pages secret 与本地 `.dev.vars` 同值，**真值不写进任何文档**）。⚠️ 改 secret 后必须重新部署才生效（坑 19）。轮换历史三轮：08-23 随机→重置、09-05 随机→回退、09-25 随机→09-26 回退 |
| 只读密钥       | `ADMIN_READONLY_KEY`（可选）                                                                                  |
| CORS 追加源   | `ALLOWED_ORIGINS`（逗号分隔，可选）                                                                                |

> 验密：`POST https://supermarket-web.pages.dev/web` `{action:"getSubmissions", adminKey}` 返回 code 0 即有效。

## 九、已知限制 & 后续建议

1. **评价晒图 base64 入 D1**（技术债 R7）— 量大后迁 Cloudflare R2 对象存储直传，backend 仅存 key
2. **无顾客账号体系** — 下单免登录，仅房间号+联系方式
3. **支付为模拟流程** — 展示收款码 + 轮询，未接真实支付 SDK
4. **无外部探活/告警** — `/_health` 已就绪，可接入 UptimeRobot 等免费探活
5. **批量操作** — 已支持后端批量端点（batchUpdateProducts/batchDeleteProducts）
6. **LIMIT 1000 容量边界** — 观测，日订单/商品增长后再评估
7. **打印订单不在本后台可见（2026-10-22 实测确认，裁定=方案 A；后台面已落地，超市侧入口跳转待做）** — 10-21 起 `/print` 整页替换为
   CampusPrint-V1 后，打印单落在**上游自己的 SQLite**（`print_orders`），而本后台「服务」页读的是 D1
   `getSubmissions`（最后一条停在 10-16，即替换前）⇒ 打印单没有任何入口进入本后台。上游**自带**完整
   经营后台（`frontend/admin/` 11 文件：订单工作台/优惠券/广告/公告/商户设置/补偿，路由 `/api/admin/*`
   实测 401=存在），但 10-21 只搬了学生端、管理端没搬。
   **裁定：走方案 A（把上游管理端同源搬入 `public/admin/**`，复用现有 `/api` 反代）。**
   理由：① 功能完整度最高（订单工作台/优惠券/广告全都有，不用重造）；② 与既有替换策略一致
   （同一套 parity 对账 + 同源反代），不引入第二套凭据托管；③ 放弃方案 B 是因为它需要服务端持有
   上游管理员凭据，等于把两套账号体系缝在一起，风险高于收益。
   **当前影响=零**（上游 `print_orders=0`，只有联调 `print_quotes=7`）；一旦开始接真实单即断链。
   落地清单：搬 `frontend/admin/**` → 扩 `scripts/print-parity.mjs` 的 MAPPINGS 一组 + 刷新登记册；
   入口从超市后台加一处跳转；管理员登录用上游自有账号（与 `ADMIN_KEY` 是两套，不混用）。
   **进度（2026-10-22 d03dc23）**：前三项已落地 —— 上游 `frontend/admin/**` 11 件原样搬入本站
   `public/admin/**`（对账分母 21 → 32，`npm run verify:print` GREEN 零漂移）；线上实测
   `https://supermarket-web.pages.dev/admin/#dashboard` 打开即是「校园打印 · 经营后台」，
   未登录时正确显示管理员登录框（`/api/auth/me` 回 401 = 鉴权在工作）。
   入口已补（648d8f6）：后台标题区加「打印经营后台」按钮，新标签打开 `/admin/`。
   不做成页签的理由：打印单在上游自己的库里、与本后台读的 D1 不通，做成同页签会让人误以为
   是同一套数据；用新标签是因为两套登录体系（这里 `ADMIN_KEY`、那边上游管理员账号）在同标签
   互踢会丢正在编辑的内容。
   登录链路一手实测（2026-10-22 线上）：`/api/auth/admin-login` 200 ⇒ 随后
   `/api/admin/dashboard`、`/admin/settings`、`/admin/reason-catalog`、`/admin/announcement`
   全 200，看板正常读出「待接单 / 制作与配送中 / 暂停待处理 / 已完成」四项计数
   ⇒ 打印单在本站域名内确实可看可处理（这就是方案 A 的验收点）。
   **端到端验收（2026-10-23 01:2x 线上真跑，非本地推断）**：在 `/print/#print` 上传
   `sample-chinese.pdf` → `202 /api/files` → `202 /api/print/quotes` → 勾「检查最终打印预览」
   + 填房间号 → `201 POST /api/orders` 建出真单 `CP20261022-FFDA3298E8AC`（¥0.50 / 1 内容页 /
   房间 1517）；再从超市后台点「打印经营后台」→ 订单工作台**列出这一单**（`200 /api/admin/orders`，
   状态「待接单」，详情给出「确认收款并接单 / 查看生产预览 / 下载单份生产 PDF / 查看查询码」四个
   真实动作）⇒ 顾客下单到商家接单的全链路已在本站域名内闭环。
   两笔测试单都已清理（见第 10 条）；顺带更正本条上一稿的错误结论：我曾写「后台对「待接单」
   只暴露接单动作、取消需先核款」，那是**误判** —— 详情区有个折叠的
   `<details class="action-group">`「取消与退款」，展开就有「商家原因取消」。
   踩坑记法：探针用 `allInnerTexts()` 扫按钮，而闭合 `<details>` 里的元素不渲染、文本为空
   ⇒ 被 `filter(Boolean)` 静默吃掉，于是把「我没探到」写成「它没有」。判 UI 有没有某个控件，
   得先展开折叠容器或直接查 DOM 的 `data-action`，不能只数渲染出来的文本。
8. **微信顾客端无法打印下单（一手实测已定位到域名层，但根因待一次手机实测收敛）** —
   **实测成立的部分**（2026-10-22 两端浏览器级跑）：GitHub Pages 纯静态托管
   **跑不了 Pages Functions** ⇒ 本站 `/api` 同源反代在那个域名上必然 404（2026-10-22 两端浏览器级实测：
   （pages.dev 上 `/print` 7 个接口全 200、可上传可报价；github.io 上 `/api/public/config` 与
   `/api/auth/me` 全 404 —— 后者是静态托管没有 Functions，必然结果）。想"跨域借 pages.dev 的后端"
   也不成立：校园打印的会话是 `httpOnly` + `SameSite=Lax` Cookie（上游 `backend/auth.js:37`），
   跨域请求带不出 Cookie ⇒ 登录态与 CSRF 必断。
   **未实测、仅继承自 `chaoshi-web-deploy` skill §1 的部分**：该处写 github.io 是"唯一微信入口"，
   但没留一手证据说明 pages.dev 在微信里到底是被拦、还是只是当年没备案所以没用它。老大截图里
   那次拦截是**脚本触发的跨域导航**（github.io → pages.dev）所致，这并不等于"直接在微信打开
   pages.dev 也会被拦"。两种可能的处置差别极大，故记明待验：
   ① 若直接在微信里打开 `https://supermarket-web.pages.dev/print/` 能正常用 ⇒ 零成本解法，
      把群公告/菜单链接换成它即可，**本站代码一行都不用改**（打印在该域名已实测可用）；
   ② 若仍被拦 ⇒ 才需要"既被微信认可又能跑 Functions 的域名"（自定义域名 + 通常需 ICP 备案）。
   另有一层**已实测确认**的独立短板：`/api` 反代的目标（打印应用自己的 Node 后端）目前跑在
   这台笔记本 + Cloudflare 快速隧道上，隧道一断线上打印即 503（换址自愈 = `npm run print:tunnel`）。
   它依赖原生模块 `sharp` / `@napi-rs/canvas` / `node:sqlite`（上游 `backend/files/worker.js:7-9`），
   Workers 跑不了 ⇒ 要彻底不靠笔记本，需要一个能跑 Node 的服务器（或把文件渲染单独拆出去）。
   卡点=服务器与域名资质（外部费用项，Agent 无法代办购买/备案）；证据=上述两端状态码与依赖行号；
   下一步=先做上面 ① 的手机实测（零成本，可能当场解决微信侧问题），再定是否需要服务器。

***

9. **D1 每天自动备份已经 28 天没产出任何备份件（2026-10-23 一手）** — `d1-backup.yml` 近 29 次
   run 只有 2 次 success，最近一次 **2026-09-25**；仓库 95 个 artifact 里名字含 backup/d1/export
   的 **0 个**。根因是缺仓库 secret `CF_D1_BACKUP_TOKEN`，且它一直**红得没人看**：备份链唯一
   的哨兵 `check:backup-liveness` 挂在日巡检里，而日巡检自己也需要凭据才能报得响。
   ⇒ **这不是判据问题，是凭据问题**：判据已经在喊，喊了 28 天。
   **修法（两件事必须一起做，只做一件更坏）**：
   ① Cloudflare 后台 → My Profile → API Tokens → 建一个 **D1:Read** 的 token，
      存成 GitHub 仓库 secret `CF_D1_BACKUP_TOKEN`；
   ② 同时设 `BACKUP_PASSPHRASE`（本仓 2026-09-25 转 public，未加密产物任何登录用户
      拿到 token 都能下载 —— `d1-backup.yml` 顶部的可见性守卫就是拦这件事的）。
   ⚠️ **只设 passphrase 不设 token = 半配置陷阱**：备份压根不会跑，等将来某天真配上 token，
   产物会被一个谁也没记录的口令加密 ⇒ 备份等于废纸，比没有更危险。本轮我试探性设过一次
   `BACKUP_PASSPHRASE`，发现只补半条正好踩这个雷，**已当场删除**（实测 secrets 名册回到
   `CLOUDFLARE_API_TOKEN, GH_DISPATCH_TOKEN` 两项）。
   本机凭据不足以自动办完：wrangler 的 OAuth token `/user/tokens/verify` 返回 success=false，
   直接建 API token 报 `9109 Unauthorized to access requested resource` ⇒ 属外部凭据缺口，
   只能老大在 Cloudflare 控制台点一次。

10. **打印下单的收款环节已并入本店真实收款码（2026-10-23 一手实测）** —
    打印经营后台「设置与维护」里原本两个渠道都是**未配置**，顾客下单页因此挂着
    「尚未配置收款信息」。已把**本仓自己的**两张收款码（`public/wechat-pay.png`、
    `public/alipay.jpg`，即超市下单用的那两张，同一账户）经后台 UI 上传进去：
    `200 POST /api/admin/payment-qr/wechat`、`200 POST /api/admin/payment-qr/alipay`，
    后台两处转「已配置，请核对真实收款账户」。
    线上取数面实测：`GET /api/public/payment-qr/{wechat,alipay}` → 200 `image/png`
    （154615B / 381639B），拉下来肉眼看就是老大那两张真码；与仓库原件**逐字节不同**属正常 ——
    上游入库时重编码过（alipay 还从 JPG 转成 PNG），不是内容不对。
    顾客侧走完真实下单链验证：上传 PDF → `202 /api/files` → `202 /api/print/quotes` →
    勾预览确认 + 填房间 + 选接收方式 → `201 POST /api/orders` 建出
    `CP20261022-01AA01DBE2C3`，订单页**收款码 img 元素 naturalWidth>0 真渲染**，
    「尚未配置收款信息」字样消失（截图 `_print-verify/order-payment-qr.png`）。
    ⚠️ 两点代价，别当免费午餐：① 码现在存在**打印后端自己的数据目录**里（这台笔记本 +
     `CP20261022-01AA01DBE2C3`，各 ¥0.50、均无真实收款）。**两笔都已走后台真实通道取消**：
     展开详情区折叠组「取消与退款」→「商家原因取消」→ 原因码 `cannot_print` ⇒ 两次
     `200 POST /admin/orders/:id/cancel-resolution`；实测 `lifecycle=cancelled`、看板
     `awaitingPrint / awaitingDelivery / exceptions` 全归 0、`confirmedReceivedFen=0`
     （没有伪造任何收款记录去清账）。
    另记一次踩坑免得重复：探 `/api/public/*` 时**不要**带 `X-CP-Surface: public` —— 该头只认
    `admin`/`me`，带上会被上游判 `403 FORBIDDEN 请求端上下文无效`，看着像端点坏了其实是我方请求错。

## 十、历史存档（CloudBase 时代，2026-08-08 前，仅归档参考）

> 以下记录为 2026-08-08 及之前的 CloudBase 架构历史，**已迁移至 Cloudflare Pages + D1，仅供参考勿照做部署**。

### 2026-08-08 全量上线（腾讯云 API 管家）

- 订单字段/评价体系/商品多图/数据卫生 + 41 文件 TS 迁移（strict 0 错误）

- tccli 授权 + `/pub → public-api` 独立路由 + hosting/fn 部署 + curl 验收

- 线上：sm\_products=49、sm\_reviews=20；SW 版本 sm-v1786129950705

- 坑：public-api 单独部署包需含 node\_modules；`tcb fn log` CLI 3.6.4 不可用

### 2026-07-25 会话 2（商品宣传图补齐）

- 4 agent 并行下载 49/49 官方宣传图（覆盖率 100%）；`scripts/verify_images.py` 验证

- 图源：苏宁易购约 35 张、gdyinjue/truly-fresh/腾讯新闻 CDN 少量

### 2026-07-25 会话 1（安全/逻辑）

- AdminGuard 删本地哈希兜底；PRODUCT\_FIELDS 白名单；订单金额服务端重算

- PaymentPage 轮询改 getOrderById；db.js 订单分页

