# 07-next-steps.part2.md

<!-- 本卷为 07-next-steps.md 的延续 -->

- **性能**：AI 经营建议会话级缓存（切 tab 不再重打 30s 级 Dify 调用，「刷新」按钮强制绕过）；订单/服务提交两个轮询器
  感知 `document.hidden`（后台标签页不打云函数，回前台 visibilitychange 补拉）；本地模式批量操作合并为一次读+一次写
  （`upsertLocalProducts`/`deleteLocalProducts`，消除 N 次整表 stringify）；DashboardTab 毛利 ¥ 收口 formatCount。
- **结构**：compressImage 三份重复实现（reviewImages/ServiceForm/OrderConfirm，参数互不一致 640/0.5、800/0.7、800/0.6）收口
  `utils/imageCompress.ts`；新增 `utils/rovingTabs.ts`（tablist 方向键导航，AdminPage + DashboardTab 接入）。
- **F2 已执行**：CSP 去掉 `style-src 'unsafe-inline'`（真机验收通过解锁；保留 connect-src pages.dev 铁律）；
  断言 dist 0 个 `<style>` 标签 ✅。**TopNav 收尾**：lg 以上子分类换行平铺（`lg:flex-wrap`），小屏保持横滚，入口位置不变。
- **死代码清理**：print 样式块、stagger-9~15、`getOrders` 死导出（facade 测试同步改 `getAllOrders`）；`scrollbar-hide` 补上真实定义（原是 no-op 类）。
- **a11y 残留**：ReviewForm 评分 radiogroup/radio/aria-checked；ProductInlineEditForm 错误字段 aria-invalid + aria-describedby。
- **双端上线 + §6 全绿**：pages.dev sw-v1790104522853 / github.io sw-v1790104515129（**dispatch 自动触发成功，第 3 次**，间歇失效未复现）；
  curl 清单 ①28=上架数 ②2 ④错误密钥被拒 ⑥CORS 精确回显 ⑦200 ⑧跨域 28 ⑤测试订单 `o_mud2cyuzh89l2q`（例行写入）+ 新 CSS 200。
- ⚠️ 中断记录：本轮收尾时遇 ZCode 平台「Captcha instance timed out」报错（provider 轮次失败，与项目无关），恢复后续跑。

## P0 — 必须做
- [x] 2026-08-30 修复后台无法登录：线上 pages.dev 部署的是未烘焙 VITE_CB_API_BASE 的旧构建（后台静默降级「本地演示模式」，看不到真实订单）→ `npm run build`（.env 已配 API base）+ `node node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=supermarket-web --commit-dirty=true` 重新部署，线上验证云端模式 + 登录 + 12 条订单可见
- [x] 2026-08-30 确认正确后台入口 URL = `https://supermarket-web.pages.dev/#/admin`（HashRouter 路由；`#@command:admin` 非合法路由会 404，勿再用）
- [ ] 观察线上运行 — 管理端每次登录/查看订单正常；后台仍出现「本地演示模式」= 部署的构建没带 .env（VITE_CB_API_BASE），需重构建+重部署（见 project_memory 2026-08-30 条）

## P1 — 应该做
- [x] 评价晒图改云存储直传 — 2026-08-08 完成：uploadFile/fileID + getTempFileURL 会话缓存 + 旧 base64 兼容；待用户控制台开启安全域名+存储匿名读写后即可用

## 分卷目录
- **卷1** `07-next-steps.part1.md` — 07-next-steps 分卷（R199 自动拆卷）

