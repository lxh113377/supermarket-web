# 07 分卷 188 —— 第 90 轮续：写测试后必须当场跑 lint（CI 红一次）

> CHANGELOG 同日条目为准；part187 写满 3.5KB 开本卷（V4 出生口径内）。

## 2026-10-26 — 教训：提交前四连跑，缺一不可

- cssTokens.test.js 变异腿改写后残留两个未用 import（writeFileSync/mkdirSync），
  本地只跑了 vitest 没跑 oxlint ⇒ CI step 10 Lint 红（--max-warnings 0 下 error 即红）
  ⇒ 21d7f11 的 run 40221176532 gates failure ⇒ deploy 断一次。修复 b277a93 走逃生门推
  （.ci/escape-hatch.jsonl 在册，base=21d7f11→head=b277a93）。
- 纪律入库：**任何提交前四连跑** lint / typecheck / 受影响单测 / 全量单测；
  「本地绿」的最小面 = CI gates 的 step 序（audit→lint→大小写→env→csp→…→vitest），
  不是自己挑的子集。本轮 batch 1/2 都四连跑过，batch 3 写测试后漏了 lint ⇒ 红。
- 同族病史：本仓「本地绿 CI 红」的根因清单里从此多一条「测试文件自身的 lint 债」——
  它不进任何单测断言面，只有 oxlint 看得见。

## 第 90 轮三批交付索引（正文在 part187 + CHANGELOG + 外层第 90 轮报告）

1. P0 部署链闭环（memory 卷超体积拆卷，2108f96）；
2. CategoryPage 柜台台账 + forest 变量族补漏（0a83703）；
3. 查询工单双栏 + 常问台账侧轨（4468cc1）；
4. css-tokens 引用⇄定义对账闸入链（21d7f11）+ lint 修复（b277a93）。
