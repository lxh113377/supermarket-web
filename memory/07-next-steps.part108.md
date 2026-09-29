# 07 分卷 108 —— 第五十六轮名册随动账（自卷 104 整节迁出）

> 拆卷原因：V4「出生即贴线」——新卷须 ≤3,072B 留 25% 余量。
> 本卷是"加一个业务域到底要动几本名册"的逐本账单；本轮实测 6 本，这就是与有模块注册面的 Medusa/ERPNext 的真实差距。

## 登记册随动（每一本都是"少一行就判红"的那种）

| 面 | 入场 | 收尾 |
|---|---|---|
| `docs/error-codes.md` 行数 | 35 | **38**（+invalid_delta / invalid_kind / stock_untracked） |
| `src/api/error-codes.ts` 前端镜像 | 35 | **38**（E4 双向，kind 逐项相等） |
| `docs/pii-inventory.md` 表 / 列行 | 9 / 47 | **10 / 58**（`stock_movements` 整张进覆盖表，不是豁免） |
| 「已知缺口」条数 | 3 | **4**（新增"流水表无删除通道"，软作废不等于可删） |
| `docs/limit-provenance.md` | — | +5 行（4 个截断型 + 两个批量常量改值）、−2 死行 |
| `verify:authz` 只读穷举 / 写清单 / 路由 | 15 / 16 / 31 | **16 / 17 / 33** |
| `verify:cli-legs`（R56-H2） | 欠账 11/11，`unguardedMax=11` | **欠账 0/0，`unguardedMax=0`（同一笔）**；位点 72＝63+9、已接守卫 23 |
