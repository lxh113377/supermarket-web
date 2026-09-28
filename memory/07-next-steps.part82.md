# 07 分卷 82 — 第四十九轮明细（下：生成物幂等 / 同行原文 / 手滑留痕）

> 与卷 81 同源：本轮明细整块 3,402B 超单卷上限，拆两段逐字迁移，无内容损失。

- **生成物非幂等**：`--update` 三跑 ⇒ README 三个 sha（`c0653f55…`→另两个），`gate-table:end` 与 `## 功能一览`
  之间空行从 4 涨到 7。根因：`renderGateTable()` 的数组以 `''` 结尾 ⇒ 返回值自带尾换行，
  而 `syncGateTable` 写回又 `+ '
'`、正则只吃一个换行 ⇒ 每次净增一行。修法＝尾换行归一；
  README 按内容通道修回 HEAD 字节（先断言 `git diff --numstat` == 3 插 0 删，确认只多了空行）；
  夹具两条：连写两次逐字节相同 + 反向自证（按缺陷写法跑一次**必须**多出一行，否则夹具是空转）。
- **同行原文（`gh api` @2026-09-28）**：`golang/go :: src/cmd/go/testdata/script/embed.txt` 4,716B / `dcd250549b`
  用 `! go build -x` + `stderr '<正则>'` **把失败当断言**；`eslint/eslint :: package.json` 7,789B / `88e63439cea2`
  的 `fmt:check = prettier --check .` ⇒ 生成物要有"不等即红"的读侧；`vitest :: packages/vitest/src/defaults.ts`
  3,816B / `1aa7f251f0` 的 defaultExclude 单源（第四十八轮已引，本轮沿用同一判据面）。
- **本轮自己的两次手滑（都当场被拦）**：① Edit 的 `file_path` 少写一层目录 ⇒ 工具直接报错，未落错文件；
  ② 一次 python 内联里写 `b'...'` 包中文 ⇒ `SyntaxError: bytes can only contain ASCII literal characters`，
  改成 `.encode('utf-8')` 才对——同族第三条：MSYS `/tmp` 对 Windows python 不可见，本轮 `curl > /tmp/x.json`
  再让 python 读，读到的是"文件不存在"，改写到 `C:/Users/.../Temp/` 才拿到真读数。
