# 01 · 技术选型与理由

> 本文件是「Rust 重写」交付件的第一部分（共 6 部分，索引见 [README](../README.md)）。
> 所有结论后面都跟着**实测数字**或**一手回执路径**，没有「我认为」。

## 1. 先定边界：这次重写的是什么，不是什么

| 维度 | 现状（2026-10-26） | 本次改法 | 依据 |
|---|---|---|---|
| 前端渲染 | React 19 + Vite 8 + HashRouter，14 个懒加载路由 | **不动组件树**（视觉/交互契约由「不重写」保证） | 视觉呈现与交互逻辑是硬约束，重写组件树是纯风险 |
| HTML 入口 | 静态 `dist/index.html`（2,651 B），样式表外链渲染阻塞，入口 chunk 之外的路由 chunk 靠 JS 执行后才发现 | **Rust 边缘服务流式生成外壳**：内联样式 + 首屏路由 preload + 预压缩 + ETag | `.lighthouse/admin-t0240-s1.json` 实测：文档 t=1ms → 入口 chunk t=1027ms → HomePage chunk t=1707ms → 更深层 t=2082…2682ms |
| 静态资产 | Cloudflare Pages / GitHub Pages 托管 | Rust 边缘服务交付（内容 ETag、`_headers` 策略、br/gz 预压缩） | 同一份 `_headers` 声明被复用，不另造一套缓存规则 |
| 接口 | Cloudflare Pages Functions（`/web` 36 动作 / `/pub` 9 动作，见 `docs/api-contract.json`） | **默认字节级透传上游**；已原生化的只有 `/_health` 与公开读的边缘微缓存 | 45 个动作背后是真实 SQL 与并发校验；一次性重写等于拿线上做实验 |
| CPU 热点 | 购物袋计价、商城筛选、CSV 导出 | 编译为 **WASM**，但只采纳**实测有净收益**的那一条（常驻目录索引） | 见 docs/05 §4 的微基准表：三条被数据否掉，一条 2.47× 胜出 |

**结论一句话**：这次是「**边缘 + 交付链用 Rust 重写，业务与界面保持原样**」，WASM 只在被实测证明划算的一处启用。

## 2. 为什么是 Rust，而不是别的

### 2.1 为什么不是「继续用 Node/JS 写这个边缘层」

现网边缘层已经是 Node（Pages Functions）。要拿到的三项能力，JS 侧要么做不到、要么代价更高：

1. **首字节前不改一字节的选择性压缩**：预压缩 brotli（quality 11）在构建期算一次；
   Node 侧要么引 native 依赖（`iltorb`/`sharp` 这类），要么每次请求动态压缩。
2. **确定性分块流式输出**：需要精确控制「先发 head、再发 body」的帧边界（`http_body::Body` 的 `poll_frame`）；
   Node 的 `Response` 流要借助 Web Streams 的背压细节，可控性更差。
3. **同一份纯计算给两个宿主**：购物袋/筛选/CSV 的口径现在散在 `src/cart.ts`、`CustomerPage.tsx`、
   `utils/csv.ts` 三处；Rust 侧把它收进 `supermarket-core` 一个 crate，边缘与 WASM **共用同一份实现**
   ——「Rust 版和 JS 版算出两个数」在物理上不可能发生，这是 JS 侧写一个「共享包」做不到的
   （`functions/` 与 `src/` 是两条构建链，历史上已经因此写了三份同值常量）。

### 2.2 为什么是 axum + tokio，而不是更「轻」的框架

| 候选 | 否掉的理由 |
|---|---|
| `hyper` 裸写 | 路由/状态/请求体读取/优雅退出都要手写，本项目的路由面（`/`、`/web`、`/pub`、`/api/{*rest}`、`/_health`、SPA 回退）足够复杂到不值得省这层 |
| `actix-web` | 自带 actor 运行时与另一套 tokio 集成，多一层概念；本项目没有需要它的场景 |
| `poem`/`salvo` | 生态与运维资料面比 axum 小；而 axum 是 tower/hyper 的官方组合，中间件可复用 |
| axum 0.8（选用） | 与 hyper/tower 同源，`http_body::Body` 可直接手写（流式那条腿），依赖树可审计 |

