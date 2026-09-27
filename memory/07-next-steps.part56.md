# 07 分卷 56 —— 第三十六轮在册事实（2026-09-27）

> 出生字节受 `V4` 约束（≤3,072B）。基准锚：内层 `bec6252`（R35 收尾）、外层 `dc1a87a`。

## 一、Step 0 台账（第 36 轮基线）

- **76 → 本轮重扫：A 仍有效 28 / B 疑似完成需实测 13 / C 疑似失效 6**；扫过内层 07 系 55 文件（153,748B、未勾 70 条）。
  `TODO.md`/`TASKS.md`/`ROADMAP.md`/`memory/09-*` 两仓**全部不存在**（逐个 ls）。
- **本轮纠了自己三笔账**：① R35 报告写"主卷 3,412B"，`git cat-file -s bec6252:…` 实测 **3,698B**（差 286B）；
  ② 购物车消费者 R35 记"9 处"，穷举实为 **15 处**；③ 外层未勾 R35 记"10 条"，那是主卷单文件，
  按"6 个 07 系文件"取面应为 **17 条**（合计 34,970B）。
- **C 组抓到一条误导指针**：卷 30 写着 `updateQuantity` 与合并键同用 —— 该函数**不存在**（全仓零命中）。
## 二、本轮做完的三件（都有判据/契约，不靠措辞）

1. **H1 购物车行身份 = (productId, spec)**（A-19，挂 8 轮）。15 处全改：`cart.ts` 合并键 + 三个 mutate 加 spec 形参
   + `getItemQuantity` 改跨口味聚合 + `useCart` 3 包装 + `CartPage` 三回调与 `key` + `CustomerPage` 减号 +
   `OrderConfirmPage` 的 `key`。顺带修掉 `existing.quantity += n` **就地改旧 cart**（浅拷贝只拷数组）⇒ 现在 map 出新对象。
   服务端与下单链路**一行没改**（本来就逐 item 一行、spec 走白名单、幂等指纹含 spec）⇒ 缺陷 100% 在前端键控层。
   测试：`tests/cart.test.js` 13→21、`cartPage.test.tsx` 4→7（接线级：断言真的把 spec 传下去）。
2. **H2 上限普查面补两半 + 两侧同值契约**。一手数字：旧「拒绝型」只认数字右值 ⇒ 面内 **8 处常量名比较完全隐形**
   （`SPEC_OPTION_LIMIT`/`MAX_REVIEW_IMAGES`/`BATCH_UPDATE_MAX`/`BATCH_DELETE_MAX`/`BATCH`/`PAGE_SIZE`）；
   「截断型」同样只认数字 ⇒ 另有 **3 处 `.slice(0, 常量)`** 隐形（含前端 `FLAVOR_MAX_LEN=20` vs 服务端 `slice(0,20)`）。
   新增两个形状后普查 **65 → 74 项**，74 行全部带溯源，`limit-provenance 10/10`。
   新契约 `tests/limitCapParity.test.ts`（8 条）钉服务申请 5 / 图册 9 / 口味 20 / 口味名 20 的四对两侧同值，
   每条都带"解析不到即判红"的防空转腿。
3. **H3 外层记忆指针看守**（`scripts/check-memory-pointer-sync.mjs`，P1/P2 三态）。
   立它的事实：外层指针停在第 29 轮、内层已到第 35 轮，**5 轮断更无人在意**。
   CI 里该目录取不到 ⇒ 只报 `UNVERIFIED` 且 rc=0（不阻断也不假核）；本地 `npm run verify` 才是它守现场的地方。
   **首版把路径写成上两级** ⇒ 恒 UNVERIFIED 且输出看着完全合理，被"真面自证"那条腿抓出（见下）。
> 体量拆分：本轮事实分 **卷 56 / 卷 57** 两本（`V4` 要求新卷出生余量 ≥25% ⇒ ≤3,072B）。
