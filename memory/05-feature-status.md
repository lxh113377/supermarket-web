# 05 - 功能状态

> 本文件记录各功能的实现状态。
> 归档类型：增量（已实现的项移入归档）

## ✅ 已实现

> ⚠️ 下方前 10 条为 **Cloudbase 旧架构**时期记录，架构已整体迁移到 Cloudflare Pages + Functions + D1 + KV（功能语义大多保留，实现位置已变）。新架构清单见本节末尾「**Cloudflare 架构（现行）**」。

### Cloudflare 架构（现行）
- [x] 顾客端 — 首页/分类/商城/详情/购物车/确认订单（房间号必填）/支付页（收款码，模拟）/下单成功/服务表单/AI 导购
- [x] **/shop 两阶段重构（2026-09-25）** — 阶段一：筛选态（大类/子类/搜索/排序）收进 URL，`/shop/:categoryId?/:subId?` + `?q=&sort=`，TopNav 改纯受控，非法值三档归一；阶段二「暖白画廊」：图注式商品卡（1:1 满幅图 + 规格独立行）、两端各自设计（手机双列横条 / 桌面侧栏四列画廊）、价格改 brand-700 修对比度 2.82→4.79:1。详见 CHANGELOG 追加十二/十五。
- [x] **详情页面包屑取真实分类（2026-09-25）** — 由硬编码「首页 › 生活 › 零食饮料」改为按 `product.subcategories` 派生，两级链接指向 /shop 深链可真的点回去；实测 order 16 → 饮品›提神、order 24 → 饮品›矿泉水。
- [x] **商品图治理（2026-09-25）** — 11 张问题图重做 9 张（必应 murl 链路 + 联络表目检 + 全尺寸规格体检，拦下 250ml/330ml/555ml 规格冲突与茄汁味/茉莉清茶/甘师傅串图）；order 20 三轮无合格素材、order 51 已下架，均维持原图。**注意：9 张里 6 张对应商品处于下架态，线上当前只有 6/17/53 真正生效。** 详见 CHANGELOG 追加十三/十四。
- [x] 管理后台 — 数据看板（echarts 按需）、商品内联编辑（禁弹窗）、订单管理、评价管理、服务表单流转
- [x] 后端 — `/web` 30 action + `/pub` 8 action + `/_health`；服务端重算金额、字段白名单、图片 scheme 白名单
- [x] 履约闭环（2026-09-24 对标轮）— 订单 5 态状态机（pending→paid→delivering→completed，旁路 cancelled；服务端 ORDER_TRANSITIONS 强制，status TEXT 零迁移）；顾客侧 `/pub getOrderStatus` 进度轮询（修复旧轮询误用 adminCall 必然鉴权失败的缺陷）；前后端迁移表 parity 测试锁定
- [x] 库存防超卖（2026-09-24 裁决轮，对标 C1）— products.stock（-1 不限售）；下单守卫式占用/取消与删除回补/误取消恢复重占用；管理端内联编辑库存字段 + 缺货/低库存角标；verify-backend +18 断言
- [x] 订单查询页 #/order-query（2026-09-24，对标 litemall 订单跟踪）— 输单号看 5 步进度；成功页单号展示/复制/查询入口，sessionStorage 跨导航兜底
- [x] 超时单工作台（对标第三轮 B5）— OrdersTab 内联面板接 `stalePendingReport`：汇总/库存占用明细/"已传付款截图"徽标/逐单取消（复用状态机+回补路径；禁弹窗；只读密钥静默降级）
- [x] 工程防线（对标第三轮 C1/C2/B4）— 单 action SQL 语句峰值基线 `docs/sql-baseline.json`（verify-backend 内置，N+1 回归 CI 红）；生产依赖 license 白名单门禁 `verify:licenses`（GPL/AGPL/LGPL/SSPL/Elastic/未知拦）；页面层覆盖率 19.68%→23.65%，阈值棘轮 23/21/20/24
- [x] 防线轮 K1+K2（2026-09-25）— 三块门面首次进故障路径断言（`api/client.ts` 超时/非 JSON/缺 code/网络抛错/端点选择/密钥退化、`localStore.ts` 播种判定/浅拷贝/越界钳制、`auth.ts` 写失败仍失效）；**修掉两处真实失效缺陷**（`db/reviews.ts` 三处"只在成功才失效" + `updateOrderStatus`/`deleteOrder` 零失效），收口为 `catalogCache.withCacheInvalidation(fn, invalidate?)`；新增真浏览器门禁 `e2e-cloud-stub`（生产构建 + 假桩，断四图真出 canvas 与零未捕获异常）并**首次把 `e2e` 与新 job 一起列入 `deploy.needs`**（此前 e2e 红了也照常部署）。631 用例 63 文件，stmts 80.91/branches 74.08/func 76.41/lines 82.52，棘轮 **78/72/74/80**。反例自证 18/18。详见 CHANGELOG 追加十八。
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
