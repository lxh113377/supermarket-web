# 07 分卷 183 —— 第 87 轮：工单底稿 + b4 提亮（提交 8893d26）

> CHANGELOG 同日条目为准；本卷记**治理器正则坑**与**八维覆盖现状**。

## 2026-10-25 — 治理器 bundleBudget 正则只认整数乘法

- check-bundle-size.mjs 的 firstLoadCss 写成 `21.5 * 1024`（小数）⇒
  check-governance-framework 的现算正则 `(\d+)\s*\*\s*(\d+)` 不匹配 ⇒
  bundleBudget() 返回 null ⇒ F2 报「册内缺键 bundleBudget.firstLoadCssBytes」UNVERIFIED(rc=2)。
  修法 = 用整数乘法形态（22 * 1024），registry facts 同步。**经验：给治理器喂的常量
  必须保持 `整数 * 整数` 形态，小数/表达式都会静默断供**。

## 八维覆盖现状（截至本轮）

- 已票据化/灯箱化：成功、支付、查询、404（视差）、详情（灯箱）、购物车（票脚）、AI 导购（灯牌）、服务表单（工单）、提交成功（盖章）。
- 未触：CategoryPage 出口卡（已 2026-10-22 升级过品牌语言，暂缓）、AdminPage 五页签（后台密度高，动前先读 armed-stability）、登录墙、print 外站（明确排除）。
- 八维遗留：管理端登录页语汇、看板入场动效（现 fade-in-up stagger 已有）、宋体子集按路由分包。

## 下一轮候选

1. 管理端登录页（密钥闸）票据语汇对齐（stub 套件覆盖面，改动面小）；
2. CategoryPage 出口卡微调（服务目录行 hover 已有，低优先）；
3. 宋体子集分包（性能维，215KB → 按路由拆）。
