# ci-live.md — CI 终态 + 线上两端部署版本 只读取证（r105 部署决策一手读数）

> 取证窗口：2026-11-17 00:14 起（+08）；/_health 回执 ts=2026-11-16T16:22:05.349Z。
> 通道：gh CLI（keyring 已登录，rc=0）＋ curl.exe（直连，失败回落 --proxy http://127.0.0.1:7897）＋ 宿主 web_fetch 第二通道 ＋ 本地 git。
> node_modules 不存在（Test-Path=False）⇒ scripts/ci-status.mjs 未跑，按 runbook §0/§2⑤ 手工等价：gh api runs/<id>/jobs ＋ check_run_url/annotations。
> 纪律：只写本文件；未触发任何部署/dispatch/rerun；未调 /web login，密钥零回显。工作区在途未提交改动（.ci/escape-hatch.jsonl +2 行、DECOMPOSE.md、index.html、chip-* 未跟踪）非本任务产生，未触碰。

## ① ci.yml 最新 run ＋ 各 job 结论 ＋ 红因归类

**run 43899120184**（CI，event=push，headSha=8e794147b7bf411630549fc38b8ca506d2a3d8a7=HEAD，attempt=1，created 2026-11-16T15:41:39Z → updated 15:54:10Z，conclusion=**failure**）

