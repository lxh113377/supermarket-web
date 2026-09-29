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
  出现的 `scripts/X.mjs`，逐条标注来源（`npm:别名` / `hook:文件` / `ci:文件`）。本轮实测 **36** 个，
  其中门禁类 **24** 个、非门禁 **12** 个；被子进程真跑 **25** 个。
- **门禁类入口**：npm 别名形如 `verify:*` / `check:*`（裸 `verify` 是聚合命令，不算入口）。
- **覆盖（第三十一轮收紧后的口径）**：`tests/**` 里既有 `spawn`/`execFile`/`execSync`/`fork` 调用，
  又满足"脚本文件名**沿调用链到达执行点**"之一：① 写在 spawn 实参里；② 写在被 `for..of` 消费的数组字面量里
  （`const PROBED = [...]`）；③ 写在 `const X = join(...,'x.mjs')` 同一行且 `X` 被喂进执行点；
  ④ 写在**本地 runner**（体内确有 spawn 的封装，如 `runGate(DOCS, dir)`）的实参里。
  只 `import` 纯函数**不算覆盖**（那测不到入口，第二十四轮的教训本体）；
  **只在断言里提到文件名也不算**（`expect(x === 'a.mjs')`、`toContain('a.mjs')`）——这是本轮治的假覆盖：
  上一版规则下一条负向断言就能给一道从没跑过的门禁记上"已跑过"，把它的缺口行洗成"幽灵登记"。
  收紧后真仓覆盖数不变（24 ⇒ 同批 24），说明该漏洞此前只被我自己踩到一次、未被系统性利用。
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
  ① **判据路径真跑**（上表口径，`PROBED` 16 条）= 在真仓上跑一次、断言 rc=0 且有结论 —— 证明"门禁会判"；
  ② **缺输入面真跑**（把 `scripts/` 拷进只有它的空目录）= 31 个可探针入口（第三十一轮起含 `scan-secrets`、
     `list-uncovered`、`check-memory-volume`，第三十二轮再起 **+5 个自述"停在门口"的危险项**），断言 rc≠0 且首行是自家诊断而非裸栈 —— 证明"没输入时不会装绿"；
  ③ **零分母真跑**（第二十六轮：镜像整棵目录树、除 `scripts/` 外**每个文件写 0 字节**）= 同上 31 条，
     断言 rc≠0 且不崩栈 —— 证明"输入在、对象为空时也不装绿"。② 拦不住 ③ 那一类：
     `requireInputs` 只看存在性，空 `db/migrate-*.sql` 照样过关。
  ④ **非门禁面换分母**（第三十轮）= ②③ 两法原样施加到"非门禁类 ∩ `classifyRisk` 为空"的入口上。
     这一腿的收益当场兑现：`scan-secrets`（密钥扫描）在零跟踪文件的仓库里打印
     **「✅ 全仓密钥扫描通过，未发现问题。」并 exit 0** —— 与真扫过 632 个文件的输出逐字相同，
     病了 29 轮没人发现，只因它不是 `verify:*`。同法另抓到 `gen-api-doc`（缺契约时裸栈
     `node:fs:441`）与 `check-catalog-facts`（缺 `db/seed.sql` 时裸栈）。
  ②③④ 都不替代 ①：所以 `## 不可子进程豁免` 三行仍然挂着。
