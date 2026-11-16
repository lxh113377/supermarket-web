# rust/ 门禁与测量脚本审计 — 本机复算提速证据·精确命令契约

> 审计者：gate-audit 子代理 ｜ 审计时刻：2026-11-16T22:40+08:00（Asia/Shanghai）｜ 方法：**只读源码 + 只读存在性探测**，未跑 cargo/wrangler、未起任何服务（Lead 正在后台构建，避免锁冲突）。
> 所有行号均为本次审计读取时的源码行号；路径相对仓根 `D:/app-cache/chaoshi-web/supermarket-web/`（下文简写 `rust/…`）。
> 关键环境事实（本机实测）：`cargo` 不在 PATH；绝对路径 `C:/Users/37533/.rustup/toolchains/stable-x86_64-pc-windows-gnu/bin/cargo.exe` 存在（1.99.1，Lead 提供）；rustup 已装 target `wasm32-unknown-unknown`（`~/.rustup/toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/` 目录实测）；`CARGO_TARGET_DIR`/`CARGO` 环境变量当前为空；node v24.16.0 在 PATH；`python` 在 PATH = `D:\LibreOffice\program\python.exe`，**fontTools 4.67.0 可用**（check-font-split 的硬依赖，已实测 import OK）。

## ① verify-all.mjs 逐 step 表

