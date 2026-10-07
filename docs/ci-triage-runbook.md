# CI 分诊手册（GitHub Actions）

> 来源：2026-09-25 防线轮一次真实卡死。当时三个 job 全红、**一个 step 都没有**，
> 而 CHANGELOG 里从 09-24 起就写着"e2e 具备阻断力"（其实 `deploy.needs` 从没列过它）。
> 本手册的目的是：**下次别再从头猜，也别把账号级故障当代码故障去改代码。**
>
> **状态注（2026-09-26 第八轮）**：本次停摆的真因是 Free 计划 2,000 Actions 分钟用满，
> 已按 §4.3 第 3 条「转 public」解开 —— **本仓现为 public，不再计分钟**，故 §2 症状表里
> 与"私有仓计量"相关的行今后不适用于本仓（仍适用于账号里其它私有仓）。转 public 的前置是
> 先轮换掉 10 个历史提交里泄露过的 `ADMIN_KEY`（旧值实测返回"认证失败"）；连带新增的
> artifact 可见面守卫见 `.github/workflows/d1-backup.yml` 顶部注释。

## 0. 一条命令先跑这个

```bash
node scripts/ci-status.mjs            # 最近 5 条 run，自动分类并给退出码
```

| 退出码 | 含义 | 该做什么 |
|---|---|---|
| `0` | 全绿 | 继续按部署 skill §6 核线上 |
| `1` | **真判据红**（失败 job 里有 step） | 正常修代码/测试。**禁止**改判据让它变绿 |
| `3` | **账号级 0-step 秒红**（无 step 且 ≤12s） | **不要改代码**。按下面 §2 排除，然后走 §4 |
| `4` | 取不到数据（无 token / 代理不通 / API 挂） | 修通道，别把"没数据"读成"通过"（R247） |

### 0.1 两条取数通道，以及"为什么它以前会一声不吭地卡住"

`node scripts/ci-status.mjs` 有两条通道，`--transport` 可钉死走哪条：

| 通道 | 怎么走 | 何时用 |
|---|---|---|
| `gh`（默认首选） | 已登录的 GitHub CLI，自带鉴权 | 日常。token 压根不进本进程 |
| `curl` | curl + Git 凭据管理器的 token（敏感项走 `--config -` 从 stdin 读，不进 argv） | 机器上没有 gh，或要单独验 curl 腿的泄漏面 |

```bash
node scripts/ci-status.mjs --transport=auto   # 默认：先 gh，失败再 curl
node scripts/ci-status.mjs --transport=gh     # 只走 gh；找不到可用 gh 就 rc=4，不静默回落
node scripts/ci-status.mjs --transport=curl   # 只走 curl + GCM token
```

**第六十七轮实测的旧病，值得单独记一笔**：本工具一度会**零输出挂死 150s+**，被误读成"这台机器量不到 CI"。
真因有两层，都不是环境缺能力：① 取 token 那一步原本包在 `bash -c '… | git credential fill'` 里，
而本机 PATH 上的 `bash` 是 `C:/Windows/System32/bash.exe`（**WSL 那份**），它那条管道实测 45s 不返回，
且原实现**没有 timeout**；② 本机 curl 打不到 `api.github.com`（直连 rc=56、经 `127.0.0.1:7897` rc=35），
而同期 `gh.exe` 取同一接口 rc=0。
两条修法：token 改为**直连 `git credential fill`（去掉 shell 外壳）**，同一台机器 0.1s 就拿到凭据 ——
Windows GCM 里本来就有；并让 gh 腿排在前面。**教训**：归因"本机量不到"之前，先确认不是取数器自己挑错了通道 ——
尤其是当"量不到"这件事已经连续几轮被复述、却从没被当成一个待修的缺陷时。

## 1. 症状 → 结论对照

