# 07-next-steps · 第七十轮 · 本轮自己踩的坑（上半）

> 本卷是"坑"的**上半**（BOM / 夹具自坏 / 零分母两面）。下半（隔离造绿色沉默 / 索引幽灵 / 缺 --dir 动真仓 / 修判据不修测试）
> → 逐字见 `07-next-steps.part150.md`（拆卷理由：两半合并 4463B 越 4096B 阈；口径＝整条不拆、逐字迁）。

- **写中文 commit message 用 PowerShell `Out-File -Encoding utf8` 会带 BOM** ⇒ 提交首字符变成 U+FEFF。
  一手：本轮第一笔提交 `feat(...)` 的 `%s` 首字符 codepoint 是 65279。
  修法：`node` 读 `git log -1 --pretty=%B` → `replace(/^\uFEFF/,'')` → 写临时文件 → `git commit --amend -F <file>`
  （`--amend` 不能同时用 `-o` 与 `-a`，实测报 `options '-o/--only' and '-a/--all' cannot be used together`）。
  ⇒ **凡是要落盘的中文/多行文本，编码与 BOM 都要显式指定**，别依赖 shell 默认值。

- **夹具断言被自己注释里的字面量打红**（E3 接线半边）。
  一手：断言写成 `hook.indexOf('set -e') < hook.indexOf('check-memory-pointer-sync.mjs')`，
  而本轮新加的注释里提了一句这个脚本名 ⇒ `indexOf` 命中注释（byte 1028）而不是腿（byte 1430），断言当场翻红。
  正解：**量腿行本身的位置**（`split('\n')` 后按"含脚本名且不以 `#` 开头"筛出腿，再比下标），
  而不是量"文本首次出现"。
  ⇒ 与 `tests/docCommands.test.js` 记的是同一形态：**夹具自己也会写坏，所以它同样要跑红→绿一遍。**
  本轮把它当既有教训直接引用，没有重新踩第二遍。

- **零分母的两个面不是一回事**（被 `tests/cliEntrypoints.test.js` 的零分母探针腿当场抓到）。
  一手：新增的 `quarantine-unreached-perf.mjs` 在"文件在、内容全空"的输入上返回 0，
  报 `PASS 取数面里已无未采到样本 ⇒ 无事可隔离`。
  但"一件都没搬"有两种成因：① 已经隔离过了（**扫过且清白**）／② 取数面本来就是空的（**扫到 0 个对象**）。
  ⇒ 分母必须同时过**文件数**与**内容**两关：`sampleNamed.length === 0` 判"没有样本"，
  `readable.length === 0`（文件在但全 0 字节或坏 JSON）判"样本都读不出来"，两者都 fail-closed rc=2。
  ⇒ **"没有可判的对象"与"判过了且清白"必须落在不同 rc 上**，这是绿色沉默的两种形态。
