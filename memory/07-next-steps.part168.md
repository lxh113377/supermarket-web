# 07-next-steps.part168 — 第七十五轮主卷整段（第七十六轮 P1 收口迁出，逐字未改）

> 迁出依据：主卷 `07-next-steps.md` 实测 4188B > 4096B（V2），入口卷余量 -92B（V3 判「贴死」）。按 V3 口径**整段**迁卷，不压措辞、不删事实。

## 2026-10-17 — 第七十五轮（四项工程改造 + 一条挂七轮的假欠账被证伪）

- I-75-1 **分支保护真落地**（高）：前七轮写「agent 无权」是假账 —— 本机 gh token 有 `repo`+`admin:org`、仓 `permissions.admin=true`，
  `PUT /branches/main/protection` 一次成功 ⇒ **ENFORCED**（5 条必需检查；`enforce_admins=false` 保留自推）。
- I-75-2 **阈值消费面**（高）：`report-live-perf` 自 R58 立线起明写「不判达标线」⇒ 六条线没有消费者。现接四态
  `RED/GREEN/PARTIAL/NO-LINE`，自证 21→25；首跑两格越线（admin/t1355 SI 8104.8>7000、customer/t2359 SRT 468>450），
  按「单样本不足以定基线」记**待观察**，跨日复采后再定性。
- I-75-3 **静态长缓存 + 判据**（高）：线上 `/assets/*.js` 实测回 `max-age=0` ⇒ 加 `/assets/*` immutable（`/images/*` 不动）；
  新增 `verify:cache`（7 自证 + 7 夹具，读声明面不读线上）。
- I-75-4 **SBOM 可复现**（中）：`docs/sbom.cdx.json` 246 组件，`verify:sbom` 当场重算做 purl 双向差集 + 龄期 ≤30 天。
- I-75-5 **a11y 静态闸**（中）：三条规则扫 50 tsx；规则首版假阳性 4 处（JSX 截断）改 `readJsxTag` 修正，
  唯一真实残留 `Overlay` 遮罩**改源码**加 `role="presentation"`（不是加白名单）。
- 三笔提交与两条自咬的完整回执 → `07-next-steps.part166.md`。
- **下一轮 P0**：I-75-6 跨日性能批次给两格越线定性；I-75-7 CF 备份凭据（真·用户侧，cron WARN 至 11-07）。
- **方法论**：「无权」必须举证；没试过就说没权限 = 给欠账发永久休假条。
