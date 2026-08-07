# 超柿 Web 代码审查标准（Code Review Standard）

> 适用范围：`src/`、`cloudfunctions/`、`scripts/`、`*.config.js` 的所有改动。
> 维护者：团队 owner。审查者依据本文档给出 🔴/🟡/💭 评级。
> 版本：v1.0 · 2026-08-08

---

## 0. 核心原则

1. **审查是教学，不是挑刺。** 目标是对事不对人，提升整体代码质量与团队能力。
2. **质量共担。** 审查者对被审代码上线后的质量负有共同责任，不要为了"走流程"而放行。
3. **小步提交。** 单 PR 改动越小，审查越准、风险越低（建议 ≤ 400 行）。
4. **先自审，再提交。** 作者先过一遍本文档与 `REVIEW_CHECKLIST.md`，把低级问题挡在门外。
5. **可量化、可追溯。** 每条评论都要有"位置 + 原因 + 建议"，不写"这里不太好看"这类空话。

---

## 1. 严重程度分级

| 标记 | 级别 | 含义 | 合并前要求 |
|------|------|------|-----------|
| 🔴 | **P0 阻塞（Blocker）** | 安全漏洞、数据丢失/损坏、线上故障、破坏对外契约 | **必须修复**，否则禁止合并 |
| 🟡 | **P1 重要（Major）** | 正确性隐患、可维护性差、性能瓶颈、关键路径缺测试 | **必须给出处理**（修复 / 记录 issue / 团队共识） |
| 💭 | **P2 次要（Minor）** | 命名、可读性、轻微重复 | 建议修复，可后续跟进 |
| 📝 | **P3 提示（Nit）** | 风格、注释、纯偏好 | 可选，不阻塞 |

---

## 2. 审查维度与检查清单（通用）

### 2.1 正确性（Correctness）
- [ ] 实现是否真正满足需求？边界条件（空、0、负数、超大值）是否处理？
- [ ] 异步逻辑是否处理了 reject / 超时 / race？（`auth.js` 的 `AbortController` 是正面范例）
- [ ] 状态更新是否基于最新值（React 中避免 stale closure，`useCart` 用 `useRef` 已修复，新代码须保持）？
- [ ] 金额、库存等关键数值是否依赖服务端（**下单金额必须服务端重算**，见 §3.3）？

### 2.2 安全性（Security）🔴 最高优先级
- [ ] 是否有注入风险（NoSQL 拼接用户输入、SQL 拼接、命令注入）？
- [ ] 密钥是否泄露？前端只允许 `VITE_` 前缀的公共配置；**管理密钥只进云函数环境变量**（已在 `cloudbaserc.json` / 云函数 env，绝不在前端硬编码）。
- [ ] 鉴权是否真正落地？管理写操作必须走云函数校验（本项目 `AdminGuard` + `admin-api` 已做，新增接口须保持）。
- [ ] 写入是否做字段白名单？（`auth.js` 的 `PRODUCT_FIELDS` 是范例，须推广到订单/评价/提交，见 §4.7）
- [ ] 是否有 XSS / 危险 `innerHTML` / `eval`？

### 2.3 可维护性（Maintainability）
- [ ] 单一职责：一个模块/函数只做一件事。⚠️ `db.js` 当前是 265 行"上帝模块"，新代码不要继续往里塞。
- [ ] 导入时是否产生副作用？⚠️ `db.js` 在模块加载时 `window.addEventListener('online', ...)` + `setTimeout(flushPendingSubmissions, 3000)`，导致测试不可控、重复加载重复注册。**新增代码禁止 import-time 副作用**。
- [ ] 是否有复制粘贴代码？⚠️ `cloudfunctions/shared.js` 被复制成 3 份（根 / `admin-api` / `public-api`），须改为单源（见 §4.3）。
- [ ] 是否有死代码 / 永远走不到的分支？（如 `auth.js` 的 tcb-api 兜底 URL 注释写明"通常不通"，应删除）

