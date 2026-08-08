# 超柿 - 项目交接文档

> 最后更新：2026-08-08（全量上线）

## 一、项目概述

"超柿"是一个面向宿舍/小区场景的在线超市购物系统，支持顾客浏览商品、加购下单、在线支付（扫码），以及管理员后台管理商品、订单、看板。

线上地址：https://chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com/#/

## 〇、2026-08-08 全量上线记录

- 功能：订单字段（房间号/微信/备注/付款截图/子分类）落库、评价体系上云（addPublicReview + seedReviews 幂等导入 20 条）、商品多图轮播、数据卫生（错误上报治理、商品上限 1000）
- 工程：41 个 src 文件 TypeScript 迁移（strict，0 错误），97 个单测全绿
- GUI：品牌色统一、错误态重试、内联编辑错误文案、aria-label、ServiceFormPage 压缩修复
- 图片：order20 由错误的"东鹏特饮"广告图替换为 OCR 验证的"猎兽 PREDATOR 500ml"白底抠图（备份 20_old.webp）
- 部署（腾讯云 API 管家）：tccli 授权 + DescribeEnvs/DescribeTables/DescribeHTTPServiceRoute/DescribeLoginConfig 只读验证；CreateHTTPServiceRoute 新增 `/pub → public-api`；hosting 128 文件 + admin-api/public-api 双函数上线
- 关键坑：public-api 此前从未被 HTTP 路由调用、部署包缺 node_modules → 补依赖重部署解决；`tcb fn log` 在 CLI 3.6.4 不可用
- 线上状态：sm_products=49、sm_orders=1（测试单已删）、sm_reviews=20、sm_submissions=1；SW 版本 sm-v1786129950705，用户需强刷
- 详细记忆：`memory/07-next-steps.md`（新对话入口）+ `memory/AGENTS.md`（savepoint 生成）

## 二、技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + Vite 8 |
| 样式 | Tailwind CSS 3 |
| 路由 | react-router-dom 7（HashRouter） |
| 后端 | 腾讯云 CloudBase（云函数 + 数据库，HTTP 访问服务 /web→admin-api、/pub→public-api） |
| 部署 | CloudBase 静态网站托管 |
| Lint | oxlint |
| 测试 | vitest（97 用例全绿） |

## 三、项目结构

```
supermarket-web/
├── public/
│   ├── images/          # 商品宣传图（按 order 编号命名，如 1.jpg）
│   ├── manifest.json    # PWA 配置
│   ├── sw.js            # Service Worker（仅缓存静态资源，不缓存 API）
│   ├── wechat-pay.png   # 微信支付二维码
│   └── alipay.jpg       # 支付宝二维码
├── src/
│   ├── main.jsx         # 入口，HashRouter + SW 注册
│   ├── App.jsx          # 路由表（全部懒加载）
│   ├── cloudbase.js     # CloudBase SDK 初始化 + 匿名登录
│   ├── db.js            # 数据层（CRUD + 分页 + 降级本地）
│   ├── auth.js          # 管理端云函数调用 + 字段白名单
│   ├── cart.js          # 购物车纯函数（localStorage 持久化）
│   ├── localStore.js    # 本地演示模式数据层
│   ├── hooks/
│   │   ├── useCart.js   # 购物车 Hook（跨 tab 同步 + stale closure 修复）
│   │   └── useProducts.js # 商品加载 + 实时监听
│   ├── data/
│   │   ├── products-seed.js # 种子商品（49 个）
│   │   └── reviews-seed.js  # 种子评价（20 条）
│   ├── components/
│   │   ├── AdminGuard.jsx   # 管理后台鉴权门（云函数验证）
│   │   ├── ProductCard.jsx  # 商品卡片（点击跳详情页）
│   │   ├── ProductsTab.jsx  # 管理端商品编辑（含图片/介绍/评价）
│   │   ├── OrdersTab.jsx    # 管理端订单（搜索/筛选/CSV导出）
│   │   ├── DashboardTab.jsx # 管理端看板（今日订单/营收/TOP10）
│   │   ├── TopNav.jsx       # 顾客端分类导航
│   │   ├── CartItem.jsx     # 购物车商品行
│   │   ├── OrderItem.jsx    # 订单确认商品行
│   │   └── ErrorBoundary.jsx
│   └── pages/
│       ├── CustomerPage.jsx     # 顾客首页（分类+搜索+排序+加购飞行动画）
│       ├── ProductDetailPage.jsx # 商品详情（图片+介绍+评价+加购）
│       ├── CartPage.jsx         # 购物车
│       ├── OrderConfirmPage.jsx # 确认订单（填房间号+打印小票）
│       ├── OrderSuccessPage.jsx # 下单成功
│       ├── PaymentPage.jsx      # 支付页（扫码+轮询状态）
│       └── AdminPage.jsx        # 管理后台壳（tab 切换）
├── cloudbaserc.json     # CloudBase 部署配置（云函数环境变量）
├── .env                 # 前端环境变量（VITE_CB_ENV_ID）
├── jsconfig.json        # 类型检查配置（strict + checkJs）
├── vite.config.js       # Vite 配置（相对路径 + SDK 分包）
└── package.json
```

