# 07-next-steps.part166 — 第七十五轮三笔提交的上线回执（逐字记录，别在主卷复述）

- 第一笔 `8f9e84e` ⇒ CI run `39042435888` **completed/failure**：唯一失败 step = 本轮新立的 `SBOM reproducibility gate`。
  读数「在册 246｜同一项 239｜只在当次 13｜只在册 7」，差集全是 @esbuild/@rollup/sharp 的 win32 ⇄ linux 变体
  ⇒ `npm sbom` 按本机平台展开 optional 依赖，清单随生成机器而变就不是可复现证据。deploy=skipped。
- 第二笔 `ef56f1f` ⇒ CI run `39078182648` **completed/success**，六 job 全绿（gates 43 步 / browser-install 10 /
  e2e 12 / e2e-cloud-stub 12 / visual 12 / deploy 9）；`check-live-shape` L3 线上 `deploy=ef56f1f` == HEAD、漂移 0；
  同 HEAD 另有 ci-deep `39078182638`、dispatch `39078182626`、release-parity `39078346797` 全 success。
  推送通道 = `CI_GREEN_SKIP`（基线是下过判决的 failure，恢复通道与读数刷新通道按设计皆拒），
  台账追加 1 行 base=8f9e84e→head=ef56f1f，该行由第三笔入库。远端终态：`--update-remote` ⇒ 33 条（GREEN 16/CANCELLED 8/RED 9），C9 未覆盖 0。
- 第三笔 = 回执入库（HANDOFF 实测戳重取 + 报告 §7.3 + 台账 + escape-hatch-remote + doc-commands）。
- **四处自伤缺陷（`npm test` 当场抓到，处置都是提预算/补零分母，不改判据）**：sbom 夹具 spawnSync 180s>天花板 130s ⇒ 120s；
  check-licenses 探针腿并行下 SIGTERM ⇒ 预算 20s→60s、it() 30s→70s；verify:a11y 零分母第二态（src 全 0 字节仍打印 scanned 50/rc=0）⇒ 全空 rc=2；
  SBOM 落盘不再保留平台专属件，口径进产物 `properties.chaoshi:sbom-scope`。
- **下一轮 P0**：I-75-6 跨日性能批次给两格越线定性（admin/t1355 SI 8104.8>7000、customer/t2359 SRT 468>450）；
  I-75-7 CF 备份凭据（真·用户侧，cron WARN 至 2026-11-07）。

## 补记（同轮）：报告 §2.2「对侧主张的取证边界」是怎么逼出来的

- 我在 §1 写了「saleor 用 `@axe-core/playwright`」，本轮去取证才发现是**我自己推的**：
  `raw .../saleor/main/package.json`（506B）无 axe 行，`gh api search/code?q=repo:saleor/saleor+axe-core` ⇒ total_count=0。
  同类：§2 转引的「medusa 40 模块 / saleor 34 app」实测是 `packages/modules` 36 个目录 / `saleor/` 32 个顶层目录，
  **「40」与「34」查无实测出处** ⇒ 本轮起禁用该数。
- **两条口径（写进报告 §2.2，下一轮沿用）**：
  ① 对侧主张必须带**可复算取证通道**，取不到就记 `—`，既不折算成「没有」也不折算成「有」（与 §2 对侧列同口径）；
  ② **只报实测目录数，不再给「真模块≈N」这类估算** —— 我第一版更正时同时写了「≈34」和「≈33」，
     自己造出第二个真相源，被 V5/一事实一判的既有规矩打回。估算没有出处就等于没有。
- 同轮第三笔 `69e8fb2` ⇒ CI run `39079088898` `completed/success`（六 job 全绿含 deploy 9 步），
  线上 `deploy=69e8fb2` == HEAD == 远端 main，漂移 0；这笔是**正常推送**（ci-green GREEN，未用通道、未新增绕过）。

## 自咬四（同轮，外层报告自指行）→ 逐字迁至 `07-next-steps.part167.md`（治 V2 超限 4433B）