| job | status/conclusion | steps | 失败 step |
|---|---|---|---|
| gates | completed/**failure** | 47 | Test (vitest, with v8 coverage) |
| browser-install | completed/success | 10 | — |
| e2e | completed/success | 12 | — |
| e2e-cloud-stub | completed/success | 12 | — |
| visual | completed/success | 12 | — |
| deploy | completed/**skipped** | 0 | —（needs gates 红 ⇒ 不创建，闸门正常工作） |

vitest 实测：Test Files **2 failed | 150 passed (152)**，Duration 122.66s。两腿红因（annotations 原文）：

1. **A11 d1-remote-usage 回执龄期红**（tests/cliEntrypoints.test.js > check-d1-roundtrips.mjs 子进程 rc=1，24 通过/1 失败）：
   ci-deep 同门日志原文：`FAIL A11 remote_usage 声明 ⇄ 远端回执对账（虚报、落后、过期三侧都要红）(回执时刻缺失或已超 7 天（@2026-11-03T11:03:22.661Z）⇒ 过期的 VERIFIED 等于没取到)`。回执龄期 13 天 > 7 天。
   根因（Uptime run 43825320394 的 C6 平台原文）：`CI 的 CLOUDFLARE_API_TOKEN 缺 GraphQL Analytics 读权限（第三方账号授权，agent 不得代做；本机 wrangler OAuth 可取，CI 不可）` ⇒ **凭据缺口，非代码可自愈**，与 r104 台账 A11 一致。
2. **C10 逃生门处置对账红**（tests/escapeHatchLog.test.js:306，C9 组内生产面自证）：`生产面还有 3 条判决面 RED 没写处置结论：5deae5575b | 991dceee14 | a5035e52e9 … expected 'OPEN' not to be 'OPEN'`。
   HEAD 实物 docs/escape-hatch-remote.json（schema chaoshi-escape-hatch-remote-v1，98 行，32 RED）中 R#87(5deae55)/R#93(991dcee)/R#97(a5035e5) 三条 **无 disposition 字段**。
   ⚠ 申报与实物不符：HEAD 提交信息自称「RED 待处置 0」，但 HEAD committed 文件仍有 3 条 OPEN，CI 实测红即此三条。

**红因归类：真判据红**（gates 47 steps、vitest 真跑 122.66s、有具体失败用例与 annotation）——**不是**账号级 0-step 秒红（本仓 public，runner 正常）。deploy=skipped 是 needs 闸门在正常工作，不是故障。

旁路 run（同 HEAD push 批次）：
- ci-deep.yml **43899120426** failure：deep-gates 25 steps，失败 step `D1 round-trip complexity gate (slope vs input size)`，同 A11（24/1）；receipt-refresh skipped。**不在 deploy.needs**（runbook §1：深门禁已移入 ci-deep）。
- dispatch.yml **43899120385** success（dispatch 3 steps ＋ PR advisory 5 steps）：独立于 gates，github.io 双发照发。
- Release parity **43901490192 / 43899192495**（workflow_run）均 **skipped** ⇒ 两端同批对账未执行。
- 前两 push：d76f9bc CI 43898653500 **cancelled**、4fa6123 CI 43898541216 **cancelled**（concurrency 被新 push 取代）；两者 dispatch 均 success。
- Uptime **43825320394**（schedule @a5035e5，11-16 07:39Z）probe failure（11 steps）：/_health 探测本身 OK（deploy=d89ddab）；红在 check:cron-health **GATE-FAIL 6/9**：C4 册 3⇄声明 4（缺 d1-local-backup.yml）；C6 ci-deep 连红 7 次（A11 同因）＋ uptime 连红 6 次（缺 CF_D1_BACKUP_TOKEN+BACKUP_PASSPHRASE）＋ d1-local-backup 到点没跑 6.20d，**豁免均已于 2026-11-07 到期重新生效**；C7 登记册读数龄期 29.91d > 7d。

## ② 线上 pages.dev deploy sha 与 HEAD 差

GET https://supermarket-web.pages.dev/_health（直连 rc=0）原文：
`{"status":"ok","db":"ok","ts":"2026-11-16T16:22:05.349Z","ai":{"configured":false,"source":"rule"},"deploy":"d89ddab"}`

- 线上 deploy=**d89ddab**（2026-11-07 22:29:58 +0800，docs(r103) 收口回执）。
- 本地 HEAD=**8e794147b7bf411630549fc38b8ca506d2a3d8a7**（2026-11-16 23:41:25 +0800）。
- `git rev-list --count d89ddab..HEAD` = **5 个提交**：ca29b12(feat 脉动 600ml ¥3.88 供货图入库) → a5035e5(docs r104 收口) → 4fa6123(docs rust-r1 提速证据) → d76f9bc(chore 逃生门台账) → 8e79414(chore C9 终态回读)。
- 第二证据：sw.js `CACHE_VERSION = 'sm-v1794061952674'`，epoch=2026-11-07T14:32:32.674Z（22:32 +08）与 d89ddab 同批 ⇒ 静态面确为 11-07 批，落后 9 天。

## ③ 提速形态实测（pages.dev /，直连 HTTP 200，body 144,570 字符）

- 内联 `<style>` ×**1**（块长 ≈142,082 字符 ≈139KB，占 HTML 98%）；`<link rel=stylesheet>` ×**0**；`style=""` 内联属性 ×**0**。
- CSP（meta http-equiv）：`style-src 'self' 'sha256-LxLA9TnJRDU/yynY7/GH8CH/IdfuAPEAh1+n14LQWBc='` ⇒ **sha256 ×1，无 unsafe-inline**；另 default-src/script-src 'self'，connect-src 白名单含 pages.dev。
- 字体自托管：`@font-face` ×9、`.woff2` 引用 ×11（.woff1 ×0）、`<link rel=preload as=font>` ×2（./fonts/bricolage-latin-wght.woff2、./fonts/display-serif-cjk-a.woff2）、Google Fonts 外链 ×0；族=Bricolage Grotesque ＋ CS Display Serif（＋系统回退栈）。
- 结论：单内联样式 ＋ CSP 哈希钉死 ＋ 自托管 woff2 预载的提速形态已在线上生效（注意：这是 d89ddab 批的形态，非 HEAD 批）。

## ④ 71.webp 两端码（脉动新品图，HEAD 才有）

**pages.dev：裸码 200，但是软 200（SPA fallback），图实际不存在。**三点对照：
- GET /images/71.webp → `200 text/html; charset=utf-8 145,077B`
- 负控 GET /images/999999.webp → `200 text/html; charset=utf-8 145,077B`（与 71 逐字同形＝index.html 兜底）
- 正控 GET /images/1.webp → `200 image/webp 30,106B`（真图形态）
- Range 探针（-r 0-15）亦回 text/html ⇒ 非真 webp。**只读 %{http_code} 会把 71.webp 误判成已部署**；d89ddab 批无此图，与②一致。

**github.io：本机两路均 000（不可达）；第二通道证实图存在（真 webp 99,297B）。**
- 本机 curl.exe 直连 rc=28、代理 7897 rc=28 ⇒ /images/71.webp %{http_code}=000（详见⑤）。
- 宿主 web_fetch 第二通道：直取 `image/webp 99297B`（真 webp 字节，非 HTML fallback；工具因二进制处理报错但回执明示直连已取到 99,297B）⇒ 与 Lead 的 200 读数互证：图在 github.io 已部署。

**POST /pub {"action":"getPublicProducts"}（pages.dev，直连）：code=0，data.length=45。**
- 末条商品：_id=p_mwe6hs0s1p1yqy，name=脉动（PS 控制台 UTF-8  mojibake 显示 èå¨，按 spec/price/order 认定），spec=600ml，price=3.88，order=71，enabled=true，stock=-1，subcategories=[vitamin]，**image=""、images=[]（图字段空）**。
- ⇒ 数据面（D1）脉动已上架、两端共用 API 可见；但 pages.dev 静态面无 71.webp，且该行 image 字段为空。
- 取数注：PowerShell 5.1 给 curl.exe 传 JSON 会吞引号 ⇒ 首轮 code=-1 invalid_json（trace a5b7dafcdf976119）；换 Invoke-RestMethod 后 code=0 全长 45；curl 正确转义腿亦收到 code=0 响应头（rc=28 为 25s 下载超时截断，不影响 code/len 读数，len 以 IRM 全量为准）。

## ⑤ github.io 可达性与最近 run

**本机可达性：000（与 r104 记录一致），但站点本身在线。**
- DNS 正常：lxh113377.github.io → 185.199.108/109/110/111.153。
- 直连 verbose：TCP＋TLS 握手成功（schannel，ALPN http/1.1，established to 185.199.111.153:443），GET 发出后**无响应** ⇒ --max-time 12 rc=28 → 000。
- 代理 127.0.0.1:7897：CONNECT 隧道建立后同样 rc=28 → 000。/ 与 /images/71.webp 两路、直连/代理两通道共 4 测全 000。
- 环境：注册表 ProxyEnable=0（ProxyServer=127.0.0.1:7897），env HTTP(S)_PROXY 均空 ⇒ 非代理配置问题；形态＝握手后断流（链路/SNI 阻断），如实记本机不可达。
- 第二通道（宿主 web_fetch，独立网络面）：GET / → **HTTP 200** 真顾客端 HTML（lang=zh-CN、CSP meta、F2 注释「唯一内联 style 已移入 index.css」）；GET /images/71.webp → image/webp 99,297B。⇒ 站点在线，仅本机链路不可达。

**最近 3 个构建 run（gh api repos/lxh113377/lxh113377.github.io/actions/runs?per_page=3）：**
| run id | created (UTC) | event | head_sha（github.io 仓自身） | conclusion |
|---|---|---|---|---|
| 43899142168 | 2026-11-16T15:41:46Z | repository_dispatch | 6592cb91 | success |
| 43898679122 | 2026-11-16T15:39:17Z | repository_dispatch | 6592cb91 | success |
| 43898568611 | 2026-11-16T15:38:40Z | repository_dispatch | 6592cb91 | success |

- head_sha 6592cb9 是 github.io 仓自身最后提交（2026-10-23，打印入口运行时判定）；**构建源另取**：最新 run 43899142168 日志 `Checkout supermarket-web source`（repository=lxh113377/supermarket-web，ref=main）实际检出 **8e794147b7bf411630549fc38b8ca506d2a3d8a7 = HEAD**。
- Pages metadata：status=**built**，build_type=workflow，html_url=https://lxh113377.github.io/。
- ⇒ **顾客端已部署 HEAD 8e79414 批（11-16）**，由 dispatch.yml 43899120385 触发（该 workflow 不受 gates 红阻断）。

## 部署决策读数（汇总）

1. CI 终态：HEAD run 43899120184 **真判据红**（A11 凭据缺口＋C10 三条 RED 无处置），deploy 被 needs 正确拦下（skipped）；非账号级 0-step。A11 需账号侧给 CI token 补 GraphQL Analytics 读权限（agent 不得代做）；C10 属 docs 处置面，可修。
2. 两端不同批（半发布）：pages.dev=d89ddab（11-07，落后 HEAD 5 提交）；github.io=8e79414（HEAD，11-16）。parity run skipped，未对账。
3. 脉动：D1 数据行已上架（/pub code=0 len=45 末条即是，但 image 字段空）；71.webp 仅 github.io 有（真 webp 99,297B），pages.dev 的 200 是 SPA fallback 软码，不可读成已部署。
4. 本机到 github.io 000 是链路问题非站点问题（第二通道 200）；r104「本机不可达」读数本轮复现。
5. HEAD 提交信息「RED 待处置 0」与 committed 实物（3 条 OPEN）不符，已如实记。

VERDICT=CI_LIVE_DONE
