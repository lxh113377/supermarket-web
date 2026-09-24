# ADR 0004: 首屏预算按归因重设基线；echarts XSS 用 renderMode 收口而非升大版本

- 状态：已采纳（2026-09-24 第二轮 B2 + A3）

## 首屏 JS 77.9KB → 86.4KB 的实测归因
- `react-vendor` 单块 66.0KB gzip，占首屏 76%；其余是 router 13.6 + 入口 5.2 + client/fields/runtime ≈ 1.6。
- 增量来自 dependabot 轮 react 19.2→19.3 + vite 8.2→8.3（rolldown 代码生成）整体抬基线；
  首屏没有可削的新增业务代码（HashRouter 必须首屏载 router，不是懒加载能解的）。
- 决策：预算从 90KB 按「实测 ×1.10」重设为 95KB，并让门禁**打印首屏构成 top3**。
  预算仍拦得住下一次"无归因的增长"，同时不再因为一次 react 小版本升级就整条 CI 变红。
- 反例（明确不做）：为凑预算把 router 换成手写 hash-router——省 13KB 换来自研路由的长期维护债。

## echarts XSS（GHSA-fgmj-fm8m-jvvx，影响 <6.1.0）
- `npm audit`（官方源）实测命中，且本项目确实存在汇点：营收柱状图 tooltip 的 formatter 把入库文本拼成 HTML。
- 修复取 `renderMode: 'plainText'`（tooltip 走 textContent），而不是 `npm audit fix --force` 升 echarts 6：
  升大版本只换版本号，不改变"继续往 formatter 里拼 HTML"这个真正的问题形态；
  且 echarts 6 会冲击既有 `echarts/lib/*` 深路径按需注册布局（历史上靠它把 gz 从 452 压到 331）。
- 防回归：`tests/chartXss.test.ts` 静态断言"每个 tooltip 必带 TOOLTIP_BASE、formatter 不得返回 HTML 标签、
  echarts 不得从 barrel 引入"。这类不变量阈值门禁测不到，只能显式断言。
