# 07 分卷 104 —— 第五十六轮读数（E7 落地面与九条红的逐笔对账）

> 主卷只留指针；本卷是"这轮到底改了什么、尺子回了几"的逐笔账，全部取自当次命令输出。

## 入场现状（不是开工，是先数欠账）

- 内层 `git status --porcelain` = **22 项**（18 `M` + 4 `??`），HEAD 停在 `503c71c`（18:51 提交的 R56-H1+H3），
  未提交那批的末次写盘 **22:53**；本轮 00:12 入场实测「15 分钟内零写入 + HEAD 未变」⇒ 判为**中断遗留**而非并发在途。
- `npm run verify` 停在**第 10 关** `verify:contract`：`FAIL /web action 清单与契约一致（33 个）—— 差异：getStockMovements, adjustStock`。
  链是 `&&` 串起来的，所以后面 **23 条腿根本没跑过**——这是本轮最重要的一条读法（详见卷 105 坑 1）。
- 逐腿补齐跑出 **9 条红**：contract / response（rc=2，环境不满足） / registry R3 / roundtrips A9 / limits C2+C4 /
  errors E3+E4 / pii P3 / changelog / typecheck。

## E7 落地面（改完之后盘面长什么样）

- 表 **9 → 10 张**（`stock_movements`，11 列）；`/web` action **31 → 33**（`getStockMovements` 只读 + `adjustStock` 写）；
  流水 kind 四个在册值 `init/sale/void/adjust`，refType 三个 `ledger/order/manual`。
- 不变式「有限库存商品 `SUM(delta) == products.stock`；不限售项（stock=-1）SUM 恒为 0」
  由 `LEDGER_CHECK_SQL` 单点定义 + `verify-backend` 的 **L 组**当场判：L19 故意造一次脱节、L20 还原后复绿 ⇒ 这把尺抓的是真脱节。
- `verify:backend` 收尾读数 **185 通过 / 0 失败**（入场时 184/9）。
- SQL 峰值基线（`--update-sql-baseline` 重生，非手填）：`P:createOrder 6→7`、`A:updateProduct 2→4`、
  `A:batchUpdateProducts 3→5`、`A:deleteOrder 4→6`、`A:updateOrderStatus 4→6`、`A:createProduct 2→3`，
  新键 `A:adjustStock=4`、`A:getStockMovements=2`。
- 每日写行配额登记（`--update-write-quota` 重生）：`P:createOrder 11→21`（峰值仍由 `A:seedReviews=21` 顶着，
  ⇒ 日用量上限 4,761 次/日不变）。
- **两把尺分开才看得见这件事**：`createOrder` 的**语句斜率 1→2**（每件多一条流水 INSERT），而**往返斜率仍是 0**
  （UPDATE 与 INSERT 各自合成一次 batch）。只盯延迟那条尺会把"记账量翻倍"整个读丢。
- 因此 `BATCH_UPDATE_MAX` / `BATCH_UPDATE_CHUNK` **40→20**（口径从 `1+n` 变 `1+2n`：1+2n ≤ 50−9 ⇒ n ≤ 20），
  前端分片与服务端上限必须同笔改，由 `tests/batchChunkContract` 钉住。

> 名册随动的逐本账单在 `07-next-steps.part108.md`。
