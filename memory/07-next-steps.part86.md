# 07 分卷 86 —— 第五十轮追加：CI 判红抓出「本机一直在漏判」（行尾会改变判定）

远端 job `108887406892` 红在 `--check` 腿：`counts{mentions 册上 205 → 现算 224}`；本机同一提交全绿。
复算：`collectDocs()+extractCommands` raw=**205**、剥 CR 后=**224**，差 **19** 条；`files_with_CR=15`；
本机 `core.autocrlf=true` 且仓内无 `.gitattributes` 管 `.md`。根因在 `CODE_SPAN_RE` 的围栏分支要求代码块标签后紧跟 LF
⇒ **CRLF 检出下整块围栏代码里的命令主张从来没被读过**。

- 定性：不是"CI 多事"，是 Windows 侧**结构性漏判 19 条**（判据看不见输入面的一部分，比看错更糟）。
- 正解分两侧：**读来判**的一侧归一（`collectDocs` 内 `normalizeEol`，台账 counts 从此机器无关）；
  **写回**的一侧保持文件原有行尾（否则一次重生生成物＝整文件行尾 churn）。＝「比较面可归一、写出面吐原字节」。
- 夹具两侧都有：CRLF 原文抽不到（钉住旧漏判面）/ 归一后抽得到；真面零 CR ∧ 册上 counts==当场重算。
- 升格：台账里**任何**随行尾/环境变化的量，第一次接 CI 就会自判红（本轮是第二次实证，第一次是阈值类）。

## 由这条漏判派生的下一轮项（R51-H6，报告 §5 已挂号）

补 `.gitattributes`（`* text=auto eol=lf` + 必要的 CRLF 名单），从根上消灭"检出形态影响判定"这一类。
⚠️ 户内实测过的前置：只上策略文件会让 index 不变而**工作树整片被记成 `M`**（共享工作区里＝给并行会话造在途），
所以必须与 `git add --renormalize` **同窗一步**做完，并且动手前先取快照/备份分支。验收口径两条：
① `git diff --name-only` 与 `git diff --ignore-cr-at-eol --name-only` 计数相等（纯行尾、零内容改动）；
② 临时目录 `git clone` 后在 `core.autocrlf=false` 下重检出，`docs/doc-commands.json` 的 counts 与本机一致（=224）。
