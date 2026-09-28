# 并行会话与共享索引 —— 用 worktree 隔离，别靠自觉

## 一手事故（2026-09-28）

两个 AI 会话同时工作在**同一个** `supermarket-web/` 目录 ⇒ 共用同一个 git index。

- 我（会话 A）改了 `CHANGELOG.md` 还没提交；
- 另一会话（B）跑 `git add CHANGELOG.md` 提交它自己的内容时，
  **把我那整份工作区改动一并暂存、写进了 B 的提交**。
- 结果：内容无误，但署名与归属错位，而且 **A 这边完全看不出来**——
  A 的 `git status` 之后显示"干净"，因为改动确实已进 HEAD，只是不在 A 的提交里。

反向同样成立：A 一次不讲究的 `git add <目录>` 就能把 B 的在途改动带走。
本仓已有的防线（"只用显式文件列表 + 提交前 `git status` 确认"）是**每笔都要人肉执行的纪律**，
不是机制——所以它会复发。

## 机制：每会话一棵 linked worktree

隔离点在于 **每棵工作树有自己的 index**（`.git/worktrees/<name>/index`），
所以 `git add` 在物理上碰不到另一棵树的暂存内容。

```bash
cd supermarket-web
node scripts/session-worktree.mjs list
node scripts/session-worktree.mjs add <名字>     # 从 origin/main 开 session/<名字>
node scripts/session-worktree.mjs path <名字>
node scripts/session-worktree.mjs remove <名字>
```

新树在 `../超市web-worktrees/<名字>`，**没有 node_modules**，进去先装：

```bash
cd "../超市web-worktrees/<名字>" && npm install --proxy null --https-proxy null
```

分支用 `--no-track` 建，故意不跟 `origin/main` 绑：否则会话树里一次顺手 `git push`
就会直接打到主线。要上线就显式合回 `main`。

## 已实测的行为（不是设想）

| 动作 | 实测结果 |
|---|---|
| 会话树里 `git add README.md` | 主树 index 指纹**逐字节不变**，主树 README 状态干净 ⇒ 索引确实隔离 |
| `remove` 一棵有未提交改动的树 | 拒绝，rc=1，并列出脏文件；把去留决定留给人 |
| `add` 一个已存在的名字 | 拒绝覆盖，rc=1 |
| `add '../evil'` | 拒绝（名字过 `^[A-Za-z0-9._-]{1,40}$`），rc=2 ⇒ 不给出目录穿越面 |
| `remove` 有未合并提交的树 | 拒绝，rc=1（删树会连带删分支） |
| 完整 add → 用 → remove 生命周期 | 目录与分支均无残留 |

## 它不解决什么（别把它当银弹）

- **不解决"同一文件双方都在改"的语义冲突**——那只会在 merge/rebase 时以正常冲突形式暴露。
- **不替代 CI 全绿契约**：会话树的分支照样要过 `npm run verify`。
- **成本是真实的**：每棵树一次 `npm install`。所以只在"确实有第二个会话并行写这个仓"时开，
  不是每次干活都建一棵。
- 工具本身**不强制**任何人使用。另一个会话若仍在主树里操作，事故面就还在——
  它把"隔离"变成可能，不把它变成自动。
