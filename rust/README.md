# supermarket-web / rust —— Rust 边缘服务与 WASM 加速器

> 目标：在**不动** React 组件树、不动 D1 schema、不改接口契约的前提下，把首屏加载与响应速度提上去。
> 这份目录是「Rust 重写」的完整交付：可编译的代码 + 可复算的读数 + 六份说明文档。

## 交付件索引

| 文档 | 内容 |
|---|---|
| [docs/01-tech-selection.md](docs/01-tech-selection.md) | 技术选型与理由（含「范围项自行决断记录」） |
| [docs/02-architecture.md](docs/02-architecture.md) | 项目结构与模块划分、依赖表（每个依赖为何非它不可） |
| [docs/03-implementation.md](docs/03-implementation.md) | 关键实现：SSR 外壳/流式/内联与 CSP 哈希/按需加载/缓存与压缩/WASM 裁剪 |
| [docs/04-build-run-migrate.md](docs/04-build-run-migrate.md) | 本地构建、运行、压测、接入与分阶段迁移 |
| [docs/05-performance.md](docs/05-performance.md) | 可量化指标、前后对比、压测数据校对方法 |
| [docs/06-edge-cases-rollback.md](docs/06-edge-cases-rollback.md) | 边界情况、边界之外清单、分级回滚方案 |
| [docs/07-font-governance.md](docs/07-font-governance.md) | 中文展示体分包：首屏最大单项（215,580 B → 11,604 B）的治理与等价性证明 |
| [docs/perf-local.json](docs/perf-local.json) | 本机 A/B 的原始逐次读数（Lighthouse 交错采样） |
| [docs/perf-local-font.json](docs/perf-local-font.json) | 字体分包的四臂对照读数（baseline / font / edge / replica） |

## 三分钟跑通

```bash
cd supermarket-web/rust

# 1) 契约与纯计算对账（16 条跨语言用例）+ 边缘服务单测（6 条）
cargo test -p supermarket-core -p supermarket-edge

# 2) 构建（release：LTO + panic=abort + strip）
cargo build -p supermarket-edge --release
cargo build -p supermarket-wasm --profile release-wasm --target wasm32-unknown-unknown

# 3) WASM 与 JS 实现逐条对账 + 微基准（这是「加速器到底有没有用」的判据）
node scripts/wasm-host-test.mjs

# 4) 起服务（先用构建产物目录；预压缩幂等）
./target/release/supermarket-edge precompress --dist ../dist
./target/release/supermarket-edge serve --dist ../dist --port 8788 \
  --functions-origin https://supermarket-web.pages.dev
```

## 已验证的事实（都能复算，不是自述）

| 判据 | 命令 | 结果 |
|---|---|---|
| 契约与纯计算 | `cargo test -p supermarket-core -p supermarket-edge` | 16 + 6 条全绿（错误码表 42 条、购物袋、格式化、CSV、目录筛选） |
| WASM ↔ JS 同值 | `node scripts/wasm-host-test.mjs` | 30 项对账全绿（含 2000 行 CSV 逐字节一致） |
| 复刻不许漂移 | `node scripts/check-shell-parity.mjs` | 源组件 34 个 class 全部落在复刻里 |
| 首屏三臂对照 | `node scripts/measure-local.mjs --arms baseline,edge,replica` | 见 docs/05 §2（Lighthouse 12.6.0 / mobile / simulate / 3 次取中位） |
| HTTP 层 | `node scripts/measure-http.mjs --base <url>` | 见 docs/05 §3（TTFB/传输体积/编码/304/Link） |
| WASM 值不值得用 | 同上 `wasm-host-test` 的微基准表 | 见 docs/05 §4：**只有常驻目录索引 2.47× 胜出**，其余三条被数据否掉 |
| 字体分包完整性 | `node scripts/check-font-split.mjs` | 7 项全过（并集=源字体 932 字形、两两不重叠、A 覆盖首屏、预算） |
| WASM 产物一致 | `node scripts/check-wasm-artifact.mjs` | 产物 ⇄ manifest ⇄ ABI v2 三方一致（69,629 B） |
| 原生 API 形状 | `node scripts/check-api-parity.mjs` | 现网 /pub 三个公开读的**键集/键序与 Rust 映射逐位一致**（14 / 5 / 2 键） |
| 原生 API 端到端 | `node scripts/check-api-native-e2e.mjs`（`RUST_E2E_LIVE=1` 时进 verify-all） | 现网行 → mock D1 → 真边缘：三个动作响应与现网**逐字段相同**（含键序）+ 微缓存命中（见 docs/08 §3） |
| WASM 商城索引端到端 | `node scripts/measure-shop-filter.mjs --scale 1\|20` | 见 docs/05 §4c：**结果逐条等价，但端到端量不出收益**（~50 ms 帧地板）⇒ 开关默认关 |
| 字体分包渲染等价 | `node scripts/font-render-parity.mjs --old … --new …` | 5 个样本串 `TextMetrics` 逐位相同；像素比 **0/260,538 不同** |
| 仓内视觉门禁（geometries/contrast/触控目标） | `npm run test:visual` | **225 passed / 1 skipped / 0 failed** |
| 线上（顾客端） | 见 docs/07 §6 | `-a.woff2` → 200 / 11,604 B；旧单文件 → **404** |

## 边界（本次刻意没做，理由见 docs/06 §2）

- 45 个 API 动作**没有**原生重写：默认字节级透传上游 Functions（契约由「不接手」保住）。
  已原生的只有 `/_health` 与公开读的边缘微缓存。
- WASM 加速器**没有**接进 React（默认关）。接入步骤与开关见 docs/04 §5、docs/06 §3。
- 未实现 HTTP/2（生产形态由 Cloudflare 终止 h2/h3 回源 h1）；未实现增量压缩流式（取舍见 docs/03 §1.2）。
- 首屏真正的字节大头（215 KB 中文展示体）已在第 92 轮处理：按用量分包后首屏只下 **11.6 KB**
  （见 docs/07）；原字体的字形覆盖缺口（557 种 CJK 缺字本就走系统回退）**未改变**。

## 与仓内体系的关系

- **自包含**：`rust/` 不 import 任何 `src/` 代码，不改任何前端文件、不改 schema。
  `git revert` 本目录的提交即可彻底回滚（见 docs/06 §3）。
- **部署规矩**：任何 `wrangler` / Pages / D1 操作前必须先加载 `chaoshi-web-deploy` skill（项目红线）；
  本目录的迁移步骤遵守该 skill 的清单，不另立一套。
- **缓存声明同源**：边缘的 `Cache-Control` 不硬编码，读 `dist/_headers`（与 Pages 同源）。
