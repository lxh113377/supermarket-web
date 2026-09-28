# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

## [未发布]

### 2026-09-28 追加六十三（对标第四十九轮：把门禁验到"它真会拦"，而不是"它跑过了"）

- **R49-H1 演习落地，两侧都有回执**。一次性分支 `drill/r49-image-gate` 的提交全程用 plumbing 造
  （`git cat-file blob origin/main:src/data/products-seed.ts` → 插入一行带 `DRILL-R49` 注释的哨兵
  `{ order: 9001 }` 而不给图片 → 临时 `GIT_INDEX_FILE` 做 `read-tree`/`update-index`/`write-tree`/`commit-tree`）
  ⇒ **工作树与共享索引零改动**（并行会话在同一棵树上，不许把我的实验写成它的在途改动）。
  push 后 `workflow_dispatch` 该 ref ⇒ run `36398941915` = `completed/failure`，
  且**唯一**非 success 的步骤是 `Product image assets gate (npm run verify:images)`，日志原文：
  `[verify-images] FAIL 缺失 1 / 无效 0 / 应有 55 ⇒ 合计 1 件不可交付`（55 = 真实 54 + 哨兵 1）。
  ⇒ 这次拿到的是"会拦"和"只红该红的"两条读侧，而不只是"CI 里有这一步"。
  形状借 `golang/go :: src/cmd/go/testdata/script/embed.txt`（4,716B / blob `dcd250549b`）：
  它把失败当断言写（`! go build -x` + `stderr '^x.go:5:12: pattern ...$'`）。
- **同一条门禁里又挖出两个缺陷，都修了**（`scripts/verify_images.py`）：
  ① **取数面没按数据流划**：`order:` 这个键在本仓有**两个语义** —— `categories` 用它排分类顺序（实测 11 处）、
  `products` 用它当图片文件名（实测 54 处）。旧 `load_expected_orders()` 扫整文件，今天靠"号段重叠 + 去重"侥幸还得 54；
  但只要有人给分类加一个超出商品最大号的 `order`，判据就会报出一条从未发生过的"缺图"。
  现在只扫 `export const products` 之后那段，**锚点丢失即 rc=2 并点名，禁止退回整文件扫描**（退回就是把侥幸写成规则）。
  ② **反向半边没人量**：旧判据只问"seed 要的图在不在"，从不问"这些图是谁要的" ⇒ 真面实测有 1 张无主图
  `55.webp`。查现网 `getPublicProducts`：order 最大值正是 **55** ⇒ 它是**线上真在用的资产**，seed 只是种子。
  所以新增的是"⚠️ 无主图片 (1)"点名 + 结论行 `另有 1 张无主图…不拦，但请有人认领`，**不判红**：
  判红等于逼后来人删一张真图，而"删哪张"是归属决定（判据未经实测开的处方不许写成可复制动作）。
  夹具 `npx vitest run tests/verifyImages.test.js` 8 → **10 条**：categories 超号不得进分母（含锚点丢失的 fail-closed 半边）、
  孤儿点名但 rc 仍 0（对照腿：真缺一张仍必须 1）。真面复跑 `[verify-images] OK 54/54 全部为有效图片（另有 1 张无主图…）` rc=0。
- **计划外第五条：README 生成块非幂等**。`node scripts/check-doc-commands.mjs --update` 连跑三次 ⇒
  README 三个不同 sha（`c0653f55…` 起步），`gate-table:end` 与 `## 功能一览` 之间空行从 4 涨到 7。
  根因在字符串层：`renderGateTable()` 的数组以 `''` 结尾 ⇒ 返回值自带尾换行，而 `syncGateTable` 写回又加一个 `'\n'`、
  正则只吃掉一个换行 ⇒ 每次净增一行。修法＝尾换行归一；README 用内容通道修回 HEAD 字节
  （先断言 `git diff --numstat` == `3 0` 才动手，确认只多了空行、没吞别人的话）；
  修后三跑 sha 全等且 `git diff` 为空。夹具 `npx vitest run tests/docCommands.test.js` 15 → **17 条**，
  其中一条是**反向自证**：按缺陷写法跑一次必须真多出一行，否则幂等夹具自己就是空转。
  同行形状：`eslint/eslint :: package.json`（7,789B / blob `88e63439cea2`）有 `fmt:check = prettier --check .`
  ⇒ 生成物应当有"不等即红"的读侧（列 R50-H3，本轮不建，因为幂等夹具已兜住同一条缺陷）。
- **R49-H2 快照措辞 + 无消费者证明**：`docs/doc-commands.json` 的 `counts` 记 196 而当场 203 ⇒ 漂了 7 条却无人报错，
  因为没有任何判据读它。本轮把 `note` 改成明说"as-of 快照、禁止当现值引用"，并加三条夹具：
  措辞必须在（防 `--update` 丢字）、把 `counts` 换成垃圾值 ⇒ 六条判定逐项不变（这才叫零消费者）、
  对偶腿只改 `observed_utc` 让归档面到期 ⇒ 判定必须变（防上一条是"我传的东西整体没被读"的空转）。
- **R49-H3 覆盖率当场读数**：`npx vitest run --coverage` ⇒ 107 文件全绿，
  Statements 80.50 / Branches 73.52 / Functions 76.19 / Lines 82.26，对地板 79/72/74/80 ⇒ headroom 1.50~2.26pp
  （比第九轮的 ~2.1pp 收窄，原因是分母涨到 2,893 条语句而非覆盖率下降）。**本轮不动地板**并把读数写进
  `vite.config.js` 注释——并行会话在同一棵树提交，抬地板会把别人的合法改动拦成红。
- **本轮我自己的三条留痕（失败面同条登记）**：
  ① 主卷被我自己压到 **4,096B 整（零余量）** 才通过断言 —— 那正是卷 78 台账明令禁止的"压措辞续命"，
  已把整段轮次摘要下移到卷 81/82，并把这件事写回主卷头部；`check-memory-volume` 的 V3 现在只 WARN 不拦零余量，
  列为 R50 缺口（"贴线"与"贴死"必须可分）。
  ② 两次纯手滑都被工具当场拦住、未落错地方：`Edit` 的 `file_path` 少写一层目录（`File does not exist`）；
  python 内联里用 `b'...'` 包中文 ⇒ `SyntaxError: bytes can only contain ASCII literal characters`。
  ③ 又一次踩 MSYS `/tmp` 对 Windows python 不可见：`curl -o /tmp/prod.json` 后 python 读不到，
  改写到 `C:/Users/.../Temp/` 才拿到现网读数 —— 同族第五次，规则在案仍复发。

### 2026-09-28 追加六十二（对标第四十八轮：一条门禁"能红"与"有人看"是两件事）

- **R48-H1 `verify:images` 的判据自己一直是永绿的 ⇒ 改三档退出码并接进阻断链。**
  一手负控制（修复前）：合成面（seed 三个 `order:`、图片只有两张合法 WebP）印出「缺失图片 (1/3)｜覆盖率 66%」
  却 **rc=0**——`main()` 从不返回、`__main__` 也不 `sys.exit`；且 seed 读不到时旧代码退回 `range(1,50)`，
  等于"数据源坏了也照样能判"。本轮：`main()` 返回 **0 全绿 / 1 真有缺失或无效 / 2 没有对象可判**，
  删掉兜底；图片面失踪单独走 2 并印"空集不等于零覆盖"。四档形态全部实测（真面 `OK 54/54` rc=0、
  缺图 rc=1 点名 `FAIL 缺失 1 / 无效 0 / 应有 3`、无图片面 rc=2、`order:` 零命中 rc=2）。
  接线：`npm run verify:images` 进 `verify` 聚合链，`ci.yml` 加 `setup-python` + 同名步骤（命令形态仍只在别名一处）。
  形状取自 `kubernetes/kubernetes :: hack/verify-gofmt.sh:55,67`（两处 `exit 1`）与
  `psf/black :: src/black/__init__.py:372-379`（`--check` 三档：0 无改动 / 1 有改动 / 123 内部错误），
  @2026-09-28 经 `gh api` 取回原文（2,099B / `85bf76a9c1`；58,967B / `8b830d869e`）。
  夹具 `tests/verifyImages.test.js` **8 条**，含真入口回执（分母由 seed 现算）与变异体
  （`return 1` → `return 0` ⇒ 同一缺图面必须被读成"通过"）。
- **R48-H2 采集面 ⇄ 运行面的差集现在可读，且面由配置派生。**
  `runnerExcludes()` 现读 `vite.config.js` 的 `exclude`（真面 3 个 pattern），G14 追加
  `vitest 面 110 / 被排除面 7（其中起子进程 0 个 ⇒ 覆盖面暂未被污染）`；取不到配置时印 **`差集未知`**，
  不印"被排除面 0"。借鉴 `vitest-dev/vitest :: packages/vitest/src/defaults.ts:13,20`
  （`export const defaultExclude` 被同一配置对象消费，3,816B / blob `1aa7f251f0`）——**不在判据里抄第二份目录清单**。
  本轮**不改判定**（只加读数）：一手实测被排除的 7 个件里 spawn 计数为 0，为一件没发生的事改口径就是把判据写成预言。
  夹具 3 条：活体真面（两面之和 == 采集面）、合成反例（被排除面里放一个起子进程的件 ⇒ 必须点名"记账来自 Playwright"）、
  边界（无 `vite.config.js` ⇒ 未知）。
- **R48-H3 `CHANGELOG.md` 进文档判据取数面（先量再动）。**
  上轮我给自己写的 P0 里含一条**猜测**："历史条目（CloudBase 死命令）会让它一入面就恒红"。本轮实测：
  CHANGELOG 里命令式 code-span 137 条、涉及 6 个脚本名（盘上不存在 **0**）、28 个别名（不在册 **0**）⇒ 直接入 claim 面**零红**。
  入面后 `check:doc-commands` 提及 128 → **196**、claim 184 全部成立；随后新增别名 `check:syntax` 一进来，
  D5"在册却无人知晓"与 D6"README 门禁一览缺行"**同时点名**⇒ 两条反向对账腿真在干活（提及随之到 197，6/6 GREEN）。
  死命令其实在 `docs/implementation-plan-2026-08-08.md`，那里早已有 `archive_faces` + `exempt_until` 机制。
- **计划外第四条（机器型落点）：`scripts/check-staged-syntax.mjs` 接进 `pre-commit`。**
  动机是同一个自我破坏形态四轮里犯了 4 次（把"被保留内容的头几行"当成编辑锚 ⇒ 那几行消失），
  而它以前要等 4 分钟全链 verify 或一整条 CI 才现形。新闸判 **index 里的 blob**（`git cat-file blob :<path>`，
  不是工作树——并行会话可能已经把它改了），`.js/.cjs/.mjs` 走 `node --check`、`.py` 走 `py_compile`，
  `.ts/.tsx/.jsx` 作为**盲区在门面行明说**（由 oxlint + typecheck 负责），非工作树 ⇒ rc=2 环境不满足，
  暂存面为空 ⇒ 印"跳过（不是通过）"。夹具 `tests/stagedSyntax.test.js` **6 条**，含"工作树被改坏但暂存版本是好的 ⇒ 不该拦"
  与其反向半边（把工作树那份也 add ⇒ 必须翻红），以及变异体。接线即生效面：G1 登记面 47→**48**、
  子进程真跑 35→**36**、门禁类 31:28→**32:29**，`cli-entrypoints` 14/14 仍 GATE-PASS。
- **P-1 绑定表里的两处死数字改成指针**：`memory/agents.md` 原写"action 契约 23 个 / 47 断言"，
  @2026-09-28 实测为 `/web` 31 + `/pub` 8、后端 **152** 条断言通过（数字已过期两轮）⇒ 改为指向
  `npm run verify:docs` / `npm run verify:backend` 的当场读数。同处留了一句自省：本文件不在 doc-commands 取数面里，
  所以它写的命令同样没人核——这正是 R48-H3 那一族的又一格。
- **本轮四条失败面（原文入账）**：
  ① `npm run verify` 第二跑 rc=1，红在 `verify:docs`：`单测文件数：README.md:126 写的是 105，真相源实测 107`
  ——我加了两个测试文件没追文档，这是**同一条判据连续第三轮**抓到我的文档漂移（改文档追上真相源，不改真相源凑绿）。
  ② 第三跑 rc=1，红在 `tests/ciWorkflow.test.ts`：`未钉 SHA 的 action：ci.yml: actions/setup-python@v5`
  ——改 CI 前没读 CI 的规矩（本仓要求每个 `uses:` 钉 40 位提交 SHA）。SHA 由
  `gh api repos/actions/setup-python/git/ref/tags/v7.0.0` 现取 `5fda3b95a4ea91299a34e894583c3862153e4b97`，
  修后该文件 **31 passed**。
  ③ 变异腿第一版挑错被告行：把 `if (runner.status !== 0)` 改成 `!== 2` ⇒ 坏件的 rc=1 仍满足"≠2"，
  用例红是因为**变异没生效**；改成摘掉整个守卫（`if (false)`）才出现"坏件被读成通过"。
  户内 ②"每条变异必须绑定只有它能使其变红的输入面"的第二次实发。
  ④ Edit 锚点自我破坏**第 4 次**：插入新 `describe` 时 `old_string` 又取了 `verdictOf` 文档注释头两行
  ⇒ 注释被吞、`node --check` 报语法错。这次不再靠"我记得要回读"，而是落成上面那条提交边界机器闸。
- 验证：`npx vitest run tests/verifyImages.test.js` 8 passed、`tests/stagedSyntax.test.js` 6 passed、
  `tests/cliEntrypoints.test.js` 161 passed、`check:doc-commands` 6/6 GREEN、`verify:docs` OK 7 项（单测文件数 107）、
  `verify:backend` 152 通过、`npm run verify` **rc=0**（第三跑）。
- **收尾补一条：CI 侧接线已由远端回执证实**（此前只在**本机**证明过 `verify:images` 能红）。
  push `ce9431e` 时 pre-push 闸现读 `run 36394668910@ce9431e 全绿`，再按 step 复读：
  `Set up Python (product image assets gate)`、`Product image assets gate (npm run verify:images)` 与它的 Post 步骤
  均 `success`，五个必需 job 全绿 ⇒ "接进 CI"不再是一句本机断言。
  还缺的那一半同样记下：**没做过"注入缺图 ⇒ 该步必 fail"的 CI 侧演习**，所以"能红"目前只有本机一份证据
  （已改立为 R49-H1；`tests/ciWorkflow.test.ts` 31 passed 是修完 SHA 钉法之后的复跑）。

### 2026-09-28 追加六十一（对标第四十七轮：判据的"眼睛"之前，先确认它有没有对象可看）

- **新增 G14：采集目录本身必须有正向读数**（`check-cli-entrypoints.mjs`）。G1~G13 全在判"登记/覆盖/风险对不对"，
  没有一条判"**采集器到底有没有对象可喂**"：`collectCovered()` 第一行 `if (!existsSync(dir/tests)) return covered`
  ⇒ 目录被改名或移出时覆盖面**静默变空集**，而 G4 地板只拦到 23（真面现 35）⇒ 最多可悄悄少掉 12 个入口的
  "跑没跑过"而账面全绿。`testFace()` 返回 `{exists, files, withSpawn, outside}`，真面实测
  **116 个测试文件、其中 21 个真起子进程**；三种"读不动"（调用方没喂 face / 目录不存在 / 目录空）一律记
  **UNVERIFIED** 并照样计入 `mismatched`（退出码非 0、仍拦），但**不许**把"没量到"印成"结论为否"。
  夹具 7 条（正向印两个数 / 目录消失 / 无 spawn 件 / 对偶转绿 / face 缺值 / 名单外扩展名可见 / `.cjs` 进面）。
- **R46-H2 的第二半：扩展名从"写死三遍"收敛成单源 `TEST_SOURCE_RE`**（本文件两处 + `tests/testCeilings.test.js` 一处），
  并把名单放宽到含 `.cjs`。**这条腿配了变异体**：把白名单还原成 `/\.(?:m?[jt]sx?)$/` ⇒ 用例当场
  `expected undefined to be truthy`（红因正是"新增的 .cjs 夹具必须被认成覆盖"），还原后 2 passed ——
  证明去写死不是换了个说法，而是真的把一类少记堵住了。反向半边也钉住：`.txt` 仍算名单外（不是"把过滤整个删掉"换来的绿）。
- **三条失败面（都记原文，不粉饰）**：
  ① `npx vitest run tests/cliEntrypoints.test.js` 报 `Tests no tests` + `Failed to parse source for import analysis`，
  但**报错位置在 `scripts/check-cli-entrypoints.mjs:552`**，而我第一反应去查测试文件：`node --check tests/cliEntrypoints.test.js`
  回 `RC=0`（测试文件本来是好的）。最小反证＝对被 import 的模块做同一检查：
  `node --check scripts/check-cli-entrypoints.mjs` ⇒ `SyntaxError: Unexpected token ')' @546`，
  根因是我新写的 G14 嵌套三元多闭合了一个括号。教训形状：**vitest 的解析错误落在 import 链上的任何一个模块**，
  报错行号是"模块结束处"而不是缺陷处 ⇒ 归因第一步是把 `node --check` 打到**两边**，而不是只打症状那一侧。
  ② 静态读到一处**未执行到的缺陷**（如实标注，不冒充实测）：`collect()` 已经传 `face: testFace(dir)`，
  而 `evaluate()` 的解构参数表里没有 `face` ⇒ G14 行一旦执行就是 `ReferenceError`。修法是加参数并给
  `face = null` 默认值 + 专属 UNVERIFIED 分支；**没有**把默认值设成"就地探测目录"（那会让纯判据偷偷读盘，
  违背可注入 seam 的口径）。
  ③ 我写的反向断言 `expect(detail).not.toContain('不存在')` 被**自己的免责声明**绊红：那条 detail 里写着
  `不得读成"tests/ 不存在"`。正解＝改措辞（"不得据此断言采集目录没了"），**不放宽断言** ——
  断言要防的正是"把没读数写成目录缺失"，把话说白并不削弱它。
- **退出码分相 `verdictOf()`：0 全绿 / 1 判出违规 / 2 证据失效**（同轮补，户内与 `check-judge-side-effects` 的 S4/S6 对齐）。
  动机是本轮取证时读到的同行做法——`pytest-dev/pytest` 在收集动作之后**先问** `session.testscollected == 0`
  并返回专属的 `ExitCode.NO_TESTS_COLLECTED`（`src/_pytest/main.py:392`，@2026-09-28 经 `gh api` 取回原文核对，blob `d43a68b467`），
  而不是让它顺着 `return None` 掉进"通过"。本仓此前对"探针没读到对象"与"读到并判红"共用 rc=1，
  调用方分不出来；现在门面行自报 `rc=N`，并钉住两条边界：`pass=true` 却带 UNVERIFIED **不**抬成 2（否则 V4 那种
  "本模式不判"的行会把闸永久锁死），`rows` 为空（判据集合失踪）**不**记 GREEN。夹具 3 条，`cliEntrypoints` 155→**158** 通过。
- **同轮一次自我破坏被抓（同一轮实发三次，第二次、第三次都是补写台账时又撞）**：给夹具插入新 `describe` 时，`old_string` 取的是 G11 注释块的头两行 ⇒ splice 把注释本体
  吞掉、留下第三行悬空（`* 口径借 golang/go 的 -short…`）。`node --check` 当场报语法错才现形。这正是记忆里
  "脚本化编辑必须断言作用域/结构计数下限"那条的第四次同族发作——**插入点必须取唯一且中性的行**（本轮改为在
  `  })` + 空行处插入并随后逐行核对）。第二次撞在同一份 CHANGELOG 上：补写新条目时 `old_string` 又取了下一条目的
  首行 ⇒ 那条 "- **文档追平…**" 的开头被吃掉，留下 `一行"探针分母地板"）` 悬空；第三次撞在外层轮次报告的
  `## 8. 未观测` 标题上（插入新 §7.5 时又把它当 `old_string` 替掉了）——两次都由"写完回读一次"抓住，
  没有直接提交。**同一轮三撞说明这不是手滑，是习惯：`old_string` 只能是"我要保留且唯一"的中性行，
  插入型编辑的 `new_string` 必须把 `old_string` 原文逐字带回再追加。**
- **计划外第五条：收尾复读 CI 时抓到一枚定时炸弹**（非本轮笔迹，但它拦在推送链上 ⇒ 按最小解阻修）。
  `8dfdb0b`（纯记忆卷笔）的 `build-and-test` 判红：`tests/backupLiveness.test.js > CLI：三档退出码都可反证 > fixture 真有产物 ⇒ exit 0`
  报 `expected 1 to be +0`；CI 汇总 `Test Files 1 failed | 104 passed（105）｜Tests 1 failed | 1458 passed（1459）`。
  根因（读原文即定）：夹具日期由 `const NOW = Date.parse('2026-09-26T12:00:00Z')` 推出（`dayAgo(0.2)`），
  而 CLI 腿用 `execFileSync` 起**真子进程**，`check-backup-liveness.mjs:207` 的 `nowMs = Date.now()` 读墙钟 ⇒
  那个"0.2 天前"其实是"距 2026-09-26 0.2 天"，真实时间爬过 `NOW + 2 天 − 0.2 天`（≈ 2026-09-28T07:12Z）后，
  夹具自己变成"2.0 天前 ⇒ 链已停摆"。时刻吻合得一字不差：**同一分支 `a7bf54f`@07:0x 绿、`8dfdb0b`@07:14 红**，
  两笔之间我只改过两个记忆卷 ⇒ 红与内容无关、与**钟表**有关。
  正解＝给 CLI 腿单独一个活时钟 `dayAgoLive(d)`；冻结 `NOW` 的 `judge()` 那批用例一字不动（它们本来就把 `nowMs` 注进去）。
  本机复现与复验：修前 `npx vitest run tests/backupLiveness.test.js` ⇒ **RC=1**；修后 **25 passed / RC=0**。
  形状归族：与"时序型判据必须冻结被试对象"（此处是**反例**：注入面冻了、子进程那半没冻）与
  "台账值必须可移植"（夹具里的绝对日期在 CI 上是别人的时钟）同族。
- **文档追平 + 拆掉两处第二真相源**：`docs/cli-entrypoints.md` 的 G 清单原本**把 G10 写了两遍**（一行"分母地板"、
  一行"探针分母地板"）⇒ 去重并补 G14；README 的 `G1~G13` → `G1~G14`。同处还硬写着"bracketLexer 13 条 /
  memoryVolume 12 条"，实跑 `npx vitest run` 得 **13 / 31** ⇒ 前者是巧合对上、后者已漂 19 条（没有任何判据读它，
  所以漂了若干轮）。按本仓既有口径（"写死即第二真相源"）改成指针形态。
  `verify:docs`（OK 7 项，单测文件数 = 105）与 `check:doc-commands`（6/6 GREEN，提及 128 / 不成立 0）复跑均 rc=0。

### 2026-09-28 追加六十（对标第四十六轮：先把自己的优化假设证伪，再动手）

- **R46-H1 提速：根因不是我以为的那一个。** 上轮我写下"每件候选解两次快照 ⇒ 共用一份可省一半"。本轮先分相计时再动手，
  两条都被实测否证：`git archive HEAD | tar -x` 单次只有 **0.86s**（864/791/913ms 三次），而一次 `treeHashes` 读盘
  要 **12,299ms / 10,933 个文件，其中 10,225 个来自 `node_modules`** —— 探针为了让快照跑得起来自己接了个依赖 junction，
  然后把这棵依赖树当成"产物差集"来比。每件 4 趟读数 ⇒ ≈49s × 9 件 ≈ 409s，正好等于上轮记的 6m49s。
  正解＝把 `node_modules` 与 `.git` 一起移出读数面（它既不是受版本控制的产物、又不给判定力）。
  **改前 6m49s → 改后 1m37s（4.2×），判定完全不变：6/6 通过、实测改写面仍是 5 个产物**（等价性靠只读复跑证明，不靠"应该一样"）。
  读数面大小随每件候选印出来（`读数面 708 文件`）并写进登记册 `face_files` —— 盲区必须说出来，也不许下次被悄悄改小。
- **R46-H2 新增 G13：别名里的非 `.mjs` 入口不得结构性失踪。** 一手分母：宽扩展名取一遍别名里的 `scripts/<file>`，
  不属于 `.mjs` 的恰好 **1** 条 —— `npm run verify:images` → `python scripts/verify_images.py`；
  而 `collectRegistered` 与 `parseRegistry` **两处**都写死 `.mjs`（后者导致连"把它登记下来"这条路都是堵的），
  workflows 里 grep `verify:images` = **0** 处，`list-uncovered` 也把它列为"未纳入 verify" ⇒ 这条门禁今天只有人手敲才跑。
  第一步**不放它进探针面**：实测 `node scripts/verify_images.py` 得 `ERR_UNKNOWN_FILE_EXTENSION` 裸栈 ⇒
  ②③ 两法会把"解释器不对"读成"入口不会 fail-closed"，那是判据在说谎。改成要求它登记真实命令 + 可证伪理由
  （新表 `## 非 node 入口`），解释器分派的腿留 R47。夹具 4 条含"这条红 G1/G12 看不见"的对偶断言，148 条通过。
- **R46-H3 新增 V2 二次确认（撕裂读）。** 共享工作树里读到的字节数可能是别人写到一半的形态，本仓已撞两次
  （part72 判 4333B / 20 秒后 2637B；part74 同秒 `status` 与 `git cat-file -s` 相差 1.3KB）。
  现在超限件要**再 stat 一次**（150ms 后）：一致 ⇒ 照常判违规；不一致 ⇒ 记 UNVERIFIED 并印出两个数（`V2b`），
  既不洗成"通过"也不冒充"违规"。成本只落在"已经要判红"的路径上（无超限时一次都不重读，已断言）。
  夹具 5 条含真入口对偶腿（5.2KB 的卷仍判 rc=1，证明新腿不会放走真违规）。
- **一次变异锚点失效被自家夹具当场抓住**：把 `const overs = files.filter(...)` 改成 `overs0` + 复核 filter 之后，
  `memoryVolume` 的"探针有牙齿"用例立刻红并写明"变异锚点已失效（判据改形，夹具必须同步）"⇒ 同步锚点，
  **不改断言强度**。这正是第四十四轮那条 ②-g 的镜像：夹具咬得住判据的形状变更，才会在这种时候喊人。
