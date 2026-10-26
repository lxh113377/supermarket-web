# 04 · 本地构建、运行、接入与迁移

## 1. 前置

| 组件 | 版本 | 安装方式（本机实测路径） |
|---|---|---|
| Rust | stable 1.99.1（`rust-toolchain.toml` 钉 stable + wasm32 target） | `rustup-init.exe -y --profile minimal`；国内提速：`RUSTUP_DIST_SERVER=https://rsproxy.cn` |
| wasm32 目标 | — | `rustup target add wasm32-unknown-unknown` |
| wasm-opt（可选） | binaryen 123 | GitHub release `binaryen-version_123-x86_64-windows.tar.gz`；缺失时构建脚本跳过并告警（产物大 17.9%） |
| Node | ≥ 22（仓库要求） | 已有 |

## 2. 构建与测试

```bash
cd supermarket-web/rust

# ① 纯计算与契约对账（16 条跨语言用例）
cargo test -p supermarket-core

# ② 边缘服务（release：LTO + panic=abort + strip）
cargo build -p supermarket-edge --release

# ③ WASM 加速器 + 产物裁剪
cargo build -p supermarket-wasm --profile release-wasm --target wasm32-unknown-unknown
wasm-opt -Oz --enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext \
         --enable-nontrapping-float-to-int \
         -o target/supermarket_wasm.opt.wasm \
            target/wasm32-unknown-unknown/release-wasm/supermarket_wasm.wasm

# ④ WASM 与 JS 的实现对账 + 微基准（docs/05 §4 的表就是它的 stdout）
node scripts/wasm-host-test.mjs
```

## 3. 运行

```bash
# 构建期预压缩（幂等）：给 dist 里的文本资产写 .br/.gz
./target/release/supermarket-edge precompress --dist ../dist --quality 11 --min-bytes 1024

# 只看外壳（判据/目检用，不起服务）
./target/release/supermarket-edge shell --dist ../dist | head -40
#   [shell] html=133702 bytes / br=20715 / gz=25273 / 内联样式=130973 bytes / 首屏路由 preload=Some("assets/HomePage-W7CkpB2H.js") / 复刻=false

# 起服务（本地全功能）
./target/release/supermarket-edge serve \
  --dist ../dist --host 127.0.0.1 --port 8788 \
  --functions-origin https://supermarket-web.pages.dev \
  --print-origin  http://127.0.0.1:4328 \
  --api-cache-ttl-ms 60000
```

开关一览（每个都对应一种「关掉即回到现网行为」的回退）：

| 开关 | 默认 | 关掉/打开的效果 |
|---|---|---|
| `--no-inline-css` | 内联开 | 关：样式表回到外链（现网形态），首屏多一次渲染阻塞请求 |
| `--boot-replica` | 关 | 开：注入静态首屏复刻；CLS 需逐设备量（docs/05 §3） |
| `--api-cache-ttl-ms 0` | 60000 | 0：公开读不缓存，全部回源 |
| 不配 `FUNCTIONS_ORIGIN` | — | `/web`/`/pub` 回 500 `internal_error`（**明确报错，不静默降级**） |
| 不配 `CAMPUS_PRINT_ORIGIN` | — | `/api/*` 回 503 `PRINT_APP_UNAVAILABLE` |

## 4. 压测与验证（三条命令，全部可复算）

```bash
# ① HTTP 层：TTFB / 传输体积 / 编码 / 304 / Link（可分别对三条臂跑）
node scripts/static-baseline-server.mjs --dir .cache/dist --port 5181 &   # 对照臂（gzip + max-age=600）
./target/release/supermarket-edge serve --dist .cache/dist --port 5182 &  # 边缘臂
./target/release/supermarket-edge serve --dist .cache/dist --port 5183 --boot-replica &
node scripts/measure-http.mjs --base http://127.0.0.1:5181 --label baseline
node scripts/measure-http.mjs --base http://127.0.0.1:5182 --label edge

# ② 浏览器层：三条臂 × Lighthouse（mobile / simulate），中位数 + 原始读数落盘
node scripts/measure-local.mjs --samples 3 --arms baseline,edge,replica

# ③ 跨语言对账 + 微基准
node scripts/wasm-host-test.mjs
```

`measure-local.mjs` 复用仓库自己的 `scripts/collect-live-perf.mjs` 导出的
`resolveLighthouse`/`resolveBrowser` —— 于是**本机对照与线上回执用的是同一套 Lighthouse 与浏览器载体**，
两张表可以直接并排看（docs/05 §2 就是这么放的）。

## 5. 接入方式（前端如何使用 WASM 加速器）

1. 把 `rust/web/wasm-loader.js` 复制/软链到前端可 import 的位置（或经构建别名指向 `rust/web/`）；
2. 商品表到手后调一次 `catalogLoad(products)`（索引常驻 wasm 内存）；
3. 每次筛选/按键用 `catalogQuery({ topSubIds, subId, q, sort })`，拿到的是**原数组下标**，
   用下标取自己的对象（字段一个都不动）；
4. 任何一步拿到 `{ via: 'js' }` 就说明回落到了原实现 —— **行为不变，只是不快**。

> 当前仓内**尚未**把加速器接进 React（默认关闭）。理由是它必须先过老大的两个门：
> ① `report:item-budgets`（每页产出体积门禁）② 路由级测试/视觉回归。接入步骤与回退开关见 docs/06 §3。

## 6. 迁移步骤（分阶段，每阶段可独立回滚）

| 阶段 | 做什么 | 判据 | 回滚 |
|---|---|---|---|
| **P0 影子** | 只部署边缘服务到独立域名/IP，不接流量；跑 `measure-http` + `measure-local` | 两臂读数齐全、`/_health` 200、上游透传字节一致 | 关进程，零影响 |
| **P1 外壳与资产** | Cloudflare 前置，把 `/` 与 `/assets/*` 指到边缘（保留 Pages 作为回退源） | 首屏请求数 −1、HTML br ≤ gzip 的 85%、304 命中、CLS 不劣化 | 改 DNS/规则回到 Pages（分钟级） |
| **P2 接口只读** | `/pub` 的三个带 cacheKey 的读动作走边缘（其余仍透传） | `X-Edge-Cache: hit` 命中率、上游 QPS 下降、响应字节与回源一致 | `--api-cache-ttl-ms 0` 即时回退 |
| **P3 写动作** | 逐个原生实现写动作（每次一个），每个都带「同输入字节对账」 | 对账脚本逐动作对比（见 docs/05 §5） | 该动作回透传（配置级） |

**数据格式不变的保证**：边缘不碰 schema，读写都走 D1 HTTP API 或透传现网 Functions；
迁移期间**同一份 D1**，没有双写、没有中间库。

## 7. 接入 CDN 时的一个要点（Early Hints）

边缘在 200 响应上带 `Link: </assets/…>; rel=preload; as=script; crossorigin, …`。
Cloudflare 会把 200 上的 `Link` 头转成 **103 Early Hints**（hyper 1.x 不支持自己发 1xx，
所以「发 Link 头 + 让 CDN 转」是正确实现，而不是拿 200 冒充）。本机可验证的判据是
`measure-http.mjs` 里打印的那行 `Link`。
