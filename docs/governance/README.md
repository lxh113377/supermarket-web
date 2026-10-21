# 契约治理与体量治理 · 登记与规范总入口

> 本目录是 supermarket-web 仓「治理面」的唯一人读入口。机器登记册在本目录的 registry.json（schema = chaoshi-governance-registry-v1），
> 下面两份规范只解释口径，**不复写数字**：所有数字的唯一现值由登记册承载，由判据当场重算对账。

## 一、目录内容

| 文件 | 作用 | 谁读 |
| --- | --- | --- |
| registry.json | 机器登记册：事实现值、契约生命周期节点与权责、体量指标与三档阈值、联动规则、分步计划 | 判据（每次推送读一次）与接手人 |
| 契约全生命周期规范.md | 五阶段（起草/审核/签署/履约监控/归档）的节点权责（RACI）、准出证据、契约风险预警三档 | 提交人、评审人、值班人 |
| 体量治理规范.md | 业务体量 / 资源承载体量 / 运营规模体量三类指标的量化标准、阈值定档法、动态监控与自适应调整 | 工程、运营、值班人 |
| 数据互通与联动分析.md | 两类治理的数据互通链路：联结键、五条联动规则、协同决策的触发与阻断条件 | 分析人、值班人 |
| 分步推进计划.md | 四阶段推进计划（P1–P4）与配套考核校验标准（ac-1 至 ac-4） | 全部角色 |

## 二、登记册 ⇄ 现值的对账（唯一入口）

`npm run verify:governance` 是这套治理的唯一机器出入口，读 registry.json 的 facts 段并当场重算下列十三条事实：

| facts 键 | 现算来源 | 现算方式 |
| --- | --- | --- |
| contractActions | docs/api-contract.json | 逐端点 action 键计数（/web 与 /pub 分列） |
| verifyLegs | package.json | scripts.verify 里 && 段数 |
| gateScripts | scripts 目录 | 逐文件枚举 .mjs 件数 |
| ciJobs | .github/workflows/ci.yml | jobs: 段的两空格缩进键计数，并与 .ci/contract.json 的必需 job 名单双向对账 |
| limitRosterRows | docs/limit-provenance.md | 表格数据行计数 |
| itemBudgets | docs/item-budgets.json | items 条数与 noBudgetMax |
| memoryVolume | scripts/check-memory-volume.mjs | 从判据源码读两档上限常量，并量入口壳与最大内容卷 |
| seedCatalog | db/schema.sql + db/seed.sql | node:sqlite 内存重放后计数（业务体量的可复算面） |
| d1Quota | docs/d1-write-quota.json | 免费档日写配额、峰值行数、峰值调用数 |
| d1Usage | docs/d1-remote-usage.json | 最近一个 UTC 日的行写/行读读数 |
| bundleBudget | scripts/check-bundle-size.mjs | 从预算常量读首屏 JS/CSS 与最大单块字节 |
| perfLines | docs/live-perf.json | 六条线上性能线的上限值 |
| codeFace | functions 与 src 目录 | 按扩展名结构枚举的代码件数 |

对账只有三种结局，且**没有第四种**：

- 全部相等 ⇒ 判据 rc=0，并印出比对组数与不符数；
- 任一处不等 ⇒ rc=1，逐条点名「册 X ⇄ 实测 Y」，禁只说「漂了」；
- 册内缺键或源件读不到 ⇒ rc=2（未验），**不得折算成通过**，也不得折算成失败后改册了事。

## 三、人读文档与登记册的引用规则

规范里凡引用登记册节点，一律写 [registry:<id>] 形态。判据做双向对账：

1. **幽灵引用**（文档引用了册内不存在的 id）⇒ rc=1；
2. **零引用**（册内核心 id 没被任何文档引用）⇒ rc=1。反方向的这条是刻意的：
   一条只活在册里的 id，等于一个没人执行的权责，必须有人把它写进规范。

## 四、与既有闸的分界（一物一判）

| 事实 | 由谁判 | 本判据是否重复判它 |
| --- | --- | --- |
| 实现 ⇄ 生成物 | npm run verify:contract 等 | 否，只读其产物做登记对账 |
| 生成物 ⇄ 上一版 | npm run check:contract-diff | 否 |
| 上限登记 ⇄ 代码取值 | npm run verify:limits | 否 |
| 记忆卷字节 ⇄ 阈值 | npm run verify:volume | 否，只从它读常量 |
| 首屏与单块体积 | npm run check:size | 否，只从它读预算 |
| 登记册 ⇄ 现值 | 本判据 | 是（唯一一处） |
| 文档引用 ⇄ 册内 id | 本判据 | 是（唯一一处） |

## 五、撤销条件

- 若 `npm run verify:governance` 连续两轮出现同一处「册与实测不符」且处置结论都是「改册就绿」，说明对账没拦住任何真实漂移，本目录退化为文档，应撤掉判据并回到既有闸；
- 若 registry.json 的 facts 段被证明只是把既有判据的输出抄了一遍（即去掉本目录后既有闸同样能拦住同样的事），则本册与判断一并撤销，改为在各既有判据里加一行；
- 若某条指标的 source.op 长期为 manual 且连续四轮没有新读数（见体量治理规范的撤销条件），该指标应移出登记册而不是继续挂着。