### 2.4 性能（Performance）
- [ ] 数据库查询是否分页？（`getOrders` 已分页，新列表沿用 `skip/limit`，禁 `limit(1000)` 全量拉取除非确认数据量极小）
- [ ] 是否有 N+1 / 循环内异步串行、重复请求？
- [ ] 高频渲染是否做了 memo / 虚拟化？列表、看板数据是否缓存？

### 2.5 测试（Testing）
- [ ] 新增/修改的核心逻辑是否有测试？**安全相关（auth、订单金额、白名单）必须有测试**。
- [ ] 现有覆盖缺口：`db.js`、`auth.js`、云函数核心逻辑（`cloudfunctions/admin-api/index.js`）缺测试，须逐步补齐。
- [ ] 测试是否真实断言行为，还是只为凑覆盖率？

### 2.6 前端体验与可访问性（React / Tailwind）
- [ ] `key` 是否用稳定 id（禁用数组 index 作 key）？
- [ ] 是否遵循 Rules of Hooks（hook 不在条件/循环里调用）？
- [ ] 加载/错误/空态是否有 UI 反馈？
- [ ] 是否依赖非 `VITE_` 运行时变量（会被打包固化）？

---

## 3. 技术栈专项规则

### 3.1 React 19 / Hooks
- `react/rules-of-hooks` 必须为 `error`（已配置）。
- `react-hooks/exhaustive-deps` 建议开启为 `warn`（当前 `off`，易漏依赖）。
- 组件保持小而纯；数据获取下沉到 `hooks/`（`useProducts`、`useCart` 模式）。
- 受控与非受控输入保持一致；表单提交须有 loading / disabled / error 三态。

### 3.2 纯 JS（无 TS）+ `jsconfig`（strict + checkJs）
> 项目尚未迁移 TS，靠 `jsconfig.json` 的 `strict + checkJs` 提供 IDE 类型提示。
- **所有导出函数必须有 JSDoc**：`@param` + `@returns`；复杂对象用 `@typedef`。
- 禁止用 `any` 逃逸类型检查；外部数据（云函数返回、localStorage）用 `@type` 标注。
- 反面：`cart.js`、`db.js` 大量导出无类型标注，新代码须补，存量逐步补。

### 3.3 CloudBase 数据层 / 云函数
- 🔴 **金额永远服务端重算**：`createOrder` 把 order 交给云函数重算总额，前端不传 `totalAmount`。新下单/计费逻辑必须沿用。
- 🔴 **写入字段白名单**：`auth.js` 的 `PRODUCT_FIELDS` / `pickProductFields` 模式必须推广到所有写操作。
- 查询必须分页，禁止无 `limit` 全表扫描。
- 集合安全规则最小化：`read` 公开集合可 `true`，`write` 必须 `auth != null` 且经云函数。
- 不要在查询条件里拼接用户输入（NoSQL 注入）。

### 3.4 错误处理与降级（本项目已有良好模式，须保持）
- 所有云调用 `try/catch` 并降级到本地（`db.js` 各处 `catch → getLocalXxx()` 是正面范例）。
- `fetch` 必须超时（`AbortController`，`auth.js` 已做，15s 合理）。
- 降级不能静默：须 `console.warn` 记录原因（已做），禁止 `catch {}` 后返回误导数据。
- 本地兜底数据（seed）与云端结构须保持一致，避免字段错位。

### 3.5 副作用与生命周期
- ⚠️ **禁止 import-time 副作用**：模块被任何测试/工具 import 即执行副作用，会污染全局、拖慢测试、重复注册监听。副作用应在 `useEffect` / 显式 `init()` 中触发。
- `setTimeout` / `addEventListener` / 定时器必须有对应的清理（`clearTimeout` / `removeEventListener`）。

