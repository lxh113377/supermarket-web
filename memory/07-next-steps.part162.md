# 07-next-steps.part162 — 第七十四轮（续 part161：性能重采 + 下一轮 P0）

## I-74-4 性能维重采（中）

- cadence 7 天，上一完整批次 10-08 已 9 天 ⇒ `report:live-perf` RED（「没人喂」那条腿点名）。
- `npm run collect:live-perf -- --run` 批次 `t1004`：两页预飞各 200，6/6 份采到（admin×3 + customer×3）。
- `npm run report:live-perf` 转 **GREEN**：入统计 39／未采到 0／产物不符 0／恒等式 ✓；批次组 13/13 完整。
- 读数注记（不折进基线）：跨日两批 admin 中位数最大偏移 100%、customer 35.7% ⇒ 立线余量要按偏移算。


## I-74-5 HANDOFF 实测戳复核（中·本轮一并做）

- 一手：戳停在 2026-09-05，龄期 42/45 天（`verify:docs` 的 E 组当次印出「实测戳龄期 = 42 天」），3 天内必到阈值。
- 复核方式：**戳与戳内每个读数一起重取**，不是改日期了事——
  CI run `39030653008` `completed/success`（六 job 全 success，含 deploy）／
  `npm run verify:backend` **204 通过 / 0 失败**／`/_health` 回 `deploy=9cdf0dc` == HEAD。
- 就地更正同段过期事实：「本地有 185 条后端断言背书」→ **204**（当次实测；原值来自第五十六轮，已过期）。
- 凭据：`npm run verify:docs` ⇒ **实测戳龄期 = 0 天**、9 项全 OK；「单测文件数（交接文档）= 133」仍逐条相等。
- 注：用例条数**不写死**（判据口径：写死即第二真相源）——所以本轮没有为了"戳里有个数字"去跑全量用例并抄条数。

## 本轮凭据

- `npm run verify` ⇒ VERIFY_RC=0（后端 204 通过 / 0 失败；含 lint/case/env/csp/images/eol/cli-legs/cycles/contract/
  contract-diff/gate-parity/openapi/response/registry/docs/doc-commands/schema/migrate-replay/roundtrips/authz/limits/
  errors/logs/event-sink/pii/entrypoints/restore-drill/licenses/volume/pointers/changelog/escape-hatch/delivery-claims/
  typecheck/test/verify:backend/verify:functions/list-uncovered 全段）。

## 下一轮 P0（写死，可证伪）

1. 推送后读回新 run：`npm run ci:status` 部署判定须「已发生」，`check:live-shape` L3 线上 sha == 远端 head。
2. `HANDOFF.md` 实测戳龄期 42/45 天——3 天内必到阈值，到期轮重取全链读数并回填戳（I-73-7 续账）。
3. branch protection 仍 `NOT_ENFORCED`；`CF_D1_BACKUP_TOKEN`/`BACKUP_PASSPHRASE`/CF GraphQL 读权限仍缺
   （agent 无权，需老大在 GitHub/Cloudflare 侧配置）。
4. erpnext 已进 v16（近 30 天 2153 提交、star 40260）⇒ 下一轮 peers 名册读数整体跳一档，§2 对比表按当次实测重写。
