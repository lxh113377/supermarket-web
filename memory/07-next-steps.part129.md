> 建卷理由（第六十五轮 V3）：本轮三件事的明细合计约 2.6KB，塞进主卷会把入口卷顶过 4,096B 阈值；
> 按本仓「迁整段不压措辞」的纪律整段落卷。主卷 `07-next-steps.md` 第六十五轮节只留结论与指针。

## 2026-10-04 — 第六十五轮明细（回显四态 / V4 同族 / 外层拆卷）

> 建卷理由（第六十五轮 V4「新卷须 ≤3,072B」）：本卷内容逐字来自 `07-next-steps.part129.md` 第 1 段，按 `### ` 小节为原子单位拆卷（一小节不拆）。

### 一、M-64-5 剩余 4 处对外回显面：逐条给到「复用清洗 / 成立依据」两态

- **收口 3 处，一律复用 `sanitizeTrace`（不写第二个清洗器）**：
  ① `functions/lib/actions/products.js` batchUpdate 的 `failed[].id`；② 同文件 batchDelete 的
  `failed[].id`（这里是 `BATCH_DELETE_MAX=200` 条同时回显，放大 200 倍，比单条入口更该收）。
  两处共同的动因：**`failed` 这一支恰恰是「该 id 没命中 DB」**，所以没有任何主键形状钳住长度 ——
  与成功路径回显主键不同类，这是 64 轮把它们留在"未动"清单上的真正原因（当时没把这一层说清）。
  ③ `functions/lib/dify.js` 的 `conversationId: data.conversation_id`：这是**第三方回包决定我方响应体**
  的字段，且 `AssistantPage.tsx:67` 会把它存进本地态再回传 ⇒ 64 轮只记了"请求侧无字符白名单"，
  **响应侧这一半当时根本不在册**。上游脏值回落请求侧已 sanitize 的值，不把脏串往下游传。
- **改口径 1 处**：`functions/lib/actions/ai.js` 请求侧 `conversationId` 从 `sanitize(…,100)`
  （只截长度）换成 `sanitizeTrace`（长度 + `[\w:.-]` 字符集双限）；合法 UUID 逐字不变。
- **判「成立」2 处，各配一条可复算回执**：`adjustStock` 的成功回显必须先 `readStockRow` 命中主键，
  3,000 字入参走不到那条 `return`（新断言 L34 实测 `errorCode=product_not_found` 且全响应不含 70 连字）；
  `createProduct` 的 `data` 是 `pick(PRODUCT_FIELDS)` 白名单键 + 服务端 `genId('p_')` 的 `_id`。
- 读数：`verify:backend` **195→204**；变异腿两条真跑（batchDelete 还原原写法 → `L31 红「实得 2000B」`；
  dify 还原 → `L33 红「实得 4003B」`），两次都按 sha256 载回并断言相等
  （`c35fe669…` / `7558a362…`）。单测另加 2 条（`tests/batchProducts.test.js` 6→8）。
