# F2 修法独立复核（第二意见）— f2-review

> 复核人：f2-review 子代理｜只读复核，未改任何源码/判据/登记册。
> 对象：Lead 拟议并已实施的 d1Usage() wrangler.rolling24h 回退 + registry 同步。
> 结论速览：**RECOMMEND=REJECT**。回退消费的 0/0 高度可能是 wrangler 把 GraphQL authz 错误**静默掩码成零**的产物（盲区冒充零），不是「凌晨真实 0 流量」。把它登记成 facts.d1Usage=0/0/2026-11-16 并让 F2 转绿 = 伪绿。且 rolling24h≠LastDay，dayUtc 贴取数日是口径错标。根因是凭据缺 Analytics:Read（A4），不是判据代码 bug。

---

## ① 五个问题逐条结论

### Q1 是不是伪绿？rolling24h 来源真实性 —— **部分真、关键处伪；当前 0/0 高度可能是掩码盲区**

**真实的一面（Lead ③ 成立）**：fetchWrangler（`scripts/check-d1-remote-usage.mjs:133-148`）确实 spawn `node wrangler.js d1 info <db> --json`，rc≠0 ⇒ UNREACHABLE，解析 stdout，且 **rows_read_24h/rows_written_24h 任一键缺失 ⇒ UNREACHABLE，不补 0**（:142-144）。数字来自 wrangler 真实 stdout，不是脚本编造。

**伪的一面（Lead 未掌握的决定性反证）**：wrangler 4.145.0 的 `d1 info` **自己也是查 GraphQL `d1AnalyticsAdaptiveGroups`**，而它对 authz 错误的处理是**掩码成零**：

- 本机 `node_modules/wrangler/wrangler-dist/cli.js` d1 info handler 源码（已逐字提取）：
  ```js
  const metrics = { readQueries:0, writeQueries:0, rowsRead:0, rowsWritten:0 };
  if (graphqlResult) {
    graphqlResult.data?.viewer?.accounts[0]?.d1AnalyticsAdaptiveGroups?.forEach(row => { metrics.rowsRead += row?.sum?.rowsRead ?? 0; ... });
    output.rows_read_24h = metrics.rowsRead;   // ← 即使 data=null（authz 错误），forEach 不执行，metrics 保持 0，键照样写 0
    output.rows_written_24h = metrics.rowsWritten;
  }
  ```
- `fetchGraphqlResult` = `const {response:json2}=await fetchInternal(...); if(json2) return json2; else throw`。**它只判 body 是否 truthy，不判 `json.success`、不判 `errors`、不判 HTTP 状态**（`fetchInternalBase` 对非 2xx / GraphQL errors 一律不 throw，只回 {response,status}）。
- ⇒ **GraphQL 回 HTTP 200 + `{data:null, errors:[authz...]}` 时，graphqlResult 仍 truthy，data 可选链落空，metrics 全 0，rows_*_24h 键照写 0**。fetchWrangler 的「键在场」检查（:142）**区分不了「量到 0」与「authz 盲被掩成 0」**。
- 脚本头注（:14-20）引 workers-sdk `info.ts:101-120`「取不到时整键省略」——**该前提在 4.145.0 已漂移**：错误 body 是 truthy，键不会省略。这是生产者的版本漂移信任 bug，独立于 Lead 补丁。

