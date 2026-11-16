# live-probe · Rust 重写提速形态 —— 线上只读取证（r1）

> 角色：live-probe 子代理 ｜ 模式：**只读**（GET + 3 个白名单纯读 POST；零部署/零 git 写/零生产写 action）
> 落盘：本文件是本轮唯一写面。所有数字来自真实请求，逐项附可复跑命令（§③）。

## ① 探测时刻与工具

| 项 | 值 |
|---|---|
| 探测窗口 | **2026-11-16 22:26:55 – 22:29:22（UTC+8, Asia/Shanghai）** |
| 取数工具 | run_code 内置 **Node v24.21.0 原生 fetch**（自动解压 br/gzip，报**解码后**字节）＋ **curl.exe**（Windows 自带真 curl，不自动解压，`size_download`=**线上原始字节**）＋ 只读 git（rev-parse / log / rev-list / merge-base） |
| 管理端+API | https://supermarket-web.pages.dev （Cloudflare Pages，CF-RAY 边缘=SEA） |
| 顾客端 | https://lxh113377.github.io （GitHub Pages） |
| 仓库 HEAD | `a5035e52e938010464b62bfe58eb2d95c4b5384b`（a5035e5，docs(r104) 收口回执） |
| 请求面 | GET /_health、/、/fonts/*、/images/*、/assets/*（HEAD）；POST /pub 仅 getPublicProducts / getPublicCategories / getCatalogOrders |

工具语义注（防误读，对应 rust/docs/12 §4 坑3）：Node fetch 带 `Accept-Encoding: br` 会**自动解压**，量到的是解码后 145,077 B；**br 线上字节必须用 curl 量**（30,021 B）。两者都对，口径不同。

## ② 逐项读数表

### 2.1 主表

| # | 项 | 实测读数 | 判定 |
|---|---|---|---|
| 1 | `GET /_health` HTTP | 200（934 ms，单样本） | 活 |
| 2 | `_health.deploy` | **`d89ddab`** | **≠ HEAD `a5035e5`，漂移坐实**（落后 2 提交，见 2.6） |
| 3 | `_health.db` | **`ok`**（`SELECT 1` 真跑通） | D1 绑定正常 |
| 4 | `_health.ai` | `configured:false, source:"rule"` | Dify 未配置，规则版（顺带记录，与提速无关） |
| 5 | `POST /pub getPublicProducts` | HTTP 200，**code=0，data 条数=45**（解码后 11,021 B，br） | 公开商品面正常 |
| 6 | `POST /pub getPublicCategories` | HTTP 200，code=0，条数=3（706 B） | 正常 |
| 7 | `POST /pub getCatalogOrders` | HTTP 200，code=0，条数=71（2,593 B；每条形如 `{order:N,needsLocalImage:true}`，N=1..71） | 正常 |
| 8 | admin 首页 **identity 字节数** | **145,077 B**（curl wire=145,077，无 Content-Encoding；Node fetch 同值） | 与 doc12 部署后值**逐字相等** |
| 9 | admin 首页内联 `<style>` 个数 | **1** | 内联形态在线上 |
| 10 | admin 首页 `<link rel=stylesheet>` 个数 | **0**（全部 `<link>` 共 11 个：icon+2 字体 preload+其余，无一是 stylesheet） | 渲染阻塞样式请求=0 |
| 11 | CSP `style-src` 是否含 sha256 | **是**：`'self' 'sha256-LxLA9TnJRDU/yynY7/GH8CH/IdfuAPEAh1+n14LQWBc='`（在 `<meta http-equiv=CSP>` 里；**响应头无 CSP**） | 内联被哈希授权，非 unsafe-inline；哈希前缀与 doc12 一致 |
| 12 | 响应头 `Link`（Accept-Encoding: identity 取一次） | **有**，4 条 preload（全文见 2.3） | 预载形态在线上，且比 doc12 记录**多 3 条** |
| 13 | 响应头 `Content-Encoding`（identity 请求） | **无该头**（Transfer-Encoding: chunked，无 Content-Length） | identity 口径成立 |
| 14 | 响应头 `Link` + `Content-Encoding`（Accept-Encoding: br 取一次） | Link 同上 4 条；**`Content-Encoding: br`**，**curl wire=30,021 B**（Node fetch 同请求自动解压→145,077 B） | **平台 br 自动协商在线上**；br/identity=20.7%（省 79.3%） |
| 15 | 附加：gzip 请求 | `Content-Encoding: gzip`，wire=**30,247 B** | 与 doc12 gzip 值逐字相等 |
| 16 | 字体 A 包 `GET /fonts/display-serif-cjk-a.woff2`（pages.dev） | **200，11,604 B**，`content-type: font/woff2`，Content-Length=11604，magic=`wOF2`，cache-control `public, max-age=600, stale-while-revalidate=86400` | 与仓内 `public/fonts/display-serif-cjk-a.woff2`（11,604 B）**字节数相等**；A 包形态在线上 |
| 17 | 字体 A 包（顾客端 gh.io 同路径） | **200，11,604 B**，font/woff2，etag `"6af9e1a9-2d54"`（0x2d54=11,604，交叉核对✓） | 两端一致 |
| 18 | `GET /images/71.webp`（pages.dev） | HTTP **200** 但 **content-type=`text/html; charset=utf-8`**，**145,077 B**，magic=`<!doctype html>`，title=江科一站通，非 RIFF | **不是图片，是 SPA fallback（index.html）**。r104 漂移预言坐实 |
| 19 | 入口 JS `HEAD /assets/index-Dv7np4VG.js` | 200，application/javascript | Link 预载目标真实存在 |
| 20 | `HEAD /assets/HomePage-BE29SW6P.js` | 200，application/javascript | 同上 |
| 21 | 顾客端首页 identity（gh.io） | 200，**145,077 B**，`<style>`×1、stylesheet×0、同一 sha256 CSP、HTML 内 2 条字体 preload；入口=`index-Dd7e3Qhg.js`；**无 Link 响应头**（GitHub.com 不支持 _headers）；last-modified `Sun, 15 Nov 2026 16:45:29 GMT`（=2026-11-16 00:45:29 +0800）；etag `"6af9e1a9-236b5"`（0x236b5=145,077✓） | 内联形态两端都在；两端入口 hash 不同（构建差异） |

### 2.2 /_health 响应体逐字（118 B，解码后）

```json
{"status":"ok","db":"ok","ts":"2026-11-16T14:26:59.815Z","ai":{"configured":false,"source":"rule"},"deploy":"d89ddab"}
```

### 2.3 admin 首页响应头关键行（curl 实测，identity 与 br 两次均同）

```text
Link: </assets/index-Dv7np4VG.js>; rel=preload; as=script; crossorigin, </assets/HomePage-BE29SW6P.js>; rel=preload; as=script; crossorigin, </fonts/bricolage-latin-wght.woff2>; rel=preload; as=font; crossorigin, </fonts/display-serif-cjk-a.woff2>; rel=preload; as=font; crossorigin
Cache-Control: public, max-age=0, must-revalidate
Content-Type: text/html; charset=utf-8
# br 请求另有: Content-Encoding: br   （CF-RAY: a5b72e5e4b56d571-SEA，WIRE_BYTES=30021，2.22 s）
# gzip 请求:   Content-Encoding: gzip （WIRE_BYTES=30247，1.01 s）
# identity:    无 Content-Encoding    （WIRE_BYTES=145077，2.18 s）
```

CSP meta 全文（style-src 含 sha256，无 unsafe-inline）：

```text
default-src 'self'; script-src 'self'; style-src 'self' 'sha256-LxLA9TnJRDU/yynY7/GH8CH/IdfuAPEAh1+n14LQWBc='; img-src 'self' data: blob: https:; connect-src 'self' https://supermarket-web.pages.dev; font-src 'self' data:; manifest-src 'self';
```

### 2.4 与 rust/docs/12-hosting-inline-br.md 的对照（同 URL 同口径）

| 读数 | doc12 记录（当时部署） | 本次实测（2026-11-16） | 备注 |
|---|---|---|---|
| identity | 145,077 B | **145,077 B** | 相等 |
| br wire | 30,138 B | **30,021 B** | −117 B；构建不同（入口 hash 变了），不强行归因 |
| gzip wire | 30,247 B | **30,247 B** | 相等 |
| stylesheet link | 0 | **0** | 相等 |
| 内联 style | 1 | **1** | 相等 |
| CSP sha256 前缀 | LxLA9TnJRDU/yynY7/… | **LxLA9TnJRDU/yynY7/GH8CH/IdfuAPEAh1+n14LQWBc=** | 同一把哈希 |
| Link 预载 | 1 条（index-DIVNgyrR.js） | **4 条**（index-**Dv7np4VG**.js + HomePage-BE29SW6P.js + bricolage 字体 + A 包字体） | 线上构建已把 doc12 §8 列为「未做」的 HomePage chunk 与字体预载**做上了**；入口 hash 与 doc12 不同 ⇒ 线上是 doc12 之后、HEAD 之前的某次构建 |

### 2.5 负控与旁证（证明读数有牙）

| 对照 | 实测 | 说明 |
|---|---|---|
| `GET /images/1.webp`（pages.dev，旧图） | 200，**image/webp**，30,106 B，magic=`RIFF....WEBP` | 旧图正常伺服 ⇒ 71.webp 回 HTML 不是全站图片面坏了，是**该文件不在部署产物里** |
| `GET /fonts/display-serif-cjk.woff2`（gh.io，旧 215KB 单文件） | **404**（9,379 B GitHub 404 页） | 旧单文件已从顾客端发布面消失（doc07 预期✓） |
| `GET /fonts/display-serif-cjk.woff2`（pages.dev） | 200 但 text/html 145,077 B（SPA fallback） | 旧单文件同样不在管理端产物里；Pages 对缺失静态文件回 index.html 而非 404 —— **这正是 71.webp 读数的成因机制** |
| 本地 `public/images/71.webp` | 存在，**104,860 B**，`git log -- public/images/71.webp` → **ca29b12** | 文件已入仓（在未部署的 2 提交里），线上缺失=部署落后，不是没做 |
| 本地 `public/fonts/display-serif-cjk-a.woff2` | 11,604 B | 与线上两端字节数相等 |
| 线上商品含「脉动」？ | **含**：`{"_id":"p_mwe6hs0s1p1yqy","name":"脉动","spec":"600ml","price":3.88,"subcategories":["vitamin"],"enabled":true,"order":71,"image":"","images":[],"stock":-1}` | **D1 数据面已含 ca29b12 的商品变更**（数据新）；但 image/images 均空，45 个商品无一引用 71.webp（供货图入仓未绑定） |

### 2.6 漂移量化（只读 git）

```text
git rev-parse HEAD                 → a5035e52e938010464b62bfe58eb2d95c4b5384b
_health.deploy                     → d89ddab
git log -1 --format='%h %ad %s' d89ddab
  → d89ddab 2026-11-07 22:29:58 +0800 docs(r103): 收口回执回填 …
git merge-base --is-ancestor d89ddab HEAD → exit 0（d89ddab 是 HEAD 祖先）
git rev-list --count d89ddab..HEAD → 2
git log --oneline d89ddab..HEAD
  → a5035e5 docs(r104): 收口回执 —— 商品已上架、提交已推、pages.dev 部署仍卡 A11（CF Analytics 凭据缺口）
  → ca29b12 feat(catalog): 新增「脉动」600ml ¥3.88 —— 供货图入库，走既有商品面变更链
```

⇒ pages.dev 静态产物停在 **r103（2026-11-07）**，落后 HEAD **2 提交**；其中 ca29b12 的**数据变更已生效**（D1 有脉动）、**静态变更未生效**（71.webp 缺失）——「数据新、产物旧」的分裂态。gh.io 产物反而更新（last-modified 2026-11-16 00:45 +0800，入口 hash 与 pages.dev 不同）。**如实记录，不修复**（与 r104 已知漂移一致）。

### 2.7 辅助读数：单样本时延（本机→SEA 边缘，非统计量，仅存档）

| 请求 | ms |
|---|---|
| /_health | 934 |
| /pub getPublicProducts | 1,110 |
| /pub getPublicCategories | 1,926 |
| /pub getCatalogOrders | 1,114 |
| admin /（identity，node） | 1,055 |
| admin /（br，node） | 927 |
| admin /（curl br / gzip / identity） | 2,220 / 1,014 / 2,184 |
| 字体 A（pages.dev） | 885 |
| /images/71.webp | 537 |
| gh.io 首页（identity） | **20,615**（离群单样本，如实记录；同批 gh.io 字体 A 仅 1,988 ms） |

## ③ 可复跑命令（Windows pwsh 原生；curl.exe=系统真 curl，非 Invoke-WebRequest 别名）

```pwsh
# 1) /_health（deploy sha + db）
curl.exe -sS https://supermarket-web.pages.dev/_health

# 2) /pub 三个纯读 POST 的 code+条数（换 action 即另两个）
node -e "fetch('https://supermarket-web.pages.dev/pub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'getPublicProducts',payload:{}})}).then(r=>r.json()).then(j=>console.log('code='+j.code+' count='+j.data.length))"
node -e "fetch('https://supermarket-web.pages.dev/pub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'getPublicCategories',payload:{}})}).then(r=>r.json()).then(j=>console.log('code='+j.code+' count='+j.data.length))"
node -e "fetch('https://supermarket-web.pages.dev/pub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'getCatalogOrders',payload:{}})}).then(r=>r.json()).then(j=>console.log('code='+j.code+' count='+j.data.length))"

# 3) admin identity：wire 字节 + 全部响应头（看 Link / 无 Content-Encoding）
curl.exe -sS -D - -o NUL -H "Accept-Encoding: identity" -w "WIRE=%{size_download} HTTP=%{http_code}" https://supermarket-web.pages.dev/

# 4) admin br：wire 字节 + Content-Encoding: br（gzip 把 br 换成 gzip 即可）
curl.exe -sS -D - -o NUL -H "Accept-Encoding: br" -w "WIRE=%{size_download} HTTP=%{http_code}" https://supermarket-web.pages.dev/

# 5) HTML 形态：identity 字节 / style 个数 / stylesheet 个数 / style-src 是否含 sha256
node -e "fetch('https://supermarket-web.pages.dev/',{headers:{'Accept-Encoding':'identity'}}).then(r=>r.text()).then(h=>{const tag=(h.match(/<meta[^>]+http-equiv=.Content-Security-Policy.[^>]*>/i)||[''])[0];const c=(tag.match(/content=\"([^\"]*)\"/i)||[])[1]||'';const ss=(c.match(/style-src[^;]*/i)||[''])[0];console.log(JSON.stringify({bytes:Buffer.byteLength(h),style:(h.match(/<style[\s>]/gi)||[]).length,stylesheet:(h.match(/<link[^>]*rel=.stylesheet[^>]*>/gi)||[]).length,styleSrc:ss.trim(),sha256:/sha256-/.test(ss)}))})"

