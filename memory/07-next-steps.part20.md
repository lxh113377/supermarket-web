# 07-next-steps.part20.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [ ] **webhook 真实端点验收（需人）**：同上一轮，`ORDER_WEBHOOK_URL` 仍未配 ⇒ 线上 no-op。
- [ ] 不变项：K3 线上目视（生产密钥）、D2 49 单处置、R2 桶、order 41 生产行、`.dev.vars` 的 ADMIN_KEY 是否新值、28/55 口径已由 `report:catalog` 接管（不再靠人记）。
- [ ] 维持不改：N4 执行模型、CoC、diff-cover、zizmor/semgrep、分支保护即代码、vite 聚合必检 job、changesets、投递台账、pgbackrest/restic/mattermost 三类重量级方案。

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十一轮-2026-09-26.md`；备份 `_backup/pre-round11-2026-09-26/pre-round11.bundle`。

- **已落地**：`scripts/verify-backup-restore.mjs`（dump 载进一次性内存 SQLite，断 6 条：载入不抛错 / `integrity_check=ok` / `foreign_key_check` 零行 / 表集与 `db/schema.sql` **双向**对账 / `Σ行数==文本 INSERT 语句数` / `products` 非空；`0/1/2` 三档退出码，**文件缺失是 `2` 不是 `0`**）+ 接进 `d1-backup.yml` 且**排在上传之前**（顺序由 `ciWorkflow.test.ts` 新组钉住）；`check-csp-static.mjs` + `npm run verify:csp`（进链 + CI step + `REQUIRED_STEPS` 钉名）；`check-catalog-facts.mjs`（硬不变量阻断 / 漂移只报告 / 取不到 ⇒ `exit 2`）接在 `Uptime` 末尾 `continue-on-error: true`；色块死轴（`kind:'color'`/`swatch`）连同恒真三元、空转断言、`test.skip` 一起删净（视觉门禁 15+1skip → **16 全通过**）；`docs/ci-triage-runbook.md` 新增 §8（恢复演练 + 手动恢复照抄步骤）。
- **数据口径当场答清（此前靠口述）**：`db/seed.sql` **54 行**、线上公开目录 **28 条**、D1 全库 **55 行**；漂移＝只在 seed 27 项 / 只在线上 1 项 / **价格不同 22 项** / 同名重复 seed 3 与线上 3。漂移**不判红**（生产数据本会漂），但自此每日可见。
- **【推翻级】本轮最硬的方法账**：我先拿 markup `style=` 属性做探针测出"被拦"，据此断言 React 那 8 处内联样式线上全死并已改掉 5 个文件；复测三种机制才看清 `setAttribute('style')` 被拦、而 `el.style.setProperty` / `el.style.x=`（**React 走的正是后者**）放行 ⇒ 全量回滚，只留立得住的三件（静态 HTML 门禁 / 真实内容上的 CSSOM 判据 / 把"被拦"那一半移出应用 spec —— 否则 `watchErrors.assertClean()` 会把我的探针报成产品 bug，第一版就是这么红的）。**教训：探针必须打在"被审对象实际走的那条路径"上；测错机制＝得出相反结论。**
- **两处判据自我纠偏（各留常驻夹具）**：① 首版按"行首 INSERT"计数 ⇒ 值里含该字样或一行两条语句即失真 ⇒ 改语句级切分（尊重引号与 `--` 注释）；② 首版拿 api 形状判 seed ⇒ 54 行全红（DB 里 `subcategories` 本就是未解码 JSON 文本）⇒ `'api'/'db'` 两形状分判（混用会同时造成假红与漏判）。
- **一次自己造的执行事故**：批量删 `kind: 'spec', ` 时对某一行用了"整行删除"，把同一行的 `id: 'flavor', name: '口味',` 一起带走 ⇒ 一条用例红。**删子串禁用整行删除**；改完必须跑该文件用例，只看 `tsc` 不算过。

## 2026-09-26 — 对标第十轮（通知类副作用 + 判据拆纯函数；分支 → PR 流程首次）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第十轮-2026-09-26.md`；备份 `_backup/pre-round10-2026-09-26/pre-round10.bundle`。
