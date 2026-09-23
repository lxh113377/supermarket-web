# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

## [未发布]

### 待办
- 端到端冒烟测试（浏览→加购→下单→查单→后台登录）接入 CI —— 阻塞中：本机 npm 网络不通，装不了 Playwright
- 覆盖率阈值门禁、产物体积预算门禁 —— 同上，待装 `@vitest/coverage-v8` / `size-limit`
- 其余 GitHub Actions 固定到提交 SHA（已完成 `actions/checkout`，其余待核 SHA）

## [0.1.0] - 2026-09-23

### 新增
- 商品图内容修正：40 号错图（呀！土豆 → 好友趣）与 18 号参数表图换实物图（`ce51d77`）
- `aiAdvice` 独立限流（60s/10 次，分桶 `rate:aiadv:{ip}`，位于鉴权之后）（`22b5e90`）
- 社区标准文件：`LICENSE`（MIT）、`SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md`
- 接口契约外化：`docs/api-contract.json`（`/web` 29 + `/pub` 7 = 36 个 action，含写操作/缓存键/限流桶属性）；`npm run gen:api-contract` 生成，`npm run verify:contract` 校验漂移（41 断言，已接入 `npm run verify`）
- CI 加固：最小权限 `permissions: contents: read`；`actions/checkout` 固定到提交 SHA

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
