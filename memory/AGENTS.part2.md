# AGENTS.md 分卷 2 —— git 操作防静默失败（2026-10-26 自本卷主卷拆出）

> 主卷 `AGENTS.md` 超 4KB 铁限拆卷；本卷存逐字原文，规则本体未变。

- **git 操作防静默失败**（2026-09-05 实测坑）：① git 命令**禁用 `| tail`/`| head` 等管道吃 exit code**——失败会静默进 `&&` 链继续执行后续命令；② 新建分支/新 ref 操作后必须 `git branch --show-current && git rev-parse --verify HEAD` 自检 ref 落盘——沙箱 shim 在 npm install 等大 IO 期间可致 ref 写入失败（HEAD 挂 unborn 分支 → commit 变成根提交、父链断裂）；③ 修复法：`git symbolic-ref HEAD refs/heads/main` 指回 main 后直接 commit（index 中 staged 改动完好）；④ 重大升级评估优先 stash + main 直操，少用临时分支。
