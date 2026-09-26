# 07-next-steps.part29.md

<!-- 本卷为 07-next-steps.md 的延续 -->

### P0（第十三轮开工先做这条，可执行）

- [ ] **catalog 接成阻断后的首轮观察**：看第一次 `Uptime` run 是否因瞬时网络红（`/pub` 取不到 ⇒ exit 2 ⇒ 红）。若误报 ⇒ 改成"重试阶梯后再判"，而不是放宽回 continue-on-error。
- [x] **体量收口 — 已完成（2026-09-26）**：07 主卷 80,848B → ≤4KB、27 卷全部 ≤4KB、二次 `split` rc=0 幂等；`05-feature-status.md` 同步拆 2 卷。**根因不是内容多，而是 `handoff.py split` 无界自循环**（12 分钟造出 13,776 卷），已在技能侧 V3.70.0 以三重闸（register_only / no_progress / part_budget）+ 133 项夹具 + 三向变异修掉。**下一轮规矩**：每轮往 07 只写 ≤4KB 摘要、详情落 `deliverables/` 报告 —— >4KB 单块自动拆卷依设计拒拆，只能章节级人工归档。
- [ ] **告警第二通道（暂不做，等证据）**：当前可达通道只有 GitHub 失败邮件；只有出现"邮件没到/被静音"的实证才引入心跳（ntfy/healthchecks.io 类），否则只是多一个 secret。
