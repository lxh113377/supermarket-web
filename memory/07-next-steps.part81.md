# 07 分卷 81 — 第四十九轮明细（上：演习 / 分面 / 反向半边）

> 换卷理由：主卷已 4,032B（余 64B），按户内"新卷 ≤3,072B、写满 3.5KB 就开下一个卷号"的口径，
> 第四十九轮明细整块 3,402B 超上限 ⇒ 拆成本卷与卷 82 两段，逐字未改、无内容损失。

- **演习（R49-H1）**：分支 `drill/r49-image-gate` 的提交只用 plumbing 造
  （`git cat-file blob` 取 origin/main 的 seed → 插入一行带 `DRILL-R49` 注释的哨兵 `order:9001` →
  `GIT_INDEX_FILE` 临时索引 `read-tree`+`update-index`+`write-tree`+`commit-tree`），
  **工作树与共享索引零改动**；push 后 pre-push 闸对该分支回 `SKIP :: 新建分支（remote_sha 全 0）`（判据设计正确）。
  run `36398941915` #257 = completed/failure，且**唯一**非 success 的步骤就是
  `Product image assets gate (npm run verify:images)`；日志原文
  `[verify-images] FAIL 缺失 1 / 无效 0 / 应有 55 ⇒ 合计 1 件不可交付`（55 = 真 54 + 哨兵 1）。
  ⇒ 两侧都取到：会拦（红因点名到件数）+ 只红该红的（其余步骤全绿）。
- **分面（R49-H4 计划外）**：`load_expected_orders()` 原扫整文件，而 `order:` 有两个语义——
  categories 用它排分类顺序（实测 11 处）、products 用它当图片文件名（实测 54 处，去重仍 54）。
  今天两拨号段重叠 ⇒ 靠去重侥幸不错；给分类加一个超号就会凭空造出一条"缺图"假红。
  正解＝只扫 `export const products` 之后那段；**锚点丢失即 rc=2 并点名，禁退回整文件扫描**。
- **反向半边**：图有、seed 无 = 孤儿。真面实测有 1 张（`55.webp`），而现网 `getPublicProducts` 的 order 最大值正是 55
  ⇒ 它是**线上真在用的资产**，seed 只是种子。所以只 WARN + 点名 + 计数，不判红：判红＝逼后来人删一张真图，
  而"删哪张"是归属决定（判据未经实测开的处方不许写成可复制动作）。
