# 07-next-steps.part161 — 第七十四轮（还第 73 轮立下的下一轮 P0）

> 立卷原因：主卷 V3 只留当轮摘要，正文进本卷；V4 新卷 ≤3072B，拆两卷（本卷 = I-74-1/2/3，part162 = I-74-4 与下一轮 P0）。

## I-74-1 逃生门不再计量 no-op（高）

- 一手：第 73 轮 ②-B 重试循环用 grep 自己的 stdout 当成功判据，同一笔推两次，第二次 base==head（no-op）也被记成绕过
  （`escape-hatch.jsonl` #31/#32，utc 相隔 9 秒）。当时未删行（共享台账，他路会话在途），登记为本轮 P0。
- 修复：`scripts/ci-green-contract.mjs` 逃生门分支先解 head（ref 行 local_sha → HEAD），再解 remoteNow
  （**ref 行 remote_sha 优先**——它与本次推送同批，不会被中途另一笔撞开；取不到才 `ls-remote` 现取）；
  两者相等 ⇒ 打 `SKIP :: 无可推之物…不落账` 且 return 0，不调 `appendEscapeLedger`。
- 夹具两腿 + 变异体 M4：正例断言不落账；对照组断言真绕过（local≠remote）仍落账——证明不是把逃生门关掉；
  M4 只换条件不动大括号（整行替换会让原块体多余的 `}` 提前闭合 main()，`return rc` 掉到模块顶层报
  `Illegal return statement`——那是夹具坏，不是判据红）。
- `npx vitest run tests/ciGreenContract.test.js` ⇒ 57 passed（55→57）。

## I-74-2/3 cron 豁免按新根因换可证伪理由（高）

- 原豁免 2026-10-12 到期已 5 天；C6 连红 3 条（ci-deep 5 次 / d1-backup 7 次 / uptime 7 次），C8 漂移 1（ci-deep 在册旧 step）。
- `--update` 先跑：`observed_failing_steps` 刷到当次实测（ci-deep=[Fail loudly when the gate refused to refresh]）
  ⇒ C8 CONFIRMED 3/3、漂移 0。
- 三条 `accepts_red_until` 统一 2026-11-07；理由按新根因重写（不续写旧理由，第六十九轮的规矩）：
  ci-deep 根因=CI 的 `CLOUDFLARE_API_TOKEN` 缺 GraphQL Analytics 读权限（第三方授权，agent 不得代做；
  本机 wrangler OAuth 可取、CI 不可）；d1-backup 补「仓库 public ⇒ 明文 artifact 会被任意已登录用户下载，
  token 必须与 `BACKUP_PASSPHRASE` 成对」；uptime 按 2 个失败 step 的实际形态重写并同因归并。
- 复算：`GITHUB_REPOSITORY=lxh113377/supermarket-web node scripts/check-cron-health.mjs --require-reason-match`
  ⇒ GATE-PASS 9/9、WARN 3。
- 踩坑：PowerShell `Set-Content -Encoding UTF8` 写出带 BOM 的 JSON，`JSON.parse` 当场炸——用 Node `writeFileSync` 重写去 BOM。
