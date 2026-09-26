# 07-next-steps.part21.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **已落地**：`functions/lib/notify.js`（新订单 webhook，未配即纯 no-op / 失败不冒泡 / 载荷白名单 / 两出口共用 `maybeNotifyNewOrder` / 幂等命中不重复通知）；`evaluateParity()` 拆成纯函数 + `tests/releaseParity.test.js`（11 条，**补掉第九轮自己记下的"bundle 不同名永远未覆盖"缺口**）；`scripts/check-env-docs.mjs` + `docs/env-vars.md` + `verify:env`（进 `npm run verify` 链与 CI step，并被 `REQUIRED_STEPS` 钉住）；`ciWorkflow.test.ts` 的 `run:` 块插值自查（15→20 条，zizmor `template-injection` 零依赖替代）；`check-pr-has-tests.mjs` + `dispatch.yml` 新 job `pr-advisory`（**报告型，永远 exit 0**）。
- **本轮最硬的两条账**：
  1. **变异不出红的反例不是反例，是装饰**。我给 `notifyNewOrder` 写了外层 `.catch(() => {})` 当"双保险"，变异它 ⇒ 16 条**全绿**：`deliverNewOrder` 内部已 try/catch 兜住一切，那层永远够不到。做法＝删死代码，把反证挪到真正提供保证的那一层（改 throw ⇒ 红 2 条）。**新判据首跑必须双向验，且变异要打在被测分支本身**。
  2. **文档写"有 X"必须当场 grep 产物证伪**：README 抄了一份环境变量表，而 `ADMIN_READONLY_KEY`/`ALLOWED_ORIGINS`/`DB`/`RATE_KV`/`CF_PAGES_COMMIT_SHA` 五个变量从未进过任何文档。⇒ 抄表即第二真相源，本轮**删表改指针**，并把"每个变量必须写明未配置时行为"做成硬判据（对标组实测 0 家做这件事）。
- **子代理取证纠偏**：它把 litemall 的包路径写成 `com.qiao.litemall`（当前 master 实为 `org.linlinjava.litemall.core.notify`）——机制属实、路径已纠；vite 的 `test-passed` 聚合 job 我先 curl 超时（rc=28）拿不到，改用 `gh api` 才核到 `ci.yml:141-150`。**委托结论落账前须自己开一次文件，且网络探针失败不等于事实不成立**。
- **K4 PR 流试点已开**：本轮改动走 `feat/round10-webhook-env-registry` → PR → CI（含 `release-parity` 后置复核）→ 自并。理由：dependabot 那轮已证明 CI 独立复核能抓到我本机抓不到的东西。

### P0（第十一轮开工先做这条，可执行）

- [ ] **口味色块判据仍是 `test.skip`**（第九轮遗留，仍未解除）：`src/data/variants-demo.ts` 两组皆 `kind:'spec'`，全站无 `color` 轴 ⇒ 判据有效但无数据驱动。二选一：上线一条带色块的规格数据后解除 skip 并实测；或确定不要这条轴就连 `tests/variants.test.ts` 里的空转断言一起删净。命令：`grep -n "kind: 'color'\|test.skip" src/data/variants-demo.ts tests/e2e-visual/layout.spec.ts tests/variants.test.ts`
- [ ] **advisory → 硬门禁的决策（须先看两次真实报文）**：`pr-advisory` 首跑记录（本机空集输出 `[pr-advisory] 当前没有开放 PR ⇒ 无可判对象（这不是通过，是空集）`，CI 侧见 PR run）。两次无误报后再考虑改成阻断，且阻断版必须留 label 逃生门（照 workers-sdk `ci:no-tests`）。
- [ ] **webhook 真实端点验收（需人）**：机制与判据齐了，但 `ORDER_WEBHOOK_URL` **生产未配置** ⇒ 现在线上仍是 no-op 态。要人给端点（企业微信/钉钉机器人或自建接收端），配完须做一次性实测：下一张单在端点侧看到 6 字段载荷、且订单详情里看不到微信号/截图外发。
- [ ] **已知边界（勿当缺陷）**：`verify:env` 只扫 `functions/**` + `src/**`，不含 `.github/workflows` 的 env 与 `scripts/**` 的 `process.env.*`（那是 CI 进程环境，登记表管它会把 `PARITY_RETRIES` 之类全拖进来）。需要时另开一张 CI 环境表，不要塞进同一册。