**依赖表（edge，直接依赖 9 个，每个都写清用途）**：见 [docs/02 §2](02-architecture.md)。
关键取舍：`reqwest` 走 **native-tls（Windows SChannel）** 而不是 rustls ——
实测 rustls 的 ring 后端在本机 gcc 16.2 上编不过（`cc-rs` 报 temp 目录权限 + gcc 状态 0xc0000409），
而 SChannel 是系统 TLS：不引入新的传递依赖树，也不需要 C 工具链。

### 2.3 为什么 WASM 只在一处启用（这是本次最重要的一个判断）

第一版 WASM 是「JSON 协议 + 4 个算子」，实测产物 **173 KB raw / 57 KB brotli**，
且每次调用都要在主线程 `JSON.stringify` 一遍 —— 把 CPU 从 JS 挪到「JS 序列化 + wasm 解析」，
方向就是错的。改成紧凑二进制协议后产物降到 **70 KB raw / 23 KB brotli**（再走 wasm-opt `-Oz` → **59.7 KB / 22.2 KB**）。

但真正决定「用不用」的是跨边界成本。实测（`rust/scripts/wasm-host-test.mjs`，同机同进程）：

| 算子 | 规模 | wasm | JS 原实现 | 结论 |
|---|---|---|---|---|
| 购物袋汇总（纯数字） | 20 行 | 42.53 ms | 3.77 ms | **慢 11.3×** —— 20 行的算术不值得跨边界 |
| 一次性筛选（每次重传全表） | 65 件 | 331.06 ms | 23.54 ms | **慢 14.1×** —— 编码商品表的开销 > 筛选收益 |
| **常驻目录索引查询** | 65 件 | **92.57 ms** | 228.86 ms | **快 2.47×** —— 加载时算好小写索引，每次按键只传关键字 |
| CSV 导出 | 2,000 行 × 8 列 | 224.19 ms | 46.75 ms | **慢 4.8×** |
| CSV 导出 | 20,000 行 × 8 列 | 382.30 ms | 91.55 ms | **慢 4.2×**（规模涨 10 倍仍不占优） |

于是选型落定：
- **采纳**：`sm_catalog_load` + `sm_catalog_query`（常驻索引）——它卖的不是「Rust 跑得快」，
  而是**把每按键都要重做的 `toLowerCase` + 拼搜索文本挪到加载时**，这是 JS 侧结构上做不到的。
- **不采纳**：购物袋计价、一次性筛选、CSV 导出（三条都给了读数，保留在模块里但**不接入前端**）。
- 若前端接入后实测仍无净收益，按 [docs/06 §3](06-edge-cases-rollback.md) 的开关直接关掉，代价为零。

## 3. 范围项：自行决断记录（未回抛）

原文要求「若仍有缺失，先列出需确认的范围项」。按项目铁律（`rule31`/`rule37`：执行期不回抛），
以下四项**由本会话自行决断并留证**；任何一条若与预期不符，回滚方式见 docs/06：

| 范围项 | 决断 | 理由（证据） | 回滚 |
|---|---|---|---|
| 重写对象与边界 | 边缘 + 交付链 + （可选）WASM；**不重写 React 组件树** | 视觉/交互是硬约束；`.lighthouse` 一手读数显示瓶颈在「文档→chunk 发现链」与「TTFB」，不在组件实现 | 删 `rust/` 目录，线上仍走 Pages/GH Pages |
| 技术栈与主要瓶颈 | 瓶颈 = ①首屏 chunk 发现瀑布 ②样式表渲染阻塞 ③(GitHub Pages) TTFB 1582 ms ④重复访问缓存资格 | `.lighthouse/admin-t0240-s1.json`、`.lighthouse/customer-t1903-s1.json`、`dist/_headers` 的既有声明 | 每一条都对应一个独立开关（`--no-inline-css` 等） |
| Rust 落地方式 | **两者结合**：后端服务替换（网关+资产+外壳）+ WASM（仅常驻目录索引） | 上表 2.3 的五条读数 | 见 docs/06 §3 的分级开关 |
| 必须保持不变的契约 | `/web` `/pub` 的响应字节（透传）、错误码表 42 条、`code:-1` 红线、CORS 白名单口径、`_headers` 缓存语义、HashRouter 地址形态、CSV 的 BOM+CRLF 口径 | `docs/api-contract.json`、`functions/lib/errors.js`、`functions/lib/security.js` | 透传即契约本身；原生部分逐条有对账用例 |
