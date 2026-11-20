# Rust 重写提速 · 新一轮独立复算（goal-74e679dd · 2026-11-21）

> 本轮目的：不依赖历史快照，用**本机当场实测**重新钉死「Rust 重写部分达到提速效果」。
> 结论：**提速成立且可复算**；Rust 成果已在线上，live deploy SHA == 本地 HEAD。

## 1. 现状核验（R-CURRENT，全部实测）
| 断言 | 命令/手段 | 实测结果 |
|---|---|---|
| 本地 HEAD | `git rev-parse --short=7 HEAD` | `41fdca1`（main，branch 无偏离） |
| 线上探活 | `curl https://supermarket-web.pages.dev/_health` | 200，`deploy=41fdca1`（**与本地 HEAD 逐字相等**） |
| 顾客端线上形态 | `curl https://lxh113377.github.io/` | 200，inline style×1 / stylesheet×0（Rust 内联提速形态在线上） |
| 工具链 | `cargo --version` | 1.99.1（stable-x86_64-pc-windows-gnu，自包含环境配方见 docs/14） |
| Rust 交付存在 | 目录树实测 | core/edge/wasm 三 crate + 20+ 测试 + 16 份文档，源码在库 |

## 2. 全门禁（当场复跑，非引用旧回执）
`node scripts/verify-all.mjs --cargo <tc>/bin/cargo.exe` → **GATE-PASS，rc=0**
- cargo test core+edge：PASS（26.8 s）
- edge release 构建：PASS（4.0 s）；wasm release-wasm 构建：PASS（1.3 s）
- WASM↔JS 对账+微基准：PASS（2.3 s）
- 复刻 class 面/字体分包/WASM 产物三方一致/A-B 自检：全部 PASS

## 3. HTTP A/B（同一份当前 dist 快照，仅服务端实现不同）
本轮新建 `.cache/dist-ab`（270 文件）作两侧共用产物；edge 侧 `precompress` 生成 90 br + 90 gz（文本省 41.0%）。
- baseline：`static-baseline-server.mjs --port 5181`（gzip + max-age=600，静态托管口径）
- edge：`supermarket-edge.exe serve --port 5182`（br + immutable + 内联 + Link + 原生 /_health）

复跑：`node scripts/measure-http.mjs --base http://127.0.0.1:518X --label <臂> --json docs/http-*-fresh-ab.json`

| 读数 | baseline | edge（Rust） | 变化 |
|---|---|---|---|
| 首屏 TTFB（5 次中位） | 7.51 ms | **1.43 ms** | **−81.0%** |
| 首屏 HTML 传输 | 30,587 B（gzip） | **23,313 B（br）** | **−23.8%**（1.31×） |
| 入口 chunk | 6,401 B（gzip, max-age=600） | **5,438 B（br, immutable 1y）** | **−15.0%** |
| 重复访问 | 304 / 0 B | 304 / 0 B | 均零字节命中 |
| Link 预载 | 无 | 5 条（入口/HomePage/字体×2） | Early Hints 载体 |
| 三态协商 | 拒压缩仍 gzip | gzip 30,346 / identity 145,157 正确 | 语义正确 |
| /_health | 404 | 200（原生探活） | 新增 |

原始读数：[http-baseline-fresh-ab.json](http-baseline-fresh-ab.json) / [http-edge-fresh-ab.json](http-edge-fresh-ab.json)。

## 4. 判定
- 提速结论与历史 docs/05、docs/13 同向（TTFB 降、传输降、chunk 降、渲染阻塞归零），本轮用当前构建独立复现。
- 已知边界不变：WASM 端到端量不出收益（开关默认关）；线上编辑形态已由 Rust 重写交付。
- 回滚 = `git revert` rust/ 目录提交；本轮只新增证据文档，不改运行时代码。

**VERDICT=RUST_SPEEDUP_REVERIFIED_OK**
