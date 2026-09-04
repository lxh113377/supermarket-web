# 07 - 下一步

> 本文件记录下一步行动项，按优先级排序。
> 归档类型：增量（已完成的行动项移入归档）
>
> **⚠️ 这是新对话恢复上下文的入口文件。P0 必须永远有一条可执行指令。**

## P0 — 必须做
- [x] 2026-08-30 修复后台无法登录：线上 pages.dev 部署的是未烘焙 VITE_CB_API_BASE 的旧构建（后台静默降级「本地演示模式」，看不到真实订单）→ `npm run build`（.env 已配 API base）+ `node node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=supermarket-web --commit-dirty=true` 重新部署，线上验证云端模式 + 登录 + 12 条订单可见
- [x] 2026-08-30 确认正确后台入口 URL = `https://supermarket-web.pages.dev/#/admin`（HashRouter 路由；`#@command:admin` 非合法路由会 404，勿再用）
- [ ] 观察线上运行 — 管理端每次登录/查看订单正常；后台仍出现「本地演示模式」= 部署的构建没带 .env（VITE_CB_API_BASE），需重构建+重部署（见 project_memory 2026-08-30 条）

## P1 — 应该做
- [x] 评价晒图改云存储直传 — 2026-08-08 完成：uploadFile/fileID + getTempFileURL 会话缓存 + 旧 base64 兼容；待用户控制台开启安全域名+存储匿名读写后即可用
- [x] 部署冒烟脚本化 — 2026-08-08 完成：scripts/smoke-deploy.mjs + npm run smoke（线上实测 4/4 PASS）
- [x] 清理迁移脚本 — 2026-08-08 已归档至 archive/2026-08-08-migration-tools/（可恢复，未硬删）

## P2 — 可以做
- [ ] 绑定自定义域名 + HTTPS 证书（当前用默认域名）
- [x] 数据看板增强 — 2026-08-08 完成：costPrice 字段 + 近14天评价趋势 + 饮品/食品毛利率卡片
- [ ] CloudBase 日志检索接入（当前 tcb fn log 在 CLI 3.6.4 不可用，改控制台或 tccli）

## 最近对话摘要
- 2026-09-05（二轮，凭证卫生+依赖+测试）— ①ADMIN_KEY 曾轮换为 64 位随机串，**用户拍板回退固定值 supermarket-admin-2026**（线上已生效，login code 0）②GH_DISPATCH_TOKEN 待换 fine-grained PAT（用户建好 token 后我替换 secret + 实测双发；两个超权 classic PAT 替换后需撤销）③dependabot 3 个 major PR 已处理（echarts 6 关闭 / tailwind 4 关闭 / github-script v9 合并 0d8d61e4，open PR 清零）④新增 tests/orderFlow.test.tsx 下单主链路集成测试 6 用例 + vitest setup 全局 cleanup（vitest 132/132）⑤documents/AGENTS.md 部署铁律改薄指针（唯一权威 = chaoshi-web-deploy skill）⑥⚠️ 待确认：9d803bd 推送后远端 CI（build-and-test + pages.dev 部署 + github.io 双发）是否全绿；CI 部署曾因缺 env 注入出未烘焙版（坑 27），已修 ci.yml
- 2026-08-30 — 修复后台无法登录：①用户用错 URL `#@command:admin`（HashRouter 下 404，正确为 `#/admin`）②线上 pages.dev 部署的构建未烘焙 VITE_CB_API_BASE → 后台静默「本地演示模式」，登录绕过、看不到真实订单。根因 = 部署的 dist 是旧构建（不含 .env 编译产物）。修复 = 重新 `npm run build` + `wrangler pages deploy dist`，线上验证：云端模式、登录（`supermarket-admin-2026`）、12 条订单、控制台零报错；顾客端 github.io 同 bundle（index-BXYcXL5G.js）跨域 API 正常（49 商品）。⚠️ 注意：本 memory/ 目录仍为 CloudBase 时代旧快照，当前架构 = Cloudflare Pages Functions + D1 + KV（见项目根 AGENTS.md 顶部警示），勿照抄旧命令。
- 2026-08-08 — 完成超柿全量上线：P0/P1/P2 修复（订单字段/评价体系/多图/数据卫生）、41 文件 TS 迁移（97 测试全绿）、GUI 打磨、order20 换图（OCR 验证猎兽）。tccli 授权成功，创建 /pub→public-api 独立路由；部署发现 public-api 从未被 HTTP 调用、包内缺 node_modules → 补依赖后重部署解决。线上验证：49 商品、20 种子评价、测试订单/评价已清理。

## 已完成
- [x] 阶段一~四：功能修复 + TS 迁移 + 测试门禁（97 passed / lint 0 error / typecheck 0 / build ✓）
- [x] 阶段五：order20 换图 + VITE_CB_PUBLIC_API_BASE=/pub + 构建
- [x] 阶段六：tccli 只读验证 + CreateHTTPServiceRoute + hosting/fn 部署 + curl 验收 + seed 20 条
