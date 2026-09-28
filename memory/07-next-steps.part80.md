## 2026-09-28 — 对标第四十八轮（一条门禁"能红"与"有人看"是两件事）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四十八轮-2026-09-28.md`；轮初锚 `3ca4ae9`；本轮一笔 `ce9431e`。
> 上轮三条 P0 **全闭合**，明细逐字在**卷 79**、四条失败面原文在 `CHANGELOG.md` 追加六十二：
> **H1** `verify_images.py` 的 `main()` 从不 `sys.exit`（负控制原文：合成面印「缺失 1/3｜覆盖率 66%」**rc=0**）⇒ 三档 0/1/2
> + 删掉"seed 读不到退回 1–49"的兜底 + 接进 `verify` 聚合链与 `ci.yml`。**H2** `runnerExcludes()` 现读 `vite.config.js`
> 的 exclude ⇒ G14 印 `vitest 面 110 / 被排除面 7（spawn 0 个）`，取不到配置印"差集未知"不印 0；**只加读数不改判定**。
> **H3** `CHANGELOG.md` 入 doc-commands claim 面（先量 137 条 span／缺失 0 ⇒ 零红；上轮"会一入面就恒红"是猜测，被实测否证）。
> **计划外 H4（机器型落点）**：`scripts/check-staged-syntax.mjs` 进 `pre-commit`——判 **index 里的 blob**、盲区明说、
> 非工作树 rc=2；起因是同一个编辑形态我四轮犯满 4 次，而它以前要等全链 verify 或一整条 CI 才现形。

> **P0（下一轮开工先做这条，可执行）**：**R49-H1 本轮收尾已取到 CI 回执** —— run `36394668910@ce9431e` 里
> `Set up Python (product image assets gate)` 与 `Product image assets gate (npm run verify:images)` 两步均 `success`、
> 五必需 job 全绿 ⇒ 接线成立。**新 H1 改为 CI 侧演习**：注入一件缺图 ⇒ 该步必须 fail（"能红"目前只有本机一份证据）。
> **R49-H2 `docs/doc-commands.json` 的 `counts` 是带 `observed_utc` 的快照，不是现值**：本轮实测 registry 196 / 当场 202。
> 我曾想加 D7 逼 `--update` 同步，**自己否证了**——没有判据或文档消费它，加闸只制造无意义的生成件提交。
> 正解＝note 字段写明"as-of 快照，禁引用为现值"，再 grep 谁把它当现值抄走。
> **R49-H3 覆盖率棘轮跟门禁数走**：测试文件 105→107、别名 62→63；动阈值前先看 `npm test` 当场读数
> （阈值 79/72/74/80 由 `verify:docs` 对账真相源，禁在别处写第二个数）。**R49-H4 通用解释器分派**触发条件写死：
> **别名里出现第 2 条非 node 门禁**才做（为一个样本建框架即过度设计）。
> 用户侧不变：**`CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺** ⇒ 备份链 `artifact=0`，豁免至 **2026-10-12**；
> M3 分支保护沿用 2026-09-28T07:12:31Z 的实测 `NOT_ENFORCED`（本轮未重跑）；微信真机验收未做。