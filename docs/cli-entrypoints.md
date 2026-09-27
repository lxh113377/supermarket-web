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
  出现的 `scripts/X.mjs`，逐条标注来源（`npm:别名` / `hook:文件` / `ci:文件`）。本轮实测 **35** 个，
  其中门禁类 **23** 个、非门禁 **12** 个；被子进程真跑 **24** 个。
- **门禁类入口**：npm 别名形如 `verify:*` / `check:*`（裸 `verify` 是聚合命令，不算入口）。
- **覆盖**：`tests/**` 里既有 `spawn`/`execFile`/`execSync`/`fork` 调用、又以字符串字面量出现该脚本文件名。
  只 `import` 纯函数**不算覆盖**——那测不到入口（本轮的教训本体）。
- **两张表互斥且并集必须等于未覆盖集合**：`## 已知缺口` = 该补夹具但这轮没补；`## 不可子进程豁免` =
  结构上 spawn 不了（要网络 / 要 build 产物 / 会写库 / 常驻服务 / 冷启动 >2s 量级），理由必须是实测依据。
  一行挂两处 = 判红；挂了却其实已覆盖 = 幽灵豁免 = 判红。
- **`## 风险分类` 是第三张表，与上面两张正交**（第三十轮新增，判据 G9）：它记的是
  "自动探针**绝不能 spawn** 这个脚本"，标签由 `scripts/lib/preflight.mjs` 的 `classifyRisk()`
  从**每个脚本自己的源码**推导（wrangler / d1 execute / DELETE FROM / 起服务 / 改写受控产物 /
  fetch 或 curl / `gh`），不手抄名单。三个方向都会红：漏登、幽灵（源码已改干净却还挂着）、
  标签不符；第四列必须是本轮实测数值。
  为什么不拿它替代缺口表：**"有没有夹具"和"能不能安全自动跑"是两件事** —— `verify-backend` 有夹具、
  也带 DELETE，它在骨架里 rc=2 停在门口，所以既在册又安全。
- 判据自身（`check-cli-entrypoints.mjs`）**不入豁免面**：它必须同时出现在登记面和覆盖面（G7）。
- **四类覆盖，别混为一谈**（第二十五、二十六、三十轮补齐）：
  ① **判据路径真跑**（上表口径，`PROBED` 15 条）= 在真仓上跑一次、断言 rc=0 且有结论 —— 证明"门禁会判"；
  ② **缺输入面真跑**（把 `scripts/` 拷进只有它的空目录）= 23 个门禁类入口 + 非门禁可探针项，
     断言 rc≠0 且首行是自家诊断而非裸栈 —— 证明"没输入时不会装绿"；
  ③ **零分母真跑**（第二十六轮：镜像整棵目录树、除 `scripts/` 外**每个文件写 0 字节**）= 同上分母，
     断言 rc≠0 且不崩栈 —— 证明"输入在、对象为空时也不装绿"。② 拦不住 ③ 那一类：
     `requireInputs` 只看存在性，空 `db/migrate-*.sql` 照样过关。
  ④ **非门禁面换分母**（第三十轮）= ②③ 两法原样施加到"非门禁类 ∩ `classifyRisk` 为空"的入口上。
     这一腿的收益当场兑现：`scan-secrets`（密钥扫描）在零跟踪文件的仓库里打印
     **「✅ 全仓密钥扫描通过，未发现问题。」并 exit 0** —— 与真扫过 632 个文件的输出逐字相同，
     病了 29 轮没人发现，只因它不是 `verify:*`。同法另抓到 `gen-api-doc`（缺契约时裸栈
     `node:fs:441`）与 `check-catalog-facts`（缺 `db/seed.sql` 时裸栈）。
  ②③④ 都不替代 ①：所以 `## 不可子进程豁免` 三行仍然挂着。
- **缺输入/零分母的统一出口 = `scripts/lib/preflight.mjs`**：`bail` / `requireInputs` / `requireParams` /
  `requireJson` 四种说法走同一条打印（`[label] 环境不满足：<原因> ⇒ …（rc=2）`）；退出码 **2=环境不满足、
  1=判出违规、0=通过**。第二十六轮把原先 6 个自带文案的门禁（"参数缺失"/"环境不满足"两套写法）并进这一条。
- 缺输入面基线（第二十五轮，修之前）：当时 22 个门禁类入口里 **8 个甩裸栈、1 个静默放行**
  （`check-licenses` 在没有 package.json 时打印「0 个生产依赖（含传递）全部 … 白名单 ✅」并 exit 0）。
