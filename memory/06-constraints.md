# 06 - 已知约束

> 本文件记录已知问题、技术债和约束。
> 归档类型：增量（已解决的问题移入归档）

## 已知 Bug
- [BUG] public-api 若被单独重新部署，包内必须含 node_modules（@cloudbase/node-sdk），否则 FUNCTIONS_INVOCATION_FAILED — 影响：/pub 全部公开接口 | 状态：已修复（2026-08-08 补依赖重部署），部署流程已记录
- [BUG] tcb fn log 在 CLI 3.6.4 返回"当前版本不支持更多日志检索" — 影响：线上排障 | 状态：未修复（改用控制台日志服务）

## 技术债
- [DEBT] 评价晒图 base64 入库（≤5×2MB） — 建议云存储直传，减少文档体积
- [DEBT] src/cloudbase.ts 等平台边界用 any — 已注释说明，保持平台边界宽松
- [DEBT] **本仓 2026-09-25 晚已转 public** ⇒ 不再占 Free 计划 2,000 Actions 分钟/月（转公前该额度已用满并造成整账号 0-step 停摆，见 `docs/ci-triage-runbook.md`）。"私有仓 Actions 是计量资源"这条对**其它仍私有的仓**依旧成立，别拿本仓现状去套。停摆形态本身（runner 从未分配、无日志、与提交内容无关）仍是需要分诊的故障模式，自查命令 `node scripts/ci-status.mjs`（exit 3 = 账号级）。
- [DEBT] 转 public 的连带面：`d1-backup.yml` 已加 fail-closed 守卫（非 private 时禁止把全库明文导出物上传为 artifact —— public 仓给所有人 read 权限，任意已登录用户可下载）。要恢复每日备份须二选一：转回 private，或先加密再上传。
- [DEBT] 顾客端仍发在 **GitHub Pages（`lxh113377.github.io`，独立仓）**，两仓可见性各自独立，别把"本仓 public"当成"两端都 public"。

## 红线（不能改）
- 部署任何 `wrangler pages deploy` / `gh pages` 推送 / `d1 execute` 前必须先加载 chaoshi-web-deploy skill，禁止凭记忆裸跑（`tcb` 命令属已结束的 CloudBase 时代，勿再跑）
- cloudbaserc.json 只保留 ${ADMIN_KEY} 占位符，禁止明文密钥入库（文件已 gitignore）
- 管理后台商品编辑禁弹窗/抽屉，唯一交互为 InlineEditForm 内联展开
- 云函数保持 CommonJS JS（不迁 TS，避免部署编译步骤）
- .env 不打印/不回显任何密钥

## 性能/兼容性约束
- 商品图 WebP（quality 80）+ sm/ 400w 小图，移动端列表页省流量
- public-api 商品查询上限 1000 与 admin 对齐
- 前端 Service Worker 缓存静态资源，发布后需强刷（SW 版本自动 bump）
