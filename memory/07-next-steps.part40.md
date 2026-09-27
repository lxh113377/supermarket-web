# 07 分卷 40 —— 对标第二十八轮（2026-09-27）：把"机制未归因"还成"已归因"

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第二十八轮-2026-09-27.md`。
> 回滚锚 `642410c`；备份 `/c/_sm_backups/r28-start-642410c.bundle`。代码提交 `9fe6baa`。

## 结案的账（上一轮自己挂的）
C1 逐 action SQL 峰值"随机 +1"的根因找到了：`functions/lib/security.js:117` 的审计保留裁剪以 **5% 概率**
在写审计时顺带执行 `DELETE FROM security_events WHERE ts < datetime('now','-90 days')`（Pages 无 cron ⇒ 写时采样，
生产设计本身是对的）。这条摊销语句被记到"恰好触发它的 action"头上 ⇒ 11/30 个 action 轮换 +1。
判别证据：抖的是归属（总语句数几乎不变、`createProduct=3` 与 `=2` 的轮次平均总语句 81.7 vs 82.0）。

## 口径变更（别再退回旧做法）
- 测量口径改，不给指标加容差：`createMeteredD1(db, { classify })` 把摊销语句立到 `amortized:*` 桶，
  **不参与逐 action 峰值回归**，只 INFO 报本轮累计次数。
- 上一轮的两项临时措施**已收回**：噪声带 1→撤销、基线采样 5→1（实测 6 轮单采样逐键全等）。
- 常驻守护：`tests/sqlAttribution.test.js`（非摊销键必须逐键相等；`samples` 不许被悄悄抬起；概率量不当硬断言）。
- 教训一句话：**容差是让闸变绿的止痛药，同时把真回归一起遮掉**；写"未归因"时必须下一轮结办，不能当终点。

## 本轮同时推进的契约覆盖
补 `verifyKey / addReview / deleteReview / getDashboardStats` 四条真实成功形状 ⇒ 响应契约覆盖 27/39 → **31/39**、
具名缺口 12 → **8**。新路径先被 C1 判"基线缺 action（新增调用路径？确认后入册）"，人工核过峰值合理
（0 / 2 / 2 / 3 条）后才写基线 —— 这个顺序要保留。

## 下一轮 P0
1. R28-M3：`verify:response` 与 `npm run verify` 里的 verify-backend 目前各跑一次全链 ⇒ 复用一次输出；
   但"判据路径真跑"那一腿不能被复用省掉。
2. R28-M1：剩余 8 条响应缺口（优先 `createSubmission` 带图、`aiChat` fetch stub），每轮 2~3 条。
3. R28-L1（连续两轮被挤掉）：零分母普查扩到 `report:*`；三类覆盖数打进门面行。
4. R28-M2（**本轮按"挂过一轮的账每轮重跑"再验**）：`gh api .../branches/main/protection` → 404 `Branch not protected`，
   仍未开启；需用户在 GitHub 分支保护里勾 Required checks（agent 不擅改共享设置）。

## 本轮两处自失手（同一族，形态台账）
- 过 shell 写正则 ⇒ `\s` 被吞、`\b` 成退格符，脚本语法错 ⇒ 含反斜杠的内容一律走编辑工具；能用子串判断就别用正则。
- 新探针变量与已有 `rev` 重名 ⇒ 顶层重复声明（"splice 后必查 def 重名"又忘了一次，靠 `node --check` 抓到）。
