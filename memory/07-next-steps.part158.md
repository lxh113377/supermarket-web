# 07-next-steps.part158 — 第七十三轮（对标轴：`python-jsonschema/check-jsonschema`）

四项全部落在交付面/判据面（业务面第 11 连零新增 = 有意取舍，不许写成优势）。
逐项动机、实现与验证在 `CHANGELOG.md` 的 2026-10-09 节与第七十三轮报告，本卷只留指针与教训。

- **I-73-1（高）** 拆自伤串行：`ci.yml` 新增 `browser-install` 预热 job，三个 Playwright job 改
  `needs: [browser-install]`，删三处 job 级 `ci-browser-install` 组。
  **教训**：`concurrency` 是互斥语义（新请求挤掉旧等待请求），`needs` 才是先后语义；
  同 run 内多 job 共用一个组 = 当场取消其中一个。第 72 轮就是这么把 `deploy` 掐成 skipped 的。
- **I-73-2（高）** `ci-status.mjs` 补 cancelled/timed_out/落桶外 三桶 + 总数守恒 + 每 run 一行「部署判定」；
  `check-delivery-claims` 加**结论自相矛盾**腿（同行 run 终态非 success 却写 deploy success ⇒ 判红）。
- **I-73-3（中）** D7 落地凭据腿 `DONE_STATE_RE` + `CREDENTIAL_FROM_UTC`；4 张登记册 `why` 收敛到
  `lib/registry-reason.mjs`（R5 早写了"必须可证伪、共用一份实现"，此前无人执行）。
- **I-73-4（中）** 有界性检查遍历 `allWorkflows`（逮到 `dispatch.yml:dispatch` 第 5 个缺口）；
  `baseOf` 按 token 剥 flag；gate-parity 分母 `24 → 35`（补 `ci-deep.yml:deep-gates`、排 advisory step）；
  `check:contract-diff` / `check:gate-parity` 接进 `ci.yml` + 写进既有 `REQUIRED_STEPS`。

> 后半（两条新时态面 / 未修项 / 并发竞态留痕）→ `07-next-steps.part160.md`（V4 出生即贴线拆的，非内容压缩）。
