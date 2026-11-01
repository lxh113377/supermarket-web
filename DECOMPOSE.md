# DECOMPOSE — 2026-11-01 香芋压片糖新品 + 白象泡面五口味（r101）

> 目标（goal-2f325980）：新增商品「香芋压片糖」0.5 元；泡面可选口味 红烧/香辣/排骨/肥牛/椒香，
> 零售与帮泡均可选口味，且泡面图片均需替换。**本轮已全部交付并线上复算通过。**

## 分解与回收（三件并行派发 + Lead 自留实施/门禁/部署）

| # | 件 | 归属 | 结果 |
|---|----|------|------|
| A | 图片资产流水线取证 | 子代理 | ⚠️ **未交付**：收尾只回了骨架（A.md 160B，三节全「待填」）。
|   |   |   | 其问题由 Lead 自测补齐（sharp 量尺寸 + verify_images.py 读判据 + images.ts:21 派生 URL），未重派。 |
| B | specOptions 链路 + 新增商品落点 | 子代理 | ✅ 交付 _r101/B.md（32.5KB / 66 处 file:line，判据 B_OK） |
| C | 部署与验证权威命令序列 | 子代理 | ✅ 交付 _r101/C.md（108.9KB / 31 条编号坑 / 20 条禁止项，判据 C_OK） |
| D | 实改：seed + 6 件迁移/回滚 + 图片 + 测试面 + 登记面 | Lead | ✅ 28 文件，提交 24ae9b9 |
| E | 本地门禁 | Lead | ✅ npm run verify 全链 rc=0（46 段）；CI gates 47/47、e2e、deep-gates 全绿 |
| F | 部署 + 线上复算 | Lead | ✅ D1 迁移 3 件 APPLIED → Pages 部署 → push 双发 → 线上逐项核对 |

## 交付内容（提交 24ae9b9，28 files / +346 −86）

- **新商品** order 68「香芋压片糖」¥0.5（snacks，spec 留空 = 供货图无净含量小字）；image 空 ⇒ 走
  src/utils/images.ts:21 派生 /images/68.webp，**零生产代码改动**。
- **五口味** 红烧/香辣/排骨/肥牛/椒香 同时挂到 46(帮泡) 与 47(零售)：seed 内单一常量 BIXIANG_FLAVORS
  供两行共用（分两份字面量就会出现「帮泡有椒香而零售没有」的漂移）；仍只走唯一权威载体 specOptions。
- **图片** 46/47 全换「白象五口味全家福」（1280→800w q80 + sm 400w q75，只下采不放大）；68 用香芋糖供货图。
  旧图留在 gitignore 的 _backup/product-images-src/replaced-4{6,7}-old.webp（回滚点）。
- **迁移** 三正向 + 三配对回滚，登记进 verify-migrate-replay 的 ROLLBACK_INSERT(行集轨)/ROLLBACK_DATA(数据轨)。
  排序实测：两件口味件排在 migrate-taste-baixiang.sql 与 migrate-spec-options.sql 之后（后者末行 NOT IN 清空）。
- **测试面** variants.test.ts（KEEP_FLAVOR_ORDERS +47、五口味逐字同源 + 旧三口味不得残留的反向断言）、
  productDetailVariants（「47 不渲染选择器」按新口径**反转**）、customerPage（角标 3→5）、e2e product-detail（三条）。
  两轴夹具**保留**旧三口味 —— 它钉的是形状不是在售清单（夹具注释写明，避免下轮"顺手同步"把它改废）。

## 本轮额外修掉的两处（都不是放宽判据）

1. **verify-backup-restore 假红**：真备份载回时把健康 dump 报成"截断"（文本 1781 vs 载入 1777 =
   该 dump 里 4 条 INSERT INTO sqlite_sequence；逐表全等、integrity=ok、fk=0、products=67）。
   根因 = 两侧分母不对称（行数侧排除 SYSTEM_TABLES、文本侧没排除）；旧夹具 mini-dumper 过滤 sqlite_% ⇒
   这条腿从第十一轮起从未被真实导出形态测过。修法 = 新增 countBusinessInsertStatements() 同分母，
   并补 ⑦ 正例 + ⑧ 负控（同形态删一条 products 业务行必须仍红）+ CLI 正例，tests 13→16。
2. **日历型红 A11**：d1-remote-usage 回执 @2026-10-24 超 7 天 ⇒ --write 刷新（VERIFIED @11-01）+ 同笔跟 registry。

**我自己走错的一步（记下来）**：中途用 `npx vite build` 出产物，漏了 postbuild（inline-critical-css）⇒
verify:inline-css 红 6 项。红在产物侧不在判据侧，正解 = 部署面一律 `npm run build`。

## 线上复算证据（可复跑）

```
GET  /_health                       → deploy=24ae9b9（== git rev-parse --short HEAD）status/db ok
POST /pub getPublicProducts         → 34 条（+1）；p046 帮泡 2.88 n_flavors=5 [红烧/香辣/排骨/肥牛/椒香]
                                       p047 零售 1.68 n_flavors=5 同一套；p068 香芋压片糖 0.5 在列
HEAD/GET /images/{46,47,68}.webp + sm/ → 200，sha256 前 12 位与本地逐件相等：
   46/47 = 637cb8f8a764(51238B)  68 = f786c95084e7(110056B)  sm/46/47 = 375a56b1aa2c(18412B)  sm/68 = 2be6f45513d9(30040B)
顾客端 lxh113377.github.io          → 同名图字节相同；sw CACHE_VERSION 已变新；
   懒加载 chunk /assets/products-seed-g9tDKD6V.js 内含「香芋压片糖 / 椒香 / 肥牛」
```

## 未取证 / 边界（如实登记，不假装闭环）

- 件 A 未交付（骨架回件）⇒ 其结论来自 Lead 自测，非独立第二意见；图片流水线口径以 verify_images.py 实跑 rc=0 为准。
- 价格未动：线上 p046=2.88 / p047=1.68 与 seed 3.66/1.88 的系统性漂移**本笔刻意不碰**（禁 seed 覆盖线上），
  老大本轮只点名口味与图片，未授权改价 ⇒ 未改，留此说明以免下轮误当遗漏。
- 顾客端「口味可选」的**真机渲染**未跑 Playwright（CI 的 visual job 在收尾时仍在跑；gates/e2e/deep-gates 已绿）。
  组件层与 e2e 判据均已在 CI 通过面内，故不另立待办。
- 旧三口味的历史订单不受影响：splitOrderSpec 对不含「 · 」的老单返回 flavor=""，后台不显示徽标（既有口径）。
