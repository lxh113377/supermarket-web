# 架构文档（ARCHITECTURE.md）

> 更新：2026-09-24 ｜ 读者：接手本项目的工程师 / AI agent。
> 部署操作红线与权威清单不在本文（见根 `AGENTS.md` 薄指针 → `chaoshi-web-deploy` skill）。
> 本文与代码不符时，以代码 + `docs/api-contract.json`（机器生成）为准，并请回改本文。

## 1. 系统总览

```mermaid
flowchart LR
  subgraph 顾客侧
    C1[微信顾客端<br/>lxh113377.github.io<br/>GitHub Pages]
  end
  subgraph Cloudflare
    P[Pages<br/>supermarket-web.pages.dev<br/>静态管理后台 + 顾客端镜像]
    F[Pages Functions<br/>/web 管理 31 action<br/>/pub 公开 8 action<br/>/_health 探活]
    D[(D1 SQLite<br/>products/orders/reviews/<br/>submissions/security_events/<br/>rate_limits/ai_calls)]
    KV[(Workers KV<br/>限流桶 + 60s 只读缓存)]
  end
  A[管理后台<br/>/#/admin 双密钥角色] -->|adminKey 会话| F
  C1 -->|跨源 POST /pub| F
  P --- F
  F --> D
  F --> KV
  F -->|AI 导购/经营建议| dify[Dify LLM 上游<br/>超时 20s + rule 兜底]
```

**双前端拓扑**：同一份 React 构建产物部署两处。Cloudflare Pages 同源承载管理后台与 API；GitHub Pages（`lxh113377.github.io`）作为微信弱网友好的顾客端，跨源调用 pages.dev 的 `/pub`（CORS 精确回显 origin）。构建期以 `VITE_CB_API_BASE` / `VITE_CB_PUBLIC_API_BASE` 烘焙端点；**两变量缺省则前端整体降级"本地演示模式"（localStorage）**——e2e 冒烟故意跑在该模式（`vite.config.e2e.js` 用空 envDir 隔离本机 `.env`）。

## 2. 前端（src/，React 19 + Vite 8 + TS strict + Tailwind）

| 层 | 位置 | 职责与关键决策 |
|---|---|---|
| 路由 | `App.tsx` + `routeLoaders.ts` | HashRouter；11 路由全 `lazy()`；hover 150ms + 空闲预取（`prefetchBus.ts` 单总线，防路由↔页面循环依赖） |
| API 层 | `api/client.ts` | `adminCall`（/web，带会话密钥）/ `publicCall`（/pub，免密钥）二分；超时 15s（AI 30s）；端点选择由**调用方语义**决定，前端不维护 action 白名单（信任边界唯一在后端 `PUBLIC_ACTIONS`） |
| 数据门面 | `db/*.ts` + `db.ts` | 云端/本地双实现统一出口；管理端**读取失败显式抛错禁静默回退本地**（防后端故障伪装成空态）；顾客 `createOrder` 失败降级本地是刻意设计（不丢单） |
| 本地存储 | `localStore.ts` | localStorage 模拟全业务（演示模式 / 下单兜底）；商品读写带浅拷贝防缓存污染 |
| 缓存 | `catalogCache.ts` 等 | 目录 60s + 写失效；`dashboardCache` 由后端 KV 承担 |
| 状态机 | `utils/orderStatus.ts` | 订单 5 态迁移表；**与 `functions/lib/actions/orders.js` 后端表逐字段 parity（`tests/orderStatus.test.ts` 锁定）**；本地模式在此强制，云端在服务端强制 |
| 图表 | `hooks/useDashboardCharts.ts` + `utils/chartOptions.ts` | 两层分工：hook 只管实例生命周期（动态 import / init / resize / dispose / setOption 触发），**option 形态是纯函数**（主题与 reducedMotion 作入参）→ 不挂 canvas 即可直测；echarts 只走 `lib/*` 深路径（barrel 声明 sideEffects 会整包拖入）；tooltip 一律 `renderMode:'plainText'` |
| PWA | `public/sw.js` + manifest | 分级缓存（静态 SWR / 图片 10min）；`CACHE_VERSION` 构建期自动注入 |

## 3. 后端（functions/，Cloudflare Pages Functions，ES module，不迁 TS）

```
web.js → handleAdmin        pub.js → handlePublic（PUBLIC_ACTIONS 白名单外全拒）
functions/lib/
  backend.js   调度层：鉴权 → 角色(readonly 拦 ADMIN_WRITE_ACTIONS) → 限流 → action switch → 写失效 → 审计
  security.js  常量时间密钥比较 / KV→D1 降级限流四档 / CORS 精确回显 / 图片 scheme 白名单 / 审计(SHA-256 指纹)
  db.js        D1 JSON 列编解码 / 白名单 insert / genId（o_/p_ + 时间戳base36+随机）
  cache.js     KV 60s 只读缓存 + invalidate{PublicCatalog,Dashboard,AiAdvice}
  actions/     products / orders / reviews / submissions / stats / ai 按域拆分
  dify.js      LLM 上游 + 30s 超时 + rule-based 兜底（source=rule 永不 5xx）
  notify.js    新订单外部通知：未配 ORDER_WEBHOOK_URL 即纯 no-op / 投递失败只出结论不冒泡 /
               载荷白名单 6 字段（不含微信号、备注、付款截图）/ 幂等命中不重复通知
```

