# 07-next-steps 卷 90 —— 第五十二轮（2026-09-29）台账明细

> 本卷是主卷「第五十二轮」那节的后一半（V4 出生余量判据要求的拆法：新卷一次性写满会当场判红）。

## 本轮读数（全部为当次实测，禁下轮当现值引用）

- 三面并集真面：`[verify-images] OK 主图 55/55 + 缩略图 55/55 全部有效（面=seed 54 ∪ 在售 22 ∪ 目录 55）`；
  关掉现网面（seed-only）则印 `sm 反向半边：1 件缩略图不在应有集内（55）` ⇒ 同一件图在两种取数面下**结论不同**，
  这正是"覆盖面必须印出来"的理由。
- 目录全集面构成：55 = 在售 22 + 下架 33；`seed ∪ 在售` 与全集的**边际集合=空集**（今天）⇒
  R51-H1 的价值是"结构上不再盲"，不是"多抓了 N 件"；下轮不得把 0 读成"没用"，也不得据此拆掉这条面。
- 分项预算真面：62 件产物、登记 10 条（0 死条目）、判 10 / 未登记 52、已判体积 256.2/370.5KB gz、
  最大未登记 `tooltip=7.2KB`。命令 `node scripts/report-item-budgets.mjs --dist <dir>`。
- 夹具：`tests/verifyImages.test.js` 25→27 腿、`tests/itemBudgets.test.js` 7 腿；全链 `npm run verify` rc=0（109 文件）。

## 本轮挂账（R53，含 `前提=<可复算命令>`）

- **R53-H2 SQL 语义对账缺第二条通道**：`verify-backend` 用 node:sqlite 模拟 D1，"夹具绿≠线上绿"的老问题。
  本轮只测到"代码实际用到的特性在 node:sqlite 3.53.0 下都能跑"，**没有**独立通道证明两侧语义相同。
  一手噪声（不得当缺陷上报）：我自己的探针把多语句 SQL 在第一个 `;` 处截断，产出的 STRICT / WITHOUT ROWID
  "报错"是探针的错，不是桩的错。`前提=` 需要一次 `wrangler d1 execute supermarket --remote --read-only`
  性质的只读探针（属带风险入口，`verify:entrypoints` 的风险分类禁止 spawn ⇒ 只能人工执行并记时刻）。
- **R53-H3 工作树行尾与属性表不一致**：`git ls-files --eol` 实测 `scripts/verify_images.py` = `i/lf w/crlf
  attr/text eol=lf`（blob 侧已干净，工作树副本仍 CRLF，因未重新检出）。`verify:eol` 的 E4 只报不判，
  所以今天全绿。处置＝下一轮对该批件做一次 `git checkout --`（**先确认无在途改动**）或随 renormalize 一并处理；
  本轮未做是为了不把 9 行的真实改动混进 400+ 行的行尾翻改（上一轮踩过）。

> 后半（R51-H5 继承、fresh-dir 坑、用户侧不变项）在**卷 91**。
