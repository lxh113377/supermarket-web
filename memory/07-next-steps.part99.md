# 07 分卷 99 —— 第五十五轮明细（对标轮 55：先收上轮假绿的那半，再把量不动的一维量出来）

## 轮初对账（这一步救了本轮）

- 主卷与卷 97/98 都写「第五十四轮四件已完成、报告在 `deliverables/…第五十四轮….md`」；实测三件都不成立：
  报告 **0 命中**（`git log --all --deliverables/*五十四*` 亦无 ⇒ 从未写过，不是被删）、内层 **19 项未入库**、
  `npm test` = **3 files / 6 tests 红**。三根因＝①G9 漏登 `check-escape-hatch-log.mjs`（R54 加 `--remote` 引入 `gh-cli` 特征）
  ②台账漂移（aliases 66→67）③外层指针断更 1 轮 ⇒ **全是收尾欠的三步，没有一条是判据坏**。
- 判据侧早就把这件事写在脸上：`verify:pointers` 的 P2 腿原文就是「外层停在第 53 轮、内层已到第 54 轮 ⇒ 断更 1 轮」。
  **漏掉它的唯一后果是没跑测试就写"已完成"** —— 这条反哺已进 CHANGELOG 追加六十九。

## 读数（全部当次实测，2026-09-29 14:4x–15:1x 本机）

- **运行时性能第一次有数**（mobile + Lighthouse simulate 节流，UTC 06:49–06:52，6/6 样本含 FCP、`runtimeError=none`）：
  admin（`supermarket-web.pages.dev`）FCP 中位 **1,513ms**［1,507–2,183，1.45×］／LCP **1,953**［1.41×］／CLS **0**／
  TBT **201.5**［2.02×］／speed-index **4,606**［**4.52×**］／SRT **231**；
  customer（`lxh113377.github.io`）FCP **1,442**［1.09×］／LCP **1,692**／CLS **0**／TBT 中位 **0**（下界 0，倍差不定义）／
  speed-index **4,196**／SRT **272**。⇒ **同机同站倍差最大 4.52×**，单样本读数不可当基线；这是本轮**不立阈值**的直接证据。
- 可达性按「域名×时刻」记：本轮 14:43 实测 `pages.dev/=200`、`pages.dev/_health=200`、`lxh113377.github.io/=200`、
  `lxh113377.github.io/supermarket-web/=404`（顾客端就在 Pages 根，不在子路径）。与户内「github.io 倾向不通」的记忆
  **本轮相反** ⇒ 那条记忆按时刻报，不改成普适规律。
> 判据读数四行（live-perf / cli-legs / item-budgets / entrypoints）已逐字迁至 `07-next-steps.part102.md`（V4：新卷须 ≤3072B 留 25% 余量）。