- 零分母基线（第二十六轮，修之前）：当时 22 个里 **2 个 rc=0 + 2 个裸栈** ——
  `check-schema-drift` 打印「==== 结果: 0 通过 / 0 失败 ====」并 rc=0（迁移文件在、解析出 0 个对象），
  `check-import-cycles` 在 0 字节源码上报"扫描模块: 84 个 / 未检测到循环依赖"并 rc=0（**0 条边的图上"无环"是真的，
  但它什么也没证明** ⇒ 现要求 import 边 ≥10，实测本仓 src/ 单侧 275 条），
  另两个（`check-error-semantics`/`verify-backend`）因空 `package.json` 让 Node 先崩在 `package_json_reader`。
  现在 ②③ 各 23/23 均为 rc≠0 且首行为诊断。
- **覆盖地板**：23

## 已知缺口

| 脚本 | 为什么还没有子进程夹具 |
| --- | --- |
| check-pr-has-tests.mjs | 要 `gh pr list`（网络+鉴权），且它是**看守型**：按头注设计永远 exit 0（骨架里实测 rc=0、1s，无开放 PR 时打"这不是通过，是空集"）⇒ 探针的 rc≠0 断言对它天然不成立。每轮 push main 时在 `dispatch.yml:44` 以真命令跑过（不在 PR job 里，本轮更正此行的旧说法） |
| ci-status.mjs | 线上只读查询，**通道是 curl 不是 gh**（本机 node fetch 不走系统代理，见其头注；本轮更正旧说法）。骨架里实测 9s 并打印真 run 36299454141 ⇒ 跑它等于测 GitHub 可用性，不是测代码 |
| gen-api-doc.mjs | 每次运行**改写** `docs/API.md`（=受版本控制的产物），spawn 会弄脏工作树；漂移已由 `verify:contract` 双向对账兜住。本轮补 `requireJson`+结构校验：缺契约从裸栈 `node:fs:441` 改为 rc=2，实测骨架里不留 `docs/`。同族的 `api-response-contract.mjs --write` 也会改写基准，故只挂 `--write` 别名进登记面，其读侧（`verify:response`）已在 PROBED 里真跑 |
| local-api-stub.mjs | 常驻 HTTP 服务：本轮在骨架里实测**真监听 :5182，`timeout 30` 才杀掉（rc=124）**。它由 `test:stub` 的 Playwright 链以真进程拉起（e2e 覆盖入口） |
| migrate.mjs | 会 `d1 execute --remote` **写线上库**（迁移/基线），夹具侧绝不能碰真库；骨架里实测 rc=1（"未找到本地 wrangler…先 npm ci"）；迁移正确性由 `verify:migrate-replay` 在一次性内存 SQLite 里重放同一套迁移 |
| purge-security-events.mjs | 破坏性运维命令（`DELETE FROM security_events … --remote`）。**本轮实测**：修前它在无 tty 下 1s 内直接进入远端 DELETE；现按 `migrate.confirmRemote` 口径要求显式 `--yes`，无授权时 rc=2 ⇒ 用法改成 `npm run maintain:purge-events -- --yes` |
| smoke-deploy.mjs | 打线上端点（实测 2s，首行 `PASS 静态站 https://supermarket-web.pages.dev/`），部署后才有效，由 `npm run smoke` 在部署后跑。注意：CI 的部署后冒烟是 `ci.yml` 里**内联 curl**（`_health` + `getPublicCategories`），与本脚本不是同一份实现 ⇒ 两处判定会漂移，已记入本轮改进清单 |
| uptime-check.mjs | 线上探测（实测 13s，打 `/_health` 并解析 JSON），本地 spawn 只会测网络。CI 的 `uptime.yml` 以真命令跑它 |

## 不可子进程豁免

| 脚本 | 为什么不能 spawn（实测依据） |
| --- | --- |
| check-bundle-size.mjs | 读 `dist/` 产物；CI 顺序是 build(ci.yml:151) → check-bundle-size(ci.yml:158)（本轮按路径重测更正行号），而 `npm test` 时点产物还没生成 ⇒ 探针必假红。入口已在 CI 以真命令跑过 |
| check-functions-build.mjs | esbuild 冷编译实测 9.0s（本地 9044ms），塞进 `npm test` 会把单测拖成分钟级；且它经 wrangler 起编译。已在 `npm run verify` 与 CI（ci.yml:165）以真命令跑过 |
| verify-release-parity.mjs | 缺 `PARITY_AFTER_TS` 起点时**按设计 rc=2**（fail-closed，"没有起点就不判'看起来一样'"），探针的 rc=0 断言对它不成立；且比对要拉两端线上产物（网络）。`release-parity.yml:71` 以真命令跑 |