**当前实例的证据链（强烈指向掩码，非真实 0）**：
1. 回执 `docs/d1-remote-usage.json:21-26`：graphql state=UNREACHABLE，reason=`authz not authorized for that account`，byDateUtc=[]。该 reason **无 `HTTP=` 前缀** ⇒ 走的是 :120-123 的 `j.errors` 分支 ⇒ **res.ok=true ⇒ HTTP 200 + GraphQL errors**（authz 是数据集/账户级，与查询形状无关）。
2. 回执 :28-39：wrangler state=VERIFIED，rolling24h=0/0/0/0 @16:39:50.135Z —— 比 graphql 取数（16:39:46）**晚 7 秒**。
3. wrangler 调试日志 `%APPDATA%/xdg.config/.wrangler/logs/wrangler-2026-11-16_16-39-50_788.log`：`POST .../graphql` → `START CF API RESPONSE: OK 200` → 紧接输出 rows_*_24h=0（RESPONSE body 被 sanitize 省略，未能逐字读到 errors，但 200+零输出与掩码路径完全吻合）。
4. 凭据：`accountResolvedVia=env`（回执 :5）⇒ 刷新时 env 设了 CLOUDFLARE_ACCOUNT_ID；wrangler 非交互成功（我无 env token 的探针当场报「necessary to set CLOUDFLARE_API_TOKEN」rc=1）⇒ **刷新会话几乎必然也设了 env CLOUDFLARE_API_TOKEN**。wrangler `getAPIToken` 优先 env ⇒ **两通道用同一枚 token**。同一 token、同一账户、同一数据集、相隔 7 秒：直连显式报 authz 拒绝，wrangler 走「错误 body→truthy→data 落空→写 0」路径 ⇒ **wrangler 的 0 就是同一 authz 拒绝被掩码的结果**。
5. 旁证：OAuth scopes（default.toml，仅读元数据）= account:read/d1:write/pages:write/workers:*… **无任何 analytics read scope**；expiration_time=2026-11-08（已过期，我探针拿它直连得 HTTP 401，证明 toml 里是陈旧 token，刷新时 wrangler 用的是 env token 或自动 refresh 后的凭据，两者都缺 analytics）。
6. 反常识：HEAD 旧回执（11-03）wrangler rolling24h=**rows_read 8093 / rows_written 44**（真实流量）；线上站点 + 每日 uptime-check 巡检活跃，11-16 整 24h **读=0 写=0** 本身可疑，与「authz 盲掩成 0」远比「真 0 流量」自洽。

**Q1 判定**：数字非脚本编造（真 wrangler 输出），但**不是已证实的真实远端读数**。存在**已从源码证实的掩码机制** + **当前实例的强证据链**，指向 0/0 = authz 盲区被掩码。把它当「真实读数」登记进 facts 并让 F2 转绿 = **伪绿（盲区冒充零）**，正是本仓判据反复立的红线「0 与不知道必须可分」（check-d1-remote-usage.mjs:17）、「盲区不是零」（check-governance-framework.mjs:255-256/281/394-395）、「未验不得折绿」（:363-364）。
**唯一未逐字取证的一环**：16:39:53 那次 graphql 响应 body 被日志 sanitize 省略。可用一条命令坐实（见 ③ 验证式）。在此之前，按现有证据应判「高度可能掩码」，而非「已证实真实 0」。

### Q2 rolling24h 能否当 LastDay？dayUtc 取 retrievedAtUtc 日期是否合理？—— **口径不成立，错标**

- rolling24h 窗 = [取数时刻−24h, 取数时刻]。16:39 UTC 取数 ⇒ 窗覆盖 **11-15 16:39 → 11-16 16:39**，跨两个 UTC 日，既不是「最后一个完整 UTC 日(11-15)」也不是「今日至今(11-16)」。
- 补丁 `dayUtc = retrievedAtUtc.slice(0,10) = 2026-11-16`（check-governance-framework.mjs:188）⇒ 登记事实读作「**2026-11-16 这一 UTC 日** 写 0 读 0」，但数据实为跨日滚动窗合计 ⇒ **语义错标**，即使数字是真的也标错了日子。
- F2 对账意义：F2 比的是「册 ⇄ computeFacts」。把册同步成同一函数的输出后，F2 对该事实变成**自洽恒真**（两边同源同口径），不再守护「登记的最后一日用量 ⇄ 量到的最后一日用量」。**F2 比较逻辑没变，但它守护的事实定义变了** —— 从「graphql 按 UTC 日分组的最后一日」变成「wrangler 滚动窗合计贴取数日」。这不是「对账语义不变的实现细节」，是**被判据登记的事实本体口径变更**。
- 文档漂移：`docs/governance/README.md:31` 仍写 d1Usage=「最近一个 UTC 日的行写/行读读数」，回退态下已不准确（F11 标签表不覆盖 d1Usage，机器不抓，但人读口径已谎）。

### Q3 有无更干净修法？(a) 允许 null (b) F2 豁免缺键 (c) wrangler 回退 —— **都不如根因修；(c) 最不改 F2 逻辑但引入伪绿**

