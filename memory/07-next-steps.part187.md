# 07 分卷 187 —— 第 90 轮：柜台台账（CategoryPage）+ forest 变量族补漏

> CHANGELOG 同日条目为准；本卷记**两处一手根因**与八维台账增量。

## 2026-10-26 — CI 红基座与部署链（本会话 P0，已闭环）

- run 40209467148@f39da82 gates=failure 的一手根因（job 121217407303 全量日志逐行扫）：
  memory-volume V2「agents.md 4258B(+162)」⇒ vitest 3 红 ⇒ deploy job 因 needs 从未创建 ⇒
  线上卡 15b0046 落后 12 笔。修法 = 拆卷（git 段逐字迁 AGENTS.part2.md），非压措辞。
  提交 2108f96；并行会话先推，我推时 no-op 不落账（ci-green 自己判的，非我声明）。
- 教训：memory 卷 4KB 铁限的红会**掐死 deploy 链**（needs），比一般 CI 红贵一个量级；
  收尾前必跑 `node scripts/check-memory-volume.mjs --all`。

## 2026-10-26 — forest 变量族从未存在（v3 起 latent，v4 暴露）

- tailwind 的 forest 族（DEFAULT/deep/mid/soft）自 v3 重构起引用 `--t-forest*`，:root 从未定义；
  v4 前 categories 用 green 族不暴露，v4 把横带换 `to-forest` 后生活/学习封面带
  computed invalid-at-computed-value-time 整链清空 ⇒ **线上自 v4 起透明**。
- 对比度闸抓不到它：祖先背景取样口径下透明带读到 page-container 的实底。
- 补值：锚点钦定森林绿 #1F4A39（31 74 57），deep/mid/soft 同色相明度阶；白字 8.77:1。
- 同族病史（第三次）：v4 手术漏 espresso ⇒ 黄铜底字色塌 2.87；漏 on-brass ⇒ 整排钮字塌；
  本次漏 forest ⇒ 两条封面带透明。**v4 拆族手术必须配「引用⇄定义」全量对账腿**（待办）。

## 八维台账增量（第 90 轮）

- 原创性/层级：CategoryPage 通用卡片网格 → 柜台台账（铜序号/发光暖台/金线左轨/挂牌/横轨）。
- 配色：封面带 forest 族复活；eyebrow 改米白（亮金压 via-amber-900 段 2.55:1 实测红）。
- 响应式：台账行桌面两列/手机单列；页脚横轨 min-height 32px 过 2.5.8。
- 动效：counter 族过渡全在册曲线 + reduced-motion 降级块。
- 判据面：分类路由 15 条视觉闸全绿（含 320/390 可达、对比、触控、动效一致）。

## 下一轮候选

1. 「引用⇄定义」变量对账腿入 verify 链（治 forest 同族病第四次）；
2. 看板入场动效与宋体子集按路由分包（part183/184 遗留）；
3. AdminPage 五页签深度重构（armed-stability 钉得紧，动前重读）。

## 2026-10-26 — 同轮第二批：查询工单 + 常问台账（桌面空洞清除）

- OrderQueryPage 桌面双栏：左 intake-sheet 同族「查询工单」+ 右「问事处 · 状态台账」
  （五态逐条记档，铜序号 + 虚线分行）；无结果态 min-height 100% 垂直居中治下半空洞。
- AssistantPage 空态桌面双栏：对话列 + 「常问台账」侧轨（六问逐条记档，点击即问）；
  窄档单列堆叠，侧轨不隐藏（零面积叶会被可达闸判红）。
- 判据红一处自修：台账若用状态标签原文（已支付）会撞 contrast 闸 order-query-result
  前置 getByText('已支付') 的子串匹配（strict 双元素）⇒ 台账改账本别名
  （立单/收款/出送/闭环/废单），白话注解释主链含义；状态机真源仍 orderStatusLabel。
- 教训入库：**新增展示文本前先 grep 视觉闸的 getByText 前置**（子串匹配会跨组件撞名）。
