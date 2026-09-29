# 07-next-steps 卷 95 —— 第五十三轮（2026-09-29）补记

> 本卷从卷 94 拆出：追加后 94 实测 5,554B > 4,096B（V2 判超限），按判据自己的处方拆卷——不压措辞、不删事实。

## 补记（同一轮内追加，两条实测结论）

- **E4 试过并回退了**：把工作树的 CRLF 归一成 LF（171 件，逐件字节改写、跳过他人 in-flight 件）之后，
  `git status` 把**全部 171 件报成 ` M`**，而按内容口径（`git hash-object` 的 OID ⇄ `rev-parse HEAD:<path>`）
  它们与 HEAD **逐字节相同**（`git add --dry-run` 也说无事可做）。
  一手取证：`git cat-file --filters HEAD:.browserslistrc` 与盘上件同为 sha `344f3754a60d9979`（779B、CR=0），
  `git update-index --really-refresh` 仍报 `needs update`；配置源头是**系统级** `C:/Program Files/Git/etc/gitconfig` 的
  `core.autocrlf=true`（`git config --show-origin` 实测）。
  ⇒ 结论：**在这台机器上"工作树=LF"是不稳定表示**，归一不给仓库带来任何字节变化，却把 171 行幻影脏度留给
  并发会话的 `git status` 判断面（户内规：in-flight 是内容不是状态）。已按内容通道逐件还原（144+28 件），
  还原后 `git status` 只剩他人那 1 件、`w/crlf` 回到 172 ⇒ **回到本轮开工时的状态，零提交**。
  **R54-H1 随之改判**：E4 不升可判（本机永红、他人机器上又恒真），改为把 advisory 的读数**按三把尺分档印**：
  `i/crlf=0 / w/crlf=172 / 字节含 CR=97+172?`（第三把含二进制里的合法 `0D0A`），并加一行"本机 autocrlf 来源"。
  `前提=<可复算>`：`git ls-files --eol | grep -c ' w/crlf'` 与 `git config --show-origin --get core.autocrlf`。

## 一次假红的归因与两条复发的已知坑

- **一次假红的归因**：全链里 `tests/ciGreenContract.test.js > 变异体 M2` 报 `expected '' to contain 'branch=main'`，
  单跑同一套件 28/28 全绿、再跑全链 110/110 全绿 ⇒ 红因是 `runCli` 的 **20s 超时**在并行负载下被掐（输出空、rc=null），
  不是判据行为。**R54-H4（新挂账）**：CLI 腿必须把"超时/被杀"与"判据答错"分开——`status===null` 时
  显式判 `TIMEOUT` 并点名预算，禁把空输出喂给内容断言（否则每次机器抖动都长图像真缺陷）。
  `前提=` `npx vitest run tests/ciGreenContract.test.js`（单跑必绿即证它是抖动不是缺陷）。
- **本轮我自己复发的两条已知坑（记归属，勿外推）**：① `git diff-files --name-only` 逐行取路径被
  `core.quotepath` 转义成 `"docs/…\346…"` ⇒ ENOENT（户内规：自写取路径工具一律 `-z` + `-c core.quotepath=false`，
  我写了第一版才想起来）；② 内联 `node -e` 被正文里的中文引号咬了第三次 ⇒ 同族教训是"含引号正文只走 Write/Edit"。