| 症状 | 结论 | 依据（本仓实测） |
|---|---|---|
| job `failure` + `steps=0` + 4~6 秒 | 没拿到 runner，与提交内容无关 | run `36110097808`（两 attempt）、`36111760145`、探针 `36115775548` 全如此 |
| 同上，且**本仓零改动**的 workflow 也这样 | 排除"我的改动导致" | `uptime.yml`（最后变更 `5fda761`）dispatch 后 `probe` 同样 0 step / 3 秒 |
| 多个**互不相关**私有仓同时这样 | 账号级，不是仓级 | 5 个私有仓 29 个 run 全 0 step，0 success（2026-09-25 当时的现场证据；**本仓现已 public**，见下 §4.3 与本文件顶部状态注） |
| `deploy` = `skipped` | 闸门**在正常工作**（needs 上游红） | 现行 `deploy.needs = [gates, e2e, e2e-cloud-stub, visual]`（2026-10-08 分层后：快链 job 由 `build-and-test` 更名为 `gates`，深门禁移入 `ci-deep.yml` 且不在 deploy 的必需面内） |
| run 的 logs 包是 22 字节空 zip | 确无任何 step 执行过 | 两个失败 run 实测 |
| 入口 bundle 名没变 | **不能**证明没上线（纯资源/文案改动不改哈希） | 判"上没上"只看 `sw.js` 的 `CACHE_VERSION`（坑 32） |

## 2. 排除清单（每条都有可直接跑的命令）

> 跨仓通用版已抽成工具：`node <焚诀>/eval/gh_ci_unblock.mjs status|audit|unblock --repo=owner/r`
> —— `status` 内含本节⑤的 annotations 取法；`audit` 是**转公开前置的密钥扫描**（HEAD 树 + 全历史，
> 只报命中计数与路径不打印值），`unblock` 拿它当硬前置（历史含密钥形态且未 `--ack-rotated` 就拒绝翻 public）。
> 自带 `--selftest` 九条隔离桩（正例/违规/边界，2026-09-25 由 6 扩到 9），本轮靠它抓到三个假阴性 bug（`git grep` 吞 `-` 开头模式、
> `git log -G` 走 BRE 使 `{8,}` 失效、键名大写而模式小写）。
> **同日试点后再修三处自己的错读**：① 工作流名不再硬编 `ci.yml` —— 从本地 `git ls-tree` 推导（`skill-private-archive` 那份叫
> `gates.yml`，猜错导致 dispatch `404` 被读成"解封失败"）；多份/零份一律拒绝并要 `--workflow=` 点名；
> ② `POST .../dispatches` 实测返回 **204 No Content**（我一度写成"202 不是 204"，属凭印象不凭实测，已回改；
> 工具里状态码判错会把成功触发读成失败）。`rerun-failed-jobs` 才是 201；
> ③ `unblock` 改可重入：已是 public 时不再直接退出，照样触发 + 轮询，**验收口径是 `steps>0`**（触发成功 ≠ 拿到 runner）；
> ④ 第二个仓（`xinyu-soulisle-private-archive`）暴露：**很多仓的 CI 只挂 `push`/`pull_request`，没有 `workflow_dispatch`**
> ⇒ dispatch 直接 `422 Workflow does not have 'workflow_dispatch' trigger`。这**不是解封失败**，工具现自动降级为
> `rerun-failed-jobs`（201）复用最近一条 run 的同一 commit 验 runner；同时"真判据红就拒绝转公开"这条护栏改为
> **只在还要改可见性时生效**（已 public 时无可掩盖，否则翻转后第一次真红会把后续验收全锁死 —— 本轮实测撞上）。

