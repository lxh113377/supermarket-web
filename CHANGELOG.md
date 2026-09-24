# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

## [未发布]

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
