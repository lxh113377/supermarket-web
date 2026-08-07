# 超柿 Web 代码审查流程（Code Review Process）

> 配套文档：`CODE_REVIEW_STANDARD.md`（查什么）、`REVIEW_CHECKLIST.md`（速查单）、`PULL_REQUEST_TEMPLATE.md`（PR 模板）。
> 版本：v1.0 · 2026-08-08

---

## 阶段 0：建立版本控制（前置条件，当前缺失 ⚠️）

**现状核实**：`supermarket-web/` 当前**没有 `.git` 仓库**（已确认）。没有版本控制就没有可审查的 diff，后面所有流程都无从谈起。

**必须先行落地的动作：**
1. 初始化 git，建立 `main` 分支；把当前代码作为 baseline 首个 commit。
2. 确认 `.gitignore` 已保护 `.env`、`cloudbaserc.json`、`*.local`、`node_modules`、`dist`（当前已正确配置，保持）。
3. 分支模型：`main`（受保护，仅接受 PR 合并）+ `feature/*` + `fix/*`。
4. （可选）接入远程仓库（GitHub / Gitee / 工蜂）作为备份与协作中心。

> 这一步是团队级别的流程决策。我可以帮你执行 `git init` + 首次 commit + 配置，但需要你确认是否现在做、以及远程仓库地址。

---

## 阶段 1：开发者自审（Pre-submission）

作者提交前必须完成：
- [ ] 本地跑通：`npm run lint && npm run test && npm run build` 全绿。
- [ ] 过一遍 `REVIEW_CHECKLIST.md`，低级问题自行消化。
- [ ] 自测关键路径（尤其下单、支付、管理写操作）。
- [ ] 填写 PR 模板（见 `PULL_REQUEST_TEMPLATE.md`）。

---

## 阶段 2：提交评审（Pull Request）

PR 准入要求：
- **描述"为什么"**，而非只写"改了什么"；关联需求 / issue。
- 附**自测结果**（截图或测试输出）。
- 单 PR 改动 **≤ 400 行**为佳；超大改动必须拆分。
- 禁止把格式化、重构、功能混在一个 PR。

**自动门禁（建议接入 CI，任一红则禁止合并）：**
| 门禁 | 命令 | 失败处理 |
|------|------|----------|
| Lint | `npm run lint` | 必须修，不豁免 |
| 测试 | `npm run test` | 必须全绿 |
| 构建 | `npm run build` | 必须成功 |
| 密钥扫描 | gitleaks / secretlint | 阻断合并，人工确认 |

> 当前无 git/CI，阶段 2-5 在 git 落地后即可启用。过渡期可用"文件 diff 提审"+"人工跑三条命令"代替。

---

## 阶段 3：评审执行

- **最少 1 名 reviewer**（关键/安全改动建议 2 人）。
- **首评 SLA**：小 PR（<100 行）4 小时内；中 PR（<400 行）1 个工作日内；超大 PR 先要求拆分。
- 评审聚焦：
  - 🔴 P0：**必须修复**才能通过。
  - 🟡 P1：**必须给出处理**（修复 / 建 issue 跟踪 / 团队共识接受），不可悬空。
  - 💭/📝 P2/P3：可后续，不阻塞。
- 评论格式严格按 `CODE_REVIEW_STANDARD.md §5`。
- ❌ 禁止"LGTM"式无依据通过；❌ 禁止只批风格不顾正确性/安全。

---

## 阶段 4：修改与再审

- 作者**逐条回应**每条评论：修复 / 反驳（附理由）/ 延期（建 issue）。
- 所有 🔴 P0 与 🟡 P1 关闭后，reviewer 方可 `Approve`。
- 复审轮次：超过 3 轮仍大量未决，升级给 owner 仲裁。

---

## 阶段 5：合并与部署

- 采用 **squash merge** 到 `main`，合并后删除特性分支。
- 部署前同步云函数：⚠️ 当前 `package.json` 的 `predeploy` 会**复制** `cloudfunctions/shared.js` 到 admin-api / public-api（见标准 §4.3，属反模式）。应改为单源引用，避免"改一处忘两处"。
- 合并记录关联 PR 与需求，便于回溯。

---

## 角色与职责

| 角色 | 职责 |
|------|------|
| 作者（Author） | 质量第一责任人；自审、按评论修改、确保门禁全绿 |
| 评审者（Reviewer） | 质量守门员 + 教练；按标准给分级评论、把关 P0/P1 |
| 维护者 / Owner | 冲突仲裁；维护本标准与流程；决定例外 |

---

## 准入定义（Definition of Done for Review）

合并前必须全部满足：
- [ ] `lint / test / build` 全绿
- [ ] 无遗留 🔴 P0、🟡 P1
- [ ] 安全关键路径（auth / 订单金额 / 写入白名单）有测试
- [ ] 对外接口变更已更新文档 / 注释
- [ ] 至少 1 个 `Approve`

---

## 节奏与度量（持续改进）

- 跟踪指标：平均评审轮数、合并前 P0/P1 数、缺陷逃逸率（上线后回看）。
- 每季度复盘一次本标准与流程：哪些规则太严/太松、哪些反模式已清零。
- 新反模式出现 → 沉淀进 `CODE_REVIEW_STANDARD.md §4`。

---

## 本周即可落地的 5 件事（无需等大流程）

1. **立 git**：`git init` + 首 commit，保护 `main`。（阶段 0，最优先）
2. **强化 lint 门禁**：采用 `docs/oxlintrc.recommended.json`，在 `prebuild`/`lint` 中生效（先本地 `npx oxlint` 验证规则名可用再提交）。
3. **补 3 个安全测试**：`auth.js` 白名单、`createOrder` 服务端重算、云函数 `index.test.js` 关键分支。
4. **消除 1 个反模式**：先修 `db.js` 的 import-time 副作用（§4.1）或删 `auth.js` 死代码（§4.4），树立样板。
5. **约定 PR 模板**：把 `PULL_REQUEST_TEMPLATE.md` 落到仓库（git 就绪后放 `.github/` 或工蜂对应目录）。

> 我可以作为 Code Reviewer 直接对你贴出的代码 / 指定文件执行一轮审查，产出符合本标准的报告。