- **同族的另一道闸：`scripts/check-memory-volume.mjs`（`npm run verify:volume`）** —— 记忆卷单文件 4KB 上限。
  对标件 `pre-commit/pre-commit-hooks` 的 `check-added-large-files`（阈值显式 `--maxkb`、默认只管
  "staged for addition"、`--enforce-all` 才扩面）。为什么要在仓内再立一道：`handoff.py volume` 是**报告型**
  外部工具（dry-run 不拦），结果第三十一轮我写的 `07-next-steps.part42.md` 超到 4,873B 照样提交成功。
  现在：pre-commit 管新增（暂存面，无对象时打"跳过"而不是"通过"），CI 用 `--all` 管全量，
  且"每个卷都 0 字节"按 **环境不满足 rc=2** 处理（那不是"都在预算内"，是没有对象）。
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
- **分母地板**：25（第三十一轮立 G10）。第三十二轮分母实测涨到 31（放进 5 个"已证明停在门口"的非门禁危险项），
  但**地板不动** ⇒ headroom +6 显式化：按本仓铁律，把地板抬到刚好等于当前值＝冻结增长，
  而且解禁那 5 项若哪天被悄悄改回面外，地板也抓不到（抓它的是 G11 与测试里点名的 admitted 清单）。
  分母＝"允许被自动探针 spawn 的入口数"，由 npm 别名命名 + 源码风险特征
  共同推导（`@probe-safe` 声明可让危险项回面）⇒ 有人把 `verify:x` 改名成 `report:x`（而脚本里正好有 fetch）就会让分母**静默缩短**，
  覆盖数与缺口数一起变好看而 CI 照样绿。所以地板要钉在分母上；缺这一行＝判红，不给"没基准"留空子。）

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
| check-d1-remote-usage.mjs | 真跑 = 打 Cloudflare GraphQL + 起 `wrangler d1 info` 子进程（本轮实测：无 flag 骨架 **rc=0 / 7.7s**，两通道各走一遍）⇒ 跑它测的是服务商可用性，不是代码；带 `--write` 还会改写受版本控制的 `docs/d1-remote-usage.json`。它**不是**门禁类别名（`report:d1-usage`）⇒ 不占 G8 的门禁面；纯判据由 `tests/d1RemoteUsage.test.js` 注入读数覆盖（U5 三向的四种出口各有断言），入口通道没有 fixture 注数面 ⇒ 记本缺口，CI 侧它是 advisory（`continue-on-error`，理由写在 ci.yml 该步注释里）|

## 不可子进程豁免

| 脚本 | 为什么不能 spawn（实测依据） |
| --- | --- |
| check-bundle-size.mjs | 读 `dist/` 产物；CI 顺序是 build(ci.yml:151) → check-bundle-size(ci.yml:158)（本轮按路径重测更正行号），而 `npm test` 时点产物还没生成 ⇒ 探针必假红。入口已在 CI 以真命令跑过 |
| check-functions-build.mjs | esbuild 冷编译实测 9.0s（本地 9044ms），塞进 `npm test` 会把单测拖成分钟级；且它经 wrangler 起编译。已在 `npm run verify` 与 CI（ci.yml:165）以真命令跑过 |
| verify-release-parity.mjs | 缺 `PARITY_AFTER_TS` 起点时**按设计 rc=2**（fail-closed，"没有起点就不判'看起来一样'"），探针的 rc=0 断言对它不成立；且比对要拉两端线上产物（网络）。`release-parity.yml:71` 以真命令跑 |

## 非 node 入口（别名引用了探针起不了的入口；**第四十五轮的 G12 只看目录级漂移，这一张表看的是扩展级失踪**）

第四十六轮一手分母：把 `package.json` 别名里的 `scripts/<file>` 按宽扩展名（`mjs|cjs|js|ts|py|sh`）取一遍，
不属于 `.mjs` 的恰好 **1** 条 ⇒ 它当时既不在登记面（`collectRegistered` 的正则只收 `.mjs`），
也不在缺口/豁免面，`.github/workflows/*` 里 grep `verify:images` = **0** 处 —— 只有人手敲时才跑。
判据 = **G13**：别名引用的非 .mjs 入口必须在下面这张表里登记真实命令 + 可证伪理由，否则判红；
登记了但别名里不再引用 ⇒ 幽灵判红。**不许**直接把它塞进 node 探针分母：实测 `node scripts/verify_images.py`
得 `ERR_UNKNOWN_FILE_EXTENSION` 裸栈 ⇒ ②③ 两法会把"解释器不对"读成"入口不会 fail-closed"，那是判据在说谎。
**R47 的正解本轮落地了，但落法与"给 node 探针加解释器"不同**：一条门禁该有的两件事是
**①能红**（`scripts/verify_images.py` 的 `main()` 原本从不 `sys.exit`，实测缺图面印"覆盖率 66%"却 rc=0 ⇒
本轮改出三档 0/1/2）与 **②接进阻断链**（`npm run verify:images` 现已进 `verify` 聚合链与 `ci.yml`，
配 `actions/setup-python@v5`，命令形态仍只有别名一处）。node 探针面依旧不收 `.py` —— 它由
`tests/verifyImages.test.js` 用 python 自己起子进程来覆盖（8 条腿含一条变异体），而不是骗 node 去 spawn 它。

