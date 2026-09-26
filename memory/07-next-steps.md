# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**
>
> **⚠️ 记忆双份提示（2026-09-23 实测）**：本项目存在两套 `memory/` —— 本目录（代码仓内）与
> 外层 `超市web/超市/memory/`（工作区）。两者内容**不同**（07 主卷 SHA256 不一致），
> 属历史遗留的双份结构，尚未合并。**本轮的权威记录在外层**：`deliverables/前端深度优化方案-2026-09-23.md` §6。

## 2026-09-26 — 对标第十二轮（备份链"绿色零备份"实况 + 存活判据）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十二轮-2026-09-26.md`；备份 `_backup/pre-round12-2026-09-26/pre-round12.bundle`。

## 2026-09-26 — 对标第十一轮（备份可恢复性 + 数据面事实；全程走 PR）

### P0（第十三轮开工先做这条，可执行）

- [ ] **catalog 接成阻断后的首轮观察**：看第一次 `Uptime` run 是否因瞬时网络红（`/pub` 取不到 ⇒ exit 2 ⇒ 红）。若误报 ⇒ 改成"重试阶梯后再判"，而不是放宽回 continue-on-error。
- [x] **体量收口 — 已完成（2026-09-26）**：07 主卷 80,848B → ≤4KB、27 卷全部 ≤4KB、二次 `split` rc=0 幂等；`05-feature-status.md` 同步拆 2 卷。**根因不是内容多，而是 `handoff.py split` 无界自循环**（12 分钟造出 13,776 卷），已在技能侧 V3.70.0 以三重闸（register_only / no_progress / part_budget）+ 133 项夹具 + 三向变异修掉。**下一轮规矩**：每轮往 07 只写 ≤4KB 摘要、详情落 `deliverables/` 报告 —— >4KB 单块自动拆卷依设计拒拆，只能章节级人工归档。
- [ ] **告警第二通道（暂不做，等证据）**：当前可达通道只有 GitHub 失败邮件；只有出现"邮件没到/被静音"的实证才引入心跳（ntfy/healthchecks.io 类），否则只是多一个 secret。
## 分卷目录

- **卷1** `07-next-steps.part1.md`
- **卷2** `07-next-steps.part2.md`
- **卷3** `07-next-steps.part3.md`
- **卷4** `07-next-steps.part4.md`
- **卷5** `07-next-steps.part5.md`
- **卷6** `07-next-steps.part6.md`
- **卷7** `07-next-steps.part7.md`
- **卷8** `07-next-steps.part8.md`
- **卷9** `07-next-steps.part9.md`
- **卷10** `07-next-steps.part10.md`
- **卷11** `07-next-steps.part11.md`
- **卷12** `07-next-steps.part12.md`
- **卷13** `07-next-steps.part13.md`
- **卷14** `07-next-steps.part14.md`
- **卷15** `07-next-steps.part15.md`
- **卷16** `07-next-steps.part16.md`
- **卷17** `07-next-steps.part17.md`
- **卷18** `07-next-steps.part18.md`
- **卷19** `07-next-steps.part19.md`
- **卷20** `07-next-steps.part20.md`
- **卷21** `07-next-steps.part21.md`
- **卷22** `07-next-steps.part22.md`
- **卷23** `07-next-steps.part23.md`
- **卷24** `07-next-steps.part24.md`
- **卷25** `07-next-steps.part25.md`
- **卷26** `07-next-steps.part26.md`
- **卷27** `07-next-steps.part27.md`
- **卷28** `07-next-steps.part28.md`
