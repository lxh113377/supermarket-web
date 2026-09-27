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

## 本轮最重要的一条（可跨项目复用）
**收紧一个度量口径时，必须先量它会不会"漏报自己人"。** 第一版只认 spawn 实参，真仓覆盖立刻 24→20、
四条真夹具被误伤；我第一反应是"抓到四条假的"，核对后才发现它们走 `const X = join(...)` 与 `runGate()` 封装。
**"抓得住反例"只证明谓词充分，不证明它必要。**

## 我自己本轮造的四次坑（都当场改掉）
1. 夹具里把字节数**算成** `5001B(+905)`，实测 `5009B(+913)` ⇒ 改成"从输出解析 + 与盘上字节数交叉核对"。
2. `arrayRanges` 写成恒真条件（边 `reachNames.add(name)` 边用 `reachNames.has(name)` 自查）＝刚关的门又开。
3. ESM 里误用 `require('node:fs')`，还留了引用不存在函数的死代码（半成品入库）。
4. 差点写"24 条里掺了水"，实测否证（只发生过一次，且是假红）。

## 并发写污染（新形态，全文见 runbook §9）
独占跑 87 文件 / 1,129 条全绿；我边跑边改文件 + commit ⇒ **7 条失败**；停写重跑又全绿。
⇒ **跑判据期间不要写被测仓**（敏感面：在真仓 cwd 下跑 git 的那几条判据）。
未归因：7 条里"被 git 状态影响"与"被 20s spawn 预算挤掉"各几条 ⇒ 见 P0-2。

## 下一轮 P0
1. **L2 危险项解禁（纯收益）**：6 条危险项已实测在骨架里 rc=2、0–1s、无副作用 ⇒ 进 ②③ 分母
   （26→最多 32），风险表逐条注明"已证明停在门口"。
2. **R32-L3 逐条归因并发写污染**：把 `gateFixtures` 系与 spawn 预算敏感系分开单独重跑，输出"哪几条只在并发时红"。
3. **L3 `aiChat` 形状**（挂第 3 轮）：fetch stub 复用 `RESPONSE_CONTRACT_IN`，推到 41/41 后把"零缺口"升为硬断言。
4. 台账体检：每轮抽 2~3 条理由反做（本轮 3 条：尺用错 401/404、secrets 名单为真、junction 双跟踪已排除）。
5. **N3 部署仍高于一切技术项**（对外发布不在自动化授权内；动前先加载 `chaoshi-web-deploy` skill）。
6. M3 服务端 Required checks：本轮 `gh api` 重跑仍 `404 Branch not protected`（第 4 次挂账，用户侧）。