**关键不变式**（改代码前先核对）：
1. **金额服务端重算**——`createOrder` 按 DB 现价逐项重算，客户端传来的价格一律不信任。
2. **写失效收口**——任何改 `orders/products/reviews/submissions` 的 action 必须同时进 `ADMIN_WRITE_ACTIONS`、`DASHBOARD_WRITE_ACTIONS`（如影响聚合），否则缓存/审计出现口子（2026-09-23 曾漏 8 项，verify-backend 已锁断言）。
3. **契约单源**——`docs/api-contract.json` 由 `scripts/api-contract.mjs` 从 backend.js 静态解析生成；CI `verify:contract` 防漂移，`PUBLIC_ACTIONS` 与 /pub case 集合必须完全对齐。
4. **订单状态机**——合法迁移唯一表在 orders.js `ORDER_TRANSITIONS`；status 列 TEXT 无 CHECK，扩态零迁移，但前端 `utils/orderStatus.ts` 必须同步（有 parity 测试）。
5. **副作用与主链路解耦**——任何"下单成功后的外部动作"（当前是 `notify.js` 的 webhook）必须 ①未配置即 no-op（不改状态、不耗重试）②失败只出结论不抛给调用方 ③挂在 `context.waitUntil` 上不 `await`。两个下单出口（`/pub` 与 `/web` 的 createOrder）共用 `maybeNotifyNewOrder` 一处适配器，**不许各写一份**（第十轮立，参照 litemall `isMailEnable()` 正例与 medusa "未启用也写 FAILURE 行并 throw" 反例）。
5. **图表 tooltip 恒为 plainText**——图表 name 取自入库文本（商品名/分类名），echarts <6.1.0 的 html renderMode 会把它拼进 DOM（GHSA-fgmj-fm8m-jvvx 汇点）。新增一张图必须展开 `TOOLTIP_BASE`；`tests/chartXss.test.ts` 并扫 hook 与 `utils/chartOptions.ts`，并按"4 张图 = 4 处 tooltip"计数防漏搬。
6. **echarts 按需模块只能 import，不能塞进 `use()`**——`echarts/lib/chart/*` 与 `lib/component/*` 是纯 side-effect 自注册模块（全文件零 export），`X.default === undefined`；把它们（连同 undefined）传给 `core.use()` 会在 `ext.install(...)` 处抛 TypeError，且发生在 async IIFE 内**不弹任何界面错误**，症状只有"看板四张图静默空白"。需要显式 `use()` 的只有 `echarts/renderers`。判据：`tests/chartRealRender.test.ts`（真库 SSR 渲染）+ `dashboardChartsHook` 的 mock 复刻了这条 install 语义。

## 4. 数据层（db/）

- `schema.sql`：7 表 + 13 索引（`db/` 内迁移文件按时间序，D1 用 `wrangler d1 execute` 应用——走 `chaoshi-web-deploy` skill）。
- 数组/对象字段以 JSON 文本存（`items`/`images`/`subcategories`），读写经 `db.js` jparse/jstringify。
- **库存（2026-09-24 已实现，对标 C1）**：`products.stock INTEGER DEFAULT -1`（-1=不限售）；下单即占用（守卫式条件 UPDATE 防并发超卖，同请求失败补偿回补）；取消/删除进行中单回补、completed 视为消耗、误取消恢复重新占用；迁移 `db/migrate-stock.sql`，**顺序铁律：先 `--remote` 迁移、后部署引用 stock 的代码**。

## 5. 质量门禁链（全部本地可跑，`npm run verify` 串联）

| 门禁 | 命令 | 拦截什么 |
|---|---|---|
| 密钥扫描 | `scan-secrets.mjs` | 明文密钥入库（pre-commit 也跑） |
| lint | `oxlint --max-warnings 0` | 0 容忍（warning 也算失败） |
| 循环依赖 | `check-import-cycles.mjs` | 8 扩展名全扫描，实测 73 模块 0 环（曾因只扫 .js 静默假通过） |
| 契约漂移 | `api-contract.mjs` | action 集合/写标记/白名单三方对账（/web 31 + /pub 8） |
| schema 漂移 | `check-schema-drift.mjs`（`verify:schema`） | 迁移引入的表/索引/列必须在 `schema.sql` 就位 |
| 类型 | 双 tsconfig（前端 + functions） | TS 7 strict 0 错 |
| 单测 | vitest（45 文件 313 用例）+ coverage(v8) | 组件/域逻辑/前后端 parity；阈值棘轮 57/53/50/59（只升不降） |
| 后端契约 | `verify-backend.mjs`（node:sqlite 模拟 D1） | 102 断言：鉴权/限流/状态机/审计/写失效 + 每 action SQL 语句峰值基线（`docs/sql-baseline.json`） |
| 依赖 license | `check-licenses.mjs` | 生产树 GPL/LGPL/AGPL/SSPL/Elastic 与未知许可一律拦 |
| CHANGELOG | `check-changelog.mjs` | 触及 `src\|functions` 却没写变更记录 → 红（`--relaxed` 留 warning 逃生门） |
| 体积 | `check-bundle-size.mjs` | 首屏 JS ≤95KB / CSS ≤11KB / 单 chunk ≤90KB（gzip 预算，实测 86.4/8.8/66.0） |
| e2e | playwright（8 用例，演示模式） | 下单链路 + 管理端流转 |
| 部署 | CI 六步 + 双端发布 + 冒烟 + 失败回滚 + 每日探活 | 见 `.github/workflows/` |

## 6. 已知取舍与演化路线

- **不做**：顾客账号体系（单店免登录是产品决策）、微服务拆分、迁移 TS 到 functions（部署编译链成本）。
- **待做（对标报告 P2）**：R2 图片直传（C2）、营销简化版（C3）、真实支付（C4=资质门槛，已归档不做）、顾客账号体系（C6=定位取舍）。D1 自动备份（C5）已上 cron 链路（缺 CF_D1_BACKUP_TOKEN 时告警跳过）。
- **管理员改判**（用户裁决 2026-09-24：暂不加）——终态（completed）不可回退是刻意设计；若运营确需强制改态，加双确认通道而非放开迁移表。
