# 06 · 边界情况、已验证边界之外的东西、回滚方案

## 1. 边界情况清单（按「触发条件 → 后果 → 处置」写）

### 1.1 构建产物形态变化

| 触发 | 后果 | 处置 |
|---|---|---|
| `dist/index.html` 不存在 / 读不到 | 外壳构建失败 | **启动即失败**（`build_app` 返回 Err，进程退出码 1）——宁可起不来，也不要「起来了但发的是旧壳」 |
| 产物里没有 `<link rel=stylesheet>`（例如样式改成内联或改名） | 内联步骤跳过，其余照旧（preload/压缩/缓存仍在） | 代码里的 `if let Some(tag)` 分支；实测判据：`shell` 子命令输出的 `内联样式=0` |
| 产物里没有 `HomePage-*.js`（路由改名） | 只少一条 preload，其余不受影响 | `find_asset_prefix` 找不到就静默跳过（退化成现网行为，不是错误） |
| `_headers` 缺失/改格式 | 缓存头回退到「只有 ETag，无 Cache-Control」 | `Policy::default()`；`verify:cache` 在现网侧仍会判红，所以不会被静默接受 |

### 1.2 内容协商与压缩

| 触发 | 后果 | 处置（已实现） |
|---|---|---|
| 客户端 `Accept-Encoding: br;q=0, gzip` | 若误用 `contains("br")` 会给无法解码的响应 | 解析 q 值：实测该头 → gzip 25,273 B |
| `br;q=0, gzip;q=0` | 必须回 identity | 实测 → 133,702 B（**不再压缩**） |
| 预压缩文件缺失（CI 忘了跑 precompress） | 走原文件 + identity | 资产索引里 `brotli: None` ⇒ 协商自然降级；启动横幅会显示资产数与规则数，便于发现 |
| 压缩流被按明文切点切块 | 客户端解码失败 | 已避免：有 `content-encoding` 时不分块（见 docs/03 §1.2 的取舍说明） |

### 1.3 缓存与 ETag

| 触发 | 后果 | 处置 |
|---|---|---|
| 「同名换内容」资产（`/images/{order}.webp`、`sw.js`） | 元数据 ETag 会误判 304，用户看到旧图 | 小文件一律**内容 sha256**；`/assets/*` 的 immutable 依赖 Vite 的 hash 文件名（**红线**：若将来出现 `/assets/` 下不带 hash 的文件，必须改回 `max-age=600`） |
| `If-None-Match: *` / 弱 ETag / 逗号列表 | 协商失败 | 逐项比较 + `W/` 前缀处理（`is_not_modified`） |
| `_headers` 与边缘硬编码冲突 | 缓存语义漂移 | **不硬编码**：规则从 `dist/_headers` 读（docs/03 §4.1） |

### 1.4 接口与上游

| 触发 | 后果 | 处置 |
|---|---|---|
| 未配 `FUNCTIONS_ORIGIN` | `/web`/`/pub` 无法透传 | 回 500 `internal_error` + 中文原因（**不假装成功**） |
| 上游超时/不可达 | 网关失败 | 15 s 超时后回 500；**公开读的微缓存成为降级保护**（命中时上游挂了也能出数），TTL 60 s |
| 请求体超过 12 MiB | 评价晒图（3×800 KB base64）异常膨胀 | 回 `payload_too_large`（413），与现网语义一致 |
| `action` 不在公开白名单 | — | 回 `action_not_public`（403），与 `handlePublic` 同判据 |
| 非 POST 打到 `/web`|`/pub` | — | 405 + `invalid_action` 体（与「只导出 onRequestPost」同语义） |
| 打印应用未配/不可达 | `/api/*` | 503 `PRINT_APP_UNAVAILABLE` + 机器可读 code（不静默变空页） |
| D1 未配置 | `/_health.db` | `unknown`（三态与现网一致，不假装 ok） |
| 上游返回 429 | 前端要拿 `Retry-After` | 原样透传上游头；原生 429 分支按 `Math.max(1, ceil(ms/1000))` 同口径 |

### 1.5 路径与安全