- **计划外第四条：一次 5s 超时挖出"两条天花板各说各话"**。`npm run verify` 里 `memoryPointerSync` 的一条子进程用例报
  `Test timed out in 5000ms`；单跑该文件 1.37s 全绿、判据本身 0.36s ⇒ 争用抖动而非代码坏。往下扫静态面才发现真缺陷：
  `tests/` 下 **17 个文件**用 `spawnSync` 真跑入口、预算写 30s/60s/120s/**300s**，却没有一条给 `it()` 设超时 ⇒
  全跑在 vitest 默认 **5s** 上（最坏差 60 倍）。处置选"把预算请回地面"而不是"把超时抬到 5 分钟"：
  实测三处最重的门（`verify:response`/`verify:restore-drill`/`verify:roundtrips`）各约 1s ⇒ 4 处 `300_000` 降为本仓
  既有最大天花板 `120_000`，`vite.config.js` 设 `testTimeout: 130_000`；并新增 `tests/testCeilings.test.js`（4 条）
  钉住不等式 **测试天花板 ≥ 最大子进程预算 + 余量**，反向自证含"降回 5s 必须判不对齐""相等也不够"两形
  ⇒ 以后谁抬预算不抬天花板，当场红。（这条夹具第一版就抓了我自己一次：它扫出的最大值是 300s 而非我以为的 120s。）
- **文档追平真相源**：README/SECURITY/`docs/cli-entrypoints.md` 三处"全量面 ≈300s"是上轮抄来的旧数 ⇒ 全部改成
  修前 6m49s / 修后 1m37s 并写上根因；G 清单补 G13；README 单测文件数 104→**105**（本轮又加两个测试文件，
  还是 `verify:docs` 抓住的——同一条判据连续第三轮抓到我的文档漂移，说明它接线接对了）。
  `check:doc-commands`、`verify:docs` 复跑均 rc=0。


### 2026-09-28 追加五十九（对标第四十五轮：把上一轮只写在注释里的"眼睛也要测"变成夹具）

- **R44 唯一没机器化的缺口已补**：上一轮修完 `scanBrackets()` 的词法缺陷后，"正向断言"我只在
  `%TEMP%` 的临时脚本里做过 —— 临时脚本不是夹具，下一轮没人能重跑。本轮落 `tests/bracketLexer.test.js`
  **13 条**，三类各钉死：① 正例（结构已知的输入必须给出手算的配对数：串里括号不计数、注释里括号不计数、
  转义引号不提前闭合）；② **变异体**（把修复还原成旧写法 `state = c` 原样复制进测试 ⇒ 同一输入配对数
  从 1 掉到 0、从 2 掉到 0，两个方向都测；并诚实记下"转义引号那一例其实没有判别力"）；
  ③ 已知盲区写成实测形状而不是留给下轮猜：模板串 `${}` 插值里的括号**少记**、正则字面量里的括号
  **会被当代码计数**（`f(/)/, 'scripts/z.mjs')` 会让 needle 掉出采集范围）。
  同行口径（本轮 `gh api` 取原文核对）：`golang/go :: src/cmd/compile/internal/syntax/scanner_test.go`
  767 行 / 22,462B，含 `TestScanErrors`(:587) 与按 issue 号命名的词法回归件 `TestIssue21938`(:735)。
- **新增 G12：取数面逐来源非空**（`check-cli-entrypoints.mjs`）—— 登记面由 npm 别名／`.githooks`／workflows
  三个来源合成，而 G1 只判"总数非零" ⇒ 任一来源静默归零时账面照样绿。这正是第四十一轮那条欠账的形状
  （往根表加 `scripts/` 结果 74→74 的空操作），本轮第一次带数字收口：真面 **npm 45／hook 4／ci 7**、12/12 通过。
  顺带抓到**夹具人口缺口**：合成仓 `baseRepo()` 只建了三个来源里的两个，第三个来源在夹具里从未被喂过
  （②-f 同族）⇒ 补 `.github/workflows/ci.yml`，并加 G12 的正例／两个反例（删 workflows、删 .githooks，
  后者特意断言 G1 仍绿以证明"只有 G12 抓得到"）／对偶（补回来必须转绿）。`tests/cliEntrypoints.test.js` 144 条通过。
- **新增 S6：证据新鲜度**（`check-judge-side-effects.mjs`）—— 上一轮把风险标签改成"静态 ∪ 实测"合成，
  却**没有任何判据读过 `observed_utc`** ⇒ 改了写盘代码而不重跑探针，`writes-artifacts` 就悄悄失真。
  现按 `--max-age-days`（默认 14 天，阈值是拍的 ⇒ 同时印出年龄与复算命令，让下一轮能证伪它）判 UNVERIFIED/rc=2；
  并且 **`--blind-only` 拒绝 `--update`**（缩面人口不全，重写册子＝用偏样冒充全量，还会把时刻刷新成"刚核过"）。
  参数校验移到探测之前：本仓全量面要跑 **6m49s**，把校验放在后面等于"非法用法先烧七分钟"（本轮被 120s 超时当场抓住）。
- **一次真实自愈的账**：全量面重跑时 S3 判红「实测被碰过的产物 5 个 ⇄ 册里登记 3 个；漏登: README.md,
  docs/doc-commands.json」—— 原因不是代码坏了，是上一轮新增的两个写盘件**这轮才进 HEAD**、探针第一次真跑到它们。
  `--update` 重写册子后复跑转绿 ⇒ "在册 ⇄ 实测"这条腿在无人干预下自己把面扩到了 5 个产物。
- **文档追平真相源**：`verify:docs` 又抓到 README 的单测文件数（103 → **104**，本轮新增一个测试文件）；
  `docs/cli-entrypoints.md` 里那行手写的"122 条 = 16 + 31 + 31 + …"当场失真 ⇒ 改为"条数以当场输出为准"+ 只写**构成**，
  G 清单补 G12 一行。


### 2026-09-28 追加五十八（对标第四十四轮：判据自己的词法器有一条从来没生效的分支）

- **一手根因（不是我的夹具坏了，是采集器坏了）**：`scripts/check-cli-entrypoints.mjs` 的 `scanBrackets()`
  进字符串时写 `state = c`（引号字符本身），而分支判的是 `state === 'sq' | 'dq' | 'tpl'` ⇒ **两边永不相等**，
  字符串内容从来没被跳过。后果不是"少记一点"：串里的 `//` 起假行注释、**串里的 `/*` 起假块注释并吞掉文件后半段**。
  一手事故面 `tests/docCommands.test.js:96`——理由串里写着 `.github/workflows/*`，那个 `/*` 把该行之后全吞，
  于是 `spawnSync(` 配不上对 ⇒ 覆盖采集少记一个入口 ⇒ G2/G8 把**已有子进程真跑夹具**的 `check-doc-commands.mjs`
  报成"未登记缺口"。修法只统一状态名（"宁少记不多记"的方向不动）；修后覆盖 34→35、G2 由 13⇄12 变 12⇄12。
- **`check-judge-side-effects` 四处修复**（都是本轮真跑逼出来的读数，不是设想）：
  ① 写开关改**整词**匹配 —— `--update` 是 `--update-write-quota` 的子串，旧写法给同一件虚增出它不接的通道
  （探针恰好取第一条所以对结论无影响，缺陷只污染登记册与"通道存在性"声明，最易漏）；
  ② S5 的"静态幽灵"不得指控**本轮没跑起来**的对象（新增件在 HEAD 里还没有 ⇒ 永远进不了"实测写过"集 ⇒ 永红假缺陷）；
  ③ S3 的幽灵按**生产者**归位免责：写通道 rc≠0 或未触达 ⇒ 记"未复核 N 个"并印出来，不记幽灵
  （CI 无 CF 凭据时 `check-d1-remote-usage --write` 就是这一形）；
  ④ S2 的措辞跟着读数走 —— 无缺陷时也印"全部在册声明为生成器（gen-api-doc…）"，把没参与本轮的具名例外
  说成本轮免责依据（判据匹配描述而不匹配行为，同族）。
- **新档 `--blind-only` 并接入 CI**：CI 只测"静态推不出"那一类（本件存在的全部理由），本机实测全量面 9 件
  ≈300s、盲件面 3 件 **76s**；两种模式的取数面都写在门面行上（`取数面=…`），缩面读数不得冒充全量核过。
  同一 commit 里 `check:doc-commands` 进 `npm run verify` 链与 CI（6 条判据 D1~D6，真面 123 条提及全对得上）。
- **登记面补齐到自洽**：`docs/cli-entrypoints.md` 风险分类表 +3 行（`check-d1-roundtrips` / `check-doc-commands`
  / `check-judge-side-effects`，标签一律 `writes-artifacts`），G9 由 22⇄19 变 22⇄22、`verify:entrypoints` 11/11；
  README 顶部**新增「门禁一览」表并声明为 `check-doc-commands --update` 的生成物**（D6 判它不许漂，改别名即整块重生；
  写死清单即第二真相源），README 的 CI 摘要与 SECURITY 新增"自动化链的写入边界"一节；
  README 单测文件数 101→103 —— 这条是 `verify:docs` 在我写"已经改过"之后**当场抓住的假交付**，本行同时记下我自己的这次口误。
- **夹具**：`tests/judgeSideEffects.test.js` 17 条（本轮从上一轮被机械替换损坏的文件整体重建，含三条方向相反的
  腿：正例全绿 / 摘掉风险表行即红 / 缩面不得造假幽灵）；`tests/docCommands.test.js` 12 条；全套 **103 文件 / 1411 条**通过。
- **并发在途（不属于本提交，记此以免后来人按 SHA 找归属时误判）**：`scripts/check-backup-liveness.mjs` 里
  "presence 模式不得印『可核对备份』"那处改动由另一会话作出、标注为它的 R43-H1，我按 pathspec 提交时**未**带上它。

### 2026-09-28 追加五十六（备份链：把"从未备份"这句谎话拆穿，并给出会话隔离机制）

- **先纠正上一笔提交里我自己说错的一句**：我曾据 `conclusion=success` 推断"这条链 09-24/25 备份过、
  是第三十七轮的守卫把它弄红的"。读步骤后**否证**：5 次 run（09-24~09-27）**每一次**的
  `Export remote D1` 都是 skipped、`artifact=0`，两次 success 是"恒绿空转"。⇒ 该链从未产出过一件备份，
  守卫判红是它在正常工作。这正是 `check-backup-liveness` 存在的理由，而我恰好犯了它所防的错。
- **判据自身的过度断言已修**：旧结论写"生产库**从未**被这条链备份过"，但它只看得见 lookback 窗口内的
  run——把"窗口内没看到"说成"从来没发生过"（盲区不是零同族）。现改为印出窗口跨度并显式声明
  "窗口外是否曾成功，本判据看不见，不下结论"。
- **FAIL 从"去看注释"升级为"点名缺哪个 secret"**：按已抓到的步骤形态反推——导出全 skipped ⇒ 缺
  `CF_D1_BACKUP_TOKEN`；导出真跑过但守卫拒绝 ⇒ 缺 `BACKUP_PASSPHRASE`；没有步骤明细 ⇒ 自承失明不猜。
  配 4 条新用例（含反向腿：真有合格备份时不得出现诊断话术）。`tests/backupLiveness.test.js` 25/25。
- **加密出路补上行为回执**（此前只有代码、零执行证据）：对真实生产导出跑
  export(1,461,600B) → encrypt(1,461,649B) → decrypt → 逐字节相等 → 载入 sqlite → 断言 p046 三口味；
  并验证篡改末 40 字节 ⇒ rc=1、错口令 ⇒ rc=1。口令只在进程环境变量里活一次，未落盘未回显。
- **新增 `scripts/session-worktree.mjs` + `docs/session-worktree.md`**：并行会话共用一个目录＝共用一个
  index，本轮我的 CHANGELOG 改动就被另一会话的 `git add` 写进了它的提交（内容无误、署名错位、
  我这边事后看不出来）。worktree 的隔离点是每棵树各自 index，**不依赖对方配合**。
  实测：会话树 `git add README.md` 后主树 index 指纹逐字节不变；脏树 remove 拒绝、重名拒绝、
  `../evil` 这类名字拒绝（rc=2）；完整生命周期无残留。
- **本轮我自己踩到的坑（记下来防第三次）**：在 `python -c "…"` 的双引号串里写反引号，被 bash 当
  命令替换**执行**了——其中包括一次裸 `git push` 和一次空 pathspec 的 `git add`。
  所幸 push 因"无 upstream"未推送任何东西、`git add` 报 "Nothing specified" 没加任何文件，
  实测远端仍停在 4212584、暂存区 0 件；唯一损伤是那行指针被替换吃掉两个引用，已修。
  教训：含反引号/特殊字符的落盘内容一律走 Write/Edit 工具，不要内联进 shell。

### 2026-09-28 追加五十七（对标第四十二轮：cron 的"窗口内成功过"与"最近一次是红的"是两把尺）

- 轮初锚 `4212584`；取号先列盘：在册最大「五十五」⇒ 本条原取「五十六」，落笔时**被并行会话同分钟占走**
  （它的"拆穿从未备份 + 会话隔离"那条也是五十六，且把 `## [未发布]` 抬头多出一个 ⇒ 本轮新加的
  "未发布抬头恰好 1 个"判据当场抓到我自己）⇒ 顺延**五十七**，重复抬头已删。
- **接手在途（第三十九轮先例）**：并行会话的 R42-H1/H2（`check-d1-remote-usage.mjs` + `preflight` 常量穿透）
  停在 `verify:entrypoints` 的 G2/G9 两条红上（新脚本没进登记册），提交面不自足就发不出去 ⇒ 本轮补齐后一并提交。
- **一手红（本轮换尺的动因）**：`gh run list --workflow=Uptime` 第一行 = run `36299454141`
  @2026-09-27T06:13:21Z event=schedule **failure**，而旧尺 `LIVENESS_MODE=presence …check-backup-liveness.mjs`
  对同一时刻**实跑 rc=0**，因为它认的那次"成功"是 09-26 的一次 `workflow_dispatch`。
  同时 `D1 Daily Backup` 自 09-26 起 **连续 2 次 scheduled 判红**（日志原文 `::error::未配置 CF_D1_BACKUP_TOKEN`）
  ⇒ 也**顺带把第三十七轮那条"未验证"改判**：那次记的是"'无口令会判红'的语义仍未观测"，现已观测
  （run 36356709142 的失败 step 名就是 `Fail loudly instead of reporting a green no-op`）。
  两条红的根因同一条：缺 `CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE`（用户侧凭据，agent 不代填）。
- **新尺 `scripts/check-cron-health.mjs`**（`npm run check:cron-health`，C1/C2/C3/C3b/C4/C5/C6 七腿）：
  结构性枚举 `.github/workflows/*.yml` 的 `schedule:` 块 ⇒ 实测 2 条（周期各 1 天）；YAML 路径面 ⇄ 远端
  注册面双向对账；逐条出**三态** OK/RED/UNVERIFIED，连红只数 `event == 'schedule'`；红因具名归口
  （C6 印"2 条红 ⇄ 1 个根因"，不把同因的两件事数成两件）；豁免三件套缺一即红（限期 + 含实测数字/可复跑
  命令的理由，复用 `lib/registry-reason` + `root_cause`）。退出码 0/1/2，取不到数一律 rc=2。
  两条自己抓到的自己的缺陷：① 第一版枚举器在 `uptime.yml` 的注释行前退出块、并因 `- cron: '…'   # 注释`
  的**尾注释**把备份链整条漏掉 ⇒ 74→74 型静默漏面，改为"有 schedule 块却解不出 cron ⇒ 带 `unparsed` 入面
  由 C2 点名 + C3b 反向断言"；② 被 cron 自己调用时**当前 in_progress 的 run 结论为 null**，会被读成
  "最近一次失败"⇒ 刚修好就自判红，按 `koala73/worldmonitor` 的口径加"排除自己 + 未完成不入判定 +
  run 列表按去重数比 `total_count` 截断即 rc=2"。夹具 **19 条**（含 `--fixture` 子进程跑入口的三档退出码、
  `--inject-red` 演习必须判红）。
- **R42-H1 收口（采纳 + 修一处每天假红）**：`check-d1-remote-usage.mjs` 的 U5 初稿是"日窗 0 而滚动 24h
  非 0 ⇒ 一律可疑"，本机 **00:11 UTC 实跑 rc=1** —— UTC 日窗才开 11 分钟，而配额按 00:00 UTC 重置
  ⇒ 每天头几小时必红一次。修法**不是**时间门（那是自己开盲区），而是拿**同一请求**里按 date 分组的
  history 腿做结构互检，四种出口各有断言（`tests/d1RemoteUsage.test.js` 9 条）。另把 `verdictOf` 补
  `UNVERIFIED` 档并把退出码从 `failed.length ? 1 : 0` 改成三档 —— 原写法会让新增的"失明"出口静默变绿。
- **R42-H2 穿透再扩一层**：`scanArtifactWrites` 原来只认"裸标识符/字面量"，而本仓多数写法是
  `writeFileSync(join(ROOT, REGISTRY), …)`（目标是**表达式**）⇒ 按括号深度取第一个顶层实参后解引用，
  受控产物写入者从 2 件变 **5 件**（新增 `api-response-contract`、`check-cron-health`、`check-d1-remote-usage`）；
  `verify-backend.mjs` 的登记标签同步补 `writes-artifacts`（此前是漏登）。**仍未解的一半**：跨文件
  `import` 进来的目标常量（`check-d1-roundtrips` 的 `WRITE_QUOTA_FILE` 就来自 `lib/d1-quota.mjs`）
  照样推不出，实测 `scripts/` 8 个含 `writeFileSync` 的 .mjs 里有 **3 个只剩 unbound** ⇒ 记 R43-P0。
- 接线：`ci.yml` 加 advisory step（**理由写进注释**：凭据配上之前接成阻断位会让每个 push 连坐），
  `uptime.yml` 加**非 advisory** step（cron 现场才是该红该落的地方），README 加两枚 `event=schedule` 徽章。
- **接手件的一处不变量搬家**（全链 `npm run verify` 实测抓到，不是推理）：A10 原先同时断言"配额常量同值"和
  "现网用量不许虚报成 OK"，在途重构把后者搬进新腿 A11 却**没同步第四十一轮的夹具** ⇒ `remote_usage:'OK'`
  不再让任何一腿变红（该测试当场失败暴露了它）。按"断言不删只换家"改：虚报的三种写法（吹 `OK`／无回执吹
  `VERIFIED`／有回执却仍写 `UNVERIFIED`）全部改钉在 A11 上，另补"声明落后同样红"一条；A10 原有两条常量断言保留。
- **台账被自己的两道闸连着拦两次**（本轮的"抓自己"清单）：主卷换 R43 P0 + 本轮事实迁卷时，一次写 6,355B
  ⇒ **V2** 判超 4KB → 续开卷 71；紧接着 **V4「新卷出生即贴线 ≤3072B」直接把 commit 拦下来**（不是警告）
  ⇒ 按小节边界把两卷重切成 **70/71/72**（2,507B / 2,777B / 1,632B），全程逐字迁移、不压措辞、五个小节一条不丢。

### 2026-09-28 追加五十五（对标第四十一轮：把「每日配额」从在册 0 条量成第三把尺，并封掉一次看起来成功的假扩面）

- 取号先列盘：在册最大「五十四」⇒ 本条「五十五」（并行会话已占五十四，本轮顺延取号）。轮初锚 `f098f9c`（第三十九轮台账笔，其 CI run `36337389643` = `completed/success`，读自 `gh run view --json conclusion`）。
- **R41-H2 行写入尺（第三把）**：平台事实 `Rows written 100,000 / day`（`cloudflare/cloudflare-docs
  src/content/partials/workers/d1-pricing.mdx:8`，定义 :18，00:00 UTC 重置 :24；强制执行见
  `src/content/changelog/d1/2026-09-01-d1-free-tier-limit-enforcement.mdx:9`「will fail」），本仓此前**在册 0 条**
  （grep 实测），引文 @2026-09-28T01:41:11Z 本机现取。`metered-d1` 加 `rowsWritten`（取 `meta.changes`，与该定义
  同口径）。实测：`P:createOrder`(10 件) **11 行**、`A:batchUpdateProducts` 11 行、`A:batchDeleteProducts`(50) 1 行、
  `A:seedReviews` 21 行 ⇒ **100,000 ÷ 11 ≈ 每天 9,090 单**、按最重 action 峰值 21 行算 ≈ 4,761 次
  ⇒ 配额当前不是瓶颈，但这个数字此前从没被量过、也没人会被提醒它存在。判据四条：A8 每个在册 action 都要有
  非负整数读数；A8b 全体为 0 即红（零输入不算通过）；A9 `docs/d1-write-quota.json` ⇄ 当场实测双向对账
  （漏项/幽灵/值漂三类各点名成员名）；A10 常量 ⇄ 登记册同值且 `remote_usage` 必须是 UNVERIFIED
  （现网真实用量取不到：未跑 `d1 execute --remote` / GraphQL Analytics，缺凭据且须先过部署 skill）。
  夹具 `tests/d1WriteQuota.test.js` 9 条，含变异腿「撤掉 A8b 后同一份全 0 输入会被读成通过」。
- **一次看起来成功的假扩面（R41-H1 改判，不硬扩）**：把 `'scripts/'` 加进 `SURFACE_PREFIXES` 后普查**一项没多**
  （74 项 → 74 项、照样 PASS）——采集器读的是 `loadAll` 里硬编码的 `roots`，而 C7 的 `outsideLeak` 又禁止
  scripts 入面 ⇒ 「扩面」是空操作，还会被 C7 印成「面已含 scripts/」。正解：`SURFACE_EXT` 前缀⇄后缀集单源派生
  roots + 新腿 **C7b**（缺后缀集 / 多写后缀集 / **声明了却零贡献的空根** / 把判据面拉进来，四类各自点名）。
  双向实测：正向 `functions/ 实贡献 45 项 ｜ src/ 29 项`、11 检查全过；反向把 scripts/ 塞进前缀表 ⇒ C7b 红且
  `rc=1`；还原 ⇒ 11/11。判据/文档/测试面按既有教义**永不入面**（写成 `SURFACE_NEVER` 在册），所以「门禁脚本
  自己的数值」的落点改成判据侧登记件——本条的 `docs/d1-write-quota.json` 是第一个。
- `CHANGELOG 门禁` 现在**也判结构**：`headingProblems` 要求未发布抬头恰好 1 个且在顶部区，
  `CHANGELOG_FILE` + `--structure-only` 让反例驱动真入口（子进程 + 真退出码，不是 import 纯函数自比）。
  四向实测：真文件 rc=0；叠两个抬头 rc=1 且点名 L1 L3；抬头合法但在 L20 rc=1；文件读不到 rc=1（没有对象不算通过）。
  对标（本轮现取）：`googleapis/release-please` `src/updaters/changelog.ts:22,39-40,63-65`（版本头正则 + 标题层级归一）、
  `sass/sass` `.github/workflows/ci.yml:87-92`（CHANGELOG 第 1 个标题必须等于机器可读版本）、
  `juniper`/`derive_more` 各自断言 `## [x.y.z]` 的日期==today；**反向证据**：`release-please` 与 `release-drafter`
  两仓代码搜索 "Unreleased" 均 `total_count=0` ⇒ 全行业没有「未发布抬头唯一」这条闸，本仓这条是补位不是抄。
- 配额可观测的正规做法（写进头注，供 R42 用）：`d1/worker-api/return-object.mdx:43-44` 的 meta 里有
  `rows_read`/`rows_written`；官方「Track your D1 usage」（`d1-pricing.mdx:11-12`）给三条路 = meta object /
  GraphQL Analytics(`d1AnalyticsAdaptiveGroups`) / dashboard Metrics>Row Metrics。node:sqlite 给不了扫描行数
  ⇒ 行读取配额只能「在册 + 待远端对账」，本机不许冒充实测。
### 2026-09-28 追加五十四（老大点名三件事：换图 / 顾客所选口味后台可见 / 上架开关白圈溢出）

- **② 口味「后台看不见」不是功能没做，是被另一条链绕开后的静默丢数据。** 口味徽标早已上线
 （`6c32c1a`/`8c9ed95`，线上 `AdminPage-*.js` 内 grep 到 ``children:[`口味 `,i]`` 原文），但详情页
 `ProductDetailPage.tsx:75` 写的是 `variantGroupOf(orderNum) ?? specOptionGroupOf(product)`，
 演示层 `src/data/variants-demo.ts` 覆盖白象 46/47 且优先级在前 ⇒ `specOptions` 永不被读；
 该层产出的 `'帮泡装 · 十三香'` 又不在服务端 `allowedOrderSpecs`（线上 `p046.specOptions='[]'`）内，
 `resolveOrderSpec` 第 102 行**静默回落**成静态规格、不报错 ⇒ 顾客点了口味而后台看不到。
 该文件头自称「不参与下单接口」却在生成下单 payload，这就是缺陷本体。
- **处置**：白象三口味升为真实 `specOptions`、演示层 `variants-demo.ts` 整体退役。
  重放安全靠**文件名排序**而不是改历史迁移件：`migrate-spec-options.sql` 末行有
  `WHERE "order" NOT IN (33,34,40,52)` 的清空语句 ⇒ 新件必须排在它之后，故取名
  `migrate-taste-baixiang.sql`（t > s）。曾试过直接改那份名单，被迁移账目表判
  `DRIFT … 历史迁移被修改，禁止`（exit 1）⇒ 已回退，改由排序解决。
- **回滚件差点上线成数据损坏，被备份载回断言拦下**：`wrangler d1 export --remote` 导出 1,461,184 B
  并**载回 sqlite 逐条断言**测得线上 `p046.spec` 本来就是 `'帮泡'`（长文案从未进过生产库），
  所以原计划的"收敛 spec"迁移对生产是零操作、其回滚件会把一个**从未存在过的值**写进库 ⇒ 当场删除该对文件。
  顺带实测 seed⇄线上漂移面比台账更大：54 条里 **35 条 price 不一致**，再次坐实「严禁用 seed.sql 覆盖 D1」。
- **③ 开关溢出已复现，且根因与静态读码结论相反。** 实测轨道 36×20、旋钮 16 落在 x=36..52，
  **溢出恰为 16px = 旋钮全宽**：旋钮 `left:auto` 的落点取「静态位置」，Chrome 给的是 18px 而非 0，
  于是 `translate-x-[18px]` 把它推到 36px。改为全 rem 的 flex 写法（无 abspos、无硬编码 px），
  实测两态均 18..34、两侧各留 2px。新增 `tests/e2e-visual/admin-switch.spec.ts`：判据印实测值，
  并配 CSSOM 变异体证明会红（`addStyleTag` 那条路被本页 CSP `style-src 'self'` 拦死，未为测试放宽 CSP）。
- **① 换图零合格，四张原图一律未动。** 两轮必应 murl 共 51 张 ≥360px 候选逐张编号目检：冰红茶 7 张全为
  对面海报/logo/代言人/整箱堆头且换词后新增 0 张（检索面见底）；好友趣混「呀！土豆」+13 张《战锤40K》
  封面 + 13 张百香果园（裸数字"40"串域）；白象唯一袋装是带横幅字的 banner 裁切件。按 Step 3
  「搜不到就承认搜不到」保留原图、未降级生成图。取证细节见 `memory/07-next-steps.part67.md`。
- **验证**：`npm run verify` 全链绿（含 `verify:volume` GATE-PASS、`migrateReplay` 26/26）、
  `npx vitest run` 1334/1334、`npx vite build` ✓ built、Playwright e2e 23 全过、visual 19 过 + 1 显式 skip
 （多图画集驱动随演示层消失，未删判据，改成带前置条件的大声 skip）。
- **同轮修掉两处判据自身的缺陷**：`tests/migrateReplay.test.js` 的迁移清单是手抄的 ⇒ 新 `migrate-*.sql`
  对 A6/A7 双双隐形，改为磁盘枚举并把 `forward` 的绝对值断言改成相对基准；
  `variants.test.ts` 的诚实性判据在演示数据清空后会 0 次迭代假绿，改为遍历真实合成组并钉住分母非空。

### 2026-09-28 追加五十三（对标第三十九轮：接手在途第三十八轮 + 立"提交面必须自足"这道闸）

- 取号先列盘：在册最大「五十二」⇒ 本条「五十三」。本轮开场实测重建现状：内层 HEAD 三次探测
  （00:42/00:45/00:50）恒为 `a19cc0e`，而磁盘躺着**上一轮第三十八轮的 10 件未入库工作**
  （6 改 + 4 全新未跟踪），静置 3.5 小时无人察觉；`npm run verify` 首跑 `VERIFY_RC=1` 停在
  `verify:docs`（README 写 95 ⇄ 实测 97）。手工补跑被它挡在后面的门，又抓到一处红：
  `GATE-FAIL cli-entrypoints` G9「派生风险 16 ⇄ 登记 15；漏登 `check-live-shape.mjs`」。
  **接手收口（R38-H1/H2/H3 三件都在盘上，本轮只做核验与补登记，不重写）**：
  `scripts/restore-drill.mjs`（D1 合成 dump→加密→解密→交恢复判据，D5 跨机取回记 UNVERIFIED 不折算通过）、
  `scripts/check-live-shape.mjs`（线上 `/_health` 键集 ⇄ 本仓声明，`git show` 现取 HEAD 短 sha 比对）、
  `compressImageFile` 的 `qualityLadder` 降质阶梯（R38-H3：改前超预算整张丢，现在先降质再决定丢不丢）。
  本轮实测把 R38 头注里那条"线上没有 deploy 键"改判了：`node scripts/check-live-shape.mjs` 真跑 4s 回
  `HTTP=200`、5 键双向对上、`deploy=a19cc0e == 本地 HEAD` ⇒ push 自动部署已把漂移消掉，
  **在册挂账 N3「部署欠账」按本轮读数记为当前不成立**（机制年龄判据：那条陈述产于 15:40Z，其后部署发生过）。
  两件在测脚本按在册口径登记：`@probe-safe` 声明 + 风险分类表（骨架实测 rc=2 / 0s 停在门口 ⇒ 回分母）。
- **R39-H1 新闸 `scripts/check-head-closure.mjs`（提交面自足）**：一手事实是本地 43 个判据全绿与
  "这次提交到 CI 必红"能同时成立——`package.json`/`ci.yml` 已把 `verify:restore-drill`、`check:live-shape`
  接进链路，而这两个脚本文件一件都没入库；CI 只看提交面、本地链只看磁盘面，**两者从不互相比对**。
  五腿：H1 HEAD 链引用必须在 HEAD 内解出 / H2 工作面链引用必须被 git 跟踪（本轮事故的形态）/
  H3 HEAD 里 `scripts/` 入口要么被引用要么在具名豁免册 / H4 豁免册反向对账 / H5 本判据自己在链上。
  第一次真跑就独立复现了事故：H2 只点名 `check-live-shape.mjs`、`restore-drill.mjs`（加上本轮自己的
  `check-head-closure.mjs` 共 3 件），其余 41 个引用全绿 ⇒ 判据不是照着事故写的，是量出来的。
  对标（`owner/name` 全名，引文 @2026-09-27T17:00:56Z 由本机 `gh api contents` 现取现验）：
  `kubernetes/kubernetes` `hack/lib/verify-generated.sh:35,41,49`
  「`git worktree add -f -q "${_tmpdir}" HEAD`」+「`diffs=$(git status --porcelain | wc -l)`」= 判定对象是提交态；
  `rust-lang/rust` `src/tools/tidy/src/mir_opt_tests.rs:11,42`
  「the following output file is not associated with any mir-opt test, you can remove it」= 盘上有而没人登记就红；
  同仓 `deps.rs:967,979-983`「Remove from PERMITTED_DEPENDENCIES list if it is no longer used」= 例外册也要反向核；
  `prettier/prettier` `scripts/ensure-no-files-changed.js:5-8,25`（`git diff --name-only` / `--exit-code`）是**反例**：
  52,314★ 的链只看已跟踪文件，未跟踪件永不进它的视野——与本仓事故同型盲区，所以 H2 取 `git ls-files`
  而不照抄它。接线落点 = `.githooks/pre-push`（"未跟踪文件"在 CI 检出里不存在，挂 CI 的那半恒绿=假绿），
  逃生门与 ci-green 同规格：`HEAD_CLOSURE_SKIP=1` 必须同时给 `HEAD_CLOSURE_REASON`，否则照样拒推。
  夹具 `tests/headClosure.test.ts` 16 条：五腿各配"改一个变量→点名红因"、YAML 整行/行尾注释不算引用而
  引号里的 `#` 算命令（防"量具把散文当数据"）、`--drill` 合成面必须真翻红、骨架 rc=2 停在门口不崩栈。
- **本轮自失三条**：① `evaluate()` 取 `trackedFiles` 而 `collect()` 返回 `tracked`——键名不一致把 44 个
  已跟踪脚本全报成未跟踪（**假阳性比假绿更吵**，靠 H1/H3 仍绿才发现是分母而非仓库）；
  ② 新测试文件又带 1 个未用 import（同形第四次：R35 三处、R36 三处、R37 两处、本轮一处）⇒ 规则继续生效
  "新脚本与新测试文件写完立刻单跑 lint"；③ 我给新脚本挂了 `@probe-safe` 而它**根本没有危险特征**，
  G11 当场判"无效声明"⇒ 摘掉。三次都是自家门禁抓的，不是人看出来的。
- 在册缺口挂账（带分母，禁无数字提案）：上限普查取数面 `SURFACE_PREFIXES = ['functions/','src/']`
  **不含 `scripts/`** ⇒ 门禁脚本自己的数值全在登记册外（本轮实测人口：`CONST_RE` 形状的可命名常量
  **5 个**，含 `_MS` 后缀 4 个；另有 `STATEMENT_BUDGET_FREE=50` 这类平台事实值 1 个未挂平台行）。
  改面要动 `check-limit-provenance.mjs`——该文件正被并行会话在途修改（00:14 的 R38-H2 那 65/10 行），
  本轮**不碰**，记 R40-P0 并把分母写进 P0。

### 2026-09-27 追加五十二（对标第三十七轮：把"各说各话的尺"和"看起来存在的产品"两类假绿一次收掉）

- 取号先列盘：在册最大「五十一」⇒ 本条「五十二」。轮初锚 `f96cdf9`（R36 再收尾，其 CI run
  `36320807456` = `conclusion=success`，读自 `gh run view --json`）。Step 0 台账：07 系 **59 文件 /
  164,543B / 未勾 70 条**；`TODO.md`/`TASKS.md`/`ROADMAP.md` 两仓仍全部不存在；双份记忆按文件名交集
  **为空**（内层 `memory/` 跟踪 71 件 ⇄ 外层 `超市/memory` 14 件，`comm -12` 实测 ⇒ 不是同一份两跟踪，
  是两份不同内容 —— 与 R272 那种 junction 双跟踪不同形态，别归错因）。
  旧阻塞重跑：**M4 本机 workerd 已自愈**（`node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe` 实存、
  `wrangler --version` = 4.137.0 ⇒ 挂自第十六轮的那条判"已完成"）；**M3 分支保护仍 `NOT_ENFORCED`**
  （`protection=404` + `rulesets=200 无生效规则` @2026-09-27T13:16:35Z）。
- **H1 备份第三条出路真的做出来了**（用户只需配一个 secret）：新 `scripts/backup-crypto.mjs`
  （AES-256-GCM + scrypt `N=2^15,r=8,p=1`，定长头 `SMBK|v|salt|iv|tag|ct`；**口令只走 env**，
  未知 flag 直接 rc=2 —— argv 传口令会进 `ps` 与日志）。工作流改成**三态**判定：private→明文放行 /
  非 private 且有口令→加密放行 / 非 private 无口令→**红**（不退化成明文上传）；守卫仍排在导出之前。
  一手分母（先取数再动手）：本机 `schema.sql + seed.sql` = **9 表 / 56 行 / JSON 15,400B**，最大单表
  INSERT 体 16,864B ≪ `d1_statement_bytes = 100000` ⇒ 备份体积不是瓶颈；**现网行数记 UNAVAILABLE**
  （缺 CF 凭据且 `d1 execute` 须先过部署 skill ⇒ 不拿本机种子上冒充实测）。
  关键一条：**产物存在 ≠ 备份可用** ⇒ 上传前跑 `--verify`（解回来与原文逐字节相等），
  并把明文从上传面摘掉；存活判据新增"产物名字必须像备份"（`d1-backup(-enc)?-<run>`，
  名字 ⇄ 工作流两条上传步骤 ⇄ 明文步骤的互斥 if 三向对账，`tests/backupArtifactName.test.ts` 4 条）。
  对标原文：`actions/upload-artifact` README:123「**Users must be logged-in in order for this URL to work**」
  = public 仓产物对任意登录用户可下载；`FiloSottile/age` README:174/182/256（口令模式、解密时自动识别格式）。
- **H2 五处各说各话的体积上限收敛成一把尺**：`functions/lib/shared.js` 的
  `MAX_STATEMENT_PAYLOAD_CHARS = 90_000`（= 平台事实 ×(1−10%)）。改前三条尺全在**平台预算之外**：
  orders/reviews 各 `800 * 1024` 字符、submissions `2 * 1024 * 1024`、前端 ReviewForm `2MB` ——
  而本仓 `public/` 现有 **115 张图实测** base64 后 p50≈29,677 / **p90≈103,298** / max≈204,538 字符
  ⇒ p90 就已越过 100,000B 单语句上限：旧校验形同虚设，真实后果是应用层放行、平台层报错。
  顺带把第十七轮 M5 那句"须先统一量纲再谈等值"**结案**：base64 是 ASCII ⇒ 1 字符 = 1 byte，同尺可比。
  两把新守卫：整行 payload 预算（订单/评价/服务申请各一处）+ 把 orders.js 里"图太大"与"格式无效"
  共用 `invalid_image` 拆开（原文案会把用户支使去改图片格式，而问题其实是体积）。错误码登记 33→**35**。
- **H3 单行数量上界 = 99**：`orders.js` 原先只判 `Number.isInteger(qty) && qty > 0` ⇒ 数量无界，
  叠加 `stock = -1` 不限售项跳过扣减 ⇒ 10⁹ 件的订单在服务端合法。取值**继承本项目在册的产品决定**
  （详情页 `qty >= 99` 硬顶，本轮两处字面量改引用常量），不擅自改成对标值：`saleor/saleor`
  `DEFAULT_LIMIT_QUANTITY_PER_CHECKOUT: Final[int] = 50` 是站点可配默认值、`medusajs/medusa` 根本不设
  数量上界只校库存 ⇒ 两家共同点恰是"这个数必须是产品决定"。新码 `quantity_exceeds_limit`，
  两侧等号进 `tests/limitCapParity.test.ts`（该文件 8→14 条），`verify:backend` 新增 10 条真跑探针（142→152）。
- 判据自身两处洞（都是本轮自己踩出来的）：① 普查把 **JSDoc 里的散文数字**当成第 8 个上限
  （我在 `shared.js` 写对比说明时提到旧的 `2 * 1024 * 1024`）⇒ 改判据不改措辞：`census()` 现剥块注释
  且**保行号**，配双向夹具（散文不算 / 代码必算 / 行号不漂）；已知未覆盖面：行尾注释仍会计入，写进册子。
  ② 登记册抬头"六类形态"是第三十六轮留下的**过期断言**（实测七种正则形状 + 一种 AST 形状）⇒ 按
  `Object.keys(SHAPES).length` 更正。
- 自失六条（都由自家门禁/当场回读抓出，不是运气）：**探针被我追加到汇总打印之后**（打印 FAIL
  却不影响退出码 = 假绿形态，搬回之前）；**脚本越界**：给"常量上限"行补平台事实名时把 7 条
  perf/product 行一起改了 —— 那等于让登记册说谎，当场回退并加计数断言；新测试文件又带 **2 个未用
  import**（lint 抓，同形第三次）；README 链路叙述被我插进一条不属于链路的描述（它是测试不是 CI step），
  撤回；`image_too_large` 的探针期望是我臆测的（真返回 `invalid_image`）⇒ 先归因再改，最终改的是**代码**
  而不是断言；`block 注释剥除后行号`期望值我手数是 7、实测 6 ⇒ 改成让夹具自己数。
- 用户侧不变：**N3 部署**（对外发布不在自动化授权内，动前必须加载 `chaoshi-web-deploy`）；
  **M3 分支保护** `NOT_ENFORCED @13:16:35Z`；备份要真跑起来还差两个 secret ——
  `CF_D1_BACKUP_TOKEN`（导出权限）与 **本轮新增的 `BACKUP_PASSPHRASE`**（非 private 仓的加密出路）。
  本轮**没有**设 `BACKUP_SKIP_OK`，也没代配任何 secret。
- 复验收据：`npm run verify` 独占 `VERIFY_RC=0`，**95 文件 / 1283 条**；链内
  `limit-provenance 10/10（74 项全覆盖，死行 0）`、`error-semantics 35 码双向`、`memory-volume 检查 4/5（V4 未验证照实印）`、
  `pointers 已核对 2/2`、`verify:backend 152/0`。
- 远端回执：内层 `3aa741e` 的 CI `run 36324712488` = `conclusion=success`（五必需 job 全 success，读自 `gh run view --json conclusion,jobs`；`gh run watch --exit-status` rc=0）⇒ 本轮新增的 crypto / 产物名三向对账 / 工作流顺序变异夹具在 ubuntu 上同样判得动（R36 那条"夹具读本机状态"未复发）。`D1 Daily Backup` 显示 `active` 只证明三态 YAML 的**语法**被 GitHub 收下表，"无口令⇒判红"的**语义**仍未观测 ⇒ 记未验证，不记已验证。

### 2026-09-27 追加五十一（第三十六轮收尾：本轮 HEAD 的 CI 其实是红的，而回执看起来是绿的）

- 取号先列盘：在册最大「五十」⇒ 本条「五十一」。触发事实：`git push` 时 `[ci-green]` 打印
  `GREEN base=bec6252 local=81cd520 :: run 36314824897 全绿`，我据此把本轮记成"远端已绿"；
  收口时按 `check-runs` 原文重读 **81cd520 自己的 run = 36318373975** ⇒ `build-and-test=failure`
  （其余 4 个必需 job success、`deploy`/`parity` skipped）。
- **两件各自独立的缺陷**：
  1. **夹具读本机状态**：`tests/memoryPointerSync.test.js` 的"真跑本仓"腿无条件断言外层目录必须存在
     —— 外层 `超市/memory` 在代码仓之外，CI 检出面里永远没有它 ⇒ 这条断言在 CI 恒假。
     本机全绿 + CI 红 = 该腿从来没被"外层不在场"这个真实分布测过。
  2. **回执不指名对象**：`ci-green-contract` 的语义是"别往红基座上叠加"，量的天生是**远端当前 SHA**
     （新 commit 还没有 run，这点写在代码注释里）。缺陷不在判据，在**打印的 run id 不带 sha** ⇒
     读者把上一轮的绿回执安到本轮头上。契约只量基线这件事本身没变，也不会替本轮 commit 担保。
- 修法：① 那条腿改成**环境自适应**——外层在场就必须读出轮次且不得 UNVERIFIED，外层不在场就断言
  "未观测"确实写在门面行上（两个分支各有一条真断言，环境可以缺、断言不能空）；② 新增 `--outer <dir>`
  注入点 + 合成外层夹具，让"外层在场 ⇒ 通道观测得到"这条性质**在 CI 上也可证**（外层永远进不了 CI 检出，
  不注入就只能本机可证），夹具先做中文轮次**往返自证**再使用；③ `verdictOf` 四处回执统一为
  `run <id>@<sha 前 7 位>`；④ 门面行 `检查 N/N` 是恒真分母（P2 未观测时仍印 2/2 = 把"没比"记成"比过"），
  改为 `已核对 x/N`（未验证不计入已核对），UNVERIFIED 的 detail 印**实际路径**而不是硬编码常量。
- 验证（三态各一条，实跑非推断）：`--outer Z:/nope` ⇒ `已核对 1/2｜未验证 P2` rc=0；
  合成外层（轮次=内层）⇒ `已核对 2/2` rc=0；真面 ⇒ `内层 36 轮｜外层 36` rc=0。
  受影响两文件 `40 passed (40)`。
- 台账顺带量了一把分母：`verify` 链 22 个成员里 README 按**别名**可见的只有 4 个（其余按中文叙述），
  本轮接入的 `verify:pointers` 连叙述都漏了 ⇒ 已补进链路叙述；而"叙述 ⇄ 链成员"目前**无机械对账**，
  登记为 R37（先有分母再谈判据，不拿"应该补个判据"当结论）。

- **本笔推送用了逃生门 `CI_GREEN_SKIP=1`（留痕，不是悄悄绕）**：闸按设计判红 —— 基线就是 `81cd520`
  本身，而它红的唯一原因就是本笔在修的那条"CI 依赖本机状态"的断言；重跑它必然还是红，
  "等基座变绿再推"在此不可满足。走 PR 也能先证绿，但会在远端留下他人可见的对象，
  而逃生门是本契约自带、强制带理由、并把账印在推送输出里的通道。**用了绕过通道不等于免于验证**：
  落库后本笔自己的 run 回执补在下一次提交里，远端不绿就当场写在册上。
- **回执（读自 `gh api .../commits/0e8c567/check-runs` 原文，非推送时的钩子输出）**：
  `build-and-test=success`、`e2e=success`、`e2e-cloud-stub=success`、`visual=success`、`deploy=success`
  （另 `parity`/`dispatch`/`PR test-coverage advisory` 全 success，8/8 completed）
  ⇒ 逃生门只用了一次、基线已回绿，下一笔恢复正常判定。
  修复面另有**日志原文**为证（`gh run view 36319557640 --log`，step `Workspace memory pointer sync (advisory)`）：
  ubuntu 上印的是 `GATE-PASS memory-pointer-sync :: 内层 36 轮｜外层 不在｜已核对 1/2｜未验证 P2`
  —— 外层不在场时它把"没比"写在脸上，而不是静默按通过记。
- 补笔（同轮第三次自失）：上面对报告里"并加一条回归腿钉住 sha"这句话，**写的时候那条腿并不存在**
  （报告先于事实 = 本轮在治的同一毛病）。现补进 `tests/ciGreenContract.test.js` 的「回执身份」腿
  （GREEN/RED/BLOCKED×2/UNKNOWN 五例一律断言 reason 含被喂的 sha），变异对照实跑：
  把 `who` 退回不带 sha 的旧写法 ⇒ 该腿当场 `1 failed | 27 passed`；改回 ⇒ `28 passed`。
  ⚠️ 本条初稿是用 `node -e "..."` 写的，串里的反引号被 bash 当命令替换执行 ⇒ 代码跨度量与两个实测数字
  被替换成空（第九形态复发）。已用编辑器工具改写，**凡要写含反引号/`$` 的中文正文，一律走 Edit 不走内联脚本**。
- **V5（同轮新增闸，`memory-volume` 第五条检查）**：主卷「在册卷号：A–B」这行措辞本轮实测已落后磁盘一格
  —— 建卷 57 时没并号（声明 1–56、磁盘 1..57），是"约定没有判据就会无声失效"的又一例。判据做**双向差集**：
  声明有磁盘无（跳号/误删）与磁盘有声明未并号分别点名；读不到声明 ⇒ UNVERIFIED；声明在而一卷都没扫到 ⇒ FAIL
  （取数面坏了 ≠ 没得对）。**上线当轮就在真面演习过**：把主卷临时改回 1–56 ⇒ `FAIL V5 … 未并号 = 57,58 ⇒ 把主卷
  那行上界改成 58`，改回即绿。另把本轮收尾节按 V4 切成 **卷 58**（1,515B + 2,212B == 3,727B 字节守恒，切卷器带
  回读断言，且拒绝覆盖已存在的目标卷）。
- ⚠️ 同轮第四自失（读文件时当场抓到）：给主卷那行做变异演习后**回滚按前缀锚点补句 ⇒ V5 说明被写成两份**。
  口径：按前缀锚点改长行，回滚必须回读整节核对重复与缺失，不能靠记忆。顺带把主卷压回自立的 3.5KB 软上限内
  （3,806B → 3,457B）：备份段改为指向卷 57 的指针，第十七轮压缩史逐字迁卷 48（主卷留一行指针）。

### 2026-09-27 追加五十（对标第三十六轮：把"只有措辞在守"的三件事变成会红的东西）

- 取号先列盘：在册最大「四十九」⇒ 本条「五十」。轮初锚 `bec6252`（R35 收尾，其 CI 8 个 check 全
  `completed/success`，读数取自 `check-runs` 原文）。Step 0 台账重扫：A 仍有效 28 / B 待实测 13 / C 已失效 6。
- **H1 购物车行身份 = `(productId, spec)`**（台账 A-19，挂 8 轮）：`addToCart` 原先只比 `productId`，
  条目却带着 `spec` ⇒ 先加「黄瓜味」再加「柠檬味」会并成一行且保留第一个口味，**第二次选择在购物袋层面就被吞**。
  15 处全改（`cart.ts` 键控与三个 mutate、`getItemQuantity` 改跨口味聚合、`useCart` 三个包装、
  `CartPage` 三回调 + `key`、`CustomerPage` 减号、`OrderConfirmPage` 的 `key`）。
  顺带修 `existing.quantity += n`：`[...cart.items]` 只拷数组不拷元素 ⇒ 旧实现**就地改调用方手里的旧 cart**，
  现改 map 出新对象并配断言。服务端与下单链路一行未动（本来就逐 item 一行、spec 走 `allowedOrderSpecs` 白名单、
  幂等指纹含 spec）⇒ 缺陷 100% 在前端键控层，这条结论本身写在代码注释里。
  测试：`cart.test.js` 13→21、`cartPage.test.tsx` 4→7（接线级，断言 spec 真的被传下去）。
  ⚠️ 台账纠偏：R35 在册写的是"9 处消费者"，穷举实为 **15 处** —— 少列会让下一轮以为改完了。
- **H2 上限普查面补两半 + 四对两侧同值契约**：旧「拒绝型」正则要求右值是数字 ⇒ 面内 **8 处**
  `.length >= 某常量`（`SPEC_OPTION_LIMIT`/`MAX_REVIEW_IMAGES`/`BATCH_UPDATE_MAX`/`BATCH_DELETE_MAX`/`BATCH`/`PAGE_SIZE`）
  **完全隐形**；「截断型」同理漏掉 **3 处** `.slice(0, 常量)`（含前端 `FLAVOR_MAX_LEN=20` vs 服务端 `slice(0, 20)`）。
  新增两个形状后普查 **65 → 74 项**，74 行全部带溯源（`limit-provenance 10/10`）；
  新契约 `tests/limitCapParity.test.ts`（8 条）钉服务申请 5 / 图册 9 / 口味 20 / 口味名 20 四对两侧同值，
  每条带"解析不到即判红"的防空转腿 —— 它上线第一件事就是把我自己猜错的前端写法（链式 `.slice(0, 9)`）抓红。
- **H3 新判据 `verify:pointers`**：外层工作区记忆指针是否跟上内层轮次（实测停在第 29 轮、内层已到第 35 轮，
  **5 轮断更无人在意**）。三态：跟上 PASS／漂移 FAIL／外层目录不在（CI 只检出代码仓）报 **UNVERIFIED 且 rc=0**，
  绝不复用 PASS。CI 里它是 advisory，真正守现场的是本地 `npm run verify`。本轮主卷写到第 36 轮的瞬间它就判红，
  逼出外层那条指针 —— 耦合当天闭环。夹具 12 条（含"路径必须是代码仓**同级**"的自证腿）。
- **H0 自动备份链现状入册**：`Uptime` run `36299454141` 判红，本地实跑同结论 —— 窗口内 **4/4 次
  `D1 Daily Backup` 全部 `Export remote D1=skipped`、`Upload backup artifact=skipped`、`artifact=0`**
  ⇒ **生产库从未被这条链备份过**（其中 2 次 conclusion 还是 success = 恒绿空转）。两道成因写进 `SECURITY.md`：
  缺 `CF_D1_BACKUP_TOKEN` + 仓库 2026-09-25 起 public 后**自身守卫拒绝上传明文全库导出**。
  **不设 `BACKUP_SKIP_OK`** —— 那是把真红消音，正是第十二轮"绿色零备份"的原始教训。
  顺手修判据自己的结构性失明：原先只给最近 3 次 run 取步骤明细（窗口 4 天 ⇒ 第 4 次永远瞎，
  那句"1/4 取不到明细"看着像 API 不稳其实是 `slice(0,3)`）；现按窗口全取（上限 12），
  并把失明三分成"取数失败（带原因）／主动未取／无记录"，覆盖度印成 `N/M`；夹具 17 条（+2）。
- 复验：`limit-provenance 10/10`、`registry-sync 6/6`、`cli-entrypoints 11/11`（入口 39／跑过 28／分母 33）、
  `memory-pointer-sync 2/2`、`memory-volume 判 66 卷 超限 0（未验证 V4）`、`verify:docs OK（93 文件）`、
  `verify:backend 142/0`。**整链独占复验 `VERIFY_RC=0`、`Test Files 93 passed`、`Tests 1238 passed (1238)`**（19:5x 本地，跑期间不写盘）。
- 整链第一次是红的，但红得不属于本轮代码：`apiResponseContract` 的子进程 rc = **3221225794（0xC0000142，Windows 进程启动失败）**，
  同一轮 vitest 还报 `Failed to start forks worker`。归因顺序：单独重跑那两个文件 ⇒ 21/21 绿；整链再跑一次 ⇒
  换了位置且全绿 ⇒ 判为测试并发下的**进程创建抖动**，不改任何断言。（不写"环境偶发"就完事：
  留了复现码与两次对照结果，若下轮同点再红两次就必须当真修。）
- lint 第三次抓到同一族（R35 已为同类记过形态）：新脚本 `pathToFileURL` 与新夹具 `mkdirSync`/`writeFileSync`
  三个未用 import ⇒ 清干净后 `0 errors`。这条"新判据自带死代码"的复发说明：**新文件的 lint 必须在写它就位后立刻跑**，
  而不是等整链。

- **本轮四次自失（都由自家探针/自检抓出）**：① 新判据路径多写一级 ⇒ 恒 UNVERIFIED 且输出看着合理，
  靠"真面必须观测得到"那条腿逼出；② 解析器读不懂区间写法"第三十~三十五轮"⇒ 误报"停在 29"，
  是量具的洞不是事实；③ 两次 Edit 拿同段既有整行当 `old_string`，一次吞掉下一个 `describe` 头、
  一次吞掉一条在册记忆 ⇒ 靠结构计数与 `git diff --numstat` 现形；④ 一条缺输入面夹具写成恒真断言
  （`expect([..].length).toBe(1)`），落盘前自查删除。

### 2026-09-27 追加四十九（对标第三十五轮：让"登记表说的"和"代码做的"必须互相作证）

- 取号先列盘：在册最大「四十八」⇒ 本条「四十九」。轮初锚 `b37738d`（R34 收口提交，CI 8 个 check 全
  completed/success 已用 `check-runs` 原文核过）。
- **Step 0 台账 76 条**（45 仍有效 / 18 待复测 / 13 已失效，扫过 65 个文件；`07-next-steps.part*` 实数 51 卷）。
  台账浮出的**头号不是判据而是功能缺陷**：图片**条数**上限只活在前端。
- **H0 服务端补条数 cap（接续台账 A-08/A-09）**：4 个 `validateImages` 出口实测只有 `addReview` 有 cap（`>3`），
  `createSubmission`（前端 ≤5）与 `createProduct`/`updateProduct`（前端 `slice(0,9)`）**服务端不查条数**，
  而 `docs/limit-provenance.md` 自己写着这件事 ⇒ 三处补齐（复用已在册的 `too_many_images`/400，两处产品出口同笔改，
  缺一侧即被另一侧绕过）。普查 63→65 项，判据 9→10 条。
- **新判据 C9（扩进 `check-limit-provenance`，不另立第二把尺）**：凡调用 `validateImages(...)` 的函数，
  必须对**被校验的那个数组**有条数 cap；按函数核不按文件核。
  **首版被自己的变异体证伪**：通用 `\.length\s*>\s*\d+` 把同函数的单张体积 cap（`img.length > 2*1024*1024`）
  当成条数 cap ⇒ 摘掉真 cap 仍判绿。改为绑定实参源码路径后：变异点名
  `submissions.js:14 函数 createSubmission 收图片却无 clean.images.length 的条数 cap`，还原后 10/10。
- **运行时探针 9 条 + 一条工具级守卫**：cap 断言全部要求机器可读 `errorCode`（不只 `code===-1`）；
  首跑被限流桶顶替（`rate_limited` 冒充"条数被拒"、正向腿假失败）⇒ 每条探针改用独立合成
  `CF-Connecting-IP` 并加**前提自证**断言。另把 `verify-backend` 的 `ok()` 加固：空标签一律判红并点名
  （本轮真实事故：内联 shell 把 `${}` 当命令替换吃掉，6 条断言落成 `ok(cond, )`；
  变异验证 `142 通过 / 1 失败`）。
- **H1+H2 新闸 `verify:registry`（接续 A-01/A-02/A-44）**：代码分发面 ⇄ 三张登记表双向差集。
  一手数字：分发面 39（`/pub` 8 + `/web` 31，与 `api-contract.json` 双向逐字相等）、SQL 基线 **43 键**、
  形状登记 **42 条** ⇒ 两张表各自多出**同样 3 条**越权/未知 action 探针键，另有 `amortized:audit-retention-purge`
  （第二十八轮的桶，**迟到 6 轮**才入册）。4 条落成 `PROBE_EXCEPTIONS`，每条例外理由须含实测数字或可复跑命令
  （新共用件 `scripts/lib/registry-reason.mjs`，`RESPONSE_GAPS` 与例外册同一份实现）；
  **例外册自身也反查**——对不上任何登记键的例外判红，文案照 `rust-lang/rust` tidy 的
  `Remove from EXCEPTIONS list if it is no longer used.`。夹具 16 条含三条真入口子进程腿（真跑 rc=0／
  假仓缺输入面 rc=2／`--json` 六行）。
- **V3 补强（同一轮把"理由质量"也接到响应契约上）**：`RESPONSE_GAPS` 今天**是空集** ⇒ 新腿全部**自造前提**
  （注入一条散文式理由 ⇒ 红，且红因只许来自"不可证伪"这一类）。这正是上一轮被整链复验抓出的形态。
- **H3 `V4` 把措辞变成闸（接续 A-03）**：`check-memory-volume` 新增"新卷出生余量 ≥25%"，**只拦本次新增件**
  （`git diff --cached --diff-filter=A`），历史卷不追溯；`--all`（CI）模式没有"新增"概念 ⇒ 印
  `UNVERIFIED` 且门面行记 `检查 3/4｜未验证 V4`，绝不复用 PASS。追溯普查（首提字节）：现 7 本贴线卷里
  **5 本出生即贴线**，其中 `part46` 的首提就是"立这条规则"那次提交 `8c3e6bf`。夹具 6 条（含两条真入口腿）。
- **响应形状契约当场抓住我 own 的下游效应**：cap 探针让 `createProduct` 响应多出"时有时无"的 `images` 键、
  三条 action 首次录到失败信封 ⇒ V4/V5 判红。按流程登记条件字段后 `--write` 重录，**逐字段差集核对**
  （42→42 条、新增 0、删除 0、6 条字段变化全部由本轮探针解释）。
- **Step 0 的另一手：外层工作区记忆断更 5 轮**。`超市/memory/07-next-steps.md` 的"工作区级指针"序列止于
  第二十九轮（末次写入 commit `b619339` 13:57），R30~R34 无人补；且它只被 `handoff.py volume` 的
  `shell_max=40,960B` 口径量着（内层 4,096B 判据作用面不含它）⇒ **两把相差 10 倍的尺，更松的那把量着更旧的那份**。
  本轮写停更声明 + 一次补齐 R30~R35 指针（20,995→23,625B），机器化提案带分母留给 R36。
- 文档追上真相源：`README.md` 单测文件数 89→91、**补上从未登记的「响应形状契约」闸**与两条新闸、
  `G1~G10`→`G1~G11`；`ci.yml` 里响应契约步骤的旧注释（"12 个没观测过"）改为现状。
- **整链独占复验跑出两次红，两次都红在本轮自己身上**（这是本轮最该记的事实）：
  ① `oxlint --max-warnings 0` 判红：新闸里留了未使用的常量 `EXPECT_PREFIX` ⇒ 死代码摘除；
  ② 既有「零分母探针」判红：`check-registry-sync.mjs` 在"输入文件存在但 0 字节"时直读
  `JSON.parse('')` 抛裸 `SyntaxError`，违反本仓第二十五轮立的"缺输入面必须 rc=2 + 人话诊断"
  ⇒ 改用 `requireJson` 并给合法但结构错的 JSON 加兜底（让 R1 的零分母去判红，而不是让进程崩）。
  **新闸上线当轮就被自家探针拦下两次，说明探针是活的**；两次都改实现，未放宽任何判据。
- 复验回执：`npm run verify` 独占重跑 ⇒ `VERIFY_RC=0`、`Test Files 91 passed`、`Tests 1204 passed (1204)`；
  链内 `GATE-PASS registry-sync :: … 检查 6/6`、`response-contract 6/6`、`cli-entrypoints 11/11`
  （入口 38／子进程跑过 27／缺口 11／分母 32／带风险 15）、`memory-volume 判 63 卷 超限 0（检查 3/4｜未验证 V4）`、
  `limit-provenance 10/10`、`verify-backend 142/0`。
- 远端可见物：内仓 `00cc307`（22 件；push 时 pre-push 的 ci-green 判 base=`b37738d` 五必需 job 齐备）、
  外层报告 `dc1a87a`；`00cc307` 的 CI **8 个 check 全 `completed/success`**（19:07 读自
  `gh api …/commits/<sha>/check-runs` 原文，不采信后台通知）。
- 收口时自记一次：给卷 54 追加"台账对账"两条时，Edit 的 old_string 取了**同段落已有整条**，
  把"外层工作区记忆断更"那一整条替换掉 ⇒ `grep -c` 归 0 当场暴露。该文件已在 `00cc307` 内有基线，
  按行放回（不 `git checkout`，否则会连新加两条一起丢），复核 `git diff --numstat` = `8 插入 / 0 删除`。
  这是在册"长行台账禁拿既有行前缀当锚点"的同族复发，改法不变：**加条目用列表末行锚点 + 事后核 deletions**。



### 2026-09-27 追加四十八（对标第三十四轮：把挂了 5 轮的 `aiChat` 形状做掉，且是用"证伪自己的旧理由"的方式）

- 取号先列盘：在册最大「四十七」⇒ 本条「四十八」。回滚锚 `aef58fa`（其 CI 五 job 全 success 已确认），
  备份 `/c/_sm_backups/r34-start-aef58fa.bundle`（bundle verify = complete history）。
- **M1 `aiChat` 响应形状（挂 5 轮，本轮关闭）**：响应契约 **41 → 42 条，具名缺口 1 → 0**。
  关键不是"补了个 stub"，而是**上一轮写在缺口表里的理由被本轮自己证伪**：那句"需要 fetch stub、
  verify-backend 全程离线、无 key 时形状不同所以守不了"三处不成立 ——
  规则模式本来就不联网（线上现在正是 `ai.configured:false`），Dify 模式离线打桩即可跑出成功形状。
  桩的字段名不是编的：照 `functions/lib/dify.js:107-109` 的解析代码取 `answer` / `conversation_id`。
  三条新探针（`scripts/verify-backend.mjs`）：规则模式形状、Dify 模式形状、**桩真的接住了**
  （记录到 1 次 `POST https://dify.invalid/v1/chat-messages` ⇒ 能区分"分支没跑到"与"跑了但没出网"）。
  两种模式的恒定字段一致：`keysAlways = [content, conversationId, source]`、`calls: 2`。
- **SQL 基线按流程入册**：新调用路径 `P:aiChat` 先被 C1 判"基线缺 action（新增调用路径？确认后入册）"，
  人工核过峰值 **3** 与同族写路径一致（`P:addPublicReview=3`、`P:createSubmission=3`；读路径 1）再入册；
  入册后 diff 核对：键 41→43，**新增 = `P:aiChat` + `amortized:audit-retention-purge`，删除 0、值变化 0**。
- **H2 `reads-secrets` 扩类：以"改判"关闭（不扩）**。按本仓规矩先出人口数字：
  候选面 40 个 `.mjs`；`.dev.vars` 命中 **0**；`process.env.*` 命中 **11**，其中 **7** 条已被
  `network-fetch`/`gh-cli`/`wrangler`/`d1-execute` 覆盖 ⇒ 新标签对它们零区分度；剩 **4** 条读的是
  `CI`/`NODE_ENV`/输出路径类变量而非凭据。⇒ 加这个词等于给 27% 的面贴一个无信息标签，
  还会把 4 个今天被 ②③ 真跑的干净入口挤成"必须先自述才能跑"。**不改判据、只把否证数字记下来。**
- **H1 定时链接入（R34-P0-1）**：`Uptime` workflow 每日跑一次 `check-branch-protection.mjs`
  （`continue-on-error: true`，advisory）。如实写明预期读数是 **UNVERIFIED**：读 protection 需 administration
  权限，而该 job 按最小权限只有 `contents:read`+`actions:read`；这仍是有价值的产出——它把"我们看不见"
  从"我们忘了看"变成机器每天说一次。扩权/新增 secret 属用户侧决定，不擅动。
- **文档补齐**：`SECURITY.md` 新增「服务端防护现状（机器在册）」——此前全仓没有任何地方写着
  "main 到底有没有保护"。现记录：实测 `NOT_ENFORCED`（404 + rulesets `[]` 双通道可观测）、
  现有补偿是本地钩子（可信度低于服务端强制，写明是事实不是宣传）、为何定时链常读到 UNVERIFIED、
  以及管理员要开成 `ENFORCED` 的具体一步。
- **第一次独占整链复验是红的，且红在本轮自己脸上**（`npm run verify` ⇒ `VERIFY_RC=1`、
  `Tests 2 failed | 1171 passed (1173)`）。两项都不是环境噪声，都是**夹具失去牙齿**：
  ① `tests/apiResponseContract.test.js` V3 的"漏登记缺口 ⇒ 红"用的变异体是 `gaps: {}`，
  它成立的前提是缺口表非空；本轮把 `RESPONSE_GAPS` 清零后，这个"反例"与真实态逐字节相同，
  判据正确地不红 —— 假过的是夹具。改成**自造前提**：抽掉一条已覆盖的录制，让 uncovered 真有它，
  并补两条对偶断言（前提自证 + 补上理由即转绿，门禁必须收得下真话）。
  ② `tests/ciWorkflow.test.ts` 的"抽掉 GH_TOKEN"是非全局 `replace`，只删第一处，而本轮新增的
  普查步骤带来第二个 `GH_TOKEN` ⇒ 抽完还剩、判据无话可说。改为全局删除，并在删除前后各加一条计数
  断言（变异前 0 命中、抽完仍有剩余，两种"空操作变异体"都直接判红）。
  修 ② 时另查出**判据本体**的第三个缺陷：catalog 的 `continue-on-error` 检查按整文件耦合，
  既会把无关 advisory 步骤算到它头上，又会因正则 `[ \t]*$` 收尾而**被一句行尾注释看瞎** ⇒ 改为按 step 分块。
- 复验：`node scripts/api-response-contract.mjs` ⇒ `实测 42 条在册形状｜检查 6/6`；
  修完两处后的**整链独占复验**（无并发改动）⇒ `VERIFY_RC=0`、`Test Files 89 passed`、`Tests 1173 passed (1173)`；
  链内 `node scripts/verify-backend.mjs` 三条新探针原文：
  `PASS /pub aiChat 未配置 AI ⇒ 规则模式成功形状 (source=rule)`、
  `PASS /pub aiChat Dify 模式成功形状 (source=dify, conversationId=conv-shape-1)`、
  `PASS /pub aiChat 的出口被桩接住（不发真网络）：[{"url":"https://dify.invalid/v1/chat-messages","mode":"POST"}]`；
  `cli-entrypoints 11/11`（分母 31 / 带风险 15）、`memory-volume 判 58 卷｜超限 0`。

### 2026-09-27 追加四十七（对标第三十三轮：把"每轮靠我记得去重跑"的欠账变成在册判据，并承认体量是被压到天花板的）

- 取号先列盘：在册最大「四十六」⇒ 本条「四十七」。回滚锚 `8c3e6bf`，备份
  `/c/_sm_backups/r33-start-8c3e6bf.bundle`（bundle verify = complete history，且做了**载回演练**：
  从 bundle clone 后 HEAD 与真仓逐字相符）。第三十二轮的 CI 也在此确认：run 36305738589 的
  build-and-test / e2e / e2e-cloud-stub / visual / deploy 全部 `completed/success`。
- **H2 新判据 `scripts/check-branch-protection.mjs`（advisory，永不拦提交）**：这条欠账从第二十八轮起
  挂了 5 次，每次都是我在报告里手写一句"`gh api` 又 404"——口头重跑的问题在于只有我记得时才检查、
  结论不落地、且把"取不到"和"确实没开"混成一句话。现在四态分明并带 域×状态码×时刻：
  `ENFORCED` / `ENFORCED-VIA-RULESET` / `NOT_ENFORCED`（必须**两条通道都可观测**才敢说没开）/
  `UNVERIFIED`（rc=2，既不写"没开"也不写"已开"）。真查结果：**NOT_ENFORCED（protection=404 + rulesets=200 空）**。
  对标取到 `ossf/scorecard` `docs/checks.md` §Branch-Protection 两条原文：5 项子设置"require an admin token"，
  以及"无 admin token 时按已满足计"——**我们有意反着做**：评分器不该因缺观测扣分，台账不能把缺观测写成清白。
- **M1 清单从三份收成一份**：风险表成为 admitted 的唯一真相源（测试改读「已证明停在门口」行），
  「账本⇄源码」由 G11 双向核、「账本⇄分母」由测试核。上一轮我在测试里手抄 5 个文件名，那是第三份副本。
- **H1 体量：贴线告警 + 一条被数据推翻的自我认知**。新加的 WARN 第一次跑就打出
  **9 本卷在 15% 余量内、4 本余量 <100B** ⇒ 上一轮我以为"写超是偶发、压措辞就好"，实际是**整库被压到天花板用**。
  规则改成：**新卷写到 3.5KB 就开下一个卷号，不许压措辞**（压措辞会删事实）。告警走 stderr，
  stdout 仍是结论通道。
- **M2 用真实数据填了上一轮的空白**：新分母在 Linux runner 上的耗时不再靠本地外推——CI step 计时
  （粒度为秒）显示 vitest 套件 61s、`CLI entrypoint real-run gate` 与 `Memory volume budget gate` 各 <1s，
  31 条探针腿随套件全绿。
- **本轮修掉一个会"把取不到写成结论"的自造 bug**：`gh()` 形参叫 `args` 而调用方传字符串，
  `[...字符串]` 把路径拆成单字符 ⇒ gh 用法错误退出 3 ⇒ 我的映射读出 `'ERR'`，
  真查一度显示 `UNVERIFIED :: protection=ERR rulesets=ERR`，而实际读数明明是 404 + `[]`。
  修法＝助手入口归一化参数 + 读数保留真实 rc（`rc=3` 而非假 'ERR'）+ **非对象 body 不再覆盖 http 字段**，
  并加一条夹具钉子：碎参数读数绝不能被读成"没开"。
- 登记面：入口 **37**（门禁类 24 / 非门禁 13）｜真跑 **26**｜带危险特征 **15**｜分母 **31**（地板 25，headroom +6）。
- 新夹具文件 `tests/branchProtection.test.js` 7 条（四态真值表 + 注入式子进程真跑 + "把守卫摘掉必须翻红"的变异体）；
  单测文件 88 → 89（README 已按真相源更新）。
- **主卷结构治理（不是压措辞）**：新增一轮指针后主卷第三次越线（4,192B / 超 96B）。这次改结构而非改字——
  把「历史轮次小节」整节迁到卷 48（迁移段逐字不变，守恒核对 0 行丢失），主卷只留 3 行指针：
  **4,192B → 2,587B，余量 1,509B（37%）**。这才是 H2 那条新规则的真实产出：贴线问题源于"主卷承载了历史账"，
  不是"这轮写多了"。`--all` 复跑：判 57 卷、超限 0。
- 全链独占复验（数字取当场输出）：`npm run verify` rc=0；vitest **89 文件 / 1173 条**全绿；
  `GATE-PASS cli-entrypoints 11/11`（入口 37 / 真跑 26 / 带风险 15 / 分母 31）、`GATE-PASS memory-volume 判 57 卷超限 0`。

### 2026-09-27 追加四十六（对标第三十二轮：把"能不能自动跑"交给被试对象自述，并把自己的假设否证一次）

- 取号先列盘：在册最大「四十五」⇒ 本条「四十六」。回滚锚 `3f55e61`，备份
  `/c/_sm_backups/r32-start-3f55e61.bundle`（`git bundle verify` = complete history，且**载回演练**：
  从 bundle clone 出来 HEAD 与真仓逐字相符）。
- **L2 落地（承第三十一轮）**：新增 `@probe-safe` 声明口径 —— 危险脚本可以在**自己源码里**独占一行写
  `// @probe-safe: <实测依据>`，声明"我会在触碰外部世界之前停住"，从而回到探针分母。
  对标取到硬回执：`golang/go` `src/cmd/go/internal/test/testflag.go:67`
  `cf.Bool("short", false, "tell long-running tests to shorten their run time")` ⇒ **条件写在被试对象里，
  框架只做机械核对**，不维护中心名单（rustc 的 `//@ needs` 未定位到定义处，本轮不作类比）。
- **新判据 G11**：三方对账 —— 声明必须有真危险特征可宣（没特征还声明＝无效声明）、依据必须带实测数字、
  且与风险表的「已证明停在门口」一一对应。五个反例全部配了夹具。
- **实测支撑**：5 个非门禁危险项（`check-catalog-facts` / `ci-green-contract` / `gen-api-doc` /
  `migrate` / `purge-security-events`）在**两种骨架**里分别 rc=2/1s、rc=1/0s、rc=2/0s、rc=1/0s、rc=2/1s，
  首行均为自家诊断；`purge` 是第三十一轮立的 `--yes` 授权门在起作用。⇒ 分母 26 → **31**。
  另 5 条（`check-pr-has-tests` 按设计 rc=0、`ci-status` 9s 真打网络、`local-api-stub` 挂死 30s、
  `smoke-deploy`/`uptime-check` 先打线上）**不给声明**，留在面外并在表里写明原因。
- **地板没有跟着抬，是有意的**：分母 31 而「分母地板」仍写 25 ⇒ headroom +6 并由 G10 印出来。
  按本仓铁律，把地板抬到刚好等于当前值＝冻结增长；防"5 项被静默摘回面外"的岗由 G11 +
  测试里点名的 admitted 清单承担，不靠地板。
- **一次自我否证（R31-L3 结掉）**：上一轮把"并发写导致 7 条红"猜成"负载把 20s spawn 预算挤爆"。
  本轮做判别实验：同批 5 条门禁在空闲与 **32 路 CPU 负载**下各跑一轮 ⇒ idle `1.7s/0.2s/≤0.2s`、
  loaded `6.9s/1.5s/≤0.6s`，**两种条件下全部仍 rc=0** ⇒ 假设被否证。残余（复合污染）不再故意复现，
  纪律性结论已够：跑判据期间不要动被测仓（`docs/ci-triage-runbook.md` §9 已更新）。
- **本轮又踩两次自己的坑，都当场改**：
  ① `@probe-safe` 的第一版正则不限行首，于是**判据解释这套机制的注释**自己被记成"带声明但无危险特征"
  —— 与第三十轮 classifyRisk 命中自己注释同型 ⇒ 改为只认独占一行的 `// @probe-safe:`，并补三条夹具；
  ② 用 `indexOf('## 风险分类')` 定位节做替换，先命中了正文里对该标题的引用 ⇒ 一口吞掉「分母地板」与两张表
  （G10/G2 当场判红暴露）。正解＝`git checkout` 恢复 + 按 `^## ` 行锚定切节 + **替换后断言原有节都还在**。
- 夹具：`tests/cliEntrypoints.test.js` 106 → 122 条（G11 五向 + @probe-safe 自指三向 + ②③ 两腿各 +5）。
- 登记面实测：入口 36｜门禁类 24｜非门禁 12｜子进程跑过 25｜缺口 11｜带风险 14｜分母 31（靠声明进来 5）。
- 全链独占复验（数字取当场输出）：`npm run verify` rc=0；vitest **88 文件 / 1166 条**全绿；`GATE-PASS cli-entrypoints … 11/11`、`GATE-PASS memory-volume :: 判 54 卷｜超限 0`。

### 2026-09-27 追加四十五（对标第三十一轮：量这把尺自己——覆盖面口径、分母棘轮、没人守的 4KB 上限）

- 取号先列盘：在册最大「四十四」⇒ 本条「四十五」。
- **H1 覆盖面假覆盖（接续第三十轮台账 #1，本轮 P0）**：`collectCovered` 原口径＝"文件里有 spawn +
  出现过脚本文件名"。合成仓复现：`dangerous.mjs` **从未被 spawn**，只被一条负向断言提到 ⇒ 就被记"已覆盖"。
  修法不是加白名单而是**收紧谓词**：文件名必须沿调用链到达执行点（①spawn 实参 ②被 `for..of` 消费的数组
  ③同行 `const X = join(...)` 且 X 被喂进执行点 ④本地 runner 实参）。
  **收紧过头这一步最值钱**：第一版只认①⇒ 真仓覆盖 24→20，误伤 4 条真夹具（都走 `join` 或封装）——
  我正准备宣布"抓到 4 条假覆盖"。⇒ 收紧口径必须连漏报侧一起测。修好后真仓仍是 24（现 25）：
  该漏洞此前只被我自己踩到一次，**不是既成的系统性虚报**（差点写成"24 条里掺了水"，实测否证）。
- **M1 新增 G10 分母地板**：探针分母由"npm 别名命名 + 源码风险特征"推导 ⇒ 把 `verify:x` 改名成
  `report:x`（脚本里正好有 fetch）会让该项**静默离开分母**，覆盖数与缺口数一起变好看、CI 照样绿。
  登记册现写 `- **分母地板**：25`，实测分母 26（headroom +1）；缺这行本身即判红。
- **H2**：`scan-secrets` 进 ①类覆盖（PROBED 15→16），并把它上一轮的"扫到了 / 没得扫 / 暂存区为空"
  三种形状从注释升级成断言。
- **H3 新闸 `scripts/check-memory-volume.mjs`（`npm run verify:volume`）**：对标
  `pre-commit/pre-commit-hooks` 的 `check-added-large-files`（取到原文：`--maxkb` 显式、
  默认只管 "staged for addition"、`--enforce-all` 才扩面）。立它的实证是**我自己**：`handoff.py volume`
  是报告型（dry-run 不拦），于是我本轮写的 `07-next-steps.part42.md` 4,873B 也能提交成功。
  接线：pre-commit（暂存面，无对象时打"跳过"而非"通过"）+ CI `--all` + `verify` 聚合。
  两种零对象分开：全量面空＝取数面坏了（红）；全为 0 字节＝没有内容可判 ⇒ `bail` rc=2。
- **M2 拆卷（字节守恒可复核）**：part42 原 4,873B = 留 3,782B（含指针 120B）+ 搬 1,212B → part43；
  part35 原 5,408B = 留 4,006B + 搬 1,524B → part44。拆卷器断言 `head+joiner+moved === 原文`，
  另用 `git diff -U0` 的删除行逐行回查新区 ⇒ **0 行丢失**；拆后 `--all` 判 53 卷超限 0（最大卷余量 90B）。
- **一次"把自己的测量弄脏"的完整处置**：独占跑 87 文件/1,129 条全绿；我边跑边改文件并 commit ⇒ 7 条失败；
  停写重跑 ⇒ 又全绿。已写进 `docs/ci-triage-runbook.md` §9（含"哪些用例对脚下变动敏感"清单）。
  逐条路径（被 git 状态影响 vs 被 20s spawn 预算挤掉）**未归因**，挂 R32-L3 而非在此写死。
- 台账体检三条：`gh api` 匿名 curl 得 401、鉴权才得 404（尺用错会把"未测"读成"未保护"）；
  secrets 实数只 2 个 ⇒ "需人不变项"为真；外仓跟踪 `supermarket-web/memory` = 0 个 ⇒ 无 junction 双真相。
- 自我更正四条（当场犯、当场改）：夹具里把 `5009B(+913)` 算成 `5001B(+905)` ⇒ 改成"从输出解析 + 与盘上
  字节数交叉核对"；`arrayRanges` 一度写成恒真条件（边填可达集边自查）⇒ 删；ESM 里误用 `require` 且留了
  一段引用不存在函数的死代码 ⇒ 清；覆盖面第一版只测抓假不测误伤 ⇒ 补对偶。
- `.githooks/pre-commit` 顺手删掉"可用 `--no-verify` 绕过"的教路（与项目铁律冲突，上一轮已在
  scan-secrets 输出里改过一次，这次改的是钩子自己的注释）。
- 夹具：`tests/cliEntrypoints.test.js` 97→106；新文件 `tests/memoryVolume.test.js` 12 条（含变异体）。
- 全链复验（独占，数字取当场输出）：`npm run verify` rc=0；vitest **88 文件 / 1150 条**全绿；
  `GATE-PASS cli-entrypoints 10/10`、`GATE-PASS memory-volume :: 判 53 卷｜超限 0`。

### 2026-09-27 追加四十四（对标第三十轮：把同一把尺换到没人量的那一半，当场抓到密钥扫描"没扫也报干净"）

- 取号先列盘：在册最大「四十三」⇒ 本条「四十四」。
- **R29-M1 落地（它已挂三轮）**：探针分母原先只有门禁类（`verify:*`/`check:*` 22→23 项），本轮换成
  **全部登记入口 ∖ 危险特征** ⇒ `probeDenominator()` 25 项（23 门禁 + `list-uncovered` + `scan-secrets`），
  缺输入面与零分母两法原样施加到新分母（腿④）。**换分母这件事本身就是本轮的方法**，收益当场兑现四条真缺陷。
- **缺陷①（最重，`scan-secrets`）**：在一个零跟踪文件的仓库里跑它，它打印
  「✅ 全仓密钥扫描通过，未发现问题。」并 exit 0 —— 与真扫过 632 个文件的输出**逐字相同**。
  这就是第二十五轮 `check-licenses`、第二十六轮 `check-schema-drift` 的同一个病，藏了 29 轮的唯一原因是
  它不是 `verify:*`、从来不在探针分母里。现在：成功行印"已读 N 个文件"，N=0 时 rc=2 fail-closed，
  `--staged` 空暂存另给一种形状（"跳过"不是"通过"，rc=0）；植入真私钥复验仍 rc=1 抓到 ⇒ 收口没把扫描器削钝。
- **缺陷②（`purge-security-events`）**：实测它在**无 tty** 下 1s 内直接进入 `wrangler d1 execute --remote`
  执行 `DELETE FROM security_events ...`，删的是"谁在什么时候动过数据"的唯一证据。现按本仓
  `migrate.mjs:confirmRemote` 的既有口径要求显式 `--yes`（用法改为 `npm run maintain:purge-events -- --yes`）。
- **缺陷③④（裸栈）**：`gen-api-doc` 缺 `docs/api-contract.json` 时崩在 `node:fs:441`（补 `requireJson` +
  endpoints 结构校验，骨架里 rc=2 且实测不产出 `docs/`）；`check-catalog-facts` 缺 `db/seed.sql` 时同样裸栈
  （补 `requireInputs`，实测 rc=2/1s）。另修 `check-pr-has-tests`：`execFileSync` 默认透传子进程 stderr，
  导致它的第一行是 `failed to run git: fatal: ...` 而不是自家结论 ⇒ `stdio` 改 pipe。
- **新判据 G9**：「自动探针绝不能 spawn 哪些入口」这份名单**不手抄**，由 `classifyRisk()` 从每个脚本
  自己的源码推导（wrangler / d1 execute / DELETE FROM / 起服务 / 改写受控产物 / fetch·curl / `gh`），
  再与登记册新增的「风险分类」表双向对账：漏登、幽灵、标签不符、依据过薄都判红。实测 35 个入口里
  **14 条带风险、21 条可探针**。风险表与缺口表正交（`verify-backend` 既带 DELETE 又有夹具 ⇒ 两表都在）。
  提交后自查又补第五个出口：**登记面引用了不存在的脚本** ⇒ 单列红因并给出动作（补文件或改别名），
  而不是要求它为 `missing-file` 这个非法标签挂一行 —— 那会是一道**只能靠改判据才能过**的死闸
  （对偶夹具已补：把文件写上，G9 必须转绿）。
- **本轮最有意思的一条自错**：`classifyRisk` 第一版把 `check-cli-entrypoints.mjs` 自己判成
  "d1-execute + sql-delete + wrangler" —— 因为它在**注释里解释这套风险词表**。风险是代码的属性，
  不是散文的属性 ⇒ 改为只删整行注释；行尾注释仍算命中（不做词法分析，宁可多报不可漏报）。
  三个方向都补了夹具钉住，含"注释里这些词一律不算"与"行尾注释里仍算"这对对偶。
- **自己的测量反过来咬自己一口**：新写的"危险项不许混进分母"断言里点了 `purge-security-events.mjs`
  的字面量，于是覆盖面（"文件里有 spawn + 出现过文件名"）把它读成"已有夹具"⇒ 它的缺口行变幽灵、G2 判红。
  改成普适不变式，并把这条**假覆盖风险**记进 07-next-steps：覆盖面分不清"跑过它"和"提到过它"。
- **台账体检（每轮证伪几条登记理由，本轮 3 条不实 + 1 处重复实现）**：`ci-status` 理由写着 `gh run list`，
  实测通道是 **curl**（node fetch 不走系统代理）；`check-pr-has-tests` 写着"CI 的 PR job 跑过"，
  实测在 `dispatch.yml:44`（push main 时）；`check-bundle-size` 写的 CI 行号 139/146 实测为 151/158。
  另外实测出：CI 的部署后冒烟是 `ci.yml` 里的**内联 curl**，与 `smoke-deploy.mjs` 是两份实现 ⇒ 判定会漂移，已进清单。
- 夹具：`tests/cliEntrypoints.test.js` 81 → 97 条（新增腿④ 25×2 + G9 五向（含"这道闸必须满足得了"的对偶）+
  classifyRisk 三向（含"注释里的词不算 / 行尾注释仍算"这对对偶）+ 三表解析）。
- `docs/cli-entrypoints.md` 按实测重写：口径 35/23/12/24、四类覆盖、三张表（缺口 8 / 豁免 3 / 风险 14）。
- 全链复验（数字取当场输出，不手抄）：`npm run verify` rc=0；vitest **87 文件 / 1129 条**全绿；
  `GATE-PASS cli-entrypoints :: 入口 35 个（子进程跑过 24 / 缺口 11；可探针 21 / 带风险 14）｜检查 9/9 通过`。
- **一次"把自己的测量弄脏"的实录（提交后自查抓到，已归因，不改代码）**：第二次全链跑出 **7 条失败**，
  其中 2 条正是本轮改过的 `scan-secrets` 夹具。归因动作＝**独占重跑一次**（期间不碰任何文件）⇒ 87 文件 /
  1129 条全绿、rc=0。根因是我自己在套件运行期间编辑 `CHANGELOG.md` 并做 `git add`/`commit`：
  `gateFixtures` 的密钥扫描用例跑的是**真仓 + 真 git 索引**，我的暂存动作改变了它脚下的对象。
  ⇒ 结论按形态记下：**跑判据期间禁止对被测仓做写操作**（与"改文件前先查他人在途"是同一枚硬币的两面）。
  机制深度如实标注：**已证**的是"A/B 只有一处差异（我是否在跑的时候写仓库），独占重跑 7/7 消失"；
  **未归因到底**的是逐条走哪条路径 —— 候选两条：① 那些用例跑的是真仓 + 真 git 索引，我的
  `add`/`commit` 改了它脚下的对象；② 并行负载把 spawn 耗时顶过 20s 预算（`check-licenses` 单跑 1.5s，
  历史上就因并行涨到 5s+）。逐条归因需再花一整轮，记为 R31-L3 待办而非在此写死。

### 2026-09-27 追加四十三（对标第二十九轮：响应契约缺口 8→1，以及"缺口理由"本身被实测证伪）

- 取号先列盘：在册最大「四十二」⇒ 本条「四十三」。
- **R28-M1 结案**：补 7 条调用路径的真实成功形状（`/web` 管理端回退路径的 getPublicProducts / getPublicCategories /
  getReviews / addPublicReview / createOrder，加 `/pub createSubmission` 与 `/web getSubmissionImages`）
  ⇒ 响应契约覆盖 **31/39 → 38/39**、具名缺口 **8 → 1**（只剩 `/pub aiChat`，它真需要 fetch stub）。
  形状按 (side, action) 立约是有意义的：同一段 handler，**路由、鉴权与信封是另一回事**。
- **一条方法论修正（本轮最重要的自错）**：登记册里有两条缺口理由是**编的**——
  "要带 base64 图片才能走通校验链"、"需要提交带图片才有对象可取"，实测 `images` 在 createSubmission 里是可选的，
  一条 payload 就把两条缺口关掉。判据能保证"没登记就红"，保证不了"登记的理由是真的"
  ⇒ 规则改成：**理由要写成可证伪的句子，且每轮补 payload 时顺手试一次旧理由**（已写进 RESPONSE_GAPS 头注）。
- **R28-M3 以成本结案（不做）**：verify:backend 单跑 100ms、verify:response 172ms（内含再 spawn 一次全链），
  复用一次输出只省 ≈72ms，代价是"录制可能来自另一时刻的代码"⇒ 判据可信度换 72 毫秒不值。
  `record()` 每次都新跑，注释里写明这是特性不是浪费。
- 顺带把断言总数核对了一遍（不是靠眼看）：静态 `ok()` 数 127 → 134（正好 +7），实跑 130 通过 / 0 失败，
  与"走 --update-sql-baseline 分支时少 1 条比较断言"的差值对得上 ⇒ 没有段落被静默跳过。
- 新路径仍先被 C1 判"基线缺 action（新增调用路径？确认后入册）"，人工核过 7 条峰值合理
  （读 1 条、addPublicReview 2、A:createOrder 4、P:createSubmission 3、getSubmissionImages 1）后才写基线。
- 全链 `npm run verify` VERIFY_RC=0（87 文件 / 1116 例，去 ANSI 后从 vitest 汇总行实读）；契约产物 41 条、基线 41 键、samples=1。
### 2026-09-27 追加四十二（对标第二十八轮：把上一轮"未归因"的那句还成"已归因"，并补 4 条成功形状）

- 取号先列盘：在册最大「四十一」⇒ 本条「四十二」。
- **上轮留了一条"机制未归因"，本轮把它查到底**（按新立的铁律：挂过一轮的账每轮重跑，不许把"未归因"当终点）：
  给 mock 的每条语句日志打上"发起它的 action"标签，连跑 12 轮对比 ⇒ 抖动的语句**始终是同一句**
  `DELETE FROM security_events WHERE ts < datetime('now','-90 days')`，落在 11 个不同 action 头上轮换。
  根因在 `functions/lib/security.js:117`：审计保留裁剪是**写时 5% 概率采样**（Pages 无 cron，这是刻意设计），
  于是这条摊销语句被记成"恰好触发它的那个 action 自己的开销" ⇒ **归属错，不是某次调用变贵**。
  判别证据：逐 action 峰值抖，而全链总语句数几乎不变。
- 修法（不给指标加容差，改测量口径）：mock 加可插拔 `classify(sql)` 缝，摊销语句单独立到 `amortized:*` 桶，
  **不参与逐 action 的峰值回归比较**，只以 INFO 行报"本轮累计几次"。
  于是上一轮的临时措施全部收回：噪声带 1→**撤销**、基线采样 5 次→**1 次**（实测 6 轮单采样逐键全等）。
- 常驻化 `tests/sqlAttribution.test.js`（3 条）：① 6 轮单采样所有非摊销键必须逐键相等（归因退回随机立刻红）；
  ② 摊销键必须带 `amortized:` 前缀且不拿概率量当硬断言；③ 基线键与实测同形、`samples` 不得悄悄被抬起。
- **R27-M2**：补 `verifyKey / addReview / deleteReview / getDashboardStats` 四条真实成功形状（只缺 payload 不缺环境），
  响应契约覆盖 27/39 → **31/39**、具名缺口 12 → **8**；新增调用路径被 C1 当场要求"确认后入册"，
  确认峰值合理（verifyKey=0 次 SQL、addReview=2、deleteReview=2、getDashboardStats=3）后才写基线。
- 上一轮那条"未归因"的说法在报告与注释里都保留原文，本条是对它的**结案**，不是覆盖：
  注释与夹具都写清"止血≠修好"，容差型修法必须在下一轮换成归因型修法。
- 本轮自己又踩两次同一族坑（记进形态台账）：① heredoc 把正则里的 `s` 吞成 `s`、`` 吞成退格符
  ⇒ 判据脚本直接语法错（同一子串语义第三次复发，遂放弃正则改子串判断，并在注释里写明为什么不用正则）；
  ② 新探针变量与文件里已有的 `rev` 重名 ⇒ ESM 顶层重复声明（"splice 后必查 def 重名"这条铁律我又忘了，
  靠 `node --check` 当场抓到）。
### 2026-09-27 追加四十一（对标第二十七轮：action **响应形状**有没有契约 —— 39 个 action 里 12 个连成功形状都没被观测）

- 取号先列盘：在册最大「四十」⇒ 本条「四十一」。
- 起点：`docs/api-contract.json` 在册 39 个 action，每条只有 `write / cacheKey / rateBucket` 三个属性；
  verify-backend 的 118 条断言里 **`Object.keys(...data)` 命中 0** ⇒ "后端少回一个字段"和"偷偷加一个可选字段"
  今天都不会让任何闸变红。本轮把它做成可 diff 的契约：`docs/api-response-contract.json`（30 条实测形状）。
- 形状从**真实流量**录，不另写驱动：`verify-backend.mjs` 的 `wrapHandle` 是本仓唯一 action 出口，
  已经带真实 payload 跑过全部 action；新增 `RESPONSE_CONTRACT_OUT` 录制段 + 共用件
  `scripts/lib/response-shape.mjs`（信封键 / data 形态 / 顶层键；**交集=保证有**、**并集=可能出现**）。
- 新门禁 `npm run verify:response`（V1 分母非零 / V2 流量⇄api-contract 幽灵 / V3 未覆盖须具名理由（双向）/
  V4 逐字段漂移 / V5 **条件字段逐条具名** / V6 对象型必须有保证字段）。已进 `npm run verify` 与 CI。
- 第一次跑就抓到两笔真账：① `batchUpdateProducts`/`batchDeleteProducts` **成功分支的形状从未被观测**
  （整条链里只以"只读密钥被拒"出现过）⇒ 补真实批量写探针（断言 `updated`/`deleted` 计数）而不是挂账了事；
  ② `createProduct` 的 `stock` 是**随 payload 出现与否而出现的条件字段**（payload 不带就没有这个键）
  ⇒ 具名入册，并记下"两个消费方都不读这个返回值"这一事实。
- 顺带查出一条**比本轮主题更老**的缺陷：C1 的 SQL 峰值基线是随机变的 —— 同一段代码连跑 5 次，
  每次都有某个 action 峰值比基线多 1（抖动的 action 每轮换）。已确证两件事：把归因从
  "action 边界做差"换成 `AsyncLocalStorage` 异步上下文（`scripts/lib/metered-d1.mjs` + `runInSqlScope`）后**抖动仍在**；
  固定 `Math.random` 后 `A:createProduct` 恒为 3。**机制未归因到底**，但"一条正常提交会随机变红的闸"这个结论已足够：
  基线更新与本轮实测都改成同口径的 N=5 次采样取上界，带内(+1)只打印 WARN 不判红，带外才红
  （该闸目的是抓 N+1，那种回归一次就是 +商品数量级，绝不会只 +1）。
- 夹具：`tests/apiResponseContract.test.js` 14 条（形状口径 + V1~V6 双向变异 + 真流量 GATE-PASS +
  篡改基准必红 + 缺基准/坏注入点 rc=2 fail-closed）；`tests/cliEntrypoints.test.js` 的 PROBED 加 `api-response-contract.mjs`。
- 本轮自己的四处如实记录：① 批量文本替换把 `import` 与语句插错位置（一次写坏 main 的三行）；
  ② `require('node:fs')` 写进 ESM（本仓第 N 次同类，靠 lint/真跑抓到）；③ 第一版夹具的"正向腿"要选手抄 action
  清单，改为由 covered 反推缺口；④ 往登记册缺口表加的说明行因不带 `.mjs` 结尾被解析器整行跳过 ——
  等于没登记，靠 G2 复跑发现（登记册的行有格式约束，写之前该看一眼解析器）。
### 2026-09-27 追加四十（对标第二十六轮：输入**在但为空**时判据说什么 —— 零分母姿态普查）

- 取号先列盘：在册最大「三十九」⇒ 本条「四十」。
- 与上一轮的区别不是细节而是本质：`requireInputs` 只看**存在性**，所以"文件全在、内容全 0 字节"能一路过关。
  做法：镜像整棵目录树、除 `scripts/` 外每个文件写 0 字节，再把 22 个门禁类入口逐条真跑。
- 基线（修之前）：**2 个 rc=0 + 2 个裸栈**。
  ① `check-schema-drift`：打印「==== 结果: 0 通过 / 0 失败 ====」并 rc=0 —— 它原有"没有迁移文件"的守卫，
  但**文件在、解析出 0 个对象**时不表态 ⇒ 现补 `checks === 0` 判红；
  ② `check-import-cycles`：0 字节源码上报"扫描模块: 84 个 / 未检测到循环依赖"并 rc=0 ——
  0 条边的图上"无环"确实为真，但它什么也没证明 ⇒ 现要求 import 边 ≥10（实测本仓 src/ 单侧 275 条）；
  ③④ `check-error-semantics` / `verify-backend`：空 `package.json` 让 Node 先崩在 `package_json_reader`，
  判据的人话文案根本没机会印 ⇒ 动态 import 之前先 `requireJson`。
- R25-M4 收尾：缺输入统一走 `scripts/lib/preflight.mjs` 四个出口（`bail` / `requireInputs` /
  `requireParams` / `requireJson`），把原先自带"参数缺失 / 环境不满足"两套文案的 6 个门禁并成一条形状；
  退出码 **2=环境不满足 / 1=判出违规 / 0=通过** 写进登记册口径。
- 常驻化：`tests/cliEntrypoints.test.js` 53 → **81** 条 —— 新增 22 条零分母探针（+ 骨架仓自身成立的正向对照）、
  摘掉 `check-schema-drift` 零对象守卫的**变异体**（探针必须当场把它读成装绿，还原后复验）、
  以及 **preflight 自己的夹具**（它现在承担 15 个门禁的出口，自己坏了会让所有门禁一起"人话不成立"而探针照样绿）。
- 本轮自己的三处如实记录：① 批量插入 `requireJson` 时把 `root` 用在它初始化之前（TDZ ReferenceError），
  靠"逐个真跑"当场抓到；② 统一文案打断了两条**钉住旧文案**的既有断言（`参数缺失`），改为断统一形状；
  ③ 骨架仓正向对照第一版拿"骨架 scripts/ 全部条目数"比"真仓 .mjs 数"（39 vs 34）= 两把不同形尺子。
### 2026-09-27 追加三十九（对标第二十五轮：门禁在**缺输入面**上是 fail-closed、静默放行，还是甩裸栈）

- 取号先列盘：在册最大「三十八」⇒ 本条「三十九」。
- 方法（一次普查，不靠翻代码猜）：把 **22 个门禁类入口**（npm 别名 `verify:*`/`check:*`）逐条拷进
  一个只有 `scripts/` 的空目录真跑，读两件事：退出码、输出首行的形态。
- 实测基线（修之前）：**8 个甩裸栈**（`node:fs:441` / `package_json_reader` / `MODULE_NOT_FOUND` /
  `SyntaxError` —— 把"环境不满足"伪装成"判据崩溃"，CI 里没人能从栈里读出该补什么）+
  **1 个静默放行**：`check-licenses` 在连 package.json 都没有的目录里打印
  「0 个生产依赖（含传递）全部 MIT/BSD/Apache/ISC 类白名单 ✅」并 `exit 0`
  —— 与第十八~二十一轮"CI 全绿"假账同一个机制：**把"没扫到"读成"扫过且清白"**。
- 修法：新增 `scripts/lib/preflight.mjs`（`requireInputs(label, paths)` ⇒ 缺项就印
  `[label] 环境不满足：取不到 …` 并 exit 2；退出码 2="环境不满足"与 1="判出违规"分开），
  收到 8 个门禁 + `check-licenses` 零分母收口。两处要把静态 `import` 改成"先收环境再取模块"
  （`@babel/parser`、`tests/helpers/fakeDb.js` 静态 import 会让 fail-closed 文案根本印不出来）。
- 常驻探针：`tests/cliEntrypoints.test.js` 新增 22 条缺输入用例（断言 rc≠0 且首行不是栈）
  + 植入两种假门禁的"有牙齿"用例 + **变异体**（把 `check-licenses` 的零分母收口摘掉 ⇒ 探针必须
  当场把它读成"静默放行"，跑完还原并复验回到 fail-closed）。该文件 28 → 53 条。
- 结果：22/22 现在都是 `[label] 环境不满足…` + rc=2；`docs/cli-entrypoints.md` 把两类覆盖分开登记
  （**判据路径真跑** 14 条 ≠ **缺输入面真跑** 22 条，后者不替代前者，三行不可 spawn 豁免照挂）。
- 本轮自己的两处如实记录：① 批量打补丁时把 `import` 插进了函数体（ESM 语法错误），
  六个门禁里有六个受影响、两个当场崩 —— 靠"逐个门禁真跑一遍"抓到，不是靠看 diff；
  ② 用 heredoc 写含 `${}` 的测试块被 shell/模板双层转义吃掉，改为 Edit 工具直写。
### 2026-09-27 追加三十八（对标第二十四轮：门禁的**入口通道**有没有被真跑过 —— 只 import 纯函数等于没测）

- 取号先列盘：当日在册最大为「三十七」⇒ 本条「三十八」。
- 起因（实测，非假想）：`scripts/ci-green-contract.mjs` 的 15 条夹具**全部 import 纯函数 `verdictOf`**，
  CLI 那段（读 stdin → 解析 git 的 ref 行 → 判据 → exit code）一次都没被跑过。于是
  `fs.readFileSync(0)` 抛的 `ReferenceError`（模块里没有 `fs` 这个标识符）被 `catch { line = '' }`
  吞成"git 没给 ref 行"，**整条输入通道静默失效**：推 `feature-x` 时闸门打印 `branch=main`，
  审的是不相干分支；而 `npm test` 全绿。第二个缺陷紧挨着它：分支名正则 `(.+)# 更新日志

本项目采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。此前未维护本文件，历史条目按 git 提交记录补记（自 2026-09-23 起持续维护）。

 贪婪吞掉**整行**
  （含两个 SHA）⇒ 只修第一个会让闸门 100% 判红。两者互相掩盖，全靠"入口没人跑"才藏得住。
- 修法（`scripts/ci-green-contract.mjs`）：新增 `parseRefLines()` 纯函数按 git 官方四字段解析；
  基点取 stdin 第 4 字段（远端当前 SHA），多 ref 同推逐条审；删除分支 / 新建分支具名 SKIP；
  stdin 读取失败**必须留痕**（不再静默）；诊断行带上 `branch=` 与 `base=`，让"闸核算的是谁"可被断言。
- 入口夹具（`tests/ciGreenContract.test.js` 27 条）：子进程真跑 CLI，断言核的是远端基点而非本次 HEAD
  （对偶两条）+ 三条变异体（改错字段 / 退回静默吞 / 只审第一行 ⇒ 各自必须翻红）。
- 类级修法（新门禁 `npm run verify:entrypoints`，`scripts/check-cli-entrypoints.mjs` G1~G8 +
  `tests/cliEntrypoints.test.js` 28 条）：登记面按结构枚举（package.json + .githooks + workflows = **34** 个入口），
  覆盖 = 测试里真 spawn 过；子进程覆盖 **10 → 23**，未覆盖 **23 → 11**（8 条具名缺口 + 3 条不可 spawn 豁免，
  理由带实测依据：esbuild 冷编译 9.0s、缺起点时按设计 rc=2、要 dist 产物、要网络、会写库）。
  门禁类入口（npm 别名 `verify:*`/`check:*`）共 22 个，19 个已真跑、3 个具名豁免 ⇒ 以后加一道门禁
  却没夹具，G8 当场判红。
- 顺带补的生效前提：`core.hooksPath` 此前**没有任何文档登记**（`.githooks/` 随仓库走，但这条是本机配置、
  不进 clone）⇒ README / CONTRIBUTING 补「新克隆必做」，并由 G5 钉住；CONTRIBUTING 里"串起 7 道检查
  / 168 用例"这类手抄数字改为"以 `scripts.verify` 与命令当场输出为准"。
- **接第二十三轮清单的中优先级 H7（出境面收敛），并顺带推翻上一轮的一个判据前提**：
  `functions/lib/actions/ai.js` 的 aiAdvice 投影原为 9 列（含 `wechat`/`remark`/`roomNumber`/`_id`/`status`/`updatedAt`），
  收敛为 `items,totalAmount,createdAt` 三列 —— **实测登记册上一轮标的"出境=是"是误判**：那两列只被 SELECT 带过，
  `buildAdviceInput` 只回传聚合量，值从未进入发给 Dify 的请求体。已在三处如实更正并留下对账：
  ① 线级夹具（`tests/aiContract.test.js`，故意让假 DB 无视投影、把整行喂进 `adminAiAdvice`，断言请求体里
  微信号/电话/房间号一个都没有、而 `revenue`/`乌龙茶` 必须在 —— 防空扫）；
  ② 等价夹具（收敛前后的 prompt **逐字节相同** ⇒ "去掉之后分析结果不变"是可测的，不是嘴上说的）；
  ③ 新判据 **P12**（出境链投影每列必须被下游真引用：多一列白读=红，引用了却没投影=红）与 **P8 补对偶**
  （零出境时必须有点名 `pubAiChat` 的零出境声明，否则"把出境列全标否"就能自动变绿 —— 本轮改完 P8 一度
  只剩"0 列均有凭据"这句空话，被自己的零输入规则逮住）。SECURITY.md 与 `docs/pii-inventory.md` 的旧断言同步撤回。
  另一条清单项 **H5（getOrders 去掉 paymentScreenshot 投影）经实测不成立**：`getOrders` 从未投影该列，
  只有 `getOrderById`（管理端单详，产品必需）与 `stalePendingReport`（只取 Boolean 存在性）碰它 ⇒ 撤单不修。
- 本轮夹具自身被自己抓到三处（如实记）：① `offlineEnv` 先 spread 再 delete，把测试自己要设的
  `CI_GREEN_SKIP` 删了 ⇒ "逃生门缺理由仍拒"测的是没设逃生门（假绿）；② 变异体 M1 首版只改判断条件
  不改取值 ⇒ **空变异**；③ 新门禁 G6 首版定成"夹具引用不存在的脚本名即判红"，被合成夹具的植入名
  当场误报（那些名字不参与任何计数）⇒ 改判为"本地钩子入口必须有夹具"（pre-push 那类 CI 根本不跑的，
  才是本轮教训的正主）。

### 2026-09-27 追加三十七（对标第二十三轮：CI 全绿契约接线）

- 取号先列盘（当日最大「三十六」⇒ 本条「三十七」）。
- 起因（实证）：d1RoundTrips 缺 @vitest-environment node 让 CI 连红 7 个 commit、deploy 被 needs 掐住，期间三份报告都写着 CI 全绿。本地绿与 CI 绿可同时不成立（Node 小版本、npm test vs vitest run --coverage），唯一凭据必须是远端回执。
- 落地：.ci/contract.json（requiredJobs 含 deploy —— 只盯测试 job 会漏掉绿了但没发出去）+ scripts/ci-green-contract.mjs 四态 GREEN/RED/BLOCKED/UNKNOWN + .githooks/pre-push 硬闸。UNKNOWN 与 BLOCKED 一律拒：查不到 run、gh 不可用、run 在跑、必需 job 缺席，都不读成通过（裸静音判红）。逃生门 CI_GREEN_SKIP=1 必须同时给 CI_GREEN_REASON，否则照样拒。
- **接线当场把自己拦下过一次，据此改了语义**：首版 pre-push 拿**本次 HEAD** 当判据，于是 git push 被拒
  （新提交天生还没有 CI run）—— 这条闸会让任何首次推送都不可能通过。正解是核**远端当前基点**
  （pre-push stdin 第 4 字段 remote_sha，缺省回读 git ls-remote），语义为「别在红基座上继续叠加」，
  恰是第十四~二十一轮那 7 个 commit 的真实形态。顺带两处接线细节：ref 行走 stdin 而非 argv；
  修掉一处被吞掉的换行转义。**待补**：新语义目前只有人工 trial 凭据，缺一条会红的对偶夹具 ⇒ 第二十四轮 P1。
- 夹具 12 条双向变异（tests/ciGreenContract.test.js）：RED 对偶（run success 但 deploy=skipped 仍判红）、BLOCKED 复刻真实形态（deploy job 缺席）、UNKNOWN（sha 查不到 / runs 空数组）、契约缺失或 JSON 坏掉、hook 指向性反例。夹具自身也红过一次 —— 反例用 String.replace(字符串) 只换第一处而 hook 有两处调用 ⇒ 夹具同样要跑红→绿一遍才算数。
- 现网内容级校验（补第二十二轮未闭环项）：线上 assets/OrderSuccessPage-p0D2URk5.js 实测含 暂存本机=1、下单成功=1、localFallback=1，OrderConfirmPage-CZh57BdZ.js 含 demo=2 ⇒ 第十八/二十二轮改动确在现网包体里。
- 回归：ciGreenContract 12/12、全量 84 files / 991 tests、lint 0/0、typecheck 干净、verify:docs OK（单测文件数 83⇒84 由它要求）。
### 2026-09-27 追加三十六（对标第二十二轮：e2e 三条红的真因是我自己第十八轮的语义混用）

- 取号先列盘（当日最大「三十五」⇒ 本条「三十六」）。
- **定性结果**：第二十一轮留下的 e2e 红不是线上老后端的问题，是**我自己引入的语义回归**。`playwright.config.ts` 的注释自己写明 e2e 跑在 `IS_CLOUD=false` 的本地演示模式；而第十八轮把 `!IS_CLOUD` 分支也返回 `localFallback: true`，于是成功页在演示模式下显示「订单已暂存本机、商家还收不到」，`getByText('下单成功')` 三条断言当场打红。**demo 是该构建形态本就没有后端，fallback 是云端调用失败后暂住 —— 一个标记不能同时表达两件事。**
- 修法：`createOrder` 的 `!IS_CLOUD` 分支改回 `demo: true`，成功页横幅只认 `localFallback`；`OrderConfirmPage` 透传 `demo`；新增用例钉住两者互斥（demo 时 `localFallback` 必须 undefined，fallback 时 `demo` 必须 undefined）—— 防以后有人把两个标记又合并回去。
- **验证（远端回执，不用本地退出码下结论）**：本地 playwright 22/22、vitest 83 files/979 tests；推送后 `gh run view --json conclusion,jobs` 实测 **e2e success / e2e-cloud-stub success / visual success**，而 `build-and-test` **转为 failure** —— 原因是 `CHANGELOG entry gate`：本提交碰了 `src/**` 却没带变更记录。**这条红是门禁在正常工作**，本条即其补账；未用 `--relaxed` 逃生门绕过。
- 承第二十一轮未做项：`.ci/contract.json` + pre-push「CI 全绿契约」在本仓**从未接线**（红 CI 连推 7 次的结构性原因），上下文耗尽未及落地，仍列下一轮 P0。
### 2026-09-27 追加三十四（对标第十九轮 H4：导出面个人数据白名单）—— **补记，非当轮所写**

- **补记原因（本轮必须如实）**：第十九轮当时这条变更记录**根本没落盘** —— 写入用的是 `python3 - <<PY`，而本机 `python3` 已解析到 WindowsApps 存根，执行体什么都没做（`python3 -c "print(1)"` 亦无输出、rc=49），**却没有拦住后面的 `&&`**，于是文件没改、提交照做、提交说明里还写着"追加三十四"。事后靠 `grep -c 追加三十四 CHANGELOG.md` = 0 才发现。**教训：命令"无输出 + 退出码 0"不等于成功，写入类动作必须回读产物计数自证。**
- 取号先列盘（实测当日最大「三十三」⇒ 本条「三十四」）。
- 落地内容（第十九轮已提交在 `adf9de6`）：`tests/piiExportAllowlist.test.ts` 8 条 —— CSV 表头与 `EXPORT_HEADER_ALLOWLIST` 判**等号**；`NEVER_EXPORT` 敏感名单双向独立核；`exportCSV` 与 `copyOrder` **两个出口都扫**（剪贴板同样是离开浏览器的通道）；两条会红反例（塞「微信号」列 / 引用 `o.paymentScreenshot`）；文件长度下限护栏防"读成空串 ⇒ 全部 not.toContain 静默通过"。
- 起点是好消息也是隐患：`grep wechat|paymentScreenshot OrdersTab.tsx csv.ts` 命中 0 ⇒ 导出面**今天**干净，但 orders 表两列真在库里（`schema.sql:37,39`），且没有任何闸拦得住"表头加一列微信号方便对账"。

### 2026-09-27 追加三十五（对标第二十轮：个人数据生命周期 —— 登记册 + 与导出面互锁）

- 取号先列盘（当日最大「三十四」⇒ 本条「三十五」）。
- **轴**：个人数据离开数据库之后的每一段路有没有人守。实测到**两条未登记的出境路径**：`functions/lib/actions/ai.js:28` 的 aiAdvice 全量 SELECT 带着 `wechat, remark` 进 Dify 输入；`:77` 把 `pub-${ip.slice(0,40)}` 当第三方用户标识送给 Dify。
- **R20-H1 登记册 `docs/pii-inventory.md` + 门禁 `npm run verify:pii`（P1~P11）**：P1 任一分母为空即红／P2 不得有幽灵表／**P3 每一列都要有家**（覆盖 or 带理由豁免；同一张表既豁免又有行也判红）／P4 无死行／P5 取值限定枚举 + 依据 <14 字或含 TODO 即红／P6 豁免必须给理由（"非个人数据"四字空话不算）／**P7「进导出」不手填，由 `piiExportAllowlist` 的 CSV 表头白名单反推并双向对账**（作用域锁 orders，否则 `时间→createdAt` 误伤 reviews/submissions 同名列）／P8 出境列必须点名 `文件:行号`／**P9 标"无通道"的列所属表必须在「已知缺口」节被点名 —— 按表收口，不逐行灌样板水**／P10 正向对照（个人数据列 ≥15 且无保留者须有删除路径）／P11 判据自身不入面。
- **两次自我纠错（都写进判据与夹具，不留漂亮话）**：① 分母归因写过假一次 —— 我先写"漏表是因为只读 `schema.sql`"，实测 `schema.sql` 自建全部 9 张表，真因是我 grep 只取了**前 70 行的窗口截断**，恰好切在两张表之前；同一窗口也会让"我确认过了"变成假话 ⇒ 分母改为程序化全量解析。② 反例构造不出被审的那一态 —— "表既豁免又有行"我拿 `products` 测，而它本就没有列行 ⇒ 改用真有 11 行的 `orders`。
- **`rate_limits` 从豁免收回覆盖**：初版写进"整表不含个人数据"，但 `backend.js:72` 拼的是 `rate:login:${getClientIp(request)}` ⇒ `bucket` 列**就是明文 IP**，且该表无保留无清理。现标 `个人数据 / 无通道` 并在「已知缺口」挂账，**把缺口亮在账上而不是豁免掉**。
- **R20-H3 `SECURITY.md` 补 PII 节**：写清采集/可见/出境/保留/删除五面并逐条指向登记册与判据。顺带纠正上一轮的取证偏差 —— 我曾说"SECURITY.md 对 PII 零承诺"，实为**只 grep 了 `删除|保留|个人信息|PII|导出` 五个词**；文件里本有"base64 存 D1 属技术债""楼栋-房间号 + 微信号标识订单"两段。准确表述：**已承认采集与存储风险，缺保留期、删除通道、导出口径三件**。词表太窄会把"部分有"读成"完全没有"。
- **夹具 20 条 `tests/piiInventory.test.js`**：分母自证（含纠正后的"schema.sql 单独也得 9 张"对照 + 合成迁移表证明全量解析必要）／缺列、幽灵列、新表未声明、表既豁免又有行／TODO 依据、非法类别、空话豁免／导出白名单三向／出境列去行号、删掉「已知缺口」节、缺口节漏点名一张表；末条接线：真仓 P1~P11 全过。
- **未做（如实）**：H2 终态单摘除付款截图的保留通道（属会减少现存数据量的通道，须先登记分母并核现存带图量级）、H5 `getOrders` 去 `paymentScreenshot` 投影、H7 aiAdvice SELECT 去 `wechat/remark`（须先给"分析结果不变"的对账）。第十八轮 **N3 部署仍未执行，优先级高于本轮全部项**。
- **接线与回归**：`verify` 链在 `verify:errors` 后插 `verify:pii`；`ci.yml` 新增 step `PII inventory gate`；`REQUIRED_STEPS` 加名（`ciWorkflow` 30 条绿证明 step 名与清单互锁）；README 门禁链与单测文件数 82⇒83。`verify:pii` **11 通过 / 0 失败**：47 列全覆盖、3 张表带理由豁免、个人数据/凭证/派生 17 列。

### 2026-09-27 追加三十三（对标第十八轮：错误语义的可编程性 —— 一次失败，调用方能不能不问人就决定该干什么）

- 取号先列盘（实测当日最高「三十二」⇒ 本条「三十三」）。
- **轴**：前十七轮在数"门禁够不够多、常数有没有依据"，这一轮问"**一次失败，调用方拿什么决定下一步**"。实测：`functions/` 里 **57 个失败出口共用同一个 `code: -1`** + 一句中文 `message`，HTTP 状态恒 200（只有 JSON 解析失败两处是 400）。调用方因此**结构上无法区分**「库存不足（该改数量）」「限流（该等一等）」「认证失败（该重登）」「平台故障（该先暂住）」四类。
- **本轮最硬的一条：这条链真的在丢单（不是假想风险）**。`src/db/orders.ts:26` 把 `code !== 0` 直接 `throw`，而它外面就是 `catch → addLocalOrder() → 跳成功页`；`src/pages/OrderSuccessPage.tsx` 从头到尾**没有读过 `localFallback` 这个字段**（实测 grep：该字段只在 `orders.ts` 与 `OrderConfirmPage` 之间出现，成功页零引用）。⇒ 服务端按"库存不足: 可乐"拒收后，顾客屏幕上仍是「**下单成功！订单已提交，请完成支付**」，还带一个「去支付」按钮；商家侧查不到这张单，付款截图上传了、钱转了、单没了。
- **R18-H1 错误语义登记册 `functions/lib/errors.js`（真相源）+ `docs/error-codes.md`（人读面）**：33 个码，每码登记 `kind`（input|state|auth|quota|platform 五类，限定枚举）/ HTTP 状态 / `retryable`。门禁 `npm run verify:errors` 九项：**E1** 裸 `{code:-1}` 即红（信封只能在 `fail()` 里出生）／**E2** 码表⇄代码引用双向对账，**登记了但没人用的死码同样判红**／**E3** 登记册与真相源 kind/HTTP/retryable **逐项相等**（文档抄错一个数字就红）／**E3b** TODO 即红／**E4** 前端镜像 `src/api/error-codes.ts` 与登记集合相等且 kind 逐项相等（两条构建链，沿用分片大小与口味分隔符的"双写+契约测试"先例）／**E5** `createOrder` 禁把业务拒绝兜底成本地单（结构判据：分流 + catch 内早退先于兜底 + 必须 import 那个异常类 + 禁止判 message 字符串）／**E6** 429 出口必须自带 `retryAfterMs`／**E7** 取数面自证含正向对照（出口 ≥40，防"空扫=通过"）／**E8** 真跑 `fail()`/`apiResponse()` 断信封与状态映射。
- **兼容性红线（判据 E8 机器守住）**：`code` 字段**永远还是 -1**，新语义纯加字段。因为顾客端要经 Service Worker 长缓存铺开，旧 bundle 判失败用的是 `code !== 0` ⇒ 把 `code` 换成 4xx 数字会让**旧客户端把失败读成成功**，那是把缺陷修成事故。这一条同时挡掉后人"顺手把 code 和 errorCode 合并"的重构。
- **HTTP 状态映射单点落地**：`apiResponse()` 只在 `web.js`/`pub.js` 两处出口用（业务层只回信封、不碰 status），state→409、auth→401、quota→429 + `Retry-After`、input 体积→413、platform→500；未登记码**降级成 platform/500 且不抛** —— 第一版我让它 `throw`，随即自纠：`checkAuth`/`checkRate` 的失败出口在 `handleAdmin` 的 try **之外**，一抛就变成 Pages 未捕获异常（顾客拿到非 JSON 的 500 页），等于把"登记册脱节"这种可修缺陷升级成"整条鉴权链不可用"。真防线在 E2，不在运行期崩。
- **分流方向的保守性（夹具当场把我的错抓出来）**：`FALLBACK_SAFE = {platform, transport}`。`transport`（fetch 抛错 / 旧后端没回 errorCode）在内是刻意的 —— 顾客端（GitHub Pages）与后端（Pages Functions）分两次部署，若把"没有码"判成业务拒绝，等于在部署窗口期打断现网下单。**这条是 `errorSemantics.test.js` 的反例把我纠正的**：我最初写成"只允许 platform"，正例断言 `isFallbackSafe({})===true` 直接红，才想起部署是两次这件事。四类业务失败全禁兜底则由对偶断言钉住（有人给 state 放行会红）。
- **本轮同时清掉第十七轮四条尾账**：**M6** `src/` 纳入上限普查面（40⇒63 项，判据 C7 改成"面内文件必须落在声明前缀里 + src/ 真在里面"的正向对照，因为旧写法 filter(/check-limit-provenance/) 的判据住在 `scripts/` 根本进不了面 ⇒ **那条断言永远为真，是空转判据**；另补 C8"解析失败不许静默跳文件"）；**M4** 本机 workerd —— 真根因**不是**厂商文案写的"装在别的平台"，而是 `@cloudflare/workerd-windows-64/bin/` 与 `@esbuild/win32-x64/` 两个原生包**只剩元数据、exe 被删**，且两处的父目录 mtime 都是 2026-09-27 03:38（同一次外部清理），全仓 `*.exe` 只剩 2 个 ⇒ 用 `npm pack` 取回两个二进制（只动 gitignore 的 `node_modules`，`package-lock.json` 与 HEAD 逐字节相同），`verify:functions` **首次在本地跑绿**（98,401B、三入口齐备）；**M3** 档位登记补对账链（并把 C5 输出行改成带对账计数，取到数才记 PASS）；**M2** 按第十七轮已落地的"上限 40 + 前端分片"路线销账，**如实写明闭的不是本行原写的 ≤3 语句方案**（bulk UPDATE 会丢 `{updated, failed[]}` 明细）。
- **M6 扩面当轮即抓出两条真东西**：① 度量器自己的假阳性 —— `x.length > 0` / `< 1` 是**非空判断**不是上限，在 `functions/` 里恰好一次都没出现（都写 `!x.length`），一进 `src/` 就造出 12 行假上限；正解是补形状排除集 `EMPTY_TEST`，**不是**调阈值或给 src/ 开豁免（那等于把"前端没人管"重新藏回去）。② 一条真缺陷 —— 顾客端 `ReviewForm` 硬编码 5 张、屏上文案印「最多 5 张」、注释还声称"服务端 ≤5 张"，而服务端从登记那日起一直是 `> 3` ⇒ **按屏上指示选到第 4 张，整条评价被退回"最多上传 3 张图片"**。修法：收口成 `MAX_REVIEW_IMAGES = 3` + 纠正假事实注释 + `tests/reviewImageCapContract.test.ts` 用等号钉两侧；登记册里另把"注释与文档里的数字不算上限"的口径写清。
- **夹具 36 条双向变异（`tests/errorSemantics.test.js`）**：E1 裸出口/同双出口/`code:0` 不误伤；E3 缺行/多行/HTTP 抄错/kind 抄错/kind 非法/TODO 六向；E4 改名致"不可解析"判红而不是"空集合=通过"；**E5 五向**（删早退 / 早退顺序颠倒 / 改判 message / 函数改名 / 丢分流）；E6 缺 `retryAfterMs`；E8 未登记码降级不抛、非 429 不塞 Retry-After、`Retry-After` 下界 1 秒；末条是**接线**（真仓跑 `run()` 九项全过 —— 纯函数过了不算数）。
- **接线**：`verify` 链在 `verify:limits` 后插 `verify:errors`；`ci.yml` 新增 step `Error semantics registry gate`；`REQUIRED_STEPS` 加名。回归：`verify:backend` 116/0（后端契约一字未改仍绿）、`verify:limits` 9/0（63 项全覆盖、C8 101 文件零静默跳过）、`verify:errors` 9/0、全量 81 files / 950 tests。唯一被本轮**刻意改动**的既有断言是 `tests/kvRateLimit.test.js` 三处 `toEqual({code:-1,message})` —— 信封合法扩字段后它们必然红；改法是把键集合写成常量继续用 `toEqual`（不是放宽成 `toMatchObject`），使"以后再有人往 fail() 塞字段"当场判红而不是静默通过。
- **取证（可点 URL + 逐字原文，取不到就写 NOT STATED）**：Stripe `type`/`code`/`decline_code` 三层 + 4xx/5xx 分族；Medusa `MedusaErrorTypes`（CONFLICT→409、UNAUTHORIZED→401、FORBIDDEN→403、NOT_FOUND→404、INVALID_DATA→400、DB_ERROR→500）与 `MedusaErrorCodes.INSUFFICIENT_INVENTORY`；Saleor 原文 "the returned message is only meant for debugging and is not suitable for display to your customers. Please use the `code` field"；RFC 9457 "**Consumers MUST use the \"type\" URI ... as the problem type's primary identifier**"；PostgREST SQLSTATE 23505→409 映射表；MDN 409/429（**`Retry-After` 是 "may be included"，建议非强制** —— 本仓仍做成硬要求，理由写进 `errors.js` 注释：窗口在这里是已知量，不发等于让前端猜）。同栈（Pages Functions + D1）公开样板只找到"状态码对、无机器码分层"的半成品 ⇒ 如实记 NOT STATED，不硬凑成"业界都这么做"。
- **与对标件的刻意偏离（不装）**：Saleor 的口径是"message 只供调试、顾客文案由客户端按 code 自拟"，本项目 `message` 仍是服务端给的中文展示串（单团队、无 i18n 需求）。**但分流键必须是 `kind`/`errorCode`** —— 这条边界由 E5 在下单链路上钉死：改文案不该改变"是否兜底"。

### 2026-09-27 追加三十二（对标第十七轮：数值上限的溯源性 —— 同一个 200，两种命运）

- 取号先列盘（实测当日最高「三十一」⇒ 本条「三十二」）。
- **轴**：前十六轮数"门禁够不够多"，这一轮问"**门禁管不到的那些常数是谁定的**"。实测：`functions/` 里 **40 个会砍东西的数值上限**（拒绝型 `x.length > N` / 截断型 `.slice(0, N)` / 体积型 `N * 1024` / 保留期 `-N days` / 分页 `LIMIT N` / 命名常量六类形态），**没有一处写着它是从哪来的**。
- **R17-H1 登记册 `docs/limit-provenance.md` + 门禁 `npm run verify:limits`**（C1 任一面为空即红／C2 每个上限须有行／C3 类别限定 platform|schema|product|perf|self／C3b 依据 <14 字或 TODO 即红／C4 登记册不得有死行／C5 声称 platform 的行必须点名 `PLATFORM_FACTS` 里的事实且值 <= 它／C6 引用档位相关事实必须登记当前档位／C7 判据自身不得进普查面）。骨架由 `--emit` 生成，但 **TODO 一律判红** —— 否则"跑一条命令生成登记册"就等于"跑一条命令让门禁闭嘴"。
- **本轮最硬的一条实测（G2）**：`batchUpdateProducts` 与 `batchDeleteProducts` 挂着**同一个 200**，前者语句数 = 1 + n（第十四轮实测斜率 1）⇒ n=200 时 201 条 > D1 免费档「每调用查询数」50；后者语句数是常数、受 SQLite 999 绑定参数约束 ⇒ 200 反而安全。**同一个数字、两种命运**。修法：`BATCH_UPDATE_MAX` 由 50 推导成 **40**（41 条 < 50，留 9 条给鉴权/限流/审计），`BATCH_DELETE_MAX=200` 保留并在登记册写明它受哪个事实约束；前端 `src/auth.ts` 加 `BATCH_UPDATE_CHUNK=40` 分片提交，**两侧等值由 `tests/batchChunkContract.test.js` 钉住**（本仓 `spec-options.ts` 口味分隔符"双写 + 契约测试"先例）。分片失败不把整批判死，该片条目进 `failed[]`，与服务端"部分失败可定位重试"同语义。
- **登记时才看见的第三个洞（G3，只判红不擅改）**：图片 base64 上限 `800 * 1024` 字符（约 600 KB）> D1 单语句 100 KB ⇒ **这条应用层校验形同虚设，平台先把它打回**。收紧会改变顾客端上传能力、且要先定"图片到底走 base64 入 D1 还是走对象存储"⇒ 登记为 M5 待用户拍，不假装已论证。
- **档位假设登记（G4）**：C6 要求"引用了 `d1_queries_per_invocation_*` 就必须写明当前档位"；本仓无 CF 凭据判不出档位 ⇒ **按最坏情况 Free 设防**并写明改档位须同步复核哪些数。**落点踩坑（判据在正常工作）**：先塞进 `docs/env-vars.md` 被自家 `verify:env` 双向对账判红（代码不引用的运营事实 ⇒ 文档多行）⇒ 撤回落 limits 册专节，并在 C6 注释里写明为何不能放 env 册。
- **夹具 16 条（`tests/limitProvenance.test.js`）与一次自我纠错**：L4 首版把变异写成"从登记册删一行"，实测 C4 不红（删行只会触发 C2）⇒ **我的变异设计错了**，改成"加一条代码里不存在的行"才真正打到 C4。另含枚举器双向验：六类形态各自可枚举、**注释里的数字不算上限**（不剥注释则 `products.js:156` 那句解释性"SQLite 999"会凭空变成一行没人肯解释的"上限"）。
- **不做 oxlint `no-magic-numbers`**：它只报"这里有个数字"，不报"这个数字有没有依据"，且对六类形态一律误伤；专用判据能额外做到"值 <= 所引平台事实"这一层。
- **上轮尾账一并清掉**：MA6 夹具当时 `it.skip` 挂起，本轮定位到真因（实际守门的是"执行后 changes==0"，`GROUP BY` 行数探针在 WHERE 恒假时不产分组），断言**收窄到该分支并注明为何**，未放宽成"两条任一"；`migrateReplay` 26/26。第十六轮报告由本轮报告 §7 重建补齐。
- **接线与回归**：`verify` 链在 `verify:authz` 后插入 `verify:limits`；`ci.yml` 新增 step `Numeric limit provenance gate`；`REQUIRED_STEPS` 加名；`README.md` CI 链与单测文件数（77->79）随 `verify:docs` 口径同步。`verify:backend` **116 条一字未改仍全绿**（证明上限改动没触碰任何既有契约）、`verify:env` 12 变量双向 OK、`actionAuthz` 18/18、`d1RoundTrips` 20/20、全量 79 files / 908 tests。
- **取证欠账（不装）**：Django/Rails"批次由驱动参数上限反推"的原文本轮两次尝试均未取到（WebSearch 无结果、文档页在 `bulk_create` 前被截断）⇒ 只作思路参照，不作"业界都这么做"的断言。`src/` 尚未纳入普查面（M6），登记册头部已明写取数面只到 `functions/**`。


### 2026-09-27 追加三十一（对标第十六轮：四个回滚件自写下起第一次被执行验证）

- 取号先列盘（实测当日最高「三十」⇒ 本条「三十一」）。
- 销两度顺延的账（第十三轮 M1 → 第十四轮顺延 → 第十五轮再顺延）：`verify-migrate-replay.mjs` 增 **A8 结构轨** / **A9 数据轨**，4 个 `db/rollback-*.sql` 首次拿到执行证据。真仓 `npm run verify:migrate-replay` 输出 `A8/A9 回滚件往返：结构轨 3 件 + 数据轨 1 件，实测覆盖 4 件`，rc=0。
- A8 三段断言：① 回滚件自身可执行；② **执行后声明要删的对象必须真的消失**（"写了没生效"是最隐蔽的假回滚）；③ 从配对正向件按谓词挑出结构语句再前滚，**逐字段回到基线**（复用第十三轮 `normalizeSchema`/`shapeDiff`，不写第二份比较器）。挑出的语句数与具名声明数不符即判红 —— 前滚用的必须确实是当年那条语句，本轮不猜。
- A9 是给数据类回滚件（`rollback-rename-order20.sql` 是一条 UPDATE）单开的轨：结构判据永远看不见它的失效形态 —— **WHERE 打空 ⇒ 执行"成功"、零行变更、什么也没还原**。故本轨断言行值逐字节相等 + 命中行数 == 1 + 回滚字面量必须不同于正向字面量（否则是空操作）。
- 未归类回滚件默认落进判据面（承第十五轮 B7 的 fail-closed 立场）：既不在结构轨也不在数据轨具名清单里的 `rollback-*.sql` 一律判红并点名。
- 夹具 10 条（`tests/migrateReplay.test.js` 26 条，本文件总用例数不变仍 76）：MA1 掏空回滚件、MA2 对象名漂移、MA3 正向语句被删、MA4 前滚改类型、MA5 未归类回滚件、MA7 回滚值等于正向值、MA8 作用列不一致，各绑一条判据 + 两条"真仓闭合"对照。
- **一处如实欠账**：MA6（想验"命中 0 行"分支）两次设计变异都没走到那条断言（第一次撞 seed 剥离、第二次撞前置的配对校验），现以 `it.skip` + 原因注释挂起，**不假装通过**；登记为第十七轮补夹具。
- 本轮未做（顺延并说明）：M2 `batchUpdateProducts` 预算对账（要动返回契约与前端交互）、M3 档位事实登记、M4 本机 workerd（`@cloudflare/workerd-windows-64/bin/` 空目录、`wrangler --version` 亦崩，与本 diff 无关）。零线上动作：未部署、未改 D1、未动 secret。


### 2026-09-27 追加三十（对标第十五轮：只读密钥的写清单有没有漏 —— 函数级授权的可证性）

- **取号先列盘**：`grep -oE "追加[零一二三四五六七八九十]+" CHANGELOG.md` 实测当日最高「二十九」⇒ 本条取「三十」。

- **轴**：第十四轮量"打几回数据库"，这一轮量**"谁能打"**。OWASP A01（Broken Access Control）最典型的失效形态就是"新 handler 默认不做函数级鉴权"；本项目恰好是它的镜像：只读密钥的禁写清单 `ADMIN_WRITE_ACTIONS` 是**手工维护的 Set**，而它**自带的注释**就写着「⚠️ 审计必须覆盖全部 DB 变更类 action：遗漏即意味着只读密钥可执行该写操作」，并注明 2026-09-23 一次补齐 6 个漏登项 ⇒ **清单被承认必须全覆盖，却没有任何判据证明它覆盖了**。新增写 action 的默认状态是"只读账号也能做"，且 CI 全绿。与第十三轮"契约外 SQL 文件对账本与门禁双向隐形"同族，被管对象从文件换成权限。
- **R15-H1 新门禁 `npm run verify:authz`（纯静态、零凭据、判据核心不碰磁盘）**：业务表面 ← `db/schema.sql` 全部表 − 具名副作用表白名单（`rate_limits` 限流 / `security_events` 审计（含 auth_failed，写它正是鉴权失败时的行为）/ `ai_calls` 观测 / `schema_migrations` 账本，逐条带 why）；业务写 action 集 ← `backend.js` 的 switch 路由 → 处理函数 → AST 可达 SQL 命中的表；与从源码里解析出的 `ADMIN_WRITE_ACTIONS` 做**双向差集**。B1 三面非空／B2 漏登即红／B3 死项即红／B4·B4b `/pub` 业务写须逐条具名允许且清单不得潜伏死项／B5 `/pub` 路由集 ⇄ `PUBLIC_ACTIONS` 集相等／B6 副作用表白名单须真实且逐条有因／B7 未归类新表默认落进业务面（fail-closed 的那一半）。
- **现状结论（如实）**：**16 个业务写 ⇄ 16 条登记，双向相等 ⇒ 当前没有活漏洞**，本轮补的是"保持正确的机制"，不是修一个正在漏的门。这一点写进判据输出行，避免下一轮把它读成"已修缺陷"。
- **变异首跑抓到判据自身两个洞（`tests/actionAuthz.test.js` 14 条）**：① **插值表名的写会隐身** —— `writtenTables` 先把模板各段用 `@` 拼起来、再判 `text` 里有没有 `${`，标记被自己抹掉了 ⇒ `DELETE FROM ${t}` 这类动态表名的写**逃过业务面**；现改判"quasis 段数 > 1 即为插值"并记 `@dyn`（真仓里的 `INSERT INTO ${table}` 由 `insert(DB,'orders',…)` 的字面量参数规则覆盖，故现状不变）。② **变异必须自证落盘** —— 三处 `String.replace` 因 **CRLF** 静默空转，判据不红被读成"机制没问题"；现统一在 `loadSources()` 入口把四路源码 `
 → 
`（本仓 `core.autocrlf=true`，未被我改的文件在盘上是 CRLF、我写的是 LF，判据不能依赖行尾形态），测试侧加 `patch()`：替换未命中即抛，禁止"没改到"冒充"没毛病"。
- **可反证性**：判据核心 `evaluate({schemaSql, backendSrc, securitySrc, files}, opts)` 是纯函数，源码由 `loadSources()` 注入 ⇒ 变异在内存里做，不往受管根写临时文件（R249）。夹具含"只读 handler 被加了 DELETE"“新表 promotions + 写它的 handler""PUBLIC_ACTIONS 少一项""清单里塞死项""幽灵副作用表""原因太短""switch 取数链断了"七类反例，各绑一条判据 id，并有"真仓全绿"对照。
- **默认方向扳正（本轮真正的安全收益，不只是加判据）**：新增 `ADMIN_READ_ACTIONS` 穷举表（15 项），只读档的判定式由 `ADMIN_WRITE_ACTIONS.has(action)` 改为 **`!ADMIN_READ_ACTIONS.has(action)`**。差别在漏登后果：旧写法"没登记 = 只读密钥也能做"（默认允许），新写法"没登记 = 谁都做不了"（默认拒绝）。依据为当日取证原文：OWASP Top 10 A01:2021 **"Except for public resources, deny by default."** 与 **"Accessing API with missing access controls for POST, PUT and DELETE."**；ASVS 5.0.0 **8.2.1** "function-level access is restricted to consumers with **explicit permissions**"、4.0.3 **4.1.5** "access controls **fail securely**"；Directus 文档 **"All public permissions are off by default."**；Spring 文档 **"Denying the request by default is a healthy security practice since it turns the set of rules into an allow list."**
- **为什么不照抄 cancan/Pundit 的形态**：cancan 的 `check_authorization` 挂在 **`after_action`**（动作体已执行完才判红，写副作用早已落地），Pundit README 更自述其校验 **"is not some kind of failsafe mechanism or authorization mechanism. You should be able to remove these filters without affecting how your app works in any way."** ⇒ 二者是**完整性断言**不是拦截器。我方把穷举表放在**派发之前**做真实拦截，并把 Go `exhaustive` 的 `default-signifies-exhaustive=false` 立场落成 B8b（禁止 default 兜底把漏登洗绿）。
- **B8/B8b 两条新判据**：只读穷举表存在且**判定式真的接在链路上**（正则回读源码，防"表建了没人读"= 半成品）；穷举表 ⇄ 路由 ∪ 写清单 两侧相等且互斥（三态分别点名：仅在穷举表 / 两侧都不在 / 读写交叉）。夹具 M12 摘一项 ⇒ 精确点名该 action；M13 把判定式退回看写清单 ⇒ B8 判红；M14 读写交叉 ⇒ B8b 判红。`verify:backend` 116 条断言在扳正后**一字未改仍全绿**（读档 15 项逐条放行、写档 16 项逐条拒），证明本轮是语义加固而非行为变更。
- **接线**：`verify` 链在 `verify:roundtrips` 之后插入 `verify:authz`；`ci.yml` 新增 step `Function-level authorization coverage gate`；`tests/ciWorkflow.test.ts` 的 `REQUIRED_STEPS` 同步加名；`README.md` CI 链描述与单测文件数（76→77）随 `verify:docs` 口径同步。
- **未做（如实）**：本轮只做到"清单与代码同面"，**没有**把两档密钥改成角色/权限表（那是产品与安全边界的双人决策，且线上 secret 变更须先加载 `chaoshi-web-deploy` skill）；第十四轮遗留 P0-M1（rollback 往返判据）本轮复核后再降一轮，障碍与 recipe 见 `memory/07-next-steps.md`。


### 2026-09-27 追加二十九（对标第十四轮：一次业务动作打多少次 D1 —— 往返数与语句数是两把尺）

- **取号先列盘**：`grep -oE "追加[一二三四五六七八九十百零]+" CHANGELOG.md` 实测当日最高「二十八」⇒ 本条取「二十九」（不照上下文快照取号）。

- **轴**：前十三样在问"语句数会不会超配额"，这一轮问的是**这些语句被送出去几回**。D1 官方口径（limits 页，2026-04-21 更新）："Queries per Worker invocation — 1000 (Workers Paid) / **50 (Free)**"，且"Limits for individual queries apply to **each individual statement** contained within a batch" ⇒ `batch()` 省的是**网络往返（延迟）**，不省**语句配额**。只盯一条尺就会漏另一条。
- **实测缺口（本轮撞出来的三条，全部当场可复算）**：① `grep "\.batch(" functions/` 命中 **0** —— D1 的 batch API 从未使用；② `createOrder` 有限库存下语句数 = **5 + N**（N=购物车行数，实测 n=1→6、n=10→15），而 `docs/sql-baseline.json` 里 `P:createOrder=7` 是**定点采样**（该 fixture 恰好 2 件）⇒ 棘轮只锁"这次采到的点"，看不见"每多一件商品多一次往返"；③ `orders.js` 里那段补偿的注释自述前提是「**D1 无跨语句事务**」—— 该前提是错的：官方 batch 页写 "Batched statements are SQL transactions. If a statement in the sequence fails ... it aborts or rolls back the entire sequence"（同页并存一句"each statement … execute and commit sequentially"，措辞自相矛盾，本轮以事务句为准并保留该歧义）。
- **修一类不只修一例**（同族出口一次收口）：`reserveStock` / `releaseStock`（守卫式逐条 UPDATE + 逐条回补）→ 各合成一次 batch；`seedReviews`（20 条逐条 INSERT）→ 一次 batch；`tests/helpers/fakeDb.js` 只支持 `all()` 的旧计数通道不再新增（旧用例不动，新用例走共用 mock）。**未收口的两类已具名登记**：`batchUpdateProducts`（产品要逐条成功/失败明细，与 batch 的整批回滚语义冲突 ⇒ 保留逐条，真缺口是其单次上限 200 与免费档 50 未对账，登记为 P1）、`recalculateOrders`（全表分页 while，往返=数据量/批大小，属预期形态）。
- **R14-H1 `functions/lib/db.js`**：新增 `qBatch(DB, statements)`，**刻意不做"运行时无 batch 就退回循环"的兜底** —— 静默降级会把 O(1) 往返偷偷变回 O(N)，而那正是被测对象；缺 batch 必须响亮报错（`tests/d1RoundTrips.test.js` 有条用例钉这个）。`insert()` 拆出 `insertSql/insertValues`，单条与批量共用一份构造逻辑（防两条通道列序/JSON 序列化口径漂移）。
- **R14-H2 新门禁 `npm run verify:roundtrips`（零凭据、离线 node:sqlite）**：A1 在册项零实测即红／A2 往返斜率必须为 0（规模两端不同才可测）／A2b 定形项（规模不由调用方决定）**必须声明往返上界**，否则 `fixedShape` 就成免检通道／A3 最大规模语句数 ≤ 免费档 50，越界须逐条具名登记／A3b **反向**对账：预算豁免指向不在册 action 即红／A4·A4b 度量工具自证（batch(3)=3 语句·1 往返；第 3 条撞主键则前 2 条必须回滚）／A5·A5b 三项下单末项不足 ⇒ 库存**零残留**／A6 扫描面非空／A7 循环内 DB 调用（AST，含"循环调本文件局部异步函数"两跳）必须逐条具名豁免／A7b 豁免清单不得潜伏死件。
- **变异抓到的两个真洞（先红后才算数）**：① `A3b` 原写作"命中豁免时才反向校验" ⇒ 幽灵豁免可长期潜伏不报错，现改为对 `budgetExempt` 全集校验；② 归属函数名原从 `VariableDeclarator` 直接取 id ⇒ `const r = await applyProductUpdate()` 被当成函数名，豁免写 `#batchUpdateProducts` 永不命中（A7 假阴性 + A7b 假阳性的复合形态），现限定"初值是函数表达式才算函数名"。
- **AST 而非 grep（枚举器的双向验）**：夹具含"循环里的 DB 调用被注释掉 ⇒ 零命中"与"同一句移出循环 ⇒ 零命中"两条反例 —— 文本匹配型检测器在这两条上必然假阳性，判据的分母因此是按函数枚举而非按行匹配。
- **mock 收敛为唯一实现**：新增 `scripts/lib/metered-d1.mjs`，`verify-backend.mjs` 的内联 mock（只会有 prepare/bind/all/first/run）改为引用它。**根因**：mock 没有 `batch()` ⇒ "后端一旦用 batch 就测不出来"，且真 D1 的原子语义在 CI 里无处可验。`statements` 尺口径一字未动（仍数 prepare 次数），第三轮 C1 的基线与断言全部原样保留。
- **实测收益**：`createOrder` 十件商品 往返 **15 → 6**（语句仍 15，配额未省）；`seedReviews` 往返 **22 → 3**（语句仍 22）；`A:seedReviews` 在 `sql-baseline` 的峰值 23 不变（证明两把尺互不顶替）。
- **接线**：`verify` 链在 `verify:migrate-replay` 之后插入 `verify:roundtrips`；`ci.yml` 新增 step `D1 round-trip complexity gate (slope vs input size)`；`tests/ciWorkflow.test.ts` 的 `REQUIRED_STEPS` 同步加名（改名即红）。夹具 `tests/d1RoundTrips.test.js` **20 条**（A1/A2/A2b/A3/A3b/A6/A7/A7b 各绑专属反例 + AST 五向 + batch 语义对照）。


### 2026-09-26 追加二十八（对标第十三轮：新库到底建不建得起来 + 迁移逐字段对账）

- **编号自纠**：本条首稿写成「追加二十二」，与既有的第十轮「追加二十二」同号 —— 我是照上下文里的旧快照取号，没有现枚举（同一轮刚在记忆里立过「取号必须先列盘」的规矩，自己对号入座）。现改为「二十八」（当日最高已到二十七）。

- **实测缺口（不是推测）**：把 `db/migrate-*.sql` 按序灌进空库，7 个文件里 **5 个直接报 `no such table: products` / `orders`**（`migrate-fix` / `idempotency` / `optimize-indexes` / `spec-options` / `stock`）——它们全是"在既有库上打补丁"的裸 ALTER。而 `scripts/migrate.mjs apply` 在全新 D1（空账本）上走的正是这条路 ⇒ **"新环境能不能起来"此前没有答案**。既有 `baseline` 子命令的安全阀只允许回记"对象确实已在本库"的迁移，对空库会把 7 个全部 SKIP，救不了这条路径。
- **R13-H1 ① 新增 `migrate.mjs bootstrap`**：空库 → 灌 `db/schema.sql` 全量 → 复用 `markExisting()`（与 `baseline` **同一份实现**，不再两条通道各说各话）把历史迁移按 SHA 记满账。硬护栏：目标库存在任何业务表即 `fail` 并点名表数与前 6 个表名（**禁止拿全量基线覆盖既有数据**）；`--remote` 走既有 `confirmRemote`（非交互需 `--yes`）。
- **R13-H1 ② 新门禁 `npm run verify:migrate-replay`（零凭据、离线 node:sqlite）**：A1 迁移面为空即判红（判据自己坏了不算通过）／A2 基线重建与真相源**逐字段**相等（列的类型·非空·默认值·主键位 + 索引表·列序·唯一性）／A3 **非基线期**迁移必须能连跑两次不出错（裸 ALTER 第二次必炸 ⇒ 拦住新债）／A4 跑完前向迁移后结构仍等于 `schema.sql`（"写了迁移就要回写真相源"，多写少写都红）。基线期豁免是**白名单** `BASELINE_ERA`（7 个文件逐条点名），新文件想进清单须在 CHANGELOG 留"已在线上执行"的证据。
- **既有 `verify:schema` 有意放弃的那一类，本轮补上了**：它的注释写着"只保证列存在，类型漂移由人工评审兜底"，且反方向声明合法不检查。夹具里做了**双门禁对照**：把 `products.stock` 从 `INTEGER` 改成 `TEXT`，既有门禁判过、本门禁 `shapeDiff` 判红（`tests/migrateReplay.test.js` 11 条，含 A1/A2/A3/A4 各绑专属反例 + CLI 三态 exit 1/1/2）。
- **夹具的夹具**：CLI 用例首跑 exit 2 而非 1 —— 脚本按**自身位置的上一层**锚仓库根，我最初把脚本连 `db/` 平铺在同一层，它去找 `tmp/../db`（第九轮"runGate 只改 cwd 仍扫真仓"同族坑第三次复发）。正解是复刻 `scripts/` + `db/` 层级，而不是放宽断言。
- **接线**：`verify` 链在 `verify:schema` 之后插入 `verify:migrate-replay`；`ci.yml` 新增 step `Migration replay and baseline reconstruction check`；`tests/ciWorkflow.test.ts` 的 `REQUIRED_STEPS` 同步加名（改名即红，防门禁静默消失）。
### 2026-09-26 追加二十七（口味显性化：标签从"规格"改"口味"+ 后台口味标签与 CSV 列 + 冰红茶换图未成）

- **用户三项要求**：① 后台要能看到用户购买商品的口味；② 康师傅冰红茶的宣传图换一个；③ 把"规格"两个字换成"口味"并做得明显一点（"这个是新功能，有些老用户可能看不到"）。
- **动手前实测推翻了③的前提**：口味**不是新功能，是半成品**。`products.specOptions` 早已进 D1、后台口味开关（加/删/显隐）早已上线、线上 `/pub` 实返 4 款薯片带口味（33/34/40/52）。老用户看不到的真实原因有两个：UI 标签仍写"规格"，且口味轴标题是 `text-xs text-gray-500` 的灰色小字（`VariantPicker.tsx:31`）。
- **①后台口味标签（纯前端，零 action 变更）**：`OrdersTab` 每条商品挂品牌色口味标签、CSV 新增独立「口味」列（商品列只留静态规格，可直接按口味透视）、搜索框从"只匹配房间号"扩到房间号/商品名/规格/口味。**不替历史单谎称"未记录"**：实测 50 单 182 件里只有 2 件带口味分隔符且都是 `999-QA` 测试单（追加二十六今天才修好覆盖问题），老单永远只能显示 `乐事薯片(40g)`，标签据此不渲染。
- **分隔符重复源收口**：` · ` 此前在 `src/utils/spec-options.ts` 与 `functions/lib/actions/orders.js` 各写一份字面量，任一侧改动会让后台标签**静默失灵**（不报错，只是永不显示）。新增 `SPEC_FLAVOR_SEP` 常量 + `splitOrderSpec()`；两条构建链无法共享模块，改由 `tests/specFlavorContract.test.js` 把"后端放行串 → 前端解析器 → 口味原样回来"钉成一次可逆往返（含"少一个空格即判无口味"的反例）。
- **③改名 8 处 + 显眼化 3 处**：详情页口味行、卡片角标、商品参数行、后台字段、两处搜索框占位、口味选择器提示、演示组 disclosure 全部由"规格"改"口味"（用户明确选择"全改"，非推荐档）。显眼化：卡片角标从白底灰字改品牌色（`brand-100` 底 + `brand-700` 字）并加"可选"前缀、口味轴标题提到 `text-sm lg:text-base font-bold text-gray-900` 并前置品牌色竖条、价格下方新增"已选口味：X"回显。**已知后果（按用户选择如实记录）**：只有净含量的商品会读成"口味：1L"（冰红茶/矿泉水/东鹏特饮等），后台那个字段实际存的仍是容量值。
- **把"明显"绑成判据**：`tests/e2e-visual/layout.spec.ts` 新增计算样式断言（轴标题字重 ≥700、字号 ≥14px、颜色 gray-900、竖条 == brand-500；角标底色/字色 == brand-100/brand-700；已选口味回显文案精确），并带成对反例面"无口味商品不得长出角标"。用相对事实而非截图基线，避免换机器漂。
- **搜索框文案与实现对齐**：文案改成"名称或口味"后，原实现只匹配 `p.spec`，搜"黄瓜味"会零命中 ⇒ 新增 `specSearchText()`（静态规格 + `enabled !== false` 的口味），顾客端与后台各两处改用它。后台关掉的口味**不参与搜索**：搜出一个点不到的结果比搜不到更糟。
- **②冰红茶换图：三轮检索 61 张候选，零合格 ⇒ 按 skill 铁律保留原图**。先核验"用户看到的到底是哪张图"：`pages.dev/images/6.webp` 实测 42062 B、sha1 与本地逐字节相同 ⇒ 是 09-25 刚换的白底单瓶图，不是旧京东图。随后必应 `murl` × 百度 `acjson` × `filterui:photo-photo` 三轮、竞对 host 检索层拉黑、≥500px 过滤、拼三张带编号联络表逐张目检：命中的是方便面海报/品牌 logo/代言人海报/胰岛素通路示意图/汽车图，**无一张是 1L 冰红茶单瓶干净商品图**。按 `chaoshi-image-optimization` Step 3「搜不到就承认搜不到，不得降级用生成图或凑一张规格不符的图」（同 precedent：09-25 的猎兽 500ml、东鹏补水啦 900ml）。**待老大给一张店内实拍或供货图再替换**（URL 由 `order` 派生，换文件即换图，零代码改动）。
- **"给饮品配口味"实测否决，改绑判据而非造数据**：本店目录里饮品的"口味"就是各条独立记录本身（康师傅 1L 的 order 1~6 分别是 冰糖雪梨/青梅绿茶/金桔柠檬/冰糖红西柚/绿茶/冰红茶），把它们再写成某一条的下级口味 = 同一直通向两条不同价的商品；且 1~6 里 4 条是下架态，跨记录聚合选择器会给出"点了就报错"的死选项。⇒ 不新增 `db/migrate-flavors-drinks.sql`，把 `tests/variants.test.ts` 那条"饮品一律不得有口味"放宽为"饮品可带口味，但每条必须显式 `enabled`（不许靠缺省=true 把没核实在店的口味直接推到顾客面前）"，另补"4 款薯片口味清单不得被误删"的回归保护。**饮品口味请由商家在管理后台按真实在店情况维护**（该能力 09-25 已上线，无需改码）。
- **门禁**：`npm run verify` 全链绿（822 用例 / 74 文件、`verify:backend` 116/116、契约 44/44、schema 17/17、lint 0 警告、双端 typecheck 通过）；`verify:docs` 当场抓出 README 单测文件数 73→74 漂移并已追上真相源；`api-contract.json` 零 diff（本轮确实未动后端 action）。
- **两处待办**：① `src/cart.ts:51-53` productId 单键合行未修（同商品换口味会并成一行，属另一条链，追加二十六已登记）；② 本轮改动**尚未部署**，顾客端与后台要两端各自发版才对用户生效。

### 2026-09-26 追加二十六（后台看不到顾客选的口味：口味在下单落库那一步被目录静态值覆盖）

- **用户报障**：管理后台看不到顾客下单时选的食品口味。
- **根因（先实测再动手）**：`functions/lib/actions/orders.js` 的 `createOrder` 逐字段重建订单明细时写的是 `spec: p.spec || ''`，`p` 是 D1 商品行 ⇒ 取的是目录里的静态 `'40g'`；顾客选的口味（客户端折在 `items[].spec` 里，形如 `40g · 黄瓜味`）**在整个函数里从未被读取**。生产实证：最新订单 `o_muie7jsp46hlm2`（2026-09-26 20:55）买的是带 7 种口味的 `好丽友好有趣薯片`(p040)，库里 `spec` 只有 `"40g"`。链路其余各段（`getPublicProducts` 下发 specOptions、加购写入、`getOrders` 的 jparse、后台 `OrdersTab` 渲染 `item.spec`）实测均完好 ⇒ 断点唯一。
- **第二条同类出口**：`orderFingerprint` 只取 `${productId}x${quantity}`，不含口味 ⇒ 同房间 90s 内"黄瓜味改成烤虾味"会被判成重复单直接复用旧单。**只修落库不修指纹，顾客改口味仍然等于没改**，故一并修。
- **修法（放行"要哪一包"，不放开信任边界）**：新增 `allowedOrderSpecs(p)` / `resolveOrderSpec(p, clientSpec)`，只接受「目录 spec」或商家后台维护且 `enabled !== false` 的口味组合（口径与 `src/utils/spec-options.ts:53` 的 `${spec} · ${label}` 逐字对齐），清单外的串、`<script>` 脏串、后台已关掉的口味、旧客户端不传 spec —— 一律回落商品真值。名称/单价/库存仍全部取 DB 行。SELECT 补 `specOptions` 列（语句条数不变）。
- **判据先行**：`scripts/verify-backend.mjs` 新增 7 条断言（落库 / 管理端读回 / 清单外回落 / 脏串回落 / 旧客户端兼容 / 关掉的口味拒收 / 幂等双向）。**修复前实测 5 FAIL**（含 `实际 "40g"` 正是用户看到的症状），修复后 **116 通过 / 0 失败**。另做**独立变异验证**：单独回退指纹改动（保留落库修复）⇒ `114 通过 / 2 失败`，证明两处各自承重，不是一处顺带带绿另一处。
- **为什么此前全绿**：这条链从"加购"到"下单落库"之间**没有任何一道判据**。加购层测过（`tests/productDetailVariants.test.tsx` 断 `add` 收到 `40g · 黄瓜味`）、渲染层用自造夹具也测过（`tests/ordersTab.test.tsx` 直接塞 `items`），中间段是盲区；`tests/e2e/product-detail.spec.ts` 的用例名写着「口味写进购物袋**与订单**」，实际只走到购物车页就断言结束 —— **用例名承诺的范围比断言宽**，与本仓此前抓到的"承诺写了、判据没接"同族。
- **本轮不做（已定位，属另一条链）**：`src/cart.ts:51-53` 按 `productId` 单键合行，同一商品先后选两个口味会并成一行并保留**第一次**那条的 spec，第二次选择在购物车层面就丢了。该缺陷在 `006a1b5` 提交说明里已登记但从未修。它改的是购物车键控（`removeFromCart`/`updateQuantity` 同用 productId 单键），blast radius 与本轮不同量级，单独排期。

### 2026-09-26 追加二十五（后台「认证失败」：旧密钥被轮换作废，按用户决定回退 + 红线补上取舍理由）

- **用户报障**：手机微信打开 `supermarket-web.pages.dev/#/admin`，输 `supermarket-admin-****` 报「验证失败：认证失败」。**不是缺陷**：该值已在 09-25「先轮换再转 public」的安全轮换中被作废。
- **根因按线上实测定位**（不采信文档记载）：同一时刻打 `/web login` 双密钥对照 —— 旧值 `HTTP 200 code=-1 认证失败`、`.dev.vars` 现值 `HTTP 200 code=0`。⇒ 后端与鉴权链完好，纯粹是**用户手上的密码是已作废的旧值**，而 `AGENTS.md` 红线仍写着「固定值…禁止改回随机串」，与 09-25 的实际状态互相矛盾 —— **这条过期指令就是本次误报的直接来源**。
- **处置（用户拍板「改回 supermarket-admin-****」，风险已在选项里写明并接受）**：`wrangler pages secret put ADMIN_KEY`（`REAL_EXIT=0`）→ 同步 `.dev.vars`（写后回读全等）→ 由 push 触发 CI 重部让 secret 生效（坑 19：Pages secret 部署时注入，不重部不生效）。
- **本轮没有用本地 dist 部署**：实测本地 `dist` 与线上指纹不同（入口 `index-qn5s3Rvh` vs `index-CkEVoWrj`），且**两次读 `dist/sw.js` 的 `CACHE_VERSION` 在 44 秒内变化**（`sm-v1790425412260`→`sm-v1790425455912`）⇒ 并行会话正在重建 dist。此时 `wrangler pages deploy dist` 会把他人在制产物（或坑 31 的半清空产物）推上线，故改走 CI 通道。
- **文档接账**：`AGENTS.md` 红线由「固定值 + 禁止改回随机串」改写为四条可执行口径 —— ①真值只存 Pages secret 与 `.dev.vars`；②**弱密钥是用户的取舍而非待修缺陷，禁止 agent 擅自加固**（并列出 08-23 / 09-05 / 09-25→09-26 三轮反复的实测来历，让下一任不再"好心"轮换第四次）；③唯一必须轮换的场景 = 转 public/共享之前，且轮换后必须重部；④判"密码错还是文档旧"只认 `curl /web login` 的 `code`，不认文档。`HANDOFF.md` 凭证表同步更正（原写「64 位随机串已轮换、旧值作废」，回退后即为假信息）。
- **残留风险（如实登记，不粉饰）**：现值明文存在于本仓 **10 个历史提交**（最早 `wrangler.toml` 的 `[vars]`，`4034aff` 才改掩码），本仓为 public ⇒ 任何翻历史者可进后台改价、删单、读取订单内的房间号/微信号（**含第三方个人信息**）。彻底收口需 `git filter-repo` 重写历史 + force-push，或把仓转回 private（转回即重新受 Actions 分钟计量约束）；两者均为破坏性/权益性操作，**待用户点头，本轮未做**。

### 2026-09-26 追加二十四（对标第十二轮：备份链一直在"绿色零备份"，以及"注释冒充判据"）

- **本轮最重要的一个发现是坏消息**：用 API 核 `D1 Daily Backup` 的真实历史 —— 自建链（09-24）以来**共 2 次 run，`conclusion` 都是 success，但 `Export remote D1` 与 `Upload backup artifact` 两步全是 `skipped`，artifact 数为 0**。根因是未配 `CF_D1_BACKUP_TOKEN` 时 `Detect backup token` 只发一条 `::warning::`，下游一律 `if: found == 'true'` ⇒ **沉默跳过 + 报绿**。⇒ 生产库**从未被这条链自动备份过**，而所有人看到的是绿的；盘上唯一真备份是 09-25 的手动导出物（`../_backup/supermarket-d1-pre-specoptions-20260925-184136.sql`，1,449,663B）。这也**纠正了第十一轮我自己写下的说法**（我写的是"非 private 会先响亮失败"）—— 守卫确实会拦，但它带 `if: found == 'true'`，token 缺席时**守卫本身也被跳过**，所以响亮失败从未发生。
- **R12-H1 备份链存活判据（`scripts/check-backup-liveness.mjs` + `npm run check:backup-liveness`）**：不看 conclusion，看**产物与步骤实况**——要求存在一次"导出步骤 success + artifact ≥ 1 + run success"的 run 且在 2 天内；`runs` 为空 ⇒ 判红（零输入不记绿）；把"success 但 0 产物"的次数摊成 WARN 让形状可见；workflow 标识默认用**文件名** `d1-backup.yml`（实测 API 支持，免再往仓库塞数字 ID 变量）。接进 `Uptime`（每日），并配 job 级 `permissions: actions: read` + step 级 `GH_TOKEN`（第十一轮 pr-advisory 空转的直接复用）。12 条夹具（`tests/backupLiveness.test.js`，含 CLI 三档退出码与 fixture 注入面）。
- **R12-H1b 沉默跳过改成响亮失败**：`d1-backup.yml` 新增 `Fail loudly instead of reporting a green no-op` step——未配 token 且未设仓库变量 `BACKUP_SKIP_OK=true` ⇒ `exit 1`。**默认状态是响亮**，要安静必须显式表态（"沉默跳过"就是本次事故的成因，不能继续占默认位）。
- **R12-H3 catalog 接成阻断**：第十一轮定的"两轮无误报样本"条件已满足（本机 + Uptime run `36240825097` 逐项一致：28/54、漂移 27+1+22、重复 3+3）⇒ 摘掉 `continue-on-error`。硬不变量违反与取不到数据都会红；漂移仍只打印。
- **R12-H4 三条 cron 两两互指**（子代理评审反哺，先核指控再改）：`d1-backup.yml` 新增 `Cross-check the daily probe is still running`（`LIVENESS_MODE=presence`，只认"有没有按时成功跑过"），job 级补 `permissions: actions: read` + step 级 `GH_TOKEN`。动因是官方行为里那条最阴的：**public 仓 60 天无仓库活动会自动禁用 schedule**，届时什么都不会红。同轮接受两处对我新判据的正当指控：① `stepsOk` 原本"无步骤明细即通过"是 fail-open ⇒ 改为"有明细必须真成功、无明细只由 artifact 定性并**计数出 WARN**"；② 取数无窗口 ⇒ 一次 push 风暴可把 scheduled run 挤出 `per_page`，改为 `created>=` 窗口 + 新增**调度层断言**（窗口内至少要有一次 scheduled run，且最近一次龄期 ≤ 2 个周期 + 1 天缓冲；刻意不用"应有 N 次"的计数分母，因为刚建链的 workflow 天然凑不够次数会把真话报成假红）。契约测试同步加两条（互指步消失／presence 模式缺失都要红）。
- **两处自纠（都留了常驻夹具）**：① **注释冒充判据**——存活契约的反例首跑"抽掉 `actions: read` 却测不出问题"，因为我写的 YAML **注释**里就有 `actions: read` 字样，裸子串匹配把它当成了配置行。正解＝判据一律用**行首锚定的键形态**（`^[ 	]*actions:[ 	]*read[ 	]*$`），注释不参与。② **CRLF 又咬了一口**——变异正则 `/ +actions: read
/` 在 CRLF 工作文本上匹配不到 ⇒ "抽掉"成了空操作、反例假过；现在夹具先把 texts 归一再改。
- **本轮明确不做**：把备份产物搬到 R2/外部存储（需人开桶并决策）、把仓库转回 private（需人）、给 Uptime 加第三方心跳（ntfy/pushover/healthchecks.io 都要新 secret 与外部依赖；本仓已有 GitHub 失败邮件这一条可达通道，先用它，等出现"邮件没到"的证据再谈第二通道）。


### 2026-09-26 追加二十三（对标第十一轮：备份必须先被证明可恢复 + 一次"测错机制"的自纠）

- **对标切面换成"可恢复性与数据面"**，取证 9 仓（`agentic-qe`、`mattermost`、`restic`、`pgbackrest`、`Telegram-Drive`、`EasySchematic`、`frankensqlite`、`litemall`/`saleor` 种子面）。两条硬事实：① `proffesor-for-testing/agentic-qe scripts/aqe-db-backup.sh:56,58,89-90` 是"导出前查 `integrity_check`、不合格丢弃并保留上一份好备份、**恢复入口再查一次**"；② 公开可见的 **D1 备份 workflow 无一家做到"载回并断言"**（`caamer20/Telegram-Drive supporter-backup.yml:63-66` 停在 `test -s` + `grep CREATE TABLE`；`duremovich/EasySchematic backup-d1.yml:59` 下载回来也只 `ls -lh`）⇒ 本轮这一条是补空白。
- **R11-H1 备份恢复演练判据（`scripts/verify-backup-restore.mjs`，`npm run verify:restore`）**：把 dump 完整载进一次性内存 SQLite（`node:sqlite`，零依赖不落盘），断六条——载入不抛错 / `integrity_check=ok` / `foreign_key_check` 零行 / 表集合与 `db/schema.sql` **双向**对账 / `Σ行数 == 文本 INSERT 语句数`（计数按**语句级**而非行首匹配，防"值里含 INSERT INTO 字样"与"一行两条语句"两种失真）/ `products` 非空。`0` 可恢复、`1` 不过、**`2` 文件缺失**（`frankensqlite` 那种 `exit 0` 是明确反例）。接进 `d1-backup.yml` 且**排在上传之前**，顺序本身由 `ciWorkflow.test.ts` 新组钉住（演练放上传后面 ⇒ 判据点名）。15 条夹具（`tests/backupRestore.test.js`，含 CLI 退出码三条；生产 dump 有客户数据，夹具改用 `node:sqlite` 现造库 + mini-dumper，**不进仓**）。
- **首跑就抓到一处真缺陷**：`schema_migrations` 一直只由 `scripts/migrate.mjs` 运行时 `CREATE`，从未进过全量真相源 `db/schema.sql` ⇒ 判据报"备份里出现 schema.sql 之外的表"。修法是把 DDL 补进 `db/schema.sql`（补真值面），不是放宽判据。真实生产 dump（`_backup/…20260925-184136.sql`，1,449,663B / 949 条 INSERT）现在全过：10 表、`integrity=ok`、`fk=0`、Σ行数 949 == 文本语句数。
- **R11-H2 一次"测错机制"的自纠（本轮最该记的方法账）**：我先用 markup `style=` 属性做探针，在 `style-src 'self'` 下测出"被拦"，据此断言**线上那 8 处 React 内联样式全是死样式**，并已动手把 7 个文件改成走类名。复测才看清 CSP 的两副面孔：`markup / setAttribute('style',…)` ⇒ 拦（computed 回落 + 报违规），`el.style.setProperty / el.style.x=` ⇒ **放行**，而 React 走的是后者。⇒ **全部回滚**（`git checkout` 5 个文件），改成立得住的三件：① `npm run verify:csp`（静态 HTML 面：CSP meta 必在、`style-src`/`script-src` 无 `unsafe-inline`/`unsafe-hashes`、静态 HTML 不带 `style=` 与 `<style>`，9 条夹具 `tests/cspStaticGate.test.js`，进 `verify` 链与 CI）；② 生产构建上的正向事实判据（`tests/e2e-visual/layout.spec.ts` 用真实内容 `[data-related-list]` 证明 CSSOM 路径生效：`list-style:none` + `margin-top:0px`）；③ 明确**不在应用 spec 里复现"被拦"那一半**——它会给被测页注入一条 CSP console 错误，被 `watchErrors.assertClean()` 判成应用缺陷（第一版就是这么红的）。教训：**测错机制＝得出相反结论**；探针必须打在"被审对象实际走的那条路径"上。
- **R11-H3 目录事实对账（`scripts/check-catalog-facts.mjs`，`npm run report:catalog`）**：把挂了十几轮的"D1↔seed 对账 + 28/55 口径"变成机器输出。真跑一次即得：**线上公开 28 条 / `db/seed.sql` 54 条**、只在 seed 27 项、只在线上 1 项、**价格不同 22 项**、同名重复 seed 3 / 线上 3。分两面：硬不变量（空目录 / `_id` 重复 / `name` 空 / `price` 非法 / 公开接口含下架项 / `subcategories` 未解码）违反 ⇒ `exit 1`；漂移 ⇒ 只报告（生产数据本会漂，判红等于逼运营回滚）。取不到数据 ⇒ `exit 2` BLOCKED，不记绿。13 条夹具。**判据自身也被自己的首跑纠正了一次**：先用 api 形状判 seed ⇒ 54 行全红，实为 `subcategories` 在 DB 里是未解码 JSON 文本 ⇒ 改成 `'api'` / `'db'` 两种形状分开判（混用会同时造成假红与漏判），并把这条差异写进夹具。CI 侧接在 `Uptime` 工作流末尾，`continue-on-error: true`（新指标先量误报率再接闸）。
- **R11-M1 了结第九轮遗留**：色块轴 `kind:'color'` / `swatch` **全站零数据**（`swatch` 只活在组件与类型里）⇒ 连同 `VariantPicker` 那段恒真三元（两个分支同一个类名）、`tests/variants.test.ts` 的空转断言、`layout.spec.ts` 的 `test.skip` 一起删净（断言换成"每个轴每个选项都有 label"这类真判据）。视觉门禁从 15 通过 + 1 skip 变成 **16 全通过**。恢复演练与手动恢复步骤写进 `docs/ci-triage-runbook.md` §8（含 sha256 核对与 `--remote` 覆盖式恢复的警告）。
- **本轮明确不做（带证据）**：pgbackrest 分页校验和清单（TB 级页面备份的仪式，本库 1.4MB）、restic 全量 blob 可达性扫描（无多代快照可扫；但**采纳它 `checker.go:225-227` 的自我克制**：不断言 `SUM(totalAmount)` 这类派生聚合，只断言结构性计数）、mattermost 全链路 bulk round-trip（要起实例+对象存储）、`wrangler d1 execute --local` 回灌（会污染本地持久化目录，直连 `node:sqlite` 更干净）、仓库转回 private 或上 R2（需人决策）。
- **本机全绿而 CI 判红的一次实况（PR run `36240380871`）**：`npm run verify` 本机 `exit 0`（72 文件 / 790 用例），ubuntu runner 上 `build-and-test` 却红在 `Cannot bundle Node.js built-in "node:sqlite" imported from scripts/verify-backup-restore.mjs` —— 新写的判据测试跑在默认 **jsdom** 环境，而它们 import 的脚本链上带 `node:sqlite`；本机 Vite 放行、Linux 拒绝。修法不是放宽判据而是**把环境声明对**：`tests/backupRestore.test.js` 与 `tests/catalogFacts.test.js` 顶部加 `// @vitest-environment node`（节点级判据本来就不需要 DOM）。⇒ 与第八轮"过期 dist 假绿"同族：**本机绿不构成完成证据，接进 CI 后必须真跑一次**；另记一条新规矩：**节点级脚本测试一律显式声明 node 环境，不蹭默认 jsdom**。
- **advisory 定案**：`pr-advisory` 保持报告型。理由是证据不足而非偷懒——真跑样本仅 2 次（1 次空集、1 次把纯文档 PR 正确归类），且本仓无多人 PR 流；阻断版必须先有 label 逃生门（照 workers-sdk `ci:no-tests`）。
- **本机门禁（实跑非预写）**：`npm run verify` 见 §本报告 §6（新增 `verify:csp` 一道，单测 72 文件）。


### 2026-09-26 追加二十二（对标第十轮：通知类副作用的"未配即关" + 把三条判据拆成可反证的纯函数）

- **对标系换面**：这轮专挑"投递副作用"和"PR/门禁层"两件事取证，九仓实测开文件（子代理给的行号逐条复核，其中 litemall 的包路径它写成 `com.qiao.litemall`、实际在当前 master 是 `org.linlinjava.litemall.core.notify` —— 机制属实、路径已纠）。拿到三条硬事实：① `litemall NotifyService.isMailEnable()` = `mailSender != null`，未配置时 `@Async` 方法直接 `return`，**不改状态、不耗重试**；② `saleor` 把投递结果写成 `EventDelivery`/`EventDeliveryAttempt` 两张表 + Celery `retry_backoff=10, max_retries=5`，即"要它的重试语义就得加持久化登记表"；③ **medusa 是反面参照** —— provider 未启用时它写一行 FAILURE 并 `throw`，"没配置也改状态、也消耗重试"，与我们要的语义正好相反。另 `workers-sdk` 把门禁逻辑写成**导出纯函数 + 自带 `__tests__`**（`tools/deployments/validate-changesets.ts:18`），这正是本轮三条判据拆纯函数的依据。
- **R10-H1 新订单通知 webhook（`functions/lib/notify.js`）**：三条不变量各配正反用例（`tests/orderNotify.test.js`，16 条）。未配 `ORDER_WEBHOOK_URL` ⇒ `webhookTarget` 返回 null，纯 no-op（连 promise 都不创建）；非法 URL / `file:` / `data:` 协议一律视同未配置；投递失败（非 2xx、网络抛错、4s 超时）全部收敛成结论对象，**不冒泡到下单**（挂 `context.waitUntil` 保活，响应先返回）；载荷白名单 6 个字段，微信号/备注/**付款截图**（可达 800KB 的 base64）都不外发。**两个下单出口一处适配器**（`/pub` 顾客下单、`/web` 管理端代客下单共用 `maybeNotifyNewOrder`，防"修一例不修一类"）；`deduplicated` 命中不通知——重试同一张单不该重复提醒。
- **R10-H2 parity 判据拆成纯函数 + 常驻反例（补上第九轮自己记下的缺口）**：`scripts/verify-release-parity.mjs` 的判定搬进导出的 `evaluateParity()`（脚本仍在 CLI 时执行，靠 `fileURLToPath(import.meta.url) === resolve(process.argv[1])` 判"是不是被直接调用"，Windows 盘符大小写已归一），新增 `tests/releaseParity.test.js` 11 条，把上一轮明说"本机凑不出、永远未覆盖"的 **bundle 不同名** 分支连同不可达、起点过旧、批次偏移、公开目录为空一起钉住。变异实测：把 bundle 比较改成恒假 ⇒ 恰好 3 条红（含"问题不重复记账"）；改起点检查恒假 ⇒ 对应条红。顺带消除一处隐患：重试阶梯与终判此前是两套条件，现共用同一函数（两套条件一旦漂移就会出现"阶梯以为一致、终判却报红"）。
- **R10-H3 环境变量登记册门禁（`scripts/check-env-docs.mjs` + `docs/env-vars.md`，`npm run verify:env` 已进 `verify` 链与 CI）**：动因是本轮自己踩出来的——新增 `ORDER_WEBHOOK_URL` 时"未配即 no-op"本来只写在代码注释里。现在 `functions/**` 的每个 `env.X` 与 `src/**` 的每个 `VITE_*` 必须有一行登记，反之登记册不许留死行，且**每行必须写「未配置时行为」**（对标组实测 0 家把这条承诺变成判据）。首跑即抓到 5 个此前从未进任何文档的变量（`ADMIN_READONLY_KEY`/`ALLOWED_ORIGINS`/`DB`/`RATE_KV`/`CF_PAGES_COMMIT_SHA`），逐条读码核实降级行为后入册（`process.env.X` 用 `(?<!\.)` 排除，防把 CI 进程环境当 Pages 变量要求登记）。夹具 `tests/envRegistryGate.test.js` 15 条，变异实测：去掉"死文档"检查与去掉"未写未配置行为"检查 ⇒ 各红 1 条，精确命中。
- **R10-M1 workflow 模板注入自查（零依赖替代 zizmor）**：`tests/ciWorkflow.test.ts` 新增一组（该文件 15 → 20 条）：`run:` 块内插值不可信上下文（`github.event.*` / `github.head_ref` / `github.actor`）即判红，正确写法是先 `env:` 映射再引 `$VAR`；本仓 4 条 workflow 实测干净（`GITHUB_EVENT_BEFORE`、`GITHUB_HEAD_SHA` 两处都在 env 映射里）。**不装 zizmor** 的理由如实记下：它最高价值那条（action 未钉 SHA）本仓已消灭，装上换来的主要是每 PR 多一个 job + 一堆 `# zizmor: ignore` 注释税。夹具双向验：注入两条坏样本必红、`env:` 正确写法与注释里的 `github.event` 不误伤、另有"分母非空"反向钉（万一 ci.yml 不再使用 `github.event.*`，判据退化成空转真时会响）。
- **R10-M2 「PR 带没带回归手段」报告型判据**（`scripts/check-pr-has-tests.mjs` + `dispatch.yml` 新 job `pr-advisory`）：照 `workers-sdk validate-pr-description.ts:54` 的思路，但**按「新指标先量误报率再接闸」的规矩只做 advisory**（永远 exit 0）。放 `dispatch.yml` 而非 `ci.yml` 的原因是实测：ci.yml 的 token 只能 `contents: read`，用它调 `GET /pulls` 会 403，而 dispatch job 有 `GH_TOKEN` 可跑 `gh pr list`；取不到就打印 `SKIPPED` 而不是静默判绿。夹具 7 条含"dependabot 那种纯 lockfile PR 不该被骚扰"。
  - **首跑（run `36237222557`）当场暴露它自己没接线**：CI 里输出 `[pr-advisory] SKIPPED 取不到 PR 列表（gh 不可用）` —— 那个 job 只给了 `contents: read` 又没把 `GH_TOKEN` 传进 step，`gh` 在 runner 上等于未鉴权。**"永远 exit 0"的判据最阴的失效方式就是不红地永久空转**，本轮的脚本按设计不红 ⇒ 只能靠接线契约钉。修法：`permissions` 补 `pull-requests: read` + step 显式 `GH_TOKEN: secrets.GITHUB_TOKEN`，并新增 `advisoryJobProblems()` 断言（三项缺一即红：缺 token／缺读权／不再调用该脚本／job 整个消失），另配四条反例夹具（`ciWorkflow.test.ts` 24 → 26 条）。
- **本轮明确不做（带证据，非拖延）**：① `.github/settings.yml` 式"分支保护即代码"——9 仓 recursive tree grep 全 404，零家做，且本仓单人直推 main，真风险是配置漂移不是漏设；② vite 的 `test-passed` 聚合必检 job（实测存在，`vitejs/vite ci.yml:141-150`）——本仓没有必检配置，加两个 job 只换来配额消耗（本账号 09-25 刚出现过 0-step 停摆窗口）；③ changesets——单包应用用它等于每 PR 多一个必填文件；④ playwright 加权分片 / flaky 看板——5～7 个浏览器用例撑不起开销；⑤ `EventDelivery` 式投递登记两张表——没有常驻消费者，加了也没人重放，反而多一份 D1 写放大。
- **⚠️ 合并后现场把 github.io 链路弄坏了一次（本轮最该记的自纠）**：PR 合并（`a000850`）后 `dispatch.yml` run `36236818742` **failure 且 jobs 数组为空** —— 我用脚本插 job 时把整块插到了顶层 `jobs:` **之前**（落在 `permissions:` 段里），GitHub 因此一个 job 都排不出来 ⇒ main 的 CI success、pages.dev 已发新构建，而顾客端**没被触发**，两端当场进入半发布态（正是 `release-parity` 该报红的那一类，它随即在跑）。根因不是"手写错缩进"，是**这条链上没有任何判据管 job 到底在不在 `jobs:` 里**：`ciWorkflow.test.ts` 断言了 needs/SHA/step 名/权限/插值位置，唯独没断言排版骨架。修法＝① 搬回正确位置；② 补两条最小不变量（顶层键必须是 Actions 合法字段；任何 `runs-on:` 必须出现在顶层 `jobs:` 之后），并**用当时那份坏文件复跑验证**：重新制造同一缺陷 ⇒ 判据点名"第 28 行 runs-on 出现在 jobs: 之前"，还原 ⇒ 绿。教训与第九轮同族：**能被脚本插错的位置，就必须有判据钉住它**（否则下一次换个人/换个脚本还会犯）。
- **R10-M3 K4 PR 流试点**：本轮全部改动改走"分支 → PR → CI（含 release-parity）→ 自并"，不再直推 main（过程与结论见 `memory/07-next-steps.md` 同日条目）。



### 2026-09-26 追加二十一（对标第九轮：把"门禁链自己"和"两端发布结果"变成被测对象）

- **对标系与打法升级**：本轮不再比"谁的门禁多"，而是深挖**机制怎么落地**。八仓实测到的三件可借鉴物：`microfeed` `tests/unit/ci-workflow.test.ts`（把工作流文件当被测对象：step 顺序、secret 白名单**全等**、`not.toContain` 危险写法）、`vendure` `.github/workflows/scripts/dependency-impact.test.js`（CI 脚本自带测试，含 mock 掉 `gh` 二进制 + 注入 HTTP 失败）、`saleor` `.semgrep/`（每条规则同时带"必须命中 `ruleid`"与"必须不命中 `ok`"两类样本，另有 `.fixed.py` 断言自动修复产物）。另记两条**否定式**结论：跨两个托管目标做发布一致性核对 **8 家 0 有**；mutation testing（stryker/mutmut/infection）**8 家 0 有** ⇒ 这两项做了是领先，不是补差距。
- **R9-H1 新增两份常驻自测（`tests/ciWorkflow.test.ts` + `tests/gateFixtures.test.ts`，合计 26 条）**：
  - `ciWorkflow.test.ts` 解析 `.github/workflows/*.yml` 断言：CI 恰好这 5 个 job、**`deploy.needs` 必须覆盖全部判据 job**（缺一个就点名"这些判据 job 红了也照常部署"）、15 处 `uses:` 全为 40 位 SHA 且保留版本注释、无明文密钥（`ADMIN_KEY` 根本不该出现在 workflow）、12 个关键 step 名一个都不能少、CHANGELOG 门禁必须拿到 `GITHUB_EVENT_BEFORE`、Build 必须烘焙两个 `VITE_CB_*` 端点、每仓顶层 `permissions` 不得含 write、**并发组规则按真不变量收窄**（只有能跑 PR/多 ref 的 workflow 才要求 `cancel-in-progress: true` 时按 ref 分组）、`.github` 静态件结构 + 常驻坏样本。
  - 这条直接钉死本仓两次踩过的假安全感：`deploy.needs` 从 09-24 起注释与 CHANGELOG 都写"具备阻断力"，而 needs 里实际只有 `build-and-test`（防线轮才接上）。**注释说阻断 ≠ 真阻断，现在由机器说。**
  - `gateFixtures.test.ts` 给门禁脚本配两侧夹具：`scan-secrets` 植入 AWS 形态必须红 / 干净仓必须不红 / `API_KEY=your-secret-here` 占位符不得误伤；`check-changelog` 无记录改 src 必须红 / 带记录必须绿 / **push 区间把 src 改动藏在末位 docs 提交后仍必须红**（第九轮补上第八轮 M1 的自证）；`check-doc-consistency` 缺生成物必须 exit 2 而非静默 PASS；`check-case-collision` 索引内互撞必须红（夹具用 `git update-index --cacheinfo` 造第二条异 Case 项——Windows 上文件系统造不出两个文件，只塞一条是**假反例**）+ 正向对照不红 + 对本仓跑必须 0。
- **R9-H2 双端发布一致性从人工收尾变判据（`scripts/verify-release-parity.mjs` + deploy 后置 step）**：第八轮及以前每轮手写"两端 `sw.js` 指纹 + bundle 同名"，属人工动作；`dispatch.yml` 是独立 workflow ⇒ CI 绿不等于两端同步（坑 36）。现在断：两端 `CACHE_VERSION` 形状合法、**都晚于本次发布起点**（deploy job 起始 step 输出 epoch，故能区分"两端都刷新"与"只新了一端"）、两者相差 ≤6h 同批、入口 `index-*.js` 同名、`/pub getPublicProducts` 条数 >0；CDN 传播按坑 32 给重试阶梯。**只报事实不回滚**（回滚仍只由 smoke 失败触发，避免双触发把生产反复翻面）。四向实测：正例 rc=0（指纹 `sm-v1790403446818`、bundle `index-CwPZhV2W.js`、28 条）／真实 github.io 本机不可达 rc=1 且指名哪端／起点设为未来 rc=1 两端都判旧／缺 `PARITY_AFTER_TS` rc=2 拒绝"看起来一样就放行"。**未独立命中的分支**：bundle 同名不一致（本机只有 pages.dev 可达，凑不出两端不同构建），留 CI 首跑覆盖。
- **`.github/ISSUE_TEMPLATE/` 新增**（bug / feature / config 三件，实测对标组 4/8 有任意模板、CoC 只有 vendure 1/8 ⇒ 模板是真短板，CoC 不是差距，本轮不做 CoC 并记此由）。表单强制写清"哪个端 / 云端还是演示模式 / 不贴个人信息"，并把本仓规矩写进验收栏（"没有回归手段就不改"）。feature 表单首稿把 `attributes:` 缩进写坏，顺手给 `.github` 加了结构判据 + 常驻坏样本；**该判据第一版又写严了**（要求 `attributes:` 紧跟 `- type:`，而 issue-form 的合法顺序是 `type → id → attributes`，结果把两份合法模板全判红）—— 已改为"块内存在正确缩进的 `attributes:`"，并加常驻正样本 `type→id→attributes` 钉住这次过严（过严的判据与缺失的判据一样有害）。
- **覆盖率棘轮 statements 78 → 79**：按台账要求的**连跑 5 次全量 `--coverage`** 定档 —— 81.11 / 76.74 / 82.79 三项逐位一致，branches 在 74.44↔74.48 抖 0.04pt（同一条 5s 轮询时序分支），故 branches 仍用最小观测值 −2pp = 72 不动。
- **N4 结论：本轮不改执行模型（有据不改，非拖延）**。5 连跑在低负载下 **rc 全 0、63 文件 / 657 用例全绿、wall 29s(冷)→10~11s、OOM 命中 0、timeout 命中 0**；而第八轮记的 OOM 发生在我同时跑浏览器套件/并发任务期间 ⇒ 判定为**并发负载诱发**而非默认链缺陷。vitest 每次仍提示"jsdom 建了 63 次占 63% 时间"，故把 `pool:'vmThreads'` / `isolate:false` / `maxWorkers` 保留为"仅当无人值守也复现 OOM 时才动"的备选，且仍禁止抬 `testTimeout` 掩盖机制缺陷。
- **⚠️ R9-H2 首版被 CI 首跑打回（判据对、位置错）**：我最初把双端一致性挂在 `ci.yml` 的 deploy job 尾部，run `36232597018` step 7 **failure** 而 step 6 冒烟 success：runner 上两端都 `http 200`，pages.dev 指纹 `sm-v1790414640778`（本次）、github.io 停在 45 秒前的 `sm-v1790414596219`（上一批），复取 6 次跨 247s 仍不同。根因是**并行**：顾客端由 `dispatch.yml` → 对端 `deploy.yml` 重新 checkout+build+publish，再加 Pages 边缘 2–3 分钟传播（坑 32），pages.dev 的 deploy job 等不到它。⇒ 搬进独立 `.github/workflows/release-parity.yml`（`workflow_run: CI completed` + 仅 CI success 才核 + 阶梯 12 次 ≈17 分钟 + 基线取**发布提交的 `%ct`** 而非本步起始时刻，否则会把上一批构建误判成"已刷新"），并只报警不回滚（回滚仍只由本端 smoke 失败触发）。同时给 `ciWorkflow.test.ts` 加一条**反向钉**：`deploy` job 里不许再出现 `verify:parity`。
- **本轮三处"过严判据"自纠（与缺失判据同样有害，均留常驻样本）**：① `.github` 结构判据首版要求 `attributes:` 紧跟 `- type:`，而 issue-form 合法顺序是 `type → id → attributes`，把自家两份合法模板全判红；② `release-parity` 的"git 前必须 checkout"正则无法判断位置，把合法的 `- name: Fetch release commit` + `run: git fetch` 也判红，已删并只留"首步是 Checkout"这一条不变量；③ `runGate` 首版只改 cwd，而门禁脚本按**自身文件位置**锚仓库根 ⇒ 扫的仍是真仓（症状：输出"已跟踪 530"），改为把脚本复制进夹具仓。
- **另一处必须记的现场拦阻**：夹具里那枚"AKIA + 16 位"形态的假密钥字面量被**本仓自己的 pre-commit 密钥扫描拦下**（提交失败），而 `npm run verify` 此前是绿的 —— 因为 `scan-secrets` 扫 `git ls-files`，**未跟踪文件不在覆盖内**。正解不是 `--no-verify`，而是运行时 `join` 拼形、静态源码不留完整形态（夹具仓里仍是完整形态，判据照样必须红）。本条 CHANGELOG 首稿因原样引用该字面量，被同一个门禁**第二次**拦下 —— 文档里也不留完整密钥形态，这条纪律连自己写的说明也管。
- **本轮未做（如实）**：新订单 webhook 通知（对标件已定位：`minshop` D1 outbox + `env.EMAIL` 未配即 no-op 并带"未启用不发也不消耗重试"的反例、`litemall` `NotifyService` 的 `isMailEnable()` 同形）—— 它要动下单主链路，留作独立一轮，不与其他项混提；`diff-cover` 维持第八轮结论（实测 **0/8 家在 CI 卡覆盖率**，且本机无该工具、装它属新增系统依赖，不静默安装）；R2 / 真支付 / 多租户 / i18n 维持"场景不适用"。
- **门禁全绿（本机实测，非预写）**：`npm run verify` **exit 0** —— lint 0 warning、大小写冲突 0、契约 44 通过、文档事实 7 项（其中"单测文件数 65"这一项**当场拦住我没同步 README**）、schema 漂移、license 10/10、typecheck 双配置、**65 文件 / 683 用例全过**、`verify:backend` **109/0**、Functions 编译 88,650B、`check:size` 3/3；三层浏览器门禁 22 / 15+1skip / 3。


### 2026-09-26 追加二十（对标第八轮：换同架构对标系 + 把五处"承诺已写、判据未接"接上闸）

- **对标系换血**：引入与本仓**同栈**的三个开源项目作主对标 —— `dreamhunter2333/cloudflare_temp_email`（11,845★，Pages Functions + D1 + KV + R2）、`microfeed/microfeed`（4,095★，Workers + D1 + R2 + Queues）、`ddyy/minshop`（158★，ecommerce + D1 + R2 + Workers + Stripe + MCP）。前七轮只比 litemall/Medusa/Saleor/Vercel Commerce/Vendure（清一色服务端重型平台），可比维度越比越窄。数据 2026-09-26 `gh api` 实测（认证态，9 仓全部 HTTP 200，递归树 `truncated:false`）。
- **纠偏两条既有判断**：① 前轮把"无 Lighthouse 指标预算"记为差距 —— 本轮实测 **9 个仓的 workflow / package.json 里 0 家卡 Lighthouse·web-vitals·size-limit·treo**（连 `budget` 字样都没有；Saleor 卡的是服务端迁移性能），它不是相对差距，降为自选动作；② 派出的调研 agent 建议"借鉴 saleor 把 actions 钉到 SHA" —— 主进程实测本仓 `ci.yml` 12 处 `uses:` **已全部钉 40 位 SHA**，该条作废。**同轮自查出一条自己造的假缺口**：H1 声称"CI 没跑 `verify:backend`"，实为我 grep 的是 npm 别名、CI 写的是脚本路径（`ci.yml:103` `node scripts/verify-backend.mjs` 一直在跑），已撤回不改。
- **H2 新门禁 `scripts/check-doc-consistency.mjs`（对标 microfeed 的 `docs:check` step）**：README/ARCHITECTURE 里可静态派生的数字必须等于真相源 —— `/web`·`/pub` action 数取自 `docs/api-contract.json`、棘轮阈值取自 `vite.config.js`、单测文件数取自磁盘、文档内链逐个 `existsSync`。**实测抓到的四处漂移（全部已改）**：徽章写死 `tests-176 passed`（同文件另一行写 631，真值数百）、README 与 ARCHITECTURE 各写 `/web 管理 30 action`（契约实测 **31**）、README 写 `e2e 20 用例`（实测 22）。按"派生不复制"处置：三处写死的用例数一律拆掉，改为指向当场输出。反例已实跑：把 31 改回 30 + 把数字徽章塞回 → **FAIL 3 项并精确指到 `README.md:17` / `ARCHITECTURE.md:16` / `README.md:6`**，复原后 OK 7 项。
- **H3 浏览器错误观察器收口（`tests/e2e/helpers/watchErrors.ts`）**：修复前 `tests/e2e/{smoke,order-flow,product-detail}` 与 `tests/e2e-visual/layout` 的 `page.on('pageerror')` 只 `console.log` 到 CI 日志、**从不产断言**（那四个文件另有 15/54/9/57 处 `expect` 也拦不住页面抛错）。现统一走 `watchErrors(page).assertClean()`，dev 专有 CSP 噪声按具体串放行、跑生产构建的两层不放行。唯一正确形态原来只存在于桩 spec，一并改接同一实现（顺带修掉它对"reload 后需重新挂监听器"的误解 —— 页级监听器不随导航失效，重复注册只会让错误重复计数），并把错误断言从"只有第一条用例查"扩到 `afterEach` 全覆盖。验证：dev 22/22、生产视觉 16/16、桩 3/3 全绿；反例三条实跑 —— 注入 pageerror 红、注入 `console.error` 红、404 资源噪声不误伤仍绿。
- **H4 新门禁 `scripts/check-functions-build.mjs`（对标 microfeed 的 "Verify the Worker bundle"）**：`npm run build` 只编译 `src/`，`functions/` 全在 vite 视野外，绑定名/入口语法错此前要等到真部署才炸。Pages 子命令**没有** `--dry-run`（实测 `wrangler pages deploy --help` 零命中），故用 `wrangler pages functions build`：零鉴权、零网络写、不建任何 Cloudflare 资源；三条结构断言 = 退出码 + 产物 ≥40KB（实测 88,650B，防"编译成功但什么都没打进包"）+ `/web`·`/pub`·`/_health` 三个路由字面量齐备。反例两条实跑：`functions/` 内 import 缺失模块 → `Could not resolve` 非零；把 `functions/_health.js` 改名 → 报「找不到路由字面量 /_health」exit 1，复原后复跑 OK。
- **H5 修一类不修一例（收第七轮 N1）**：`src/localStore.ts` 是全站**唯一** import `data/products-seed` 的文件（实测 grep 仅 1 命中），四个数组读出口里 `getLocalCategories()` 是唯一直返模块引用的（其余三个都过 `cloneArray`）⇒ 任何一处原地 `sort/push/splice` 就把整个会话的分类种子改掉。改后补 3 条用例（新容器 / 原地改动后种子不变 / 连续两次读不同引用），反例实跑：改回直返 → **3 条全红**，复原后 32/32。
- **M1 CHANGELOG 门禁补 push 区间**：此前 push 固定 `HEAD~1` ⇒ 一次 push 带 N 个提交只校验末位那个，"把 src 改动藏在一个纯 docs 的末位提交后面"即免门禁。现优先用 webhook 的 `before..HEAD`，`before` 缺失/全零（新建分支）/加深后仍不可达（强推）⇒ **显式告警后**回落 `HEAD~1`，绝不静默当"无改动"。三态实跑：带 before 走整段区间 ✅、无 before 回落且仍然拦下未写记录的改动、全零 before 告警回落。
- **M2 新门禁 `scripts/check-case-collision.mjs`（收第七轮 K7）**：第七轮我在 Windows 上新建 `tests/productsTab.test.tsx` 静默覆盖了已跟踪的 `tests/ProductsTab.test.tsx`（同一 inode，`git status` 只显一个 `M`），4 条在制用例没了。现按两条判据查：索引内互撞、未跟踪文件大小写不敏感撞已跟踪路径。反例在 Windows 上**造不出来**（大小写不敏感 FS 生不成两个同名文件 —— 这正是事故成因），故在仓库外临时仓用 `git update-index --cacheinfo` 造真冲突 → 精确报 `tests/Foo.test.ts ⇄ tests/foo.test.ts` exit 1；本仓实跑 OK（已跟踪 525 / 未跟踪 6）。
- **M4 视觉层进 CI + 断掉"测旧产物"的通路**：新增 `visual` job 并入 `deploy.needs`（现 4 个 needs）；`playwright.visual.config.ts` 的 `reuseExistingServer` 由 `!process.env.CI` 改**恒 false** —— 第七轮实测踩到上一会话遗留、伺服过期 `dist-e2e` 的进程被静默复用，视觉判据跑在旧产物上全绿。
- **⚠️ M4 接进 CI 当天就抓到 4 条假绿（本轮最硬的一条账）**：push `085ec34` 后 run `36218839505` 的 `visual` job **红**（4 failed），而同一轮我本地报的是"16/16 全绿"。删掉 `dist-e2e` 强制重建后本地**同样 4 红** ⇒ 证实我那次 16/16 正是跑在过期产物上，**上面那条"断掉测旧产物的通路"的改动自己先验了一遍价值**。四条的根因同一条：`d598cf8`（上一轮）删掉东鹏特饮等 4 条饮品聚合组与康师傅 8 口味色块组，`p_16` 退化成单图（无缩略图列、无左右箭头）、全站再无 `kind:'color'` 轴，而这三条视觉判据仍锚在被删数据上；当时只删了对应的一条 playwright e2e，这三条因 `test:visual` 不在 CI 而无人看见。另 `loading` 那条是**代码对、断言旧**：`ProductGallery` 主图刻意 `eager`（首屏 LCP 元素设 lazy 会自己拖慢最大内容绘制），测试还写着 `lazy`。
- **四条的处置（按"先修判据、不改数据凑绿"，但这次是判据该追代码/追现实）**：`:45` 两栏并排与 `:218` tap-44 角标定位**重锚到白象 46**（`variants-demo.ts` 里唯一仍存跨记录聚合组、确实会长出缩略图列与箭头），并给 `:45` 的缩略图列补一条 `toBeTruthy()` —— 否则元素缺失时它会退化成空转真；`:176` 断言改 `eager` 并注明 WHY；`:169` 色块上色**改 `test.skip` 而非删除**（判据有效、缺的是驱动数据，下一份带色块的商品数据上线时解除 skip，已登记 `memory/07-next-steps.md`）。重跑：**15 passed / 1 skipped / 0 failed**。

- **新增安全守卫（转 public 的连带后果）**：`d1-backup.yml` 此前注释写"导出物进 artifact（私有仓内）"，而仓库 2026-09-25 晚已转 public。实测判别：未鉴权取 artifact zip **REST `401` / web UI 路径 `404`** ⇒ "公开仓 artifact 任何人都能下"这一常见说法在本机当前形态下不成立；但 public 仓给所有人 read 权限，**任意已登录 GitHub 用户**可读走全库明文导出物。故加 fail-closed 守卫：配了 `CF_D1_BACKUP_TOKEN` 而仓库非 private ⇒ 在导出**之前**响亮失败，并写死两条出路（转回 private / 先加密再上传）。当前实测该仓 0 个 artifact（token 未配），即**泄露尚未发生**，本条是拆弹不是救火。
- **N4 由"偶发慢"升级为"worker 崩且无失败断言"（本轮实测，仍未改执行模型）**：`npx vitest run --coverage` 在本机（32 线程 × 每文件独占 jsdom）出现 `FATAL ERROR: AlignedAlloc Allocation failed - process out of memory`，症状是 **`Test Files 62 passed (62)` / `Tests 625 passed (625)` 却 exit 1**，且少收一个文件 —— 即"全绿但 job 红"，比第七轮记的 5s 超时更难归因。5 连跑（不带 coverage）0 失败、wall time 6.26–13.63s（首轮冷启 13.63s）。按台账既有约束（执行模型改动单独一轮评估、不得用抬 timeout 掩盖机制缺陷）本轮**只量不改**，候选与数据已回写 `memory/07-next-steps.md`。
- **本轮未做（如实）**：M3 `diff-cover` 增量覆盖率 —— 本机无该工具、CI 命令无法先实跑，按"未验证的命令不得当门禁依据"与"新指标先量误报率再接线"留册；K4 PR 流试点（需用户在线决策流程变更）；K3 线上管理端目视复核（需生产密钥，转 public 后已轮换，本机 `.dev.vars` 是否为新值未实测）。
- **门禁全绿（本机实测）**：`npm run verify`（新增 4 段后）全链通过 —— 密钥扫描、lint 0 warning、大小写冲突 0、循环依赖 0 环、契约 44、文档事实 7 项、schema 漂移、license 10/10、CHANGELOG、typecheck 双配置、`verify:backend` **109/0**、Functions 编译 88,650B、体积 3/3；三层浏览器门禁 22 / 16 / 3 全过。


### 2026-09-25 追加十九（可选规格收敛：只留 4 款小包薯片口味 + 白象帮泡/零售，口味进 D1 由后台开关控显隐）

- **用户口径**（AskUserQuestion 四问一次锁定）：① 「可选规格」只指详情页那个选择器，`spec` 文案不动；② **全类目**收敛，不是只动食品；③ 保留的是「乐事薯片 / 呀土豆薯条 / 好有趣薯片 / 白象方便面的帮泡与零售 / 乐吧薯片」，口味按网查补齐，并**在后台加开关**能把某个口味去掉、前端不再显示；④ 改完直接上线。
- **动手前先纠偏三条口径**（原话与磁盘实测对不上，已按实测执行）：食品侧原本只有白象一条规格组，「其他食品一律去掉」按字面等于删 0 条；**张亮丸子与康师傅面在 D1 与代码里都不存在**（`d1 execute supermarket --remote` 实读 55 行、全库无此两条），乐事薯片也只有单条 40g 记录、原本没有选择器 ⇒ 「保留口味」实际是**新增**，不是"留着别删"。
- **删掉的**：`src/data/variants-demo.ts` 的 4 条饮品聚合组（东鹏特饮 / 康师傅 1L 茶饮 8 口味色块 / 农夫山泉 / 怡宝），只剩跨记录真实存在的白象 46(帮泡 ¥3.66)/47(零售 ¥1.88)。
- **新数据面 `products.specOptions`**（`[{label, enabled}]` JSON 文本列）：`db/schema.sql` + `db/migrate-spec-options.sql`（ALTER + 4 条口味 UPDATE + 其余归零，`rollback-spec-options.sql` 配套）；后端 `PRODUCT_FIELDS` 白名单、`rowToProduct` 回读、`getPublicProducts` SELECT 补列（不补则顾客端拿不到），新增 `sanitizeSpecOptions`：非数组归零、项必须是对象、label 去空白截 20 字、同名去重、上限 20 项。
- **口味不改价、不改图**：`src/utils/spec-options.ts` 把口味清单合成单轴「口味」变体组，复用既有 `utils/variants.ts` 纯函数与 `VariantPicker`，每个 combo 的 price/order/productName 都仍是这条商品记录本身；被关掉的口味**连组合一起消失**（不是灰掉 —— 灰掉等于告诉用户"这口味缺货"）。白象的跨记录组与它互不干扰（有组优先）。
- **后台开关（守内联编辑铁律，未加弹窗）**：`ProductInlineEditForm` 增「可选口味」区 —— 药丸即开关（`aria-pressed`，划线=已隐藏）、× 删除、输入框追加，计数只算在显示的；`src/api/fields.ts` 客户端白名单同步补 `specOptions`（**漏这一条就会让后台保存静默丢字段**，`tests/authWhitelist` / `tests/shared` 两条对称判据当场把它钉住）。
- **加购带上所选口味**：`ProductDetailPage` 的 `add({ ...cartProduct, spec: effSpec })`，购物袋与订单里是「40g · 黄瓜味」而不是光秃秃的「40g」；单价与 `_id` 仍取该规格对应的那条真实记录。
- **已知限制（如实登记，不含糊）**：① 购物袋按 `_id` 合行，同商品两个口味会并成一行（规格文案取最后一次点的）—— 这是既有 `addToCart` 语义，本轮未改；② 本地演示模式下**已播种过** localStorage 的老访客不会自动补 `specOptions`（P1-4 明令"只有键不存在才播种"），云端顾客端不受影响；③ `VariantPicker` 的 `kind:'color'` 色块轴随康师傅组删除而**暂无生产数据**，对应的那条 e2e（内联上色）一并删除，`variants.test.ts` 里的色块判据变为空转真——留着，等下一个色块数据。
- **新判据**：用例 631（上轮账面）→ **654**（本轮实测，63 个文件）。`verify:backend` 断言 102 → **109**（+7：口味透传可回读、20 项截断、label 归一、`enabled:false` 原样落库、非对象项丢弃、`getPublicProducts` 下发口味、非数组归零）；`tests/variants.test.ts` 新增「本轮口径」describe（带口味的商品**恰好**是 33/34/40/52、饮品分母由分类枚举得出且带 `>20` 反向断言、聚合层只剩白象 46/47）+ 6 条 specOptions 行为用例；`tests/inlineEditForm.test.tsx` +4 条开关用例；e2e `product-detail.spec.ts` 14 条含「口味不改价」「所选口味写进购物袋金额」「饮品不再长出选择器」。
- **踩到并修掉的真实缺口（由新判据抓出，非人工评审）**：`sanitizeSpecOptions` 一开始只挂在 `applyProductUpdate`，`createProduct` 里 `data.enabled = ...` 夹在 `pick` 与 `sanitizeStock` 之间，使批量替换只命中一处 ⇒ 新建商品时脏口味清单原样落库（`verify:backend` 报"实际 26"）。教训：批量补丁的命中数必须核对，锚点前后各插一行时尤易漏。
- **门禁全绿（本机实测）**：`verify:backend` 109/0、`vitest run` 654/654、Playwright 22/22（含 e2e 复跑）、`typecheck`、`lint` 0 warning、`check:schema-drift` 17/0、`verify:contract` 44/0、`check:size` 3/0、`check:cycles` 无循环、`vite build` 成功。
- **生产 D1 迁移已执行（发版被 CI 卡住，但数据面已就位）**：先 `d1 export --remote` 全量备份（1,449,663 B / 949 条 INSERT，落外层 `_backup/`），再 `node scripts/migrate.mjs apply --remote --yes`（走 `schema_migrations` 账目表，**不是** skill §4 那条裸 `d1 execute --file`——裸跑会让账目以为没应用，下次重放必炸 duplicate column）；线上回读 33/34/40/52 带口味、其余含全部饮品为 `[]`，`/pub getPublicProducts` 仍 200/28 条无回归（旧后端不引用新列 ⇒ 当前是一致可用状态）。
- **两端前端未发版（如实记账，不写成已上线）**：push `d598cf8` 后 run `36125547534` 三 job 全 0-step、`dispatch.yml` run `36125547517` 同样 0-step ⇒ pages.dev 与 github.io 仍是旧构建（顾客端暂时看不到口味、也还看得到饮品规格选择器）。按 `docs/ci-triage-runbook.md` §4.3「不等 CI 也要交付的两条路都要用户点名」执行：用户选「先查清为何不给 runner」，未走本地绕过通道。
- **顺带把停摆归因从"只能开浏览器看红条"升级为 API 硬证据**：失败 job 的 `check_run_url` + `/annotations` 直接给出原文 —— *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* ⇒ 账号计费/消费上限，与本月分钟数（57.6%）和本次提交都无关。`scripts/ci-status.mjs` 已内置（exit 3 时打印「平台原文」行，`--json` 落 `blockedBy` 字段，取不到只记 UNVERIFIED 不改判类），runbook §2 ⑤/§4.2 与 `memory/07-next-steps.md` P0 同步更正。
- **同轮自我翻案（重要，别当已解决）**：上面那句"与本月分钟数（57.6%）无关"是**错的**。登录态浏览器实测 `github.com/settings/billing` Actions 面板：`2,000 min used / 2,000 min included`（100% 红）、`Billable usage $0 = $22.23 consumed − $22.23 discounts`、`limits reset in 6 days`、`Next payment due = -` ⇒ **真因是 Free 计划分钟用满，且并没有欠费**。逐 job 累加之所以算成 57.6%：只统计了已完成 run，**漏算 cancelled run 与超额计费分钟**。已同步改回三处（`docs/ci-triage-runbook.md` §2 ⑤/§3、`memory/07-next-steps.md` P0 新增翻案条、全局记忆 `reference-github-actions-zero-step-jobs.md`）+ `chaoshi-web-deploy` 坑 39 追加更正。**纪律**：账号级用量只认 Billing 页；`admin:billing` 读不到时"读不到"不等于"反证成功"。`rerun-failed-jobs` 已实测（201 → attempt=2 仍 3 秒 0-step）⇒ 非瞬时，需等重置 / 抬上限并加支付方式 / 临时转公开三选一。

### 2026-09-25 追加二十（解停摆：先作废泄露密钥 → 仓库转公开 → CI 恢复）

- **停摆解法选了"转公开"**（用户拍板）。动手前实测发现**不能直接转**：`git log --all -S<真值>` 命中 **10 个提交**的 diff 含生产后台密钥真值，最早在 **`wrangler.toml` 的 `[vars]`**（`4034aff` 2026-09-18 才把文档明文改成掩码）。HEAD 树干净、`.dev.vars`/`.env` 均未跟踪，但**历史 blob 抹不掉** ⇒ 直接公开等于把后台密钥交出去（可改价、删单、读订单里的房间号/微信号）。
- **顺序：先让泄露值作废，再公开**（用户批准"先轮换再公开"）：① 生成新随机密钥 → `wrangler pages secret put ADMIN_KEY`（Success）；② **立即重部一次**让新 secret 生效（Pages 的 secret 是部署时注入，坑 19）——`rm -rf dist` + `npm run build`（新 `CACHE_VERSION sm-v1790337036424`，产物含 `specOptions`）+ `wrangler pages deploy dist --commit-dirty=true` → `09c4e1d2.supermarket-web.pages.dev`；③ 同步本地 `.dev.vars`；④ 全树 `scan-secrets` 通过后才 `PATCH {"private":false}` 转公开。
- **线上复验（不是推断）**：新密钥 `/web login` → `{"code":0,"role":"admin"}`；**旧密钥 → `{"code":-1,"message":"认证失败"}`**（泄露值确认作废）；`/pub getPublicProducts` 28 条上架、乐事 8 个口味首项「原味」；`sw.js` 指纹 = 本次新构建。
- **CI 恢复实证**：转公开后 `workflow_dispatch` 触发 run `36132121389` = **success**，`build-and-test` 22 steps / 46s、`e2e` 10 steps / 63s、`e2e-cloud-stub` 10 steps / 53s ⇒ **公开仓拿得到 runner**，与"分钟耗尽"结论一致。但 `deploy` = `skipped` —— 该 job 只认 `push`，dispatch 不触发部署 ⇒ 本轮改用"提交 + push main"走完整链路（CI 自动部 pages.dev，`dispatch.yml` 再驱动 github.io 顾客端构建）。
- **仓库可见性已变更**：`supermarket-web` 现为 **public**（原 private）。本仓文档、部署 skill 与 `memory/AGENTS.md` 里"私有仓 / 未认证 API 一律 404 / `DEPLOY_SOURCE_TOKEN` 跨仓取私有源码"等表述自此**部分失真**，已另行更正；`ADMIN_KEY` 真值只存 Pages secret 与本地 `.dev.vars`，文档一律掩码。
- **处置链已抽成跨仓工具**（用户点名"可复用吗→抽成小工具"）：`焚诀/eval/gh_ci_unblock.mjs`，子命令 `status`（分诊 + 取 annotations 原文）/ `audit`（**转公开前置**：HEAD 树 + 全历史密钥形态扫描，只报计数与路径不打印值，判 `PUBLIC_SAFE`/`NEED_ROTATION`/`ROTATED_ACK`）/ `unblock`（审计当硬前置，脏则拒翻 public）/ `--selftest`。退出码 0/1/3/4 分开，取不到数据一律 4。六条隔离桩全过，过程中抓到三个**假阴性** bug：`git grep` 把 `-` 开头的模式当选项吞（改 `-e`）、`git log -G` 默认 BRE 使 `{8,}` 失效（改 `-P`）、真实键名大写而模式小写（补 `-i`，实测同一仓 0 命中 → 10 命中）。实扫：本仓报 `generic-kv` 历史 10 个提交（与手工 `-S` 一致）+ 当前树 1 个（`verify-backend.mjs` 的测试夹具键，属误报，由人 `--ack-rotated` 定性）；`fenjue-private-archive` 457 提交零命中、`status` 显示其 5 个 job 仍 0-step 并取回计费原文 ⇒ 该仓可安全转公开，但**未动**（属另一项目的决定）。本文件 §2 已加指针。
- **顺带记一起并行事故**：工具的 `git add` 完成后，被另一会话**未带 pathspec** 的提交 `b8d6917` 吸收并推送，作者侧独立提交因此报 "no changes added"。内容零丢失，故只补归属留痕、不重写他人历史。教训入文件头：共用仓里 `add` 与 `commit` 必须紧邻且带 pathspec。


### 2026-09-25 追加十八（防线轮 K1+K2：门面故障路径进断言 + 真渲染接成可拦部署的 CI 门禁）

- **这轮不改界面**，改的是"出问题的时候谁知道"。三块门面（`src/auth.ts` 16%、`src/api/client.ts` 9.5%、`src/localStore.ts` ~53%）是所有云端读写的唯一出口，此前**超时/非 JSON/`code` 缺失/网络抛错四类真实故障路径一条都没断言过**。
- **K2 接的是真浏览器层**：`build:stub`（生产构建 + `VITE_CB_API_BASE=/web` 走云端模式）+ 假 `/web` `/pub` 桩 + Playwright 访 `#/admin`，断言看板四张图各自真的建出了 canvas 且全程零未捕获异常。此前这条路径**只有人工开过 localhost:5182 一次**，全仓没有任何代码断言过 canvas 尺寸，四个浏览器 spec 的 `pageerror`/`console` 也只 `console.log`、从不 `expect`。
- **⚠️ 修掉一处"判据假安全感"的账目错误（本轮实测）**：CHANGELOG 与 `ci.yml` 注释自 2026-09-24 起写着「移除 continue-on-error 使 `e2e` job 具备阻断力」—— 实际 `deploy.needs` 从来只有 `build-and-test`，**`e2e` 红了照样部署**。文案承诺的能力在磁盘上不存在。本轮把 `needs` 改为 `[build-and-test, e2e, e2e-cloud-stub]`，这才是那句话第一次成立。
- **两处真实缺陷（写失败/抛错时缓存不失效）**，做 K1 时必然撞出来、经批准当场修：
  - `src/db/reviews.ts` 三处失效写在成功分支里：`addReview` 的 `cacheDel` 关在 `if (result.code === 0)` 内；`addCloudReview` 在 :86 抛错**早于**其后的两次 `cacheDel`；`deleteCloudReview` 抛错早于全清。⇒ 请求已落库但响应丢失/超时时，评价脏读满 60s（`CATALOG_CACHE_TTL`）。
  - `updateOrderStatus` / `deleteOrder` 的云端分支**完全没有失效**。
  - 收口方式是把 `src/auth.ts` 已有的 `finally` 语义上提成 `catalogCache.withCacheInvalidation(fn, invalidate = clearCatalogCache)`。评价侧**必须传精确键**：直接复用全清会把商品/分类缓存一起抹掉，那是过度失效（60s 内所有顾客端读多打一次云函数）。缺陷是"时机"，原本的失效"范围"是对的。
- **纠正我自己的一处误判**：原以为脏读面是后台的「缺货/低库存」角标。实测 `getAdminProducts()`（`src/db/products.ts:86-91`）**根本没有接缓存**，角标一直新鲜；真正会脏的是**顾客端库存显示**（`getProducts()` 把含 `stock` 的 `getPublicProducts` 载荷缓存进 `publicProducts`，而订单状态变更在服务端改 `products.stock`）。修法不变，但描述必须按实测写。
- **新判据**：用例 560 → **631**（60 → 63 文件）。新增 `tests/apiClient.test.ts` 26、`tests/localStore.test.ts` 29、`tests/authWriteInvalidate.test.ts` 8，另扩 `catalogCache` +3、`dbReviews` +5；加 Playwright `tests/e2e-stub/dashboard-cloud.spec.ts` 3 条（不在 vitest 口径内）。
- **反例自证 18/18**（一次性变异脚本，产物建在仓库外）：每条判据都配一个"朴素/回退"变异体并实跑，全部变红才允许通过 —— 含 `finally` 退回仅成功失效、撤掉 order 包裹、reviews 三处退回原缺陷写法、去掉 `AbortError` 映射、去掉 `res.json().catch` 兜底、去掉 `typeof code === 'number'` 判定、AI 超时退回 15s、去掉 `cloneArray`、播种判定退回 `length === 0`、`rating` 去掉未填默认等。K2 另跑两个变异（把 `core.use` 退回喂零 export 的深路径模块 = 复现 19 天前那起事故）：canvas 判据报「宿主内没有 canvas（静默空白回归）」，`pageerror` 判据**单独也变红**并报出事故原句 `e.install is not a function`。
- **写自己的脚本踩到的坑（已修，记为纪律）**：还原时用文本模式 + `newline=''` 写文件，把三个 CRLF 源文件整体转成 LF，`git diff` 一度显示 `localStore.ts` 206/206 全文件重写（我根本没改过它）。⇒ 变异/补丁类脚本必须**二进制读写**，并把"还原后 sha256 一致"当作硬退出条件（本次正是这条自检抓到）。修完 `localStore.ts` 回干净，其余两个文件回到真实小 diff。
- **顺带证伪三条待办/口径**：①「其余 GitHub Actions 待 pin 到 SHA」不成立，13 处 `uses:` 全是完整 SHA；②「4176 端口 `reuseExistingServer` 静默复用旧构建」是**本机专属**风险（CI 下该项恒为 false），且本轮 `test:visual` 未接 CI，故从 P0 降为本机注记；新配置反过来把该项设为**恒 false**（宁可响亮失败也不测旧产物）。③ 本机实跑撞到 5182 被上一会话遗留的桩进程占着、且伺服的是改动前的旧 `dist-stub` —— 正是这条判据要防的场景，停掉进程后由配置自建产物才继续。
- **新发现（本轮未修，已登记 07）**：① `getLocalCategories()` 直返 `seedCategories` 模块引用（唯一没走 `cloneArray` 的读出口），当前三个调用方都只做 `setState`、全站 `sort` 都用 `[...list].sort()`，所以**不是活缺陷**，但将来任何一处原地排序就会污染整个会话的种子；② `verify:changelog` 比的是 `HEAD~1..HEAD` 提交边界、不看工作区，因此一次 push 多 commit 时只有最后一个 commit 受检（本轮为此刻意单 commit）。
- **新增用例撞出的既有脆弱点（已按"分档"处理，未掩盖机制）**：`tests/prefetchBus.test.ts:116`「13 条路由全部登记」在我加完 3 个测试文件后，于**全量 `--coverage`** 下报 `Test timed out in 5000ms`（单文件跑稳定通过，`npm test` 不带覆盖率也通过）。归因：该用例真实 `await import()` 页面块，是冷模块加载而非纯逻辑断言；vitest 默认 5000ms 是**墙钟**，而每个测试文件独占一个 jsdom（实测 63 个、占总时长 29–55%）+ 覆盖率插桩让耗时随机器负载漂。CI 跑的正是 `npx vitest run --coverage` ⇒ 不处理就会随机打红部署链。
  - 做法：只给这**两条**冷导入用例显式 20s 档（附 WHY 注释），**没有**改全局 `testTimeout`（全局放宽会把别处的真缺陷一起盖掉）。改后连跑三轮全量 `--coverage` 全 exit=0、631 用例，零 timeout。
  - 未顺手做的治本项（已登记 07）：`pool: 'vmThreads'` 或 `isolate: false` 复用 jsdom —— vitest 自己每次都在结尾提示这条。属全局执行模型改动，隔离语义有风险，留待单独一轮评估。
- 覆盖率（分母钉死 `src/**`）：statements 77.49 → **80.91%**、branches 71.77 → **74.08%**、functions 73.30 → **76.41%**、lines 79.05 → **82.52%**；棘轮上调 **78/72/74/80**（= 实测 −2pp 下取整）。branches 三跑实测 74.08 / 74.08 / **74.12**，差 1 条分支 —— 这 2pp 余量是给 CI(node22/ubuntu) 与本机(node24) 留的，不是保守。
- **CI 分诊知识固化为仓库资产**（本轮实测反哺，非补记）：
  - 新增 `scripts/ci-status.mjs`（npm 入口 `npm run ci:status`）——自动把失败 run 分成 **真判据红（job 有 step）** 与 **账号级 0-step 秒红（无 step 且 ≤12s = runner 从未分配）**，退出码 `0/1/3/4` 各对应"绿/去修代码/别改代码绕/取不到数据"。**取不到数据一律显式报错，不静默 PASS**（R247）。
  - 新增 `docs/ci-triage-runbook.md`：症状→结论对照表、四条可直跑的排除命令（含"计费必须逐 job 累加，按 run 墙钟低估 1.46x"这条）、判定账号级后的处置顺序（禁止 `continue-on-error`、禁止拆 `deploy.needs`、禁止注释判据）、以及 push 后自动检测的 hook 接法（脚本已备好，配置在用户本机）。
  - `AGENTS.md` 权威文档节加第 4 条指针（保持薄指针，正文在 runbook），`memory/06-constraints.md` 记一条技术债：私有仓 Actions 是计量资源且存在账号级停摆形态。
  - 动机：本轮排查耗时远大于改代码，且我第一版把"墙钟求和"当用量得出 64% 的近似数、node 原生 fetch 不走代理导致结果全 NaN —— 这类判断每次手写都会错，必须固化成工具。
- 后端与数据层**零改动**（`functions/`、`db/`、action 名单、`ADMIN_WRITE_ACTIONS` 全部未动 ⇒ `verify:backend` 契约与白名单对称测试不受影响）。


### 2026-09-25 追加十七（order 20 生产品名去促销语：一次带双向空跑的生产写）

- **改了什么**：`UPDATE products SET name='猎兽功能饮料' WHERE "order"=20` —— 线上正式品名原为「猎兽功能饮料（亏本卖）」，促销语进了品名，会被阶段二的大图卡片放大展示。只动 `name`。
- **为什么不能走 seed**：`src/data/products-seed.ts:61` 的 name 本来就是干净的，但 `price` 是 2.33，而生产 `price=1.5` 是真实售价 —— 任何"用 seed 重灌"都会把售价改错，所以这次是一次**只动名称的受控写**。
- **写入过程**：先只读回捞原值（`_id=p020, name='猎兽功能饮料（亏本卖）', price=1.5, enabled=1`）→ 落 `db/adhoc-rename-order20.sql` 与 `db/rollback-rename-order20.sql`（沿用仓内既有 `migrate-*/rollback-*` 成对约定）→ 在**本地 D1 副本**上双向往返空跑（改→新名、滚→原名，price 两次都仍 1.5）→ 才 `--remote` 执行。
- **空跑抓到的自己的错**：第一次 rollback 空跑 `exit 1` —— 我当时只在计划里写了"回滚文件先落盘"，实际根本没建那个文件。**先写后验**这条纪律在这里救了一次：否则直到真出事要回滚时才会发现回滚是空的。
- **复验**：`total=55`（行数未变）、`name LIKE '%猎兽%'` 命中数 `=1`（无越界改行）、`n20='猎兽功能饮料'`、`p20=1.5`、`e20=1`；顾客端实际调用的 `POST /pub getPublicProducts` 返回 `{"name":"猎兽功能饮料","price":1.5}`（28 件上架数不变）—— 名称运行时取自 D1，**无需重新部署即已对外生效**。
- **过程中的工具坑（观测为真、成因未定，勿当规律引用）**：一次 `grep -n "猎兽" src/data/products-seed.ts` 返回 0 命中，而紧随其后用 ASCII 模式（`order: 20` 加 `-B4`）看到该串确实在第 61 行；事后再单独复跑同一条中文 grep 又正常命中（rc=0）。**即这是一次未归因的偶发空结果，不是"中文 grep 必然失效"的稳定规律**（成因候选：多字节模式经工具链传输被截断，未证实）。可复用的结论只有一条判据：**任何以"0 命中"为前提的结论，必须换一个 ASCII 锚点复核后才允许下**，尤其是中文模式与 `| head` 组合时（管道还会顺带吃掉退出码，见坑 #9 同源）。

### 2026-09-25 追加十六（阶段二三项遗留的处置：图区统一底板 / 商品地址跨环境可寻址 / 品名促销语）
- **① 素材底色不一致 → 纯 CSS 统一图区**：新增 `.gallery-figure`（中性暖灰 `#f6f5f2` 底板 + 顶部高光 + 底部内阴影），图片改 `mix-blend-mode: multiply`。原理是白底素材的白色部分与底板相乘后等于底板色，白边直接消失；深色/场景底素材则被同一块台面"接住"，不再形成硬边黑方块。实测截图确认整排卡片明度基调一致，且**未裁切任何包装信息**（仍 `object-contain`）。代价是极暗素材略微更沉，换来整排一致性。新增一条视觉判据钉住"全站共用同一块底板 + 图片确实参与 multiply"，防止以后被改回逐卡 `bg-white`。
- **② `/product/p_16` 线上打不开 → 三级寻址**：`_id` 命名按数据来源不同（本地模式 `p_<order>`、D1 种子 `p001` 三位补零、管理端新建 `p_<36时间戳><随机>`），从某一环境复制出的链接在另一环境必然 404。`ProductDetailPage` 的寻址改为：① `_id` 精确 → ② `order` 十进制串 → ③ **仅当形如 order 时**归一（`p16`/`p_16`/`p-16`/`p016`/零填充裸数字）。
  - **第 ③ 级必须收窄，不能一律剥非数字**：`p_mufyndudcyu1ji` 剥掉非数字会得到 `"1"`，若直接按它匹配会**静默渲染出 order 1 的另一个商品** —— 比干净地报「商品不存在」糟糕得多。已加一条反向用例专门钉这个：目录里同时放 order 1 与 order 12，喂随机 id 必须落到「商品不存在」，两个商品都不许出现。这条用例对"朴素剥数字"实现是**会失败**的，属真回归锁。
  - 归一在第 ① 级之后才生效，所以同环境内的正常链接（商城卡片、相关推荐都由 `product._id` 生成）行为完全不变。
