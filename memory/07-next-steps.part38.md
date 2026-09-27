# 07 分卷 38 —— 对标第二十六轮（2026-09-27）：输入「在但为空」时判据说什么

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第二十六轮-2026-09-27.md`。
> 回滚锚 `56f485e`；备份 `/c/_sm_backups/r26-start-56f485e.bundle`。代码提交 `087c647`。

## 与上一轮的本质区别
`requireInputs` 只看**存在性** ⇒ "文件全在、内容全 0 字节"一路过关。做法：镜像整棵目录树、非 `scripts/` 文件
一律写 0 字节，再逐条真跑 22 个门禁类入口。基线：**2 个 rc=0（装绿）+ 2 个裸栈**。
- `check-schema-drift`：「==== 结果: 0 通过 / 0 失败 ====」+ rc=0（文件在、解析出 0 个对象 ⇒ 原有"没有迁移文件"守卫不响）。
- `check-import-cycles`：「扫描模块: 84 个 / 未检测到循环依赖」+ rc=0（0 条边的图上"无环"为真，却什么也没证明 ⇒ 现要求边 ≥10，实测 src/ 单侧 275 条）。
- `check-error-semantics`/`verify-backend`：空 `package.json` 让 Node 先崩在 `package_json_reader` ⇒ 动态 import 前先 `requireJson`。

## 口径（本轮定版，别再用文字复述）
三类覆盖互不替代：①判据路径真跑（14，rc=0 且有结论）②缺输入面真跑（22）③零分母真跑（22）。
退出码 **2=环境不满足 / 1=判出违规 / 0=通过**；缺输入统一出口 = `scripts/lib/preflight.mjs`
（`bail` / `requireInputs` / `requireParams` / `requireJson`，本轮把 6 个自带文案的门禁并进来）。

## 两条可跨项目复用的教训（本轮又踩/又抓）
1. **文案就是契约**：统一 fail-closed 文案当场打断两条钉住旧词（`参数缺失`）的断言。断言要钉"形状 + label"，别抄整句。
2. **共享件依赖别让每个夹具各解析一份**：`gateFixtures` 与 `migrateReplay` 各写一份"连 lib 一起拷"，
   一份生效一份漏改 ⇒ 收成 `tests/helpers/copyGateScripts.mjs`，依赖清单从**脚本自身源码**解析（不手抄）。

## 下一轮 P0（本轮未做，别当成已做）
1. R26-M2：同一骨架仓法换分母，把"0 对象"普查从门禁类扩到 `report:*` 与未纳入的运维脚本；顺手 R26-L1（G8 门面行印三类覆盖数）。
2. R25-M1：8 条具名入口缺口每轮收 2~3 条，G4 地板随实上调。
3. M3（仍受阻）：服务端 Required checks 需用户在 GitHub 分支保护里开；本机钩子在新克隆 / `--no-verify` / CI 直推三种情况下都不生效。
4. 数据面旧账（`rate_limits` 按 `resetAt` 清理、`paymentScreenshot` 终态保留通道）：会删数据的通道须先登记分母 + report-only 一轮。