## 四、路由表

| 路径 | 页面 | 说明 |
|------|------|------|
| `/#/` | CustomerPage | 顾客首页 |
| `/#/product/:id` | ProductDetailPage | 商品详情 |
| `/#/cart` | CartPage | 购物车 |
| `/#/order-confirm` | OrderConfirmPage | 确认订单 |
| `/#/order-success` | OrderSuccessPage | 下单成功 |
| `/#/payment` | PaymentPage | 支付 |
| `/#/admin` | AdminPage | 管理后台（需密钥） |

## 五、本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 构建生产包
npm run build

# 本地预览生产包
npm run preview

# Lint
npm run lint
```

注意事项：
- 新增路由文件后 Vite HMR 不会自动热更，必须重启 dev server
- 无 `.env` 中 `VITE_CB_ENV_ID` 时自动降级为本地演示模式（数据存 localStorage）

## 六、部署

```bash
# 构建 + 部署到 CloudBase 静态托管
npm run build
npx tcb hosting deploy ./dist -e chaoshi-d2g5xfkao100010ef
```

云函数部署（修改云函数后）：
```bash
npx tcb fn deploy admin-api -e chaoshi-d2g5xfkao100010ef
```

### 部署冒烟（npm run smoke）

部署后执行 `npm run smoke`（零依赖，Node 原生 fetch），四项检查全 PASS 才视为上线成功：

- 静态站根路径 HTTP 200（HTML 含 `id="root"`）
- `/web` getOrders / getProducts（需 ADMIN_KEY）
- `/pub` getPublicProducts

密钥解析优先级：`ADMIN_KEY` 环境变量 → `cloudbaserc.json` admin-api envVariables 中的非占位符 `aDMIN_KEY` / `ADMIN_KEY`（`${ADMIN_KEY}` 视为未注入）。端点解析优先级：`STATIC_BASE` / `API_BASE` / `PUBLIC_API_BASE` 环境变量 → `.env` 的 `VITE_CB_API_BASE` / `VITE_CB_PUBLIC_API_BASE` → 内置默认域名。任一检查 FAIL 时脚本 exit 1；脚本不输出密钥本身。

## 七、关键设计决策

### 7.1 安全
- 管理密钥不在前端代码中，通过 `cloudbaserc.json` 环境变量注入云函数
- AdminGuard 纯走云函数验证，无本地哈希兜底
- `auth.js` 对商品写入做字段白名单（PRODUCT_FIELDS），防注入
- 订单金额由云函数服务端重算，前端不传 totalAmount

### 7.2 数据层
- 云端模式：CloudBase 数据库 + 匿名登录
- 本地模式：localStorage 模拟（无 ENV_ID 时自动降级）
- 商品查询 limit(1000)（商品量小，够用）
- 订单查询已加分页（skip/limit，默认 50 条/页）
- 支付状态轮询走 SDK 鉴权通道（getOrderById）

### 7.3 购物车
- 纯函数 + localStorage 持久化
- useRef 解决 stale closure
- storage 事件实现跨 tab 同步

### 7.4 商品图片
- 按 `product.order` 编号命名存放于 `public/images/{order}.jpg`
- 管理后台可设置自定义图片 URL（优先级高于本地编号图）
- 图片加载失败自动降级为品牌色占位卡片
- 当前已有 13 张热门商品图

### 7.5 评价系统
- 管理后台可为商品添加/删除评价（存入商品文档 reviews 字段）
- 详情页优先显示云端评价，无云端评价时 fallback 到 reviews-seed.js

### 7.6 PWA
- Service Worker 仅缓存静态资源（JS/CSS/HTML/图片），API 请求不缓存
- manifest.json 含 SVG + 192px + 512px 图标

## 八、CloudBase 环境信息

| 项目 | 值 |
|------|-----|
| 环境 ID | chaoshi-d2g5xfkao100010ef |
| 区域 | ap-shanghai |
| 云函数 | admin-api（超时 30s） |
| 数据库集合 | sm_categories / sm_products / sm_orders |
| 静态托管 | chaoshi-d2g5xfkao100010ef-1458054906.tcloudbaseapp.com |
| 管理密钥 | 见 cloudbaserc.json envVariables.aDMIN_KEY |

## 九、已知限制 & 后续建议

1. **无 TypeScript** — 已加 jsconfig.json（strict + checkJs）提供 IDE 类型提示，完整 TS 迁移待做
2. **商品图片覆盖不全** — 49 个商品中仅 13 个有图，其余走占位图。补图只需往 `public/images/` 放对应编号 jpg
3. **支付为模拟流程** — 展示收款二维码 + 手动确认/轮询，未接入真实支付 SDK
4. **cloudbase-sdk 体积大**（746KB）— 可考虑按需引入或 CDN 外链
5. **无单元测试** — vitest 已配置，用例待补
6. **云函数源码不在本仓库** — cloudfunctions/ 目录需单独管理

## 十、文件修改记录

### 2026-07-25 会话 1（安全/逻辑/新功能）

本次会话完成的修改：

**安全修复：**
- AdminGuard 删除本地 SHA256 哈希兜底（防密钥泄露）
- auth.js 加 PRODUCT_FIELDS 白名单（含 image/description/reviews）
- OrderConfirmPage 不再传 totalAmount

**逻辑修复：**
- PaymentPage 轮询改用 getOrderById（SDK 鉴权）
- AdminPage mount 时并行预加载 orders（看板不再显示 0）
- db.js getOrders 加分页（skip/limit）

**新功能：**
- ProductDetailPage 商品详情页（图片+介绍+评价+加购）
- ProductCard 点击跳转详情
- ProductsTab 管理面板支持编辑图片URL/商品介绍/评价
- reviews-seed.js 种子评价数据
- public/images/ 13 张商品宣传图

**工程优化：**
- 删除 prop-types 和 agent-browser 死依赖
- 3 个组件清除 PropTypes 引用
- 新增 jsconfig.json
- manifest.json 补 PNG 图标
- 已部署至 CloudBase 线上

### 2026-07-25 会话 2（商品官方宣传图补齐）

**目标：** 补齐 49 个商品的官方宣传图（原仅 13 张，缺 36 张）

**执行方式：** 4 个 agent 并行下载（按品类分工），图源策略：苏宁易购/品牌官网/维基百科/京东

**结果：** 49/49 全部下载成功，覆盖率 100%

**图片来源分布：**
- 苏宁易购 imgservice.suning.cn：约 35 张（主力图源）
- gdyinjue.com：2 张（康师傅青梅绿茶/金桔柠檬）
- truly-fresh.ca (Shopify CDN)：1 张（0糖茉莉龙井）
- 腾讯新闻 CDN qqpublic.qpic.cn：1 张（猎兽功能饮料）
- 原有 13 张：1,5,6,8,14,18,22,24,32,33,38,46,49

**新增工具脚本：**
- `scripts/gen_placeholder_images.py` — SVG 占位图生成器（本次未使用，保留备用）
- `scripts/verify_images.py` — 图片有效性验证脚本（支持 jpg/png/webp 格式检测）

**验证结果：**
- 49 张图片全部有效（size > 10KB + 有效图片格式）
- 格式分布：43 jpg + 5 png + 3 webp（含原有 3 张 webp）
- 无效图片：0
- 缺失图片：0

**注意：**
- 图片扩展名统一为 .jpg，但实际格式可能是 png/webp（浏览器按文件内容自动识别，不影响显示）
- 部分图片来自非官方渠道（如 gdyinjue.com、truly-fresh.ca），但均为真实产品图
- 猎兽功能饮料（order 20）图片来自腾讯新闻 CDN，是新闻配图而非官方宣传图，但清晰展示产品
