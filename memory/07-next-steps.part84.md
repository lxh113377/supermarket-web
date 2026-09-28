# 07 分卷 84 —— 对标第五十轮明细（报告：外层 `deliverables/GitHub开源项目对标分析报告-第五十轮-2026-09-28.md`）

> 轮初锚 `ab9def2`；对标三源（本轮 gh api 取原文）：`sqlalchemy/alembic`、`django/django`、`ai/size-limit`，另 `eslint/eslint` 一条。

## 本轮改了什么（四件，全部带反例）

1. **R50-H1 `verify:images` 的分母接上现网面**。一手实测 @2026-09-28 17:3x：`/pub getPublicProducts` 在售 **25** 条、
   order 含 **55**；`products-seed.ts`（products 段去重）与 `db/seed.sql`（本仓自带解析器解出）都是 **1..54 且逐号相等**
   ⇒ 两个仓内数据源同时落后于 D1，而 `public/images/55.webp` 确实在盘上。上一轮把 55 报成"无主图"是**假归因**：
   它有主（现网在售的「润田矿泉水」，`image` 为空 ⇒ 前端按 `utils/images.ts:21` 回落 `/images/55.webp`），缺的是 seed 条目。
   改法：应有集 = `seed ∪ 现网在售且 image 为空的 order`；现网取不到 ⇒ 只声明盲区（`UNVERIFIED`，seed 面结论与 rc 不变）；
   孤儿按归属拆两类并点名；结论行改为**带面名**（`面=seed 54 ∪ 现网在售 25`）；另加一条自证守卫
   （`expected != seed ∪ live` ⇒ rc=2，防止后来人把分母悄悄换回单面）。夹具 17 条腿，含"摘掉并集那行必须被守卫接管"的变异体。
   盲区如实写明：**下架项的图不在任何可判面内**（/pub 只回 enabled，管理端要 ADMIN_KEY ⇒ 密钥不进 CI/日志）；`sm/` 缩略图也不判。
2. **R50-H2① 写侧幂等成为判据（S7）**。动因：上一轮 `check-doc-commands --update` 三跑三个 sha 是**人肉**发现的。
   探针现在对"写通道确实碰过产物"的候选**同一 flag 连跑两趟**，比较面先归一 ISO 观测时刻再比（`lessons.part214.md` L-2：
   按裸字节比幂等 = 自造一条永不消失的假漂移）。真面全量跑实测：双跑 4 件、全部收敛，读数已进 `docs/judge-side-effects.json`
   （新增 `double_ran` / `idempotent_drift` 两项）。同轮把"没对象"从 PASS 改成 UNVERIFIED 相位（rc=2，不与"判出违规"的 1 混写）。
