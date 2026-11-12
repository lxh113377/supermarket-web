# 07-next-steps 逐字迁卷 — 2026-11-13 商品面变更（r104）

> 迁出原因 = 主卷按增量归档体例留指针，详细口径逐字迁本卷；主卷保持 ≤4096B（超限 CI memory-volume V2 判红）。

## 决策（Lead 自主拍板，#48/#31；P0.19 用户指令高于一切）
- order=71 / _id=p071：现网实测 getCatalogOrders 全集 70 条、maxOrder=70、**无跳号**、order 71 空闲、无重名 ⇒ 追加末位。
- name=脉动 / spec=600ml / price=3.88：老大口述「脉动600ml 3.88元」逐字落库；图上净含量小字亦为 600ml（一致）。
- subcategories=['vitamin']：图上卖点「3D源动力 / 多种维生素」；比照维生素面 p014 水溶c100 与 p015 维他命 形态。
  未选 tea/sweet/energy：它不是茶、不是含乳甜饮、也不属功能提神（脉动是维生素饮料，不是能量饮料）。
- image 留空 ⇒ 调用点走 productImageUrl(order) 派生 /images/71.webp，零生产代码改动（r101/r102/r103 同链）。
- 图片：源图 = 老大本轮附件（C:/Users/37533/Desktop/dd90d0d517610d3ef26676af7e32160e.jpg，800×800 JPEG 138315B），
  sharp 出 800 q80 / 400 q75 双尺寸（只下采不放大）；体积 104860B / 31826B（约为前例 1.9×，广告图文字与水汽细节密度高，
  q 口径未动）。源图归档 _backup/product-images-src/r104-dongmai-01.jpg（gitignore，sha256 2083b60d…3848 与源逐字节相同）。

## 写面分工（Lead 单干；r104 卡由子代理只读取证 + 子代理出图，结论件 Lead 自留）
| 面 | 文件 | 状态 |
|---|---|---|
| 真相源 | src/data/products-seed.ts | 末行追加 order 71 |
| 种子库 | db/seed.sql | node db/gen-seed.mjs 重生成（69→70 行商品） |
| 生产库 | db/migrate-add-product-dongmai.sql + rollback 配对 | 行集轨 INSERT OR IGNORE / 双条件 DELETE |
| 门禁登记 | scripts/verify-migrate-replay.mjs ROLLBACK_INSERT | 具名登记 rollback-add-product-dongmai.sql |
| 治理册 | docs/governance/registry.json facts.seedCatalog 69→70 + measuredAt | 同步 |
| 图片 | public/images/71.webp + public/images/sm/71.webp | 104860B / 31826B 真 WebP |
| 台账 | CHANGELOG.md / memory/07-next-steps.md / 本卷 / DECOMPOSE.md | 同步 |
| 会话前既有脏文件（#40 禁并入） | .ci/escape-hatch.jsonl / index.html / chip-crop-meta.json / chip-shot.png / nul | 明确排除 |
