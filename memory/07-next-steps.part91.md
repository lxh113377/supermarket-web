# 07-next-steps 卷 91 —— 第五十二轮（2026-09-29）台账明细（下）

> 本卷是卷 90 的后半（V4 出生余量 3,072B 逼出来的拆卷，2026-09-29）。

## 挂账续（R51-H5 与工具链坑）

- **R51-H5 继承（通用解释器分派）仍不触发**：别名里的非 node 入口实测仍是 1 条（`verify:images` 走 python）。
  触发条件＝出现第 2 条时才做。
- **fresh-dir 构建的目录名必须落在 gitignore 面内**（本轮一手）：`--outDir .r52build` 不在忽略面 ⇒
  `npm run lint` 把 minified 产物算进站面，实测 3,428 warnings / 1,977 errors；删除后 0/0（290 files）。
  `前提=` 任何 fresh-dir 构建后跑一次 `npm run lint` 即复现。


## 用户侧不变项（禁止 agent 擅动）

- `CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺 ⇒ 备份链 `artifact=0`，具名豁免至 **2026-10-12**。
- M3 分支保护沿用 2026-09-28T07:12:31Z 实测 `NOT_ENFORCED`。微信真机验收未做。
- 后台密钥强度是用户拍板的取舍（明文曾进公开仓 git 历史，用户 2026-09-26 明确选择承受该风险换手机登录便利）
  ⇒ **禁止擅自"加固"成随机串**；转 public/共享前才必须轮换 + 重新部署一次让旧值作废。

## 挂账（本轮 CI 红换来的那条）

- **R53-H4 「正文写完 → 重生台账 → 全链 verify → 提交」要变成机器拦**（本轮一手：`41b4370` 的
  `build-and-test` 判红 `mentions 226→230`，根因是我在 CHANGELOG/卷 90/91 落笔**之前**跑了 `--update`）。
  现状不对称：`check:doc-commands` 的 D7 对 counts 漂移**只报不拦**（`登记册 漂移：…` 照样 verdict=GREEN），
  真正拦它的是 `tests/docCommands.test.js` 里的两条腿 —— 也就是"跑门禁命令绿、跑测试红"。
  `前提=<可复算>`：`node scripts/check-doc-commands.mjs | grep -c '漂移'`（有漂移仍 rc=0 即证）。
  候选形态（下一轮择一，禁一次全上）：① pre-push 加一条 `check:doc-commands --check`；
  ② `verify` 链里把 D7 的 counts 漂移从"报"升成"拦"；③ 让 `--update` 之后自动复跑一次 `--check` 并印差值。
  验收必须含"一次正常提交能变绿"（户内规：拦下来而自身无解 = 判据缺陷）。
