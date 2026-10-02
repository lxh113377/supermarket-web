# 07-next-steps 分卷 121（第六十一轮明细 · 2026-10-02）

## 第六十一轮做了什么（H-61-3：event_sink 真 D1 驱动验证）

- 动因：59/60 轮 §8 把"线上写路径是否真收到事件"写成回读
  `SELECT COUNT(*) FROM event_log` —— 实测 n=0，但同期 `orders` 最后一单
  早于含 sink 的部署上线时刻 ⇒ 窗口内无事件，n=0 不含信息量。
  判据等的是别人家的流量 ⇒ 永不可主动闭合（判据缺陷）。
- 交付 6 件：`scripts/verify-event-sink-d1.mjs`（内存态 proxy，
  `persist:false`，零远端）＋ `tests/eventSinkD1.test.js`（正例/反向/selftest
  三腿）＋ `package.json` 别名 `verify:event-sink` 并进 verify 链 ＋
  README 一览 1 行 ＋ `docs/cli-entrypoints.md` 风险行 ＋
  `docs/doc-commands.json` 重生计数。
- 本轮实测（逐条现跑，非上一会话转述）：`--selftest` 9/9；正例 rc=0，
  读回 `{"n":1,"total":12.5,"disc":2,"st":"paid"}`；反向腿
  `--negative=missing-table` rc=1，红因 `no such table: event_log`；
  `vitest run tests/eventSinkD1.test.js` 3/3；`verify:entrypoints` 14/14；
  `check:doc-commands -- --check` OK；`verify:backend` 188/188；暂存区密钥扫描过。
- 收尾中修：全量 `npm test` 首跑 118过/4文件7失败 —— 其中 4 项是本轮
  6 件未入库所致（新夹具裸 spawn 欠账 0→1 ＋ guard 报"链上引用但 git
  不跟踪"），处置＝夹具接 `assertCliRan` 守卫 ＋ 显式 `git add` 6 件，
  重跑 4 文件全过。余 `ciStatusRedaction` 3 腿系 curl 死代理超时形态
  （单文件 362s），两文件均不在本轮 diff 内 ⇒ 环境性，不拦收尾。
- 未做：生产 D1 远端读回（下一轮 P0）、部署、任何密钥动作。
- 让位出去的第六十轮正文逐字见 `07-next-steps.part122.md`。
