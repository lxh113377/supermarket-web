# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

## [未发布]
### 2026-09-26 追加二十五（后台「认证失败」：旧密钥被轮换作废，按用户决定回退 + 红线补上取舍理由）

- **用户报障**：手机微信打开 `supermarket-web.pages.dev/#/admin`，输 `supermarket-admin-2026` 报「验证失败：认证失败」。**不是缺陷**：该值已在 09-25「先轮换再转 public」的安全轮换中被作废。
- **根因按线上实测定位**（不采信文档记载）：同一时刻打 `/web login` 双密钥对照 —— 旧值 `HTTP 200 code=-1 认证失败`、`.dev.vars` 现值 `HTTP 200 code=0`。⇒ 后端与鉴权链完好，纯粹是**用户手上的密码是已作废的旧值**，而 `AGENTS.md` 红线仍写着「固定值…禁止改回随机串」，与 09-25 的实际状态互相矛盾 —— **这条过期指令就是本次误报的直接来源**。
- **处置（用户拍板「改回 supermarket-admin-2026」，风险已在选项里写明并接受）**：`wrangler pages secret put ADMIN_KEY`（`REAL_EXIT=0`）→ 同步 `.dev.vars`（写后回读全等）→ 由 push 触发 CI 重部让 secret 生效（坑 19：Pages secret 部署时注入，不重部不生效）。
- **本轮没有用本地 dist 部署**：实测本地 `dist` 与线上指纹不同（入口 `index-qn5s3Rvh` vs `index-CkEVoWrj`），且**两次读 `dist/sw.js` 的 `CACHE_VERSION` 在 44 秒内变化**（`sm-v1790425412260`→`sm-v1790425455912`）⇒ 并行会话正在重建 dist。此时 `wrangler pages deploy dist` 会把他人在制产物（或坑 31 的半清空产物）推上线，故改走 CI 通道。
- **文档接账**：`AGENTS.md` 红线由「固定值 + 禁止改回随机串」改写为四条可执行口径 —— ①真值只存 Pages secret 与 `.dev.vars`；②**弱密钥是用户的取舍而非待修缺陷，禁止 agent 擅自加固**（并列出 08-23 / 09-05 / 09-25→09-26 三轮反复的实测来历，让下一任不再"好心"轮换第四次）；③唯一必须轮换的场景 = 转 public/共享之前，且轮换后必须重部；④判"密码错还是文档旧"只认 `curl /web login` 的 `code`，不认文档。`HANDOFF.md` 凭证表同步更正（原写「64 位随机串已轮换、旧值作废」，回退后即为假信息）。
- **残留风险（如实登记，不粉饰）**：现值明文存在于本仓 **10 个历史提交**（最早 `wrangler.toml` 的 `[vars]`，`4034aff` 才改掩码），本仓为 public ⇒ 任何翻历史者可进后台改价、删单、读取订单内的房间号/微信号（**含第三方个人信息**）。彻底收口需 `git filter-repo` 重写历史 + force-push，或把仓转回 private（转回即重新受 Actions 分钟计量约束）；两者均为破坏性/权益性操作，**待用户点头，本轮未做**。

### 2026-09-26 追加二十四（对标第十二轮：备份链一直在"绿色零备份"，以及"注释冒充判据"）

- **本轮最重要的一个发现是坏消息**：用 API 核 `D1 Daily Backup` 的真实历史 —— 自建链（09-24）以来**共 2 次 run，`conclusion` 都是 success，但 `Export remote D1` 与 `Upload backup artifact` 两步全是 `skipped`，artifact 数为 0**。根因是未配 `CF_D1_BACKUP_TOKEN` 时 `Detect backup token` 只发一条 `::warning::`，下游一律 `if: found == 'true'` ⇒ **沉默跳过 + 报绿**。⇒ 生产库**从未被这条链自动备份过**，而所有人看到的是绿的；盘上唯一真备份是 09-25 的手动导出物（`../_backup/supermarket-d1-pre-specoptions-20260925-184136.sql`，1,449,663B）。这也**纠正了第十一轮我自己写下的说法**（我写的是"非 private 会先响亮失败"）—— 守卫确实会拦，但它带 `if: found == 'true'`，token 缺席时**守卫本身也被跳过**，所以响亮失败从未发生。
- **R12-H1 备份链存活判据（`scripts/check-backup-liveness.mjs` + `npm run check:backup-liveness`）**：不看 conclusion，看**产物与步骤实况**——要求存在一次"导出步骤 success + artifact ≥ 1 + run success"的 run 且在 2 天内；`runs` 为空 ⇒ 判红（零输入不记绿）；把"success 但 0 产物"的次数摊成 WARN 让形状可见；workflow 标识默认用**文件名** `d1-backup.yml`（实测 API 支持，免再往仓库塞数字 ID 变量）。接进 `Uptime`（每日），并配 job 级 `permissions: actions: read` + step 级 `GH_TOKEN`（第十一轮 pr-advisory 空转的直接复用）。12 条夹具（`tests/backupLiveness.test.js`，含 CLI 三档退出码与 fixture 注入面）。
- **R12-H1b 沉默跳过改成响亮失败**：`d1-backup.yml` 新增 `Fail loudly instead of reporting a green no-op` step——未配 token 且未设仓库变量 `BACKUP_SKIP_OK=true` ⇒ `exit 1`。**默认状态是响亮**，要安静必须显式表态（"沉默跳过"就是本次事故的成因，不能继续占默认位）。
- **R12-H3 catalog 接成阻断**：第十一轮定的"两轮无误报样本"条件已满足（本机 + Uptime run `36240825097` 逐项一致：28/54、漂移 27+1+22、重复 3+3）⇒ 摘掉 `continue-on-error`。硬不变量违反与取不到数据都会红；漂移仍只打印。
- **R12-H4 三条 cron 两两互指**（子代理评审反哺，先核指控再改）：`d1-backup.yml` 新增 `Cross-check the daily probe is still running`（`LIVENESS_MODE=presence`，只认"有没有按时成功跑过"），job 级补 `permissions: actions: read` + step 级 `GH_TOKEN`。动因是官方行为里那条最阴的：**public 仓 60 天无仓库活动会自动禁用 schedule**，届时什么都不会红。同轮接受两处对我新判据的正当指控：① `stepsOk` 原本"无步骤明细即通过"是 fail-open ⇒ 改为"有明细必须真成功、无明细只由 artifact 定性并**计数出 WARN**"；② 取数无窗口 ⇒ 一次 push 风暴可把 scheduled run 挤出 `per_page`，改为 `created>=` 窗口 + 新增**调度层断言**（窗口内至少要有一次 scheduled run，且最近一次龄期 ≤ 2 个周期 + 1 天缓冲；刻意不用"应有 N 次"的计数分母，因为刚建链的 workflow 天然凑不够次数会把真话报成假红）。契约测试同步加两条（互指步消失／presence 模式缺失都要红）。
- **两处自纠（都留了常驻夹具）**：① **注释冒充判据**——存活契约的反例首跑"抽掉 `actions: read` 却测不出问题"，因为我写的 YAML **注释**里就有 `actions: read` 字样，裸子串匹配把它当成了配置行。正解＝判据一律用**行首锚定的键形态**（`^[ 	]*actions:[ 	]*read[ 	]*$`），注释不参与。② **CRLF 又咬了一口**——变异正则 `/ +actions: read
/` 在 CRLF 工作文本上匹配不到 ⇒ "抽掉"成了空操作、反例假过；现在夹具先把 texts 归一再改。
- **本轮明确不做**：把备份产物搬到 R2/外部存储（需人开桶并决策）、把仓库转回 private（需人）、给 Uptime 加第三方心跳（ntfy/pushover/healthchecks.io 都要新 secret 与外部依赖；本仓已有 GitHub 失败邮件这一条可达通道，先用它，等出现"邮件没到"的证据再谈第二通道）。


### 2026-09-26 追加二十三（对标第十一轮：备份必须先被证明可恢复 + 一次"测错机制"的自纠）

