# 07 分卷 44（由 07-next-steps.part35.md 拆出，逐字未改）

- [ ] **N2 `ServiceFormPage` 图片 ≤5 张，但服务端 `createSubmission` 不查条数** ⇒ 全链唯一 cap 在浏览器里，直接 POST /pub 可塞任意张（受 2MB/张 与 D1 语句体积间接约束）。要么服务端补条数 cap（则须加新 `errorCode` 并入册），要么在登记册把它定性为"仅前端展示约定"。
- [ ] **M5 图片 base64 与 D1 单语句 100KB 对齐（承十七轮，需老大点头）**：本轮新增事实 —— 范围不止"评价 + 付款截图"两处，`ServiceFormPage` 是第三个入口（原图 10MB 门槛 / 压缩后 2MB 上限，服务端同为 2MB）。定值前须先决定"图片走 base64 入 D1 还是走 R2 桶"。
- [ ] **N4 审计表加 `errorCode` 列**：`logSecurityEvent` 现在只有 ok/fail 二值，失败原因进了响应却没进审计。需一次 D1 迁移 ⇒ 新决策点，未擅动。
- [ ] **N1 两项既有红灯**：`verify:restore`（2 项）与 `check:backup-liveness` 需 `CF_D1_BACKUP_TOKEN`。**未设 `BACKUP_SKIP_OK` 绕过、未降格成"已核验"** —— 护栏拦下来就如实报拦在哪。
- [ ] **M7/M8 未变**：档位真实值需 CF 凭据；上限运行时自检待做。
- [ ] 需人不变项未变（`CF_D1_BACKUP_TOKEN` / `ORDER_WEBHOOK_URL` / K3 目视 / D2 49 单 / R2 桶 / order 41 / `adhoc-rename-order20.sql`）。
- [ ] 取证欠账：同栈（Pages Functions + D1）**未找到**"带机器可读错误码"的公开样板 ⇒ 本轮明写 NOT STATED，没把它当成"业界都这么做"的依据。
