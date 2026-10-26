# 02 · 项目结构与模块划分

## 1. 目录

```text
supermarket-web/rust/
├── Cargo.toml              # workspace + 发布档（LTO/codegen-units/panic=abort/strip）
├── rust-toolchain.toml     # stable + wasm32-unknown-unknown（版本钉在文件里，不靠机器运气）
├── crates/
│   ├── core/               # 无 IO、无 async 的纯计算与契约（两个宿主的唯一真相源）
│   │   ├── src/contract.rs # 响应封套判定（成功=code 0、429 才发 Retry-After、trace 追加在末位）
│   │   ├── src/errors.rs   # 42 条错误码登记表（kind/status/retryable）+ code:-1 红线
│   │   ├── src/cart.rs     # 行键=productId+spec、封顶 99、左到右同一求和方向
│   │   ├── src/catalog.rs  # 筛选/排序/搜索建议 + **预计算索引**（WASM 快的那一条）
│   │   ├── src/format.rs   # toFixed/Math.round/千分位/toLocaleString 的 JS 等价实现
│   │   ├── src/csv.rs      # BOM + CRLF + 转义；借用式构建（零逐格分配）
│   │   └── tests/parity.rs # 16 条对账用例（E/C/F/V/D 五组）
│   ├── wasm/               # cdylib：C ABI + 紧凑二进制协议（无 wasm-bindgen）
│   └── edge/               # 边缘服务（axum）
│       ├── src/config.rs   # 命令行/环境变量（手写解析：9 个开关不值得引 clap）
│       ├── src/shell.rs    # SSR 外壳：内联样式+CSP 哈希、首屏路由 preload、静态复刻、Link 头
│       ├── src/assets.rs   # 资产索引：内容 ETag、预压缩变体、目录型入口
│       ├── src/policy.rs   # 解析 dist/_headers（缓存语义与 Pages 同源，不另写一张表）
│       ├── src/api.rs      # /web /pub 网关（透传优先 + 公开读微缓存）、/_health、打印反代
│       ├── src/cors.rs     # 与 functions/lib/security.js 逐字对齐的白名单口径
│       ├── src/d1.rs       # Cloudflare D1 HTTP API 客户端（探活 + 预留原生读）
│       ├── src/stream.rs   # 分块流式响应体（手写 http_body::Body，30 行，不引 futures）
│       └── src/main.rs     # 路由/协商(q 值)/304/HEAD、预压缩子命令、优雅退出
├── web/wasm-loader.js      # 前端粘合层：懒加载 + ABI 版本校验 + 失败必回落
├── scripts/                # 对账与压测工具（全部可复算）
│   ├── wasm-host-test.mjs        # WASM 与 JS 镜像实现逐条对账 + 微基准（docs/05 §4 的来源）
│   ├── measure-http.mjs          # HTTP 层：TTFB/传输体积/编码/304/Link
│   ├── static-baseline-server.mjs# 对照臂：gzip + max-age=600（现网静态托管口径）
│   └── measure-local.mjs         # 三条臂 × Lighthouse（复用仓内 lighthouse/浏览器解析器）
└── docs/                   # 六份交付文档（本目录）
```

## 2. 依赖表（为什么每一个都非它不可）

### edge（9 个直接依赖）

| 依赖 | 用途 | 不引它的替代与代价 |
|---|---|---|
| `supermarket-core` | 契约与纯计算的唯一真相源 | 各写一份 ⇒ 跨语言漂移（本项目已有三处同值常量靠测试钉住的先例） |
| `axum` | HTTP/1 路由与提取器 | 裸 hyper：路由/状态/优雅退出全手写，本项目的路由面不值得省这层 |
| `tokio` | 异步运行时、文件与信号 | 没有现实替代；特性只开用到的 8 个（不引 full） |
| `serde_json` | 请求/响应 JSON（`preserve_order`） | 手写 JSON 序列化：错误码表与字段顺序都要自己保，得不偿失；`preserve_order` 是为了**字段顺序与现网一致** |
| `sha2` | ETag 与 CSP 内联样式哈希 | 与浏览器同一套 sha256；引通用 crypto 栈是浪费 |
| `reqwest` | 上游 Functions 透传、D1 HTTP API | 手写 HTTP 客户端要自己处理 TLS/重定向/流；不值得 |
| `bytes` | 零拷贝字节块 | axum 自身依赖，直接引以构造分块 |
| `http-body` | 手写流式响应体 | 引 `futures-util`/`async-stream` 只为 30 行的实现，不划算 |
| `brotli` / `flate2` | 构建期 br/gz 预压缩 | 动态压缩会让每个请求吃 CPU；预压缩只吃一次（实测 q11 与 Node 的 brotli 差 15 字节） |

> 刻意**没有**引：`clap`（9 个开关）、`chrono`（一个 civil_from_days）、`base64`（一处 CSP 哈希）、
> `mime_guess`（15 个扩展名）、`regex`（无需正则的场景）、`serde derive`（edge 侧只用 Value）。
> 每个都换成了 30 行以内、有单测的可自证实现（`shell::tests` 里的 base64 向量就是例子）。

### wasm（2 个直接依赖）

`supermarket-core` + `serde_json`（协议里已不再用 JSON，但 `Cart`/`Product` 类型来自 core，
故 core 的 serde 依赖会传递进来；实测 wasm-opt 后 59.7 KB 里主要就这两块）。

### core（2 个）

`serde`（derive）+ `serde_json`：契约类型与测试向量需要它们。**core 不碰 IO/网络/时间**，
所以它能被 WASM 直接复用（`wasm32-unknown-unknown` 下 std 可用但无文件系统，core 不需要）。

## 3. 发布档（编译期就是优化）

```toml
[profile.release]           # 边缘服务：长驻进程，运行期 CPU 比磁盘 KB 值钱
opt-level = 3
lto = "fat"                 # core 的纯函数被 edge 与 wasm 共同内联
codegen-units = 1
panic = "abort"             # 去掉 unwind 表与 landing pad
strip = true
overflow-checks = true      # 保留：溢出是缺陷，不是性能项

[profile.release-wasm]      # WASM：产物要过网线
inherits = "release"
opt-level = "z"
```

WASM 产物体积链（每一步都实测）：
```text
cargo --profile release-wasm   70,233 B raw
wasm-opt -Oz                   59,670 B raw   (gzip 25,746 / brotli 22,243)
```
