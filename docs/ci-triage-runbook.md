# CI 分诊手册（GitHub Actions）

> 来源：2026-09-25 防线轮一次真实卡死。当时三个 job 全红、**一个 step 都没有**，
> 而 CHANGELOG 里从 09-24 起就写着"e2e 具备阻断力"（其实 `deploy.needs` 从没列过它）。
> 本手册的目的是：**下次别再从头猜，也别把账号级故障当代码故障去改代码。**

## 0. 一条命令先跑这个

```bash
node scripts/ci-status.mjs            # 最近 5 条 run，自动分类并给退出码
```

| 退出码 | 含义 | 该做什么 |
|---|---|---|
| `0` | 全绿 | 继续按部署 skill §6 核线上 |
| `1` | **真判据红**（失败 job 里有 step） | 正常修代码/测试。**禁止**改判据让它变绿 |
| `3` | **账号级 0-step 秒红**（无 step 且 ≤12s） | **不要改代码**。按下面 §2 排除，然后走 §4 |
| `4` | 取不到数据（无 token / 代理不通 / API 挂） | 修通道，别把"没数据"读成"通过"（R247） |

## 1. 症状 → 结论对照

| 症状 | 结论 | 依据（本仓实测） |
|---|---|---|
| job `failure` + `steps=0` + 4~6 秒 | 没拿到 runner，与提交内容无关 | run `36110097808`（两 attempt）、`36111760145`、探针 `36115775548` 全如此 |
| 同上，且**本仓零改动**的 workflow 也这样 | 排除"我的改动导致" | `uptime.yml`（最后变更 `5fda761`）dispatch 后 `probe` 同样 0 step / 3 秒 |
| 多个**互不相关**私有仓同时这样 | 账号级，不是仓级 | 5 个私有仓 29 个 run 全 0 step，0 success |
| `deploy` = `skipped` | 闸门**在正常工作**（needs 上游红） | 本轮起 `deploy.needs = [build-and-test, e2e, e2e-cloud-stub]` |
| run 的 logs 包是 22 字节空 zip | 确无任何 step 执行过 | 两个失败 run 实测 |
| 入口 bundle 名没变 | **不能**证明没上线（纯资源/文案改动不改哈希） | 判"上没上"只看 `sw.js` 的 `CACHE_VERSION`（坑 32） |

## 2. 排除清单（每条都有可直接跑的命令）

```bash
# ① 本仓 Actions 是否被禁（enabled:true / allowed_actions:all 才正常）
curl -s --proxy http://127.0.0.1:7897 -H "Authorization: Bearer $(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')" \
  https://api.github.com/repos/lxh113377/supermarket-web/actions/permissions

# ② 配额：按 job 逐个累加才算数（按 run 墙钟会低估，实测低估 1.46x）
#    见 §3 的脚本化做法；2026-09-25 实测 1151.0 / 2000 分钟（57.6%）⇒ 未耗尽

# ③ 官方状态（无事故 ≠ 你账号没问题，但它先排除大盘）
curl -s --proxy http://127.0.0.1:7897 https://www.githubstatus.com/api/v2/components.json | grep -o '"name":"Actions"[^}]*"status":"[a-z]*"'

# ④ 线上到底哪个版本（独立于 GitHub 的第二通道）
node node_modules/wrangler/bin/wrangler.js pages deployment list --project-name supermarket-web | head -5
curl -s --max-time 15 https://supermarket-web.pages.dev/sw.js | grep -o "CACHE_VERSION = '[^']*'"
```

## 3. 算准当月用量（防"墙钟低估"这一档）

计费 = **逐 job** `(completed_at − started_at)` 求和，Linux 倍率 1。
按 run 的墙钟求和会低估：并行矩阵越重低估越多（实测本账号 1.46x；fenjue 单仓 11-job 矩阵曾抽到 2.27x）。
抽样外推只能定量级，**要下结论必须逐 run 取 `/jobs`**（686 个 run ≈ 数分钟，放后台）。

## 4. 判定为账号级之后的处置顺序

1. **什么都不改代码**。尤其禁止：给 step 加 `continue-on-error`、把 `deploy.needs` 拆回去、注释掉判据。
2. 唯一能一锤定音的证据是 **已登录浏览器里那条 run 的红色横幅原文**（API 不返回它；私有仓对无登录态会话直接 404）。
   取法：打开 `https://github.com/lxh113377/supermarket-web/actions/runs/<run_id>` 看顶部红条。
3. 想不等 CI 也要交付时，只有两条被允许的路，且**都要用户点名**：
   - 部署 skill §4 的本地急救：`wrangler pages deploy dist`（**跳过 CI 执行**，等于放弃门禁）；
   - 触发**公开仓** `lxh113377.github.io` 的 `deploy.yml`（公开仓不计分钟；可反证是否私有仓计量问题，但会造成**半发布**：顾客端新、管理端旧）。
4. 记录：把"未发 + 拦在哪一步 + 失败面"写进 `memory/07-next-steps.md` 的 P0，**不得写成已上线**（坑 36）。

## 5. 想在 push 后自动知道结果（可选，需用户本机配置）

`scripts/ci-status.mjs` 已经能自己判类，所以 hook 只需调用它并把非零码回注：

```
事件：命令执行后（git push 成功之后）
命令：node scripts/ci-status.mjs --limit=2
注入：把它的 stdout 作为上下文给 Agent（exit 1 → 修代码；exit 3 → 停手，按 §4）
注意：① 必须走 curl/代理，node 原生 fetch 不读系统代理，会把"取不到数据"伪装成"没数据"；
      ② 判类里 0-step 与真红必须分开退出码，否则 hook 会指挥 Agent 去改本该拦住它的判据。
```

## 6. 本轮沉淀的可复用判据（已进门禁链的部分）

- `e2e-cloud-stub` job（生产构建 + 假桩后端）断言看板四图真出 canvas 且 `pageerror` 严格为空 —— 防"单测全绿、线上静默空白"那类缺陷（曾存活 19 天）。
  已在 Linux 容器实测 `test:stub` **3/3 绿**（`node scripts/ci-status.mjs` 只能等 runner 回来才验 GitHub 侧）。
- 反例自证：任何"会判红"的新判据，必须配一个把实现改回朴素形态的变异体并实跑变红（本轮 18/18）。
- 门禁的存在性看 **`needs` 列表**，不看注释里"具备阻断力"那句话。
