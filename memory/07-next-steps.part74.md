# 07 分卷 74 — 2026-09-28 对标第四十三/四十四轮一手记录

> 报告：外层 `deliverables/GitHub开源项目对标分析报告-第四十四轮-2026-09-28.md`；
> 内层轮初锚 `eb3b1be`。本卷只记**一手读数**，处置结论在主卷 P0。

## R43-P0 已闭合：跨文件 import 那一类推不出 ⇒ 换方向，跑一遍看盘

`scripts/check-judge-side-effects.mjs` 把每个候选解进一次性 `git archive HEAD | tar -x` 快照跑两趟
（默认 args / 显式写盘 args），逐文件比 **sha256 与 mtime 两把尺**。本机实测：候选 9 件、静态推不出 3 件、
**实测改写面 3 个产物**。一手缺口被证实：`check-d1-roundtrips.mjs --update-write-quota` rc=0 且改写
受版本控制的 `docs/d1-write-quota.json`，而静态推导对它判零风险（目标是 import 常量）。
裸快照跑不动的那条也实测过：缺 `node_modules/@babel/parser` ⇒ rc=2，**探针自己失败不得读成"它不写产物"**
⇒ 快照里以 junction 接 `node_modules`。

## 第四十四轮四条修复（每条都有"改坏必翻红"的夹具）

1. **采集器自己坏了**：`check-cli-entrypoints.mjs` 的 `scanBrackets()` 进字符串写 `state = c`（引号字符），
   分支判的却是 `'sq'|'dq'|'tpl'` ⇒ 字符串**从来没被跳过过**；串里的 `/*` 起假块注释吞掉文件后半段。
   事故面 `tests/docCommands.test.js:96` 的 `.github/workflows/*` ⇒ `spawnSync(` 配不上对 ⇒ 覆盖少记 ⇒
   G2/G8 把**已有真跑夹具**的 `check-doc-commands.mjs` 报成"未登记缺口"。修后覆盖 34→35
   （复算：`collectCovered().size`）。
2. **写开关按整词认**：`--update` 是 `--update-write-quota` 的子串 ⇒ 旧写法虚增通道。探针取 `writeFlags[0]`
   恰好仍是对的 ⇒ 缺陷只污染登记册，属"看不见就不会坏"的那一类。
3. **"没测到"不得冒充"没有"**：S5 的静态幽灵不指控 HEAD 里还没有的新件；S3 的幽灵按**生产者**归位免责
   （写通道 rc≠0 / 未触达 ⇒ 印"未复核 N 个"）。CI 无 CF 凭据时 `check-d1-remote-usage --write` 即此形。
4. **缩面档位 `--blind-only`**：CI 只测盲件（全量 9 件 ≈300s ⇒ 盲件 3 件 **76s**，`time` 实测）；
   取数面印在门面行，缩面读数不得冒充全量核过。

## 两处并发一手（同 `scripts/session-worktree.mjs` 的动机，本轮再犯两次）

- `npm run verify` 第一次在 `verify:volume` 判红：`07-next-steps.part72.md 4333B > 3072B`；
  20 秒后同一路径实测 **2637B**、`git diff HEAD` 为空 ⇒ 那是**并行会话写到一半的撕裂读**，不是缺陷。
  启示：共享工作树里的体积/内容型门禁会读到中间态，红一次要先复测再归因（第二次 `VERIFY_RC=0`）。
- `scripts/check-backup-liveness.mjs` 的 mode 措辞改动由另一会话作出（标注它的 R43-H1），
  本轮按 pathspec 提交时**未**带上它 ⇒ 记此以免后来人按 SHA 找归属时误判。
