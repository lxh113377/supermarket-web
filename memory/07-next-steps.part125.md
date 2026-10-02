> 换卷理由（数字实测）：主卷追加第六十四轮节后实测 4,798B，越过 4,096B 上限 702B；
> 按 V3 的处方「迁整段，禁压措辞/删事实」把下面三段**逐字**迁入本卷（三段字节数见各段标题行）。

### 让位指针段（第五十九/五十五~五十八/六十~六十一轮）（373 B）

> 让位指针：第五十九轮正文 → `part118`（逐字 diff 2,008 B 全等）；第五十五~五十八轮四条让位指针 → `part119`
> （逐字回查 HEAD 4/4 命中）；本轮「做了哪三件」整段 → `part120`。第六十轮正文 → `part122`（经 `part121` 让位）。第六十一轮正文 → `part123`。V3 的正解是迁段不是压措辞。
### 第六十四轮「机制三条」整段（909 B）

- 机制三条：① `scripts/check-inflight-intake.mjs`（别名 `npm run check:inflight`，advisory 不进 verify/CI，
  理由在文件头；三面取数 status∪diff∪ls-files，rc 0/2 两态；夹具 `tests/inflightIntake.test.js` 8 条真起一次性 git 仓）
  提交 `d520c72`；② `scripts/check-memory-volume.mjs` 增外层面 + `--outer-memory=`，实测外层
  `超市/memory/07-next-steps.md` **44,794 B / shell_max 40,960 B ⇒ over 3,834 B**，**只报不拦**
  （拆卷口径 60 轮明写「先定再动」，本轮未定）提交 `7055440`；③ 对外回显 3 处收口
  （`functions/lib/actions/orders.js` 免鉴权那条实测 5,007 B→71 B、`functions/lib/actions/events.js`、
  `functions/lib/stock.js`，一律复用 `logger.js` 的 `sanitizeTrace` 不另写清洗器）
  + 修 `scripts/api-response-contract.mjs` V4「红了印 `[]` 说不出红因」提交 `018c21c`。
### 第六十四轮「判据跟随」整段（277 B）

- 判据跟随：`verify:backend` 191→**195**（+4 回显断言）；`verify:entrypoints` 入口 58→59、真跑 47→48
  （有子进程夹具 ⇒ 不挂缺口也不吃豁免）；README 门禁一览由 `--update` 自动生成；`verify:docs` 抓到 123→124 文件数。