- **对标切面换成"可恢复性与数据面"**，取证 9 仓（`agentic-qe`、`mattermost`、`restic`、`pgbackrest`、`Telegram-Drive`、`EasySchematic`、`frankensqlite`、`litemall`/`saleor` 种子面）。两条硬事实：① `proffesor-for-testing/agentic-qe scripts/aqe-db-backup.sh:56,58,89-90` 是"导出前查 `integrity_check`、不合格丢弃并保留上一份好备份、**恢复入口再查一次**"；② 公开可见的 **D1 备份 workflow 无一家做到"载回并断言"**（`caamer20/Telegram-Drive supporter-backup.yml:63-66` 停在 `test -s` + `grep CREATE TABLE`；`duremovich/EasySchematic backup-d1.yml:59` 下载回来也只 `ls -lh`）⇒ 本轮这一条是补空白。
- **R11-H1 备份恢复演练判据（`scripts/verify-backup-restore.mjs`，`npm run verify:restore`）**：把 dump 完整载进一次性内存 SQLite（`node:sqlite`，零依赖不落盘），断六条——载入不抛错 / `integrity_check=ok` / `foreign_key_check` 零行 / 表集合与 `db/schema.sql` **双向**对账 / `Σ行数 == 文本 INSERT 语句数`（计数按**语句级**而非行首匹配，防"值里含 INSERT INTO 字样"与"一行两条语句"两种失真）/ `products` 非空。`0` 可恢复、`1` 不过、**`2` 文件缺失**（`frankensqlite` 那种 `exit 0` 是明确反例）。接进 `d1-backup.yml` 且**排在上传之前**，顺序本身由 `ciWorkflow.test.ts` 新组钉住（演练放上传后面 ⇒ 判据点名）。15 条夹具（`tests/backupRestore.test.js`，含 CLI 退出码三条；生产 dump 有客户数据，夹具改用 `node:sqlite` 现造库 + mini-dumper，**不进仓**）。
- **首跑就抓到一处真缺陷**：`schema_migrations` 一直只由 `scripts/migrate.mjs` 运行时 `CREATE`，从未进过全量真相源 `db/schema.sql` ⇒ 判据报"备份里出现 schema.sql 之外的表"。修法是把 DDL 补进 `db/schema.sql`（补真值面），不是放宽判据。真实生产 dump（`_backup/…20260925-184136.sql`，1,449,663B / 949 条 INSERT）现在全过：10 表、`integrity=ok`、`fk=0`、Σ行数 949 == 文本语句数。
- **R11-H2 一次"测错机制"的自纠（本轮最该记的方法账）**：我先用 markup `style=` 属性做探针，在 `style-src 'self'` 下测出"被拦"，据此断言**线上那 8 处 React 内联样式全是死样式**，并已动手把 7 个文件改成走类名。复测才看清 CSP 的两副面孔：`markup / setAttribute('style',…)` ⇒ 拦（computed 回落 + 报违规），`el.style.setProperty / el.style.x=` ⇒ **放行**，而 React 走的是后者。⇒ **全部回滚**（`git checkout` 5 个文件），改成立得住的三件：① `npm run verify:csp`（静态 HTML 面：CSP meta 必在、`style-src`/`script-src` 无 `unsafe-inline`/`unsafe-hashes`、静态 HTML 不带 `style=` 与 `<style>`，9 条夹具 `tests/cspStaticGate.test.js`，进 `verify` 链与 CI）；② 生产构建上的正向事实判据（`tests/e2e-visual/layout.spec.ts` 用真实内容 `[data-related-list]` 证明 CSSOM 路径生效：`list-style:none` + `margin-top:0px`）；③ 明确**不在应用 spec 里复现"被拦"那一半**——它会给被测页注入一条 CSP console 错误，被 `watchErrors.assertClean()` 判成应用缺陷（第一版就是这么红的）。教训：**测错机制＝得出相反结论**；探针必须打在"被审对象实际走的那条路径"上。
- **R11-H3 目录事实对账（`scripts/check-catalog-facts.mjs`，`npm run report:catalog`）**：把挂了十几轮的"D1↔seed 对账 + 28/55 口径"变成机器输出。真跑一次即得：**线上公开 28 条 / `db/seed.sql` 54 条**、只在 seed 27 项、只在线上 1 项、**价格不同 22 项**、同名重复 seed 3 / 线上 3。分两面：硬不变量（空目录 / `_id` 重复 / `name` 空 / `price` 非法 / 公开接口含下架项 / `subcategories` 未解码）违反 ⇒ `exit 1`；漂移 ⇒ 只报告（生产数据本会漂，判红等于逼运营回滚）。取不到数据 ⇒ `exit 2` BLOCKED，不记绿。13 条夹具。**判据自身也被自己的首跑纠正了一次**：先用 api 形状判 seed ⇒ 54 行全红，实为 `subcategories` 在 DB 里是未解码 JSON 文本 ⇒ 改成 `'api'` / `'db'` 两种形状分开判（混用会同时造成假红与漏判），并把这条差异写进夹具。CI 侧接在 `Uptime` 工作流末尾，`continue-on-error: true`（新指标先量误报率再接闸）。
- **R11-M1 了结第九轮遗留**：色块轴 `kind:'color'` / `swatch` **全站零数据**（`swatch` 只活在组件与类型里）⇒ 连同 `VariantPicker` 那段恒真三元（两个分支同一个类名）、`tests/variants.test.ts` 的空转断言、`layout.spec.ts` 的 `test.skip` 一起删净（断言换成"每个轴每个选项都有 label"这类真判据）。视觉门禁从 15 通过 + 1 skip 变成 **16 全通过**。恢复演练与手动恢复步骤写进 `docs/ci-triage-runbook.md` §8（含 sha256 核对与 `--remote` 覆盖式恢复的警告）。
- **本轮明确不做（带证据）**：pgbackrest 分页校验和清单（TB 级页面备份的仪式，本库 1.4MB）、restic 全量 blob 可达性扫描（无多代快照可扫；但**采纳它 `checker.go:225-227` 的自我克制**：不断言 `SUM(totalAmount)` 这类派生聚合，只断言结构性计数）、mattermost 全链路 bulk round-trip（要起实例+对象存储）、`wrangler d1 execute --local` 回灌（会污染本地持久化目录，直连 `node:sqlite` 更干净）、仓库转回 private 或上 R2（需人决策）。
- **本机全绿而 CI 判红的一次实况（PR run `36240380871`）**：`npm run verify` 本机 `exit 0`（72 文件 / 790 用例），ubuntu runner 上 `build-and-test` 却红在 `Cannot bundle Node.js built-in "node:sqlite" imported from scripts/verify-backup-restore.mjs` —— 新写的判据测试跑在默认 **jsdom** 环境，而它们 import 的脚本链上带 `node:sqlite`；本机 Vite 放行、Linux 拒绝。修法不是放宽判据而是**把环境声明对**：`tests/backupRestore.test.js` 与 `tests/catalogFacts.test.js` 顶部加 `// @vitest-environment node`（节点级判据本来就不需要 DOM）。⇒ 与第八轮"过期 dist 假绿"同族：**本机绿不构成完成证据，接进 CI 后必须真跑一次**；另记一条新规矩：**节点级脚本测试一律显式声明 node 环境，不蹭默认 jsdom**。
- **advisory 定案**：`pr-advisory` 保持报告型。理由是证据不足而非偷懒——真跑样本仅 2 次（1 次空集、1 次把纯文档 PR 正确归类），且本仓无多人 PR 流；阻断版必须先有 label 逃生门（照 workers-sdk `ci:no-tests`）。
- **本机门禁（实跑非预写）**：`npm run verify` 见 §本报告 §6（新增 `verify:csp` 一道，单测 72 文件）。


### 2026-09-26 追加二十二（对标第十轮：通知类副作用的"未配即关" + 把三条判据拆成可反证的纯函数）