# 6) 字体 A 包（两端；identity 钉死口径，woff2 本身不压缩）
curl.exe -sS -o NUL -H "Accept-Encoding: identity" -w "HTTP=%{http_code} CT=%{content_type} BYTES=%{size_download}" https://supermarket-web.pages.dev/fonts/display-serif-cjk-a.woff2
curl.exe -sS -o NUL -H "Accept-Encoding: identity" -w "HTTP=%{http_code} CT=%{content_type} BYTES=%{size_download}" https://lxh113377.github.io/fonts/display-serif-cjk-a.woff2

# 7) /images/71.webp（content-type + 字节；预期 200 但 text/html=SPA fallback）
curl.exe -sS -o NUL -H "Accept-Encoding: identity" -w "HTTP=%{http_code} CT=%{content_type} BYTES=%{size_download}" https://supermarket-web.pages.dev/images/71.webp

# 8) 负控：旧图应回真 webp；gh.io 旧字体单文件应 404
curl.exe -sS -o NUL -H "Accept-Encoding: identity" -w "HTTP=%{http_code} CT=%{content_type} BYTES=%{size_download}" https://supermarket-web.pages.dev/images/1.webp
curl.exe -sS -o NUL -w "HTTP=%{http_code}" https://lxh113377.github.io/fonts/display-serif-cjk.woff2

