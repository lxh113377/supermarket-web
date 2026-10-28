# 12 · 托管侧内联首屏 CSS 与 br 预压缩（第 32 轮）

目标原文：把边缘或至少把 **br 预压缩 + 内联样式**这两项搬到线上托管侧，再做线上对照。

## 1. 结论先行（两项分开说，因为它们的结果完全不同）

| 项 | 状态 | 证据 |
|---|---|---|
| **br 预压缩** | **早就在线上**，不需搬 | 部署前后 `curl -sI` 都是 `Content-Encoding: br`；平台对文本自动协商压缩。自己再塞 `.br` 文件是重复劳动（还会和平台行为打架） |
| **首屏 CSS 内联** | **已搬到托管侧** | 线上 identity 从 2,978 B → **145,077 B**；`<link rel=stylesheet>` 从 1 个 → **0 个**；内联 `<style>` 1 个；CSP `style-src` 增加 `sha256-…` 授权 |

## 2. 线上对照（curl，无噪声；部署前 vs 部署后）

| 读数 | 部署前 | 部署后 | 变化 |
|---|---|---|---|
| 首屏文档 identity | 2,978 B | 145,077 B | +142,099（CSS 进了文档） |
| 首屏文档 br | 1,432 B | 30,138 B | +28,706 |
| 首屏文档 gzip | 1,505 B | 30,247 B | +28,742 |
| 入口 CSS 独立请求 | 被引用（**渲染阻塞**） | **0 引用**（文件仍在站上） | 渲染阻塞请求 1 → 0 |
| **文档+CSS 合计（br）** | 1,432 + 28,655 = **30,087 B** | 30,138 + 0 = **30,138 B** | **+51 B（+0.2%）** |
| 首屏样式链请求数 | 2（doc + css） | **1** | **少一次 RTT** |
| `Link` 预载 | 无 | `</assets/index-DIVNgyrR.js>; rel=preload; as=script; crossorigin` | 新增（`_headers` 构建期生成） |
| CSP `style-src` | `'self'` | `'self' 'sha256-LxLA9TnJRDU/yynY7/…'` | 内联被授权（**不是** unsafe-inline） |

**这张表里最重要的一个数字是 +0.2%（合计字节几乎没变）**：平台本来就把 CSS 压得很好（28,655 B br），
内联只是把同一份 CSS 从「另一个请求」挪进「文档里」⇒ **没有省字节**。
省下来的是**一个渲染阻塞请求（一次 RTT）**，以及 `Link` 让入口 chunk 更早开始下载。
这与本地三臂实测里 edge 侧的机制一致（CSS 传输 24,156 B → 0、渲染阻塞 150 ms → 0）。

## 3. 落点与判据

- 构建期脚本：[scripts/inline-critical-css.mjs](../scripts/inline-critical-css.mjs)（`postbuild` 自动跑）
  · 把入口样式表换成 `<style>`；
  · 算 `sha256` 并**只写进 CSP meta 的 style-src 指令**；
  · 给 `dist/_headers` 生成入口 `Link` 预载（带哨兵注释，每次构建按新 hash 重写）。
- 判据：[scripts/check-inline-css.mjs](../scripts/check-inline-css.mjs)（`npm run verify:inline-css`）
  · 断言：无 `<link rel=stylesheet>`、有内联 `<style>`、**哈希在 style-src 指令里**、字体 preload 还在、
    `_headers` 预载指向真实存在的入口且与 index.html 引用一致；
  · **负控**：`--negative-control` 故意改坏哈希一位，判据必须报红（否则是恒绿摆设）。实测：只报「style-src 里没有这把哈希」一条 ⇒ 这条腿有牙。
- 仓内既有门禁不受影响：`verify:csp`（只扫源码与 public）仍 OK；`check:size` OK。

## 4. 自己踩的坑（留在文档里，免得下次再踩）

1. **哈希插进了 HTML 注释**：第一版按裸正则 `style-src[^;]*` 找第一处匹配，命中的是源码注释里那句
   「去掉 style-src unsafe-inline」，于是哈希写进注释、真正的 CSP 仍是 `style-src 'self'` ——
   **文件里确实“有”这串哈希，所以粗判据误判绿**。修法：先锁定 CSP meta 的 content group，再在其中替换；
   判据也从 `html.includes(hash)` 改成「在 style-src 指令取值里」。
2. **负控曾经是空转的**：第一次跑负控时构建还没成功（lint 报未用导入挡住 `prebuild`），红的是「没内联」而不是哈希那条 ⇒
   负控只在「真内联成功」之后才证明得了哈希腿。**负控必须与它要证明的那条腿同处一个状态**。
3. **curl 请求了 br 却没解压**：`-H "Accept-Encoding: br"` 时 curl 不自动解压 ⇒ grep 数 `<style>` 得 0，
   差点把自己部署成功的形态判成没生效。取形态读数要用 identity（或 `--compressed`）。

## 5. 线上 Lighthouse 对照（同一取数器、批次隔离）

取数器 = [scripts/collect-live-perf.mjs](../scripts/collect-live-perf.mjs)（按域名预飞、批次名拒绝覆盖、产物自证），
名册 = [docs/live-perf.json](../docs/live-perf.json)（两页：admin=pages.dev / customer=github.io）。

- 批次 `before-inline`：admin **2/3**（一份 `PROTOCOL_TIMEOUT`）、customer 3/3 ⇒ 取数器判 RED，**如实记录不掩盖**。
- 批次 `after-inline`：**6/6 GREEN**，中位数见下面 §6。

