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

## 我们存了哪些个人数据（受 `npm run verify:pii` 对账）

权威清单是 **`docs/pii-inventory.md`**，本节只给口径，具体到列的判定以那份登记册为准 ——
文档写"我们知道"不算数，登记册与 `db/**.sql` 全量列双向对账才算（第二十一轮起，改列不登记当场判红）。

- **采集面**：顾客下单要楼栋+房间号（送货必需）、微信号（联系必需）、可选付款截图；评价可带昵称与实拍图；服务提交表单是**任意键值**，内容由顾客决定。
- **可见面**：评价与其图片、昵称在顾客端公开可读；订单与服务提交只在管理后台，需密钥。CSV 导出**只含**房间号/商品/口味/数量/单价/小计/状态/时间八列，微信号与付款截图**不在**其中 —— 这一条不是承诺，是 `tests/piiExportAllowlist.test.js` 的等号断言。
- **出境面（实测一处，另有一处第二十四轮更正）**：唯一真实出境是 AI 导购 `pubAiChat` 把 `pub-<IP 前 40 位>` 当用户标识送给 Dify（外加顾客自己键入的提问文本 —— 那是产品目的）。**本条此前写"AI 经营助手会把订单的 `wechat`/`remark` 带进 Dify"，第二十四轮按数据流重测后撤回**：那两列只出现在 aiAdvice 的 SQL 投影里，`buildAdviceInput` 只回传聚合量，值从未进入请求体（线级夹具见 `tests/aiContract.test.js`「出境面收敛」）。它们当时属于**白读**（没用到却把个人数据搬进内存/日志面），投影已收敛为 3 列，并由 `verify:pii` 的 P12 钉住"多一列白读即红"。
- **保留与删除**：个人数据目前**没有自动保留期**，删除只有管理端逐条删（`deleteOrder`/`deleteReview`/`deleteSubmission`）。例外是审计与限流两张表：`security_events` 按 90 天采样清理，`rate_limits` 无清理通道（其桶名含明文 IP，已在登记册挂为已知缺口）。
- **请求删除自己的数据**：本项目无自助通道，通过店内既有联系方式提出，管理员走逐条删除；删除后库存回补与状态机行为不变。