- **③ `order 20` 品名含促销语「（亏本卖）」→ 本轮不改，只登记**：这**不是前端能修的**，也不是 seed 能改的 —— 实测线上该行 `name='猎兽功能饮料（亏本卖）'`、`price=1.50`，而 `products-seed.ts` 是 `'猎兽功能饮料'`、`2.33`。**D1 与 seed 在名称和价格两处都已漂移，且线上价格才是实际在卖的价格**。用 seed 去"纠正"线上会把真实售价改错，属数据破坏。
  - 正确路径是一次受控的生产库更新：`UPDATE products SET name='猎兽功能饮料' WHERE "order"=20;`（**只动 name，绝不动 price**）。按项目红线，任何 `d1 execute` 前必须先加载 `chaoshi-web-deploy` skill，且这是对在营门店商品记录的写操作，**等用户明确点头再执行**，本轮不擅自写生产库。
  - 前端侧已做的兜底：卡片品名是 `line-clamp-2`，长名会折两行而非撑破卡片，不会把网格挤坏。
- 用例 551 → **560**（`+` 归一参数化 7 例、随机 id 反向锁 1 例、裸数字命中 1 例）；`test:visual` 15 → **16**。覆盖率 statements 77.1%、branches 70.9%、functions 72.8%、lines 78.6%，棘轮 76/70/72/78 未动。
- 门禁：`npm run verify` 全链绿、`test:visual` 16/16、`test:e2e` 20/20。**后端与数据层零改动**（本文件 ③ 项只是登记待办，未执行任何 D1 写）。

