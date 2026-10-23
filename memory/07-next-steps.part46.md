# 07 分卷 46 —— 对标第三十二轮（2026-09-27）：能不能自动跑，交给被试对象自述

> 主卷指针；报告在外层 `deliverables/…报告-第三十二轮-2026-09-27.md`；回滚锚 `3f55e61`，
> 备份 `/c/_sm_backups/r32-start-3f55e61.bundle`（bundle verify + **载回演练**：clone 后 HEAD 相符）。

## 本轮做完什么
- **H1 `@probe-safe` 自述口径（承 R31 台账 #1 / L2）**：危险脚本可在源码里独占一行写
  `// @probe-safe: <实测依据>` ⇒ 回到探针分母。硬回执：`golang/go`
  `src/cmd/go/internal/test/testflag.go:67` `"tell long-running tests to shorten their run time"`
  —— 条件写在被试对象里，框架只机械核对。
- **新判据 G11 三方对账**：声明须有真危险特征可宣、依据须带实测数字、且与风险表「已证明停在门口」一一对应（两个方向不对都红）。五向夹具齐。
- **放行 5 项 ⇒ 分母 26→31**（缺输入面 + 零分母镜像**两种骨架都测**，首行均自家诊断）：
  catalog-facts rc=2/1s、ci-green-contract rc=1/0s、gen-api-doc rc=2/0s、migrate rc=1/0s、purge rc=2/0s。
  不放行 5 项（原因写进风险表）：pr-has-tests 按设计 rc=0、ci-status 9s、local-api-stub 挂死、smoke/uptime 先打线上。
- **M1 结掉 R31-L3**：上轮猜"5 条断言被 20s spawn 预算挤掉"。判别实验：同批 5 条在空闲与 32 路负载下
  各跑，idle `1.7s/0.2s/≤0.2s`、loaded `6.9s/1.5s/≤0.6s`，**两种都全 rc=0** ⇒ 假设否证。
  残余复合因不故意复现；纪律已够：跑判据期间别动被测仓（runbook §9 已更新）。
- 夹具 106→122；全链独占复验 **88 文件 / 1166 条 rc=0**，`GATE-PASS cli-entrypoints 11/11`、
  `GATE-PASS memory-volume 判 55 卷超限 0`。

## 后半卷

- 本节之后的全部段落逐字迁至 `07-next-steps.part174.md`（I-78-6 拆薄，迁出零删句）。
