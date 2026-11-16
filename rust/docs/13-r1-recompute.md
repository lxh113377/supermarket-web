# 13 · r1 本机复算收口（2026-11-16 · goal-52b11071 Round 1）

> 目标：用 rust 重写部分达到提速效果。本轮＝把「提速」用**本机可复算**证据钉死（历史读数来自别的机器，本机 rust/target 此前不存在）。
> 结论先行：**提速成立且可复算**——edge 臂首屏传输 −23.9%、TTFB −68%、入口 chunk −15.6%、304 零字节、Link×5；
> WASM 常驻目录索引 2.42× 快（其余算子慢于 JS，开关默认关的实测依据复现）；37/37 动作原生化 e2e 80/80 与现网逐字段相同。

## 1. 门禁（全绿，可复跑）
| 判据 | 命令 | 结果 |
|---|---|---|
| 全门禁 | `node scripts/verify-all.mjs --cargo <tc>/bin/cargo.exe` | **GATE-PASS 全部通过**（test 99 用例=core91+edge8；edge/wasm 构建；wasm 对账；复刻；字体；产物；A/B 自检） |
| 原生 e2e | `RUST_E2E_LIVE=1 node scripts/check-api-native-e2e.mjs` | **GATE-PASS 80 用例**（公开8+管理读26+写46；逐字段含键序；审计条数一致） |
| WASM 对账+微基准 | `node scripts/wasm-host-test.mjs ../public/wasm/supermarket_wasm.wasm` | 26 项对账全过；catalog_query 常驻索引 **2.42× 快**；cart/filter一次性/csv 慢于 JS（与 docs/05 同向） |

环境修复（本机构建从零到绿）= [14-local-env-fix.md](14-local-env-fix.md)（rsproxy 镜像 + self-contained 补件 + gcc14 布局 + 旧套 crt 回滚；负控有牙）。

## 2. 本机 HTTP A/B（同一份当前 dist 快照 .cache/dist-r1，268 文件）
复跑：baseline `node scripts/static-baseline-server.mjs --dir .cache/dist-r1 --port 5181`；
edge `supermarket-edge.exe precompress --dist .cache/dist-r1` + `serve --dist .cache/dist-r1 --port 5182`；
`node scripts/measure-http.mjs --base http://127.0.0.1:518X --label <臂> --json docs/http-*-local-r1.json`。

| 读数 | baseline（静态托管口径） | edge（Rust） | 变化 |
|---|---|---|---|
| 首屏 TTFB（5 次中位） | 3.51 ms | 1.11 ms | **−68.4%** |
| 首屏传输 | 30,588 B（gzip） | 23,293 B（br） | **−23.9%** |
| 入口 chunk | 6,398 B（gzip, max-age=600） | 5,400 B（br, immutable 1y） | **−15.6%** |
| 重复访问 | 304 / 0 B / 0.73 ms | 304 / 0 B / 0.63 ms | 零字节命中 |
| Link 预载 | 无 | 5 条（入口+HomePage+字体×2 等） | Early Hints 载体 |
| 三态协商 | 拒压缩仍 gzip（对照臂不解析 q） | gzip 30,346 / identity 145,157 正确 | 语义正确 |
| /_health | 404 | 200（db/缓存/外壳信息） | 原生探活 |
| 预压缩 | 每请求 gzip | 构建期 90 br+90 gz，文本省 41.0% | CPU 一次性 |

原始读数：[http-baseline-local-r1.json](http-baseline-local-r1.json) / [http-edge-local-r1.json](http-edge-local-r1.json)。
口径注：当前 dist 已含托管侧内联 CSS（docs/12），故两臂都无独立 CSS 请求；本轮 A/B 量的是 **br/缓存/预载/流式** 层增量，与 docs/05 历史三臂（内联增量）互补不重复。

## 3. 线上现状（只读取证，子代理 live-probe）
[_incoming/rust-r1/live-probe.md](../_incoming/rust-r1/live-probe.md)：内联 style×1/link stylesheet×0/CSP sha256/br wire 30,021 B/Link×4/字体 A 包 11,604 B 两端 200/旧 215KB 字体 404 —— 提速形态**已在线上**。
漂移如实记录：`_health.deploy=d89ddab` ≠ HEAD a5035e5（落后 2 提交；/images/71.webp 回 SPA fallback）——r104 已登记 part462，外部凭据缺口（CF Analytics），不属本轮。

## 4. 边界与待办
- 部署不在本轮（A2 + 凭据缺口，r104 台账在案）；线上提速形态已是 Rust 重写成果（内联/字体分包/br）。
- WASM 开关默认关：端到端量不出收益（docs/05 §4c 复现依据在 wasm-host-test 微基准）。
- 环境修复只动工具链目录与 D:/app-cache（gitignore 外），**仓内源码零改动**；回滚 = git revert 本笔文档提交。
