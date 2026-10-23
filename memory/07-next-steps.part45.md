# 07 分卷 45 —— 对标第三十一轮（2026-09-27）：量这把尺自己

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第三十一轮-2026-09-27.md`。
> 回滚锚 `23c6630`；备份 `/c/_sm_backups/r31-start-23c6630.bundle`（bundle verify 打印 complete history）。

## 本轮做完什么
- **H1 覆盖面去假覆盖**：`collectCovered` 从"文件里有 spawn + 出现过文件名"改成"名字**沿调用链到达执行点**"
  四形态（spawn 实参 / 被 `for..of` 消费的数组 / 同行 `const X = join(...)` 且 X 进了执行点 / 本地 runner 实参）。
  合成仓三向夹具：真跑记账、死数组不记、仅提到不记。**真仓计数未变** ⇒ 该漏洞只被我踩到一次（假红），非系统性虚报。
- **M1 G10 分母地板**：分母＝可被自动 spawn 的入口数（现 26，地板 25）；把 `verify:x` 改名成 `report:x`
  且脚本带 fetch ⇒ 该项会静默离开分母，现在当场红。缺「分母地板」行本身即红。
- **H2** `scan-secrets` 进 ①类（PROBED 15→16）+ 三种分母形状升级为断言。
- **H3 新闸 `scripts/check-memory-volume.mjs`**（`npm run verify:volume`，pre-commit 判暂存面 + CI 判 `--all`）：
  借 `pre-commit/pre-commit-hooks:check-added-large-files` 的形态（阈值显式、默认只管要提交的面、扩面要显式）。
  两种零对象分开：全量面空＝取数面坏了（红）；全 0 字节＝没有内容可判（rc=2）。
- **M2 拆卷**：part42 4,873B → 3,782B + part43(1,212B)；part35 5,408B → 4,006B + part44(1,524B)。
  拆卷器断言 `head+joiner+moved === 原文`，并用 `git diff -U0` 删除行逐行回查新区 ⇒ 0 行丢失。
- 夹具 97→106（cliEntrypoints）+ 12（新 `tests/memoryVolume.test.js`）；全链独占复验 **88 文件 / 1150 条 rc=0**。

## 后半卷

- 「最重要的一条 / 自己造的四次坑 / 并发写污染 / 下一轮 P0」四段逐字迁至 `07-next-steps.part172.md`（第七十八轮 I-78-6 首批拆薄：本卷出生 4081B 贴线余 15B，拆后两卷出生口径内；迁出零删句，逐字对账见下断言）。
