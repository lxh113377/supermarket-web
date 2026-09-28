# 07 分卷 85 —— 对标第五十轮明细（下，继卷 84）

3. **R50-H2② `check-memory-volume` V3 改三态**。旧行 `pass: files.length === 0 || !!biggest` 只要目录里有卷就**恒真**，
   余 0B 与余 900B 同形 —— 上一轮主卷被压到 4,096B 整就是它放行的。形状取自 `ai/size-limit`：
   `calc.js:51-56` 只在显式设了预算时才给 `passed` 赋值、`failed = some(i => i.passed === false)`，
   `create-reporter.js:115` 再给"没预算"单独一个 `unlimited` 态 ⇒ 三态：够写 / 贴死 / 没量到。
   下限 256B 由**本仓自己的历史步长**量出（`git log -20 -- memory/07-next-steps.md` 逐次取字节差：正增量 80/254/255/290/343/612，
   中位数≈255）。只判**入口卷**，历史分卷是终态件不连坐。首跑即咬到真面（主卷 4006B/余 90B ⇒ FAIL）。
4. **R50-H3 生成物有了读侧**。`check-doc-commands` 加 `--check`（只判不写，与 `--update` 互斥，同 `makemigrations --check`
   隐含 `--dry-run` 的口径；`alembic` 更彻底，把 `check` 做成独立命令）；默认链里新增 **D7** 腿钉 README 逐字节相等。
   分工照第四十九轮的实测结论：登记册 `docs/doc-commands.json` **只报不拦**（它零消费者，逼每次文档改动补一笔"重生提交"
   = 逼人做无意义动作），要连它一起判请显式 `--check`。`counts` 从此有了第一个读者（只读来报漂移）。

## 本轮新查出的两处自身缺陷（都被夹具钉住）

- **D7 的 ok 与 detail 分叉**：detail 里重算了一遍比较式 ⇒ 变异腿（`drifted=false`）当场暴露"说通过又印漂了"。
  正解＝结论与读数**同源**，不在同一行里放第二把尺。
- **`--update` 用自己的旧快照判刚生成的产物**：写完 README/登记册没重取面 ⇒ 修漂移的命令把自己报红了。
  正解＝写侧跑完重取 `collectDocs()` + 登记册再判一次（写侧必须自证）。

## 踩坑与归因（失败面，不是噪声）

- 夹具第一版把 HTTP 桩建在 vitest 自己的进程里：`run()` 用 `spawnSync` **阻塞事件循环** ⇒ 同进程的桩永远 accept 不到，
  五条腿各卡满 8s（默认超时）后走"现网不可达"出口，看着像代码坏了。正解＝桩起在**独立子进程**，端口经环境变量回传
  （第一版按 `process.argv[2]` 取端口文件：`node -e` 下 argv 语义不同，子进程写盘即抛 —— 那条腿当时正确报了"夹具坏了"而不是假绿）。
- Edit 拼接自伤第 N 次：给 `check-judge-side-effects.mjs` 插 helper 时把 `export function evaluate(...)` 签名整行吃掉，
  `node --check` 当场拦住（这正是上轮把语法闸接进 pre-commit 后要的效果）。
- 内联 python 补丁里写中文引号包 ASCII 双引号 ⇒ SyntaxError 且**未落盘**（同一族第三次）；改用 Edit 工具。
