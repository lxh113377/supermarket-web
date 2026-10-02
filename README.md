# 超柿 Web（supermarket-web）

面向宿舍/小区场景的在线超市购物系统。顾客端浏览商品、加购下单、扫码支付；管理后台管理商品、订单、评价与服务表单。

![CI](https://github.com/lxh113377/supermarket-web/actions/workflows/ci.yml/badge.svg)
![D1 Daily Backup cron](https://img.shields.io/github/actions/workflow/status/lxh113377/supermarket-web/d1-backup.yml?event=schedule&label=D1%20Daily%20Backup%20(cron))
![Uptime cron](https://img.shields.io/github/actions/workflow/status/lxh113377/supermarket-web/uptime.yml?event=schedule&label=Uptime%20(cron))
![license](https://img.shields.io/badge/license-MIT-blue)

> 上面两枚 `event=schedule` 徽章是**免鉴权的对外可见物**：它们反映的正是"最近一次由 cron 触发的 run"，
> 而不是"任意一次 run"。立它的实测动因：`D1 Daily Backup` 与 `Uptime` 的最近一次 scheduled run 双双判红
> 若干天，而这件事此前只在 GitHub Actions 页面里、没人会点开（对标 `badges/shields` 的
> `github-actions-workflow-status`：零匹配 run 时它印 `no status` 而不是绿）。机器侧的对账见
> `npm run check:cron-health` + 登记册 [`docs/cron-health.json`](docs/cron-health.json)。

**文档**：[架构文档](docs/ARCHITECTURE.md) · [API 契约（人读版）](docs/API.md) · [决策记录 ADR](docs/adr/) · [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [更新日志](CHANGELOG.md)

<!-- gate-table:begin -->
## 门禁一览（生成物，勿手改）

`node scripts/check-doc-commands.mjs --update` 从 package.json 现取，改别名即整块重生；
漂没漂由两条判据对账：D6（别名名集合双向，缺行/幽灵行都点名）+ D7（与本生成器的输出逐字节相等）；不靠任何人记得来改表。

| 命令 | 它跑的是 |
| --- | --- |
| `npm run check:backup-liveness` | check-backup-liveness.mjs |
| `npm run check:cron-health` | check-cron-health.mjs |
| `npm run check:cycles` | check-import-cycles.mjs |
| `npm run check:doc-commands` | check-doc-commands.mjs |
| `npm run check:judge-side-effects` | check-judge-side-effects.mjs |
| `npm run check:live-shape` | check-live-shape.mjs |
| `npm run check:size` | check-bundle-size.mjs |
| `npm run check:syntax` | check-staged-syntax.mjs |
| `npm run verify:authz` | check-action-authz.mjs |
| `npm run verify:backend` | verify-backend.mjs |
| `npm run verify:case` | check-case-collision.mjs |
| `npm run verify:changelog` | check-changelog.mjs |
| `npm run verify:cli-legs` | check-cli-leg-coverage.mjs |
| `npm run verify:contract` | api-contract.mjs |
| `npm run verify:csp` | check-csp-static.mjs |
| `npm run verify:docs` | check-doc-consistency.mjs |
| `npm run verify:entrypoints` | check-cli-entrypoints.mjs |
| `npm run verify:env` | check-env-docs.mjs |
| `npm run verify:eol` | check-eol-purity.mjs |
| `npm run verify:errors` | check-error-semantics.mjs |
| `npm run verify:escape-hatch` | check-escape-hatch-log.mjs |
| `npm run verify:event-sink` | verify-event-sink-d1.mjs |
| `npm run verify:functions` | check-functions-build.mjs |
| `npm run verify:images` | verify_images.py |
| `npm run verify:licenses` | check-licenses.mjs |
| `npm run verify:limits` | check-limit-provenance.mjs |
| `npm run verify:logs` | check-logging.mjs |
| `npm run verify:migrate-replay` | verify-migrate-replay.mjs |
| `npm run verify:openapi` | gen-openapi.mjs |
| `npm run verify:parity` | verify-release-parity.mjs |
| `npm run verify:pii` | check-pii-inventory.mjs |
| `npm run verify:pointers` | check-memory-pointer-sync.mjs |
| `npm run verify:registry` | check-registry-sync.mjs |
| `npm run verify:response` | api-response-contract.mjs |
| `npm run verify:restore` | verify-backup-restore.mjs |
| `npm run verify:restore-drill` | restore-drill.mjs |
| `npm run verify:roundtrips` | check-d1-roundtrips.mjs |
| `npm run verify:schema` | check-schema-drift.mjs |
| `npm run verify:volume` | check-memory-volume.mjs |
<!-- gate-table:end -->




## 功能一览

| 端 | 功能 |
|---|---|
| 顾客端 | 首页 / 分类 / 商城 / 商品详情 / 购物车 / 确认订单 / 支付页 / 下单成功 / 服务表单 / AI 导购 |
| 管理后台 | 数据看板（echarts）/ 商品管理（内联编辑）/ 订单管理 / 评价管理 / 服务表单处理 |
| 后端 | `/web` 管理 34 action、`/pub` 公开 9 action、`/_health` 探活；D1 + KV；限流 / 审计 / 双密钥角色 |
| 履约 | 订单 5 态状态机（待支付→已支付→配送中→已送达，旁路已取消）；顾客侧 `/pub getOrderStatus` 进度轮询 |
| PWA | 可安装（含微信与 iOS 手动引导）、Service Worker 缓存静态资源 |

- **前端**：React 19 + Vite 8 + TypeScript + Tailwind CSS 3 + react-router 7（HashRouter）
- **后端**：Cloudflare Pages Functions（`/web` 管理、`/pub` 公开、`/_health` 探活）+ D1（SQLite）+ Workers KV（限流）
- **双前端**：Cloudflare Pages（管理后台 + API，同源）/ GitHub Pages（微信顾客端，跨源调 pages.dev）
- **支付**：展示微信/支付宝收款二维码（模拟流程，未接真实支付 SDK）

## 网址

- 管理后台 + API：`https://supermarket-web.pages.dev`（`/#/admin` 后台）
- 微信顾客端：`https://lxh113377.github.io`（备用镜像）
- 健康探活：`https://supermarket-web.pages.dev/_health` → `{status:"ok", db:"ok"}`

## 本地开发

```bash
cd supermarket-web
npm install
cp .env.example .env   # 填入后端端点；本地后端密钥写 .dev.vars（勿提交）
npm run dev            # http://localhost:5173
```

无 `.env` 的 `VITE_CB_API_BASE` 时自动降级为本地演示模式（数据存 localStorage）。

### 管理端「云端模式」的浏览器验收（不需要生产密钥）

演示模式进不了云端分支（看板聚合在服务端，demo 下会显示"看板数据加载失败"），而用生产密钥做浏览器验收等于把密钥写进对话/日志——禁止。为此提供一条隔离通道：

```bash
npm run build:stub   # 用 tests/env-stub/.env.stub 烘焙同源端点（/web、/pub）
npm run serve:stub   # http://localhost:5182，静态伺服 dist-stub + 假 /web /pub 响应
```

密钥随便填（假桩一律放行），即可在真浏览器里跑「登录 → 看板 → 真 echarts 出图」这条路径（六轮的 canvas 正反例就是这么做出来的）。⚠️ 该产物严禁上线。

## 部署

### Cloudflare Pages（管理后台 + 后端 API）

```bash
npm run build
npx wrangler pages deploy dist --project-name supermarket-web
```

- 后端密钥：Cloudflare Dashboard → Pages → supermarket-web → Settings → Variables and Secrets 新增 secret 型 `ADMIN_KEY`（本地开发用 `.dev.vars`，已被 gitignore）
- D1/KV 绑定见 `wrangler.toml`（DB / RATE_KV）
- 部署后用户需 `Ctrl+Shift+R` 强刷（SW 缓存）

### GitHub Pages（微信顾客端双发）

push main 后 `.github/workflows/dispatch.yml` 经 `GH_DISPATCH_TOKEN` 触发 `lxh113377.github.io` 的 Actions 重新构建发布（Pages 源 = GitHub Actions）。缺该 secret 时 dispatch job 失败。

## CI

`.github/workflows/ci.yml` 的 Test job 依序跑：**依赖漏洞审计**（`npm audit`，见下）→ 密钥扫描 → oxlint → **文件名大小写冲突自查** → **环境变量登记册对账** → **静态 CSP 自洽** → **商品图片资产对账**（`verify:images`，三张分母面：seed ∪ 现网在售 ∪ 现网目录全集，外加 `sm/` 缩略图同分母不同目录）→ **行尾纯度对账**（`verify:eol`：问 git `check-attr` 怎么解析属性表、逐字节扫 index 侧 blob 有无 CRLF，并拿 `git ls-files --eol` 当第二条通道对账；第五十四轮起**三把尺分档各印一行并标明能不能拦提交**——blob 侧=E1/E2/E3 拦、写侧声明 `.gitattributes ⇄ .editorconfig` 同向=E5 拦（可自愈才有资格当闸）、检出字节面=E4、git 工作树行尾口径=E6 两条只报（本机 `core.autocrlf=true` 时归一会让 status 报脏而 blob 未变，判它＝要求提交一笔不存在的改动））→ vitest（**122 文件**，带 v8 覆盖率并卡棘轮阈值 79/72/74/80；用例条数以 `npm test` 当场输出为准，本文件不写死——写死即第二真相源）→ typecheck（前后端双配置）→ 循环依赖检查 → API 契约漂移 → **响应形状契约对账**（action 的 data 字段集合从 `wrapHandle` 真实流量录；缺成功形状须逐条具名理由，且理由要含实测数字或可复跑命令）→ **登记表 ⇄ 生产者双向对账**（代码分发面 ⇄ api-contract / SQL 峰值基线 / 形状登记三张表；例外册自身也要双向——对不上任何登记键的例外判红，借 `rust-lang/rust` tidy 的 "Remove from EXCEPTIONS list"）→ **文档事实一致性** → **schema 漂移** → **迁移重放与基线重建对账** → **D1 复杂度三把尺对账**（语句数 / 网络往返数 / **每次调用写多少行**——第三把尺对齐平台每日配额 100,000 行写入，登记件 docs/d1-write-quota.json 与当场实测双向对账；**现网真实累计用量**由 `docs/d1-remote-usage.json` 带时刻登记，两态 `VERIFIED / UNREACHABLE`（取不到就记未验证，绝不折算成"配额安全"；对账腿 A11/U7 拿登记册与实测互查）→ **全部 schedule 工作流的"最近一次"普查**（`check:cron-health`：YAML 声明面 ⇄ 远端注册面双向对账 + 逐条 cron 的最近一次 scheduled 结论/连红次数/龄期⇄周期；手动 dispatch 成功**不得**顶替调度层；已知的红要"限期 + 可证伪理由 + 具名根因"三件套才降级为 WARN，见 docs/cron-health.json）→ **函数级授权覆盖对账**（只读禁用清单 ⇄ 代码实际业务写双向相等）→ **数值上限溯源对账**（每个上限须追到平台事实/列定义/产品决定；取数面由 `SURFACE_PREFIXES` + `SURFACE_EXT` 单源派生 ⇒ **声明了却零贡献的空根由 C7b 判红**（第四十一轮一手：旧结构下把 `scripts/` 加进前缀表是 74→74 的静默空操作，还印成「面已含」），判据/文档/测试面按教义永不入面）→ **个人数据登记册对账**（每列都要有家：覆盖或带理由豁免；与导出面白名单互锁）→ **错误语义登记册对账**（每个失败出口须带机器可读 `errorCode`+`kind`，语义 HTTP 状态单点映射，下单链路禁把业务拒绝兜底成本地单）→ **CLI 入口真跑对账**（门禁脚本光被 import 纯函数不算被测：入口通道——读 stdin、解析 git 的 ref 行、退出码——必须至少有一次被当子进程真跑过，登记册 `docs/cli-entrypoints.md`，G1~G14：入口分母、双向对账、派生风险、分母地板、@probe-safe 三方对账、**取数面逐来源非空**、**别名里的非 .mjs 入口不得结构性失踪**、**采集目录本身要有正向读数**（G12，第四十五轮：登记面由 npm 别名／.githooks／workflows 三个来源合成，任一面静默归零时总数照样绿 ⇒ 逐个来源各出一行分母，本轮真面 npm 45／hook 4／ci 7。G14，第四十七轮：再往下一格——没有任何一条判据判"采集器有没有对象可喂"，`collectCovered` 在 `tests/` 取不到时直接返回空 Map，于是"没人写夹具"与"我根本没读到目录"账面一样；现在印 `tests/` 的文件数与其中真起子进程的个数，三种"读不动"记 UNVERIFIED 而不写成"结论为否"）→ **CLI 腿守卫覆盖对账**（`verify:cli-legs`，第五十五轮 R55-H3：把 `spawnSync(..., {timeout})` 的空输出当结论的那类文件还剩几件——分母由 `@babel/parser` 现取（文本级检测器对带解构默认值的函数签名整片失明，本轮一手：它把 24 个位点的文件判成「无包装器」），风险位点只算**带 timeout** 的 spawn（不带 timeout 产不出 `status===null`，算进分母＝虚报欠账），恒等式 `total == with_timeout + without` 不闭合即红、解析失败踢出分母并具名点名；上限册 `docs/cli-legs.json` 的 `unguardedMax` 只准降不准升 ⇒ 新增一条裸腿当场判红，既存欠账逐轮清偿） → **文档里印的命令 ⇄ 真相源对账**（`check:doc-commands`：文档正文的 code-span 命令逐条对 package.json 别名与盘上文件；历史文档走"**带到期时刻**的归档面"而不是永久豁免，README 上面那张门禁一览由它 `--update` 生成、D6 判生成物不许漂。立它的一手事实：归档计划文档里三条 predeploy 别名是 CloudBase 时代的死命令（此处刻意不写成可执行形态 —— 写了就得进归档面才不判红，而这道闸正是这么逼人说真话的），而盘上的别名总数（现值请当场读 `npm run check:doc-commands` 输出的 aliases，本文件不写死——写死即第二真相源，本句原来写的 64 就是落后了两轮）根本没有它 —— 此前没有任何门禁读文档正文）→ **"这条判据会不会改写受版本控制的产物"用真跑判**（`check:judge-side-effects`：把每个候选解进一次性 `git archive` 快照跑两趟（默认 args / 显式写盘 args），逐文件比 **sha 与 mtime 两把尺**——幂等生成器"写了同样的字节"也算写过。一手缺口：`check-d1-roundtrips --update-write-quota` 改写 `docs/d1-write-quota.json`，而静态推导对它判"零风险"（目标常量是 import 进来的）。CI 走 `--blind-only` 只测静态解不出的那一类，本机全量面 9 件：修前实测 6m49s，第四十六轮按分相归因把注入的依赖树移出读数面后 **1m37s**（单次读数 10,933 → 708 文件）；**没敲那扇门**的产物记"未复核"而不记幽灵；
S6 另判**证据新鲜度**（册上 `observed_utc` 超过 `--max-age-days`，默认 14 天 ⇒ 记 UNVERIFIED/rc=2；
`--blind-only` 拒绝 `--update`，缩面不得重写全量册））→ **记忆卷 4KB 预算**（借 pre-commit-hooks 的 check-added-large-files 形态，CI 走 --all 全量面；余量 <15% 打 stderr 贴线告警）→ **外层工作区记忆指针跟上轮次**（`verify:pointers`，advisory：外层目录在代码仓之外，CI 检出面里永远没有它 ⇒ 该腿按 UNVERIFIED 记并把「已核对 1/2」印在门面行，绝不折算成通过）→ **分支保护普查（advisory，不阻断）**（借 ossf/scorecard 的 Branch-Protection 形态，但取不到时按 UNVERIFIED 记，不按"满足"计）→ **license 白名单** → **CHANGELOG 门禁** → build（注入线上端点）→ 体积预算 → **Pages Functions 可部署产物检查**（编译 functions/，零部署）→ 后端契约验证（`scripts/verify-backend.mjs`，node:sqlite 模拟 D1）。

依赖审计固定走官方源（`npm run audit:deps`）：本机/镜像源 npmmirror **未实现 audit 端点**（实测 `NOT_IMPLEMENTED`），不指 registry 会让审计静默拿不到数据；端点故障时 npm audit 非 0 退出，不会假绿。

push main 后 `deploy` job：部署 Cloudflare Pages → 线上冒烟（`_health` + 公开接口契约）→ **冒烟失败自动回滚上一生产部署**。另有 `dispatch.yml`（github.io 顾客端双发）、**`release-parity.yml`（第九轮新增：CI 绿之后独立核对两端是否同一批发布 —— `sw.js` 指纹都晚于发布提交时刻、入口 bundle 同名、`/pub` 条数 >0，带 CDN 传播重试阶梯；首版曾挂在 deploy job 上，被 CI 首跑证明顾客端链路与它并行、必然误报，故独立成 workflow 且只报警不回滚）** 与 `uptime.yml`（每日探活）。

CI 另外两道卡口：**体积预算**（`scripts/check-bundle-size.mjs`，按首屏 gzip 卡阈值：JS ≤95KB / CSS ≤11KB / 单 chunk ≤90KB，并打印首屏构成 top3 便于归因；基线归因见 `docs/adr/0004`）与 **浏览器层三道门禁**（用例条数以各自命令输出为准，不在此写死）：

- `e2e` job（`npm run test:e2e`）：`tests/e2e/`，Playwright 跑在 dev server 的本地演示模式。
- `e2e-cloud-stub` job（`npm run test:stub`）：`tests/e2e-stub/`，跑 `build:stub` 生产构建 + 假 `/web` `/pub` 桩，进云端模式断看板四张图真的建出 canvas 且零未捕获异常（防线轮 K2 新增，专防"单测全绿而线上静默空白"那类缺陷）。
- `visual` job（`npm run test:visual`）：`tests/e2e-visual/`，跑生产构建，判 AA 对比度 / 键盘焦点环 / 图片固有尺寸（CLS 友好）/ 1440·768·390 三档无横向溢出 / 图区底板一致性（第八轮 M4 接入 CI，此前只在本地跑）。

三层共用 `tests/e2e/helpers/watchErrors.ts` 的错误观察器：**未捕获 pageerror 与应用级 console error 一律产断言**（第八轮 H3；此前 4 个 spec 只 `console.log` 到 CI 日志，页面抛错用例照样绿）。dev 专有 CSP 噪声按具体串白名单，跑生产构建的两层不放行该噪声。

三者自第八轮起都列入 `deploy.needs`（此前只有 `build-and-test`，即"红了也照常部署"——见 CHANGELOG 追加十八）。

本地等价门禁一条命令跑完：`npm run verify`（密钥扫描 → lint → 大小写冲突 → **环境变量登记册** → **CSP 静态自洽** → 循环依赖 → 契约漂移 → **文档事实一致性** → schema 漂移 → license → CHANGELOG → typecheck → 测试 → 后端契约 → **Pages Functions 编译** → 未覆盖清单；另两道独立跑：`verify:restore`（备份恢复演练，由 d1-backup 调用）与 `report:catalog`（线上目录事实，由 Uptime 调用，只报告））。

链的**唯一清单是 `package.json` 里的 `scripts.verify`**，上句只是给人看的摘要（摘要漂移无人管，"入口有没有被真跑过"由 `verify:entrypoints` 管，登记册 `docs/cli-entrypoints.md`）。

**新克隆必做**：`git config core.hooksPath .githooks`。`.githooks/pre-commit`（暂存区密钥扫描）与 `.githooks/pre-push`（CI 全绿契约：远端不为绿就不让推）依赖这条本机配置，而它是 git 的本地设置、**不进 clone** —— 没执行的人，这两道闸等于根本不存在（第二十四轮实测：闸本身曾因入口通道静默失效而审错了分支，见 `docs/cli-entrypoints.md` 头部）。

## 备份与恢复（唯一权威：`docs/ci-triage-runbook.md` §8）

每日 04:00（北京）由 `.github/workflows/d1-backup.yml` 导出整库 SQL，**上传前必先过恢复演练**
（`npm run verify:restore`：把 dump 载进一次性内存 SQLite，验 `integrity_check` / 外键 / 表集与
`db/schema.sql` 双向对账 / 载入行数==文本 INSERT 语句数 / `products` 非空）。
过不了就 exit 1 阻断上传——**没验证过能恢复的备份只是愿望**。手动恢复步骤与 sha256 核对法在 runbook。

**2026-09-26 实测更正**：这条链自建成起就没真的备过份——未配 `CF_D1_BACKUP_TOKEN` 时导出/上传两步被 `if` 跳过，
而 job 仍是绿的（连续两晚 success、0 个 artifact）。现在改法是**双向响亮**：备份工作流缺 token 即失败（除非显式设
仓库变量 `BACKUP_SKIP_OK=true`），巡检工作流每天另判一次"最近有没有一次真产出 artifact 的备份"（`npm run check:backup-liveness`，
只看 conclusion 会被骗）。要恢复自动备份：配 `CF_D1_BACKUP_TOKEN` **并**先二选一解决"非 private 不放行明文导出"（转回 private 或导出后加密）。

## 环境变量

**唯一登记册 = `docs/env-vars.md`**（受 `npm run verify:env` 双向对账：代码引用了却没登记 = 红；
登记了但代码已不引用 = 红；漏写「未配置时行为」= 红）。本节不再抄表，只留两条口径：

- 前端构建期变量（`VITE_CB_API_BASE` / `VITE_CB_PUBLIC_API_BASE`）写 `.env`，其余后端 secret
  （`ADMIN_KEY` / 可选 `ADMIN_READONLY_KEY` / `DIFY_*` / `ORDER_WEBHOOK_URL`）经 Dashboard secret 或 `.dev.vars` 注入。
- 新订单通知：配 `ORDER_WEBHOOK_URL`（http/https）后每张**新**订单向该端点 POST 一次最小载荷
  （单号/楼号/金额/件数/状态，**不含微信号与付款截图**）；未配置即纯 no-op，投递失败也绝不影响下单。
  幂等命中的重复提交不重复通知。

## 替换收款码

覆盖 `public/wechat-pay.png` 与 `public/alipay.jpg` 后重新 build + deploy。

## 项目结构

```
functions/           # Cloudflare Pages Functions
  ├── web.js         # 管理 API：POST /web { action, adminKey, payload }
  ├── pub.js         # 公开 API：POST /pub { action, payload }
  ├── _health.js     # 探活：GET /_health
  └── lib/backend.js # 核心业务（鉴权/限流/审计/CORS/各 handler）
db/                  # D1 schema / seed / 迁移 SQL
src/
  ├── pages/         # 页面（全部懒加载 + Suspense）
  ├── components/    # UI 组件（含管理端 InlineEditForm 内联编辑）
  ├── hooks/         # useCart / useProducts
  ├── db/            # 数据访问门面（HTTP API + 缓存 + 本地兜底）
  ├── auth.ts        # 管理端调用 + 字段白名单
  ├── catalogCache.ts# 目录内存缓存（60s TTL）
  └── localStore.ts  # 本地演示模式数据层
tests/               # vitest 单测
public/
  ├── images/        # 商品图 {order}.webp + sm/ 400w 响应式小图
  ├── sw.js          # Service Worker（仅缓存静态资源，build 自动 bump 版本）
  └── manifest.json  # PWA
```

## 关键设计

- 管理端读写均走 HTTP API（`/web`），公开接口走 `/pub`；无 SDK 依赖
- 服务端重算订单金额、字段白名单、图片 scheme 白名单（纵深防御）
- 限流优先 Workers KV（跨实例），KV 异常优雅回退 D1
- 双密钥角色：`ADMIN_KEY`（全权限）+ 可选 `ADMIN_READONLY_KEY`（只读）
- 管理端商品编辑为内联编辑（InlineEditForm），禁弹窗/抽屉
- 接口契约：`docs/api-contract.json` 记录 `/web` 31 + `/pub` 8 共 39 个 action 及其属性（是否写操作 / KV 缓存键 / 限流桶），由 `npm run gen:api-contract` 从源码生成、`npm run verify:contract` 校验漂移，人读版由 `npm run docs:api` 渲染为 `docs/API.md`
- 数据库迁移：`npm run migrate status|apply|baseline`（`schema_migrations` 账目表 + checksum 防改历史），`npm run verify:schema` 拦「迁移未回写 schema.sql」（详见 `docs/adr/0005`）
- 评价晒图：压缩后 base64 入 D1（≤3 图 × ≤800KB，技术债，量大后建议迁 R2）
