# 07 分卷 42 —— 对标第三十轮（2026-09-27）：换分母当场抓到"没扫也报干净"，以及我自己造出的假覆盖

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第三十轮-2026-09-27.md`。
> 回滚锚 `a23f105`；备份 `/c/_sm_backups/r30-start-a23f105.bundle`（"complete history"，载回验过）。代码提交 `e0df31d`。

## 本轮做完什么
- **R29-M1 落地（它挂了三轮，本轮优先执行兑现）**：探针分母从"门禁类 22→23 项"换成
  `probeDenominator()` = 全部登记入口 ∖ 危险特征 = **25 项**（23 门禁 + `list-uncovered` + `scan-secrets`），
  缺输入面与零分母两法原样施加。登记面实测 35 入口 / 门禁 23 / 非门禁 12 / 跑过 24 / 缺口 11 / 可探针 21 / 带风险 14。
- **四条真缺陷**（同一手法一次抓一串，证明"换分母"是有效动作而不是重构借口）：
  1. `scan-secrets`：零跟踪文件时打印「✅ 全仓密钥扫描通过，未发现问题。」**rc=0**，与真扫 632 个文件逐字相同 ⇒ 现在印"已读 N 个文件"、N=0 rc=2、`--staged` 空暂存另给"跳过"形状；植入私钥复验仍 rc=1（双向）。
  2. `purge-security-events`：无 tty 下 1s 内就把 `DELETE FROM security_events` 打到远端 D1 ⇒ 按本仓 `migrate.confirmRemote` 口径改成需显式 `--yes`。
  3. `gen-api-doc` 缺契约裸栈 `node:fs:441`；4. `check-catalog-facts` 缺 seed.sql 裸栈 ⇒ 都走 preflight rc=2。
  另修 `check-pr-has-tests`：`execFileSync` 默认透传子进程 stderr，首行被 git 的 `fatal:` 抢占 ⇒ `stdio` 改 pipe。
- **G9 新判据**：「自动探针绝不能 spawn 谁」不手抄，由 `classifyRisk()` 从每个脚本源码推导，与登记册
  「风险分类」表双向对账（漏登 / 幽灵 / 标签不符 / 依据过薄四向都红），实测 14 条。
- 夹具 81→96；全链 `npm run verify` rc=0（**87 文件 / 1128 条**，数字实读自 vitest 汇总行）。
- 台账体检（每轮证伪几条）：`ci-status` 通道实为 curl 不是 gh；`pr-advisory` 跑在 `dispatch.yml:44` 不是 PR job；
  `check-bundle-size` 引用的 CI 行号 139/146 实为 151/158。三条全部改文档追实测。

## 后半卷

- 本节之后的全部段落逐字迁至 `07-next-steps.part177.md`（round-4 I-78-6 续拆，迁出零删句；sha256 恒等断言当场跑过）。
