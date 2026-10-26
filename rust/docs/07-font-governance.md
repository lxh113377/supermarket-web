# 07 · 中文展示体分包（首屏最大单项的治理）

> 这一份是第 92 轮的工作记录：把首屏传输里最大的那一项（215,580 B 的中文展示体）
> 从「每次都要全下」改成「首屏只下 11,604 B，其余按需」。**渲染结果不变**，
> 由度量判据与像素判据双向钉住（§4）。

## 1. 问题（第一轮读数定位）

`.lighthouse/*` 的三条臂给了同一份 LCP 归因：

```text
LCP 元素（三臂一致）：header.site-header > a.brand-lockup > span.brand-wordmark > span
传输最大的资源（三臂一致）：fonts/display-serif-cjk.woff2 = 215,580 ~ 216,247 B
```

- 该文件是**单个 215 KB 的 woff2**，挂在一条宽 `unicode-range` 上
  （`U+3000-303F, U+4E00-9FFF, U+FF00-FFEF`），并在 `index.html` 里被 preload；
- 于是**任何**页面只要出现一个中文字，就要把 932 个字形整包下载：
  实测首屏真正用到的展示体字符只有 **14 种**（hero 标题「把日常，过得有滋味。」+ 刊头「超柿」等）；
- 字体面合计 257 KB，占 baseline 整页传输（566,886 B）的 **45.4%** —— 它是首屏最大单项，
  也是 LCP 到 4.4~4.9 s 的主要解释。

分包后的实测（四条臂交错采样 5 轮取中位，原始读数 `rust/docs/perf-local-font.json`）：

| 指标 | 分包前 | 分包后 | 变化 |
|---|---|---|---|
| **LCP** | 4,665 ms | **3,861 ms** | **−17.3%** |
| 字体传输 | 257,396 B | **53,418 B** | **−79.2%** |
| 整页传输 | 566,886 B | **340,067 B** | **−40.0%** |
| FCP | 1,635.7 ms | 1,632.6 ms | −0.2%（FCP 本来就不是字体绑定的） |
| CLS | 0 | 0 | 不变 |

字体面剩下的 52.9 KB = 拉丁展示体 Bricolage（41.3 KB，未动）+ A 包（11.6 KB）；
首页**没有拉起任何分片**，与「A 包 = 首屏 + 首屏路由整页」的设计一致。

## 2. 切法（按用量分包）

| 包 | 字形 | 体积 | 谁下它 |
|---|---|---|---|
| `display-serif-cjk-a.woff2` | 60 | **11,604 B** | 首屏（`index.html` 只 preload 这一个） |
| `display-serif-cjk-s1..s6.woff2` | 142~146 / 包 | 29,660 ~ 41,760 B | 其余路由按需：浏览器只下页面上真出现字符的那些包 |

```text
原文件        215,580 B（932 字形，一次全下）
分包后     A  11,604 B（首屏）+ 6 片懒加载 218,896 B（合计 230,500 B）
首屏字体传输  −94.6%（215,580 → 11,604 B）
分包总成本    +14,920 B（+6.9%，只在用户真走到那些字形时才付）
```

**A 包为什么装 60 个字形而不是 14 个**：浏览器的字体请求由**布局树里出现的文字**触发，
首屏路由折叠线以下的内容同样会触发下载。把「首屏并集（14）+ 本站首屏路由整页并集（41）+
数字与中文标点安全集」都放进 A，首屏加载就不会因为折叠下内容再连锁拉起分片。
60 字形 / 11.6 KB 仍是原文件的 **5.4%**。

切分口径（`rust/scripts/split-display-font.py`）：
1. 码点集合来自 `rust/fonts/display-charset.json` —— 由
   `rust/scripts/extract-display-chars.mjs` 在浏览器里按「计算样式 = CS Display Serif」
   逐路由抽取（**不是**人肉列文案：展示体会落在数据来的文本上，如商品名/分类名）；
2. A 包 = 首屏并集 ∪ 整页并集 ∪ 安全标点；其余按码点顺序等量切 6 片；
3. 分包选项只做两件「不改渲染」的事：保留全部排版特性（`layout_features='*'`）、
   删掉只服务竖排的 `BASE/VORG/vhea/vmtx` 四张表；**不开** desubroutinize
   （CFF 子程序复用是体积优势，展开反而更大）。

## 3. 接入方式（CSS/HTML 各一行）

