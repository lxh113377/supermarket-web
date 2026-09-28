## 2026-09-28 — 对标第四十六轮（先把自己的优化假设证伪，再动手）

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四十六轮-2026-09-28.md`；轮初锚 `65f7f74`。
> 上一轮三条 P0 全部闭合：**R46-H1** 全量面 6m49s → **1m37s**，但根因**不是**我写的"两件共用快照省一半"——
> 实测 `git archive` 单次仅 0.86s，真因是一次 `treeHashes` 读 **10,933 个文件、其中 10,225 个来自探针自己
> 接进去的 `node_modules` junction** ⇒ 把依赖树移出读数面（判定不变：6/6、改写面仍 5 个）；
> **R46-H2** 新增 **G13**（别名里的非 `.mjs` 入口不得结构性失踪；真面分母 1 条 `verify:images`→`python scripts/verify_images.py`，
> workflows 里 grep 它 0 处）；**R46-H3** 体积闸加**二次确认 V2b**（撕裂读记 UNVERIFIED，不洗成通过也不冒充违规）。
> 顺带：`parseRegistry` 也写死 `.mjs` ⇒ 连"把漏的东西登记下来"这条路原本都是堵的。第四十五轮整块见**卷 76**。

> **P0（下一轮开工先做这条，可执行）**：**R47-H1 采集目录本身没有正向断言** —— `collectCovered` 只扫 `tests/`，
> 夹具目录一旦改名/移出，覆盖面会静默归零，只能靠 G4 棘轮地板（现 35、地板 23 ⇒ 允许缩掉 12 个才响）兜住。
> 正解＝加一条"采集目录存在、非空、且文件数在合理区间"的正向断言（G14），配一条"把 tests/ 改名 ⇒ 必须判红"的反例。
> **R47-H2 G13 的下一步＝解释器分派**：让 `verify:images` 真进面并按别名里的真实命令 spawn，
> **前提是先量依赖**（`ubuntu-latest` 的 python 有没有该脚本要的库、本地跑一次几秒）——未量不接，
> 也不许为绿把 `.py` 硬塞进 node 探针面（实测 node 起它是 `ERR_UNKNOWN_FILE_EXTENSION` 裸栈）。
> **R47-H3 S6 阈值现在可以谈了**：全量面 1m37s ⇒ "每轮收尾跑一次 `--update`"变成可行选项；
> 动阈值前先出册龄分布（`node scripts/check-judge-side-effects.mjs --max-age-days 0` 会印年龄，取近 N 轮 git 历史里的 observed_utc 序列）。
> **R47-H4 外层指针已到它自己的天花板**：`超市/memory/07-next-steps.md` 本轮 append 后 40,760B，
> 外部 `handoff.py volume` 的 `shell_max=40,960B` 只剩 200B ⇒ 下轮先归档旧轮指针或改口径，**禁**压措辞续命。
> 用户侧不变：**`CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺** ⇒ 备份链 `artifact=0`，
> 具名限期豁免至 **2026-10-12**；M3 分支保护未重跑 ⇒ 记未验证；微信真机验收未做。