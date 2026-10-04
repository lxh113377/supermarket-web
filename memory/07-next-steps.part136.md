# 07 - 下一步 · 第六十七轮正文（2/4：跨项目发现，2026-10-05）

> 本卷是 `07-next-steps.md` 第六十七轮正文的**第 2 段**。
> 前后段：`part135`（轮次摘要 + 台账漂移）、`part137`（抽象层陷阱 + 生产腿牙齿）、
> `part138`（全链终局 + 下一轮开工清单）。本卷供追溯，**不得当现状读**。

## 跨项目发现（本轮最大的一条）：两个取数器都挑错了通道

- 本机 PATH 首位 `C:/Users/37533/.local/bin/gh` 是 **0 字节、无扩展名的残件**：
  PowerShell 报 `Cannot run a document in the middle of a pipeline` 并零输出；
  Node 的 `spawnSync` 同样起不来，失败也是零输出的那种。
- 而本仓**两个**取数器都按名字 spawn 它：
  - `scripts/benchmark-peers.mjs` ⇒ **整份对标名册长期「不可得」**；
  - `scripts/ci-status.mjs` ⇒ 先卡在更前面一步：取 token 原本包在
    `bash -c '… | git credential fill'` 里，而本机 PATH 上的 `bash` 是 `C:/Windows/System32/bash.exe`
    （**WSL 那份**），那条管道实测 **45s 不返回**，原实现又没有 timeout
    ⇒ `node scripts/ci-status.mjs`（`AGENTS.md` 钦点的「CI 红怎么办」入口）**零输出挂死 150s+**，复现两次。
- **病根是外壳造的，不是环境缺能力**：去掉 bash 外壳直连
  `spawnSync('git', ['credential','fill'], {input:'protocol=https\nhost=github.com\n\n'})`
  ⇒ status=0、**0.1s**、返回键 `[protocol,host,username,password]`、password 长 40
  （Windows GCM 里本来就有）。⇒ 修法是拆病根，不是加超时压症状（超时只留作兜底）。
- 本机 curl 打不到 api.github.com：直连 **rc=56**（10.6s）/ 经 `127.0.0.1:7897` **rc=35**
  （5.1s，CONNECT 隧道建成但 schannel 握手失败）；同期 `gh.exe api` 同一接口 **rc=0**、155,886B。
  ⇒ 让 gh 腿排在 curl 腿前面，并抽出 `scripts/lib/gh-cli.mjs` 共享取数件
  （验「文件 + 非 0 字节 + 可执行扩展名」，每次调用带 timeout，找不到时明说 `no-gh-executable`
  而不是伪装成空数据）。
- 效果（可直接量的）：`ci-status` 挂死 → **1.7s 出结论**；`report:peers` **首次取到完整十仓读数**。
- 方法学沉淀：**当「某件事本机量不到」这句话已经连续两轮被复述时，把它当成一个待修缺陷去查取数器本身**，
  而不是继续记成环境限制。配套判据：判断修法是「压住症状」还是「拆掉病根」，看**去掉可疑环节后能力是否本来就在**。