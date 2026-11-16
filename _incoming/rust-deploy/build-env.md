# build-env.md — supermarket-web 本机构建环境重建（R15 磁盘清理后）

> 生成：2026-11-17 00:35 +08:00 ｜ 执行者：build-env 子代理 ｜ 项目根 `D:/app-cache/chaoshi-web/supermarket-web`
> 环境：node v24.16.0 ｜ npm 11.9.0 ｜ registry=npmmirror（~/.npmrc）｜ python 3.13.15 + fontTools 4.67.0（font 判据依赖，已实测在场）
> 写面合规：仅 node_modules/**、dist/**、_incoming/rust-deploy/*.log + 本文件；`git status --porcelain -- package-lock.json package.json .env` 输出为空（源码/.env/lockfile 零改动）；未触发任何部署。

## ① npm 安装结果（首跑失败 → 退路成功）

- 首跑 `npm ci --proxy null --https-proxy null`（后台 job pwsh-153f4391aaf5458a，00:17:38 → 00:28:12，约 10.5 分钟）：**rc=-4077，ECONNRESET**。
  - 根因：reify:unpack 阶段拉取 vitest/three 大包时 TLS read 被对端重置（npm debug 日志 752 行 `Error: read ECONNRESET at TLSWrap.onStreamRead`；unfinished timer 指向 reifyNode:node_modules/vitest、node_modules/three）。**不是代理拒绝**——~/.npmrc 的 Clash 代理两行已被 `;;` 注释，且命令显式 `--proxy null --https-proxy null`。
  - npm ci 失败后自动回滚，node_modules 清空（实测 0 目录）；cleanup 阶段另报 @emnapi EPERM rmdir 警告（errno -4048，非致命）。
  - 完整错误包存档：`npm-install-attempt1-debug.log`（117,066 B，自 D:/app-cache/npm-cache/_logs/2026-11-16T16_17_39_345Z-debug-0.log 复制）。
- 退路重试 `npm install --proxy null --https-proxy null --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000`（job pwsh-e3b3dfac7e5b41d1，00:28:13 → 00:29:30）：**rc=0**。
  - 日志原文（npm-install.log 第 7 行）：`added 249 packages in 32s`（首跑已把大部分 tarball 拉进 D:/app-cache/npm-cache，重试命中缓存故快）。
  - `npm ls --depth=0` rc=0（npm-ls.log），依赖树完整；node_modules 201 个顶层目录。
  - package-lock.json 未被 npm install 改动（git 对账为空）。
- 代理处理结论：本机 Clash 未启动不构成阻塞（.npmrc 代理行已注释 + CLI null 双保险）；首跑失败是镜像源瞬时网络重置，fetch-retries 退路一次即愈。

## ② wrangler 路径存在性

- `node_modules/wrangler/bin/wrangler.js` **存在**（Test-Path True）。
- 实测可执行：`node node_modules\wrangler\bin\wrangler.js --version` → **4.145.0**（满足部署 skill §2 直入口径）。

## ③ build 成功标志原文（build.log，rc=0，job pwsh-01e4f5f2d7004804，00:29:31 → 00:29:50）

```
> supermarket-web@1.0.0 prebuild → npm run lint → oxlint --max-warnings 0
Found 0 warnings and 0 errors.
Finished in 67ms on 433 files with 108 rules using 32 threads.
vite v8.3.1 building client environment for production...
✓ 431 modules transformed.
✓ built in 1.92s
[sw-version] CACHE_VERSION → sm-v1794846589828
> supermarket-web@1.0.0 postbuild → node scripts/inline-critical-css.mjs
[inline-css] _headers 已写入预载：入口 /assets/index-Dd7e3Qhg.js｜路由 1 条｜字体 2 条
[inline-css] 已内联 assets/index-rDWjUNdm.css（142100 B）→ index.html 现 145077 B；CSP 哈希 sha256-LxLA9TnJRDU/yynY7…
```

- env 烘焙口径：Vite 构建自动加载项目 `.env`（VITE_CB_API_BASE=https://supermarket-web.pages.dev/web、VITE_CB_PUBLIC_API_BASE=https://supermarket-web.pages.dev/pub），与 ci.yml Build 步骤 env 注入（L246–249）同值，无需额外注入。
- 烘焙实证（dist 侧反查，非 local demo 版）：`supermarket-web.pages.dev/web` 命中 dist/assets/client-rrUanrL5.js；`/pub` 命中 client-rrUanrL5.js + printUpload-F5wRsjFK.js；client chunk 内 localhost/127.0.0.1 命中 0。
- dist/sw.js 实测：`const CACHE_VERSION = 'sm-v1794846589828'`（与 build.log [sw-version] 行一致）。
- 非阻断警告：Vite configLoader native 对 `__dirname`（vite.config.js:11）的弃用提示，不影响产物。

## ④ 三条判据 rc 与关键行（rc 先落 *.rc.log 文件再读，无管道取 $?）

| 判据 | rc | 关键行 |
|---|---|---|
| node scripts/check-inline-css.mjs | **0** | `[inline-css] OK 首屏 CSS 已内联、CSP 哈希对得上、无渲染阻塞样式表` |
| node rust/scripts/check-wasm-artifact.mjs | **0** | `PASS 产物 sha256 与 manifest 一致（69629 B）`／`PASS ABI 版本三方一致（v2）`／`PASS 产物对应的 crate 源码未漂移`／`GATE-PASS check-wasm-artifact：全部通过` |
| node rust/scripts/check-font-split.mjs | **0** | `PASS 8 个包（含补包）…一致`／`PASS 分包并集 == 源字体 cmap（932 字形，一个不漏）`／`PASS 全部包并集 == 补包源 cmap（1494 字形）`／`PASS A 包 11604 B ≤ 16 KB 预算`／`PASS 补包 113056 B ≤ 150 KB 预算`／`GATE-PASS check-font-split：全部通过` |

- 判据有牙自证（附加负控）：`node scripts/check-inline-css.mjs --negative-control` → rc=**0**，日志 `CSP 的 style-src 里没有这把哈希（sha256-LxLA9TnJRDU/y…）` + `[inline-css] 负控按预期判红（判据有牙）`（gate-inline-css-negctl.log）。
- wasm 判据日志含 \0asm 魔数字节（read 工具报 binary），已用 Get-Content -Encoding utf8 全文读出，四条 PASS 齐全。

## ⑤ dist/index.html 形态读数（dist-shape.log，node 实测）

- 内联 `<style>` 数：**1**（142,100 B，与 dist/_headers `inline-css-bytes: 142100` 标记逐字节对账一致）
- `<link rel=stylesheet>` 数：**0**（渲染阻塞样式表已消除）
- CSP style-src：`style-src 'self' 'sha256-LxLA9TnJRDU/yynY7/GH8CH/IdfuAPEAh1+n14LQWBc='` —— **含 sha256 哈希 1 把**，与对内联 CSS 现算的 sha256 **完全一致**（hashMatch=true）；**无 'unsafe-inline'**
- 字体 preload：**2 条** → `./fonts/bricolage-latin-wght.woff2`、`./fonts/display-serif-cjk-a.woff2`（A 包，首屏展示体）
- index.html 体积：145,077 B（vite 产出 2.97 kB + 内联 CSS 后）；入口 chunk `/assets/index-Dd7e3Qhg.js` 与 _headers Link 预载一致（判据①已核）

## 证据文件索引（_incoming/rust-deploy/）

npm-install.log（重试成功日志）｜npm-install.rc.log（0）｜npm-install-attempt1-debug.log（首跑完整错误包）｜npm-ls.log｜build.log｜build.rc.log（0）｜gate-inline-css.log/.rc.log｜gate-wasm-artifact.log/.rc.log｜gate-font-split.log/.rc.log｜gate-inline-css-negctl.log/.rc.log｜dist-shape.log｜build-env.md（本件）
（ghio-index.html 为先前会话遗留，非本次产出，未触碰。）

## 结论

node_modules 重建完成（249 包）、wrangler 4.145.0 就位、烘焙版 dist 产出且三条判据全绿 + 负控有牙，线上部署（wrangler pages deploy dist）所需本机产物已备好。本次未触发部署（按令禁止）。

VERDICT=BUILD_ENV_DONE
