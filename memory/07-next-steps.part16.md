## 2026-09-25 防线轮 · Linux 侧等价验证（不依赖 CI，已补上"新 job 未在 ubuntu 真跑过"这一档）

- 容器 `mcr.microsoft.com/playwright:v1.63.0-noble`（**3.55GB**，非我先前估的 1.5–2GB）内跑 `test:stub`：`npm ci` OK → `build:stub` `✓ built in 1.03s` → **`test:stub` 3 passed (6.9s)，`TEST_STUB_EXIT=0`**。环境 Linux 6.6.114（WSL2）+ node **v24.20.0** + npm 11.19.0。
- ⇒ 新 job 的四条环境假设全部成立：**127.0.0.1 绑定可通**（不用 localhost）、`canvas.width >= clientWidth` 不随无头 Chromium 的 DPR 漂、console 白名单未吞真实噪声、桩自建 `dist-stub` 链路完整。CI 恢复后只剩"在 GitHub runner 上也绿"这一确认动作。
- **余差一档**：容器是 node 24，CI 是 node 22。要抹平需用 node:22 基底重跑（本轮未做）。
- 两条踩坑留痕（下次写同类容器命令必须前置）：① Git Bash 会把参数里的 `/run.sh` 改写成本机路径（症状 `bash: C:/Program Files/Git/run.sh: No such file`，exit 127）⇒ 加 `MSYS_NO_PATHCONV=1`；② **绝不在挂载的仓库目录里 `npm ci`** —— 会用 Linux 原生二进制覆盖宿主机 `node_modules`；本次是只读挂载 + 在容器内 `/work` 复制副本（`tar --exclude` 排掉 node_modules/dist*/.git）。

## 安全待办（本轮新增，值一律不落盘）

- [ ] **撤销本轮明文出现在对话里的那枚 `ghp_` 前缀 classic PAT**（**只能用户手工执行**：GitHub → Settings → Developer settings → Personal access tokens → 对应条目 → Delete）。同型待办此前已有两条在册（"撤销本次部署使用的 PAT"、"撤销已暴露的 2 个 PAT"），这是第三次。
  - 约定：token 若需给 agent 使用，走**不回显通道**（Windows 凭据管理器，或仓库外的本地文件并告知路径），不粘进对话、不写进文件/日志/记忆/提交。理由：`D:/global_memory` 与 `D:/global_skills` 是八端共享且各自推到远端归档仓，明文密钥一旦入 git 历史即不可回收（本仓已有 `scripts/purge-admin-key-history.sh` 收拾同类事故的先例，代价是 filter-repo 重写 + force-push）。

  - **同时注意**：本轮起 `deploy.needs = [build-and-test, e2e, e2e-cloud-stub]`，任一红即不部署；而 `dispatch.yml` 是独立 workflow，**仍会照发 github.io** ⇒ 两端可能不同步，验证只认 bundle/`sw.js` 指纹（坑 36）。

## 分卷目录
- **卷1** `07-next-steps.part15.md` — 07-next-steps 分卷（R199 自动拆卷）