- **(a) 册允许 null/UNVERIFIED**：F2 walk（:350-351）`cur===null ⇒ missing ⇒ UNVERIFIED rc=2`。要让 null 转绿必须改 walk 豁免 null 叶子 ⇒ **把「没量到」折成绿**，直接违反「缺键≠通过」（:363-364）。比 (c) 更伤判据原则。否。
- **(b) F2 对 d1Usage 缺键豁免**：同 (a)，改 F2 本体语义、 weakening 门禁，A3。否。
- **(c) wrangler 回退（Lead 已实施）**：F2 比较逻辑确实不动、与 A11「任一通道 VERIFIED」（lib/d1-quota.mjs:48）口径对齐、可回滚 —— 这些是优点。**但**它把 A11 的「轻信」复制给 F2：当前 wrangler VERIFIED 本身建立在掩码零上（Q1），**F2 原本是更诚实的那个消费者（graphql-only，拒绝盲零），补丁把它拉到和 A11 一样轻信**。方向反了。
- **(d) 根因修（最干净）**：恢复 graphql 通道授权 —— 给刷新用的 CF token 补 **Account Analytics:Read**（或换有该权限的凭据），byDateUtc 重新有值，d1Usage() 按原设计（HEAD :171-177）工作，**零代码改、零口径改、零掩码**。F2 红是 Lead 刷新时用了缺 analytics 的 token 把 graphql 打成 UNREACHABLE 才新引入的（HEAD 回执 graphql VERIFIED、byDateUtc 7 项、last=[2026-11-03,{rowsRead:5030,rowsWritten:21}]，d89ddab/旧 run governance=success 佐证）。**这是凭据 scope 漂移，不是判据 bug**。属 A4（外部凭据）⇒ 须先问用户。
- **(e) 若凭据短期修不了**：诚实态 = 两通道皆盲 ⇒ d1Usage 回 null ⇒ F2 UNVERIFIED rc=2 ⇒ gates 红。要带红部署须用户**显式批准临时豁免**（A3 改门禁语义），不能由 Lead 自决折绿。或修 fetchWrangler 让它识别 authz 掩码（cross-check graphql authz ⇒ wrangler 零不可信 ⇒ 判 UNREACHABLE），恢复「盲区不是零」，但这同样不解锁部署，只恢复诚实。

**最不改判据语义/最可回滚/最不伪绿 = (d) 根因修凭据**；(c) 是「最不改 F2 代码」但**最伪绿**（当前实例）。(a)(b) 既改语义又伪绿，最差。

### Q4 改 d1Usage() 是否被测试钉死？会否连坐？—— **无测试钉死，无连坐（Lead ① 成立）**

- 全仓消费面（定向 grep scripts/tests/docs/.github/functions/src/public/memory，绕开根目录 `nul` 设备名导致的 rg exit 2）：d1Usage 仅出现在 `scripts/check-governance-framework.mjs:171/226`（定义+computeFacts）与 `docs/governance/registry.json:55-60`（facts）。`rowsWrittenLastDay/rowsReadLastDay` 仅这两处 + 脚本头注。`remoteUsageClaim` 消费者 = check-d1-remote-usage.mjs:267 / check-d1-roundtrips.mjs:386,422 / tests/d1RemoteUsage.test.js:25，**均不碰 d1Usage**。
- `tests/governanceFramework.test.js`（140 行，已全读）：import 的是 evaluate/collectRegistryIds/sourcePathsOf/DOC_FILES/DOC_DIR，**不 import d1Usage、不钉其值/通道**。测的是 --selftest N/M、CLI 三态、M1（contractActions.web=999）、M2（文档清空）、F3/F10/F11/F12 纯函数合成面。**改 d1Usage 不破任何断言**。
- `tests/d1RemoteUsage.test.js:12` ROLL={rows_read_24h:24709,rows_written_24h:81} 只喂 remoteUsageClaim/U 腿，与 d1Usage 无关。
- F2 walk 是通用逐叶子比对，其他 12 组 facts 不受影响；实测补丁后 live run = **12 通过/0 失败/0 未验 rc=0**（我独立复跑确认），无连坐。
- ⚠ 但「无测试钉死」≠「修法正确」：测试没钉 d1Usage 的**取数通道与口径**，恰恰意味着 Q1/Q2 的语义/真伪问题**没有机器闸看守**，只能靠人复核 —— 本复核正是补这一面。

