# 07 分卷 197 —— 第 91 轮第十笔：一条**没半接线**的判据（附实测证据，下一轮照此实现）

> 由 part196 拆出（V4 出生线 3072B，196 首稿 3698B ⇒ 拆卷而不是压措辞，见 part194 同族口径）。

## 动画名 ⇄ 产物 @keyframes：为什么必须读 dist

- shimmer 那处缺陷的形态是：src 里写了 `animation: shimmer`，但 Tailwind 只在对应
  `animate-*` 工具类被用到时才产出 keyframes ⇒ 产物里 `@keyframes shimmer` 出现 0 次。
- **读 src 抓不到这个病**（本轮实测，不是推演）：src 面引用 15 个动画名、src 面定义 15 个，
  逐字相等、零缺失 —— 因为 tailwind.config.js 里那条定义确实存在，缺的是**产物侧**。
  所以这条腿必须读 dist，落点与 `check-bundle-size.mjs` 同侧（进 `preflight:ci`，
  不进本机 verify 链 —— 本机 verify 不 build，读 dist 会在没有产物时假红）。

## 已实测过零误伤可行性（2026-10-26，dist = ec9154e 那次构建）

- src 引用 15 个动画名 ⇄ dist 产物 21 条 @keyframes ⇒ **缺失 0**（正向腿今天就能立）。
- 反向多出的 6 条：fade-in / fade-in-up / scale-in / slide-down / slide-up / spin，全部来自
  TW 的 `animate-*` 工具类 ⇒ **反向不得判**（判了就是把工具类当缺陷，
  与 warm-foreground 那条「CSS 里的冷灰渲染判据抓不到、源码扫抓不到，两条腿方向相反
  才闭合」同族：这里反向面是合法的，所以只立正向一条）。
- 剥注释必须做（`stripComments`）：tailwind 头注与 CSS 注释里有 `animation:` 字样示例，
  不剥会造出假引用（check-css-tokens 首跑就误报过一次，同一课）。

## 为什么本轮不做（不是忘了，是不半接线）

- 接一条门禁要同时动 6 处登记面：新脚本 + package.json 别名 + 常驻夹具 +
  `registry.json` 的 gateScripts / verifyLegs 两个登记值 + README 门禁一览（`--update` 重生）+
  head-closure 的链引用面。少接一处就是本仓 H5 明令拦的「没接线的判据 = 半成品」。
- 本轮剩余预算优先给了能独立成立、当场可验的焦点环闸（已 10/10 落地并跑进 visual job）；
  这条读 dist 的留下轮整批做，**上面三个实测数字就是它的实现规格**，不必重新取证。