```bash
# ① 本仓 Actions 是否被禁（enabled:true / allowed_actions:all 才正常）
curl -s --proxy http://127.0.0.1:7897 -H "Authorization: Bearer $(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')" \
  https://api.github.com/repos/lxh113377/supermarket-web/actions/permissions

# ② 配额：按 job 逐个累加才算数（按 run 墙钟会低估，实测低估 1.46x）
#    见 §3 的脚本化做法；⚠️ 2026-09-25 晚翻案：逐 job 累加算出的 1151.0/2000（57.6%）是**低估**
#    （漏算 cancelled run 与超额计费分钟），Billing 页实测 `2,000 min used / 2,000 min included` 已用满。
#    **用量结论只认 https://github.com/settings/billing 的 Actions 面板**，§3 那种自算只能当量级估计。

# ③ 官方状态（无事故 ≠ 你账号没问题，但它先排除大盘）
curl -s --proxy http://127.0.0.1:7897 https://www.githubstatus.com/api/v2/components.json | grep -o '"name":"Actions"[^}]*"status":"[a-z]*"'

# ④ 线上到底哪个版本（独立于 GitHub 的第二通道）
node node_modules/wrangler/bin/wrangler.js pages deployment list --project-name supermarket-web | head -5
curl -s --max-time 15 https://supermarket-web.pages.dev/sw.js | grep -o "CACHE_VERSION = '[^']*'"

# ⑤ 拿"为什么不给 runner"的原文 —— 不用开浏览器（2026-09-25 实测打通）
#    jobs 里没有原因；原因在该 job 的 check-run annotations 里。`npm run ci:status` 已内置这一步
#    （exit 3 时直接打印「平台原文」行，--json 模式落在 blockedBy 字段）。手工等价：
curl -s --proxy http://127.0.0.1:7897 -H "Authorization: Bearer $(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')" \
  "https://api.github.com/repos/lxh113377/supermarket-web/actions/runs/<RUN_ID>/jobs" \
  | grep -o '"check_run_url": *"[^"]*"' | head -1
#    再对上一步的 URL 加 /annotations，读 annotation_level=failure 的 message
#    本仓 2026-09-25 实测原文：「The job was not started because recent account payments have
#    failed or your spending limit needs to be increased. Please check the 'Billing & plans'
#    section in your settings」⇒ 账号计费/消费上限措辞。**注意这句不等于"没欠费"**：同页 `Next payment due = -`、
#    `Billable usage $0（$22.23 consumed − $22.23 discounts）`，真因是 **Free 计划 2,000 分钟用满**（见 §3 翻案条）。
```

## 3. 算准当月用量（防"墙钟低估"这一档）

计费 = **逐 job** `(completed_at − started_at)` 求和，Linux 倍率 1。
按 run 的墙钟求和会低估：并行矩阵越重低估越多（实测本账号 1.46x；fenjue 单仓 11-job 矩阵曾抽到 2.27x）。
抽样外推只能定量级，**要下结论必须逐 run 取 `/jobs`**（686 个 run ≈ 数分钟，放后台）。

## 4. 判定为账号级之后的处置顺序

1. **什么都不改代码**。尤其禁止：给 step 加 `continue-on-error`、把 `deploy.needs` 拆回去、注释掉判据。
2. 先取**平台原文**：`node scripts/ci-status.mjs`（exit 3 时会打印「平台原文（check-run annotations）」行，
   取法见 §2 ⑤）。取到就是硬证据，不必再靠人开浏览器。
   原文里出现 `payments have failed` / `spending limit needs to be increased` ⇒ 归口 **GitHub → Settings → Billing & plans**，
   由用户处理（补卡 / 抬上限 / 临时转公开）；本仓 PAT 无 `admin:billing` 作用域，**读不到用量页**（实测 `settings/billing` 404），
   所以"为什么"只能从 annotations 拿，不要从 API 用量猜。
   （2026-09-25 修正：此前本节写的是"唯一能一锤定音的证据是已登录浏览器里的红条原文"——那是没找到
   `check-runs/{id}/annotations` 之前的结论，现已证伪：同一句话在 API 里就拿得到。浏览器看红条退为兜底。）
3. **已被实测证实的解法：把该仓转 public**（2026-09-25 晚，本账号）。公开仓不消耗 Actions 分钟 ⇒ runner 立刻回来。
   两路独立证据：`supermarket-web` 转公开后 run `36132466325` 四 job 全绿（deploy 9 steps）；
   试点仓 `skill-private-archive` 转公开后 run `36139509103` 由「0 step / 4 秒」变成 **8 steps / 10 秒**，
   且**红在真判据**（`md_claim_face` / `budget_contract_fixtures` / `scan_inputs_fixtures` 三门 fixture FAIL）——
   红本身正是恢复的证明：判据终于被执行了。
   ⚠️ 前置硬条件：**先 `audit` 再翻**。历史 blob 抹不掉 —— 本仓 `ADMIN_KEY` 曾在 10 个历史提交里，
   必须先轮换密钥 + 重部一次让新值生效，才能转公开。转公开属**对外可见动作**，须用户点名。
