# 07 分卷 part200 — 2026-11-01 判据自修与踩坑（备份载回假红 / 构建链走短 / 日历型红）

> 从 part199 拆出（4096B 硬上限，正解是迁卷不是压措辞）。同轮商品面变更本体见 part199。

## 一、verify-backup-restore 把健康备份判成截断（分母不对称）

- **verify-backup-restore 假红（判据自身坏了）**：真 dump 载回时报「载入行数 1777 ≠ 文本 INSERT 1781 ⇒ 备份被截断」。
  一手取证：差值 4 = 该 dump 里 4 条 `INSERT INTO sqlite_sequence`；逐表 text⇄loaded 全等、integrity=ok、fk=0、products=67
  ⇒ 备份健康，红因是**分母不对称**（行数侧排除 SYSTEM_TABLES、文本侧没排除）。旧夹具 mini-dumper 过滤 `sqlite_%`，
  所以这条腿从第十一轮起没被真实导出形态测过。修法 = 新增 `countBusinessInsertStatements()` 同分母 + 三条新用例
  （⑦ 正例 / ⑧ 负控：删一条 products 业务行必须仍红 / CLI 正例）。判据自修必带负控，否则「修绿」与「修坏」不可分。
- **我自己走短了构建链**：`npx vite build` 不跑 `postbuild` ⇒ dist 里 CSS 未内联，`verify:inline-css` 红 6 项。
  正解 = 部署面一律 `npm run build`（prebuild=lint + postbuild=inline-critical-css）。产物红不是判据红。




## 二、日历型红：A11 回执过期

- `check-d1-roundtrips` 的 A11 因 `docs/d1-remote-usage.json` 回执 @2026-10-24 超 7 天判红（与本次改动无关）。
- 跑 `node scripts/check-d1-remote-usage.mjs --write` 刷新（VERIFIED @2026-11-01T13:57Z，8 通过/0 失败），
  并**同笔**同步 registry 的 `d1Usage` 三项（198/17321/2026-10-24 → 68/4643/2026-11-01）。
  该件头注自己警告过：2026-10-24 那次只写回执没跟册 ⇒ verify 链第 36 步判红。今天照做，未复发。

## 三、可复用的两条口径（本轮沉淀）

1. **判据自修必带负控**：修"假红"时，除正例外必须补一条"真缺陷照样红"的负控，否则「修绿」与「把判据修废」不可分。
   本轮形态 = ⑦ 正例（带 sqlite_sequence 的 dump 判可恢复）+ ⑧ 负控（同形态删一条 products 业务行仍判"≠ 文本 INSERT 数"）。
2. **部署面构建一律 `npm run build`**：`npx vite build` 跳过 prebuild/postbuild，产物缺内联首屏 CSS ⇒ `verify:inline-css` 红。
   红在产物侧 = 我的流程错，不是判据错；判据红先分这两类再动手。
