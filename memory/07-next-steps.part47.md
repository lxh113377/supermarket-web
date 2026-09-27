# 07 分卷 47 —— 对标第三十三轮（2026-09-27）：欠账不能只活在报告作者的记忆里

> 主卷指针；报告在外层 `deliverables/…报告-第三十三轮-2026-09-27.md`。
> 回滚锚 `8c3e6bf`（其 CI run 36305738589 五个必需 job 全 success，已补录）；
> 备份 `/c/_sm_backups/r33-start-8c3e6bf.bundle`（bundle verify + 载回演练）。
> 本卷按新规则控制在 3.5KB 内：**写满就开新卷号，不靠压措辞**（压措辞会删事实）。

## 本轮做完什么
- **H1 新判据 `scripts/check-branch-protection.mjs`**（advisory，永不拦提交）：把挂了 5 轮的
  "分支保护还没开"从口头重跑变成在册普查。四态 + 域×状态码×时刻：
  `ENFORCED` / `ENFORCED-VIA-RULESET` / `NOT_ENFORCED`（**必须 protection 与 rulesets 两条通道都可观测**）/
  `UNVERIFIED`（rc=2，既不写"没开"也不写"已开"）。真查结果：**NOT_ENFORCED**（404 + rulesets `[]`）。
  对标 `ossf/scorecard` 原文两条为实：5 项子设置需 admin token；无 admin token 时"按已满足计"。
  **本仓有意反着做** —— 评分器不为缺观测扣分，台账不能把缺观测写成清白。
- **H2 体量治理换做法**：`check-memory-volume` 新增贴线 WARN（stderr，不污染结论通道）。第一次跑就打出
  **9 本卷在 15% 余量内、4 本 <100B** ⇒ 推翻我上一轮"写超是偶发、压字即可"的判断。
  规则改为：新卷到 3.5KB 就开下一个卷号；历史卷是已定稿的账，贴线不动它。
- **M1 admitted 清单单点化**：风险表成为唯一真相源，测试改读「已证明停在门口」行（上一轮我在测试里
  手抄了 5 个文件名 = 第三份副本，必漂）。G11 管账本⇄源码，这条测试管账本⇄分母。
- **M2 runner 数据补白**：CI step 计时（粒度=秒）`vitest 61s`、`CLI entrypoint real-run gate <1s`、
  `Memory volume budget gate <1s` ⇒ 上一轮"本地负载实验不能代替"的空白用真实数字填上。
- 登记面：入口 **37**（门禁 24 / 非门禁 13）｜真跑 **26**｜带风险 **15**｜分母 **31**（地板 25，headroom +6）。
- 夹具：新 `tests/branchProtection.test.js` 7 条（四态真值表 + 注入式子进程真跑 + 变异体）；
  单测文件 88→89；全链独占复验 **89 文件 / 1173 条 rc=0**。

## 本轮最有价值的一条：工具故障会被写成"对象的结论"
`gh()` 形参叫 `args`、调用方传字符串 ⇒ `[...字符串]` 把路径拆成单字符，gh 用法错误退出 3，
我的映射读出 `'ERR'`，真查一度打印 `UNVERIFIED :: protection=ERR rulesets=ERR`。
方向上它仍然 fail-safe（没假装绿），但**读数在撒谎**。修法三条：参数归一化、把真实 `rc=` 留在读数里、
非对象 body 不许覆盖 `http` 字段；并加夹具钉子"碎参数读数绝不能被读成 NOT_ENFORCED"。

## 下一轮 P0

> 已按 3.5KB 规则迁至 `07-next-steps.part49.md`（逐字未改）。