### 2026-09-25 追加十五（/shop 阶段二「暖白画廊」：图片当主角，两端各自设计）
- **主张**：把商城从"带小图的清单"改成"图注式画廊"。旧卡是 56px 缩略图 + 文字横排，图只是个符号；新卡 1:1 满幅白底图占卡片约七成高度，文字退成图注。用户口径为「大改视觉风格 + 两端各自设计 + 连带详情页」。
- **两端各自设计，且是 JS 条件渲染不是 CSS 隐藏**：手机（<1024）顶部横条 + **双列**大图；桌面（≥1024）**左侧竖排分类栏 + 刊头 + 四列画廊**。沿用详情页那条已验证教训 —— 同名操作在 DOM 里留两份会让读屏念出重复主操作、Playwright 严格模式直接失败。断点判定抽为 `src/hooks/useMediaQuery.ts`（详情页的本地 `useIsNarrow` 一并迁入，两页共用一份实现）。
- **一个由真实数据逼出来的设计决定**：上架 28 件里「农夫山泉矿泉水」和「怡宝矿泉水」**各出现两次，只有 `spec` 能区分**（1.5L vs 550ml / 2.08L vs 550ml）。所以规格从旧版的品名括号附注**提升为独立一行**，并加一条视觉断言钉住"规格不得退回括号"。
- **修掉一个真实的对比度缺陷**：价格原先用 `brand-600` (#ca8a04)，对白底只有 **2.82:1**，连 AA 大字标准 3:1 都不过。改 `brand-700` (#a16207) 后 **4.79:1**，正文级也达标；商城与详情页两处价格同步改，并新增机器判据（读实际计算样式算相对亮度，不靠肉眼）。
- **顺手修掉阶段一列过但当时没动的 G2 面包屑**：详情页原先硬编码「首页 › 生活 › 零食饮料」，而 `categories` 早就加载了却没用。改成按商品真实分类派生后，实测 order 16 → `首页 › 饮品 › 提神`、order 24 → `首页 › 饮品 › 矿泉水`，两级链接直接指向阶段一做好的 `/shop/:categoryId/:subId` 深链 —— **面包屑第一次真的能点回去**。生产构建产物里 `零食饮料` 字符串命中数归零。
- **测试契约的刻意变更**（不是回归）：`productDetailVariants.test.tsx` 面包屑断言由 `['/', '/category/life', '/shop']` 改为 `['/', '/shop/drinks', '/shop/drinks/energy']`，并反向断言 `零食饮料` 不再出现；`e2e/product-detail.spec.ts` 那条「可导航回 生活 › 零食饮料」改为验证真实分类 + 落地后子类筛选按钮 `aria-pressed=true`（防止深链跳过去却没过筛）。
- **补了一个"判据假安全感"的洞**：jsdom 没有 `matchMedia`，`useIsNarrow()` 恒为 false ⇒ 原 548 条用例**全部只跑到桌面那一套 JSX，手机端布局零覆盖**，而这个项目的主战场恰恰是微信内手机。新增 3 条打桩 `matchMedia` 的窄屏用例（无桌面刊头、只有一个导航实例、双列网格、子类滑轨全量渲染）。
- **我自己写错又改掉的一条判据**：桌面侧栏"不喧宾夺主"最初写成 `nav.width < firstCard.x * 0.6`，但 `firstCard.x` 含页面左内边距，等于把 padding 算进侧栏宽度（实测 208px 侧栏在 1440 屏只占 14%，却被判失败）。改为直接量侧栏占视口比例 `< 25%`。**这是改判据不是放宽判据** —— 原度量本身是错的。
- 用例 548 → **551**；覆盖率 statements 77.04%、branches 70.86%、functions 72.77%、lines 78.59%（棘轮 76/70/72/78 未动，四项仍在上）。
- 门禁全绿：`npm run verify` 全链、`test:e2e` 20/20、`test:visual` **10 → 15** 例（新增 5 条 /shop 判据：桌面并排、手机双列无溢出、平板三列、价格对比度过 AA、同名商品靠规格可区分）。**后端与数据层零改动**。
- **遗留（如实记，未处理）**：新画廊把**素材底色的不一致**放大了 —— 部分商品图是白底抠图（熊博士、好多鱼、彩虹糖），部分是深色或场景底（士力架黑底、乐事深灰底、呀土豆红底、卫龙木纹），四列并排时深浅方块交错。这是商品图本身的问题而非布局缺陷，`object-contain` 无法在不裁切包装信息的前提下统一它。要根治只能换白底抠图素材或做统一底板，属阶段三候选。

### 2026-09-25 追加十四（商品名错别字修正 + 纠正上一条对线上数据的误判）
- **错别字**：`src/data/products-seed.ts:88` 「光头**哇**一根葱」→「光头**娃**一根葱」。依据是本轮搜图时拿到的实物包装图，袋上印「光头娃」注册商标。以 seed 文案去搜会漏，以包装实际字样才搜得到。
- **`db/seed.sql` 未同步改**：该文件由 `db/gen-seed.mjs` 生成且**早已过期**（`_id` 用 `p001` 三位补零、缺 order 53–54），单独手改一行只会让它与 seed.ts 的偏差更难察觉。要重生成就得整文件重生，属另一件事，本轮不动。
- **线上同名行未改**：D1 里 `p041` 的 name 仍是「光头哇一根葱」，改它是一次**生产库写入**（须先加载 `chaoshi-web-deploy` skill）。且该商品 `enabled=0` **已下架**，顾客端看不到，所以本轮不单独为它跑一次生产写，留待与后续批量数据整理合并。
- **⚠️ 纠正追加十三里我的一处误判**：追加十三之后我在会话中一度报告「线上从 49 个商品掉到 28 个，疑似数据漂移」——**该说法错误**。实测 `_backup/d1/supermarket-2026-09-24-round2.sql`：products 表共 **55 行、order 1~55 无缺口，其中 `enabled=1` 28 行、`enabled=0` 27 行**。那 27 个「线上查不到」是**主动下架**，不是数据丢失。教训：`/pub getPublicProducts` 的 SQL 带 `WHERE enabled = 1`，**用它反推"商品不存在"必然得出错误结论**，判断存在性必须看全量转储或管理端 `getProducts`。
- **该误判对追加十三的直接影响（如实记账）**：本轮替换的 9 张图里，`9 13 21 36 41 54` **六个对应商品均已下架**，顾客端当前看不到；真正线上生效的只有 `6 17 53` 三张。图本身仍是净收益（换成了规格体检通过的干净单件图，重新上架即可用），但**追加十三「商品图治理」的实际对外效果被高估了**，在此更正。
- **两个待办的收敛**：`order 51`（东鹏补水啦 900ml）经查 D1 `enabled=0` 已下架，**无需再找图**，该待办关闭；`order 20`（猎兽，上架，线上商品名为「猎兽功能饮料（亏本卖）」）三轮共 24 张候选全部为手持实拍/背标成分表/「100%赢现金红包」促销图/标签展开图，**全网确无干净白底素材**，维持原图。
- 门禁：`npm run verify` 全链绿（seed 商品名变更不影响 `variants.test.ts` 的逐字段对账，该组断言覆盖的是 order 16-18/1-6/24/27/25/29/46/47，不含 41）。

### 2026-09-25 追加十三（商品图治理：11 张问题图重做 9 张，检索链路换源后跑通）
- **问题重新定性（比"水印"更严重）**：逐张目检 11 张后确认，真正的对外风险只有 2 张竞对平台标识（`6` 京东狗+「近30天官方直补超低价」、`36`「苏宁超市 suning.com」）；**占多数的是「图文与售卖单位冲突」6 张** —— 图上印着 `500ml*15瓶`/`1L*12整箱`/`到手共4瓶`/`12瓶`，而商品按单件 ¥2.33~4.88 售卖，顾客看图无法判断买的是箱还是瓶。这属于"文案与实际行为一致"的违反，优先级高于美观。余 3 张（`13/20/41`）是品牌自家广告语，无单位冲突。
- **纠正一条错误记录（追加不改写，故在此更正）**：追加十一第 21 行称「仓库 `public/images/` 那 55 张是商家自拍实拍图」——实测不成立。抽查 5 张即见 `6` 带京东促销横幅、`36` 带苏宁水印、`20` 是带「可口可乐」logo 的品牌海报、`41` 带「色泽金黄 清新诱人」广告语。这批图本身即取自别家电商详情页，**版权暴露早于"再去找图"**。原文保留不改，因其在记录当时为撰写者的真实认知。
- **换检索源后跑通**：追加十一放弃联网搜图，是因为只试了 Wikimedia Commons（只命中街拍）与通用检索（全是素材站）。本轮改走 `chaoshi-image-optimization` Step 3 的**必应图片 `murl` 提原图**链路，实测每个商品可取 8 张 ≥750px 候选，其中确有干净的单件白底图。
- **规格体检拦下 4 类串图（缩略图上看不出来，必须全尺寸读净含量）**：① `9` 首轮最佳候选放大后是 **250ml**（商品 500ml），换关键词重搜第三轮才拿到 500ml 版；② `6` 候选标 `330ml*6瓶`、`54` 候选标 `330ml*6瓶`、`51` 候选标 `555ml`——同品牌同口味不同规格；③ `36` 候选是「浓香茄汁味」（商品是蜜香鸡翅味）、`54` 两条候选串成「茉莉**清**茶」（那是 order 53）、`9` 候选串成「康师傅 蜜桃乌龙茶」（品牌都不对）；④ `41` 有 3 张是**另一个厂家「甘师傅」的一根葱**（同品名不同厂）。
- **竞对平台标识做进检索层**：候选过滤直接拉黑 `suning` / `360buy` / `imgservice.suning.cn` 等 host，`6/9/53` 三处命中被自动排除，不再依赖事后目检兜底。
- **结果**：11 张中 **9 张已替换**（`6 9 13 17 21 36 41 53 54`），全部经全尺寸体检确认品牌/产品线/口味/净含量与 `products-seed.ts` 的 `spec` 逐字一致。**`20`（猎兽）与 `51`（东鹏补水啦 900ml）两轮检索仍无合格候选**——猎兽全网只有手持实拍与背标成分图，补水啦主流素材是 555ml/1L 且普遍带「¥34.95 起」「多种口味畅快补水」等广告构成，**按"宁可保留现状也不引入错图"原则维持原图**，不降级用生成图顶替。
- **产物口径**：新源图统一 `scale=800:800:force_original_aspect_ratio=decrease` + 白底 pad（**只缩不放**：`9`/`54` 原生 658px 保留原生清晰度补边，不放大），整图 `-quality 80`、`sm/` 400×400 `-quality 75`，与既有 corpus 实测参数（顶层全 800×800 VP8、`sm/` 全 400×400）对齐。
- **回滚**：9 张旧图含 `sm/` 副本共 18 个文件已移出 `public/`，落在 `archive/images-replaced-2026-09-25/`（`{order}_old.webp` + `sm/sm_{order}_old.webp`）；`public/` 内不留 `_old` 副本（否则零引用旧图照样被打包分发）。
- **顺带发现的数据质量问题（未改，待裁决）**：`products-seed.ts` 的 order 41 写作「光头**哇**一根葱」，包装实物印的是「光头**娃**」——商品名错别字，会直接影响顾客搜索命中。
- 门禁：`verify:images` **54/54、100%、0 无效**；`npm run verify` 全链绿（548 用例 / lint 0 警告 / `verify:backend` 102/102）；`test:e2e` 20/20、`test:visual` 10/10。**代码层除追加十二的结构重构外，图片替换本身零代码改动**（URL 由 `order` 派生，换文件即换图）。

### 2026-09-25 追加十二（/shop 阶段一：筛选态收进 URL，顺带修掉「零食页根本没有地址」）
- **范围**：用户点名重构 `/shop`，口径为「分阶段全要 / 整个 /shop / 路径参数深链 / 两端各自设计 / 大改视觉」。本条只记**阶段一（结构重构，视觉与下单链路一行未动）**；阶段二（杂志式大图 + 连带详情页）待本阶段复核后另记。
- **根因（不是"代码不好看"，是功能缺失）**：`activeTop / activeSub / search / sortBy` 四个筛选态全散在 `CustomerPage` 的 `useState`，而 `TopNav` 又自存一份 `activeTop`（原 `TopNav.tsx:14`），两边靠 `onTopChange` 单向同步。后果是**「食品›零食」这个页面在网络上根本不存在**——没有地址、刷新即回默认分类、返回丢筛选、无法分享无法收藏。
- **改法**：新增 `src/hooks/useShopFilters.ts`，分类走路径段、搜索与排序走 query（`/shop/:categoryId?/:subId?` + `?q=&sort=`）。`App.tsx` 的 `/shop` 换成 `/shop/:categoryId?/:subId?`，`routeLoaders.ts` / `prefetchBus.ts` 零改动（chunk key 不变）。`TopNav` 改**纯受控**组件，内部 `useState` 删除。
- **归一优先于报错**：URL 是可被手输的，所以三条回落写进 hook 并各配一条用例——未知 `categoryId` 回落第一个分类、不属于该分类的 `subId` 按「全部」处理、非法 `sort` 归零为 `default`。**刻意不渲染空列表**：空列表会被用户读成「这个类没货」，而真实原因是地址写错了。
- **真实缺陷①（潜伏）：loading 期整条分类导航会消失再重新挂载**。`CustomerPage` 的骨架分支传 `categories={[]}`，而 `TopNav` 遇空数组 `return null` ⇒ 数据到达后导航栏重新挂载、选中态归零，用户看到「分类条闪一下跳回第一个」。改为渲染骨架 pill + `aria-busy="true"`。
- **真实缺陷②：页头与导航高亮说的是两件事**。`CategoryPage.tsx:15` 只 `navigate('/shop', { state: { fromCategory: true } })`，**从未传过 `title`**，而页头读的是 `location.state?.title` ⇒ 恒 undefined ⇒ 回落「全部商品」，同时下方 `TopNav` 高亮的是「饮品」。现页头标题直接取 URL 命中的真实分类，并加一条断言钉住「两处文字必须一致」。
- **真实缺陷③：55 个 `aria-live` 区域**。`ProductCard` 每张卡的数量 `<span aria-live="polite">`，加一次购读屏会连播一屏数字。移除后整页收敛到 2 个（结果计数区 + 页面级 toast），并给「减数量」补上此前完全缺失的播报（原实现减数量对读屏静默）。
- **搜索框保留本地编辑缓冲**：直接把受控 `value` 绑到 URL 派生的 `q` 会让中文输入法在组合输入未完成时被回写覆盖而丢字。`draftQ` 只是编辑缓冲，URL 仍是筛选唯一真相，外部改地址（返回键/深链）由 effect 对齐。
- **`FlyDot` 拆出 `src/components/shop/`**（对齐既有 `components/product/` 约定），逐字搬运不改行为。
- **测试契约的刻意变更**（不是回归）：`customerPage.test.tsx` 不再 mock `useNavigate/useLocation`——mock 掉路由就测不到深链，改走真实 `MemoryRouter` + 与生产同形的路由表，「点浮球进购物车」由断言 `navigate('/cart')` 改为断言真路由渲染出购物车页。用例 8 → **16**；新增 `topNav.test.tsx` 8 例（该组件此前**零覆盖**）、`shopFilters.test.tsx` 14 例。
- **后端与数据层零改动**（`functions/`、`db/`、action 契约 23 个均未触碰），`npm run verify:backend` 保持 102/102。

### 2026-09-25 追加十一（「生活 → 零食饮料」两页改造：详情页变体层 + 双栏布局，顺带炸出两个潜伏缺陷）
- **范围**：用户点名「只改生活里的零食页面」，实测入口链为 `HomePage → /category/life → services.ts 的 id=snacks（type=supermarket）→ navigate('/shop') → CustomerPage → /product/:id → ProductDetailPage`；经确认落点为**两个页都改**。全程不接后端、不加登录/支付/数据库，变体走本地演示层。
- **变体层（新增 `src/utils/variants.ts` + `src/data/variants-demo.ts`）**：`pickCombo` 用「硬钉刚改动的轴」而非纯打分——实测反例：白象方便面从「帮泡装+十三香」点「零售装」时，零售装的口味段为空得 0 分、而「帮泡装+十三香」得 1 分，纯打分算法会**把用户刚点的零售装吃掉、悄悄改回帮泡装**。不存在的组合（盒装 500ml）不编造价格，标 `available:false` 并由 `pickCombo` 回落到最近可售项 + `aria-live` 如实播报。
- **诚实性判据上机器**：`tests/variants.test.ts` 有一条反向校验——每个可售组合的 `order/price/productName` 必须与 `products-seed.ts` 的真实行**逐字段相等**，另含「available:false 不得带非零价」「同一 order 不得属两个组」「memberOrder 必须有对应可售组合（否则进该商品详情页选不中自己）」。于是「价格取自真实目录」不再是注释自称。
- **真实缺陷①（潜伏，非本轮引入）：`.tap-44` 写在裸 CSS 区，把 Tailwind 的 `absolute` 顶掉了**。裸 CSS 优先级高于所有 `@layer`，`.tap-44{position:relative}` 因此压过 utilities 层的 `absolute` ⇒ 所有 `tap-44 absolute` 角标按钮退化成流式排布。生产构建实测坐标：轮播 prev/next 落在 (288,533) 与 (272,565)（`next` 的 x 竟小于 `prev`），且把 group 高度从 420 撑到 484（= 图 420 + 32 + 32，数字自洽）。受影响共 4 处：`ProductGallery` 箭头×2、`ReviewForm` 晒图删除角标、`ServiceFormPage` 图片删除角标。修法＝`.tap-44` 收进 `@layer components`，修完 prev/next 回到 (288,323)/(708,323)、`position: absolute`、group 高 420。已加常驻回归锁。
- **真实缺陷②：详情页 `selection` 用独立 effect 事后回填 ⇒ 首帧规格全未选中**。表现为「进页面时规格闪一下才跳成正确值」；单测里以「瓶装 aria-pressed 期望 true 实为 false」暴露。改为派生（`selectionOverride ?? initialSelection(group, orderNum)`）并把瞬时态重置并入 `load()` 与 `setProduct` 同批更新，effect 删除。
- **e2e 结构性发现（决定验收怎么跑）**：`index.html` 的 CSP 是 `style-src 'self'`，**dev 模式下 Vite 用 `<style>` 注入 CSS 会被整块拦掉 ⇒ 页面完全无样式**，所以双栏并排/焦点环/响应式重排这类几何判据在既有 dev harness 里结构上不可能通过（实测 1440 下信息栏 x=8，两栏退化成堆叠）。据此拆两套：`tests/e2e/product-detail.spec.ts` 跑 dev 只测与 CSS 无关的行为；新增 `playwright.visual.config.ts` + `tests/e2e-visual/layout.spec.ts` 跑**生产构建**（CSS 出独立文件，`style-src 'self'` 放行）测几何，脚本 `npm run test:visual`。同时证实 React 走 CSSOM 写内联样式不受该 CSP 影响（色块 `rgb(76,122,52)` 在 dev/prod 都真）。
- **详情页改造**：桌面 `lg:grid` 双栏（左 1.25fr 图集含缩略图列 / 右标题·规格·评分·价格·变体选择·数量·购买入口·配送说明），平板手机单列堆叠。左栏必须加 `lg:items-start`——网格默认 `align-items:stretch` 会把左栏卡片拉到与右栏等高，图片下方留大片空白（截图可见，已加判据 `card < img + 80`）。缩略图列**取代**原匿名小圆点（圆点只能表达"第几张"，缩略图能表达"这是哪个规格"），点缩略图与选规格由同一份 `selection` 双向驱动。新增面包屑（首页›生活›零食饮料，真 `<Link>`）、商品参数 `<dl>`（全真实字段）、配送说明（营业时间取 `utils/businessHours` 真实口径；目录里没有配送时长与起送金额，故**不写具体数字**，只说明以群内约定为准）、售后说明（商家从未提供 ⇒ 整块标「演示文案」+「不构成任何真实承诺」）、同类商品（取真实目录同 subcategory，用 `<Link>` 不用 div+onClick；措辞是「同类商品」而非"爆款/热销推荐"——那需要销量或人工背书，目录里没有）。
- **不要广告框架（用户明确要求）**：无主推/爆款/限时等措辞；不编造销量、评分背书或品牌承诺；演示聚合关系（把目录里多条独立记录聚成同一商品的变体轴）在每个变体组下方以 `disclosure` 如实标注。
- **「立即购买」只弹演示订单摘要**：复用 `Overlay`（焦点陷阱/Esc/滚动锁/焦点归还都是现成的），明确写「不产生真实订单、不发起任何支付」，e2e 断言 URL 不变且 `sm_cart` 未被写入。真实下单链路（购物袋→确认订单→支付）一行未动。
- **加购数量入账修了一个隐患**：`useCart.add` 读的 `cartRef` 在 effect 里才同步，**循环调用 `add()` 加多件只会加 1 件**（第二次读到同一个旧 cart 并覆盖）。改为 `addToCart(cart, product, qty=1)` 一次入账，向后兼容（`CustomerPage`/`CartPage` 的 `add(product)` 调用不受影响）。
- **同名主按钮收敛**：右栏与吸底栏各放一个「加入购物车」时，Playwright 严格模式直接报 4 例既有 e2e 失败（`resolved to 2 elements`），读屏也会读到两个同名主操作。改为**按视口条件渲染**（`matchMedia('(max-width:1023.98px)')`，jsdom 无 matchMedia 时按桌面处理）：宽屏只有右栏那一个，窄屏只有吸底栏那一个。
- **列表页（`CustomerPage`）三处真实缺口**：排序药丸只有 `pill-active` 视觉着色、辅助技术读不到当前排序 ⇒ 补 `role=group` + `aria-pressed`；筛选/搜索/排序改写列表却无任何反馈 ⇒ 新增 `共 N 件` 计数区；商品属于变体组时卡片加「N 种规格」角标（**卡面价仍显示本条记录的真实单价**，不用「¥x 起」——那样点进详情默认选中的正是这一条，价格会对不上）。`TopNav` 经核查语义本已到位（nav 地标 + `role=group` + 全量 `aria-pressed`），未动。
- **测试契约的两处刻意变更**（不是回归）：① `productDetailPage.test.tsx` 的 `¥3.50` 出现次数由 2→3→**2**（吸底栏改条件渲染后 jsdom 里不再出现）；② `productGallery.test.tsx` 里 `container.querySelector('img')` 全部收窄到 `[data-main-image] img`——缩略图列也渲染 `<img>`，原来的宽泛查询会误取缩略图。另：详情页测试补 `getCategories` mock（少一个会让 `Promise.all` 整批抛错被 catch ⇒ 页面直接判「商品不存在」）并加 `MemoryRouter` 包裹（页面开始用 `<Link>`）。
- **官方宣传图这条路查证后放弃（如实记录）**：按"仓库真实图 + 联网官方宣传图"的要求检索，Wikimedia Commons 只命中街拍（电车车身广告、店里摆的瓶子、公交车），通用检索命中的全是素材站（pngsucai / photophoto / aigei / 淘宝列表页 / 百度百科），**无一是品牌官方且可自由使用的来源**，抓进自营商店属于版权负债而非改进。仓库 `public/images/` 那 55 张是商家自拍实拍图，本就是需求里的优先源，故商品图全部维持真实图；仅在图片加载失败的降级占位里加了「示意图 · 非商品实拍」标注（绝不用抽象几何冒充商品照）。
- 用例 453 → **517**（56 → 58 文件：新增 `variants.test.ts` 34、`productDetailVariants.test.tsx` 16、`productGallery` 11→18、`productDetailPage` 15→18、`customerPage` 5→8）；覆盖率四项全部上升 statements 74→**76.5%**、branches 68→**70.67%**、functions 69→**72.09%**、lines 76→**78.14%**；棘轮上调 **76/70/72/78**。另新增 Playwright 用例：功能 e2e 8→**20**、视觉 e2e **9→10**（跑生产构建）。
- 门禁全绿：`verify:backend` 102/102、`npm test` 517/517、`lint`（oxlint --max-warnings 0，185 文件）0 错、`typecheck`（前后端两套 tsconfig）通过、`test:e2e` 20/20、`test:visual` 10/10、`verify:changelog` 本条即为其判据。**后端与数据层零改动**（`functions/`、`db/`、action 契约 23 个均未触碰）。

### 2026-09-25 追加十（对标第七轮：H1 管理端两 Tab + H2 顾客端详情链，覆盖率 74.71%）

- **顺带修掉一个真实缺陷**：`ProductGallery` 在 `gallery` 只有一张图时走的是"按 order 拼路径"的分支，**忽略调用方传入的那张图** ⇒ 商品只挂一张自定义图（`product.images.length === 1`）时详情页显示错图。改为 `singleSrc = gallery.length === 1 ? gallery[0] : imgSrc`，且 `srcSet` 仅在该图确为 order 路径图时才挂（外链/上传图没有 sm/ 版本）。新增用例锁死（`/uploads/real-photo.jpg` 必须赢过 `/images/12.webp`）
- **H1 管理端两大件**（原 44%/48%）：`ordersTab.test.tsx` 16 例（骨架/空态/搜索与状态筛选/分页 20 条一页与边界禁用/合法迁移下拉与终态单选项/状态更新成功-拒绝-抛错三态/删除二次确认与失败/复制文本四要素/CSV 表头与逐商品行 + BOM **字节层**断言）+ `productsTab.test.tsx` 24 例（**批量改价取整口径**：数字=统一价、`33%`=按原价四舍五入到分、非数字拦截且不发请求；部分失败必须 warn 不得吞 failed 明细；未选中不渲染批量栏；新增/编辑一律内联展开且全程 `role=dialog` 为空；含并回的旧 4 例）
- **H2 顾客端与基础设施**：`productDetailPage.test.tsx` 15（骨架语言统一/未找到与接口抛错同一空态/order 与 _id 双寻址/云端+本地合并与低分高分排序/发布后 refreshReviews/云端失败降级/快速切商品 cancelled 守卫/加购与件数）+ `reviewForm.test.tsx` 13（晒图三道闸：张数上限、类型与 10MB、压缩后 2MB；**上传失败不提交评价**）+ `reviewList.test.tsx` 13 + `productGallery.test.tsx` 11 + `overlay.test.tsx` 11（焦点陷阱/遮罩与 Esc 开关语义/滚动锁与焦点归还；jsdom 需把 `offsetParent` 定义为"有父元素即可见"才测得到过滤分支）+ `adminGuard.test.tsx` 11（会话续登三分支/空钥与纯空格/错钥与网络异常文案区分）+ `prefetchBus.test.ts` 10（工厂不覆盖、去重、**失败后撤销标记允许重试**、150ms 与 idle 回退、300ms 错峰）+ `imageCompress.test.ts` 8（横竖图与"只缩不放"、四类失败面）+ `reviewImagesUtil.test.ts` 6
- 用例 319 → **453**（46 → 56 文件：新增 11 个文件，其中 productsTab 与旧 ProductsTab 同名合并为 1 个）；覆盖率 statements 57.25→**74.71%**、branches **68.76%**（双跑 68.71/68.76，差 1 条 5s 轮询时序分支）、functions **69.81%**、lines **76.39%**；棘轮上调 **74/68/69/76**
- **⚠️ 本轮我自己踩到并纠正的回归（大小写文件名冲突）**：新建 `tests/productsTab.test.tsx` 与已存在的 `tests/ProductsTab.test.tsx`（第三轮的 4 条批量操作用例）在 Windows 大小写不敏感文件系统上是**同一个文件**——`Write` 静默覆盖旧内容，`git status` 只表现为 `M` 而非 `??`。发现时已丢 4 例；已把这 4 例（含"部分失败绝不回退原生 alert"这条第三轮不变量）**并入新文件并复跑通过**（该文件 20→24 例，总数由 449→453）。**纪律补一条**：新建测试文件前必须先 `git status`/`ls` 核对同名（大小写不敏感）文件，`M` 状态的"新文件"＝覆盖事故而非新增
- 后端与数据层零改动；`verify:backend` 102/102、契约 44/schema 16/license/changelog 全绿


### 2026-09-24 追加九（**P0 修复**：看板四张图在生产包里静默空白——真库渲染测试把它炸了出来）
- **缺陷**：`useDashboardCharts` 把 9 个 `echarts/lib/chart|component/*` 深路径模块的 `.default` 收进 `core.use([...])`。这些模块是**纯 side-effect 自注册**文件（`line.js` 末尾自己 `use(install)`，全文件零 export），`X.default` 恒 undefined → echarts `extension.js:109 ext.install(...)` 抛 TypeError → 发生在 async IIFE 内且无 catch → **init 链整体中断：四张图永久空白、页面不弹任何错**。实测生产包证据：`dist/assets/line-*.js` 的 module namespace `keys=[] / hasDefault=false`；浏览器内 `import()` 该 chunk 同样拿不到 default
- **影响窗口**：hook 拆分自 2026-09-05（H1-2）起；此前所有单测把 echarts 整包 mock、e2e 又只跑演示模式（demo 下 `getDashboardStats` 无本地实现，看板直接显示"加载失败"），**两层判据都摸不到这段代码**——所以它活了 19 天
- **修复**：9 个模块改为"只 import 不塞 use()"，`core.use([renderers.CanvasRenderer])`（renderers 是唯一只导出不自注册的模块）；并把成因写进代码注释，防止后人"顺手加回 use"
- **判据补三道（缺一都会再犯）**：① 新增 `tests/chartRealRender.test.ts` 用 echarts 官方 SSR（`init(null,null,{renderer:'svg',ssr:true})`）在 node 里**真渲染**，不依赖 canvas/浏览器/密钥，并含一条"深路径模块无 default 导出、仅 import 即注册"的判据自证；② `tests/dashboardChartsHook.test.tsx` 的 mock 改具**真库语义**——`use` 复刻 `ext.install` 校验、9 个深路径 mock 保持"零导出"同形，于是 `X.default` 写法当场炸（原 mock 是空 vi.fn()，正是它掩盖了这个 P0）；③ 新增本地云端模式验收桩 `scripts/local-api-stub.mjs` + `vite.config.stub.js` + `tests/env-stub/.env.stub`（`npm run build:stub && npm run serve:stub`），**假密钥 + 假 /web** 打通"登录→看板→真 echarts 出图"的浏览器路径，绕开"用生产密钥做验收=密钥进日志"的禁忌
- **对照实证（正反例双向）**：同一 harness、同一脚本，修复后构建 → 看板 4 个 canvas（687×392 / 687×308 / 687×392 / 687×448）；回退到 `bcaba62` 版 hook 重新构建 → 已登录、9 个 tab 在、`看板数据加载失败` 未出现，但 **canvas 数 0**（与线上症状完全一致，且控制台无可见报错=当初漏检的原因）
- 顺带定性一条噪声：e2e 里每例打印的 `Applying inline style violates CSP style-src 'self'` 经定位来自 **`@vite/client` 注入的 dev 覆盖层样式**，生产构建页面控制台零消息 ⇒ 顾客端/管理端真实样式不受影响，M4 观察项关闭
- 本轮附带发现（**未修，登记待办**）：演示模式下看板永远显示"看板数据加载失败"——H1-2 把聚合下沉到 `stats.js` 后本地模式没有对应实现。要么补本地聚合（与服务端有漂移风险），要么把错误文案改成明确"演示模式无看板聚合"；后者零风险，待用户裁决


### 2026-09-24 追加七（对标第六轮：图表 option 抽纯函数 + 看板/商品行/评价门面测试，覆盖率 57.25%）
- **F1 小重构（行为不变）**：`useDashboardCharts` 的 4 张图 option 构造逐字段搬到 `src/utils/chartOptions.ts`（主题/动效改为入参，`readChartTheme` 与 `TOOLTIP_BASE` 一并外移），hook 只剩"实例生命周期 + setOption 触发"。**为什么**：原写法只有真挂 echarts/canvas 才走到，等于 4 张图的全部配置零测试；抽出后 chartOptions 与 hook 双双 100% 覆盖
- **F1 新增测试 3 文件 32 用例**：`chartOptions.test.ts`（16：tooltip 运行时 plainText、rangeDays>=90 才挂 dataZoom、TOP 倒序+前 3 名强调色、reducedMotion 关动画、非 hex 变量退兜底色）、`dashboardChartsHook.test.tsx`（6：echarts 全模块 mock——10 个按需模块注册、晚出现容器补建实例、resize 联动、卸载 dispose+监听注销、import 未回即卸载不建实例）、`dashboardTab.test.tsx`（10：KPI/日均/毛利三态/三处空态/区间点击与方向键/CSV 导出 Blob 内容/加载失败两种降级）；DashboardTab 68.83→**92.2%**
- **XSS 静态门禁随重构扩展**：`chartXss.test.ts` 改为**并扫** hook 与 chartOptions 两个文件（只读单文件会让门禁在重构后静默失焦），并补"四张图 tooltip 一个都不能少"计数判据
- **F2 确认/支付页剩余分支 +13 用例**：非营业时间强制下单、空购物车拦截、aria-invalid 与错误节点关联、截图三道闸（未选/超 5MB/压缩失败）、截图随单字段、支付页无单号重定向、sessionStorage 续单号、支付宝提示弹窗、轮询到 cancelled、轮询失败不误报已付、0 金额不渲染价格行；PaymentPage 80→**97.5%**
- **G 批（零成本高价值面）+39 用例**：`productRow.test.tsx`（12，35.71→92.85%：库存角标三态、上下架开关文案与 aria-pressed、内联展开回调时序、键盘等价点击）、`dbReviews.test.ts`（11，src/db/reviews.ts 1.81→100%：字段白名单裁剪、云端失败降级本地、60s 缓存与精确失效、管理端写删抛错口径）、`smallUtils.test.ts`（10，format/images/rovingTabs 全 100%）、`successAndNotFound.test.tsx`（6，成功页复制/查询/跨导航兜底 + 404 页，两文件原 0%）
- 覆盖率 statements 47.63→**57.25%**、branches **53.87%**、functions **50.76%**、lines **59.66%**（313 用例 / 45 文件）；棘轮上调 **57/53/50/59**
- 后端与数据层零改动；`verify:backend` 仍 102/102、契约/schema/license/changelog 全绿、首屏体积 86.4KB 无变化（图表代码在管理端 chunk）、e2e 8/8

### 2026-09-24 追加八（**定性纠偏 + 门禁自修**：CHANGELOG 门禁在 CI 浅克隆里必红）
- **事实纠正（重要）**：上一轮记录的"CI `70ca0b9` completed success"**不成立**——GitHub API 实测 run #114 与本轮 #115 均 `failure`，失败步都是 `CHANGELOG entry gate`。连带后果：70ca0b9/bcaba62 两次 push 的 **pages.dev deploy job 未执行**（生产仍是 6a726ca 的构建；两轮改动均为测试/门禁类，运行时行为无差异，但"已上线"的说法此前是错的）；github.io 的 dispatch 与 CI 相互独立，故顾客端照常构建
- **根因**：`actions/checkout` 默认 `fetch-depth: 1` → CI 里没有 `HEAD~1` 对象 → 门禁的 fail-closed 分支（取不到 diff 就拒绝放行）被浅克隆触发。**本地全历史永远复现不出来**，属"判据自身坏了/环境变了判据没变"同族（R263）
- **两处治本（缺一不算修完）**：① `ci.yml` build-and-test 的 checkout 加 `fetch-depth: 0`（仓库仅 117 提交 / 13MB，成本可忽略），并写明原因；② `check-changelog.mjs` 内置**浅克隆自愈**——缺 rev 时 `git fetch --no-tags --deepen=3 origin` 后重试，仍失败才拒绝，且在拒绝日志里直接指出"给 checkout 加 fetch-depth: 0"
- **对照实证（正反例都跑）**：`git clone --depth 1` 出的浅克隆里，旧脚本 exit 1（原样复现 CI 报错），换上新脚本 exit 0 且历史自动加深到 4 提交；同仓库再造一个"只改 src 不改 CHANGELOG"的提交 → 新脚本仍 exit 1（自愈没有把门禁改成假绿）。临时克隆实测后已删除



### 2026-09-24 追加六（对标第五轮：管理壳/商城页/内联编辑表单测试，覆盖率 47.63%）
- **E1/E2** 新增 3 个测试文件 15 用例（228/228，37 文件）：`adminPage.test.tsx`（tablist 键盘流转、订单增量首拉、商品错误横幅禁静默回退、云端空态种子、本地徽标）、`customerPage.test.tsx`（真实 useProducts/useCart：加载/排序/搜索空态/加购 toast+浮球/错误重试）、`inlineEditForm.test.tsx`（stock '' 不发送、非法值行内拦截、costPrice 归一、create/update 双出口、服务端拒绝行内展示）
- 覆盖率 statements 35.68→**47.63%**、branches 43.52、functions 41.39、lines **50.14%**；棘轮上调 47/43/41/50（双跑数值一致，确定性强）
- **E3 如实顺延**：useDashboardCharts 拉起需 canvas 桩或抽纯函数小重构，性价比让位，仍列 P1
- **F2 CHANGELOG 门禁（同轮直接落地）**：`scripts/check-changelog.mjs`——PR 对目标分支 / push 对 HEAD~1 取 diff，触及 `src|functions` 而 CHANGELOG 无新增内容行 → CI 红；`--relaxed` hotfix 逃生门（warning 留痕）；diff 取不到时**拒绝放行不静默跳过**。正/反例双向实测（反例经临时分支验证 exit 1 后无痕清理）。进 `npm run verify` 链与 CI
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第五轮-2026-09-24.md`；后端/UI 零改动

### 2026-09-24 追加五（对标第四轮：覆盖率破 30% + extraneous 定性纠偏）
- **D1** `src/db` 三门面（orders/products/submissions，含云端失败→持久缓存→本地兜底、离线队列、分页去重、重入锁）+ ReviewsTab/SubmissionsTab 组件测试共 **+18 用例（213/213）**；覆盖率 statements 23.65→**35.68%**、branches **32.47%**、functions **31.04%**、lines **37.43%**，阈值棘轮上调 35/32/31/36
- **D3 结论纠偏（重要）**：清装（`npm ci`）后 `@img/sharp-wasm32` **仍然出现**——它不是"镜像安装残留"，而是 wrangler(dev)→sharp 的**合法 dev 树平台可选二进制**；license 门禁按 `--omit=dev` 生产树过滤的语义因此被实证正确（prod 树 10/10 白名单）。上一轮报告"残留信号弹"的定性作废，以本条为准
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四轮-2026-09-24.md`；后端与 UI 代码零改动（纯测试/配置轮）

### 2026-09-24 追加四（对标第三轮：覆盖率棘轮 + 超时单工作台 + SQL/license 门禁）
- **B4** 页面层测试 +13（OrderQueryPage 6 / CartPage 4 / OrdersTab 超时面板 3；195/195），覆盖率 19.68→**23.65%**（stmts），`vite.config` 阈值棘轮上调 23/21/20/24（只升不降）
- **B5** `stalePendingReport` 接 OrdersTab：超时未确认订单**内联面板**（汇总/占用明细/"已传付款截图"徽标/逐单"取消并释放库存"复用状态机+回补路径；只读密钥静默不显示；遵守禁弹窗铁律）
- **C1** 单 action SQL 语句峰值基线：verify-backend 内置计数器，`docs/sql-baseline.json` 30 action（6 次采样并集；审计/限流写路径 +1 吸收 60s 真实窗分支抖动，读路径精确）——N+1/循环语句回归从此 CI 红
- **C2** `scripts/check-licenses.mjs` 生产依赖 license 白名单（GPL/LGPL/AGPL/SSPL/Elastic 与未知许可一律拦），过滤 extraneous（本机实测揪出历史镜像残留 `@img/sharp-wasm32`，含 LGPL 复合条款但**非 lock 依赖**）；已进 `npm run verify` 与 CI
- 报告：外层 `deliverables/GitHub开源项目对标分析报告-第三轮-2026-09-24.md`

### 2026-09-24 追加三（对标第二轮：幂等 / 迁移账目 / 供应链门禁 / XSS 收口）
- **下单幂等（A1）**：`orders.idempotencyKey` + **部分唯一索引**（`WHERE ... IS NOT NULL`，历史单零影响）；键 = `房间号@requestId#fnv1a(载荷指纹)`；不带 requestId 的调用方（顾客端 SW 长缓存下的旧包）走 90s 内容指纹兜底；去重判定在扣库存之前，真并发撞唯一索引时回补本请求库存再返回既有单；响应新增 `deduplicated` 标记。对标纠偏：**litemall 实际没有任何幂等**（`order_sn` 无唯一索引），做幂等的是 Medusa / Saleor
- **状态流转乐观锁（A4）**：`UPDATE ... WHERE _id = ? AND status = 读到的旧值`，并发迁移只有一个胜出，落败方收到"订单已被他人更新，请刷新后重试"；抢占失败时回补"误取消恢复"刚扣的库存
- **超时未支付单只读盘点（A5）**：新增 `/web stalePendingReport`（不进写操作集合）——按账龄列 pending 单、标记是否附付款截图、统计被占用的有限库存。**有意不做**定时自动砍单（本项目线下确认制下 pending 可能是"已转账待确认"），见 `docs/adr/0003`
- **D1 迁移账目与漂移门禁（A2）**：`schema_migrations` 表 + `scripts/migrate.mjs`（`status|apply|baseline|mark`；默认 `--local`，生产须显式 `--remote` 且逐字确认，非交互环境拒执行；checksum 防改历史）+ `scripts/check-schema-drift.mjs`（迁移引入的表/索引/列必须已在 `schema.sql`，未识别 DDL 判 FAIL）+ `db/rollback-*.sql` 回滚脚本；`verify:schema` 已进 `npm run verify` 与 CI
- **echarts XSS 收口（A3）**：`npm audit`（官方源）命中 GHSA-fgmj-fm8m-jvvx（echarts <6.1.0），真实汇点是营收柱 tooltip 把入库文本拼成 HTML → 统一 `renderMode: 'plainText'`（不升 major 版本，理由见 `docs/adr/0004`）；新增 `tests/chartXss.test.ts` 静态不变量断言
- **依赖漏洞审计进 CI**：`npm run audit:deps`（固定 `--registry=https://registry.npmjs.org`，因 npmmirror 实测未实现 audit 端点会静默无数据；high+ 阻断，端点故障非 0 退出）
- **覆盖率棘轮（B1）**：`vite.config.js` 钉死 `include: ['src/**']` 后阈值 19.5/18/17.5/21。**口径纠偏**：此前记的 45.8%/43.72% 是"仅被测试加载文件"口径，src 全域真实值为 **19.68%**（页面层基本没测），棘轮只升不降
- **首屏预算按归因重设（B2）**：77.9KB → 86.4KB 的增量逐块归因为 `react-vendor` 66.0KB gz（占首屏 76%，react 19.3 + vite 8.3 抬基线），预算 90 → 95KB（实测 ×1.10），门禁新增"首屏构成 top3"输出
- **文档（B3）**：`docs/adr/0001-0005` 五条决策记录（状态机 / 幂等 / 库存与不自动砍单 / 预算与 XSS / 迁移账目）；`scripts/gen-api-doc.mjs` 由契约渲染人读版 `docs/API.md`（39 action，`npm run docs:api`）；README 的 CI/契约/迁移段落回写为实测数字
- 门禁终态：lint 0/0（140 文件）｜tsc 双配置 0 错｜vitest **182/182**（29 文件）｜verify-backend **101/101**｜契约 **44**｜schema 漂移 **16/16**｜e2e **8/8**｜体积 **3/3**
- 核验纪律：子代理初稿两条高危主张（workflow 未锁 SHA、`dify.js` 密钥可被客户端外发）经逐文件实测**驳回**——15 处 `uses:` 全部锁 SHA、`DIFY_BASE_URL` 只来自服务端 env

### 2026-09-24 追加二（用户裁决轮：库存 + 订单查询 + D1 备份）
- **库存管理与防超卖**（对标 C1）：`products.stock`（-1=不限售，存量商品迁移后行为不变）；下单即占用（守卫式条件 UPDATE 防并发超卖，任一失败同请求内补偿回补）；取消/删除进行中单回补、误取消恢复重新占用；管理端内联编辑新增库存字段 + 行内「缺货/低库存」角标；顾客端公开接口下发 stock
- **订单查询页** `#/order-query`（对标 litemall 订单跟踪）：输单号看 5 步进度；成功页展示订单号 + 复制 + 查询入口（sessionStorage 兜底跨导航找回单号）
- **D1 每日备份**：`.github/workflows/d1-backup.yml`（cron 04:00 北京；缺 `CF_D1_BACKUP_TOKEN` 显式 warning 跳过不假绿；导出物进私有仓 artifact 保留 30 天）；本轮已手动全量导出留档 `_backup/d1/supermarket-2026-09-24.sql`（1.44MB）
- 生产迁移：`db/migrate-stock.sql`（ALTER 加列，**先迁移后部署**顺序铁律写在文件头）
- 门禁：lint 0/0 ｜ tsc 0 错 ｜ vitest 176/176 ｜ verify-backend **84/84**（+18 库存断言）｜ e2e **8/8** ｜ build + 体积 3/3

### 2026-09-24 追加（GitHub 开源对标轮：履约闭环 + 门禁加深）
- **订单履约状态机**（对标 litemall 订单域）：3 态扩为 5 态 `pending→paid→delivering→completed` + 旁路 `cancelled`；服务端 `ORDER_TRANSITIONS` 单点强制非法迁移（status 列 TEXT 无 CHECK，**零 D1 迁移**）；管理端行内下拉只呈现合法下一步
- **顾客侧订单进度**：新增 `/pub getOrderStatus`（只回 status/updatedAt，订单号即凭证）；支付页轮询改走该公开接口——**顺带修复真实缺陷**：旧实现用 `adminCall('getOrder')`，顾客端无会话密钥必然鉴权失败，"付款已确认"轮询在顾客侧从未生效
- **前后端迁移表 parity 锁**：`src/utils/orderStatus.ts` ↔ `functions/lib/actions/orders.js` 深度相等由 `tests/orderStatus.test.ts` 断言
- **e2e 3→7 用例**：新增下单主链路、空表单防误、管理端状态流转三链路；`vite.config.e2e.js`（空 envDir）隔离本机 `.env`，使本地 e2e 与 CI 行为一致（此前本机跑必然进云端模式全挂）
- **CI 门禁加深**：Test 步骤并产 v8 覆盖率（artifact，非阈值门禁）；新增 `check:cycles` 与 `verify:contract` 阻断步骤（此前二者只在手动 `npm run verify`）
- **文档**：新增 `docs/ARCHITECTURE.md`（系统图/关键不变式/门禁链表）；README 架构入口
- 门禁：oxlint 0/0 ｜ tsc 双配置 0 错 ｜ vitest **176/176**（28 文件）｜ verify-backend **66/66** ｜ 契约 /web 30 + /pub 8 ｜ e2e 7/7 ｜ 覆盖率本机可用（旧"worker 崩溃"结论作废，vitest 5 + coverage-v8 已修复）

### 待办
- ~~覆盖率阈值门禁~~ → 本机已可跑（全量 45.8% lines），阈值门禁暂缓：页面层覆盖低，先补再卡

### 2026-09-24 追加
- **e2e 冒烟转正式门禁**：4 条用例在 CI 实跑全绿（首页/搜索过滤/加购/后台），移除 `continue-on-error` 使 `e2e` job 具备阻断力
- 期间修复：oxlint `no-console`（e2e 文件级豁免）、商城路由实为 `/#/shop`、演示模式商品 id 为 `p_{order}`、演示模式后台直接放行
- 三个 workflow（ci/dispatch/uptime）全部固定 Actions 到提交 SHA 并加 `permissions: contents: read`
- CI 状态查询通路：仓库为私有，未认证 API 404；可用本机 gh 凭据（凭据管理器 `git:https://github.com`）走 API 查询与触发 workflow_dispatch


## [0.1.0] - 2026-09-23

### 新增
- 商品图内容修正：40 号错图（呀！土豆 → 好友趣）与 18 号参数表图换实物图（`ce51d77`）
- `aiAdvice` 独立限流（60s/10 次，分桶 `rate:aiadv:{ip}`，位于鉴权之后）（`22b5e90`）
- 社区标准文件：`LICENSE`（MIT）、`SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md`
- 产物体积预算门禁：`scripts/check-bundle-size.mjs`（从 dist/index.html 解析首屏资源，按 gzip 卡阈值：首屏 JS ≤90KB / CSS ≤11KB / 单 chunk ≤90KB；实测 77.9 / 8.7 / 58.1），CI 在 build 后执行
- 端到端冒烟骨架：`playwright.config.ts` + `tests/e2e/smoke.spec.ts`（商品浏览/搜索/加购/后台登录 4 条），跑在 dev server 的本地演示模式；CI 新增 `e2e` job（首轮试跑）
- 接口契约外化：`docs/api-contract.json`（`/web` 29 + `/pub` 7 = 36 个 action，含写操作/缓存键/限流桶属性）；`npm run gen:api-contract` 生成，`npm run verify:contract` 校验漂移（41 断言，已接入 `npm run verify`）
- CI 加固：三个 workflow 全部加最小权限 `permissions: contents: read`；所有 GitHub Actions（`checkout` / `setup-node` / `upload-artifact` / `download-artifact` / `github-script`）固定到提交 SHA

### 修复
- 商品图 HTTP 强缓存 7 天 → 10 分钟 + SWR，换图最快 10 分钟可见（`b2b94af`）
- 只读密钥越权口：`ADMIN_WRITE_ACTIONS` 白名单 8 → 16 项（`2b73fbc`）
- `cache:ai:advice` 写后不失效 → 补 `invalidateAiAdvice`（`2b73fbc`）
- 3 处真循环依赖（routeLoaders ↔ 页面）用 `src/prefetchBus.ts` 拆断（`2b73fbc`）
- 浮层层级重排：安装引导遮罩 `z-[90]` → `z-[70]`（`75b5f5e`）
- `scripts/verify_images.py` 路径硬编码导致的静默假失败

### 优化
- 前端六维深度优化（性能 / 体验 / 响应式 / 代码质量 / 可访问性 / 浏览器兼容），响应式同口径复测 53 → 约 91 分（`91c4fad`）
- 二轮优化：商品图全量重编码（体积 -15%）、AI 建议会话缓存、轮询感知页面可见性、批量写合并、CSP 收紧、死代码清理（`a399cbf`）
- 第三轮全栈优化：I/O 与渲染减负、缓存失效补全（`2b73fbc`）
- 顾客端轻量视觉打磨：列表入场动画、详情页骨架屏（`22b5e90`）

### 文档
- README 校正测试数量（82 → 实测 168）与 CI 描述
