### 第四十八轮明细（主卷只留指针，本块是移出的详情）

- **H1 `verify:images` 的判据自己一直永绿**：负控制原文 —— 合成面（seed 三个 `order:`、两张合法 WebP）印
  「❌ 缺失图片 (1/3)｜覆盖率 66%」而 rc=0，因为 `main()` 从不返回、`__main__` 不 `sys.exit`；
  且旧代码在 seed 读不到时 `return set(range(1,50))`，等于"数据源坏了也照样能判"。
  本轮：三档 0 全绿 / 1 真有缺失或无效 / 2 没有对象可判（图片面不存在、`order:` 零命中各自点名），
  兜底删除。接线：`verify` 聚合链 + `ci.yml`（`setup-python` 钉 `5fda3b95a4ea91299a34e894583c3862153e4b97` = v7.0.0，
  这个 SHA 由 `gh api git/ref/tags/v7.0.0` 现取；我一开始写 `@v5` 被本仓 `tests/ciWorkflow.test.ts` 的供应链卫生闸判红）。
  夹具 `tests/verifyImages.test.js` 8 条：正向 / 缺图 / 够大但魔数不认 / 面失踪 / seed 零命中 / 真入口分母现算 /
  变异体（`return 1`→`return 0` ⇒ 缺图必须被读成通过）/ 解释器可用自证。
- **H2 采集面 ⇄ 运行面**：`runnerExcludes()` 现读 `vite.config.js` 的 `exclude`（真面 3 个 pattern），
  G14 追加 `vitest 面 110 / 被排除面 7`，且被排除面里"真起子进程"实测 **0** ⇒ 只加读数、不改判定。
  过程中的错：`rel` 起初按"相对 `tests/`"算，而 pattern 是 `tests/e2e/**` ⇒ 永不相配，读数印成"被排除面 0"；
  揭穿它的是交叉核对（`find tests/e2e* -type f` 得 8 个文件）。形状入档：**新读数第一次出 0，先怀疑自己看不见。**
- **H3 CHANGELOG 入面**：先量再动 —— 137 条命令式 code-span、6 个脚本名（盘上不存在 **0**）、28 个别名（不在册 **0**）
  ⇒ 上轮我写的"历史死命令一入面就恒红"是**未量的猜测，被实测否证**（死命令在 `docs/implementation-plan-2026-08-08.md`，
  那里早已有 `archive_faces` + `exempt_until`）。入面后提及 128→196→202、claim 全成立；
  D5"在册却无人知晓"与 D6"README 缺行"立刻点名我新加的 `check:syntax` ⇒ 反向对账腿真在干活。
- **H4 计划外·机器型落点**：`scripts/check-staged-syntax.mjs` 接进 `.githooks/pre-commit`（排在密钥扫描之前）：
  判 `git cat-file blob :<path>`（**index 的字节**，不是工作树——并行会话可能已把它改了）、`.js/.cjs/.mjs` 走
  `node --check`、`.py` 走 `py_compile`、`.ts/.tsx/.jsx` 作盲区在门面行明说、非工作树 rc=2、空暂存面印"跳过不是通过"。
  夹具 `tests/stagedSyntax.test.js` 6 条，含"工作树被改坏但暂存版本是好的 ⇒ 不该拦"及其反向半边、变异体（摘掉整个守卫）。
- 本轮我自己的四条红（README 105 vs 107、`@v5` 未钉 SHA、变异腿挑错被告行、Edit 吞锚点第 4 次）原文见 CHANGELOG 追加六十二。
