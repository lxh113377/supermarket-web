# 07-next-steps.part22.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- [ ] 不变项（需人/需权限）：K3 线上管理端目视复核（要生产密钥）、`CF_D1_BACKUP_TOKEN` 路线选择（非 private 会响亮失败）、D2 49 单运营处置、R2 桶、D1↔seed 对账、order 41 生产行订正、28/55 上架口径。
- [ ] 维持不改：N4 执行模型（低负载 5 连跑 0 OOM）、M2 CoC（对标组 1/8）、M3 diff-cover（0/8 在 CI 卡覆盖率 + 本机无该工具）、本轮新增的 5 条"不做"（zizmor 三件套 / 分支保护即代码【否】9 仓 0 家 / vite 聚合必检 job / changesets / 投递台账）—— 各自的证据写在第十轮报告 §4。

## 2026-09-26 — 对标第九轮（门禁链自测 + 双端发布一致性；提交 `028d99b` → `e8b400f`）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第九轮-2026-09-26.md`

- **已落地并 CI 复验**：`tests/ciWorkflow.test.ts` + `tests/gateFixtures.test.ts`（27 条，钉住"needs 是否真阻断 / actions 是否仍钉 SHA / 关键 step 是否改名即消失 / 4 道门禁脚本必红必不红两侧"）；`scripts/verify-release-parity.mjs` + 独立 workflow `release-parity.yml`（CI 完成后核两端同批）；`.github/ISSUE_TEMPLATE` 三件；覆盖率棘轮 statements 78→79。CI run `36233250786` 五 job 全绿、`36233342757` parity success。
- **本轮最硬的一条判据（写死，勿再犯）**：**判据放错位置 = 造一台会误报的机器**。双端一致性首版挂在 deploy job 里，CI 复取 6 次跨 247s 仍判红（顾客端链路与本 job 并行）；搬到 `workflow_run` 后同一判据 1 秒通过。⇒ 任何"核 A 是否追平 B"的判据，必须先问 B 那条链路是否被本 job 之外驱动、且必须给出覆盖对端耗时的阶梯。
- **同轮三处"过严判据"自纠**（过严与缺失同样有害，均留常驻样本）：结构判据要求 `attributes` 紧跟 `- type:`（合法是 `type→id→attributes`）；"git 前必须 checkout"的正则无法判位置；夹具只改 `cwd` 而门禁脚本按**自身文件位置**锚根（扫到的仍是真仓，症状＝输出"已跟踪 530"）。
- **本仓密钥门禁两次正确拦下我自己**：夹具里的完整假密钥字面量、CHANGELOG 里原样引用它的那句说明。⇒ 静态文件里不留完整密钥形态（夹具要真形态就运行时拼接）。**新盲区**：`scan-secrets` 扫 `git ls-files` ⇒ 未跟踪文件不在本地 `verify` 覆盖内，"本地绿"可能只是"没扫到"。

### P0（第十轮开工先做这条，可执行）

- [x] **新订单通知（webhook）**：本轮已把设计约束钉死——① 未配 secret 必须 **no-op 且不改订单状态、不消耗重试**（照 `minshop` `env.EMAIL` 未配即 `return null` + `litemall` `isMailEnable()` 的形态，各带一条反例）；② 通知失败绝不让下单主链路失败（对齐既有"失败不冒泡"不变量）；③ 需要 `DASHBOARD_WRITE_ACTIONS` 之外的新登记位时同步文档。命令预检：`grep -n "env.EMAIL\|isMailEnable" `（在本地 clone 的对标仓里）＋ 本仓 `grep -n "DASHBOARD_WRITE_ACTIONS" functions/lib/backend.js`
- [x] **parity 判据的"bundle 不同名"分支补真反例**（本机凑不出两端不同构建）：在 CI 侧以 `CUSTOMER_URL` 指向一个已知的旧批次 URL 或加 `--selftest` 双 fixture 站，否则该分支永远未覆盖。
- [x] **K4 PR 流试点**：现成场景=下一次真实改动走分支→PR→看 CI（含 `release-parity`）→自并。理由：本轮 dependabot 六条已证明"CI 独立复核"能抓到我本机抓不到的东西（parity 位置错误就是 PR 侧 CI 抓的）。
- [ ] N4 执行模型：**维持不改**，除非无人值守时复现 OOM（本轮低负载 5 连跑 0 OOM、wall 29s→10~11s 已归档）。候选仍是 `pool:'vmThreads'`/`isolate:false`/`maxWorkers`，且禁止抬 `testTimeout` 掩盖机制缺陷。