| 脚本 | 真实命令 | 为什么探针不能 spawn（实测依据） |
| --- | --- | --- |
| verify_images.py | `python scripts/verify_images.py` | 别名 `verify:images`；实测 `node scripts/verify_images.py` ⇒ `ERR_UNKNOWN_FILE_EXTENSION` 裸栈（@2026-09-28 本机）；文件在盘且 `main()` 现返回三档 rc（0 全绿 / 1 缺失或无效 / 2 没有对象可判，合成面实测 4 档形态各跑过）；`verify` 聚合链引用 1 处 + `ci.yml` 引用 1 处（setup-python 后跑 `npm run verify:images`）⇒ 不进 node 面，改由 `npx vitest run tests/verifyImages.test.js` 覆盖 |

## 风险分类（默认不自动 spawn；标签由 `classifyRisk` 从源码推导；带 `@probe-safe` 声明且本表写"已证明停在门口"的才回到分母）

第三十二轮把这层判断交给**被试对象自述**（口径借 `golang/go` 的 `-short`：`testflag.go:67`
"tell long-running tests to shorten their run time" —— 条件写在测试里，框架只做机械核对）。
所以：✅ 的行必须能在脚本源码里找到独占一行的 `// @probe-safe: <实测依据>`；
两边不一致（源码有声明表没写、表写了源码没声明、声明里没有实测数字）都由 **G11** 判红。
G11 认的是"已证明停在门口"这个整词，不是子串 —— 否则 ❌ 行的"未停在门口"会被误判成声明。