4. 想不等 CI 也要交付时，只有两条被允许的路，且**都要用户点名**：
   - 部署 skill §4 的本地急救：`wrangler pages deploy dist`（**跳过 CI 执行**，等于放弃门禁）；
   - 触发**公开仓** `lxh113377.github.io` 的 `deploy.yml`（公开仓不计分钟；可反证是否私有仓计量问题，但会造成**半发布**：顾客端新、管理端旧）。
5. 记录：把"未发 + 拦在哪一步 + 失败面"写进 `memory/07-next-steps.md` 的 P0，**不得写成已上线**（坑 36）。
   （走通第 3 条转公开之后，这一条记的不是"未发"，而是"runner 回来了、真判据红在哪几门"。）

## 5. 想在 push 后自动知道结果（可选，需用户本机配置）

`scripts/ci-status.mjs` 已经能自己判类，所以 hook 只需调用它并把非零码回注：

```
事件：命令执行后（git push 成功之后）
命令：node scripts/ci-status.mjs --limit=2
注入：把它的 stdout 作为上下文给 Agent（exit 1 → 修代码；exit 3 → 停手，按 §4）
注意：① 必须走 curl/代理，node 原生 fetch 不读系统代理，会把"取不到数据"伪装成"没数据"；
      ② 判类里 0-step 与真红必须分开退出码，否则 hook 会指挥 Agent 去改本该拦住它的判据。
```

## 6. 本轮沉淀的可复用判据（已进门禁链的部分）

- `e2e-cloud-stub` job（生产构建 + 假桩后端）断言看板四图真出 canvas 且 `pageerror` 严格为空 —— 防"单测全绿、线上静默空白"那类缺陷（曾存活 19 天）。
  已在 Linux 容器实测 `test:stub` **3/3 绿**（`node scripts/ci-status.mjs` 只能等 runner 回来才验 GitHub 侧）。
- 反例自证：任何"会判红"的新判据，必须配一个把实现改回朴素形态的变异体并实跑变红（本轮 18/18）。
- 门禁的存在性看 **`needs` 列表**，不看注释里"具备阻断力"那句话。

## 7. 第十轮新增的两种"不红即无存"失效形态（都真发生过）

| 症状 | 一眼看不出的地方 | 定位命令 | 修法 |
|---|---|---|---|
| workflow 改了之后 **run failure 但 `jobs` 数组为空**（0 个 job，连 `Set up job` 都没有） | 会被误当"runner 配额问题"（那是 0-step **job**，不是 0-**job** run） | `gh run view <id> --json jobs --jq '.jobs \| length'` 与 `gh run view <id> --json conclusion` | 多半是 job 块被插到顶层 `jobs:` 之外 ⇒ 看文件 `grep -n "^jobs:\|runs-on:"`，`runs-on` 行号早于 `jobs:` 即确诊。已进门禁：`ciWorkflow.test.ts` 的排版骨架断言（顶层键白名单 + `runs-on` 必须在 `jobs:` 之后） |
| advisory 类判据（设计上永不 exit 0）**长期空转**，CI 全绿 | 它不红，所以没人回头看它到底干了什么 | `gh run view <id> --log \| grep -a "pr-advisory\]"` 看是否只有 `SKIPPED` | 把"接线"本身变成断言：`advisoryJobProblems()` 要求同 job 内同时存在 `GH_TOKEN:`、`pull-requests: read`、`report:pr-tests` 三项，缺一即红。**判据不红 ≠ 判据在干活** |

补一条通用口径：**"永远 exit 0"的判据必须配一条"它到底跑没跑"的断言**，否则它与不存在的判据完全等价。

## 8. 备份恢复演练与手动恢复（第十一轮 R11-H1，唯一权威流程）

