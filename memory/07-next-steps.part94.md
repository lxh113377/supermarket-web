# 07-next-steps 卷 94 —— 第五十三轮（2026-09-29）台账明细（下）

> 本卷是卷 93 的后半（V4 出生余量 3,072B 与 V2 的 4,096B 双口径逼出来的拆卷。**本卷不抄自己的字节数**：把自身测量粘进被自己读取的文档会自漂——写一次就变一次，两侧实际字节数一律由 `npm run verify:volume` 当场判）

## 挂账（R54，含 `前提=<可复算命令>`）

- **R54-H1（=主卷 P0）** E4 升可判：需本机与远端两侧 `w/crlf` 读数都为 0。`前提=`
  `npm run verify:eol | grep 'E4 ::'` ＋ `gh run view --job <id> --log | grep 'E4 ::'`。
- **R54-H2** 未登记面继续收敛（今天 45 件，头部是 `createDimensions 5.4KB / index.js 5.2KB / installDataZoomSlider 5.1KB`）。
  每补登记一件，地板同笔下调一件；禁只降地板不登记。`前提=` `node scripts/report-item-budgets.mjs --dist dist`
- **R54-H3** 逃生门计量的另一半（"绕过之后远端有没有回绿"）：只读联网查 run，做成 `report:*` 位而不是闸
  （户内规⑩：世界没准备好时的红不许当闸）。`前提=` `gh api repos/lxh113377/supermarket-web/commits/<head>/check-runs`
- **R52-H2 沿挂** SQL 语义等价第二通道（需只读 d1 探针，风险分类禁 spawn ⇒ 人工执行并记时刻）。
- **R51-H5 沿挂**（通用解释器分派）仍不触发：别名里的非 node 入口实测仍 1 条（`verify:images`）。
- **工具链坑（本轮又复现两次，属已知规）**：含反引号/引号的正文**禁用内联 `-e`/heredoc** 写入——
  本轮 `node -e` 被中文引号咬了一次、`tar` 绝对路径被 GNU tar 当远程主机咬了一次（`Cannot connect to C:`），
  改法＝走 Write/Edit 或落盘脚本 + `node --check` 复验。

## 用户侧不变项（禁止 agent 擅动）

- `CF_D1_BACKUP_TOKEN` + `BACKUP_PASSPHRASE` 仍缺 ⇒ 备份链 `artifact=0`，具名豁免至 **2026-10-12**。
- M3 分支保护沿用 2026-09-28T07:12:31Z 实测 `NOT_ENFORCED`。微信真机验收未做。
- 后台密钥强度是用户拍板的取舍 ⇒ 禁擅自"加固"成随机串；转 public/共享前才必须轮换 + 重新部署一次。

## 迁出留存：第五十二轮入口卷原文（自 `07-next-steps.md` 迁入，逐字未改）

> 轮初锚 内层 `a5c9f5b` / 外层 `4125a7e`；报告：外层 `deliverables/GitHub开源项目对标分析报告-第五十二轮-2026-09-29.md`。
> 四件＝下架项缺图的真面演习（rc=1 点名 2 号，按 sha 复验复原）· `sm/` 的反向半边 ·
> 顺手抓出 `verify_images.py` 两处判据自己崩了却报红的缺陷（`sm_missing = sm_invalid = []` 别名 / `sm_orphans` 未绑定）·
> 分项体积预算 `npm run report:item-budgets`（advisory 第一版，不进阻断链）。
> 当时的 P0（R53-H1 接线 + 地板）已于第五十三轮执行完毕，见本卷上方读数与主卷新一轮 P0。

> 本轮补记（E4 试过并回退、假红归因、两条复发的已知坑）全部迁至**卷 95**。