| 脚本 | 风险特征 | 实测依据 + 是否回到探针分母 |
| --- | --- | --- |
| check-backup-liveness.mjs | gh-cli | ✅ 已证明停在门口：骨架实测 rc=2 / 0s（缺 GITHUB_REPOSITORY 即 bail），`gh api` 在其后 ⇒ 回到分母 |
| check-cron-health.mjs | gh-cli, writes-artifacts | ✅ 已证明停在门口：骨架**实测 rc=2 / 0.2s**（现测 156ms：缺 `GITHUB_REPOSITORY` 即在门口 bail），`gh api` 与 `writeFileSync(join(ROOT, REGISTRY))` 都在其后 ⇒ 回到分母。它的**入口**由 `tests/cronHealth.test.js` 以 `--fixture` 注入合成读数被子进程真跑（三档退出码 0/1/2 各一条：不碰网络、不改受版本控制的册） |
| check-d1-remote-usage.mjs | network-fetch, wrangler, writes-artifacts | ❌ **没停在门口**（本条否证了我给它写的初稿"缺登记册即 rc=2"）：无 flag 骨架**实测 rc=0 / 7.7s** —— CF GraphQL 与 `wrangler d1 info` 各真打了一遍，只因不带 `--write` 才没落盘 ⇒ 探针跑它等于测 Cloudflare 可用性，永不进自动面。判据本体由 `tests/d1RemoteUsage.test.js` 注入读数覆盖（U5 三向的四种出口各有断言） |
| api-response-contract.mjs | writes-artifacts | ❌ 不声明停在门口：**读侧骨架实测 rc=0 / 0.3s**（它就是 `verify:response` 每轮真跑的那条，也是 PROBED 成员）。`writes-artifacts` 只在显式 `--write`（= `gen:response-contract` 别名）时成立。本轮 R42-H2 把"目标是表达式/常量"的形态认出来之后它才入表 ⇒ 此前它挂"零风险"是**漏登**，不是它变危险了 |
| check-catalog-facts.mjs | network-fetch | ✅ 已证明停在门口：rc=2 / 1s（缺 `db/seed.sql`）；`--live` 才走 fetch ⇒ 回到分母 |
| check-escape-hatch-log.mjs | gh-cli | ✅ 已证明停在门口：账本缺失时骨架**实测 rc=2 / 0.124s**（判 UNVERIFIED 即 bail），真仓默认面**实测 rc=0 / 0.108s**；用 PATH 前置假 `gh`（被调即写日志并 exit 127）复跑默认面 ⇒ **假 gh 零调用**（@2026-09-29 本机）⇒ `gh api` 只在显式 `--remote`（= `report:escape-hatch-remote` 别名）分支才走，探针跑默认面不碰网络。它同时是 PROBED 成员（`verify:escape-hatch` 每轮真跑） |
| check-functions-build.mjs | wrangler | ✅ 已证明停在门口：rc=2 / 0s（缺 `node_modules/wrangler`）；esbuild 冷编译实测 9.0s 在其后。门禁类，CI 必跑 |
| check-live-shape.mjs | network-fetch | ✅ 已证明停在门口：骨架实测 rc=2 / 0s（`existsSync(functions/_health.js)` 拦在 fetch 之前即 bail），线上请求在其后才走 ⇒ 回到分母。真仓实测 4s 回 HTTP=200；CI 里是 **advisory**（`continue-on-error`）——线上取不到判 UNREACHABLE 而不折算成通过 |
| collect-live-perf.mjs | network-fetch | ✅ 已证明停在门口：默认**只出计划不动手**，实测 rc=0 / 0.07s（@2026-09-29 本机，走完整解析链后停在 DRY 出口），`fetch`/`spawnSync`/`mkdirSync`/写盘全在其后的显式 `--run` 分支里。一手代价：本件首版没有默认 DRY，裸调用**实测 rc=1 / 219s 且真打了 6 份 Lighthouse 落盘**——那正是户内「探针参数会写盘」的形态，被我自己撞了一次才补上门。另由 `tests/livePerfCollect.test.js` 断言裸调用后样本目录零新增、连目录都不许建（合成面用假浏览器与假包树驱动，不读本机安装） |
| check-pr-has-tests.mjs | gh-cli | ❌ 未停在门口：无开放 PR 时按设计 rc=0（看守型）⇒ 探针的 rc≠0 断言对它不成立，永不进自动面；每轮 push main 在 `dispatch.yml:44` 真跑 |
| ci-green-contract.mjs | gh-cli | ✅ 已证明停在门口：rc=1 / 0s（读不到 `.ci/contract.json` 即 fail-closed），gh 调用在其后 ⇒ 回到分母 |
| ci-status.mjs | network-fetch | ❌ 未停在门口：实测 9s 真打 api.github.com（通道是 curl —— 本机 node fetch 不走系统代理） |
| gen-api-doc.mjs | writes-artifacts | ✅ 已证明停在门口：rc=2 / 0s（`requireJson` 拦在渲染之前），实测骨架里不产出 `docs/` ⇒ 不弄脏工作树，回到分母 |
| local-api-stub.mjs | http-server | ❌ 未停在门口：实测真监听 `:5182`，要 `timeout 30` 才终止（rc=124）⇒ spawn 必挂 |
| migrate.mjs | wrangler | ✅ 已证明停在门口：rc=1 / 0s（"未找到本地 wrangler…先 npm ci"），`d1 execute --remote` 在其后 ⇒ 回到分母 |
| purge-security-events.mjs | sql-delete, wrangler | ✅ 已证明停在门口：无 `--yes` 时 rc=2 / 0s 直接 bail —— 修前实测 1s 内就把 DELETE 打到远端 D1（删审计日志）⇒ 回到分母 |
| smoke-deploy.mjs | network-fetch | ❌ 未停在门口：实测 2s 先打线上（首行 `PASS 静态站 …`）再失败 |
| uptime-check.mjs | network-fetch | ❌ 未停在门口：实测 13s 真打线上 `/_health`（回 `{"status":"ok","db":"ok",…}`） |
| verify-backend.mjs | sql-delete, writes-artifacts | ✅ 已证明停在门口：rc=2 / 0s（缺 `db/schema.sql`）⇒ 夹具链里的 DELETE 分支走不到。它同时是 PROBED 第 11 条。`writes-artifacts` 是本轮 R42-H2 新认出来的：`writeFileSync(SQL_BASELINE_PATH, …)` 的目标走 `join(root,'docs',…)` 表达式，旧口径（只认字面量/裸标识符）推不出 ⇒ 标签补上，登记面与派生面重新相等 |
| verify-release-parity.mjs | network-fetch | ✅ 已证明停在门口：缺 `PARITY_AFTER_TS` 起点时按设计 rc=2 / 0s（"没有起点就不判看起来一样"）。另见「不可子进程豁免」 |
| check-branch-protection.mjs | gh-cli | ❌ **未停在门口**：真跑会打 api.github.com（需 gh 鉴权）⇒ 不进 ②③ 自动面；它的**入口**由 `tests/branchProtection.test.js` 以 `BRANCH_PROTECTION_JSON` 注入读数的方式被子进程真跑（7 条，含四态与变异体） |
| check-d1-roundtrips.mjs | writes-artifacts | **这一行的标签是"跑出来的"，不是推出来的**（第四十三轮 `check-judge-side-effects` 一手）：`--update-write-quota` 实测 rc=0 且改写受版本控制的 `docs/d1-write-quota.json`，而静态推导对它推不出任何东西（目标常量 `WRITE_QUOTA_FILE` 是 `lib/d1-quota.mjs` import 进来的）⇒ 它此前挂"零风险"是漏登，不是它不危险。它同时是 PROBED 成员（`verify:roundtrips`），已在 CI 真跑，故不需要 `@probe-safe` 声明 |
| check-doc-commands.mjs | writes-artifacts | ❌ 不声明停在门口：只有显式 `--update` 才改写 `docs/doc-commands.json` 与 README 的门禁块（两处都受版本控制）；默认 args 只读，本轮真面实测 rc=1 / 6 条判据 4 通过 2 失败（D5+D6 同点名 `check:judge-side-effects`）。它在文档面为空时由 **D1 判红**而不是 rc=2 ⇒ 探针的"缺输入即 bail"形状对它不成立 |
| check-judge-side-effects.mjs | writes-artifacts | ❌ 不声明停在门口：只有 `--update` 重写 `docs/judge-side-effects.json`；无 flag 的真跑法把每个候选解进 `os.tmpdir()` 的一次性 `git archive` 快照里跑（本机第四十六轮实测：候选 9 件、**1m37s**（修前 6m49s，根因＝读数面把探针注入的 node_modules 也算进去）、工作树字节零改动）⇒ 慢且要 git+tar，不进 ②③ 自动面。本轮新增件在 HEAD 里还没有 ⇒ 它**对自己的探针**记 UNVERIFIED 并具名在册（`unprobeable`），入库后自动可探 |
## 为什么"CI 里真跑过"算减轻因素、但不抵消缺口

