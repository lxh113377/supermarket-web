# 环境变量登记册（唯一真相源，受 `npm run verify:env` 双向对账）

> 本表由 `scripts/check-env-docs.mjs` 校验：代码里引用的每个变量必须有行、有行必须
> 代码还在引用、且**每行都要写「未配置时行为」**。新增 env 不改本表 = 门禁直接判红。
> 种类取值：`secret`（密钥，走 Pages secret，绝不写进仓库）/ `plain`（明文变量）/
> `build`（构建期烘焙进前端产物）/ `绑定`（Cloudflare 资源绑定，不在 Variables 面板手填）。

| 变量 | 种类 | 配置位置 | 未配置时行为 | 用途 |
|---|---|---|---|---|

| `ADMIN_KEY` | secret | Pages → Settings → Variables and Secrets；本地 `.dev.vars` | **fail-closed**：`resolveRole` 返回 null，非公开 action 一律「认证失败」（错误回显不泄露部署态） | 管理端主密钥 |
| `ADMIN_READONLY_KEY` | secret | 同上 | 只读角色不存在：该密钥登录被拒，主密钥与管理写操作不受影响 | 只读查看密钥（禁止一切 `ADMIN_WRITE_ACTIONS`） |
| `ALLOWED_ORIGINS` | plain | Pages Variables（逗号分隔） | 回退内置默认源（`supermarket-web.pages.dev` + `lxh113377.github.io`）并额外放行 localhost/127.0.0.1 本地开发 | CORS 精确放行白名单追加项 |
| `DB` | 绑定 | Pages → Functions → D1 bindings | 响亮失败：`handleAdmin`/`handlePublic` 直接返回「未配置 D1 数据库绑定」，不静默返回空数据 | D1 数据库绑定 |
| `RATE_KV` | 绑定 | Pages → Functions → KV namespace bindings | 限流自动回退 D1 计数（`checkRate` 检测 KV 形态失败即走 `checkRateDB`），限流不失效、只是慢一点 | Workers KV 限流计数（快路径） |
| `CF_PAGES_COMMIT_SHA` | plain | Cloudflare 自动注入（不需手填） | `/_health` 的 `deploy` 字段返回 `null`，其余健康检查项不受影响 | 线上版本可追溯（取前 7 位） |
| `DIFY_BASE_URL` | plain | Pages Variables（须公网可达，CF edge 出网调用） | AI 整链路关闭：`aiAdvice` 走规则版、顾客端导购走本地兜底，功能不缺失 | Dify 服务地址 |
| `DIFY_CHAT_APP_KEY` | secret | Pages → Variables and Secrets | 同 `DIFY_BASE_URL`：缺任一即不发起 Dify 调用，直接降级 | 顾客端导购 Chat App 密钥 |
| `DIFY_ADVICE_APP_KEY` | secret | Pages → Variables and Secrets | 同上：经营建议返回规则版文案 | 管理端经营建议 Completion App 密钥 |
| `ORDER_WEBHOOK_URL` | secret | Pages → Variables and Secrets（第三方端点若含签名/token，整串按 secret 存） | **纯 no-op**：不发请求、不改订单状态、不消耗重试（`webhookTarget` 返回 null 即结束），下单照常成功 | 新订单外部通知投递地址（http/https only） |
| `VITE_CB_API_BASE` | build | `.env` / CI 构建参数（`wrangler pages deploy` 前烘焙） | 前端 `IS_CLOUD=false`，后台静默降级「本地演示模式」——这正是历史上「线上看不到真实订单」的根因，故 CI 的 Build step 必须显式烘焙 | 管理 API 端点 `/web` |
| `VITE_CB_PUBLIC_API_BASE` | build | 同上 | 同上（顾客端拿不到公开接口基址即走本地种子数据） | 公开 API 端点 `/pub` |

## 为什么把「未配置时行为」写成硬判据

对标取证（第十轮）里，litemall 的 `NotifyService.isMailEnable()`（`mailSender == null` 直接
`return`）和 minshop 的 `env.EMAIL` 未配即 `return null` 是**唯一被多家项目共同采用的
安全降级形态**；反面是 medusa 的 notification 模块——provider 未启用时**写一行 FAILURE 并
throw**，等于"没配置也改状态、也消耗重试"。这类差别此前只存在于代码里，读代码的人才看得见；
钉进本表后，任何人（含未来的我）加变量时必须先把降级行为写清楚，门禁再核对它没被删。