### 3.6 密钥与 `.gitignore`
- `.gitignore` 已正确忽略 `.env`、`cloudbaserc.json`、`*.local` —— **保持不变**。
- 任何新增密钥只走云函数环境变量 / CI Secret，绝不进仓库。
- 提交前做 secret 扫描（接入 gitleaks 或 pre-commit hook），防止误提交。

---

## 4. 本项目已识别的反模式（来自代码扫描，须纳入审查红线）

| # | 位置 | 问题 | 级别 | 处理方向 |
|---|------|------|------|----------|
| 4.1 | `src/db.js` | import 时注册 `window online` 监听 + `setTimeout` 刷队列 | 🟡 | 改为显式 `init()` 调用，测试可 mock |
| 4.2 | `src/db.js`（~265 行） | 上帝模块：顾客读 / 管理写 / 提交队列 / 种子初始化全在一起 | 🟡 | 拆为 `products.js` / `orders.js` / `submissions.js` / `seed.js` |
| 4.3 | `cloudfunctions/shared.js` ×3 | 根、admin-api、public-api 三处复制同一文件 | 🟡 | 单源 + 构建/部署时引用，删除复制 |
| 4.4 | `src/auth.js` `getApiBase` | "通常不通"的 tcb-api 兜底 URL（死代码） | 💭 | 删除，保留可达兜底即可 |
| 4.5 | `src/cart.js`、`src/db.js` 等 | 导出函数缺 JSDoc / `@typedef` | 💭 | 新代码必填，存量排期补 |
| 4.6 | `tests/` | 覆盖不均：cart / businessHours / shared 有，db / auth / 云函数核心缺 | 🟡 | 补安全关键路径测试 |
| 4.7 | 字段白名单仅商品写入 | 订单/评价/提交未统一白名单 | 🟡 | 抽取通用 `pickFields(schema, data)` |
| 4.8 | `.oxlintrc.json` | 仅 3 条规则，门禁过弱 | 🟡 | 采用 `docs/oxlintrc.recommended.json`（见流程文档） |

---

## 5. 审查评论格式（强制）

每条评论按以下结构，便于作者逐条回应：

```
🔴 Security / 🟡 Correctness / 💭 Style: 文件:行号
Why: 为什么这是问题（风险/后果）。
Suggestion: 具体改法或示例代码片段。
```

优先用具体行号与代码，避免"建议优化一下"这类无法执行的评论。

---

## 6. 评论示例（基于本项目代码）

**示例 A（P1 / Maintainability，对应 §4.1）**
```
🟡 Maintainability: src/db.js:194-198
Why: 模块被 import 时立即注册 window 监听并 setTimeout 刷队列，
     测试 import db.js 会触发真实定时器与全局监听，既不可控又可能重复注册。
Suggestion: 抽成显式函数，在应用入口（main.jsx）调用一次：
  // db.js
  export function initSubmissionSync() {
    if (typeof window === 'undefined') return
    window.addEventListener('online', flushPendingSubmissions)
    flushPendingSubmissions()
  }
  // main.jsx 启动时调用一次
```

**示例 B（P1 / Testing，对应 §4.6）**
```
🟡 Testing: src/auth.js (pickProductFields / updateProduct)
Why: 字段白名单是安全关键逻辑，当前无测试，重构时极易回归。
Suggestion: 新增 tests/auth.test.js，断言超集字段被剔除、白名单字段原样保留。
```

**示例 C（P0 / Security，通用红线）**
```
🔴 Security: <新增文件>:行号
Why: 管理密钥出现在前端代码/打包产物，攻击者可在浏览器源码中直接提取。
Suggestion: 密钥只放云函数环境变量，前端通过登录接口换取临时凭证。
```

---

## 7. 如何触发"代码审查专家"角色

当你说"帮我 review 这段代码 / 这个 PR"，我会以 **Code Reviewer** 身份，依据本文档输出带 🔴/🟡/💭 分级、含位置/原因/建议的审查报告，并给出"好在哪里 / 必须改 / 建议改"的结构化结论。