被豁免/挂账的入口大多确实在 CI 或部署流程里以 `node scripts/X.mjs` 真跑过 —— 入口崩了 CI 就红，
这是**真实回执**，不是自觉。但两类情形它兜不住，所以缺口仍要挂账、不许直接销账：

1. **pre-push / 本地专用入口**（如 `ci-green-contract.mjs`）：CI 根本不跑它，崩了也永远"看起来在工作"；
2. **只在特定分支/环境下才跑**的入口（`smoke-deploy` / `uptime-check` / `verify-release-parity`）：
   红需要一次真部署或一次真故障，反馈周期以天计。

判据实现：`scripts/check-cli-entrypoints.mjs`（G1 分母非零 / G2 两表⇄实测双向对账 / G3 理由非空且不含 TODO /
G4 棘轮地板 / G5 hook 目标在册 + 生效前提已登记 / G6 **本地钩子入口必须有夹具**（pre-push 那类 CI 不跑的） /
G7 判据自身入面 / G8 门禁类必须真跑或具名豁免 / G9 **派生风险⇄风险分类表双向对账** / G11 **@probe-safe 声明⇄风险表⇄源码特征三方对账** /
G10 **探针分母地板**（改别名或加危险特征都会让分母静默缩短 ⇒ 当场红）、G12 **取数面逐来源非空**（登记面由
npm 别名／`.githooks`／workflows 三个来源合成，只判"总数非零"时任一面归零照样绿 ⇒ 三个来源各出一行分母；
本轮真面 npm 45／hook 4／ci 7。口径借 `check-limit-provenance` 的 C7b：声明了却零贡献的来源必须点名，
要么修取数要么删声明 —— 第四十一轮"往根表加 `scripts/` 是 74→74 的静默空操作"那条欠账的第一次带数字收口）、
G13 **别名里的非 .mjs 入口不得结构性失踪**（同一族往下一格：G12 管"某个来源静默归零"，G13 管"整个扩展名看不见"。
真面分母 1 条：`verify:images` → `python scripts/verify_images.py`；它既不在登记面也不在缺口/豁免面，
workflows 里 grep 它为 0 处 ⇒ 只有人敲才跑。**不许**直接放它进 node 探针面：实测 `node scripts/verify_images.py`
得 `ERR_UNKNOWN_FILE_EXTENSION` 裸栈 ⇒ ②③ 两法会把"解释器不对"读成"入口不会 fail-closed"。
第一步只要求它**登记**（真实命令 + 可证伪理由），解释器分派的腿待 R47）、
G14 **采集目录本身要有正向读数**（再往下一格：G1~G13 判"登记/覆盖/风险对不对"，却没有任何一条判"采集器到底有没有对象可喂"。
一手形状 = `collectCovered()` 第一行 `if (!existsSync(dir/tests)) return covered`：目录被改名/移出 ⇒ 覆盖面**静默空集**，
而 G4 地板拦到 23（现 35）⇒ 最多可悄悄少掉 12 个入口的"跑没跑过"而账面全绿。`testFace()` 印出 `tests/` 的文件数与
其中真起子进程的个数；三种"读不动"（调用方没喂 face / 目录不存在 / 目录空）一律记 **UNVERIFIED**，
**不得**印成"结论为否"——把"没量到"写成"量到了零"是给后人留假证据。
退出码分相 `verdictOf()`：**0 全绿 / 1 判出违规 / 2 证据失效**（与 `check-judge-side-effects` 的 S4/S6 户内同口径；
形状借 `pytest-dev/pytest` 的 `ExitCode.NO_TESTS_COLLECTED` —— 它在收集后先问 `session.testscollected == 0`，
不让"什么都没收到"顺着 `return None` 掉进"通过"，@2026-09-28 取回 `src/_pytest/main.py:392` 核对）。
2 与 1 都得拦，但调用方要能分辨"这扇门说有东西坏了"和"这扇门今天根本没看"；门面行自报 `rc=N`，零输入（rows 为空）记 1 不记 0）
夹具：`tests/cliEntrypoints.test.js`（条数**不在此写死**——写死即第二真相源，以 `npx vitest run tests/cliEntrypoints.test.js`
当场输出为准；构成 = 判据路径真跑（PROBED 名册）+ 缺输入面 + 零分母 + 合成仓 G1~G14 双向变异 + 覆盖面口径三向
（真跑记账 / 死数组与仅提到不记账）+ classifyRisk 三向 + scan-secrets 三种分母形状 + preflight 出口件 + 真仓互洽）。
采集层自己另有夹具：`tests/bracketLexer.test.js`（第四十五轮）—— 括号配对扫描是"覆盖采集"的眼珠子，
它坏了没人看得见，所以正例（结构已知的输入给出手算配对数）、变异体（把修复还原成旧写法必须翻红）、
已知盲区（模板串插值少记 / 正则字面量多记）三类各钉一条，另加一条**活体腿**：真读 `tests/docCommands.test.js`
本文件，断言当年被吞掉的那处 `spawnSync(` 现在配得上对。新闸自身：`tests/memoryVolume.test.js`
（条数同上不写死；含"超限却判绿"的变异体、"加指针后仍 ≤4KB"的守恒断言、V2b 撕裂读的重测腿）。
