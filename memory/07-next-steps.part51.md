## 一、第三十四轮在册事实（2026-09-27）

- **挂 5 轮的 `/pub aiChat` 形状关闭**：`RESPONSE_GAPS` 1 → **0 条**，契约 41 → **42 条**（`keysAlways =
  content/conversationId/source`，`calls: 2`）。关掉它的不是"补个桩"，是**把上一轮自己写的理由反做了一遍**：
  那句"离线跑不出、需 fetch stub"三处不成立（规则模式本来不联网；Dify 模式按 `functions/lib/dify.js:107-109`
  的解析字段打桩即可）。三条新探针在 `verify-backend` 里跑真 handler，第 3 条记录
  `POST https://dify.invalid/v1/chat-messages` 恰 1 次 ⇒ 能区分"分支没跑到"与"跑了但没出网"。
- **`reads-secrets` 扩类以「改判」关闭（不扩）**：人口数字先出——候选面 40 个 `.mjs`，`.dev.vars` 命中 **0**，
  `process.env.*` 命中 **11**（其中 **7** 已被 `network-fetch`/`gh-cli`/`wrangler`/`d1-execute` 覆盖），
  剩 **4** 读的是 `CI`/`NODE_ENV`/输出路径类变量而非凭据 ⇒ 新标签零区分度。**否证数字留在册上，防止下期有人重提。**
- **SQL 基线 41 → 43 键**：新增 `P:aiChat`（人工核峰值 3，同族写路径 `addPublicReview=3`/`createSubmission=3`）
  与 `amortized:audit-retention-purge`。⚠️ 后者是 **R28 改动的欠同步**，本轮才补上 ⇒ 见 R35-H1。
- **本轮最大产出不是功能，是"整链复验抓到自己人脸上的两处红"**（`VERIFY_RC=1`，`2 failed | 1171 passed`）：
  ① V3 反例的变异体 `gaps: {}` 在缺口表被清零后**与真实态逐字节相同** ⇒ 反例退化成正向；
  ② "抽掉 GH_TOKEN"用非全局 `replace`，本轮新增的第二个 `GH_TOKEN` 步骤让它只删第一处 ⇒ 抽完还剩。
  两条同族：**夹具的成立前提依赖人口非空 / 单点出现，人口一变就静默失去牙齿**。
  修法是让变异体**自造前提**并前后各加计数断言（"变异前 0 命中""抽完还剩"都直接判红），不是放宽断言。
  顺手查出**判据本体**第三个缺陷：catalog 的 `continue-on-error` 检查按整文件耦合，
  且正则 `[ \t]*$` 收尾 ⇒ **行尾加一句注释就免检**；已改为按 step 分块定标。
- 修完复验：`VERIFY_RC=0`、`Test Files 89`、`Tests 1173 passed (1173)`；`cli-entrypoints 11/11`
  （分母 31 / 带风险 15 / 缺口 11）、`memory-volume 判 58 卷 超限 0`。

