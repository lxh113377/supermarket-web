# 07 分卷 part180 — 正大无花果：生产变更与线上回执（承 part179）

> 建卷理由：part179 记的是本轮的**口径与本机实测**，本卷记**已执行的生产变更与线上回执**；
> 两者合写会顶到 3.5KB 贴线（V3 口径「新卷写满就开下一个卷号，别压措辞」），故分卷。

## 2026-10-24 — 生产变更（chaoshi-web-deploy §4，一律走账目表）

- ① `d1 export supermarket --remote` → `_backup/d1-pre-2026-10-24-zhengda-wuhuaguo.sql`（2,340,673B），
  `verify-backup-restore.mjs` 载回断言 rc=0：1468 行 / 14 表、integrity=ok、fk=0、products=64。
- ② `migrate.mjs status --remote` = 1 待应用 → `apply --remote --yes` APPLIED 1 件（账目表已记 checksum）。
- ③ 线上复验：`/pub getPublicProducts` 35 条含 `p065 正大无花果 ¥0.5 enabled=true sub=[snacks]`；
  `/pub getCatalogOrders` 65 条含 order 65（`needsLocalImage=true`）；管理端 `/web getProducts` 65 条在列；
  两图 pages.dev 与 github.io 均 `200 image/webp` 且字节与本地一致（21,920B / 6,378B）。
- ④ CI（head `3d8ae88`）gates / e2e / e2e-cloud-stub / visual / deploy 全 success；`/_health` 回 `db=ok`；
  `npm run smoke` 四项全 PASS（ADMIN_KEY 由 `.dev.vars` 现取，不落任何日志/提交）。
- 回滚 = `db/rollback-add-product-zhengda-wuhuaguo.sql`（`_id` + `"order"` 双条件删本行）。

## 与本轮无关的一处红（如实记，不折算成本轮缺陷）

- `check-d1-roundtrips` 的 **A11** 在 `3d8ae88` 那次 CI 判红：红因是 committed 的
  `docs/d1-remote-usage.json` 停在 2026-10-17（`REMOTE_MAX_AGE_DAYS=7` 保险丝跨线），与本笔内容无关。
- `ci-deep.yml` 的 `receipt-refresh` job 刷不动 —— CI 侧 CF 令牌对该账户无 GraphQL 读权限
  （run 38483138112 同形，workflow 注释里已具名）。按 `.ci/contract.json` 的 `receiptRecovery` 口径，
  该读数由并行会话那笔 `04e3c44` 一并刷新入库并同步登记值 ⇒ 基座回绿。
- 教训：**本笔未动该读数**（越界即把他人改动混进自己的提交面），也没有改阈值或绕判据求绿。
  下次遇到「日期驱动的过期红」，先查在册恢复通道能不能名正言顺走，而不是削尺。