### Q5 是否触及 rule50 A3「改判据本体/门禁语义」须先问？—— **触及 A3（事实本体口径变更）；根因修触及 A4（外部凭据）**

- Lead 框定「F2 对账语义不变，只补齐现算取数源、与 A11 对齐」——**对 F2 比较循环成立，对被判据登记的事实定义不成立**。d1Usage 从「graphql 按 UTC 日最后一日」变为「wrangler 滚动 24h 贴取数日」，**事实本体口径变了**（Q2），且把盲零登记成 0（Q1）⇒ 属 A3「改判据本体/门禁语义」边缘 ⇒ 按 rule50 应先问用户，不应自决。
- 根因修 (d) 改 CF token scope = **A4 外部凭据** ⇒ 必须先问。
- 项目 AGENTS.md「需要拍板一律自决」与全局 #31/#37/#48 零回抛，**在 rule50 A 组处让位**（P0.19 + rule50 明写「#31/#37/#48 的零回问只在命中 A 组这一处让位」）。本件命中 A3/A4 ⇒ 自决折绿越线。
- 另：本仓「盲区不是零/未验不得折绿/禁改现值凑绿」是判据源码里反复立的硬原则（Q1 引文），补丁把 authz 盲零折成 facts 绿，**与项目自身判据哲学相悖**，不只是 rule50 问题。

---

## ② 明确推荐：**RECOMMEND=REJECT**（反对以当前补丁作为部署解锁依据）

理由排序：
1. **伪绿（致命）**：当前 0/0 高度可能是 wrangler 4.145.0 把 GraphQL authz 错误掩码成零（源码机制已证实 + 同 token 同账户 7 秒内直连显式 authz 拒绝 + 日志 200+零输出 + OAuth 无 analytics scope + 旧回执真实流量 8093/44 反衬）。把盲零登记成「最后一日 0 行」并让 F2 转绿，违反本仓「盲区不是零」红线。
2. **口径错标**：rolling24h≠LastDay，dayUtc 贴取数日跨两 UTC 日，事实定义被改（A3）。
3. **方向反了**：F2 原是更诚实的消费者（拒盲零），补丁把它拉到与 A11 同样轻信掩码零；应修凭据/收紧 A11，而非放松 F2。
4. **越 rule50 A3/A4**：事实本体口径变更 + 根因是外部凭据 scope，应先问用户，不应自决折绿。

**不否认的优点**（供 Lead 对照）：数字非脚本编造、F2 比较逻辑未动、与 A11 通道口径对齐、无测试连坐、可回滚、registry source 字符串已诚实标注回退口径。这些使补丁「机械上干净」，但**机械干净 ≠ 事实为真**；致命处在取数源真伪与口径，不在代码形态。

**改判条件（若 Lead 能坐实下列任一，可复议为 APPROVE-with-caveats）**：
- 用刷新时同一枚 env token + `WRANGLER_LOG_SANITIZE=false` 重跑 d1 info，日志 RESPONSE body 显示 `data.viewer.accounts[0].d1AnalyticsAdaptiveGroups` **有数据/空数组而非 errors** ⇒ 零是真实量到，掩码反证被推翻；**且**把事实改名/标注为 rolling24h 口径（不再谎称 LastDay）、README:31 同步 ⇒ 仅剩 A3 口径变更须用户批准。
- 或给 token 补 Analytics:Read 后 graphql byDateUtc 恢复有值 ⇒ 直接走根因修 (d)，回退补丁可整段撤销。

---

## ③ 因 REJECT：不给「批准补丁」，给撤销 + 根因修 + 坐实命令

**A. 坐实/证伪掩码（一条只读命令，Lead 可立即跑，需刷新时同一 env token）**：
```powershell
$env:WRANGLER_LOG_SANITIZE='false'
node node_modules/wrangler/bin/wrangler.js d1 info supermarket --json
# 读 %APPDATA%/xdg.config/.wrangler/logs/ 最新日志里 POST /graphql 的 RESPONSE body：
#   含 errors:[{...authz...}] 且 data:null  ⇒ 掩码零坐实（REJECT 成立）
#   含 data.viewer.accounts[0].d1AnalyticsAdaptiveGroups:[]（无 errors） ⇒ 真实零（掩码反证推翻）
```
（我无 Lead 的 env token，无法代跑此步；toml 陈旧 token 直连得 401，已记录。这是本复核唯一未逐字取证环，其余均有源码/日志/回执佐证。）

