# 代码审查速查单（Reviewer Checklist）

> 配套 `CODE_REVIEW_STANDARD.md`。评审时逐项过，命中即按级别评论。

## 🔴 P0 阻塞（任一命中 → 禁止合并）
- [ ] 安全漏洞：注入（NoSQL/SQL/命令）、XSS、`eval`、危险 `innerHTML`
- [ ] 密钥 / 内部配置泄露到前端或打包产物
- [ ] 鉴权绕过：管理写操作未走云函数校验
- [ ] 数据丢失 / 损坏风险（误删集合、覆盖写、无事务的关键更新）
- [ ] 破坏对外契约（API 字段、云函数 action、路由路径变更未兼容）

## 🟡 P1 重要（必须给出处理：修 / 建 issue / 共识）
- [ ] 金额 / 库存未依赖服务端重算
- [ ] 写入无字段白名单（应推广 `pickFields(schema, data)`）
- [ ] import-time 副作用（监听 / 定时器在模块加载时执行）
- [ ] 上帝模块 / 复制粘贴（如 `cloudfunctions/shared.js` ×3）
- [ ] 死代码 / 永远走不到的分支
- [ ] 异步未处理 reject / 超时 / race
- [ ] 数据库查询未分页（无 `limit` / 全量拉取）
- [ ] 安全关键逻辑无测试（auth / 订单金额 / 白名单）
- [ ] 降级静默吞错，返回误导数据

## 💭 P2 次要（建议修）
- [ ] 导出函数缺 JSDoc / `@typedef`（无 TS 项目靠这个补类型）
- [ ] 命名不清晰 / 魔法数字未常量化
- [ ] 轻微重复可抽取

## 📝 P3 提示（可选）
- [ ] 注释缺失但不影响理解
- [ ] 纯风格偏好

## 技术栈快查
- [ ] React：Rules of Hooks 遵守；`key` 用稳定 id；加载/错误/空态有 UI
- [ ] JS：`jsconfig` strict + checkJs 下无 `any` 逃逸；外部数据有 `@type`
- [ ] CloudBase：查询分页；集合安全规则最小化；密钥只进云函数 env
- [ ] 错误处理：云调用 try/catch + 本地降级 + `console.warn`；fetch 有超时

## 收尾
- [ ] 所有 🔴 / 🟡 已关闭或建 issue 跟踪
- [ ] 至少 1 个 `Approve`
- [ ] 作者逐条回应了每条评论