## 风险分类（自动探针不得 spawn；标签由 classifyRisk 从源码推导，第四列必须是实测）

| 脚本 | 风险特征 | 为什么不能自动 spawn + 本轮实测依据 |
| --- | --- | --- |
| check-backup-liveness.mjs | gh-cli | `gh api` 线上只读；骨架实测 rc=2（0s，缺 GITHUB_REPOSITORY/BACKUP_WORKFLOW_ID）⇒ 停在门口，不发请求 |
| check-catalog-facts.mjs | network-fetch | `--live` 分支才 `fetch` 线上 `/pub`；本轮补 `requireInputs`，骨架实测 rc=2（1s，缺 `db/seed.sql`），修前是裸栈 |
| check-functions-build.mjs | wrangler | 经 wrangler/esbuild 编译，冷启动实测 9.0s；骨架 rc=2（0s，缺 node_modules/wrangler） |
| check-pr-has-tests.mjs | gh-cli | `gh pr list` 要鉴权且真打 API；看守型按设计 rc=0 ⇒ 探针无法用退出码断言它 |
| ci-green-contract.mjs | gh-cli | 要 gh 查 run 结论；骨架 rc=1（0s，"读不到合法的 .ci/contract.json"）。入口由 `tests/ciGreenContract.test.js` 的 12 条子进程夹具覆盖（喂假 ref 行，不打网络） |
| ci-status.mjs | network-fetch | 实测 9s 且打印真 run 数据（curl 直连 api.github.com）⇒ 探针跑它等于测网络 |
| gen-api-doc.mjs | writes-artifacts | 运行即改写 `docs/API.md`；本轮实测骨架里 rc=2 且不产出 `docs/` |
| local-api-stub.mjs | http-server | 实测真监听 :5182，需 `timeout 30` 才终止（rc=124）⇒ spawn 必挂到超时 |
| migrate.mjs | wrangler | `d1 execute --remote` 会写线上库；骨架 rc=1（0s）停在"未找到本地 wrangler" |
| purge-security-events.mjs | sql-delete, wrangler | **本轮实测到的真缺陷**：修前无 tty 也照样把 `DELETE FROM security_events` 打到远端 D1（删的是审计日志）。现需显式 `--yes`，骨架实测 rc=2 |
| smoke-deploy.mjs | network-fetch | 实测 2s 打通线上站点（首行即 `PASS 静态站 …`） |
| uptime-check.mjs | network-fetch | 实测 13s 打线上 `/_health` 并回 `{"status":"ok","db":"ok",…}` |
| verify-backend.mjs | sql-delete | 夹具链里确有 DELETE（清测试数据）；骨架实测 rc=2（0s，缺 `db/schema.sql`）⇒ 探针跑不到删数据那段。它同时是 PROBED 第 11 条 |
| verify-release-parity.mjs | network-fetch | 要拉两端线上产物比对；缺起点按设计 rc=2。另见「不可子进程豁免」 |

## 为什么"CI 里真跑过"算减轻因素、但不抵消缺口

被豁免/挂账的入口大多确实在 CI 或部署流程里以 `node scripts/X.mjs` 真跑过 —— 入口崩了 CI 就红，
这是**真实回执**，不是自觉。但两类情形它兜不住，所以缺口仍要挂账、不许直接销账：

1. **pre-push / 本地专用入口**（如 `ci-green-contract.mjs`）：CI 根本不跑它，崩了也永远"看起来在工作"；
2. **只在特定分支/环境下才跑**的入口（`smoke-deploy` / `uptime-check` / `verify-release-parity`）：
   红需要一次真部署或一次真故障，反馈周期以天计。

判据实现：`scripts/check-cli-entrypoints.mjs`（G1 分母非零 / G2 两表⇄实测双向对账 / G3 理由非空且不含 TODO /
G4 棘轮地板 / G5 hook 目标在册 + 生效前提已登记 / G6 **本地钩子入口必须有夹具**（pre-push 那类 CI 不跑的） /
G7 判据自身入面 / G8 门禁类必须真跑或具名豁免 / G9 **派生风险⇄风险分类表双向对账**）
夹具：`tests/cliEntrypoints.test.js`（97 条 = 15 条判据路径真跑 + 25 条缺输入面 + 25 条零分母 + 合成仓
G1~G9 双向变异 + classifyRisk 三向（含"注释里的词不算、行尾注释仍算"这对对偶）+ preflight 出口件 + 真仓互洽）
