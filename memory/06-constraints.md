# 06 - 已知约束

> 本文件记录已知问题、技术债和约束。
> 归档类型：增量（已解决的问题移入归档）

## 已知 Bug
- [BUG] public-api 若被单独重新部署，包内必须含 node_modules（@cloudbase/node-sdk），否则 FUNCTIONS_INVOCATION_FAILED — 影响：/pub 全部公开接口 | 状态：已修复（2026-08-08 补依赖重部署），部署流程已记录
- [BUG] tcb fn log 在 CLI 3.6.4 返回"当前版本不支持更多日志检索" — 影响：线上排障 | 状态：未修复（改用控制台日志服务）

## 技术债
- [DEBT] 评价晒图 base64 入库（≤5×2MB） — 建议云存储直传，减少文档体积
- [DEBT] src/cloudbase.ts 等平台边界用 any — 已注释说明，保持平台边界宽松
- [DEBT] 私有仓 Actions 为**计量资源**（Free 2000 分钟/月，按 job 累加，实测本账号 2026-09 用 57.6%）；且存在"账号级 0-step 秒红"停摆形态 —— runner 从未分配、无任何日志，与提交内容无关。分诊与处置顺序见 `docs/ci-triage-runbook.md`；自查命令 `node scripts/ci-status.mjs`（exit 3 = 账号级）

## 红线（不能改）
- 部署任何 tcb hosting/fn deploy 前必须先加载 chaoshi-web-deploy skill，禁止凭记忆裸跑
- cloudbaserc.json 只保留 ${ADMIN_KEY} 占位符，禁止明文密钥入库（文件已 gitignore）
- 管理后台商品编辑禁弹窗/抽屉，唯一交互为 InlineEditForm 内联展开
- 云函数保持 CommonJS JS（不迁 TS，避免部署编译步骤）
- .env 不打印/不回显任何密钥

## 性能/兼容性约束
- 商品图 WebP（quality 80）+ sm/ 400w 小图，移动端列表页省流量
- public-api 商品查询上限 1000 与 admin 对齐
- 前端 Service Worker 缓存静态资源，发布后需强刷（SW 版本自动 bump）
