> 建卷理由（第六十五轮 V4「新卷须 ≤3,072B」）：本卷内容逐字来自 `07-next-steps.part129.md` 第 2 段，按 `### ` 小节为原子单位拆卷（一小节不拆）。

### 二、M-64-4 V4 同族扫描：抓到的不是"又一个点不出名"，是另一形态

- 逐根扫 `scripts/` 后结论：V4 那种「能红但印 `[]`」的形态**没有第二例**；复发的是
  **`.slice(0, K)` 折叠掉具名且不印分母** —— 「一处红」和「四十处红」在输出上长得一模一样。
- 抓到 8 处并统一收口：`api-response-contract.mjs` V5（**与 V4 同文件同族的未修孪生**）、
  `check-registry-sync.mjs` R2/R3/R6、`check-limit-provenance.mjs` C4/C7/C9、
  `check-memory-volume.mjs` V5。新增 `scripts/lib/named-list.mjs` 的 `capped()`：去重后
  **必印「共 N 处」**，越上限另标「只展示前 K」；5 条单测 `tests/namedList.test.js`。
- 排除项也记（免得下轮重查）：`api-contract.mjs:157` 的 `|| '数量不符'` 看着像孪生，实为
  **不可达死文本**（`Object.keys` 唯一 ⇒ 差集空必等长）；`lib/response-shape.mjs` 的 `sameShape`
  全仓零 import = 死件。**这两条按"读过并否证"记，不按"已改"记。**
- 未造出来的判据（列欠账，不虚报关闭）：「判据折叠具名」这件事本身**没有结构性看守** ——
  本轮靠一次人肉逐根扫。要立得住得扫 `scripts/**` 的 `push(...)` 失败分支 AST，
  成本 = 一条新判据的 6 个登记面；记为下轮 P2。
