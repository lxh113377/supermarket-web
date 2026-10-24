# 07 分卷 36 —— 对标第二十四轮（2026-09-27）：门禁的入口通道有没有被真跑过

> 主卷指针；报告在外层 `deliverables/GitHub开源项目对标分析报告-第二十四轮-2026-09-27.md`。
> 回滚锚 `bfd7381`；备份 `/c/_sm_backups/r24-start-bfd7381.bundle`（`git bundle verify` = complete history）。
> 代码提交：`548fb1c`（入口修复 + `verify:entrypoints`）、`2f96176`（出境面收敛）。

## 本轮事实（都有可复跑证据）
- pre-push 闸的 stdin 通道**从未生效**：`fs.readFileSync(0)` 在 `.mjs` 里抛 `ReferenceError`（模块无 `fs` 标识符），
  被 `catch { line = '' }` 吞成"git 没给 ref 行" ⇒ 每次推送审的都是契约默认分支（实测：推 feature-x 报 branch=main）。
  注意 `node -e` 里 `typeof fs === 'object'`（Node 24 eval 语境自带全局）——**用 `-e` 探不到这个坑，必须落到真实模块**。
- 第二个缺陷紧挨着它：`(.+)$` 贪婪吞掉整行 ⇒ **只修第一个会让闸门 100% 判红**（ls-remote 拿带空格的"分支名"必然取不到）。
- 类级普查：登记面 34 个可执行入口（package.json ∪ .githooks ∪ workflows），本轮之前子进程真跑过的只有 **10** 个；
  现在 **23**（+14 条探针，其中 `check-functions-build` 等 3 道具名豁免、8 道具名缺口，理由带实测依据）。
- `core.hooksPath` 此前**零登记** ⇒ 新克隆静默无门禁（`.githooks/` 进仓但那行配置不进 clone）。已补 README/CONTRIBUTING 并由 G5 钉住。

## 后半卷

- 本节之后的全部段落逐字迁至 `07-next-steps.part178.md`（round-4 I-78-6 续拆，迁出零删句；sha256 恒等断言当场跑过）。
