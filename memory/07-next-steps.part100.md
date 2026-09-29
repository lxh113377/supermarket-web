# 07 分卷 100 —— 第五十五轮登记的 R56 四项（自主卷分卷 99 迁出）

## 下一轮（R56）登记

- **R56-H1（高）**：给 `report:live-perf` **立阈值**，前提是跨日再采一次。本轮只有一天一次分布，
  `docs/live-perf.json` 的 `thresholds` 因此写 `null`。动作＝对同一页再跑 3 份样本（换一天），
  比较两日中位数的差；有了「应过侧最低分布」和「应拒侧最高分布」两侧才配写 budget（户内 M4：阈值必须能失败）。
  前提=产出 `.lighthouse/<tag>-d2-s*.json` 且 `report:live-perf` 能把两日分开印；取不到就写 `未实测 + 取证路径`，
  禁止再拿「样本不足」当这一维的结论（M5⑫ 的同一形态会在下一轮复发）。
- **R56-H2（中）**：既存 **11 件裸 CLI 腿**逐件清偿（名单由 `npm run verify:cli-legs` 每次现印，不手抄）。
  位点最密的是 `cliEntrypoints.test.js`（timeout 位点 13）。**降欠账与降 `docs/cli-legs.json` 的 `unguardedMax` 必须同一笔**。
- **R56-H3（中）**：`report:live-perf` 现在**完全不进任何自动面**（本机手动 + 只读产物）。缺的不是接线，是
  "取数节奏"：建议把「每轮 savepoint 顺带跑一次 Lighthouse（至少管理端 1 页 ×3 份）」写进 `chaoshi-web-deploy`
  或 savepoint 链，否则这条腿会因为没人喂样本而长期 UNVERIFIED。前提=有一轮真的这样做过并留下 fetchTime 证据。
- **R56-H4（低）**：`.editorconfig` 仍只被 E5 判"与 `.gitattributes` 同向"，**没判过它自己被编辑器遵守**（R54-H4 原样挂账）。
  真要闭环要靠格式化器当唯一写手（prettier/biome），那是另一件事。
- **不变的他人/用户侧项**：`D1 Daily Backup` 缺 `CF_D1_BACKUP_TOKEN` / `BACKUP_PASSPHRASE` 的**既定红**挂到 2026-10-12；
  下架商品断网图面记 UNVERIFIED；模拟层⇄真实 D1 语义等价无第二通道（R53-H2/R54 起挂账，未动）。