`src/index.css`：一个 `@font-face` → 7 个 `@font-face`（family/weight/display 不变，
每个带精确 `unicode-range`）。`rust/fonts/font-face.generated.css` 是生成物，
人工粘进 CSS 后由判据对账（防止「生成与落地两份漂移」）。

`index.html`：preload 从 215 KB 的单文件改为 `display-serif-cjk-a.woff2`。

源文件从发布面移出（`public/fonts/` → `rust/fonts/display-serif-cjk.source.woff2`，
SHA256 `a965146f…`）：它仍是分包的输入，但不再随站点发布 ——
否则「首屏只下 11.6 KB」的收益会被「包里还躺着一个 215 KB 文件」稀释，
并且它会成为下一轮误引用的来源。

## 4. 正确性怎么证明（两层判据）

| 判据 | 命令 | 结果 |
|---|---|---|
| 分包完整性 | `node rust/scripts/check-font-split.mjs` | 7 项全过：文件 sha256/体积与 manifest 一致、**并集 == 源字体 932 字形（一个不漏）**、两两不重叠、A 覆盖全部首屏字符、CSS 的 7 条 @font-face 与分包一一对应、入口只 preload A、体积预算 |
| 渲染等价（度量） | `node rust/scripts/font-render-parity.mjs --old <旧产物> --new <新产物>` | 5 个样本串（hero 标题/刊头/服务区标题/分类页标题/订单页标题）的 `TextMetrics` 逐位相同，且 `document.fonts.check` 为 true |
| 渲染等价（像素） | 同上 | `.market-hero-copy`（关动画、不含随机照片）**不同像素 0/260,538，最大通道差 0** |

像素判据的两个坑（都已处理）：① 首页 hero 照片每次开屏随机（`pickExhibits`），
整页截图会把随机内容差异混进字体差异 ⇒ 只比确定性文案块；
② 站内 CSP `style-src 'self'` 会拦掉测试注入的 `<style>` ⇒ 关动画改用
`emulateMedia({ reducedMotion: 'reduce' })`（站内 CSS 自己就有这条媒体查询）。

## 5. 顺带记录的两个环境坑（避免下一轮重踩）

1. **MSYS/Git-Bash 会把「以 `/` 开头的参数或环境变量值」改写成 Windows 路径**：
   实测 `FOO='/a,/b'` 进到 node 里变成 `C:/Users/.../bash-win32-x64/a,/b`。
   于是「路由清单」这种以 `/` 开头的值必须走 JSON 数组（`XR_ROUTES='["/","/shop"]'`）。
   第一版抽取因此只覆盖了首页，却仍然打印出一份「并集」——**参数没生效但脚本照跑**，
   正是最容易被当成结论的形态。
2. **`pyftsubset.exe` 在本机静默空跑**（退出码 0、零产出）。改用 fontTools 的 Python API
   （`fontTools.subset.Subsetter`）后正常 —— 判据是「产物文件存在且 sha256 对得上」，而不是退出码。

## 6. 复算

```bash
cd supermarket-web

# ① 抽字符集（需要页面能被完整渲染；数据驱动的路由建议经 Rust 边缘接现网 API）
XR_ROUTES='["/","/shop","/shop/food","/product/p_1","/cart","/order-query","/order-confirm","/assistant","/category/life","/service/print"]' \
SM_BASE=http://127.0.0.1:5182 SM_JSON_OUT=rust/fonts/display-charset.json \
  node rust/scripts/extract-display-chars.mjs

# ② 分包（生成 public/fonts/display-serif-cjk-*.woff2 + manifest + CSS 片段）
python rust/scripts/split-display-font.py

# ③ 判据
node rust/scripts/check-font-split.mjs
node rust/scripts/font-render-parity.mjs --old rust/.cache/dist-old --new dist
```

## 7. 没有解决的部分（照实写）

- 原字体只覆盖 932 个字形，而产物里出现的 CJK 字符有 **1,489 种**（含 557 种缺字）——
  也就是说，**一部分中文标题本来就在走系统回退字体**（`src/index.css` 的回退链注释记录了
  2026-10-26 为此补 Source Han Serif SC/SimSun 的原因）。分包**不改变**这个覆盖缺口；
  要补齐它得回到「用完整字库重新子集化」这条路（体积会回到 MB 级，应改用 `unicode-range`
  多片 + 按需，与本轮同构）。
- 未做「按路由预判下一片」的 `<link rel=preload>` 提示：当前是纯 `unicode-range` 按需，
  代价是走到含生僻字的页面时那一小段下载与渲染竞争（实测单片 30~42 KB）。