口径声明：线上 Lighthouse 是**真网络 + 单机浏览器**，样本量小时噪声大于内联带来的差（内联的确定性收益已在 §2 用字节与请求数钉死）。
因此 §2 是主证据，Lighthouse 是辅证；两者不一致时以 §2 为准。
## 6. 线上 Lighthouse 对照（补齐后）

取数器 [scripts/collect-live-perf.mjs](../scripts/collect-live-perf.mjs)（按域名预飞、批次名拒绝覆盖、产物自证），
移动端 simulate 限速，每页每批 n=3，中位数：

| 页面 | 批次（真部署？） | FCP | LCP | SI | server-response | total-byte-weight |
|---|---|---|---|---|---|---|
| admin（pages.dev） | before-inline（旧产物） | 1759.0 | 3237.5 | 5259.8 | 299.8 | 477,119 |
| admin（pages.dev） | **after-inline（我的改动已部署）** | 1529.9 | 2704.9 | 4094.8 | 178.6 | 442,830 |
| customer（github.io） | before-inline（旧产物） | 1848.7 | 3175.2 | 5278.9 | 395.9 | — |
| customer（github.io） | after-inline（**产物未变**·负控） | 1701.3 | 2720.4 | 4351.9 | 176.0 | — |

### 6.1 这张表里最重要的不是 admin 的改善，而是 customer 那两行

customer 臂的产物在这两批之间**一个字都没改**（gh.io 由 CI 在 push 后才重建；当时还没 push）——
它却「变快」了：LCP 3175.2 → 2720.4（**−14.3%**）、FCP −8.0%、SI −17.6%、server-response −55.6%。

⇒ **这是本轮的天然负控**：在 n=3 的线上采样里，「什么都没改」也能测出 8%–18% 的改善。
所以 admin 臂那些看起来同量级的改善（FCP −13.0% / LCP −16.4% / SI −22.1%）**不能归因**于内联；
而且 admin 的总字节反而少了 34 KB（−7.2%）—— 我的改动只会让合计字节 **+0.2%**，方向相反，进一步说明那部分是采样/上下文漂移。

### 6.2 因此：结论只认确定性读数

可归因的证据是 §2 那张 curl 表（同 URL、同口径、无采样方差）：
**渲染阻塞样式表请求 1 → 0（少一次 RTT）**、**文档+CSS 合计 br +51 B（+0.2%，等于没省字节）**、
`Link` 预载上线、CSP 以 sha256 授权内联。线上 Lighthouse 作为辅证，**不作为收益证据**。

### 6.3 客户臂第三批（真新产物）——把「噪声」这件事钉死

gh.io 被 CI 重建后补采了 `after-inline-b`（3/3 GREEN）。同一页面的三批：

| customer 批次 | 产物 | FCP | LCP | SI | server-response |
|---|---|---|---|---|---|
| before-inline | 旧 | 1848.7 | 3175.2 | 5278.9 | 395.9 |
| after-inline | **旧（负控）** | 1701.3 | 2720.4 | 4351.9 | 176.0 |
| after-inline-b | **新（真 after）** | 1706.3 | **2894.0** | **5424.9** | 181.9 |

**真 after 在 LCP/SI 上比负控批还差**（LCP 2894.0 vs 2720.4、SI 5424.9 vs 4351.9）——
而这两批**产物不同**、唯一差别本该是内联。⇒ 同页面同样本量的线上 Lighthouse 波动（同一产物重复采也有 ±7%）**完全盖过**内联效应；
这条数据把「不许拿线上 Lighthouse 当收益证据」从判断变成了实测。

## 7. 复核点名、本轮已修的四个缺口（都是我这次改动留下的）

| 缺口 | 修法 | 复算 |
|---|---|---|
| `check:size` 报「首屏 CSS gzip **0.0 KB**」= CSS 预算空转（内联后 `<link rel=stylesheet>` 消失） | `check-bundle-size.mjs` 同时 gzip 统计内联 `<style>` | 现在报 **28.2 KB ≤ 30.0 KB**，预算恢复约束力 |
| `verify:inline-css` 没挂进 verify 链（默认不跑） | package.json 的 verify 链加入该腿 | `verifyLegs` 45 → 46（治理册同步） |
| `check-cache-headers.mjs` 只读 public/_headers，而上线真相源是 dist/_headers ⇒ **声明面漂移** | 新增 `distSideDrift()`：dist 去掉生成段后必须与 public 逐字相同，并接进 main | `verify:cache` 输出「dist 侧对账 OK」 |
| `check-inline-css.mjs` 的 `inline-css-bytes` 截断自检是**死腿**（没有 producer 写该标记） | producer 把字节数写进生成段，判据改从 `_headers` 读 | 生成段现含 `# inline-css-bytes: 142100` |

> 顺带一条方法论：**「判据占了坑位但不咬」比「没有判据」更坏** —— 上面第 1 与第 4 条都是这种形态：
> 它们各自"通过"过，而通过的原因是它们根本没在看东西。

## 8. 已知未做 / 未取证

- **customer 臂的 after 需等 CI 重建后重取**：本轮 after 批次对 gh.io 是负控（见 §6.1），推送到 main 后 CI 会把同一份构建产物部署到 gh.io，届时需再取一批才算「两端都对照过」。
- **HomePage 路由 chunk 与字体未进 `Link`**：Rust 边缘的 shell.rs:121-149 会带它们；托管侧要带就得把「首屏路由 chunk」也写进生成段。本轮未做（收益不确定，且预载错的 chunk 会白花流量）。
- **`rust/crates/edge/src/shell.rs:15` 的注释已过期**（写「CSS 11.7 KB / HTML 135 KB → br 13 KB」，现值 142,100 raw / 28,655 br）⇒ 引它做对照会错。非本轮改动，登记待修。