| 触发 | 后果 | 处置 |
|---|---|---|
| `../` / 百分号编码路径 | 目录穿越 | 资产交付只做**索引精确匹配**（不拼接、不解码），未命中即 404/SPA 回退 |
| CSP 与内联样式 | 哈希算错 ⇒ 整页无样式 | 哈希对**内联的同一段字节**计算（`shell.rs` 测试含 base64 向量）；实测判据：headless 打开后检查 `getComputedStyle`（docs/05 §5 的验证清单含这一条） |
| 内联样式 + `style-src` 不放宽 | 样式被拦 | 只放宽这一份哈希（实测头部：`style-src 'self' 'sha256-6hUz…'`） |
| HEAD 请求 | 不应带体 | 已处理：带头不带体 |

### 1.6 WASM 特有

| 触发 | 后果 | 处置 |
|---|---|---|
| ABI 版本漂移（改了协议没升版本） | 错位解释出「像数字的垃圾」 | `sm_abi_version()` 校验，不符**拒绝加载**并回落 |
| 结果区被下一次调用覆盖 | 偶发算错价 | 胶水读结果**立即拷贝**（`copy.set(...)`），并在注释里钉死原因 |
| 未加载就查询 | 返回空列表 ⇒ 被读成「没货」 | wasm 侧返回 `-3`（形状错）而不是空结果；胶水据此回落 |
| 输入长度被写坏 | 越界读/巨额分配 | 每一步读取都做边界检查；单次输入上限 24 MiB；`panic=abort` 下不 panic |
| 运行期任意失败 | 每次交互都白跑一趟 | 失败即**永久回落**（`enabled=false`）并在控制台留一条告警 |
| 索引未重新加载（商品表变了） | 查询结果用旧表 | 接入方在商品表变化时重新 `catalogLoad`（docs/04 §5 第 2 步）；这是接入约定，不是自动监听 |

## 2. 已验证边界之外（诚实清单）

1. **45 个 API 动作尚未原生实现**：目前是透传 + 只读微缓存。原生逐个替换是 P3 的事（docs/04 §6）。
2. **WASM 加速器尚未接进 React**：默认关闭。接入必须先过体积门禁与路由测试（docs/04 §5）。
3. **HTTP/2 未实现**：边缘只跑 HTTP/1.1（keep-alive + Content-Length）。生产形态是 Cloudflare 终止 h2/h3 回源 h1，
   本机压测因此代表的是「回源腿」；若要边缘直接对端 h2，需加 `h2` 支持（本次未做，因为 CDN 已经承担）。
4. **增量压缩流式（br 分块 flush）未实现**：已给出取舍（整包预压缩保字节），identity 路径保留真分块。
5. **亮/暗色与视觉回归**：本机 Lighthouse 与 HTTP 读数覆盖了布局稳定性（CLS），
   但不替代仓内既有的 Playwright 视觉判据 `npm run test:visual` —— 接流量前必须跑它。

## 3. 回滚方案（分级，任何一级都可单独执行）

### L0 总体：把流量退回现网托管

```text
DNS / Cloudflare 规则：把 / 与 /assets/* 的回源指回 Pages（supermarket-web.pages.dev）与 GH Pages
或直接停掉边缘进程：kill <pid>（无状态、无 schema 变更、无数据写入）
```
因为边缘**不写 D1、不改 schema、不做双写**，回滚没有数据面残留要处理。

### L1 功能级开关（不用改代码）

| 现象 | 关掉什么 | 效果 |
|---|---|---|
| 首屏样式异常 / FOUC | `--no-inline-css` | 回到外链样式表（现网形态） |
| CLS 或视觉差异 | 去掉 `--boot-replica` | 回到「等 JS 渲染」 |
| 接口数据看起来不对 | `--api-cache-ttl-ms 0` | 公开读全部回源 |
| 某个动作行为异常 | 不配 `FUNCTIONS_ORIGIN`（或让该动作继续透传） | 该请求回现网实现 |
| 上游不可达时的可用性 | 调大 TTL | 微缓存成为降级保护 |

### L2 代码级

`rust/` 是**自包含**目录：不 import 任何 `src/` 代码、不改任何前端文件、不改 schema。
所以 `git revert` 本目录的提交即可彻底回滚；判据是 `npm run verify` 全绿（本目录不参与前端门禁）。

### L3 回滚后的验证清单（三件都要有回执）

```bash
npm run uptime                                   # 线上探活（含 /_health、管理端、顾客端、打印反代）
node rust/scripts/measure-http.mjs --base <回滚后的地址> --label after-rollback
npm run smoke                                    # 部署冒烟
```
