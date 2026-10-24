# 07 分卷 178 —— 07-next-steps.part36.md 后半（round-4 I-78-6 拆出，逐字未改）

> 建卷理由：07-next-steps.part36.md 出生即贴线（V4 口径违例），按整段迁卷拆出；前半仍在原卷，其「后半卷」节指回这里。

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
