# 07 分卷 105 —— 第五十六轮踩坑与 R57 登记

## 七条坑（每条都是"判据/夹具自己崩了却差点报绿"那一族）

1. **半成品不报错，它只是让后面的腿根本没跑**。`&&` 链停在校验链第 10 关，前面 9 条绿、后面 23 条**从未执行**；
   如果我只看"链上第一个 FAIL 是什么"就会以为只有契约一件事。⇒ 正确动作是把 23 条腿逐条单独跑一遍取 rc。
2. **静态 import 会破"缺输入面"契约**。`verify-backend.mjs` 顶部加了一行 `import { LEDGER_CHECK_SQL } from '../functions/lib/stock.js'`，
   于是探针把它拷进没有 `functions/` 的骨架目录时，ESM 解析器先于 `requireInputs` 撞上，
   首行变成 `node:internal/modules/esm/resolve:271` 崩栈而不是自家诊断（两条探针同时判红）。
   而且文件头那句 `// @probe-safe: 骨架实测 rc=2 / 0s` **当场变成假话**——它是要被 G5 三方对账的声明。
   修法＝挪到 preflight 之后用动态 `import().catch(()=>null)` + `bail()`，缺件/空件都落到同一条 rc=2 出口。
3. **变异腿把"值"写进匹配串，被测对象一改值，反例就静默消失**。`tests/limitProvenance.test.js` L8 用
   `x.key === '…BATCH_UPDATE_MAX=40'` 定位，本轮 40→20 之后 find 返回 `undefined`，下一行 `hit.value=` 抛 TypeError
   ——腿死于夹具而不是死于被测对象，等于这条反例从此不存在。⇒ 改成按 `文件#形状#常量名` 前缀定位 + `toBeTruthy()` 显式证前提。
4. **负测必须证明自己的前提**。L7 名义测"缺 productId"，实际 payload 给了 productId、漏了 delta，
   真实返回是 `invalid_delta`——断言写的 `missing_product_id` 永远等不到，而这条腿之前是**绿的**（它测的是另一个分支）。

> 踩坑 5–7 在 `07-next-steps.part109.md`。
