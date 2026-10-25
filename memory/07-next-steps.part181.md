# 07 分卷 181 —— 第 85 轮：支付链路「收据语言」+ 404 视差（环境坑三条）

> 本轮提交 f605c7a（main），CHANGELOG 同日条目为准；此卷只记**下一轮要用的环境与判据教训**。

## 2026-10-25 — 收据语言落地面

- **改动面**：OrderSuccess/Payment/OrderQuery/NotFound 四页 + redesign.css（+9KB 收据系统段）。
  视觉闸 16 spec 全绿、vitest 2172 全绿、四页渲染对比度 0 违规。e2e 锚点零破坏的关键 =
  动 UI 前先 grep tests/ 对页面文案的 getByText/getByRole 断言（「订单号」是查询卡头标签本身、
  「订单号：o_xxx」必须是同一文本节点）。
- **首页窄档展台真·并排**：content-reachability 320px home 在 be1cfdc（开屏随机化）后对
  「随机图注长度 × 拍立得横向重叠」不稳定 —— stash 基线复跑同红证实与本轮无关，但随机标签
  让判据变碰运气 ⇒ back 左上/front 右下错位零重叠修根。判据要过的前提是「任意一次随机都过」，
  验收必须多次刷新采样（本验 5/5），单次绿 = 假绿。

## 环境坑（本机，下一次直接抄）

1. **Playwright 浏览器缺失**：本机无 ms-playwright 目录，chromium headless shell 需
   `set PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright&& npx playwright install chromium-headless-shell`；
   应急截图用 `chromium.launch({ channel: 'msedge' })`（系统 Edge 现成）。
2. **detached spawn 随 run_code 会话死**：Windows 下 spawn detached + unref 的进程在
   run_code 结束后被收（两次后台视觉闸都静默死在 skip-link 182/215 同一停点，非测试卡死）。
   正解 = 附着 spawn 放在同一次 run_code 内轮询收割，长套件按 spec 分批短跑（每条 ≤10min）。
3. **cmd.exe /c 批处理中文路径**：bat 里 cd /d 中文路径静默不执行（日志文件根本不落）；
   spawn 的 cwd 参数传中文路径没问题 —— 命令串里永远不带中文。

## 下一轮候选（不占轮号，按目标八维继续）

- 商品详情/购物车/AI 导购三页仍是「白卡语言」，可延续收据/票据语汇做滚动叙事；
- 看板图表单色金线化（v3 自查清单遗留项）；主题 aria-live 播报；宋体子集按路由分包。
