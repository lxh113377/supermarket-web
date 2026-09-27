# 07 分卷 63 —— 第三十七轮在册事实（下）：H2/H3 明细（自卷 60 切出，逐字未改）

2. **H2 五处各说各话 → 一把尺**：`shared.js` 的 `MAX_STATEMENT_PAYLOAD_CHARS = 90_000`
   （= 平台事实 × (1−10%)）。改前 orders/reviews 各 `800 * 1024`、submissions `2 * 1024 * 1024`、
   前端 `2MB` —— 而本仓 `public/` **115 张图实测** base64 p50≈29,677 / **p90≈103,298** / max≈204,538
   ⇒ p90 已越过单语句预算：旧值形同虚设，放行后失败发生在平台层。M5 的"量纲不同不可比"结案：
   base64 是 ASCII ⇒ 1 字符 = 1 byte。错误码 33→35（新增 `payload_too_large`、`quantity_exceeds_limit`，
   并把 orders.js 里"图太大/格式无效"共用 `invalid_image` 拆开）。
3. **H3 单行数量上界 = 99**：继承本项目在册决定（详情页 `qty >= 99` 两处字面量改引用常量），
   **不抄 saleor 的 50** —— `DEFAULT_LIMIT_QUANTITY_PER_CHECKOUT` 是站点默认、medusa 干脆只校库存。
   两侧等号进契约；`verify:backend` 探针 142→152（含"99 件是边界内"正向腿）。
