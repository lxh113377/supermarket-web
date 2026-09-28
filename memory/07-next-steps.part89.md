# 07-next-steps 卷 89 —— 第五十一轮（2026-09-29）台账明细（下）

> 本卷是卷 88 的后半（V4 出生余量判据逼出来的拆卷，2026-09-29）。上一段在卷 88。

> 部署完成后复算：`curl -s -X POST https://supermarket-web.pages.dev/pub -H 'Content-Type: application/json' -d '{"action":"getCatalogOrders"}'`
> 应回 `{code:0,data:[{order,needsLocalImage}...]}`；届时门禁输出的「现网目录全集需本地件 N 号」必须 >0，
> 否则说明投影被写成空集。判据：拿一条真下架商品删掉它的图，看 `npm run verify:images` 会不会红。
> **R52-H2 `verify:eol` 的真面在 CI 复算**：本机 GREEN 只证明这台机器的 index；CI 是 fresh checkout ⇒
> 需读回那一步的 step 日志行（`verdict=GREEN rc=0｜跟踪 N`），别拿本机读数当远端回执。
> **R52-H3 无主图归属半边**：`sm/` 现在只判"应有集里有没有"，**没判**"sm 里多出来的件"（与主图 orphan 同族）。
> **R51-H5 继承**：通用解释器分派，触发条件 = 别名里出现第 2 条非 node 门禁（本轮实测仍为 1 条：`verify:images`）。
> **R51-H4 覆盖率地板本轮不动**（读数 80.50/73.52/76.19/82.26 对 79/72/74/80，见 `vite.config.js`；
> 分项预算 = 借 size-limit 形状的 per-check limit，本轮未做，登记给下一轮）。
> 用户侧不变：**`CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺** ⇒ 备份链 `artifact=0`，豁免至 **2026-10-12**；
> M3 分支保护沿用 2026-09-28T07:12:31Z 实测 `NOT_ENFORCED`；微信真机验收未做。