### 8.1 判据：备份必须先被证明"可恢复"才允许上传

```
node scripts/verify-backup-restore.mjs <dump.sql>        # 或 BACKUP_SQL=... npm run verify:restore
```
它把 dump **完整载进一次性内存 SQLite**（`node:sqlite`，零外部依赖、绝不落盘、绝不碰开发库），然后断六条：
载入不抛错 → `PRAGMA integrity_check == ok` → `PRAGMA foreign_key_check` 零行 → 表集合与 `db/schema.sql`
**双向**对账（缺表＝备份不完整；多表＝真相源漂移）→ `Σ各表行数 == 文本里 INSERT 语句数` → `products` 非空。

退出码：`0` 可恢复 / `1` 判据不过（含 0 INSERT 的"schema 尸体"）/ `2` 文件缺失或参数缺失。
**`2` 与 `0` 的区别是刻意的**：拿不到对象绝不能记绿（对标里 `frankensqlite` 那类 `exit 0` 是反面教材）。

首跑就抓到一条真账：`schema_migrations` 一直只由 `scripts/migrate.mjs` 运行时 CREATE，从未进过全量真相源
`db/schema.sql` ⇒ 判据报"备份里出现 schema.sql 之外的表"。修法是把表补进 schema.sql（修真值面），不是放宽判据。

### 8.2 每日备份链的判据位置（顺序即语义）

`导出 → 恢复演练 → 上传`。演练必须在上传**之前**；顺序错了不会红，只会静默失去意义
（已钉成断言：`tests/ciWorkflow.test.ts` 的「备份链顺序」组）。

### 8.3 手动恢复（真出事时照抄，别再凭记忆）

```bash
# 1) 下载当次 run 的 artifact，先核对 run summary 里记下的 sha256 与行数
shasum -a 256 d1-backup.sql
# 2) 本地先演一遍（同一判据，零副作用）
node scripts/verify-backup-restore.mjs d1-backup.sql
# 3) 确认要覆盖的是哪个库：--remote 打生产，不带就是本地，务必看清
npx wrangler d1 execute supermarket --remote --file=d1-backup.sql
# 4) 恢复后立即跑线上事实对账与冒烟
npm run report:catalog && npm run smoke
```
注意：导出物是**全库覆盖式** SQL（含 `DELETE FROM sqlite_sequence`），恢复前务必先跑第 2 步并确认
`products`/`orders` 行数量级符合预期；`security_events`/`rate_limits` 属可再生数据，恢复到生产无意义但无害。

### 8.4 先确认"备份到底在不在做"（第十二轮实测教训）

```bash
npm run check:backup-liveness        # 需要 gh 鉴权（本机）或 GH_TOKEN（runner）
```
它**不信 conclusion**：要求存在一次 run 满足「`Export remote D1` 步骤 success + artifact ≥ 1 + run success」
且发生在 2 天内；一次 run 历史都没有 ⇒ 判红（零输入不是通过）。
实测本仓 2026-09-26 的状态：2 次 run 全 success、2 次都 0 artifact、导出/上传步骤 `skipped` ⇒ 判红并报
`2/2 次 run 的 conclusion=success 但没有产出可核对的备份产物`。

要让它变绿，只有一条正路：**配 `CF_D1_BACKUP_TOKEN` 并解决明文导出可见性**（转回 private，或导出后加密再上传）。
`BACKUP_SKIP_OK=true` 只是"我暂时接受不备份"的显式声明——它把红降成带原文的 WARN，**不会**假装备份成功。

⚠️ **第六十八轮实测更正**：上面这句在 10-04 之前**还不够**——就算配了 token，备份当晚仍产不出东西。
`Cross-check the daily probe` 那一步当时排在 `Export remote D1` 之前，而 `presence` 模式要求对侧
（`Uptime`）**必须是绿的**；`Uptime` 要绿又必须先有一份真产物 ⇒ 两条 cron 互为前提成环
（一手 run `37241500391`：反查步 failure、导出步 skipped，日志还把红因写成"这条 cron 没在按时跑"，
而它每夜都在跑、只是红）。本轮已拆开：`presence` 只证**到点跑过**、颜色降成 `连着 N 次不是 green` 读数，
反查步挪到上传之后并加 `if: always()`；产物门（backup 模式）一字未动。

