# CLI 入口真跑登记册（`npm run verify:entrypoints`）

> 立这本账的实证代价（第二十四轮，不是假想）：`scripts/ci-green-contract.mjs` 有 15 条夹具，
> 但**全部 `import { verdictOf }` 只测纯函数**，CLI 那段（读 stdin → 解析 git 的 ref 行 → 判据 → exit
> code）一次都没被跑过。于是 `fs.readFileSync(0)` 抛的 `ReferenceError`（模块里没有 `fs` 这个标识符）
> 被 `catch { line = '' }` 吞成"git 没给 ref 行"，**整条输入通道静默失效**：实测推 `feature-x` 时
> 闸门打印的是 `branch=main`，审的是不相干分支。这条闸正是上一轮为"CI 全绿不能靠自觉"才立的。
>
> 本判据只问一件事：**被登记为可执行的入口，有几个被测试当子进程真跑过（喂 stdin、断言退出码）？**

## 口径（判据按此枚举，改口径＝改代码，不接受只改本文）

- **登记面（分母）**：`package.json` 的 `scripts.*` 值 + `.githooks/*` + `.github/workflows/*.yml` 里
  出现的 `scripts/X.mjs`，逐条标注来源（`npm:别名` / `hook:文件` / `ci:文件`）。当前 **34** 个。
- **门禁类入口**：npm 别名形如 `verify:*` / `check:*`（裸 `verify` 是聚合命令，不算入口）。
- **覆盖**：`tests/**` 里既有 `spawn`/`execFile`/`execSync`/`fork` 调用、又以字符串字面量出现该脚本文件名。
  只 `import` 纯函数**不算覆盖**——那测不到入口（本轮的教训本体）。
- **两张表互斥且并集必须等于未覆盖集合**：`## 已知缺口` = 该补夹具但这轮没补；`## 不可子进程豁免` =
  结构上 spawn 不了（要网络 / 要 build 产物 / 会写库 / 常驻服务 / 冷启动 >2s 量级），理由必须是实测依据。
  一行挂两处 = 判红；挂了却其实已覆盖 = 幽灵豁免 = 判红。
- 判据自身（`check-cli-entrypoints.mjs`）**不入豁免面**：它必须同时出现在登记面和覆盖面（G7）。
- **两类覆盖，别混为一谈**（第二十五轮补）：
  ① **判据路径真跑**（上表口径，`PROBED` 14 条）= 在真仓上跑一次、断言 rc=0 且有结论 —— 证明"门禁会判"；
  ② **缺输入面真跑**（`tests/cliEntrypoints.test.js` 的缺输入探针）= 把**全部 22 个门禁类入口**拷进只有
     `scripts/` 的空目录跑一次，断言 rc≠0（fail-closed）**且首行是自家诊断而不是裸栈** —— 证明"没输入时不会装绿"。
  ②不替代①：所以 `## 不可子进程豁免` 那三行仍然挂着（它们被②覆盖，但①因产物/耗时/参数设计而不成立）。
- 缺输入面的基线（修之前实测）：22 个门禁类入口里 **8 个甩裸栈、1 个静默放行**
  （`check-licenses` 在没有 package.json 时打印「0 个生产依赖（含传递）全部 … 白名单 ✅」并 exit 0）。
  现在 22/22 全部 rc≠0 且首行为 `[label] 环境不满足：…`，收口件 = `scripts/lib/preflight.mjs`。

- **覆盖地板**：23

## 已知缺口

| 脚本 | 为什么还没有子进程夹具 |
| --- | --- |
| check-pr-has-tests.mjs | 要 `gh` 查开放 PR（网络）；CI 无 PR 时只报空集。已在 CI 的 PR job 以真命令跑过 ⇒ 入口崩溃会当场红，缺的是本地夹具 |
| ci-status.mjs | 纯线上只读查询 `gh run list`，无本地判据可断言；探针跑它等于测 GitHub API 可用性，不是测代码 |
| gen-api-doc.mjs | 每次运行**改写** `docs/API.md`，spawn 会弄脏工作树；漂移已由 `verify:contract` 双向对账兜住 |
| local-api-stub.mjs | 常驻 HTTP 服务，spawn 会挂到超时；它由 `test:stub` 的 Playwright 链以真进程拉起（e2e 覆盖入口） |
| migrate.mjs | 会 `d1 execute` **写库**（迁移/基线），夹具侧绝不能碰真库；`verify:migrate-replay` 已在一次性内存 SQLite 里重放同一套迁移 |
| purge-security-events.mjs | 破坏性运维命令（删审计日志行），同样绝不能被自动探针跑到 |
| smoke-deploy.mjs | 打的是线上端点（`/_health` + 三个 action），部署后才有效；由 `npm run smoke` 在部署后手动/流程内跑 |
| uptime-check.mjs | 同上：线上探测，本地 spawn 只会测网络。CI 的 uptime workflow 以真命令跑它 |

## 不可子进程豁免

| 脚本 | 为什么不能 spawn（实测依据） |
| --- | --- |
| check-bundle-size.mjs | 读 `dist/` 产物；CI 顺序是 build(ci.yml:139) → check-bundle-size(ci.yml:146)，而 `npm test` 时点产物还没生成 ⇒ 探针必假红。入口已在 CI 以真命令跑过 |
| check-functions-build.mjs | esbuild 冷编译实测 9.0s（本地 9044ms），塞进 `npm test` 会把单测拖成分钟级。已在 `npm run verify` 与 CI 以真命令跑过 |
| verify-release-parity.mjs | 缺 `PARITY_AFTER_TS` 起点时**按设计 rc=2**（fail-closed，"没有起点就不判'看起来一样'"），探针的 rc=0 断言对它不成立；且比对要拉两端线上产物（网络） |

## 为什么"CI 里真跑过"算减轻因素、但不抵消缺口

被豁免/挂账的入口大多确实在 CI 或部署流程里以 `node scripts/X.mjs` 真跑过 —— 入口崩了 CI 就红，
这是**真实回执**，不是自觉。但两类情形它兜不住，所以缺口仍要挂账、不许直接销账：

1. **pre-push / 本地专用入口**（如 `ci-green-contract.mjs`）：CI 根本不跑它，崩了也永远"看起来在工作"；
2. **只在特定分支/环境下才跑**的入口（`smoke-deploy` / `uptime-check` / `verify-release-parity`）：
   红需要一次真部署或一次真故障，反馈周期以天计。

判据实现：`scripts/check-cli-entrypoints.mjs`（G1 分母非零 / G2 两表⇄实测双向对账 / G3 理由非空且不含 TODO /
G4 棘轮地板 / G5 hook 目标在册 + 生效前提已登记 / G6 **本地钩子入口必须有夹具**（pre-push 那类 CI 不跑的） /
G7 判据自身入面 / G8 门禁类必须真跑或具名豁免）
夹具：`tests/cliEntrypoints.test.js`（14 条入口真跑探针 + 合成仓 G1~G8 双向变异）
