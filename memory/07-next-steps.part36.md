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

## 撤回一条上一轮的判据前提
- "aiAdvice 把 `wechat`/`remark` 送进 Dify" **不成立**：那两列只在 SELECT 里被白读，`buildAdviceInput` 只回传聚合量。
  已按线级夹具（整行喂进去、断言请求体无微信号/电话/房间号且必须有 `revenue`）+ 等价夹具（收敛前后 prompt 逐字节相同）改判，
  并加 P12「投影每列必须被下游真引用」+ P8 对偶「零出境必须有点名第三方调用的声明」。
- 上一轮清单里的 H5（getOrders 去 `paymentScreenshot`）前提不成立：该函数从未投影此列 ⇒ 撤单不修。

## 下一轮 P0（本轮未做，别当成已做）
1. **M3 服务端 required checks**：须用户在 GitHub 仓库设置里开（agent 不擅改共享设置）。没有它，本机钩子仍属"自觉"。
2. M1：每轮收 2~3 条具名缺口（建议 `check-pr-has-tests` → `gen-api-doc`（先改 dry-run）→ `ci-status`），G4 地板随实际覆盖上调。
3. M2：`fetchRun` 的 "list 成功、view 失败" 分支缺端到端夹具（Windows 下放假 `gh` 受 `.cmd` EINVAL 限制，需另找注入点）。
4. 保留账不动：`rate_limits` 按 `resetAt` 清理、`paymentScreenshot` 终态保留通道 —— 会删数据的通道须先登记分母 + report-only。

## 本轮自己被自己抓到四处（夹具当场报红，不是人眼复核）
1. `offlineEnv` 先 spread 再 delete，把测试要设的 `CI_GREEN_SKIP` 删了 ⇒ "逃生门缺理由仍拒"测的是没设逃生门（假绿）。
2. 变异体 M1 首版只改条件不改取值 ⇒ **空变异**（测了个没改的分支）。
3. 新门禁 G6 首版"夹具引用不存在的脚本名即判红"被合成夹具的植入名误报 ⇒ 改判"本地钩子入口必须有夹具"。
4. `parseRegistry` 按标题切节时吞了后一张表 ⇒ 三行豁免被误报成"一行挂两处"。
