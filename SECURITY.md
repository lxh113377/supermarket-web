# 安全策略

## 支持版本

| 版本 | 是否修复安全问题 |
|---|---|
| `main` 最新提交 | ✅ |
| 历史提交 | ❌（本项目未发语义化版本 release，请始终使用最新 main） |

## 报告漏洞

请**不要**开公开 Issue 讨论安全问题。优先用 GitHub 的「Report a vulnerability」（仓库 Security 页）提交；若不可用，发邮件至仓库所有者邮箱（见 GitHub 个人主页）。

请在报告中包含：影响路径（`/web` 管理接口 / `/pub` 公开接口 / 前端）、复现步骤、影响范围。预期 7 天内给出首次回复。

## 已实施的安全措施

- **严格 CSP**：`script-src 'self'`，`style-src` 无 `unsafe-inline`（`index.html`）
- **安全响应头**：`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、Referrer-Policy、Permissions-Policy、HSTS（`public/_headers`）
- **鉴权**：双密钥角色 —— `ADMIN_KEY`（全权限）/ `ADMIN_READONLY_KEY`（只读，写操作由 16 项白名单 `ADMIN_WRITE_ACTIONS` 拦截）；比较使用常量时间算法
- **限流**：登录 5/60s、公开写 20/60s、AI 20/60s、AI 建议 10/60s；Workers KV 优先，异常回退 D1
- **审计**：安全事件入表 + SHA-256 指纹，定期清理（`scripts/purge-security-events.mjs`）
- **密钥不入库**：后端密钥经 Cloudflare Pages secret / `.dev.vars` 注入；pre-commit 有暂存区密钥扫描
- **纵深防御**：服务端重算订单金额、字段白名单、图片 scheme 白名单

## 已知非安全问题（设计如此，请勿作为漏洞上报）

- **支付为模拟流程**：仅展示收款二维码，未接真实支付 SDK，不涉及资金与卡数据（README 已明示）
- **评价晒图为 base64 存 D1**：≤3 图 × ≤800KB，属已知技术债，量大后应迁 R2
- **顾客端无账户体系**：以「楼栋-房间号 + 微信号」标识订单，非匿名化缺陷

## 不在范围内

- 第三方依赖的通用漏洞：请直接向对应上游报告（本项目已开启 Dependabot 每周更新）

## 服务端防护现状（机器在册，不靠记忆）

单人直推 `main` 的项目，"仓库设置"这件事很容易被当成"我知道的事"而不是"该被记录的状态"。
本仓把它做成一条可复跑的四态判据：`node scripts/check-branch-protection.mjs`（`npm run report:branch-protection`）。

- **当前实测读数：`NOT_ENFORCED`** —— `GET /repos/…/branches/main/protection` = 404，
  且 `GET /repos/…/rulesets` = `[]`（两条通道都可观测，才敢下这个结论）。
  ⇒ **服务端不拦任何 push**：不要求 PR、不要求 review、不要求 CI 绿、不禁止 force-push 到 main。
- **现在的实际补偿是本地链**（可信度低于服务端强制，这是事实不是宣传）：
  `.githooks/pre-commit`（密钥扫描 + 记忆卷预算）与 `.githooks/pre-push`
  （`ci-green-contract`：远端基点 CI 不绿就拦住推送；逃生门需要显式理由并留痕）。
  二者都能被"绕过钩子的提交"跳过，且不作用于他人克隆（需 `git config core.hooksPath .githooks`）。
- **为什么定时链上常常读到 `UNVERIFIED`**：读 protection 需要 administration 权限，
  而 `Uptime` workflow 按最小权限只给 `contents: read` + `actions: read`。这是**有意不做扩权**：
  新增/扩权 secret 属仓库管理员决定，Agent 侧不擅动（读数拿不到就写"未观测"，绝不按"已满足"计——
  这点对标 `ossf/scorecard`，它在无 admin token 时按满足计分，我们是台账不是评分器）。
- **要把它变成真强制**（用户侧一步）：Settings → Branches → Add branch protection rule for `main`，
  勾选 *Require a pull request before merging* 与 *Require status checks to pass*（`build-and-test`、`deploy`）。
  开完后本判据应转 `ENFORCED`，`docs/cli-entrypoints.md` 与轮次报告的挂账随之销账。

## 备份与恢复现状（机器在册，不靠记忆）

数据可恢复性是安全属性，不是运维细节。本仓把它做成一条可复跑判据：
`node scripts/check-backup-liveness.mjs`（`npm run check:backup-liveness`，同时接在 `Uptime` 日巡检里）。

- **当前实测读数：`FAIL`（备份不可依赖）**。取证时刻 `2026-09-27T11:36Z` 本地实跑（rc=1），
  与 CI 侧 `Uptime` run `36299454141`（`2026-09-27T06:13Z`，step 6 failure）同结论：
  窗口内 **4/4 次 `D1 Daily Backup` run 全部 `Export remote D1=skipped`、`Upload backup artifact=skipped`、`artifact=0`**
  （run `36276262768`/`36242719500` = failure，`36199812627`/`36070786268` = **success 却零证据**，即"恒绿空转"形状）
  ⇒ **生产库从未被这条链备份过**。
- **两道因（都要成立才有备份，缺一不可）**：
  ① 未配置 `CF_D1_BACKUP_TOKEN`（需 D1:Read 的 API Token）⇒ 导出与上传被 `if` 跳过；
  ② 本仓 **2026-09-25 起为 public**（`gh api repos/…` 实测 `visibility=public private=false`），
  而工作流里有一道**排在导出之前**的守卫：非私有仓即使配了 token 也**拒绝**把全库明文导出物放进 artifact
  （依据：未鉴权下载被拒，但**任意已登录 GitHub 用户**可下载 ⇒ 可见面已不是"仅协作者"）。
- **两条出路（原文见 `.github/workflows/d1-backup.yml` 顶部注释，二者选一）**：
  ① 仓库转回 private；② 上传前用 `age`/`openssl` 加密并另配一个只放解密口令的 secret。
  红线写在册上：**绝不允许"明文导出 + 公开仓"同时成立**。
- **Agent 侧不擅动的部分**：新增 secret、改仓库可见性、以及**设 `BACKUP_SKIP_OK=true`** ——
  最后这项会把 FAIL 降成 WARN，属于"承认暂时不备份"的显式决定，只能由仓库管理员做；
  本轮明确**不设**，让这条红继续每天响（沉默的零备份比红色的无备份危险得多，这是第十二轮的一手教训）。
- **本轮顺手修掉的是判据自己的洞**：它原先只给"最近 3 次 run"取步骤明细，而窗口默认 4 天 ⇒
  第 4 次**结构性失明**（日志里那句 `1/4 次取不到步骤明细` 不是 API 抖动，是 `slice(0, 3)`）。
  现改为窗口内全取（上限 12），并把失明按成因三分：**取数失败（带原因）／判据主动未取／无取数记录**，
  覆盖度以 `步骤明细覆盖 N/M` 摊出；全覆盖时不再出该警告。夹具 17 条（本轮 +2）。

## 我们存了哪些个人数据（受 `npm run verify:pii` 对账）

权威清单是 **`docs/pii-inventory.md`**，本节只给口径，具体到列的判定以那份登记册为准 ——
文档写"我们知道"不算数，登记册与 `db/**.sql` 全量列双向对账才算（第二十一轮起，改列不登记当场判红）。

- **采集面**：顾客下单要楼栋+房间号（送货必需）、微信号（联系必需）、可选付款截图；评价可带昵称与实拍图；服务提交表单是**任意键值**，内容由顾客决定。
- **可见面**：评价与其图片、昵称在顾客端公开可读；订单与服务提交只在管理后台，需密钥。CSV 导出**只含**房间号/商品/口味/数量/单价/小计/状态/时间八列，微信号与付款截图**不在**其中 —— 这一条不是承诺，是 `tests/piiExportAllowlist.test.js` 的等号断言。
- **出境面（实测一处，另有一处第二十四轮更正）**：唯一真实出境是 AI 导购 `pubAiChat` 把 `pub-<IP 前 40 位>` 当用户标识送给 Dify（外加顾客自己键入的提问文本 —— 那是产品目的）。**本条此前写"AI 经营助手会把订单的 `wechat`/`remark` 带进 Dify"，第二十四轮按数据流重测后撤回**：那两列只出现在 aiAdvice 的 SQL 投影里，`buildAdviceInput` 只回传聚合量，值从未进入请求体（线级夹具见 `tests/aiContract.test.js`「出境面收敛」）。它们当时属于**白读**（没用到却把个人数据搬进内存/日志面），投影已收敛为 3 列，并由 `verify:pii` 的 P12 钉住"多一列白读即红"。
- **保留与删除**：个人数据目前**没有自动保留期**，删除只有管理端逐条删（`deleteOrder`/`deleteReview`/`deleteSubmission`）。例外是审计与限流两张表：`security_events` 按 90 天采样清理，`rate_limits` 无清理通道（其桶名含明文 IP，已在登记册挂为已知缺口）。
- **请求删除自己的数据**：本项目无自助通道，通过店内既有联系方式提出，管理员走逐条删除；删除后库存回补与状态机行为不变。
