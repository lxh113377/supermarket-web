# 07 分卷 37 —— 对标第二十五轮（2026-09-27）：门禁在缺输入面上的姿态

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第二十五轮-2026-09-27.md`。
> 回滚锚 `ddbc2f1`；备份 `/c/_sm_backups/r25-start-ddbc2f1.bundle`。代码提交 `aebc740`（远端 run 36292655792 五 job success）。

## 本轮实测（方法：把 scripts/ 整目录拷进空目录逐条真跑）
- 22 个门禁类入口里 **8 个甩裸栈 + 1 个静默放行**。静默放行那条是 `check-licenses`：
  在没有 package.json 的目录里打印「0 个生产依赖全部在白名单 ✅」并 exit 0。
- 收口件 = `scripts/lib/preflight.mjs` 的 `requireInputs(label, paths)`：缺项 ⇒ 印 `[label] 环境不满足：…` + exit 2。
  已接 9 个门禁；两处必须把**静态 import 改成"先收环境再取模块"**（`@babel/parser`、`tests/helpers/fakeDb.js`），
  否则 fail-closed 文案还没机会印就先崩在模块解析阶段。
- 常驻探针：`tests/cliEntrypoints.test.js` 53 条（22 条缺输入 + 植入两种假门禁 + 变异体：摘掉 license 的
  零分母收口 ⇒ 探针必须当场读成静默放行，还原后回到 fail-closed）。
- 覆盖口径正式分两类：①判据路径真跑（14 条，rc=0 且有结论）②缺输入面真跑（22 条，rc≠0 且首行非栈）。互不替代。

## 本轮自己引入并修掉的连带回归（别重犯）
- 给门禁加共用件 `scripts/lib/` ⇒ 凡"拷单文件建夹具仓"的测试同时被打断（migrateReplay 两处）。
  正解是 `copyGates()` 连 `scripts/lib` 一起拷，而不是把共用件塞回每个门禁里。
- 批量文本替换把 `import` 插进了函数体（ESM 语法错误），6 个受影响、2 个当场崩 —— 靠"逐个门禁真跑"抓到。
  **改完必须逐个跑，看 diff 不产生"能跑"的证据。**

## 下一轮 P0（本轮未做，别当成已做）
1. R25-M4：还有 4 个门禁自带"环境不满足"文案却没走 `requireInputs` ⇒ 统一成一种形状；并给 `requireInputs` 补独立夹具。
2. R25-L1：逐条普查"我的分母为 0 时会不会变绿"（licenses 只是被抓到的第一条），答案写进各自登记册。
3. M3（上一轮遗留，仍受阻）：服务端 Required checks 需用户在 GitHub 分支保护里开；agent 不擅改共享设置。
4. M1：8 条具名入口缺口继续每轮收 2~3 条，G4 覆盖地板随实上调。