入口：`rust/scripts/verify-all.mjs`（86 行）。CLI：`--cargo <路径>`（缺省取 `process.env.CARGO`，再缺省 `"cargo"`，verify-all.mjs:20）、`--skip-build`（verify-all.mjs:21）。所有子步骤 `spawnSync` 的 **cwd = rust/**（verify-all.mjs:13-14,47），单步超时 900 s（verify-all.mjs:47）。

**本机必须显式给 `--cargo` 绝对路径**（cargo 不在 PATH、CARGO 未设；不给则第 1 步 spawn 直接失败）。

| # | step 名称（源码原文） | 实际命令 | 前置 | 期望末行/退出形态 |
|---|---|---|---|---|
| 1 | cargo test（core 契约与纯计算 16 条 + edge 单测 6 条）⚠名称数字已过期，实数见 §③ | `<cargo> test -p supermarket-core -p supermarket-edge`（:26） | cargo 可执行；离线可跑（无联网腿） | 框架输出 `test result: ok.`；verify-all 打印 `▶ … PASS（x.xs）`（:50） |
| 2 | cargo build（edge release） | `<cargo> build -p supermarket-edge --release`（:28） | 仅当未给 `--skip-build`；产物落 `rust/target/release/supermarket-edge.exe`（.cargo/config.toml 未改 target-dir） | 同上 PASS 行 |
| 3 | cargo build（wasm release-wasm） | `<cargo> build -p supermarket-wasm --profile release-wasm --target wasm32-unknown-unknown`（:29） | 同上；rustup 需已装 wasm32 target（本机已装，实测） | 同上 PASS 行 |
| 4 | WASM ↔ JS 对账 + 微基准 | `node rust/scripts/wasm-host-test.mjs`（:31，用 process.execPath） | wasm 产物：优先 `rust/target/supermarket_wasm.opt.wasm`，退回 `rust/target/wasm32-unknown-unknown/release-wasm/supermarket_wasm.wasm`（wasm-host-test.mjs:18-23）；`rust/web/wasm-loader.js`（存在，实测） | `对账全部通过`（wasm-host-test.mjs:229），exit 0；不一致则 `有 N 条不一致` exit 1（:230） |
| 5 | 复刻 class 面不漂移 | `node rust/scripts/check-shell-parity.mjs`（:32） | **edge release 二进制**（默认 `rust/target/release/supermarket-edge.exe`，check-shell-parity.mjs:26，可 `--edge` 覆盖）；dist 默认**仓根 dist/**（:27，可 `--dist` 覆盖）；三个源组件 tsx（:58-62，均存在实测）；子进程 `edge shell --dist <dist> --boot-replica`（:94） | `✅ 复刻与源组件的 class 面一致`（:127）exit 0；缺 class → exit 1（:126）；二进制/源文件缺失 → exit 2（:87,97,102） |
| 6 | 字体分包完整性（并集/不重叠/A 包覆盖/预算） | `node rust/scripts/check-font-split.mjs`（:33） | `rust/fonts/display-font-manifest.json`（:21-22，存在）；`public/fonts/` 7 主包+1 补包 woff2（:31-34，存在实测）；**python + fontTools**（:62,81 spawnSync `python -c …TTFont…`，本机 fontTools 4.67.0 实测可用）；`src/index.css`、仓根 `index.html`（:104,121） | `GATE-PASS check-font-split：全部通过`（:150）exit 0；否则 `GATE-FAIL … N 项` exit 1（:151） |
| 7 | WASM 产物三方一致（产物 ⇄ manifest ⇄ ABI） | `node rust/scripts/check-wasm-artifact.mjs`（:34） | **仓根 `public/wasm/manifest.json` + 其点名产物**（check-wasm-artifact.mjs:16,21-28；实测存在：supermarket_wasm.wasm 69629 B，abiVersion 2，与 crates/wasm/src/lib.rs 的 ABI_VERSION=2 一致）；`rust/web/wasm-loader.js`（:44） | `GATE-PASS check-wasm-artifact：全部通过`（:56）exit 0；否则 `GATE-FAIL … N 项` exit 1（:57） |
| 8 | 原生动作端到端（现网真值 + mock D1）【条件腿】 | `node rust/scripts/check-api-native-e2e.mjs`（:38） | **仅当 `RUST_E2E_LIVE === "1"`**（:37，严格等值字符串）；需要联网打现网 `/pub` `/web` + edge release 二进制 + 仓根 `dist/` + `.dev.vars`（详见 §③）。不给开关时**打印一行 SKIP 及原因**（:40），不算失败 | `GATE-PASS check-api-native-e2e：公开面 8 + 管理读 26 + 写 46 … = 80 个用例`（e2e:1331）exit 0；现网不可达 → `GATE-UNVERIFIED …` **exit 2**（e2e:81）；断言失败 exit 1（e2e:1330,1335） |
| 9 | A/B 读数自检（渲染阻塞归零 / CSS 请求消失 / 请求数 −1）【内置非 spawn】 | 读 `rust/docs/perf-local.json` 并断言（verify-all.mjs:60-83） | 文件存在（本机存在实测）。断言 5 条：baseline.median.renderBlocking>0（:68）、edge.median.renderBlocking===0（:69）、edge.cssBytes===0 且 baseline.cssBytes>0（:70）、edge.requests<baseline.requests（:71）、edge.ttfb<baseline.ttfb（:73） | `PASS`（:79）；文件缺失 → 打印 `SKIP（还没有 …perf-local.json，先跑 measure-local.mjs）`（:82），**不算失败** |

汇总末行（verify-all.mjs:85-86）：全过 → `GATE-PASS rust/verify-all：全部通过` exit 0；任一失败 → `GATE-FAIL rust/verify-all：N 项未过` exit 1。失败步骤会回显子进程 stdout+stderr 的**最后 1500 字符**（:54）。

**本机推荐调用**（Lead 构建完成后）：
```powershell
cd D:/app-cache/chaoshi-web/supermarket-web/rust
node scripts/verify-all.mjs --cargo C:/Users/37533/.rustup/toolchains/stable-x86_64-pc-windows-gnu/bin/cargo.exe --skip-build
```
`--skip-build` 跳过步骤 2/3（Lead 已在跑构建，避免二次编译/锁冲突）；步骤 1 的 cargo test 仍会占用 target 锁，**须等 Lead 的构建结束再跑**。

## ② measure-http.mjs 与 static-baseline-server.mjs 精确 CLI 契约

### 2.1 measure-http.mjs（117 行）

| 参数 | 默认值 | 出处 |
|---|---|---|
| `--base <url>` | `http://127.0.0.1:5182` | measure-http.mjs:13 |
| `--label <名>` | `edge` | measure-http.mjs:14 |
| `--json <文件路径>` | `""`（**不落盘**） | measure-http.mjs:15；仅当非空才 `fs.writeFileSync`（:112-115） |

- **默认输出 = stdout 人读文本**；`--json` 是可选落盘参数，给了才写文件（内容为 `{label, base, at(ISO时间), shell, shell304?, entryChunk?, shellGzipOnly, shellIdentity, health}`，:115），写完 stdout 末行 `已写 <路径>`（:116）。不给 `--json` 时末行是 `[label] GET /_health → 200` + health body（:108-109）。JSON 带末行换行（:114-115，pre-commit 硬要求）。
- 取样：每类请求 `head()` 串行 5 次取**中位** ttfbMs/totalMs（:41-55）；transferBytes 取**最后一次**样本（:52）。传输体积一律读 `content-length` 头，因为 fetch 自动解压 br/gzip，`arrayBuffer().byteLength` 是解码后大小（:19-21,29-34）。
- 输出 JSON 字段名（以源码为准，**没有 cssBytes/renderBlocking 字段**——那是 measure-local 的）：

| 顶层字段 | 子字段 | 出处 |
|---|---|---|
| `label` / `base` / `at` | — | :115 |
| `shell`（GET /，accept-encoding: br,gzip） | `status, headers(全响应头小写键), decodedBytes, transferBytes, ttfbMs, totalMs, samples` | :30-37,48-54,60 |
| `shell304`（带 If-None-Match 重放；**仅当 shell 有 etag 才存在**） | 同 shell | :74-79 |
| `entryChunk`（HTML 里第一个 `assets/….js` 入口） | `path` + 同 shell 字段；**仅当 HTML 正则命中才存在**（:84-87） | :83-93 |
| `shellGzipOnly`（accept-encoding: gzip） | `bytes, encoding`（encoding 可为 undefined=identity） | :97-98 |
| `shellIdentity`（accept-encoding: br;q=0, gzip;q=0） | `bytes, encoding`（缺头补 `"identity"`） | :100-101 |
| `health`（GET /_health） | `status, body`（body 截前 400 字符） | :106-107 |

注意：encoding 具体值在 `shell.headers["content-encoding"]`（:63）；304 判据看 `shell304.status===304 && shell304.transferBytes===0`；Link/Early Hints 载体看 `shell.headers.link`（:68）。

### 2.2 static-baseline-server.mjs（95 行，长驻服务）

| 参数 | 默认值 | 出处 |
|---|---|---|
| `--dir <目录>` | `dist`（**相对进程 cwd** 再 path.resolve） | static-baseline-server.mjs:26 |
| `--port <n>` | `5181` | :27 |
| `--host <h>` | `127.0.0.1` | :28 |

行为契约（复刻现网静态托管，:9-12）：可压缩扩展名（.html/.js/.mjs/.css/.json/.svg/.txt，:47）且客户端 accept gzip → `zlib.gzipSync level 6` + `content-encoding: gzip`（:82-86）；所有响应 `cache-control: max-age=600` + 弱 ETag `W/"<size hex>-<mtimeMs hex>"` + `vary: Accept-Encoding`（:68-75）；If-None-Match 命中 → 304 空体（:76-79）；**无 brotli、无 /_health 路由**（/ _health 会走文件查找 → 404，:64）；目录逃逸 403（:55-57）。启动成功末行：`baseline（静态托管口径：gzip + max-age=600）监听 http://127.0.0.1:5181  dir=<绝对路径>`（:94）。**无 error 事件处理**：端口被占时 `server.listen` 抛未捕获 EADDRINUSE，进程崩退（node 默认行为，源码无 catch，:93-95）。

### 2.3 edge 二进制 CLI（serve 相关，crates/edge/src/config.rs）

`supermarket-edge.exe serve --dist <目录> --port <n> [--host h] [--no-inline-css] [--boot-replica] [--api-cache-ttl-ms n] [--functions-origin url] [--print-origin url] [--allowed-origin o]…`
出处：`serve` 子命令 config.rs:143；`--dist` :127；`--host` :128；`--port` :129；`--no-inline-css` :133；`--boot-replica` :134；`--api-cache-ttl-ms` :135；支持 `--flag value` 与 `--flag=value` 双写法（:73,116-119）。env 兜底：`DIST_DIR`(默认 dist)/`HOST`(127.0.0.1)/`PORT`(**8788**，注意与测量脚本的 5182 不同，必须显式 --port)（:83-85）。不认识的参数 → stderr `错误：不认识的参数：…` + USAGE，exit 2（:138；main.rs:45-49）。启动横幅含 `首屏外壳 html … B / brotli … B / gzip … B`（main.rs:113-116）——这是 docs/05 首屏体积的官方读数来源。

### 2.4 双臂 A/B 完整命令序列（baseline 5181 / edge 5182）

前置：`rust/target/release/supermarket-edge.exe` 已由 Lead 的 release 构建产出（**审计时刻尚不存在**，rust/target 整个目录为空/缺失，实测）；`rust/.cache/dist` 历史产物副本完整（952 文件，含 index.html、_headers、assets/*.br/*.gz、入口 `assets/index-C1YmgGos.js`，均实测存在）。两臂共用同一份 `.cache/dist` ⇒ 只差服务端实现这一个变量（docs/04:64-70 的官方序列即此形态）。

```powershell
# 终端 A（长驻，测完 Ctrl+C / Stop-Process 收掉）
cd D:/app-cache/chaoshi-web/supermarket-web/rust
node scripts/static-baseline-server.mjs --dir .cache/dist --port 5181

# 终端 B（长驻）
cd D:/app-cache/chaoshi-web/supermarket-web/rust
./target/release/supermarket-edge.exe serve --dist .cache/dist --port 5182

# 终端 C（测量；--json 可选但建议给，落盘新文件勿覆盖 docs/ 历史读数）
cd D:/app-cache/chaoshi-web/supermarket-web/rust
node scripts/measure-http.mjs --base http://127.0.0.1:5181 --label baseline --json ../_incoming/rust-r1/http-baseline-rerun.json
node scripts/measure-http.mjs --base http://127.0.0.1:5182 --label edge    --json ../_incoming/rust-r1/http-edge-rerun.json
```
说明：`--dir .cache/dist` 与 `--dist .cache/dist` 都相对各自进程 cwd=rust/ 解析（baseline :26 path.resolve；edge config.rs:127 PathBuf 相对 cwd）。docs/04:66-70 用的正是这对命令。历史 docs/http-baseline.json 的 base 是 5191、http-edge.json 是 5192（旧端口，字段实测），端口号本身不影响可比性——两臂同机同产物即可。期望结果形态（对照 docs/05 §3 与历史 JSON）：baseline shell.transferBytes≈1329 B/gzip、max-age=600；edge shell≈20-22 KB/br、cache-control 含 must-revalidate、link 4 条 preload、shell304 304/0 B、entryChunk br 更小、shellIdentity=解码后全量（~133 KB）。**edge 的 HTML 体积会随 .cache/dist 这一代产物浮动，勿拿旧文档数字当硬阈值**（历史 http-edge.json 实测 22432 B ≠ docs/05 表里 20727 B，两者产物代际不同）。

## ③ 测试面盘点（数源码，非跑测试）

### 3.1 Rust #[test] 总数 = 99（core 91 + edge 8；无 #[ignore]，全仓 grep 实测 0）

core：`rust/crates/core/tests/*.rs` 15 个文件（crate 源码 src/ 内联 #[test] = 0，grep 实测）：

| 文件 | #[test] 数 |
|---|---|
| parity.rs | 17 |
| order_intake.rs | 14 |
| stats.rs | 10 |
| stock_ops.rs | 8 |
| api_shapes.rs | 7 |
| stale.rs | 7 |
| auth.rs | 5 |
| orders_query.rs | 5 |
| stock_query.rs | 5 |
| order_state.rs | 3 |
| recalc.rs | 3 |
| sanitize.rs | 3 |
| ai_rules.rs | 2 |
| ai_advice.rs | 1 |
| promotions.rs | 1 |
| **合计** | **91** |

edge：src 内联 `#[cfg(test)]` 3 个模块（api_native.rs:148 / policy.rs:88 / shell.rs:380），共 8 条：
- api_native.rs:159 `sql_matches_js_source`、:287 `native_switch_defaults_off`
- policy.rs:103 `parses_global_and_path_rules`、:115 `later_rule_overrides_same_header`
- shell.rs:385 `base64_matches_known_vectors`、:394 `tag_and_attr_extraction`、:401 `csp_relax_keeps_everything_else`、:409 `business_hours_follow_utc8_rules`

wasm crate：无 tests/ 目录、src 无 #[test]（实测）。doc-test：core/edge 源码仅 shell.rs:5-10 一处 ```` ```text ```` 围栏（非 Rust doctest）⇒ doctest 计 0。
⚠ **verify-all.mjs:26 的步骤名写「core 16 条 + edge 6 条」已过期**，真实规模 91+8=99；判绿以 cargo 的 `test result: ok. 91 passed` / `ok. 8 passed` 为准，勿拿步骤名当计数。

### 3.2 wasm-host-test.mjs：对账 26 项 + 微基准 5 项

逐条数 check() 调用（源码行号）：[1] 购物袋 6 项（:118-124）；[2] catalogLoad 1 项（:146）+ 8 组条件 × 一次性/常驻两路径 = 16 项（:135-152）；[3] CSV 3 项（:161,170,171）⇒ **6+1+16+3 = 26 项**。
⚠ docs/05 §6.3 写「30 项」与当前源码不符（源码只有 26 个 check 调用点；可能历史版本多 4 条）。判绿末行 `对账全部通过`（:229）。
微基准 5 项（bench 调用）：cart_summary 20 行×20000 迭代（:200）、filter 一次性 65 件×2000（:216）、catalog_query 65 件×20000（:217）、csv_export 2000 行×30（:223）、csv_export 20000 行×5（:226）。输出 markdown 表（:195-196），docs/05 §6.2 即此 stdout。基准前有 3 轮双侧预热（:177）。可选位置参数 `[wasm 路径]`（:19）。

### 3.3 check-api-parity.mjs：**必须联网**

对 3 个公开动作（getPublicProducts/getPublicCategories/getCatalogOrders，:23）POST 现网 `--live`（默认 `https://supermarket-web.pages.dev`，:20）取键集/键序，与 `crates/core/src/api_shapes.rs` 源码字面量比（:26-33）。取不到 → problems 记 UNVERIFIED、**exit 1 不当通过**（:48-50,91-92）。`--json` 默认**写盘** `rust/docs/api-live-shapes.json`（:21，注意与 measure-http 默认不落盘相反）。值级对账需 `EDGE_BASE` env（:83-86），本机无 D1 凭据 ⇒ 恒 UNVERIFIED（明示，不算失败）。末行 `GATE-PASS check-api-parity：键集/键序与现网一致…`。

### 3.4 check-api-native-e2e.mjs：**必须联网**（现网真值面）+ 本机 mock D1

流程：现网 /pub /web 取真值（:134-148）→ 反推 D1 行写 `rust/.cache/mock-d1-rows[-parsed].json`（:540）→ spawn mock-d1-server（:562，端口默认 5199）→ spawn **真 edge 二进制** `rust/target/release/supermarket-edge.exe serve --dist <仓根>/dist --port 5198`（:566-568），env 注入 NATIVE_PUBLIC_ACTIONS=all / NATIVE_ADMIN_ACTIONS=all / NATIVE_PUB_WRITE=createOrder,addPublicReview,createSubmission,aiChat / D1_API_BASE=mock（:569-581）→ 80 用例逐字段对账（公开 8 + 管理读 26 + 写 46，:1331）。
CLI：`--live`（:38）`--edge-port` 默认 5198（:39）`--mock-port` 默认 5199（:40）`--parsed`（:43，JSON 列已解析形态第二轮）`--json` 默认写 `rust/docs/api-native-e2e.json`（:41）。
前置：联网 + edge release 二进制（缺 → 印「缺边缘二进制…」**exit 2**，:567）+ 仓根 dist/（:568）+ `.dev.vars` 的 ADMIN_KEY/ADMIN_READONLY_KEY（:125-131,588-604，存在实测；无密钥则管理段明示退化）。网络失败带 3 次退避重试（:88-99），最终不可达 → `GATE-UNVERIFIED` **exit 2**（:77-86）——「没跑成」与「判据红」可分辨。**不在 verify-all 默认路径里**，需 `RUST_E2E_LIVE=1`。写用例只打本地边缘，不写现网（:1331 注明）。

## ④ 风险与坑（读源码给出的失败形态）

1. **cargo 不在 PATH**：verify-all 不带 `--cargo` 且 CARGO 未设时 spawn `"cargo"` 直接失败（verify-all.mjs:20,47），该步 FAIL rc=null。必须给绝对路径。RUSTUP_HOME 当前 pwsh 会话为空，但 toolchain 内 cargo.exe 直跑不依赖它（rustup proxy 才依赖）；如遇 toolchain 解析错误再补 `$env:RUSTUP_HOME="C:/Users/37533/.rustup"`。
2. **target 锁**：cargo test/build 共用 `rust/target` 锁；Lead 构建未结束时跑 verify-all 第 1 步会阻塞等锁（cargo 行为，非脚本控制；单步 900 s 超时后 FAIL，verify-all.mjs:47）。**等构建收口再跑**。
3. **产物缺失形态（审计时刻实测 rust/target 不存在）**：wasm-host-test 两个候选路径都无 → stderr「找不到 wasm 产物，先跑：cargo build …」exit 1（wasm-host-test.mjs:24-27）；check-shell-parity 二进制缺 → 「生成复刻失败」exit 2（:94-98）；e2e 二进制缺 → exit 2（:567）；measure-local 二进制缺 → exit 2（:54-57）。edge serve 的 dist 缺 index.html → stderr「读不到 …index.html」经 build_app「启动失败」exit 1（shell.rs:67-69 → api.rs:98-104 → main.rs:99-104）；dist 目录整个不存在 → assets.rs:110 read_dir Err →「扫描 … 失败」exit 1（api.rs:98-99）。`_headers` 缺失**不报错**，policy 走默认空规则（api.rs:94-97 unwrap_or_default）——缓存语义会静默变掉，测量前确认 `.cache/dist/_headers` 在（实测在）。
4. **端口占用**：baseline server 无 error 处理，EADDRINUSE 未捕获崩退（static-baseline-server.mjs:93-95）；edge bind 失败 → stderr「监听 127.0.0.1:5182 失败：…」exit 1（main.rs:124-129）。测前 `Get-NetTCPConnection -LocalPort 5181,5182 -State Listen` 查占。edge 不带 --port 时默认 **8788**（config.rs:85），不是 5182。measure-local 起服务后 waitFor 20 s 探活失败 → 全杀 exit 3（measure-local.mjs:108-124）。
5. **Windows 路径/编码**：wasm-host-test 已内置 file:// URL → 盘符路径还原（含非 ASCII 百分号解码），防 `C:\C:\…` 双盘符（wasm-host-test.mjs:29-35）；`--json` 落盘带末行换行（measure-http.mjs:114-115）。measure-http 用 content-length 而非解码后 byteLength 计传输体积（:19-21）——自己拿 fetch 复算时别踩同一坑。verify-all 子进程输出按 utf8 解码（:47），中文 PASS/FAIL 行在 pwsh 下若见乱码是控制台代码页问题，不影响 exit code 判据。
6. **check-font-split 依赖 python+fontTools**：spawnSync `python`（:62,81）；本机 PATH 的 python 是 LibreOffice 自带（D:\LibreOffice\program\python.exe），fontTools 4.67.0 实测可 import ⇒ 此腿本机可跑。若换环境缺 fontTools → bad(「取源字体 cmap 失败」) 计入 problems → GATE-FAIL（:63-64）。旧单文件 public/fonts/display-serif-cjk.woff2 若重新出现会判红（:127-128，实测当前不存在=正确态）。
7. **RUST_E2E_LIVE 语义**：严格 `=== "1"`（verify-all.mjs:37），设 true/yes 无效；未设时打印 SKIP 行（:40）——SKIP ≠ PASS，读数时别把「没跑」记成「过了」。e2e 的 exit 2（UNVERIFIED）在 verify-all 里会被记 FAIL（spawnSync status!==0，:49-54），即**断网时开 RUST_E2E_LIVE 必红**，这是设计意图（:35-36 注释）。
8. **docs/05 哪些本机可复算**：
   - **§3 HTTP 层表 + §6 wasm 表：纯本机、无浏览器**。§3 = measure-http 双臂（§② 序列）；§6.1/6.2/6.3 = wasm-host-test（需 wasm 产物）。§3 的「首屏 CSS 传输 0」一列 measure-http **不直接输出**（无 css 字段），它由「shell.headers 无外链 CSS + edge 内联」间接成立，直接判据在 measure-local 的 cssBytes（见下）。
   - **§2 主表 / §4b 字体分包表 / §5 自检清单：需要浏览器（Lighthouse 12.6.0 + 本机 Edge/Chrome headless）**，由 measure-local.mjs 产出（`--samples/--arms/--json` 等，measure-local.mjs:27-41；lighthouse/浏览器解析失败 exit 2，:46-53；chrome-flags=--headless=new，:138）。字段 ttfb/cssBytes/renderBlocking/requests 出自其 extract()（:156-174：ttfb=server-response-time :161、cssBytes=Stylesheet 传输和 :169、renderBlocking=render-blocking-resources :172）。verify-all 第 9 步只**复核已落盘的 perf-local.json**，不重跑浏览器。
   - **§4c 端到端筛选表：需要 playwright chromium**（measure-shop-filter.mjs:17 import），参数 --base 默认 5185/--scale/--repeats/--queries/--json（:29-33）。
   - §5 线上历史回执（195 ms/1582 ms TTFB）是托管属性，**本机不可复算**，只能纵向对照（docs/05:189-197 口径）。
   - ⚠ measure-local 会 `rmSync` 后重建 `rust/.cache/dist` 工作副本（--refresh-dist 或副本缺失时，:60-64）并跑 precompress 写 .br/.gz（:77）——**它会动 .cache/dist**；本审计推荐的 §② 序列不跑 measure-local，不动任何既有文件。
9. **历史读数的代际差**：docs/http-edge.json（22432 B br）与 docs/05 §3 表（20727 B）产物代际不同；.cache/dist 是 2026-10-26 前后副本（入口 index-C1YmgGos.js），仓根 dist/ 已是新一代（CSS index-rDWjUNdm.css ≠ .cache/dist 的 index-oWEHgfz8.css，实测）。**A/B 两臂务必用同一份目录**（推荐 .cache/dist），跨目录比会把产物差异洗成服务端差异。check-shell-parity 默认用仓根 dist/（新代），与 edge 二进制匹配即可，不与 A/B 冲突。
10. **UNKNOWN 申报**：无。本轮所有参数名/字段名均已读到源码出处；未跑任何测量脚本，故「期望数值」只引历史 JSON/docs 作参考形态，不作硬阈值。

---
自证：`node -e "const s=require('fs').readFileSync('D:/app-cache/chaoshi-web/supermarket-web/_incoming/rust-r1/gate-audit.md','utf8'); if(!/measure-http/.test(s)||!/--base/.test(s)) process.exit(1); console.log('GATE_AUDIT_OK lines='+s.split('\n').length)"`