# 9) 漂移量化（只读 git，在仓库根 D:/app-cache/chaoshi-web/supermarket-web 下）
git rev-parse HEAD
git log --oneline d89ddab..HEAD
git log -1 --format='%h %ad %s' --date=iso d89ddab
```

注：curl 不带 `--compressed` 时不解压，`size_download` 即线上原始字节；Node fetch 自动解压，量的是解码后字节。第 5 条的 `Buffer.byteLength(h)` 对 identity 响应=原始字节（UTF-8）。

坑注（本轮实测踩到并修正）：第 5 条**必须先锁定 CSP meta 标签再取 style-src**——HTML 里有一段注释提到旧口径 `style-src 'unsafe-inline'`，裸正则 `/style-src[^;]*/` 会先命中注释、误报 sha256=false（即 doc12 §4 坑1 的复现）。上面已是修正版，实跑输出：`{"bytes":145077,"style":1,"stylesheet":0,"styleSrc":"style-src 'self' 'sha256-LxLA9TnJRDU/yynY7/GH8CH/IdfuAPEAh1+n14LQWBc='","sha256":true}`。

## ④ 结论（三行）

1. **已在线上**：内联首屏 CSS（identity 145,077 B、`<style>`×1、`<link rel=stylesheet>`×0、CSP style-src 带 sha256 授权）＋ 平台 br 自动协商（br wire 30,021 B=identity 的 20.7%，gzip 30,247 B）＋ Link 预载×4（入口 JS、HomePage chunk、两款字体——比 doc12 记录还多 3 条）＋ 字体 A 包 11,604 B 两端在线、旧 215KB 单文件已离开发布面（gh.io 404 / pages.dev 无实体）。
2. **缺失**：`/images/71.webp` 在 pages.dev 不存在（200+text/html 回 index.html 145,077 B；仓内 104,860 B 已随 ca29b12 入仓但未部署，且线上脉动商品 image/images 均空、未绑定该图）；gh.io 无 Link 响应头（平台不支持 _headers，字体 preload 仍在 HTML 里）；另 ai.source=rule（Dify 未配置，与提速无关，顺带记录）。
3. **与 HEAD 的漂移**：`_health.deploy=d89ddab`（r103，2026-11-07 22:29 +0800）≠ HEAD `a5035e5`，落后 2 提交（ca29b12 脉动＋a5035e5 docs）；呈「数据新、产物旧」分裂态——D1 已有脉动（45 商品、¥3.88、order=71）而静态 71.webp 未上线；gh.io 产物反而更新（2026-11-16 00:45 +0800，入口 hash 两端不同）。**如实记录，不修复**（r104 已知漂移，卡点=CF Analytics 凭据缺口 A11，见 a5035e5 提交说明）。

---
取证完毕：全部 GET/纯读 POST 成功，无 UNREACHABLE 项；未做任何部署/wrangler/tcb/git 写操作，未改任何仓内既有文件。
