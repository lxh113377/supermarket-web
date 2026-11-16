# DECOMPOSE — 2026-11-16 Rust 提速复算（goal-52b11071 · Round 1）

> 目标：用 rust 重写部分达到提速效果。
> 现状（磁盘实测）：rust/ 已有完整重写（core 纯计算 / edge 边缘服务 / wasm 加速器），docs/09 记 37/37 动作原生化；
> 但本机 rust/target 不存在、CARGO_HOME(D:/app-cache/cargo) 为空 ⇒ 历史读数全部来自别的机器，本轮必须本机复算。
> 工具链实测：cargo 1.99.1 = C:/Users/37533/.rustup/toolchains/stable-x86_64-pc-windows-gnu/bin/cargo.exe（不在 PATH）；
> RUSTUP_HOME=C:/Users/37533/.rustup；wasm32-unknown-unknown target 已装；crates.io 直连 200。

## 决策（Lead 自主拍板，#48/#31 零回抛）
- 本轮范围 = 「可复算的提速证据」：本机重建 rust 三 crate → verify-all 门禁全绿 → HTTP 双臂 A/B 本机重测 → 线上现状只读取证。
- 不做部署（wrangler OAuth 过期 + CF Analytics 凭据缺口，r104 已登记 part462；部署属 A2 且外部凭据缺口，不在本轮强推）。
- 不改既有判据/门槛凑绿；发现红先归因（本机环境 vs 真缺陷）。
- 构建走后台 job（fat LTO + codegen-units=1 冷构建预计 >10 分钟）。

## 写面分工
| 面 | 文件 | 谁 |
|---|---|---|
| 构建产物 | rust/target/**（gitignore） | Lead 后台 job |
| 本机 A/B 读数 | rust/docs/http-baseline-local-r1.json / http-edge-local-r1.json（新文件名，不覆盖历史） | Lead |
| 线上只读取证 | _incoming/rust-r1/live-probe.md | 子代理 live-probe |
| 判据面审计 | _incoming/rust-r1/gate-audit.md | 子代理 gate-audit |
| 分解卡/收口报告 | DECOMPOSE.md / rust/docs/13-r1-recompute.md | Lead |
| 会话前既有脏文件（#40 禁并入） | .ci/escape-hatch.jsonl / index.html / chip-crop-meta.json / chip-shot.png / nul | 明确排除 |

## 判据（每条可复跑）
1. cargo test -p supermarket-core -p supermarket-edge 全绿。
2. node rust/scripts/verify-all.mjs --cargo <绝对路径> → 末行 GATE-PASS rust/verify-all：全部通过。
3. node rust/scripts/measure-http.mjs 双臂（baseline 5181 / edge 5182，同一份 .cache/dist）：
   edge 首屏 CSS 传输=0、文档+CSS 合计 < baseline、304 命中、br 协商成立。
4. 线上只读：/_health 200；/pub getPublicProducts code 0；index.html 内联 <style> 存在、无 <link rel=stylesheet>；字体 A 包 200。

## 回滚
- 本轮只新增读数文件与报告，不改源码；git revert 收口提交即可。构建产物在 gitignore 内。
