# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）已逐字迁至 `07-next-steps.part117.md`**（内层与本仓外层 `超市web/超市/memory/` 两套 07 内容不同，权威在内层）。

## 2026-10-24 — 第七十八轮（四项工程改造：部署口径/载体龄期/V4b 普查/性能定性）

- 一（高）`chaoshi-web-deploy` 3.9.7：坑 40（增量推送取索引版+当场校验 blob sha）+ 幽灵脚本 `ghpages-push.mjs`
  四处执行引用改口径（主通道 git push，本轮实测 ls-remote/push --dry-run 均 rc=0）。
- 二（高）对标载体：裸跑不落盘但**当面打印台账龄期**（实测台账曾停摆 6 天）；`--json` 缺参落默认台账、
  `--no-json` 演练面零触网；selftest 9/9；台账刷新 10-23（名册内 mall/litemall/grocy/jgudo 已停更 4/9）。
- 三（中）V4b `--born` 出生贴线普查 + BORN_BASELINE 棘轮 22 本；测试 48 passed。I-77-3 落地。
- 四（中）`npmRcCache` 修 lighthouse 载体假阴；t1806 跨日批 6/6：t1355-SI 与 t2359-SRT **未复发**，新格 admin/t1806 SRT 待观察。
- 正文与验收回执 → 逐字在 `07-next-steps.part170.md` / `part171.md`。
- **下一轮 P0**：I-78-5 再采一跨日批给 admin SRT 定性；报告 = 外层 `deliverables/GitHub开源项目对标分析报告-第七十八轮-2026-10-24.md`。

## 2026-10-18 — 第七十六轮（契约治理 + 体量治理登记化）

- 新增 `docs/governance/` 六件（registry.json 登记册 + 四份人读规范 + 入口）与 `scripts/check-governance-framework.mjs`（九腿三向对账：登记值 ⇄ 现算值 ⇄ 源件在盘非空；文档引用 ⇄ 册内 id 双向），
  并入 verify 聚合链（`npm run verify:governance`，段数 42→43）。
- 本机实测：`npm run verify:governance` **9 通过 / 0 失败 / 0 未验**（rc=0）；判据 `--selftest` **12/12**；夹具 `tests/governanceFramework.test.js` **7/7**（含真仓默认面、零输入 rc=2、两条方向相反的变异腿）。
- 本轮完成对账的同时，把既有闸的两处连带红一并处置：G11（无效 `@probe-safe` 声明 ⇒ 删声明）、check:doc-commands 的 D6+D7（新别名 ⇒ 重生生成块与登记册）。
- **下一轮 P0**：P2 阶段 —— 把联动规则做成可当场复算的结论，并把线上性能线四态（GREEN/WARN/RED/NO-LINE）接进报告位；NO-LINE 不得读成通过。
## 2026-10-17 — 第七十四轮

- 摘要（四项已上线 / M4 变异体自咬 / 未修且 agent 无权三行）→ **逐字**迁至 `07-next-steps.part164.md`（第七十五轮迁出治 V3 贴线）；正文 `part161` / `part162`。
## 2026-10-09 — 第七十三轮

- 摘要（自伤串行已拆；名单改按时态收窄）→ 逐字迁至 `07-next-steps.part163.md`（第七十四轮迁出治 V3 贴死）；正文 `part158`，续账 `part160`。

## 2026-10-07 — 第七十一轮

- 三行摘要 + 「不用 `git commit --amend`」这条纪律的出处 → **逐字**迁至 `07-next-steps.part159.md`；
  正文与四项详情在 `part153` / `part155` / `part156`。

## 更早轮次的指针

- **在册卷号：1–171**（V5 对账行必须留在主卷；分卷规则与旧指针明细见 `07-next-steps.part165.md`）。
- 旧轮次指针 + 分卷目录（在册卷号声明 / V5 对账行）→ **整段**迁至 `07-next-steps.part165.md`（第七十五轮迁出治 V3 超限）。
- 第七十五轮主卷整段（四项工程改造摘要）→ **逐字**迁至 `07-next-steps.part168.md`（第七十六轮 P1 收口迁出治 V2/V3）。
