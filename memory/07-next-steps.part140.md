# 07-next-steps · 第六十八轮正文（后半 · 下一轮 P0 与在册欠账）

## 下一轮 P0（写死在此）

- `check:delivery-claims` 的**升档判断**：拿本轮 `matched=1 / mismatched=15` 的清单逐条定性
  （其中"把判据名字写成『已上线必须有回执』"这类**提及**已用引用跨度筛除，剩下的才是真谎报候选），
  误报率归零后再由老大拍板接 pre-commit。
- `docs/cron-health.json` 两条 RED 的**硬到期 2026-10-12**：在册理由「缺 `CF_D1_BACKUP_TOKEN`」现在**不完整**
  ——成环那一半本轮已修，剩余那一半仍是用户侧凭据。到期轮必须按新根因换一条可证伪理由，不许续写旧理由。
- 10-07 **性能第二批**（cadence 7 天，本轮未到点、未提前采）。
- 下一夜 cron 的**回执**：本轮把 uptime 那一步从 skipped 修成 ran，但"它真跑到了"只能由下一次
  scheduled run 的 step 明细证明 ⇒ 下轮开工先读 `gh run view <uptime run> --json jobs`。

## 本轮新增的在册欠账

- **D-68-1**：E1/E2 两腿的"能红"是本轮**一次性注入实测**（改日期→跑→复原，字节对账回原状），
  无常驻回归保护（`check-doc-consistency.mjs` 是顶层脚本、无导出纯函数，做夹具仓要连
  `api-contract.json`+覆盖率阈值一起造）。禁止把本轮读数说成"已有回归保护"。
- **D-68-2**：`check:delivery-claims` 在 CI 上恒为 UNVERIFIED（runner 只检出代码仓，`../deliverables/` 不在），
  真取数面只在本机与那条每日 cron 上 ⇒ 本轮把它接成 ci.yml 报告型 step 的意义是"每天留一次可见的未观测"。
- **D-68-3**：`tests/ciGreenContract.test.js` 的变异体 M2 在全量并发跑下出现 `status=null`
  （三轮全量读数 9→2→3 个失败，单跑该文件恒绿）⇒ 属负载把 spawn 预算打断那一族，**未归因完成**，
  下轮按「同机复跑再谈环境」处理，不许顺手提预算掩盖。
