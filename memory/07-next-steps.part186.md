# 07 分卷 186 —— 第 89 轮实操：逃生门 + 线上验证口径（承 part185）

> 本卷只记「怎么做」，立规与双红教训在 part185。

## 逃生门实操（本仓既有路径，不是绕过捷径）

- 预推钩 `.githooks/pre-push` → `scripts/ci-green-contract.mjs`：基线 run **未出结论或红**时一律拦推。
  修复件要上去 ⇒ 显式 `CI_GREEN_SKIP=1 CI_GREEN_REASON="<实证据>"` 再 push，
  脚本自动往 `.ci/escape-hatch.jsonl` 追加一行（utc/base_sha/head_sha/branch/reason/actor），
  **台账行随后补提交**，`npm run verify:escape-hatch` 核 C10 闭环。
  本轮实测：base 2108f96 → head b3e058f，reason 写清「基线红因 = order-confirm 打烊态 2.2:1，本笔即修复件」。
- **并行会话同工作树会互相推进 main**：本轮 origin 被推到 2108f96（含 141a538 密钥禁令）、
  工作树还出现他人未提交的 CategoryPage.tsx/redesign.css。推送前**必先看真实 origin/main**，
  且 commit 只用显式文件清单（他人改动不并入）。

## 线上验证口径（#40 第三段"可复算证据"）

- 管理端：`curl https://supermarket-web.pages.dev/_health` → `deploy=<sha>`；
  产物标记复核 = 抓 index.html 的 assets 逐个 fetch 找 `gate-hall`/`intake-sheet`/`receipt-paper`/`stage-frame`。
- 顾客端：`https://lxh113377.github.io/` 同法查 markers。
- 一致性：`node scripts/check-live-shape.mjs`（L3 deploy ⇄ 本地 HEAD；STALE = 本地方案未推完）。
- 本轮实测回执：CI run 40213196252 `completed/success` 六 job 全绿（含 deploy）⇒ `_health` 回 `deploy=b3e058f`、双端 markers 四中。

## 下一轮候选

- 把上述验证段脚本化（`scripts/verify-deploy.mjs`：双端 markers + _health + live-shape 一把跑），免得每轮手写 fetch 探针。
- 视觉/交互八维面已在前四轮收官；本轮起转入「交付纪律 + 运维自动化」主线。
