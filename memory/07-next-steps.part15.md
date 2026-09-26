## 2026-09-25 — 防线轮 K1+K2（门面故障路径进断言 + 真渲染 CI 硬门禁）

- **K1 完成**：新增 `tests/apiClient.test.ts` 26 + `tests/localStore.test.ts` 29 + `tests/authWriteInvalidate.test.ts` 8，扩 `catalogCache` +3、`dbReviews` +5；用例 560→**631**（60→63 文件），覆盖率 80.91/74.08/76.41/82.52，棘轮上调 **78/72/74/80**（实测 −2pp；branches 三跑 74.08/74.08/74.12 证实需留余量）。
- **K2 完成**：`playwright.stub.config.ts` + `tests/e2e-stub/dashboard-cloud.spec.ts`（3 例：四图 canvas 背衬尺寸、pageerror 严格空、console 带资源噪声白名单）+ CI 新 job `e2e-cloud-stub`；桩补 `verifyKey` case（不补则 reload 类用例假红）。
- **⚠️ 本轮最重要的账目纠正**：`deploy.needs` 此前只有 `build-and-test` ⇒ `e2e` job **红了也照常部署**，而 CHANGELOG/`ci.yml` 注释从 09-24 起就写着"具备阻断力"。现已改为 `[build-and-test, e2e, e2e-cloud-stub]`。**教训**：门禁的存在性要看 `needs`，不要看注释里那句"阻断"。
- **反例自证 18/18**（一次性变异脚本，产物在仓库外）+ K2 两个变异（复现 `core.use` 事故：canvas 判据与 pageerror 判据各自独立变红，后者报 `e.install is not a function`）。
- **当场修掉两处真实缺陷**：`db/reviews.ts` 三处"只在成功才失效"、`updateOrderStatus`/`deleteOrder` 零失效。收口为 `catalogCache.withCacheInvalidation(fn, invalidate = clearCatalogCache)`，评价侧传**精确键**（复用全清=过度失效）。
- **我自己的两处误判（已被实测纠正，记此防复发）**：① 以为脏读面是后台「缺货/低库存」角标 —— 实测 `getAdminProducts()` 根本没接缓存，真脏的是**顾客端库存显示**；② 以为本地跑 `verify:changelog` 会红 —— 它比 `HEAD~1..HEAD` 提交边界、不看工作区，所以拦截点只在 CI。
- **新发现（未修，待裁决）**：
  - **N1** `getLocalCategories()` 直返 `seedCategories` 模块引用（全站唯一没走 `cloneArray` 的读出口）。当前三个调用方只做 `setState`、所有 `sort` 都写 `[...list].sort()` ⇒ **不是活缺陷**；但任何一处原地排序就会污染整个会话的种子。修法：`return cloneArray(seedCategories)`（一行），或按"修一类不修一例"把 `localStore` 全部读出口统一过一个拷贝出口。
  - **N2** `verify:changelog` 一次 push 多 commit 时只校验最后一个 commit ⇒ 前面的 src 改动可绕过门禁。本轮为此刻意单 commit。治法：改为比对本次 push 的 commit range（`github.event.before..HEAD`）而非固定 `HEAD~1`。
  - **N3** 4 个既有浏览器 spec（`tests/e2e/smoke`、`order-flow`、`product-detail`、`tests/e2e-visual/layout`）仍只 `console.log` 错误、从不 `assert`。新 job 已覆盖云端模式，旧 spec 建议下一轮统一收进同一个 `watch()` helper。

## 分卷目录
- **卷1** `07-next-steps.part14.md` — 07-next-steps 分卷（R199 自动拆卷）

