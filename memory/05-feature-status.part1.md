# 05-feature-status.part1.md

<!-- 本卷为 05-feature-status.md 的延续 -->

## 📋 计划中

- [x] 测试纵深（对标第七轮 H1/H2）— 管理端 OrdersTab(97%)/ProductsTab(89%) 与顾客端详情页/评价表单/评价列表/图集/Overlay/AdminGuard/prefetchBus/imageCompress 全部进测试：453 用例 56 文件，stmts 74.71%、lines 76.39%，棘轮 74/68/69/76；同轮修掉「图集只有一张图时详情页显示错图」（ProductGallery 单图分支忽略调用方传入图）
- [x] 看板图表修复 + 可测性分层（对标第六轮 F1/P0）— echarts option 构造抽为 `utils/chartOptions.ts` 纯函数（主题/动效入参），hook 只管实例生命周期；**修掉生产包"四张图静默空白"**（side-effect 自注册模块被当 `use()` 入参 → `use(undefined)` 抛错被 async IIFE 吞）；新增 SSR 真库渲染测试 + 本地云端模式验收桩 `npm run build:stub && npm run serve:stub`（假密钥，无需生产密钥即可浏览器复核看板）
- [x] 工程防线（对标第六轮）— CHANGELOG 门禁浅克隆自愈 + CI `fetch-depth: 0`；覆盖率 319 用例 / stmts 57.25%，棘轮 57/53/50/59
- [x] D1 每日备份链路（C5）— d1-backup.yml cron 04:00 北京，缺 CF_D1_BACKUP_TOKEN 告警跳过（用户待配 token）
- [x] e2e — 7 用例（下单链路/空表单防误/管理端流转/冒烟4）；vite.config.e2e.js 空 envDir 隔离本机 .env
- [x] 安全 — 严格 CSP、五安全响应头、限流四档（KV 优先/回退 D1）、常量时间密钥比较、安全事件审计（SHA-256 指纹）
- [x] 权限分级 — `ADMIN_KEY` 全权限 + `ADMIN_READONLY_KEY` 只读（16 项 `ADMIN_WRITE_ACTIONS` 白名单拦截）
- [x] 性能 — 11 路由全 lazy + 空闲预取、商品图双规格 WebP、目录缓存 60s + 写失效、SW 分级缓存
- [x] 工程 — CI 六步门禁、部署后冒烟 + 失败自动回滚、每日探活、pre-commit 密钥扫描
- [x] 社区标准文件（2026-09-23）— LICENSE(MIT) / SECURITY.md / CONTRIBUTING.md / CHANGELOG.md

### 旧架构（Cloudbase）遗留记录
- [x] 顾客购物链路 — 商品浏览/搜索/加购/下单/支付轮询，房间号+联系方式+备注+付款截图落库
- [x] 订单服务端重算 — createOrder 服务端计价防篡改，items 冗余 subcategories（看板分类占比修复）
- [x] 评价体系 — addPublicReview 公开提交（评分 1-5 钳制、昵称/文本截断、图片≤5张≤2MB、限流），云端优先+本地降级
- [x] 种子评价 — seedReviews 幂等管理 action，线上已导入 20 条（覆盖 15 个商品）
- [x] 商品多图 — PRODUCT_FIELDS 含 images，详情页轮播，管理端内联编辑多图 URL/主图/排序
- [x] 数据卫生 — 移除前端错误上报污染 sm_submissions；public-api 商品上限 1000
- [x] TypeScript 迁移 — 41 个 src 文件全部 .ts/.tsx，strict 模式 0 错误
- [x] GUI 打磨 — SubmissionsTab 品牌色、HomePage 渐变、CustomerPage 重试按钮、内联错误文案、aria-label
- [x] 商品图修正 — order20 从错误的东鹏特饮广告图替换为 OCR 验证的猎兽 PREDATOR 500ml 白底抠图
- [x] 全量上线 — hosting 128 文件 + admin-api/public-api 云函数 + /pub 独立 HTTP 路由（tccli 创建）

## 🚧 开发中
<!-- 暂无 -->

## 📋 计划中
- 📋 评价晒图改云存储直传（当前为 base64 入库，最大 5 张 × 2MB，量大后建议 COS 临时签名直传）
- 📋 顾客账号体系（当前匿名登录关闭，下单免登录，仅房间号+联系方式）
- 📋 部署自动化脚本（密钥注入/占位符还原/双函数冒烟测试一键化）
