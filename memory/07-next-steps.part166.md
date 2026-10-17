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