### 8.5 三条 cron 互指（守"没人会红的那类停摆"）

| 链 | 触发 | 谁守它 |
|---|---|---|
| `d1-backup.yml`（每日导出 + 恢复演练 + 上传） | `schedule` | `Uptime` 里的 `check:backup-liveness`（backup 模式：要产物） |
| `uptime.yml`（每日探活 + 目录事实） | `schedule` | `d1-backup.yml` 里的 `Cross-check the daily probe`（第六十八轮起 `presence` 模式**只认"到点跑过"**，颜色只印读数不当绿灯条件） |
| `release-parity.yml`（双端一致） | `workflow_run: CI` | 由 CI 触发，本身不会沉默；红即邮件 |

为什么要互指：GitHub 官方行为里 **public 仓 60 天无仓库活动会自动禁用 `schedule`** —— 那一刻没有任何东西会红，
备份与巡检一起静默消失。两条 cron 互相当对方哨兵，才能把"停摆"变成一次可见的失败。
但**互指只能指"有没有跑"，不能指"跑成什么颜色"**：后者会造出上面的环（第六十八轮一手）。
同一族还有一处：`Uptime` 里各步原先没有 `if: always()`，前一条判据一红，后面全变 `skipped` ——
run `37272967991` 实测 `check:cron-health`（全仓唯一能发现"某条 cron 到点没跑"的尺）因此连续多夜一步未执行。
判据之间互为闸门 = 把"没判"读成"判过"，这是同一种病。

## 9. 跑判据期间不要写被测仓（第三十一轮实测，A/B 各一次）

现象：同一批代码，第一次 `npm run verify` **87 文件 / 1129 条全绿 rc=0**；我在它跑的同时改文档并
`git add`/`git commit`，第二次就报 **7 条失败**（含我本轮刚改的 `scan-secrets` 两条夹具与 5 条
"入口真跑 rc=0" 断言）。把改动停掉、独占重跑第三次 ⇒ 又回到全绿 rc=0。

为什么值得写进 runbook：这类红**长得像真缺陷**。若照着它去"修判据"，就会把好的代码改坏
（这正是 `feedback-attribution-before-optimizing` 那一族）。

- **归因动作（三步，都可复跑）**：① 停掉一切写操作独占重跑一次 ⇒ 红消失即定性为测量污染；
  ② 若仍红，再按被测对象分类：跑的是真仓的用例（`gateFixtures` 系）优先怀疑 git 状态被我改了，
  耗时敏感的用例（`spawnSync` 20s 预算）优先怀疑并行负载；③ 未逐条归因前，报告里只准写
  "已证 A/B 差异 = 是否并发写；未证逐条路径"。
- **本仓哪些用例对"脚下变动"敏感**：任何在真仓 `cwd` 下执行 `git ls-files` / `git diff --cached`
  的判据（`scan-secrets`、`check-case-collision`、`check-changelog`、`ci-green-contract`）——
  暂存区一变，它们看到的世界就变了。这是设计使然（它们就是要审工作树），不是缺陷；
  缺陷是"我一边让它审、一边改被审对象"。
- **判别实验（第三十二轮做掉了）**：怀疑"5 条 rc=0 断言是被 20s spawn 预算挤掉"，于是同一批 5 条
  在**空闲**与 **32 路 CPU 负载**下各跑一轮 —— idle `licenses 1.7s / cycles 0.2s / 其余 ≤0.2s`，
  loaded `6.9s / 1.5s / ≤0.6s`，**两种条件下全部仍 rc=0** ⇒ 该假设被否证（负载把它们拖慢 4 倍也没翻红）。
  剩下的解释窗口是"同时跑第二个 npm/node + 同时改文件"的复合，本轮不再故意污染一次去复现。
  结论不依赖归因到底：**别在判据跑的时候动仓库**这条纪律已经够用。
