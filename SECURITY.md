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