**B. 撤销补丁（回滚到 HEAD 诚实态）**：
- `scripts/check-governance-framework.mjs` d1Usage() 还原 HEAD :171-177（graphql-only，删 :176-191 回退段）。
- `docs/governance/registry.json` facts.d1Usage 还原 HEAD :55-60（21/5030/2026-11-03 + 原 source）。
- ⚠ 撤销后 F2 恢复 UNVERIFIED rc=2（因工作树回执 graphql 盲）⇒ **gates 仍红，但红得诚实**。撤销不解锁部署，只止伪绿。

**C. 根因修（解锁部署的正路，A4 须先问用户）**：
- 给刷新/CI 用的 CLOUDFLARE_API_TOKEN 补 **Account Analytics:Read**（或换有该权限凭据），重跑 `node scripts/check-d1-remote-usage.mjs --write` ⇒ graphql VERIFIED、byDateUtc 有值 ⇒ d1Usage 原设计工作 ⇒ 同笔同步 registry ⇒ F2 真绿 ⇒ gates 绿 ⇒ deploy 自动触发（ci.yml:472 needs:[gates,...]）。
- 凭据变更属 A4，**先问用户**（rule50），不自决。
- 若用户短期不批凭据：诚实态 = gates 红（F2 UNVERIFIED）。带红部署须用户**显式批准临时豁免 d1Usage**（A3），并落待办三处带卡点+实测+下一步，禁静默折绿。

**D. 生产者加固（独立于部署，建议另起一轮）**：修 fetchWrangler 识别 authz 掩码（如 graphql 通道 authz UNREACHABLE 时，wrangler 的零不可信 ⇒ 判 UNREACHABLE 或加 cross-check），恢复「键在场≠量到」；并更新头注 :14-20 对 wrangler 4.145.0 的漂移描述。否则 A11 的「wrangler VERIFIED」在 authz 盲场景下同样伪绿（本件已暴露 A11 也建立在掩码零上）。

---

## ④ 风险与回滚

| 项 | 评估 |
|---|---|
| 补丁机械风险 | 低：无测试钉死、无连坐、F2 逻辑未动、可回滚（B 段两文件还原 HEAD）。 |
| 补丁事实风险 | **高**：把 authz 盲零登记成「最后一日 0 行」，F2/A11 双绿建立在掩码上；线上若真有流量而登记 0，配额/体量治理事实失真，后续 F10 余量联动、bl-orders 等指标读数被污染。 |
| 口径风险 | 中：rolling24h 贴 LastDay 错标，README:31 人读口径已谎；F2 对该事实变自洽恒真，失去守护意义。 |
| 治理风险 | 中：越 rule50 A3/A4 自决折绿；与项目「盲区不是零/禁改现值凑绿」判据哲学相悖；ci-triage 口径下属「真判据红（测量盲）」，正路是恢复测量而非改代码绕绿。 |
| 回滚 | B 段两文件还原 HEAD 即回滚补丁；但回滚后 gates 恢复诚实红（F2 UNVERIFIED），部署仍阻，须走 C 根因修或用户批准豁免。 |
| 部署路径建议 | **不要以当前伪绿解锁 deploy**。先跑 A 坐实掩码 → 走 C 问用户补凭据 scope → graphql 恢复 → F2 真绿 → deploy。若用户批临时豁免则按 A3 显式记录后带红部署，落待办三处。 |

---

## 自证
`Get-Content _incoming/rust-deploy/f2-review.md -Tail 3` 应回末三行（含 VERDICT 行）。
本复核只读：未改任何源码/判据/登记册；唯一写面 = 本文件。独立复跑 live governance：补丁前 F2 UNVERIFIED rc=2（缺 d1Usage 三键），补丁后 12 通过/0 失败/0 未验 rc=0（确认 Lead 实测，但绿建立在掩码零上）。

VERDICT=F2_REVIEW_DONE + RECOMMEND=REJECT