- **对标系换面**：这轮专挑"投递副作用"和"PR/门禁层"两件事取证，九仓实测开文件（子代理给的行号逐条复核，其中 litemall 的包路径它写成 `com.qiao.litemall`、实际在当前 master 是 `org.linlinjava.litemall.core.notify` —— 机制属实、路径已纠）。拿到三条硬事实：① `litemall NotifyService.isMailEnable()` = `mailSender != null`，未配置时 `@Async` 方法直接 `return`，**不改状态、不耗重试**；② `saleor` 把投递结果写成 `EventDelivery`/`EventDeliveryAttempt` 两张表 + Celery `retry_backoff=10, max_retries=5`，即"要它的重试语义就得加持久化登记表"；③ **medusa 是反面参照** —— provider 未启用时它写一行 FAILURE 并 `throw`，"没配置也改状态、也消耗重试"，与我们要的语义正好相反。另 `workers-sdk` 把门禁逻辑写成**导出纯函数 + 自带 `__tests__`**（`tools/deployments/validate-changesets.ts:18`），这正是本轮三条判据拆纯函数的依据。
- **R10-H1 新订单通知 webhook（`functions/lib/notify.js`）**：三条不变量各配正反用例（`tests/orderNotify.test.js`，16 条）。未配 `ORDER_WEBHOOK_URL` ⇒ `webhookTarget` 返回 null，纯 no-op（连 promise 都不创建）；非法 URL / `file:` / `data:` 协议一律视同未配置；投递失败（非 2xx、网络抛错、4s 超时）全部收敛成结论对象，**不冒泡到下单**（挂 `context.waitUntil` 保活，响应先返回）；载荷白名单 6 个字段，微信号/备注/**付款截图**（可达 800KB 的 base64）都不外发。**两个下单出口一处适配器**（`/pub` 顾客下单、`/web` 管理端代客下单共用 `maybeNotifyNewOrder`，防"修一例不修一类"）；`deduplicated` 命中不通知——重试同一张单不该重复提醒。
- **R10-H2 parity 判据拆成纯函数 + 常驻反例（补上第九轮自己记下的缺口）**：`scripts/verify-release-parity.mjs` 的判定搬进导出的 `evaluateParity()`（脚本仍在 CLI 时执行，靠 `fileURLToPath(import.meta.url) === resolve(process.argv[1])` 判"是不是被直接调用"，Windows 盘符大小写已归一），新增 `tests/releaseParity.test.js` 11 条，把上一轮明说"本机凑不出、永远未覆盖"的 **bundle 不同名** 分支连同不可达、起点过旧、批次偏移、公开目录为空一起钉住。变异实测：把 bundle 比较改成恒假 ⇒ 恰好 3 条红（含"问题不重复记账"）；改起点检查恒假 ⇒ 对应条红。顺带消除一处隐患：重试阶梯与终判此前是两套条件，现共用同一函数（两套条件一旦漂移就会出现"阶梯以为一致、终判却报红"）。
- **R10-H3 环境变量登记册门禁（`scripts/check-env-docs.mjs` + `docs/env-vars.md`，`npm run verify:env` 已进 `verify` 链与 CI）**：动因是本轮自己踩出来的——新增 `ORDER_WEBHOOK_URL` 时"未配即 no-op"本来只写在代码注释里。现在 `functions/**` 的每个 `env.X` 与 `src/**` 的每个 `VITE_*` 必须有一行登记，反之登记册不许留死行，且**每行必须写「未配置时行为」**（对标组实测 0 家把这条承诺变成判据）。首跑即抓到 5 个此前从未进任何文档的变量（`ADMIN_READONLY_KEY`/`ALLOWED_ORIGINS`/`DB`/`RATE_KV`/`CF_PAGES_COMMIT_SHA`），逐条读码核实降级行为后入册（`process.env.X` 用 `(?<!\.)` 排除，防把 CI 进程环境当 Pages 变量要求登记）。夹具 `tests/envRegistryGate.test.js` 15 条，变异实测：去掉"死文档"检查与去掉"未写未配置行为"检查 ⇒ 各红 1 条，精确命中。
- **R10-M1 workflow 模板注入自查（零依赖替代 zizmor）**：`tests/ciWorkflow.test.ts` 新增一组（该文件 15 → 20 条）：`run:` 块内插值不可信上下文（`github.event.*` / `github.head_ref` / `github.actor`）即判红，正确写法是先 `env:` 映射再引 `$VAR`；本仓 4 条 workflow 实测干净（`GITHUB_EVENT_BEFORE`、`GITHUB_HEAD_SHA` 两处都在 env 映射里）。**不装 zizmor** 的理由如实记下：它最高价值那条（action 未钉 SHA）本仓已消灭，装上换来的主要是每 PR 多一个 job + 一堆 `# zizmor: ignore` 注释税。夹具双向验：注入两条坏样本必红、`env:` 正确写法与注释里的 `github.event` 不误伤、另有"分母非空"反向钉（万一 ci.yml 不再使用 `github.event.*`，判据退化成空转真时会响）。
- **R10-M2 「PR 带没带回归手段」报告型判据**（`scripts/check-pr-has-tests.mjs` + `dispatch.yml` 新 job `pr-advisory`）：照 `workers-sdk validate-pr-description.ts:54` 的思路，但**按「新指标先量误报率再接闸」的规矩只做 advisory**（永远 exit 0）。放 `dispatch.yml` 而非 `ci.yml` 的原因是实测：ci.yml 的 token 只能 `contents: read`，用它调 `GET /pulls` 会 403，而 dispatch job 有 `GH_TOKEN` 可跑 `gh pr list`；取不到就打印 `SKIPPED` 而不是静默判绿。夹具 7 条含"dependabot 那种纯 lockfile PR 不该被骚扰"。
  - **首跑（run `36237222557`）当场暴露它自己没接线**：CI 里输出 `[pr-advisory] SKIPPED 取不到 PR 列表（gh 不可用）` —— 那个 job 只给了 `contents: read` 又没把 `GH_TOKEN` 传进 step，`gh` 在 runner 上等于未鉴权。**"永远 exit 0"的判据最阴的失效方式就是不红地永久空转**，本轮的脚本按设计不红 ⇒ 只能靠接线契约钉。修法：`permissions` 补 `pull-requests: read` + step 显式 `GH_TOKEN: secrets.GITHUB_TOKEN`，并新增 `advisoryJobProblems()` 断言（三项缺一即红：缺 token／缺读权／不再调用该脚本／job 整个消失），另配四条反例夹具（`ciWorkflow.test.ts` 24 → 26 条）。
- **本轮明确不做（带证据，非拖延）**：① `.github/settings.yml` 式"分支保护即代码"——9 仓 recursive tree grep 全 404，零家做，且本仓单人直推 main，真风险是配置漂移不是漏设；② vite 的 `test-passed` 聚合必检 job（实测存在，`vitejs/vite ci.yml:141-150`）——本仓没有必检配置，加两个 job 只换来配额消耗（本账号 09-25 刚出现过 0-step 停摆窗口）；③ changesets——单包应用用它等于每 PR 多一个必填文件；④ playwright 加权分片 / flaky 看板——5～7 个浏览器用例撑不起开销；⑤ `EventDelivery` 式投递登记两张表——没有常驻消费者，加了也没人重放，反而多一份 D1 写放大。
- **⚠️ 合并后现场把 github.io 链路弄坏了一次（本轮最该记的自纠）**：PR 合并（`a000850`）后 `dispatch.yml` run `36236818742` **failure 且 jobs 数组为空** —— 我用脚本插 job 时把整块插到了顶层 `jobs:` **之前**（落在 `permissions:` 段里），GitHub 因此一个 job 都排不出来 ⇒ main 的 CI success、pages.dev 已发新构建，而顾客端**没被触发**，两端当场进入半发布态（正是 `release-parity` 该报红的那一类，它随即在跑）。根因不是"手写错缩进"，是**这条链上没有任何判据管 job 到底在不在 `jobs:` 里**：`ciWorkflow.test.ts` 断言了 needs/SHA/step 名/权限/插值位置，唯独没断言排版骨架。修法＝① 搬回正确位置；② 补两条最小不变量（顶层键必须是 Actions 合法字段；任何 `runs-on:` 必须出现在顶层 `jobs:` 之后），并**用当时那份坏文件复跑验证**：重新制造同一缺陷 ⇒ 判据点名"第 28 行 runs-on 出现在 jobs: 之前"，还原 ⇒ 绿。教训与第九轮同族：**能被脚本插错的位置，就必须有判据钉住它**（否则下一次换个人/换个脚本还会犯）。
- **R10-M3 K4 PR 流试点**：本轮全部改动改走"分支 → PR → CI（含 release-parity）→ 自并"，不再直推 main（过程与结论见 `memory/07-next-steps.md` 同日条目）。



### 2026-09-26 追加二十一（对标第九轮：把"门禁链自己"和"两端发布结果"变成被测对象）

- **对标系与打法升级**：本轮不再比"谁的门禁多"，而是深挖**机制怎么落地**。八仓实测到的三件可借鉴物：`microfeed` `tests/unit/ci-workflow.test.ts`（把工作流文件当被测对象：step 顺序、secret 白名单**全等**、`not.toContain` 危险写法）、`vendure` `.github/workflows/scripts/dependency-impact.test.js`（CI 脚本自带测试，含 mock 掉 `gh` 二进制 + 注入 HTTP 失败）、`saleor` `.semgrep/`（每条规则同时带"必须命中 `ruleid`"与"必须不命中 `ok`"两类样本，另有 `.fixed.py` 断言自动修复产物）。另记两条**否定式**结论：跨两个托管目标做发布一致性核对 **8 家 0 有**；mutation testing（stryker/mutmut/infection）**8 家 0 有** ⇒ 这两项做了是领先，不是补差距。
- **R9-H1 新增两份常驻自测（`tests/ciWorkflow.test.ts` + `tests/gateFixtures.test.ts`，合计 26 条）**：
  - `ciWorkflow.test.ts` 解析 `.github/workflows/*.yml` 断言：CI 恰好这 5 个 job、**`deploy.needs` 必须覆盖全部判据 job**（缺一个就点名"这些判据 job 红了也照常部署"）、15 处 `uses:` 全为 40 位 SHA 且保留版本注释、无明文密钥（`ADMIN_KEY` 根本不该出现在 workflow）、12 个关键 step 名一个都不能少、CHANGELOG 门禁必须拿到 `GITHUB_EVENT_BEFORE`、Build 必须烘焙两个 `VITE_CB_*` 端点、每仓顶层 `permissions` 不得含 write、**并发组规则按真不变量收窄**（只有能跑 PR/多 ref 的 workflow 才要求 `cancel-in-progress: true` 时按 ref 分组）、`.github` 静态件结构 + 常驻坏样本。
  - 这条直接钉死本仓两次踩过的假安全感：`deploy.needs` 从 09-24 起注释与 CHANGELOG 都写"具备阻断力"，而 needs 里实际只有 `build-and-test`（防线轮才接上）。**注释说阻断 ≠ 真阻断，现在由机器说。**
  - `gateFixtures.test.ts` 给门禁脚本配两侧夹具：`scan-secrets` 植入 AWS 形态必须红 / 干净仓必须不红 / `API_KEY=your-secret-here` 占位符不得误伤；`check-changelog` 无记录改 src 必须红 / 带记录必须绿 / **push 区间把 src 改动藏在末位 docs 提交后仍必须红**（第九轮补上第八轮 M1 的自证）；`check-doc-consistency` 缺生成物必须 exit 2 而非静默 PASS；`check-case-collision` 索引内互撞必须红（夹具用 `git update-index --cacheinfo` 造第二条异 Case 项——Windows 上文件系统造不出两个文件，只塞一条是**假反例**）+ 正向对照不红 + 对本仓跑必须 0。
- **R9-H2 双端发布一致性从人工收尾变判据（`scripts/verify-release-parity.mjs` + deploy 后置 step）**：第八轮及以前每轮手写"两端 `sw.js` 指纹 + bundle 同名"，属人工动作；`dispatch.yml` 是独立 workflow ⇒ CI 绿不等于两端同步（坑 36）。现在断：两端 `CACHE_VERSION` 形状合法、**都晚于本次发布起点**（deploy job 起始 step 输出 epoch，故能区分"两端都刷新"与"只新了一端"）、两者相差 ≤6h 同批、入口 `index-*.js` 同名、`/pub getPublicProducts` 条数 >0；CDN 传播按坑 32 给重试阶梯。**只报事实不回滚**（回滚仍只由 smoke 失败触发，避免双触发把生产反复翻面）。四向实测：正例 rc=0（指纹 `sm-v1790403446818`、bundle `index-CwPZhV2W.js`、28 条）／真实 github.io 本机不可达 rc=1 且指名哪端／起点设为未来 rc=1 两端都判旧／缺 `PARITY_AFTER_TS` rc=2 拒绝"看起来一样就放行"。**未独立命中的分支**：bundle 同名不一致（本机只有 pages.dev 可达，凑不出两端不同构建），留 CI 首跑覆盖。
- **`.github/ISSUE_TEMPLATE/` 新增**（bug / feature / config 三件，实测对标组 4/8 有任意模板、CoC 只有 vendure 1/8 ⇒ 模板是真短板，CoC 不是差距，本轮不做 CoC 并记此由）。表单强制写清"哪个端 / 云端还是演示模式 / 不贴个人信息"，并把本仓规矩写进验收栏（"没有回归手段就不改"）。feature 表单首稿把 `attributes:` 缩进写坏，顺手给 `.github` 加了结构判据 + 常驻坏样本；**该判据第一版又写严了**（要求 `attributes:` 紧跟 `- type:`，而 issue-form 的合法顺序是 `type → id → attributes`，结果把两份合法模板全判红）—— 已改为"块内存在正确缩进的 `attributes:`"，并加常驻正样本 `type→id→attributes` 钉住这次过严（过严的判据与缺失的判据一样有害）。
- **覆盖率棘轮 statements 78 → 79**：按台账要求的**连跑 5 次全量 `--coverage`** 定档 —— 81.11 / 76.74 / 82.79 三项逐位一致，branches 在 74.44↔74.48 抖 0.04pt（同一条 5s 轮询时序分支），故 branches 仍用最小观测值 −2pp = 72 不动。
- **N4 结论：本轮不改执行模型（有据不改，非拖延）**。5 连跑在低负载下 **rc 全 0、63 文件 / 657 用例全绿、wall 29s(冷)→10~11s、OOM 命中 0、timeout 命中 0**；而第八轮记的 OOM 发生在我同时跑浏览器套件/并发任务期间 ⇒ 判定为**并发负载诱发**而非默认链缺陷。vitest 每次仍提示"jsdom 建了 63 次占 63% 时间"，故把 `pool:'vmThreads'` / `isolate:false` / `maxWorkers` 保留为"仅当无人值守也复现 OOM 时才动"的备选，且仍禁止抬 `testTimeout` 掩盖机制缺陷。
- **⚠️ R9-H2 首版被 CI 首跑打回（判据对、位置错）**：我最初把双端一致性挂在 `ci.yml` 的 deploy job 尾部，run `36232597018` step 7 **failure** 而 step 6 冒烟 success：runner 上两端都 `http 200`，pages.dev 指纹 `sm-v1790414640778`（本次）、github.io 停在 45 秒前的 `sm-v1790414596219`（上一批），复取 6 次跨 247s 仍不同。根因是**并行**：顾客端由 `dispatch.yml` → 对端 `deploy.yml` 重新 checkout+build+publish，再加 Pages 边缘 2–3 分钟传播（坑 32），pages.dev 的 deploy job 等不到它。⇒ 搬进独立 `.github/workflows/release-parity.yml`（`workflow_run: CI completed` + 仅 CI success 才核 + 阶梯 12 次 ≈17 分钟 + 基线取**发布提交的 `%ct`** 而非本步起始时刻，否则会把上一批构建误判成"已刷新"），并只报警不回滚（回滚仍只由本端 smoke 失败触发）。同时给 `ciWorkflow.test.ts` 加一条**反向钉**：`deploy` job 里不许再出现 `verify:parity`。
- **本轮三处"过严判据"自纠（与缺失判据同样有害，均留常驻样本）**：① `.github` 结构判据首版要求 `attributes:` 紧跟 `- type:`，而 issue-form 合法顺序是 `type → id → attributes`，把自家两份合法模板全判红；② `release-parity` 的"git 前必须 checkout"正则无法判断位置，把合法的 `- name: Fetch release commit` + `run: git fetch` 也判红，已删并只留"首步是 Checkout"这一条不变量；③ `runGate` 首版只改 cwd，而门禁脚本按**自身文件位置**锚仓库根 ⇒ 扫的仍是真仓（症状：输出"已跟踪 530"），改为把脚本复制进夹具仓。
- **另一处必须记的现场拦阻**：夹具里那枚"AKIA + 16 位"形态的假密钥字面量被**本仓自己的 pre-commit 密钥扫描拦下**（提交失败），而 `npm run verify` 此前是绿的 —— 因为 `scan-secrets` 扫 `git ls-files`，**未跟踪文件不在覆盖内**。正解不是 `--no-verify`，而是运行时 `join` 拼形、静态源码不留完整形态（夹具仓里仍是完整形态，判据照样必须红）。本条 CHANGELOG 首稿因原样引用该字面量，被同一个门禁**第二次**拦下 —— 文档里也不留完整密钥形态，这条纪律连自己写的说明也管。
- **本轮未做（如实）**：新订单 webhook 通知（对标件已定位：`minshop` D1 outbox + `env.EMAIL` 未配即 no-op 并带"未启用不发也不消耗重试"的反例、`litemall` `NotifyService` 的 `isMailEnable()` 同形）—— 它要动下单主链路，留作独立一轮，不与其他项混提；`diff-cover` 维持第八轮结论（实测 **0/8 家在 CI 卡覆盖率**，且本机无该工具、装它属新增系统依赖，不静默安装）；R2 / 真支付 / 多租户 / i18n 维持"场景不适用"。
- **门禁全绿（本机实测，非预写）**：`npm run verify` **exit 0** —— lint 0 warning、大小写冲突 0、契约 44 通过、文档事实 7 项（其中"单测文件数 65"这一项**当场拦住我没同步 README**）、schema 漂移、license 10/10、typecheck 双配置、**65 文件 / 683 用例全过**、`verify:backend` **109/0**、Functions 编译 88,650B、`check:size` 3/3；三层浏览器门禁 22 / 15+1skip / 3。


### 2026-09-26 追加二十（对标第八轮：换同架构对标系 + 把五处"承诺已写、判据未接"接上闸）

- **对标系换血**：引入与本仓**同栈**的三个开源项目作主对标 —— `dreamhunter2333/cloudflare_temp_email`（11,845★，Pages Functions + D1 + KV + R2）、`microfeed/microfeed`（4,095★，Workers + D1 + R2 + Queues）、`ddyy/minshop`（158★，ecommerce + D1 + R2 + Workers + Stripe + MCP）。前七轮只比 litemall/Medusa/Saleor/Vercel Commerce/Vendure（清一色服务端重型平台），可比维度越比越窄。数据 2026-09-26 `gh api` 实测（认证态，9 仓全部 HTTP 200，递归树 `truncated:false`）。
- **纠偏两条既有判断**：① 前轮把"无 Lighthouse 指标预算"记为差距 —— 本轮实测 **9 个仓的 workflow / package.json 里 0 家卡 Lighthouse·web-vitals·size-limit·treo**（连 `budget` 字样都没有；Saleor 卡的是服务端迁移性能），它不是相对差距，降为自选动作；② 派出的调研 agent 建议"借鉴 saleor 把 actions 钉到 SHA" —— 主进程实测本仓 `ci.yml` 12 处 `uses:` **已全部钉 40 位 SHA**，该条作废。**同轮自查出一条自己造的假缺口**：H1 声称"CI 没跑 `verify:backend`"，实为我 grep 的是 npm 别名、CI 写的是脚本路径（`ci.yml:103` `node scripts/verify-backend.mjs` 一直在跑），已撤回不改。
- **H2 新门禁 `scripts/check-doc-consistency.mjs`（对标 microfeed 的 `docs:check` step）**：README/ARCHITECTURE 里可静态派生的数字必须等于真相源 —— `/web`·`/pub` action 数取自 `docs/api-contract.json`、棘轮阈值取自 `vite.config.js`、单测文件数取自磁盘、文档内链逐个 `existsSync`。**实测抓到的四处漂移（全部已改）**：徽章写死 `tests-176 passed`（同文件另一行写 631，真值数百）、README 与 ARCHITECTURE 各写 `/web 管理 30 action`（契约实测 **31**）、README 写 `e2e 20 用例`（实测 22）。按"派生不复制"处置：三处写死的用例数一律拆掉，改为指向当场输出。反例已实跑：把 31 改回 30 + 把数字徽章塞回 → **FAIL 3 项并精确指到 `README.md:17` / `ARCHITECTURE.md:16` / `README.md:6`**，复原后 OK 7 项。
- **H3 浏览器错误观察器收口（`tests/e2e/helpers/watchErrors.ts`）**：修复前 `tests/e2e/{smoke,order-flow,product-detail}` 与 `tests/e2e-visual/layout` 的 `page.on('pageerror')` 只 `console.log` 到 CI 日志、**从不产断言**（那四个文件另有 15/54/9/57 处 `expect` 也拦不住页面抛错）。现统一走 `watchErrors(page).assertClean()`，dev 专有 CSP 噪声按具体串放行、跑生产构建的两层不放行。唯一正确形态原来只存在于桩 spec，一并改接同一实现（顺带修掉它对"reload 后需重新挂监听器"的误解 —— 页级监听器不随导航失效，重复注册只会让错误重复计数），并把错误断言从"只有第一条用例查"扩到 `afterEach` 全覆盖。验证：dev 22/22、生产视觉 16/16、桩 3/3 全绿；反例三条实跑 —— 注入 pageerror 红、注入 `console.error` 红、404 资源噪声不误伤仍绿。
- **H4 新门禁 `scripts/check-functions-build.mjs`（对标 microfeed 的 "Verify the Worker bundle"）**：`npm run build` 只编译 `src/`，`functions/` 全在 vite 视野外，绑定名/入口语法错此前要等到真部署才炸。Pages 子命令**没有** `--dry-run`（实测 `wrangler pages deploy --help` 零命中），故用 `wrangler pages functions build`：零鉴权、零网络写、不建任何 Cloudflare 资源；三条结构断言 = 退出码 + 产物 ≥40KB（实测 88,650B，防"编译成功但什么都没打进包"）+ `/web`·`/pub`·`/_health` 三个路由字面量齐备。反例两条实跑：`functions/` 内 import 缺失模块 → `Could not resolve` 非零；把 `functions/_health.js` 改名 → 报「找不到路由字面量 /_health」exit 1，复原后复跑 OK。
- **H5 修一类不修一例（收第七轮 N1）**：`src/localStore.ts` 是全站**唯一** import `data/products-seed` 的文件（实测 grep 仅 1 命中），四个数组读出口里 `getLocalCategories()` 是唯一直返模块引用的（其余三个都过 `cloneArray`）⇒ 任何一处原地 `sort/push/splice` 就把整个会话的分类种子改掉。改后补 3 条用例（新容器 / 原地改动后种子不变 / 连续两次读不同引用），反例实跑：改回直返 → **3 条全红**，复原后 32/32。
- **M1 CHANGELOG 门禁补 push 区间**：此前 push 固定 `HEAD~1` ⇒ 一次 push 带 N 个提交只校验末位那个，"把 src 改动藏在一个纯 docs 的末位提交后面"即免门禁。现优先用 webhook 的 `before..HEAD`，`before` 缺失/全零（新建分支）/加深后仍不可达（强推）⇒ **显式告警后**回落 `HEAD~1`，绝不静默当"无改动"。三态实跑：带 before 走整段区间 ✅、无 before 回落且仍然拦下未写记录的改动、全零 before 告警回落。
- **M2 新门禁 `scripts/check-case-collision.mjs`（收第七轮 K7）**：第七轮我在 Windows 上新建 `tests/productsTab.test.tsx` 静默覆盖了已跟踪的 `tests/ProductsTab.test.tsx`（同一 inode，`git status` 只显一个 `M`），4 条在制用例没了。现按两条判据查：索引内互撞、未跟踪文件大小写不敏感撞已跟踪路径。反例在 Windows 上**造不出来**（大小写不敏感 FS 生不成两个同名文件 —— 这正是事故成因），故在仓库外临时仓用 `git update-index --cacheinfo` 造真冲突 → 精确报 `tests/Foo.test.ts ⇄ tests/foo.test.ts` exit 1；本仓实跑 OK（已跟踪 525 / 未跟踪 6）。
- **M4 视觉层进 CI + 断掉"测旧产物"的通路**：新增 `visual` job 并入 `deploy.needs`（现 4 个 needs）；`playwright.visual.config.ts` 的 `reuseExistingServer` 由 `!process.env.CI` 改**恒 false** —— 第七轮实测踩到上一会话遗留、伺服过期 `dist-e2e` 的进程被静默复用，视觉判据跑在旧产物上全绿。
- **⚠️ M4 接进 CI 当天就抓到 4 条假绿（本轮最硬的一条账）**：push `085ec34` 后 run `36218839505` 的 `visual` job **红**（4 failed），而同一轮我本地报的是"16/16 全绿"。删掉 `dist-e2e` 强制重建后本地**同样 4 红** ⇒ 证实我那次 16/16 正是跑在过期产物上，**上面那条"断掉测旧产物的通路"的改动自己先验了一遍价值**。四条的根因同一条：`d598cf8`（上一轮）删掉东鹏特饮等 4 条饮品聚合组与康师傅 8 口味色块组，`p_16` 退化成单图（无缩略图列、无左右箭头）、全站再无 `kind:'color'` 轴，而这三条视觉判据仍锚在被删数据上；当时只删了对应的一条 playwright e2e，这三条因 `test:visual` 不在 CI 而无人看见。另 `loading` 那条是**代码对、断言旧**：`ProductGallery` 主图刻意 `eager`（首屏 LCP 元素设 lazy 会自己拖慢最大内容绘制），测试还写着 `lazy`。
- **四条的处置（按"先修判据、不改数据凑绿"，但这次是判据该追代码/追现实）**：`:45` 两栏并排与 `:218` tap-44 角标定位**重锚到白象 46**（`variants-demo.ts` 里唯一仍存跨记录聚合组、确实会长出缩略图列与箭头），并给 `:45` 的缩略图列补一条 `toBeTruthy()` —— 否则元素缺失时它会退化成空转真；`:176` 断言改 `eager` 并注明 WHY；`:169` 色块上色**改 `test.skip` 而非删除**（判据有效、缺的是驱动数据，下一份带色块的商品数据上线时解除 skip，已登记 `memory/07-next-steps.md`）。重跑：**15 passed / 1 skipped / 0 failed**。

- **新增安全守卫（转 public 的连带后果）**：`d1-backup.yml` 此前注释写"导出物进 artifact（私有仓内）"，而仓库 2026-09-25 晚已转 public。实测判别：未鉴权取 artifact zip **REST `401` / web UI 路径 `404`** ⇒ "公开仓 artifact 任何人都能下"这一常见说法在本机当前形态下不成立；但 public 仓给所有人 read 权限，**任意已登录 GitHub 用户**可读走全库明文导出物。故加 fail-closed 守卫：配了 `CF_D1_BACKUP_TOKEN` 而仓库非 private ⇒ 在导出**之前**响亮失败，并写死两条出路（转回 private / 先加密再上传）。当前实测该仓 0 个 artifact（token 未配），即**泄露尚未发生**，本条是拆弹不是救火。
- **N4 由"偶发慢"升级为"worker 崩且无失败断言"（本轮实测，仍未改执行模型）**：`npx vitest run --coverage` 在本机（32 线程 × 每文件独占 jsdom）出现 `FATAL ERROR: AlignedAlloc Allocation failed - process out of memory`，症状是 **`Test Files 62 passed (62)` / `Tests 625 passed (625)` 却 exit 1**，且少收一个文件 —— 即"全绿但 job 红"，比第七轮记的 5s 超时更难归因。5 连跑（不带 coverage）0 失败、wall time 6.26–13.63s（首轮冷启 13.63s）。按台账既有约束（执行模型改动单独一轮评估、不得用抬 timeout 掩盖机制缺陷）本轮**只量不改**，候选与数据已回写 `memory/07-next-steps.md`。
- **本轮未做（如实）**：M3 `diff-cover` 增量覆盖率 —— 本机无该工具、CI 命令无法先实跑，按"未验证的命令不得当门禁依据"与"新指标先量误报率再接线"留册；K4 PR 流试点（需用户在线决策流程变更）；K3 线上管理端目视复核（需生产密钥，转 public 后已轮换，本机 `.dev.vars` 是否为新值未实测）。
- **门禁全绿（本机实测）**：`npm run verify`（新增 4 段后）全链通过 —— 密钥扫描、lint 0 warning、大小写冲突 0、循环依赖 0 环、契约 44、文档事实 7 项、schema 漂移、license 10/10、CHANGELOG、typecheck 双配置、`verify:backend` **109/0**、Functions 编译 88,650B、体积 3/3；三层浏览器门禁 22 / 16 / 3 全过。


### 2026-09-25 追加十九（可选规格收敛：只留 4 款小包薯片口味 + 白象帮泡/零售，口味进 D1 由后台开关控显隐）

- **用户口径**（AskUserQuestion 四问一次锁定）：① 「可选规格」只指详情页那个选择器，`spec` 文案不动；② **全类目**收敛，不是只动食品；③ 保留的是「乐事薯片 / 呀土豆薯条 / 好有趣薯片 / 白象方便面的帮泡与零售 / 乐吧薯片」，口味按网查补齐，并**在后台加开关**能把某个口味去掉、前端不再显示；④ 改完直接上线。
- **动手前先纠偏三条口径**（原话与磁盘实测对不上，已按实测执行）：食品侧原本只有白象一条规格组，「其他食品一律去掉」按字面等于删 0 条；**张亮丸子与康师傅面在 D1 与代码里都不存在**（`d1 execute supermarket --remote` 实读 55 行、全库无此两条），乐事薯片也只有单条 40g 记录、原本没有选择器 ⇒ 「保留口味」实际是**新增**，不是"留着别删"。
- **删掉的**：`src/data/variants-demo.ts` 的 4 条饮品聚合组（东鹏特饮 / 康师傅 1L 茶饮 8 口味色块 / 农夫山泉 / 怡宝），只剩跨记录真实存在的白象 46(帮泡 ¥3.66)/47(零售 ¥1.88)。
- **新数据面 `products.specOptions`**（`[{label, enabled}]` JSON 文本列）：`db/schema.sql` + `db/migrate-spec-options.sql`（ALTER + 4 条口味 UPDATE + 其余归零，`rollback-spec-options.sql` 配套）；后端 `PRODUCT_FIELDS` 白名单、`rowToProduct` 回读、`getPublicProducts` SELECT 补列（不补则顾客端拿不到），新增 `sanitizeSpecOptions`：非数组归零、项必须是对象、label 去空白截 20 字、同名去重、上限 20 项。
- **口味不改价、不改图**：`src/utils/spec-options.ts` 把口味清单合成单轴「口味」变体组，复用既有 `utils/variants.ts` 纯函数与 `VariantPicker`，每个 combo 的 price/order/productName 都仍是这条商品记录本身；被关掉的口味**连组合一起消失**（不是灰掉 —— 灰掉等于告诉用户"这口味缺货"）。白象的跨记录组与它互不干扰（有组优先）。
- **后台开关（守内联编辑铁律，未加弹窗）**：`ProductInlineEditForm` 增「可选口味」区 —— 药丸即开关（`aria-pressed`，划线=已隐藏）、× 删除、输入框追加，计数只算在显示的；`src/api/fields.ts` 客户端白名单同步补 `specOptions`（**漏这一条就会让后台保存静默丢字段**，`tests/authWhitelist` / `tests/shared` 两条对称判据当场把它钉住）。
- **加购带上所选口味**：`ProductDetailPage` 的 `add({ ...cartProduct, spec: effSpec })`，购物袋与订单里是「40g · 黄瓜味」而不是光秃秃的「40g」；单价与 `_id` 仍取该规格对应的那条真实记录。
- **已知限制（如实登记，不含糊）**：① 购物袋按 `_id` 合行，同商品两个口味会并成一行（规格文案取最后一次点的）—— 这是既有 `addToCart` 语义，本轮未改；② 本地演示模式下**已播种过** localStorage 的老访客不会自动补 `specOptions`（P1-4 明令"只有键不存在才播种"），云端顾客端不受影响；③ `VariantPicker` 的 `kind:'color'` 色块轴随康师傅组删除而**暂无生产数据**，对应的那条 e2e（内联上色）一并删除，`variants.test.ts` 里的色块判据变为空转真——留着，等下一个色块数据。
- **新判据**：用例 631（上轮账面）→ **654**（本轮实测，63 个文件）。`verify:backend` 断言 102 → **109**（+7：口味透传可回读、20 项截断、label 归一、`enabled:false` 原样落库、非对象项丢弃、`getPublicProducts` 下发口味、非数组归零）；`tests/variants.test.ts` 新增「本轮口径」describe（带口味的商品**恰好**是 33/34/40/52、饮品分母由分类枚举得出且带 `>20` 反向断言、聚合层只剩白象 46/47）+ 6 条 specOptions 行为用例；`tests/inlineEditForm.test.tsx` +4 条开关用例；e2e `product-detail.spec.ts` 14 条含「口味不改价」「所选口味写进购物袋金额」「饮品不再长出选择器」。
- **踩到并修掉的真实缺口（由新判据抓出，非人工评审）**：`sanitizeSpecOptions` 一开始只挂在 `applyProductUpdate`，`createProduct` 里 `data.enabled = ...` 夹在 `pick` 与 `sanitizeStock` 之间，使批量替换只命中一处 ⇒ 新建商品时脏口味清单原样落库（`verify:backend` 报"实际 26"）。教训：批量补丁的命中数必须核对，锚点前后各插一行时尤易漏。
- **门禁全绿（本机实测）**：`verify:backend` 109/0、`vitest run` 654/654、Playwright 22/22（含 e2e 复跑）、`typecheck`、`lint` 0 warning、`check:schema-drift` 17/0、`verify:contract` 44/0、`check:size` 3/0、`check:cycles` 无循环、`vite build` 成功。
- **生产 D1 迁移已执行（发版被 CI 卡住，但数据面已就位）**：先 `d1 export --remote` 全量备份（1,449,663 B / 949 条 INSERT，落外层 `_backup/`），再 `node scripts/migrate.mjs apply --remote --yes`（走 `schema_migrations` 账目表，**不是** skill §4 那条裸 `d1 execute --file`——裸跑会让账目以为没应用，下次重放必炸 duplicate column）；线上回读 33/34/40/52 带口味、其余含全部饮品为 `[]`，`/pub getPublicProducts` 仍 200/28 条无回归（旧后端不引用新列 ⇒ 当前是一致可用状态）。
- **两端前端未发版（如实记账，不写成已上线）**：push `d598cf8` 后 run `36125547534` 三 job 全 0-step、`dispatch.yml` run `36125547517` 同样 0-step ⇒ pages.dev 与 github.io 仍是旧构建（顾客端暂时看不到口味、也还看得到饮品规格选择器）。按 `docs/ci-triage-runbook.md` §4.3「不等 CI 也要交付的两条路都要用户点名」执行：用户选「先查清为何不给 runner」，未走本地绕过通道。
- **顺带把停摆归因从"只能开浏览器看红条"升级为 API 硬证据**：失败 job 的 `check_run_url` + `/annotations` 直接给出原文 —— *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* ⇒ 账号计费/消费上限，与本月分钟数（57.6%）和本次提交都无关。`scripts/ci-status.mjs` 已内置（exit 3 时打印「平台原文」行，`--json` 落 `blockedBy` 字段，取不到只记 UNVERIFIED 不改判类），runbook §2 ⑤/§4.2 与 `memory/07-next-steps.md` P0 同步更正。
- **同轮自我翻案（重要，别当已解决）**：上面那句"与本月分钟数（57.6%）无关"是**错的**。登录态浏览器实测 `github.com/settings/billing` Actions 面板：`2,000 min used / 2,000 min included`（100% 红）、`Billable usage $0 = $22.23 consumed − $22.23 discounts`、`limits reset in 6 days`、`Next payment due = -` ⇒ **真因是 Free 计划分钟用满，且并没有欠费**。逐 job 累加之所以算成 57.6%：只统计了已完成 run，**漏算 cancelled run 与超额计费分钟**。已同步改回三处（`docs/ci-triage-runbook.md` §2 ⑤/§3、`memory/07-next-steps.md` P0 新增翻案条、全局记忆 `reference-github-actions-zero-step-jobs.md`）+ `chaoshi-web-deploy` 坑 39 追加更正。**纪律**：账号级用量只认 Billing 页；`admin:billing` 读不到时"读不到"不等于"反证成功"。`rerun-failed-jobs` 已实测（201 → attempt=2 仍 3 秒 0-step）⇒ 非瞬时，需等重置 / 抬上限并加支付方式 / 临时转公开三选一。

### 2026-09-25 追加二十（解停摆：先作废泄露密钥 → 仓库转公开 → CI 恢复）

- **停摆解法选了"转公开"**（用户拍板）。动手前实测发现**不能直接转**：`git log --all -S<真值>` 命中 **10 个提交**的 diff 含生产后台密钥真值，最早在 **`wrangler.toml` 的 `[vars]`**（`4034aff` 2026-09-18 才把文档明文改成掩码）。HEAD 树干净、`.dev.vars`/`.env` 均未跟踪，但**历史 blob 抹不掉** ⇒ 直接公开等于把后台密钥交出去（可改价、删单、读订单里的房间号/微信号）。
- **顺序：先让泄露值作废，再公开**（用户批准"先轮换再公开"）：① 生成新随机密钥 → `wrangler pages secret put ADMIN_KEY`（Success）；② **立即重部一次**让新 secret 生效（Pages 的 secret 是部署时注入，坑 19）——`rm -rf dist` + `npm run build`（新 `CACHE_VERSION sm-v1790337036424`，产物含 `specOptions`）+ `wrangler pages deploy dist --commit-dirty=true` → `09c4e1d2.supermarket-web.pages.dev`；③ 同步本地 `.dev.vars`；④ 全树 `scan-secrets` 通过后才 `PATCH {"private":false}` 转公开。
- **线上复验（不是推断）**：新密钥 `/web login` → `{"code":0,"role":"admin"}`；**旧密钥 → `{"code":-1,"message":"认证失败"}`**（泄露值确认作废）；`/pub getPublicProducts` 28 条上架、乐事 8 个口味首项「原味」；`sw.js` 指纹 = 本次新构建。
- **CI 恢复实证**：转公开后 `workflow_dispatch` 触发 run `36132121389` = **success**，`build-and-test` 22 steps / 46s、`e2e` 10 steps / 63s、`e2e-cloud-stub` 10 steps / 53s ⇒ **公开仓拿得到 runner**，与"分钟耗尽"结论一致。但 `deploy` = `skipped` —— 该 job 只认 `push`，dispatch 不触发部署 ⇒ 本轮改用"提交 + push main"走完整链路（CI 自动部 pages.dev，`dispatch.yml` 再驱动 github.io 顾客端构建）。
- **仓库可见性已变更**：`supermarket-web` 现为 **public**（原 private）。本仓文档、部署 skill 与 `memory/AGENTS.md` 里"私有仓 / 未认证 API 一律 404 / `DEPLOY_SOURCE_TOKEN` 跨仓取私有源码"等表述自此**部分失真**，已另行更正；`ADMIN_KEY` 真值只存 Pages secret 与本地 `.dev.vars`，文档一律掩码。
- **处置链已抽成跨仓工具**（用户点名"可复用吗→抽成小工具"）：`焚诀/eval/gh_ci_unblock.mjs`，子命令 `status`（分诊 + 取 annotations 原文）/ `audit`（**转公开前置**：HEAD 树 + 全历史密钥形态扫描，只报计数与路径不打印值，判 `PUBLIC_SAFE`/`NEED_ROTATION`/`ROTATED_ACK`）/ `unblock`（审计当硬前置，脏则拒翻 public）/ `--selftest`。退出码 0/1/3/4 分开，取不到数据一律 4。六条隔离桩全过，过程中抓到三个**假阴性** bug：`git grep` 把 `-` 开头的模式当选项吞（改 `-e`）、`git log -G` 默认 BRE 使 `{8,}` 失效（改 `-P`）、真实键名大写而模式小写（补 `-i`，实测同一仓 0 命中 → 10 命中）。实扫：本仓报 `generic-kv` 历史 10 个提交（与手工 `-S` 一致）+ 当前树 1 个（`verify-backend.mjs` 的测试夹具键，属误报，由人 `--ack-rotated` 定性）；`fenjue-private-archive` 457 提交零命中、`status` 显示其 5 个 job 仍 0-step 并取回计费原文 ⇒ 该仓可安全转公开，但**未动**（属另一项目的决定）。本文件 §2 已加指针。
- **顺带记一起并行事故**：工具的 `git add` 完成后，被另一会话**未带 pathspec** 的提交 `b8d6917` 吸收并推送，作者侧独立提交因此报 "no changes added"。内容零丢失，故只补归属留痕、不重写他人历史。教训入文件头：共用仓里 `add` 与 `commit` 必须紧邻且带 pathspec。


### 2026-09-25 追加十八（防线轮 K1+K2：门面故障路径进断言 + 真渲染接成可拦部署的 CI 门禁）

- **这轮不改界面**，改的是"出问题的时候谁知道"。三块门面（`src/auth.ts` 16%、`src/api/client.ts` 9.5%、`src/localStore.ts` ~53%）是所有云端读写的唯一出口，此前**超时/非 JSON/`code` 缺失/网络抛错四类真实故障路径一条都没断言过**。
- **K2 接的是真浏览器层**：`build:stub`（生产构建 + `VITE_CB_API_BASE=/web` 走云端模式）+ 假 `/web` `/pub` 桩 + Playwright 访 `#/admin`，断言看板四张图各自真的建出了 canvas 且全程零未捕获异常。此前这条路径**只有人工开过 localhost:5182 一次**，全仓没有任何代码断言过 canvas 尺寸，四个浏览器 spec 的 `pageerror`/`console` 也只 `console.log`、从不 `expect`。
- **⚠️ 修掉一处"判据假安全感"的账目错误（本轮实测）**：CHANGELOG 与 `ci.yml` 注释自 2026-09-24 起写着「移除 continue-on-error 使 `e2e` job 具备阻断力」—— 实际 `deploy.needs` 从来只有 `build-and-test`，**`e2e` 红了照样部署**。文案承诺的能力在磁盘上不存在。本轮把 `needs` 改为 `[build-and-test, e2e, e2e-cloud-stub]`，这才是那句话第一次成立。
- **两处真实缺陷（写失败/抛错时缓存不失效）**，做 K1 时必然撞出来、经批准当场修：
  - `src/db/reviews.ts` 三处失效写在成功分支里：`addReview` 的 `cacheDel` 关在 `if (result.code === 0)` 内；`addCloudReview` 在 :86 抛错**早于**其后的两次 `cacheDel`；`deleteCloudReview` 抛错早于全清。⇒ 请求已落库但响应丢失/超时时，评价脏读满 60s（`CATALOG_CACHE_TTL`）。
  - `updateOrderStatus` / `deleteOrder` 的云端分支**完全没有失效**。
  - 收口方式是把 `src/auth.ts` 已有的 `finally` 语义上提成 `catalogCache.withCacheInvalidation(fn, invalidate = clearCatalogCache)`。评价侧**必须传精确键**：直接复用全清会把商品/分类缓存一起抹掉，那是过度失效（60s 内所有顾客端读多打一次云函数）。缺陷是"时机"，原本的失效"范围"是对的。
- **纠正我自己的一处误判**：原以为脏读面是后台的「缺货/低库存」角标。实测 `getAdminProducts()`（`src/db/products.ts:86-91`）**根本没有接缓存**，角标一直新鲜；真正会脏的是**顾客端库存显示**（`getProducts()` 把含 `stock` 的 `getPublicProducts` 载荷缓存进 `publicProducts`，而订单状态变更在服务端改 `products.stock`）。修法不变，但描述必须按实测写。
- **新判据**：用例 560 → **631**（60 → 63 文件）。新增 `tests/apiClient.test.ts` 26、`tests/localStore.test.ts` 29、`tests/authWriteInvalidate.test.ts` 8，另扩 `catalogCache` +3、`dbReviews` +5；加 Playwright `tests/e2e-stub/dashboard-cloud.spec.ts` 3 条（不在 vitest 口径内）。
- **反例自证 18/18**（一次性变异脚本，产物建在仓库外）：每条判据都配一个"朴素/回退"变异体并实跑，全部变红才允许通过 —— 含 `finally` 退回仅成功失效、撤掉 order 包裹、reviews 三处退回原缺陷写法、去掉 `AbortError` 映射、去掉 `res.json().catch` 兜底、去掉 `typeof code === 'number'` 判定、AI 超时退回 15s、去掉 `cloneArray`、播种判定退回 `length === 0`、`rating` 去掉未填默认等。K2 另跑两个变异（把 `core.use` 退回喂零 export 的深路径模块 = 复现 19 天前那起事故）：canvas 判据报「宿主内没有 canvas（静默空白回归）」，`pageerror` 判据**单独也变红**并报出事故原句 `e.install is not a function`。
- **写自己的脚本踩到的坑（已修，记为纪律）**：还原时用文本模式 + `newline=''` 写文件，把三个 CRLF 源文件整体转成 LF，`git diff` 一度显示 `localStore.ts` 206/206 全文件重写（我根本没改过它）。⇒ 变异/补丁类脚本必须**二进制读写**，并把"还原后 sha256 一致"当作硬退出条件（本次正是这条自检抓到）。修完 `localStore.ts` 回干净，其余两个文件回到真实小 diff。
- **顺带证伪三条待办/口径**：①「其余 GitHub Actions 待 pin 到 SHA」不成立，13 处 `uses:` 全是完整 SHA；②「4176 端口 `reuseExistingServer` 静默复用旧构建」是**本机专属**风险（CI 下该项恒为 false），且本轮 `test:visual` 未接 CI，故从 P0 降为本机注记；新配置反过来把该项设为**恒 false**（宁可响亮失败也不测旧产物）。③ 本机实跑撞到 5182 被上一会话遗留的桩进程占着、且伺服的是改动前的旧 `dist-stub` —— 正是这条判据要防的场景，停掉进程后由配置自建产物才继续。
- **新发现（本轮未修，已登记 07）**：① `getLocalCategories()` 直返 `seedCategories` 模块引用（唯一没走 `cloneArray` 的读出口），当前三个调用方都只做 `setState`、全站 `sort` 都用 `[...list].sort()`，所以**不是活缺陷**，但将来任何一处原地排序就会污染整个会话的种子；② `verify:changelog` 比的是 `HEAD~1..HEAD` 提交边界、不看工作区，因此一次 push 多 commit 时只有最后一个 commit 受检（本轮为此刻意单 commit）。
- **新增用例撞出的既有脆弱点（已按"分档"处理，未掩盖机制）**：`tests/prefetchBus.test.ts:116`「13 条路由全部登记」在我加完 3 个测试文件后，于**全量 `--coverage`** 下报 `Test timed out in 5000ms`（单文件跑稳定通过，`npm test` 不带覆盖率也通过）。归因：该用例真实 `await import()` 页面块，是冷模块加载而非纯逻辑断言；vitest 默认 5000ms 是**墙钟**，而每个测试文件独占一个 jsdom（实测 63 个、占总时长 29–55%）+ 覆盖率插桩让耗时随机器负载漂。CI 跑的正是 `npx vitest run --coverage` ⇒ 不处理就会随机打红部署链。
  - 做法：只给这**两条**冷导入用例显式 20s 档（附 WHY 注释），**没有**改全局 `testTimeout`（全局放宽会把别处的真缺陷一起盖掉）。改后连跑三轮全量 `--coverage` 全 exit=0、631 用例，零 timeout。
  - 未顺手做的治本项（已登记 07）：`pool: 'vmThreads'` 或 `isolate: false` 复用 jsdom —— vitest 自己每次都在结尾提示这条。属全局执行模型改动，隔离语义有风险，留待单独一轮评估。
- 覆盖率（分母钉死 `src/**`）：statements 77.49 → **80.91%**、branches 71.77 → **74.08%**、functions 73.30 → **76.41%**、lines 79.05 → **82.52%**；棘轮上调 **78/72/74/80**（= 实测 −2pp 下取整）。branches 三跑实测 74.08 / 74.08 / **74.12**，差 1 条分支 —— 这 2pp 余量是给 CI(node22/ubuntu) 与本机(node24) 留的，不是保守。
- **CI 分诊知识固化为仓库资产**（本轮实测反哺，非补记）：
  - 新增 `scripts/ci-status.mjs`（npm 入口 `npm run ci:status`）——自动把失败 run 分成 **真判据红（job 有 step）** 与 **账号级 0-step 秒红（无 step 且 ≤12s = runner 从未分配）**，退出码 `0/1/3/4` 各对应"绿/去修代码/别改代码绕/取不到数据"。**取不到数据一律显式报错，不静默 PASS**（R247）。
  - 新增 `docs/ci-triage-runbook.md`：症状→结论对照表、四条可直跑的排除命令（含"计费必须逐 job 累加，按 run 墙钟低估 1.46x"这条）、判定账号级后的处置顺序（禁止 `continue-on-error`、禁止拆 `deploy.needs`、禁止注释判据）、以及 push 后自动检测的 hook 接法（脚本已备好，配置在用户本机）。
  - `AGENTS.md` 权威文档节加第 4 条指针（保持薄指针，正文在 runbook），`memory/06-constraints.md` 记一条技术债：私有仓 Actions 是计量资源且存在账号级停摆形态。
  - 动机：本轮排查耗时远大于改代码，且我第一版把"墙钟求和"当用量得出 64% 的近似数、node 原生 fetch 不走代理导致结果全 NaN —— 这类判断每次手写都会错，必须固化成工具。
- 后端与数据层**零改动**（`functions/`、`db/`、action 名单、`ADMIN_WRITE_ACTIONS` 全部未动 ⇒ `verify:backend` 契约与白名单对称测试不受影响）。


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
