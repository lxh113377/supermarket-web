# 07-next-steps 卷 92 —— 第五十二轮（2026-09-29）台账明细（下二）

> 本卷从卷 91 拆出（V2 4KB 与「贴线 <15% 告警」双口径：91 写满到 3,605B 已进入贴线区，按户内规「新卷到 3.5KB 就开新卷号」另起一号）。

## 挂账（本轮用过一次逃生门之后才发现的）

- **R53-H5 逃生门的"留痕"主张是不成立的**（高，且是本轮我自己踩到的）。`scripts/ci-green-contract.mjs:109`
  印的是「这笔账会留在 CI 与台账里，请自行确保远端为绿」，但同文件**没有任何写盘动作**
  （`grep -nE "writeFileSync|appendFile|ledger" scripts/ci-green-contract.mjs` 实测 0 命中；
  `.githooks/pre-push` 也不 tee 不落盘；全仓 `grep -rln "绕过契约"` 只命中脚本自己）。
  ⇒ 实际后果：`CI_GREEN_REASON` 只活在那一次 push 的 stderr 里，**下次没人能复算"绕过过几次、绕过时基座红在哪"**。
  户内规「Escape hatch needs a meter」在这里是空的，而且门面行还在**声称它有**。
  修法（下一轮，择一）：① 绕过时把 `{utc, base_sha, head_sha, reason, actor}` 追加进 `.ci/escape-hatch.jsonl`
  并让 `verify` 链读它做"最近 N 次绕过是否都留下了远端绿回执"的对账；② 退一步：把门面行改成诚实措辞
  （"本理由不会被持久化，请自行在提交说明里复述"），禁留着"会留在台账里"这句假主张。
  `前提=<可复算>`：上面那条 grep，跑一次即证；本轮的两次理由全文复述在报告 §8·4 与本卷上一节。
